import { createClient } from '@clickhouse/client';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
import { warehouse } from '../src/config/clickhouse';
import { env } from '../src/config/env';
import { closeMysql, mysqlPool } from '../src/config/mysql';
import { closeRedis } from '../src/config/redis';
import * as loadsRepo from '../src/repositories/datasetLoads';
import * as datasetsRepo from '../src/repositories/datasets';
import { deleteDataset } from '../src/services/connections/deleteDataset';
import { queueAutoLoad } from '../src/services/ingest/autoLoad';
import { memoryStorage } from '../src/storage/memoryStorage';
import { chTableName } from '../src/services/ingest/buildDdl';
import { sweepOrphanTables } from '../src/services/ingest/dropTables';
import { loadDataset } from '../src/services/ingest/loadDataset';
import { readFileRows } from '../src/services/ingest/readFileRows';
import { resetDatabase } from './helpers/db';
import {
  bearer,
  makeMembership,
  makeTenant,
  makeUser,
  makeWorkspace,
  signTokenFor,
} from './helpers/fixtures';

/**
 * Test tích hợp §9 — Nạp dữ liệu vào ClickHouse.
 *
 * ─── Hai tầng, và vì sao phải tách ──────────────────────────────────────────
 *
 * Phần lớn bộ này chỉ cần MySQL + Redis: xếp hàng, quyền, cách ly tổ chức, nhặt
 * việc, dọn job treo. Chúng chạy trong mọi lần `npm run test:integration`.
 *
 * Phần CHẠM ClickHouse thật nằm sau một cổng khai TƯỜNG MINH
 * (`INGEST_CH_TESTS=1`), không phải sau một phép "thử ping rồi lặng lẽ skip".
 * Skip ngầm thì một lần chạy bỏ qua toàn bộ phần quan trọng nhất vẫn hiện màu
 * xanh — và đó là kiểu hỏng tệ nhất, vì nó dạy người ta tin vào một dấu tích
 * không có ý nghĩa gì.
 *
 * ─── Vòng lặp nền KHÔNG chạy ở đây ──────────────────────────────────────────
 *
 * `startIngestRunner` tự thoát khi `isTest`. Test nào cần nạp thật thì gọi thẳng
 * `loadDataset()` rồi `await` — chờ một vòng lặp nền là công thức của bài test
 * lúc xanh lúc đỏ tuỳ tốc độ máy.
 */

const app = createApp();

const CH_ENABLED = process.env['INGEST_CH_TESTS'] === '1';

/**
 * ⚠️ Nhánh này bị bỏ qua khi không có cờ, và việc bỏ qua đó PHẢI được nói to.
 *
 * Không lệnh nào từng đặt cờ này, nên trên thực tế nhánh ClickHouse gần như
 * không bao giờ chạy — và hai bài trong đó đã khẳng định ngược lại thiết kế
 * suốt nhiều tháng mà không ai biết. `describe.skipIf` chỉ in ra chữ "skipped"
 * mờ nhạt giữa hàng trăm dòng xanh; không ai đọc nó.
 *
 * Câu cảnh báo nằm ở `vitest.integration.config.ts`, KHÔNG ở đây: vitest chặn
 * `console` của file test và chỉ nhả ra khi bài đó đỏ, nên một `console.warn`
 * đặt ở chỗ này sẽ không bao giờ tới mắt ai — đúng cái bệnh nó sinh ra để chữa.
 * Config thì chạy trong tiến trình chính nên nói được.
 *
 * Cổng vẫn TƯỜNG MINH, không đổi thành tự dò ClickHouse rồi lặng lẽ bỏ qua:
 * lập luận ở docblock đầu file vẫn đúng. Vấn đề chưa bao giờ nằm ở chỗ cổng
 * tường minh, mà ở chỗ nó im lặng.
 */


interface Fixture {
  tenantA: number;
  tenantB: number;
  alice: number;
  workspaceA: number;
  datasetA: number;
  tokenAlice: string;
  tokenDave: string;
  tokenCarol: string;
}

let f: Fixture;

beforeEach(async () => {
  await resetDatabase();

  const tenantA = await makeTenant('Công ty Alpha', 'cong-ty-alpha');
  const tenantB = await makeTenant('Công ty Beta', 'cong-ty-beta');

  const alice = await makeUser('alice@alpha.test', 'Nguyễn Thị An');
  const dave = await makeUser('dave@alpha.test', 'Phạm Văn Dũng');
  const carol = await makeUser('carol@beta.test', 'Lê Thị Cúc');

  await makeMembership(alice, tenantA, 'admin');
  await makeMembership(dave, tenantA, 'viewer');
  await makeMembership(carol, tenantB, 'admin');

  const workspaceA = await makeWorkspace(tenantA, 'Kinh doanh', 'kinh-doanh');
  const datasetA = await makeFileDataset(tenantA, workspaceA, alice);

  f = {
    tenantA,
    tenantB,
    alice,
    workspaceA,
    datasetA,
    tokenAlice: signTokenFor(alice, tenantA, 'admin'),
    tokenDave: signTokenFor(dave, tenantA, 'viewer'),
    tokenCarol: signTokenFor(carol, tenantB, 'admin'),
  };
});

afterAll(async () => {
  await Promise.allSettled([closeMysql(), closeRedis(), warehouse.close()]);
});

describe('POST /v1/datasets/:id/load — xếp hàng', () => {
  it('không token -> 401', async () => {
    await request(app).post(`/api/v1/datasets/${f.datasetA}/load`).expect(401);
  });

  it('viewer KHÔNG được nạp — đó là dataset:modify', async () => {
    await request(app)
      .post(`/api/v1/datasets/${f.datasetA}/load`)
      .set(bearer(f.tokenDave))
      .expect(403);
  });

  it('dataset của tổ chức khác -> 404, KHÔNG phải 403', async () => {
    // 403 là một lời xác nhận rằng id đó có tồn tại. Cùng quy ước với cả repo.
    await request(app)
      .post(`/api/v1/datasets/${f.datasetA}/load`)
      .set(bearer(f.tokenCarol))
      .expect(404);
  });

  it('xếp hàng thành công -> 202 và một dòng `queued`', async () => {
    const res = await request(app)
      .post(`/api/v1/datasets/${f.datasetA}/load`)
      .set(bearer(f.tokenAlice))
      .expect(202);

    expect(res.body).toMatchObject({ status: 'queued', datasetStatus: 'queued' });

    const [rows] = await mysqlPool.query<RowDataPacket[]>(
      'SELECT tenant_id, dataset_id, status, triggered_by FROM dataset_load_runs',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenant_id: f.tenantA,
      dataset_id: f.datasetA,
      status: 'queued',
      triggered_by: f.alice,
    });
  });

  it('xếp hàng lần hai khi lần đầu chưa xong -> 409', async () => {
    await request(app)
      .post(`/api/v1/datasets/${f.datasetA}/load`)
      .set(bearer(f.tokenAlice))
      .expect(202);

    const res = await request(app)
      .post(`/api/v1/datasets/${f.datasetA}/load`)
      .set(bearer(f.tokenAlice))
      .expect(409);

    // Trường là `error`, không phải `code` — hình dạng lỗi chung của cả API,
    // xem `middleware/errorHandler.ts`.
    expect(res.body.error).toBe('LoadAlreadyRunning');
  });

  it('dataset chưa `ready` -> 409 với lý do đọc được', async () => {
    await mysqlPool.query('UPDATE datasets SET status = ? WHERE id = ?', ['pending', f.datasetA]);

    const res = await request(app)
      .post(`/api/v1/datasets/${f.datasetA}/load`)
      .set(bearer(f.tokenAlice))
      .expect(409);

    expect(res.body.error).toBe('DatasetNotLoadable');
  });
});

describe('GET /v1/datasets/:id/load — tiến độ', () => {
  it('viewer ĐỌC được: người vào để xem báo cáo phải biết vì sao số liệu cũ', async () => {
    await request(app)
      .get(`/api/v1/datasets/${f.datasetA}/load`)
      .set(bearer(f.tokenDave))
      .expect(200);
  });

  it('chưa từng nạp -> 200 với status null, KHÔNG phải 404', async () => {
    const res = await request(app)
      .get(`/api/v1/datasets/${f.datasetA}/load`)
      .set(bearer(f.tokenAlice))
      .expect(200);

    expect(res.body).toMatchObject({ runId: null, status: null, datasetStatus: 'idle' });
  });

  it('dataset của tổ chức khác -> 404', async () => {
    await request(app)
      .get(`/api/v1/datasets/${f.datasetA}/load`)
      .set(bearer(f.tokenCarol))
      .expect(404);
  });
});

describe('tự động nạp', () => {
  it('queueAutoLoad xếp hàng và đánh dấu dataset là `queued`', async () => {
    await queueAutoLoad(f.tenantA, [f.datasetA], f.alice);

    const [runs] = await mysqlPool.query<RowDataPacket[]>(
      'SELECT dataset_id, status, triggered_by FROM dataset_load_runs',
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ dataset_id: f.datasetA, status: 'queued' });

    const [ds] = await mysqlPool.query<RowDataPacket[]>(
      'SELECT load_status FROM datasets WHERE id = ?',
      [f.datasetA],
    );
    expect(ds[0]?.['load_status']).toBe('queued');
  });

  it('gọi hai lần KHÔNG xếp trùng — lần sau ghi đè lần trước nên là công toi', async () => {
    await queueAutoLoad(f.tenantA, [f.datasetA], f.alice);
    await queueAutoLoad(f.tenantA, [f.datasetA], f.alice);

    const [runs] = await mysqlPool.query<RowDataPacket[]>(
      'SELECT id FROM dataset_load_runs WHERE dataset_id = ?',
      [f.datasetA],
    );
    expect(runs).toHaveLength(1);
  });

  it('một dataset hỏng không chặn những cái còn lại trong cùng lô', async () => {
    // id 999999 không tồn tại -> khoá ngoại từ chối. Lô vẫn phải xếp được cái kia.
    await queueAutoLoad(f.tenantA, [999_999, f.datasetA], f.alice);

    const [runs] = await mysqlPool.query<RowDataPacket[]>(
      'SELECT dataset_id FROM dataset_load_runs',
    );
    expect(runs.map((r) => Number(r['dataset_id']))).toEqual([f.datasetA]);
  });
});

describe('GET /v1/datasets/:id/load/preview', () => {
  it('chưa nạp -> 409 chứ không phải bảng rỗng', async () => {
    const res = await request(app)
      .get(`/api/v1/datasets/${f.datasetA}/load/preview`)
      .set(bearer(f.tokenAlice))
      .expect(409);

    expect(res.body.error).toBe('DatasetNotLoadable');
  });

  it('dataset của tổ chức khác -> 404', async () => {
    await request(app)
      .get(`/api/v1/datasets/${f.datasetA}/load/preview`)
      .set(bearer(f.tokenCarol))
      .expect(404);
  });

  it('viewer đọc được', async () => {
    // Vẫn 409 vì chưa nạp, nhưng KHÔNG phải 403 — đó là điều đang kiểm.
    await request(app)
      .get(`/api/v1/datasets/${f.datasetA}/load/preview`)
      .set(bearer(f.tokenDave))
      .expect(409);
  });

  it('pageSize vượt trần -> 400, không âm thầm kéo cả bảng về', async () => {
    // 409 (chưa nạp) sẽ che mất lỗi này nếu thứ tự kiểm bị đảo: schema phân
    // trang PHẢI chạy trước khi service chạm tới trạng thái nạp.
    await request(app)
      .get(`/api/v1/datasets/${f.datasetA}/load/preview?pageSize=100000`)
      .set(bearer(f.tokenAlice))
      .expect(400);
  });
});

describe('GET /v1/datasets/:id/load/schema', () => {
  it('chưa nạp -> 409 chứ không phải danh sách cột rỗng', async () => {
    const res = await request(app)
      .get(`/api/v1/datasets/${f.datasetA}/load/schema`)
      .set(bearer(f.tokenAlice))
      .expect(409);

    // Giao diện dựa vào đúng mã này để rơi về cấu trúc NGUỒN thay vì hiện lỗi.
    expect(res.body.error).toBe('DatasetNotLoadable');
  });

  it('dataset của tổ chức khác -> 404', async () => {
    await request(app)
      .get(`/api/v1/datasets/${f.datasetA}/load/schema`)
      .set(bearer(f.tokenCarol))
      .expect(404);
  });
});

describe('hàng đợi', () => {
  it('claimNext nhận đúng MỘT lần — database làm trọng tài, không phải cờ trong RAM', async () => {
    await loadsRepo.enqueue(mysqlPool, f.tenantA, f.datasetA, f.alice);

    const first = await loadsRepo.claimNext(mysqlPool);
    const second = await loadsRepo.claimNext(mysqlPool);

    expect(first).toMatchObject({ tenantId: f.tenantA, datasetId: f.datasetA });
    // Lần hai không còn dòng `queued` nào -> không ai nhặt được nữa. Đây chính
    // là thứ chặn hai tiến trình `tsx watch` cùng chạy một job.
    expect(second).toBeNull();
  });

  it('failStaleRuns đánh hỏng job treo lúc boot, kèm lý do đọc được', async () => {
    const runId = await loadsRepo.enqueue(mysqlPool, f.tenantA, f.datasetA, f.alice);
    await loadsRepo.claimNext(mysqlPool);
    await mysqlPool.query("UPDATE datasets SET load_status = 'running' WHERE id = ?", [f.datasetA]);

    const affected = await loadsRepo.failStaleRuns(mysqlPool);
    expect(affected).toBe(1);

    const [rows] = await mysqlPool.query<RowDataPacket[]>(
      'SELECT status, error_message FROM dataset_load_runs WHERE id = ?',
      [runId],
    );
    expect(rows[0]?.['status']).toBe('failed');
    expect(String(rows[0]?.['error_message'])).toContain('Nạp lại');

    // Không dọn `datasets.load_status` thì badge kẹt ở "Đang nạp" vĩnh viễn.
    const [ds] = await mysqlPool.query<RowDataPacket[]>(
      'SELECT load_status FROM datasets WHERE id = ?',
      [f.datasetA],
    );
    expect(ds[0]?.['load_status']).toBe('failed');
  });

  it('trần số ô lỗi lưu lại là 100, nhưng TỔNG vẫn đếm đủ', async () => {
    const runId = await loadsRepo.enqueue(mysqlPool, f.tenantA, f.datasetA, f.alice);
    await loadsRepo.insertErrors(
      mysqlPool,
      runId,
      Array.from({ length: loadsRepo.MAX_LOAD_ERRORS }, (_, i) => ({
        rowIndex: i,
        columnName: 'Ngày bán',
        rawValue: 'không phải ngày',
        reason: 'Không đọc được thành ngày giờ.',
      })),
    );
    expect(await loadsRepo.countErrors(mysqlPool, runId)).toBe(loadsRepo.MAX_LOAD_ERRORS);
  });
});

/**
 * Nhánh chạm ClickHouse thật.
 *
 *   INGEST_CH_TESTS=1 npm run test:integration
 *
 * Cần `npm run infra:up` đang chạy. Dùng database riêng `bi_analytics_test`
 * (xem `vitest.config.ts`) để không đụng dữ liệu dev.
 */
describe('dọn kho: xoá dataset KHÔNG đụng tới ClickHouse', () => {
  it('listKnownIds GIỮ bộ đã xoá mềm — bảng trong kho phải sống sót', async () => {
    // Đây là điều kiện để "xoá mềm" đúng nghĩa xoá mềm. Nếu janitor coi bộ đã
    // xoá mềm là mồ côi, nó drop bảng sau một giờ và việc khôi phục trở thành
    // không thể — chỉ chậm hơn một tiếng chứ không khác gì xoá cứng.
    expect(await datasetsRepo.listKnownIds(mysqlPool)).toContain(f.datasetA);

    await mysqlPool.query('UPDATE datasets SET deleted_at = CURRENT_TIMESTAMP(3) WHERE id = ?', [
      f.datasetA,
    ]);

    expect(await datasetsRepo.listKnownIds(mysqlPool)).toContain(f.datasetA);
  });

  it('listKnownIds GIỮ bộ thuộc kết nối đã xoá', async () => {
    // Xoá kết nối làm bộ dữ liệu khuất khỏi giao diện nhưng `deleted_at` vẫn
    // NULL. Trước đây janitor dùng đúng lỗ này để dọn bảng; giờ thì không, vì
    // khôi phục kết nối phải kéo theo cả dữ liệu đã nạp.
    const connId = await makeConnection(f.tenantA, f.alice);
    const datasetB = await makeConnectionDataset(f.tenantA, f.workspaceA, connId, f.alice);

    await mysqlPool.query('UPDATE connections SET deleted_at = CURRENT_TIMESTAMP(3) WHERE id = ?', [
      connId,
    ]);

    const known = await datasetsRepo.listKnownIds(mysqlPool);
    expect(known).toContain(datasetB);
    expect(known).toContain(f.datasetA);
  });

  it('chỉ id đã biến mất KHỎI MySQL mới là mồ côi', async () => {
    // Nghĩa duy nhất còn lại của "mồ côi": không dòng `datasets` nào nhận. Thực
    // tế chỉ xảy ra khi dòng bị xoá cứng theo dây chuyền.
    const known = await datasetsRepo.listKnownIds(mysqlPool);
    expect(known).not.toContain(999_999);
  });

  it('xoá dataset giữ nguyên trạng thái nạp, không dọn cờ', async () => {
    // `ch_table` và `loaded_row_count` phải còn: bộ hồi sinh trỏ vào đúng bảng
    // vẫn đang nằm trong kho, nên nó dùng được ngay mà không phải nạp lại.
    await datasetsRepo.markLoadStatus(mysqlPool, f.datasetA, 'loaded', {
      chTable: 'raw_t1_d1',
      rowCount: 50_000,
    });

    await deleteDataset(f.tenantA, f.datasetA);

    const [rows] = await mysqlPool.query<RowDataPacket[]>(
      'SELECT deleted_at, load_status, ch_table, loaded_row_count FROM datasets WHERE id = ?',
      [f.datasetA],
    );
    expect(rows[0]?.['deleted_at']).not.toBeNull();
    expect(rows[0]).toMatchObject({ load_status: 'loaded', ch_table: 'raw_t1_d1' });
    expect(Number(rows[0]?.['loaded_row_count'])).toBe(50_000);
  });
});

describe('đọc file Excel để nạp', () => {
  /**
   * Ô ngày trong xlsx KHÔNG được lưu như ngày — nó là số sê-ri (số ngày kể từ
   * 1899-12-30), và chỉ định dạng số trong `xl/styles.xml` mới nói đó là ngày.
   *
   * Bỏ styles đi (mặc định của `WorkbookReader`) thì exceljs trả về số trần:
   * 31/07/2012 ra `41121`. Lỗi này ĐÃ xảy ra trên dữ liệu thật — 51.290 dòng
   * Global-Superstore nạp vào ClickHouse với hai cột ngày NULL sạch, kèm 102.580
   * dòng lỗi mà lần nạp vẫn báo `succeeded`.
   *
   * Nó lọt được vì nhánh phân tích (`workbook.xlsx.load`) LUÔN đọc styles, nên
   * giao diện hiện đúng kiểu `date` và không có dấu hiệu gì ở bước tải lên.
   */
  it('ô ngày ra ĐÚNG ngày, không phải số sê-ri của Excel', async () => {
    const ExcelJS = await import('exceljs');
    const wb = new ExcelJS.default.Workbook();
    const sheet = wb.addWorksheet('Đơn hàng');
    sheet.addRow(['Mã', 'Ngày đặt']);
    sheet.addRow(['DH-001', new Date(Date.UTC(2012, 6, 31))]);
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());

    const key = 'test/ngay-excel.xlsx';
    memoryStorage.putForTest(key, buffer);

    const batches: unknown[][][] = [];
    for await (const batch of readFileRows(key, 'xlsx', {
      sheetName: 'Đơn hàng',
      columns: [
        { ordinal: 0, semanticType: 'text' },
        { ordinal: 1, semanticType: 'date' },
      ],
      batchSize: 100,
      maxRows: 100,
    })) {
      batches.push(batch);
    }

    const cell = batches[0]?.[0]?.[1];
    // `41121` là giá trị SAI mà lỗi cũ tạo ra — nêu đích danh để khi test đỏ,
    // người đọc thấy ngay đây là ca hồi quy nào.
    expect(cell).not.toBe('41121');
    expect(cell).toBe('2012-07-31');
  });

  /**
   * File nhiều sheet với `Target` TUYỆT ĐỐI trong `xl/_rels/workbook.xml.rels`.
   *
   * ─── Lỗi này đã xảy ra trên dữ liệu thật ───────────────────────────────────
   *
   * Một file `database.xlsx` 5 sheet do openpyxl ghi: cả 8 bộ dữ liệu sinh ra
   * từ nó đều `failed` với `rows_read = 0` và thông điệp "Không tìm thấy sheet".
   *
   * exceljs ghép tên sheet bằng đúng một phép so sánh chuỗi và chỉ nhận dạng
   * TƯƠNG ĐỐI (`worksheets/sheet1.xml`). Chuẩn OPC cho phép cả dạng tuyệt đối
   * (`/xl/worksheets/sheet1.xml`), openpyxl ghi dạng đó, nên phép ghép trượt và
   * mọi sheet mang tên mặc định `Sheet1`, `Sheet2`, …
   *
   * Nhánh phân tích (§7) dùng `workbook.xlsx.load` nên nó thấy tên thật và lưu
   * đúng vào `datasets.sheet_name`. Chỉ nhánh nạp hỏng — hai đường bất đồng mà
   * bước tải lên không có dấu hiệu gì.
   *
   * Ca này dựng lại đúng hình dạng đó: ghi bằng exceljs rồi VIẾT LẠI phần rels
   * sang dạng tuyệt đối, nên nó kiểm cách ta ghép tên chứ không kiểm một bản
   * ghi giả.
   */
  it('sheet vẫn tìm ra khi rels ghi đường dẫn TUYỆT ĐỐI — file kiểu openpyxl', async () => {
    const ExcelJS = await import('exceljs');
    const JSZip = (await import('jszip')).default;

    const wb = new ExcelJS.default.Workbook();
    // Ô TOÀN SỐ là có chủ đích: có ô chữ thì exceljs ghi thêm
    // `xl/sharedStrings.xml`, và file người dùng gặp lỗi thật KHÔNG có phần đó.
    // Sự vắng mặt của nó đổi hẳn đường đi bên trong `WorkbookReader`, nên một
    // bàn thử có chuỗi sẽ kiểm một thứ khác với thứ đã hỏng.
    for (const [ten, gia] of [
      ['Khach', 111],
      ['Don', 222],
      ['Tra hang', 333],
    ] as const) {
      const s = wb.addWorksheet(ten);
      s.addRow([0, 0]);
      s.addRow([gia / 10, gia]);
    }

    const zip = await JSZip.loadAsync(Buffer.from(await wb.xlsx.writeBuffer()));
    const rels = await zip.file('xl/_rels/workbook.xml.rels')!.async('string');
    // `Target="worksheets/sheet2.xml"` -> `Target="/xl/worksheets/sheet2.xml"`
    const tuyetDoi = rels.replace(/Target="worksheets\//g, 'Target="/xl/worksheets/');
    expect(tuyetDoi).not.toBe(rels);
    zip.file('xl/_rels/workbook.xml.rels', tuyetDoi);
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });

    const key = 'test/rels-tuyet-doi.xlsx';
    memoryStorage.putForTest(key, buffer);

    // Sheet THỨ HAI, không phải sheet đầu: đọc đúng sheet đầu có thể chỉ là ăn
    // may vì nó là cái được phát ra trước tiên.
    const batches: unknown[][][] = [];
    for await (const batch of readFileRows(key, 'xlsx', {
      sheetName: 'Don',
      columns: [
        { ordinal: 0, semanticType: 'number' },
        { ordinal: 1, semanticType: 'number' },
      ],
      batchSize: 100,
      maxRows: 100,
    })) {
      batches.push(batch);
    }

    expect(batches.flat()).toEqual([[22.2, 222]]);
  });

  /**
   * V-04, giờ tái hiện được CHẮC CHẮN thay vì chập chờn.
   *
   * `WorkbookReader` ném `Cannot read properties of undefined (reading 'sheets')`
   * — nó đọc `this.model.sheets` khi `xl/workbook.xml` chưa được phân tích. Lỗi
   * nằm trong ruột exceljs và xảy ra TRƯỚC khi trả về worksheet nào, nên không
   * vá từ ngoài được; đường lùi `workbook.xlsx.load` là cách duy nhất.
   *
   * Bàn thử: workbook TOÀN SỐ do chính exceljs ghi. Không có ô chữ thì exceljs
   * không xuất `xl/sharedStrings.xml`, và chính sự vắng mặt đó đưa trình đọc
   * vào nhánh hỏng. Trước bản vá, ca này ném lỗi ngay lần chạy đầu — không cần
   * chạy lại nhiều lần để bắt như ca ngày tháng.
   */
  it('bộ đọc dòng ném lỗi thì lùi về đọc cả file, không làm hỏng lần nạp', async () => {
    const ExcelJS = await import('exceljs');
    const wb = new ExcelJS.default.Workbook();
    for (const [ten, gia] of [
      ['Khach', 111],
      ['Don', 222],
      ['Tra hang', 333],
    ] as const) {
      const s = wb.addWorksheet(ten);
      s.addRow([0, 0]);
      s.addRow([gia / 10, gia]);
    }
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());

    const key = 'test/khong-co-shared-strings.xlsx';
    memoryStorage.putForTest(key, buffer);

    const batches: unknown[][][] = [];
    for await (const batch of readFileRows(key, 'xlsx', {
      sheetName: 'Tra hang',
      columns: [
        { ordinal: 0, semanticType: 'number' },
        { ordinal: 1, semanticType: 'number' },
      ],
      batchSize: 100,
      maxRows: 100,
    })) {
      batches.push(batch);
    }

    expect(batches.flat()).toEqual([[33.3, 333]]);
  });
});

describe.skipIf(!CH_ENABLED)('nạp thật vào ClickHouse', () => {
  beforeAll(async () => {
    // Phải dùng một client RIÊNG, không khai `database`: client dùng chung
    // (`warehouse`) gửi mọi câu lệnh kèm ngữ cảnh `bi_analytics_test`, nên câu
    // tạo chính database đó lại hỏng vì nó chưa tồn tại.
    const bootstrap = createClient({
      url: `http://${env.CLICKHOUSE_HOST}:${env.CLICKHOUSE_PORT}`,
      username: env.CLICKHOUSE_USER,
      password: env.CLICKHOUSE_PASSWORD,
    });
    try {
      await bootstrap.command({
        query: `CREATE DATABASE IF NOT EXISTS ${env.CLICKHOUSE_DATABASE}`,
      });
    } finally {
      await bootstrap.close();
    }
  });

  /**
   * Nạp rồi đánh dấu `loaded` — đúng những gì vòng lặp nền làm sau một lần nạp.
   *
   * Phải có bước `markLoadStatus`: các endpoint đọc kho đều chặn ở `loadStatus`,
   * nên bỏ qua nó thì test nhận 409 chứ không phải dữ liệu.
   */
  async function loadAndMark(): Promise<void> {
    const runId = await loadsRepo.enqueue(mysqlPool, f.tenantA, f.datasetA, f.alice);
    const outcome = await loadDataset(runId, f.tenantA, f.datasetA);
    await loadsRepo.finish(mysqlPool, runId, 'succeeded', null);
    await datasetsRepo.markLoadStatus(mysqlPool, f.datasetA, 'loaded', {
      chTable: outcome.chTable,
      rowCount: outcome.rowsLoaded,
    });
  }

  it('nạp xong thì số dòng bên ClickHouse khớp, và giá trị đúng', async () => {
    await seedRows(f.datasetA, [
      { 'Khu vực': 'Hà Nội', 'Ngày bán': '31/12/2026', 'Doanh thu': 1500 },
      { 'Khu vực': 'Đà Nẵng', 'Ngày bán': '2026-01-05', 'Doanh thu': 2500 },
    ]);

    const runId = await loadsRepo.enqueue(mysqlPool, f.tenantA, f.datasetA, f.alice);
    const outcome = await loadDataset(runId, f.tenantA, f.datasetA);

    expect(outcome).toMatchObject({ rowsRead: 2, rowsLoaded: 2, rowsFailed: 0 });
    expect(await count(outcome.chTable)).toBe(2);

    // Ngày kiểu Việt Nam giữ ĐÚNG ngày. Đây là ca bắt lỗi lệch 7 tiếng: nếu
    // chuỗi đi qua `new Date()` thì `31/12/2026` thành `2026-12-30 17:00`.
    const rs = await warehouse.query({
      query: `SELECT toString(\`Ngày bán\`) AS d FROM ${env.CLICKHOUSE_DATABASE}.\`${outcome.chTable}\` ORDER BY \`_row_index\``,
      format: 'JSONEachRow',
    });
    const dates = await rs.json<{ d: string }>();
    expect(dates[0]?.d).toBe('2026-12-31 00:00:00.000');
    expect(dates[1]?.d).toBe('2026-01-05 00:00:00.000');
  });

  it('nạp LẠI không nhân đôi — EXCHANGE TABLES tráo tên nguyên tử', async () => {
    await seedRows(f.datasetA, [
      { 'Khu vực': 'A', 'Ngày bán': '2026-01-01', 'Doanh thu': 1 },
      { 'Khu vực': 'B', 'Ngày bán': '2026-01-02', 'Doanh thu': 2 },
      { 'Khu vực': 'C', 'Ngày bán': '2026-01-03', 'Doanh thu': 3 },
    ]);

    const first = await loadsRepo.enqueue(mysqlPool, f.tenantA, f.datasetA, f.alice);
    const table = (await loadDataset(first, f.tenantA, f.datasetA)).chTable;
    expect(await count(table)).toBe(3);

    // Nguồn giảm còn 2 dòng -> lần nạp sau phải ra ĐÚNG 2, không phải 5, cũng
    // không phải 3.
    //
    // Thay chính FILE, không xoá `dataset_rows`: từ khi bỏ nút thắt, bảng đó chỉ
    // còn là mẫu xem trước và đường nạp không hề đọc nó. Xoá ở đó rồi vẫn thấy 3
    // dòng chính là bằng chứng bài test đang canh nhầm nơi.
    await seedRows(f.datasetA, [
      { 'Khu vực': 'A', 'Ngày bán': '2026-01-01', 'Doanh thu': 1 },
      { 'Khu vực': 'B', 'Ngày bán': '2026-01-02', 'Doanh thu': 2 },
    ]);

    const second = await loadsRepo.enqueue(mysqlPool, f.tenantA, f.datasetA, f.alice);
    await loadDataset(second, f.tenantA, f.datasetA);
    expect(await count(table)).toBe(2);
  });

  it('ô hỏng -> NULL + một dòng lỗi, phần còn lại vẫn nạp', async () => {
    await seedRows(f.datasetA, [
      { 'Khu vực': 'A', 'Ngày bán': '2026-01-01', 'Doanh thu': 10 },
      { 'Khu vực': 'B', 'Ngày bán': 'chưa xác định', 'Doanh thu': 20 },
    ]);

    const runId = await loadsRepo.enqueue(mysqlPool, f.tenantA, f.datasetA, f.alice);
    const outcome = await loadDataset(runId, f.tenantA, f.datasetA);

    // Một ô hỏng KHÔNG được giết cả lần nạp.
    expect(outcome.rowsLoaded).toBe(2);
    expect(outcome.rowsFailed).toBe(1);

    const errors = await loadsRepo.listErrors(mysqlPool, runId, 1, 10);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ rowIndex: 1, columnName: 'Ngày bán' });

    const rs = await warehouse.query({
      query: `SELECT count() AS n FROM ${env.CLICKHOUSE_DATABASE}.\`${outcome.chTable}\` WHERE \`Ngày bán\` IS NULL`,
      format: 'JSONEachRow',
    });
    expect(Number((await rs.json<{ n: string }>())[0]?.n)).toBe(1);
  });

  it('xem trước ĐỌC TỪ KHO, không phải từ nguồn', async () => {
    await seedRows(f.datasetA, [
      { 'Khu vực': 'Hà Nội', 'Ngày bán': '31/12/2026', 'Doanh thu': 1500 },
    ]);
    const runId = await loadsRepo.enqueue(mysqlPool, f.tenantA, f.datasetA, f.alice);
    const outcome = await loadDataset(runId, f.tenantA, f.datasetA);
    await loadsRepo.finish(mysqlPool, runId, 'succeeded', null);
    await datasetsRepo.markLoadStatus(mysqlPool, f.datasetA, 'loaded', {
      chTable: outcome.chTable,
      rowCount: outcome.rowsLoaded,
    });

    const res = await request(app)
      .get(`/api/v1/datasets/${f.datasetA}/load/preview`)
      .set(bearer(f.tokenAlice))
      .expect(200);

    // Cột hệ thống PHẢI có mặt — nó là cầu nối sang bảng lỗi ở §9.8.
    expect(res.body.columns).toContain('_row_index');
    expect(res.body.columns).toContain('Ngày bán');
    // Và giá trị là thứ ĐÃ ĐƯỢC CHUYỂN ĐỔI, không phải chuỗi gốc trong file.
    expect(res.body.rows[0]).toContain('2026-12-31 00:00:00.000');
  });

  it('phân trang cắt đúng trang và đếm đúng TỔNG', async () => {
    await seedRows(
      f.datasetA,
      Array.from({ length: 25 }, (_, i) => ({
        'Khu vực': `KV${i}`,
        'Ngày bán': '2026-01-01',
        'Doanh thu': i,
      })),
    );
    await loadAndMark();

    const page1 = await request(app)
      .get(`/api/v1/datasets/${f.datasetA}/load/preview?page=1&pageSize=10`)
      .set(bearer(f.tokenAlice))
      .expect(200);

    // `total` là tổng THẬT của bảng, không phải số dòng đang hiện. Đây là thứ
    // phía CSDL nguồn không làm được và là lý do bảng trong kho phân trang thật.
    expect(page1.body.total).toBe(25);
    expect(page1.body.totalPages).toBe(3);
    expect(page1.body.rows).toHaveLength(10);

    const page3 = await request(app)
      .get(`/api/v1/datasets/${f.datasetA}/load/preview?page=3&pageSize=10`)
      .set(bearer(f.tokenAlice))
      .expect(200);

    // Trang cuối còn 5 dòng, và chúng KHÁC trang đầu — bắt được ca `OFFSET` bị
    // bỏ quên, thứ mà chỉ kiểm số lượng dòng sẽ không thấy.
    expect(page3.body.rows).toHaveLength(5);
    const region = (row: unknown[]) => row[page1.body.columns.indexOf('Khu vực')];
    expect(region(page1.body.rows[0])).toBe('KV0');
    expect(region(page3.body.rows[0])).toBe('KV20');
  });

  it('cấu trúc đọc từ system.columns — kiểu CLICKHOUSE, không phải kiểu nguồn', async () => {
    await seedRows(f.datasetA, [
      { 'Khu vực': 'Hà Nội', 'Ngày bán': '31/12/2026', 'Doanh thu': 1500 },
    ]);
    await loadAndMark();

    const res = await request(app)
      .get(`/api/v1/datasets/${f.datasetA}/load/schema`)
      .set(bearer(f.tokenAlice))
      .expect(200);

    expect(res.body.table).toBe(chTableName(f.tenantA, f.datasetA));

    const byName = new Map<string, { type: string; nullable: boolean }>(
      (res.body.columns as { name: string; type: string; nullable: boolean }[]).map((c) => [
        c.name,
        c,
      ]),
    );

    // Cột ngày phải ra ĐÚNG quy ước UTC của dự án. Nếu ai đó đổi ánh xạ sang
    // `DateTime` trần, báo cáo sẽ lệch một ngày ở các bản ghi gần nửa đêm và
    // không có test nào khác bắt được.
    expect(byName.get('Ngày bán')?.type).toBe("Nullable(DateTime64(3, 'UTC'))");
    expect(byName.get('Ngày bán')?.nullable).toBe(true);
    // Cột hệ thống không `Nullable` — nó là khoá sắp xếp của MergeTree.
    expect(byName.get('_row_index')?.type).toBe('UInt64');
    expect(byName.get('_row_index')?.nullable).toBe(false);
  });

  it('không để lại bảng tạm `__new` sau khi nạp xong', async () => {
    await seedRows(f.datasetA, [{ 'Khu vực': 'A', 'Ngày bán': '2026-01-01', 'Doanh thu': 1 }]);
    const runId = await loadsRepo.enqueue(mysqlPool, f.tenantA, f.datasetA, f.alice);
    await loadDataset(runId, f.tenantA, f.datasetA);

    const rs = await warehouse.query({
      query: `SELECT name FROM system.tables WHERE database = {db:String} AND name LIKE '%__new'`,
      query_params: { db: env.CLICKHOUSE_DATABASE },
      format: 'JSONEachRow',
    });
    expect(await rs.json()).toHaveLength(0);
  });

  it('xoá bộ dữ liệu KHÔNG đụng tới bảng trong kho', async () => {
    // ⚠️ Bài này từng khẳng định điều NGƯỢC LẠI — "bảng biến mất ngay" — và giữ
    // nguyên khẳng định đó rất lâu sau khi `dropTables.ts` bỏ hẳn lớp xoá ngay.
    // Nó sống sót được vì cả khối `describe` này nằm sau cờ `INGEST_CH_TESTS`
    // mà không lệnh nào bật, nên nó chưa từng chạy để mà đỏ.
    //
    // Thiết kế hiện tại: xoá dataset là thao tác THUẦN MySQL. Bảng `raw_*` ở lại
    // để "xoá mềm" đúng nghĩa xoá mềm — khôi phục chỉ là gỡ `deleted_at` ra, và
    // dữ liệu đã nạp còn nguyên chứ không phải nạp lại từ đầu.
    //
    // Khối `dọn kho: xoá dataset KHÔNG đụng tới ClickHouse` ở trên đã kiểm phần
    // MySQL của luật này. Bài này là nửa còn lại: xác nhận trên ClickHouse thật.
    await seedRows(f.datasetA, [{ 'Khu vực': 'A', 'Ngày bán': '2026-01-01', 'Doanh thu': 1 }]);
    const runId = await loadsRepo.enqueue(mysqlPool, f.tenantA, f.datasetA, f.alice);
    const table = (await loadDataset(runId, f.tenantA, f.datasetA)).chTable;
    expect(await tableExists(table)).toBe(true);

    await request(app)
      .delete(`/api/v1/datasets/${f.datasetA}`)
      .set(bearer(f.tokenAlice))
      .expect(204);

    // Bảng còn, và còn cả DỮ LIỆU trong đó — "bảng vẫn tồn tại" mà rỗng ruột
    // thì cũng không khôi phục được gì.
    expect(await tableExists(table)).toBe(true);
    expect(await count(table)).toBe(1);

    const [rows] = await mysqlPool.query<RowDataPacket[]>(
      'SELECT deleted_at FROM datasets WHERE id = ?',
      [f.datasetA],
    );
    expect(rows[0]?.['deleted_at']).not.toBeNull();

    // Cố ý KHÔNG kiểm `load_status` / `ch_table` ở đây. Bài này gọi thẳng
    // `loadDataset()` để khỏi phải chờ vòng lặp nền, mà cờ nạp lại do `runner`
    // ghi chứ không phải `loadDataset` — nên hai cột đó vẫn ở giá trị khởi tạo
    // và kiểm chúng ở đây chỉ đo được cách dựng hiện trường của chính bài test.
    // Việc xoá dataset không dọn cờ đã có bài riêng ở khối `dọn kho` phía trên,
    // nơi trạng thái được đặt tường minh bằng `markLoadStatus`.
  });

  it('janitor dọn bảng mồ côi nhưng KHÔNG đụng bảng còn sống', async () => {
    await seedRows(f.datasetA, [{ 'Khu vực': 'A', 'Ngày bán': '2026-01-01', 'Doanh thu': 1 }]);
    const runA = await loadsRepo.enqueue(mysqlPool, f.tenantA, f.datasetA, f.alice);
    const tableA = (await loadDataset(runA, f.tenantA, f.datasetA)).chTable;

    // ⚠️ Bài này từng XOÁ MỀM bộ B rồi đợi janitor dọn bảng của nó. Đó là hành
    // vi cũ, và nó mâu thuẫn thẳng với bài `listKnownIds GIỮ bộ đã xoá mềm` ở
    // khối trên — hai bài trong cùng một file nói ngược nhau, suốt nhiều tháng,
    // vì bài này nằm sau cờ `INGEST_CH_TESTS` nên không bao giờ chạy.
    //
    // Nghĩa hiện tại của "mồ côi" hẹp hơn nhiều: KHÔNG CÒN DÒNG NÀO trong
    // `datasets` nhận bảng đó — kể cả dòng đã xoá mềm. Thực tế chỉ xảy ra khi
    // dòng bị xoá CỨNG theo dây chuyền, ví dụ một tổ chức bị xoá cứng.
    const datasetB = await makeFileDataset(f.tenantA, f.workspaceA, f.alice);
    await seedRows(datasetB, [{ 'Khu vực': 'B', 'Ngày bán': '2026-01-02', 'Doanh thu': 2 }]);
    const runB = await loadsRepo.enqueue(mysqlPool, f.tenantA, datasetB, f.alice);
    const tableB = (await loadDataset(runB, f.tenantA, datasetB)).chTable;

    // Bộ C: xoá MỀM. Bảng của nó phải sống sót qua lượt quét — đây chính là chỗ
    // bản cũ sai, nên phải có một bài canh cửa.
    const datasetC = await makeFileDataset(f.tenantA, f.workspaceA, f.alice);
    await seedRows(datasetC, [{ 'Khu vực': 'C', 'Ngày bán': '2026-01-03', 'Doanh thu': 3 }]);
    const runC = await loadsRepo.enqueue(mysqlPool, f.tenantA, datasetC, f.alice);
    const tableC = (await loadDataset(runC, f.tenantA, datasetC)).chTable;
    await mysqlPool.query('UPDATE datasets SET deleted_at = CURRENT_TIMESTAMP(3) WHERE id = ?', [
      datasetC,
    ]);

    // Chỉ bộ B biến mất HẲN khỏi MySQL. Xoá cứng thẳng trong database, không qua
    // `deleteDataset` — bài này kiểm janitor, không kiểm lại đường xoá.
    await mysqlPool.query('DELETE FROM datasets WHERE id = ?', [datasetB]);

    expect(await sweepOrphanTables()).toBeGreaterThanOrEqual(1);

    expect(await tableExists(tableA)).toBe(true);
    expect(await tableExists(tableB)).toBe(false);
    expect(await tableExists(tableC)).toBe(true);
  });

  it('janitor dọn cả bảng tạm `__new` bỏ lại của bộ đã xoá', async () => {
    // Người dùng xoá GIỮA LÚC đang nạp thì bảng tạm còn nằm lại. Không ai đi tìm
    // nó nữa vì `ch_table` chưa từng trỏ tới nó.
    await createBareTable('raw_t1_d9999__new');
    expect(await tableExists('raw_t1_d9999__new')).toBe(true);

    await sweepOrphanTables();

    expect(await tableExists('raw_t1_d9999__new')).toBe(false);
  });

  it('janitor KHÔNG đụng bảng không do §9 sinh ra', async () => {
    // `bi_analytics` thật còn chứa `spike_orders` của spike F1.7, và §10 sẽ đổ
    // vào đây view staging/marts của dbt. Nới `RAW_TABLE_RE` thành tiền tố `raw_`
    // là đủ để một tác vụ nền xoá mất thứ nó không hiểu.
    const nguoiKhac = ['spike_orders', 'raw_orders', 'stg_raw_t1_d1', 'raw_t1_d1_backup'];
    for (const name of nguoiKhac) await createBareTable(name);

    await sweepOrphanTables();

    for (const name of nguoiKhac) {
      expect(await tableExists(name), `janitor đã xoá nhầm ${name}`).toBe(true);
      await warehouse.command({
        query: `DROP TABLE IF EXISTS ${env.CLICKHOUSE_DATABASE}.\`${name}\` SYNC`,
      });
    }
  });

  afterAll(async () => {
    // Dọn bảng của chính bộ test này. `SYNC` để không giữ đĩa thêm 8 phút.
    await warehouse
      .command({
        query: `DROP TABLE IF EXISTS ${env.CLICKHOUSE_DATABASE}.\`${chTableName(1, 1)}\` SYNC`,
      })
      .catch(() => undefined);
  });
});

// ─── Helper ──────────────────────────────────────────────────────────────────

/** Một dataset nguồn `file` với ba cột phủ đủ text / date / number. */
async function makeFileDataset(
  tenantId: number,
  workspaceId: number,
  createdBy: number,
): Promise<number> {
  const [result] = await mysqlPool.query<ResultSetHeader>(
    `INSERT INTO datasets
       (tenant_id, source, workspace_id, name, original_filename, file_ext, s3_key,
        status, created_by, column_count)
     VALUES (?, 'file', ?, 'Doanh thu 2026', 'doanh-thu.csv', 'csv', 'k/doanh-thu.csv',
             'ready', ?, 3)`,
    [tenantId, workspaceId, createdBy],
  );
  const datasetId = result.insertId;

  await mysqlPool.query(
    `INSERT INTO dataset_columns
       (dataset_id, name, field_name, data_type, semantic_type, field_role, is_nullable, ordinal, included)
     VALUES ?`,
    [
      [
        [datasetId, 'khu_vuc', 'Khu vực', 'text', 'text', 'dimension', 1, 0, 1],
        [datasetId, 'ngay_ban', 'Ngày bán', 'date', 'date', 'dimension', 1, 1, 1],
        [datasetId, 'doanh_thu', 'Doanh thu', 'number', 'number', 'measure', 1, 2, 1],
      ],
    ],
  );
  return datasetId;
}

/**
 * Gieo dữ liệu nguồn cho một bộ dữ liệu `file`.
 *
 * Ghi một file CSV THẬT vào kho lưu trữ, vì từ khi bỏ nút thắt `dataset_rows`
 * thì đó mới là nguồn mà `loadDataset` đọc. Vẫn ghi thêm bản sao vào
 * `dataset_rows` để tab Xem trước có cái mà hiện — đúng vai trò còn lại của bảng
 * đó: một MẪU, không phải bản đầy đủ.
 *
 * Thứ tự cột phải khớp `makeFileDataset`: `Khu vực`, `Ngày bán`, `Doanh thu`.
 */
const CSV_HEADER = ['Khu vực', 'Ngày bán', 'Doanh thu'] as const;

async function seedRows(
  datasetId: number,
  rows: readonly Record<string, unknown>[],
): Promise<void> {
  const csv = [
    CSV_HEADER.join(','),
    ...rows.map((row) => CSV_HEADER.map((k) => csvCell(row[k])).join(',')),
  ].join('\n');

  const [found] = await mysqlPool.query<RowDataPacket[]>(
    'SELECT s3_key FROM datasets WHERE id = ?',
    [datasetId],
  );
  memoryStorage.putForTest(String(found[0]?.['s3_key']), Buffer.from(csv, 'utf8'));

  // Dọn trước: gọi `seedRows` lần hai cho cùng một bộ (ca "nạp lại") sẽ đâm vào
  // khoá chính `(dataset_id, row_index)` nếu không.
  await mysqlPool.query('DELETE FROM dataset_rows WHERE dataset_id = ?', [datasetId]);
  if (rows.length > 0) {
    await mysqlPool.query('INSERT INTO dataset_rows (dataset_id, row_index, data) VALUES ?', [
      rows.map((row, i) => [datasetId, i, JSON.stringify(row)]),
    ]);
  }
  await mysqlPool.query('UPDATE datasets SET row_count = ? WHERE id = ?', [rows.length, datasetId]);
}

/** Bọc ô CSV khi nó chứa dấu phẩy hoặc nháy kép — nếu không cột sẽ lệch. */
function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Một kết nối tối thiểu — chỉ đủ để `datasets` có cha mà trỏ tới. */
async function makeConnection(tenantId: number, createdBy: number): Promise<number> {
  const [result] = await mysqlPool.query<ResultSetHeader>(
    `INSERT INTO connections
       (tenant_id, name, kind, host, port, database_name, username, password_cipher, created_by)
     VALUES (?, 'CRM sản xuất', 'mysql', 'db.noi-bo.test', 3306, 'crm', 'reader', 'x', ?)`,
    [tenantId, createdBy],
  );
  return result.insertId;
}

async function makeConnectionDataset(
  tenantId: number,
  workspaceId: number,
  connectionId: number,
  createdBy: number,
): Promise<number> {
  const [result] = await mysqlPool.query<ResultSetHeader>(
    `INSERT INTO datasets
       (tenant_id, source, workspace_id, connection_id, source_schema, source_table,
        name, status, created_by, column_count)
     VALUES (?, 'connection', ?, ?, 'crm', 'khach_hang', 'khach_hang', 'ready', ?, 1)`,
    [tenantId, workspaceId, connectionId, createdBy],
  );
  return result.insertId;
}

/** Bảng rỗng một cột, chỉ để janitor có thứ mà quyết định đụng hay không. */
async function createBareTable(name: string): Promise<void> {
  await warehouse.command({
    query: `CREATE TABLE IF NOT EXISTS ${env.CLICKHOUSE_DATABASE}.\`${name}\`
              (x UInt8) ENGINE = MergeTree() ORDER BY x`,
  });
}

async function tableExists(table: string): Promise<boolean> {
  const rs = await warehouse.query({
    query: `SELECT count() AS n FROM system.tables
             WHERE database = {db:String} AND name = {t:String}`,
    query_params: { db: env.CLICKHOUSE_DATABASE, t: table },
    format: 'JSONEachRow',
  });
  return Number((await rs.json<{ n: string }>())[0]?.n ?? 0) > 0;
}

async function count(table: string): Promise<number> {
  const rs = await warehouse.query({
    query: `SELECT count() AS n FROM ${env.CLICKHOUSE_DATABASE}.\`${table}\``,
    format: 'JSONEachRow',
  });
  return Number((await rs.json<{ n: string }>())[0]?.n ?? -1);
}
