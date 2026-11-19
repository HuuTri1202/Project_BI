import { copyFile, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';

import type { RowDataPacket } from 'mysql2';
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
import { env } from '../src/config/env';
import { closeMysql, mysqlPool } from '../src/config/mysql';
import { closeRedis } from '../src/config/redis';
import * as loadsRepo from '../src/repositories/datasetLoads';
import * as datasetsRepo from '../src/repositories/datasets';
import { loadDataset } from '../src/services/ingest/loadDataset';
import { memoryStorage } from '../src/storage/memoryStorage';
import { resetDatabase } from './helpers/db';
import {
  bearer,
  capGoiKhongGioiHan,
  makeMembership,
  makeTenant,
  makeUser,
  makeWorkspace,
  signTokenFor,
} from './helpers/fixtures';

/**
 * §10 — truy vấn Cube THẬT, trên dữ liệu THẬT trong ClickHouse.
 *
 * Chạy: `npm --workspace backend run test:integration:ch` (cần `npm run infra:up`).
 *
 * ═══ Vì sao file này phải tồn tại ═══════════════════════════════════════════
 *
 * Trước nó, KHÔNG một bài test nào trong dự án chạy một truy vấn Cube thật.
 * Đo được lúc viết file này:
 *
 *   - `datamodel.integration.test.ts` cố ý dựng mô hình bằng SQL thô
 *     (`makeLoadedDataset` đặt `load_status = 'loaded'` mà không có bảng
 *     ClickHouse nào) để chạy được khi chưa có kho. Đúng cho mục đích của nó.
 *   - Hai ca duy nhất gọi `/query` đều dùng `cubeGia()` — một `fetch` giả.
 *   - Ba ca `canvas-data` gọi Cube thật, nhưng chỉ khẳng định `status === 200`
 *     và danh sách `visualId`. Mà `canvas-data` CỐ Ý trả 200 kèm
 *     `data: null, error: ...` cho từng ô khi truy vấn chết (một ô hỏng không
 *     được làm trắng cả trang). Nên chúng xanh kể cả khi mọi ô đều hỏng — đo
 *     thật: mỗi lượt chạy tệp đó sinh 6 dòng `Cube '...' not found` trong log
 *     container mà vẫn 104/104 đạt.
 *   - Lane ClickHouse cũng không lấp: §7.6 đi dataset -> ClickHouse trực tiếp,
 *     không qua Cube.
 *
 * Hệ quả đã xảy ra thật: một lỗi 503 do hâm nóng Cube bắn quá nhiều lượt biên
 * dịch KHÔNG bị 758 bài test bắt — nó được tìm ra bằng tay.
 *
 * ═══ Nó chứng minh gì, và KHÔNG chứng minh gì ═══════════════════════════════
 *
 * CÓ: sinh schema -> Cube biên dịch -> Cube dịch sang SQL ClickHouse -> gộp số
 * trên dữ liệu thật -> Express trả về đúng con số tính tay được.
 *
 * KHÔNG: rằng Express và Cube trỏ vào CÙNG một thư mục. Bài test tự `copyFile`
 * schema sang thư mục Cube đọc (xem `dongBoSangCube`), vì lane test cố ý ghi
 * vào `tmp/` riêng — `CUBE_SCHEMA_DIR` trong `vitest.config.ts`. Sự ăn khớp
 * đường dẫn là một chuyện CẤU HÌNH, và môi trường dev chứng minh nó ngay ở biểu
 * đồ đầu tiên; còn thứ cần một bài test là chuỗi biến đổi ở trên.
 */

const app = createApp();

/** Tổng cột `Doanh thu` tính tay: 1000 + 500 + 700 + 1200. */
const TONG_DOANH_THU = 3400;

const CSV = [
  'San pham,Khu vuc,Doanh thu',
  'Bàn,Hà Nội,1000',
  'Ghế,Hà Nội,500',
  'Bàn,Đà Nẵng,700',
  'Tủ,Hồ Chí Minh,1200',
].join('\n');

/** Thư mục `repositoryFactory` của Cube đọc, qua mount `./cube:/cube/conf`. */
const THU_MUC_CUBE_DOC = path.resolve(process.cwd(), '../infrastructure/cube/model/tenants');

interface Fixture {
  tenantId: number;
  workspaceId: number;
  userId: number;
  token: string;
}

let f: Fixture;

/** Thư mục đã sao sang chỗ Cube đọc — dọn trong `afterEach`, không để lại rác. */
const daSao: string[] = [];

describe.skipIf(process.env['INGEST_CH_TESTS'] !== '1')('§10 truy vấn Cube thật', () => {
  beforeEach(async () => {
    await resetDatabase();

    const tenantId = await makeTenant('Công ty Cube', 'cong-ty-cube');
    const userId = await makeUser('cube@test.local', 'Người dùng Cube');
    await makeMembership(userId, tenantId, 'admin');
    await capGoiKhongGioiHan(tenantId, userId);

    f = {
      tenantId,
      userId,
      workspaceId: await makeWorkspace(tenantId, 'Kinh doanh', 'kinh-doanh'),
      token: signTokenFor(userId, tenantId, 'admin'),
    };
  });

  afterEach(async () => {
    // Dọn NGAY, không chờ hết lượt chạy: Cube theo dõi cả cây `model/`, và một
    // thư mục bỏ lại trỏ tới bảng sắp bị xoá là đúng thứ từng làm chu kỳ làm
    // mới của nó quay vòng vô hạn.
    for (const dir of daSao.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  afterAll(async () => {
    await closeMysql();
    await closeRedis();
  });

  /** Tải CSV lên, chốt, rồi nạp THẬT vào ClickHouse. */
  async function datasetDaNap(): Promise<number> {
    const tao = await request(app)
      .post('/api/v1/datasets/uploads')
      .set(bearer(f.token))
      .send({ workspaceId: f.workspaceId, filename: 'doanh-thu.csv' });
    expect(tao.status, JSON.stringify(tao.body)).toBe(201);

    const datasetId = tao.body.datasetId as number;
    const [rows] = await mysqlPool.query<RowDataPacket[]>(
      'SELECT s3_key FROM datasets WHERE id = ?',
      [datasetId],
    );
    memoryStorage.putForTest(String(rows[0]?.['s3_key']), Buffer.from(CSV, 'utf8'));

    const phanTich = await request(app)
      .post(`/api/v1/datasets/${datasetId}/analyze`)
      .set(bearer(f.token));
    expect(phanTich.status, JSON.stringify(phanTich.body)).toBe(200);

    const chot = await request(app)
      .post(`/api/v1/datasets/${datasetId}/commit`)
      .set(bearer(f.token))
      .send({ name: 'Doanh thu', sheets: [phanTich.body.sheets[0].name] });
    expect(chot.status, JSON.stringify(chot.body)).toBe(200);

    // Nạp thật — đây là chỗ bảng `bi_analytics_test.raw_t*_d*` ra đời.
    const runId = await loadsRepo.enqueue(mysqlPool, f.tenantId, datasetId, f.userId);
    const ketQua = await loadDataset(runId, f.tenantId, datasetId);
    await datasetsRepo.markLoadStatus(mysqlPool, datasetId, 'loaded', {
      chTable: ketQua.chTable,
      rowCount: ketQua.rowsLoaded,
      warehouseBytes: ketQua.warehouseBytes,
    });
    expect(ketQua.rowsLoaded).toBe(4);

    return datasetId;
  }

  /**
   * Sao schema sang thư mục Cube đọc, rồi BUỘC biên dịch lại.
   *
   * Lần đổi `name` không phải để đổi tên: nó đẩy `datamodels.updated_at`, và
   * `schemaVersion` = `MAX(updated_at)` của mọi mô hình còn sống trong tổ chức.
   * Không có nó, Cube trả lại ngữ cảnh đã biên dịch cho ĐÚNG phiên bản đó —
   * ngữ cảnh mà lượt hâm nóng lúc tạo thước đo đã dựng khi thư mục còn rỗng,
   * tức là một ngữ cảnh KHÔNG có cube nào. Truy vấn sau đó sẽ hỏng bằng
   * `Cube '...' not found` trong khi file đã nằm đúng chỗ.
   */
  async function dongBoSangCube(datamodelId: number, ten: string): Promise<void> {
    const nguon = path.resolve(process.cwd(), env.CUBE_SCHEMA_DIR, String(f.tenantId));
    const dich = path.join(THU_MUC_CUBE_DOC, String(f.tenantId));

    await mkdir(dich, { recursive: true });
    daSao.push(dich);
    for (const name of await readdir(nguon)) {
      if (name.endsWith('.js')) await copyFile(path.join(nguon, name), path.join(dich, name));
    }

    const doi = await request(app)
      .patch(`/api/v1/datamodels/${datamodelId}`)
      .set(bearer(f.token))
      .send({ name: ten });
    expect(doi.status, JSON.stringify(doi.body)).toBe(200);
  }

  /** Mô hình một bảng + một thước đo `sum` trên cột `Doanh thu`. */
  async function moHinhCoThuocDo(): Promise<{
    datamodelId: number;
    measureId: number;
    chieuSanPham: number;
  }> {
    const datasetId = await datasetDaNap();

    const mh = await request(app)
      .post('/api/v1/datamodels')
      .set(bearer(f.token))
      .send({ workspaceId: f.workspaceId, name: 'Mô hình doanh thu', datasetIds: [datasetId] });
    expect(mh.status, JSON.stringify(mh.body)).toBe(201);
    const datamodelId = mh.body.id as number;

    const sc = await request(app)
      .get(`/api/v1/datamodels/${datamodelId}/schema`)
      .set(bearer(f.token));
    expect(sc.status, JSON.stringify(sc.body)).toBe(200);

    const bang = sc.body.datasets[0] as {
      id: number;
      columns: { id: number; columnName: string }[];
    };
    const cotDoanhThu = bang.columns.find((c) => c.columnName === 'Doanh thu');
    expect(
      cotDoanhThu,
      `cột không thấy; có: ${bang.columns.map((c) => c.columnName).join(', ')}`,
    ).toBeDefined();

    const td = await request(app)
      .post(`/api/v1/datamodels/${datamodelId}/measures`)
      .set(bearer(f.token))
      .send({
        datamodelDatasetId: bang.id,
        name: 'Tổng doanh thu',
        agg: 'sum',
        columnId: cotDoanhThu?.id,
      });
    expect(td.status, JSON.stringify(td.body)).toBe(201);

    await dongBoSangCube(datamodelId, 'Mô hình doanh thu (đã đồng bộ)');

    const fields = await request(app)
      .get(`/api/v1/datamodels/${datamodelId}/fields`)
      .set(bearer(f.token));
    expect(fields.status, JSON.stringify(fields.body)).toBe(200);
    const chieu = (fields.body.dimensions as { id: number; label: string }[]).find(
      (d) => d.label === 'San pham',
    );
    expect(chieu, `chiều không thấy; có: ${JSON.stringify(fields.body.dimensions)}`).toBeDefined();

    return {
      datamodelId,
      measureId: td.body.id as number,
      chieuSanPham: chieu?.id ?? 0,
    };
  }

  /*
   * MỘT ca cho hai phép khẳng định, và đó là kết luận sau khi đo.
   *
   * Bản đầu tách thành hai ca, mỗi ca tự dựng lại mô hình. Chạy RIÊNG tệp này
   * thì cả hai xanh (~10s mỗi ca), nhưng trong lane đầy đủ cả hai HẾT GIỜ ở
   * trần 20s của `vitest.integration.options.ts`. Lý do: mỗi lượt dựng phải trả
   * giá một lượt biên dịch Cube NGUỘI (đo được 2,7–4,5s) cho phiên bản schema
   * mới, cộng tải tệp + nạp ClickHouse thật; chạy riêng thì Cube rỗi nên nó
   * vừa đủ lọt.
   *
   * Nên gộp lại: một lần dựng, hai câu hỏi. Cách này bỏ hẳn một lượt biên dịch
   * thay vì chỉ nới trần — và nó vẫn phủ đúng hai điều cần phủ. Trần 60s là để
   * ca này không trở thành ca chập chờn trên một máy đang chạy việc khác.
   */
  it(
    'thước đo sum trả ĐÚNG tổng tính tay, và gộp theo chiều ra đúng từng nhóm',
    async () => {
      const { datamodelId, measureId, chieuSanPham } = await moHinhCoThuocDo();

      const tong = await request(app)
        .post(`/api/v1/datamodels/${datamodelId}/query`)
        .set(bearer(f.token))
        .send({ measureIds: [measureId], dimensionIds: [], limit: 10 });

      // Mã trạng thái TRƯỚC, và nó nằm trong thông báo lỗi. Thiếu nó thì một 503
      // hiện ra dưới dạng `NaN` và người đọc đi tìm lỗi ở phép gộp — chính cái
      // bẫy mà ca TD-18 của bộ kiểm thử tay đã mắc.
      expect(tong.status, JSON.stringify(tong.body)).toBe(200);
      expect(Number(tong.body.rows[0][0])).toBe(TONG_DOANH_THU);

      const nhom = await request(app)
        .post(`/api/v1/datamodels/${datamodelId}/query`)
        .set(bearer(f.token))
        .send({ measureIds: [measureId], dimensionIds: [chieuSanPham], limit: 10 });
      expect(nhom.status, JSON.stringify(nhom.body)).toBe(200);

      const theoSanPham = new Map(
        (nhom.body.rows as unknown[][]).map((r) => [String(r[0]), Number(r[1])]),
      );
      // Bàn xuất hiện HAI dòng (Hà Nội 1000 + Đà Nẵng 700) — chỗ này ghim việc
      // Cube thật sự gộp, chứ không trả lại từng dòng thô.
      expect(theoSanPham.get('Bàn')).toBe(1700);
      expect(theoSanPham.get('Ghế')).toBe(500);
      expect(theoSanPham.get('Tủ')).toBe(1200);

      // Và tổng các nhóm phải khớp tổng không nhóm — một phép kiểm chéo rẻ bắt
      // được cả lỗi nhân bản dòng lẫn lỗi mất dòng.
      const congLai = [...theoSanPham.values()].reduce((a, b) => a + b, 0);
      expect(congLai).toBe(TONG_DOANH_THU);
    },
    60_000,
  );
});
