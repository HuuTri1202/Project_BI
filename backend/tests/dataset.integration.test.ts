import type { RowDataPacket } from 'mysql2';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
import { closeMysql, mysqlPool } from '../src/config/mysql';
import { closeRedis } from '../src/config/redis';
import { memoryStorage } from '../src/storage/memoryStorage';
import { resetDatabase } from './helpers/db';
import { bearer, makeMembership, makeTenant, makeUser, makeWorkspace, signTokenFor } from './helpers/fixtures';

/**
 * Test tích hợp luồng "tải file lên → bộ dữ liệu → báo cáo" (§7).
 *
 * Chạy: `npm run test:integration` — cần MySQL + Redis. KHÔNG cần MinIO: tầng
 * lưu trữ dùng bản dựng trong bộ nhớ khi `NODE_ENV=test` (xem `src/storage/`).
 *
 * Việc trình duyệt PUT file lên S3 được mô phỏng bằng `memoryStorage.putForTest`.
 * Dựng một HTTP server thật chỉ để nhận PUT sẽ kiểm chính đoạn code giả đó, chứ
 * không kiểm thêm được gì về hệ thống thật.
 */

const app = createApp();

interface Fixture {
  tenantA: number;
  tenantB: number;
  workspaceA: number;
  workspaceB: number;
  adminA: number;
  tokenAdminA: string;
  tokenCreatorA: string;
  tokenViewerA: string;
  tokenAdminB: string;
}

let f: Fixture;

beforeEach(async () => {
  await resetDatabase();

  const tenantA = await makeTenant('Công ty Alpha', 'cong-ty-alpha');
  const tenantB = await makeTenant('Công ty Beta', 'cong-ty-beta');

  const adminA = await makeUser('admin.a@test.local', 'Quản trị A');
  const creatorA = await makeUser('creator.a@test.local', 'Người tạo A');
  const viewerA = await makeUser('viewer.a@test.local', 'Người xem A');
  const adminB = await makeUser('admin.b@test.local', 'Quản trị B');

  await makeMembership(adminA, tenantA, 'admin');
  await makeMembership(creatorA, tenantA, 'creator');
  await makeMembership(viewerA, tenantA, 'viewer');
  await makeMembership(adminB, tenantB, 'admin');

  f = {
    tenantA,
    tenantB,
    adminA,
    workspaceA: await makeWorkspace(tenantA, 'Kinh doanh', 'kinh-doanh'),
    workspaceB: await makeWorkspace(tenantB, 'Kế toán', 'ke-toan'),
    tokenAdminA: signTokenFor(adminA, tenantA, 'admin'),
    tokenCreatorA: signTokenFor(creatorA, tenantA, 'creator'),
    tokenViewerA: signTokenFor(viewerA, tenantA, 'viewer'),
    tokenAdminB: signTokenFor(adminB, tenantB, 'admin'),
  };
});

afterAll(async () => {
  await closeMysql();
  await closeRedis();
});

// ─── Tiện ích dựng file ──────────────────────────────────────────────────────

const CSV_SIMPLE = [
  'San pham,Khu vuc,Doanh thu',
  'Bàn,Hà Nội,1000',
  'Ghế,Hà Nội,500',
  'Bàn,Đà Nẵng,700',
  'Tủ,Hồ Chí Minh,1200',
].join('\n');

/** Chữ ký ZIP — mọi file .xlsx bắt đầu bằng bốn byte này. */
const ZIP_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/**
 * Đi hết bước 1: xin URL rồi mô phỏng trình duyệt đã tải file lên xong.
 *
 * Trả về id dataset. Khoá S3 lấy TỪ DATABASE chứ không phải từ phản hồi API —
 * chính vì API không trả nó về, và đó là điều một bài test dưới đây khẳng định.
 */
async function upload(
  token: string,
  filename: string,
  content: Buffer | string,
  workspaceId?: number,
): Promise<number> {
  const res = await request(app)
    .post('/api/v1/datasets/uploads')
    .set(bearer(token))
    .send({ workspaceId: workspaceId ?? f.workspaceA, filename });

  expect(res.status, JSON.stringify(res.body)).toBe(201);

  const datasetId = res.body.datasetId as number;
  const [rows] = await mysqlPool.query<RowDataPacket[]>(
    'SELECT s3_key FROM datasets WHERE id = ?',
    [datasetId],
  );
  const key = String(rows[0]?.['s3_key']);

  memoryStorage.putForTest(key, Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8'));
  return datasetId;
}

/** Đi hết bước 1 → 3, trả về dataset đã ở trạng thái `ready`. */
async function uploadAndCommit(token: string, content = CSV_SIMPLE): Promise<number> {
  const datasetId = await upload(token, 'doanh-thu.csv', content);

  const analyzed = await request(app)
    .post(`/api/v1/datasets/${datasetId}/analyze`)
    .set(bearer(token));
  expect(analyzed.status, JSON.stringify(analyzed.body)).toBe(200);

  const sheet = analyzed.body.sheets[0];
  const commit = await request(app)
    .post(`/api/v1/datasets/${datasetId}/commit`)
    .set(bearer(token))
    .send({ name: 'Doanh thu quý 4', sheets: [sheet.name] });
  expect(commit.status, JSON.stringify(commit.body)).toBe(200);

  return datasetId;
}

/** Chốt nhiều sheet một lúc, trả về danh sách bộ dữ liệu đã tạo. */
async function commitSheets(
  token: string,
  datasetId: number,
  sheets: string[],
  name = 'Bộ dữ liệu',
): Promise<{ id: number; sheetName: string; name: string }[]> {
  const res = await request(app)
    .post(`/api/v1/datasets/${datasetId}/commit`)
    .set(bearer(token))
    .send({ name, sheets });
  expect(res.status, JSON.stringify(res.body)).toBe(200);

  return res.body.map((d: { dataset: { id: number; sheetName: string; name: string } }) => ({
    id: d.dataset.id,
    sheetName: d.dataset.sheetName,
    name: d.dataset.name,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────

describe('§7.8 phân quyền theo bảng route', () => {
  type Method = 'get' | 'post' | 'patch' | 'delete';

  /** Route GHI: viewer phải bị chặn ở mọi cái. */
  const WRITE_ROUTES: [Method, string][] = [
    ['post', '/api/v1/datasets/uploads'],
    ['post', '/api/v1/datasets/1/analyze'],
    ['post', '/api/v1/datasets/1/commit'],
    ['delete', '/api/v1/datasets/1'],
    ['post', '/api/v1/reports'],
    ['patch', '/api/v1/reports/1'],
    ['delete', '/api/v1/reports/1'],
  ];

  const READ_ROUTES: [Method, string][] = [
    ['get', '/api/v1/datasets'],
    ['get', '/api/v1/reports'],
  ];

  function call(method: Method, path: string): request.Test {
    const agent = request(app);
    switch (method) {
      case 'get':
        return agent.get(path);
      case 'post':
        return agent.post(path);
      case 'patch':
        return agent.patch(path);
      case 'delete':
        return agent.delete(path);
    }
  }

  // Chạy theo BẢNG chứ không viết tay từng ca: route mới thêm mà quên gắn
  // `authorize` sẽ tự động làm đỏ, không cần ai nhớ bổ sung.
  it.each([...WRITE_ROUTES, ...READ_ROUTES])('không token: %s %s -> 401', async (method, path) => {
    const res = await call(method, path).send({});
    expect(res.status).toBe(401);
  });

  it.each(WRITE_ROUTES)('viewer: %s %s -> 403', async (method, path) => {
    const res = await call(method, path).set(bearer(f.tokenViewerA)).send({});
    expect(res.status).toBe(403);
  });

  it.each(READ_ROUTES)('viewer ĐỌC được: %s %s', async (method, path) => {
    const res = await call(method, path)
      .query({ workspaceId: f.workspaceA })
      .set(bearer(f.tokenViewerA));
    expect(res.status).toBe(200);
  });

  it('creator tạo và XOÁ được bộ dữ liệu', async () => {
    // §7.8 nói "Creator trở lên mới tạo/xoá". Migration 4 chỉ cho creator
    // read+modify, nên migration 6 phải thêm dòng `dataset:delete` — ca này là
    // thứ khẳng định dòng đó có thật trong database.
    const datasetId = await uploadAndCommit(f.tokenCreatorA);

    const res = await request(app)
      .delete(`/api/v1/datasets/${datasetId}`)
      .set(bearer(f.tokenCreatorA));
    expect(res.status).toBe(204);
  });
});

describe('cách ly tổ chức', () => {
  it('bộ dữ liệu của tổ chức khác -> 404 ở mọi route', async () => {
    const datasetId = await uploadAndCommit(f.tokenAdminA);

    // 404 chứ KHÔNG phải 403: 403 xác nhận rằng id đó có tồn tại.
    for (const res of [
      await request(app).get(`/api/v1/datasets/${datasetId}`).set(bearer(f.tokenAdminB)),
      await request(app).post(`/api/v1/datasets/${datasetId}/analyze`).set(bearer(f.tokenAdminB)),
      await request(app).delete(`/api/v1/datasets/${datasetId}`).set(bearer(f.tokenAdminB)),
    ]) {
      expect(res.status).toBe(404);
    }
  });

  it('báo cáo của tổ chức khác -> 404, kể cả route dữ liệu', async () => {
    const reportId = await createReport(f.tokenAdminA, await uploadAndCommit(f.tokenAdminA));

    for (const res of [
      await request(app).get(`/api/v1/reports/${reportId}`).set(bearer(f.tokenAdminB)),
      await request(app).get(`/api/v1/reports/${reportId}/data`).set(bearer(f.tokenAdminB)),
      await request(app).delete(`/api/v1/reports/${reportId}`).set(bearer(f.tokenAdminB)),
    ]) {
      expect(res.status).toBe(404);
    }
  });

  it('danh sách chỉ có bộ dữ liệu của workspace mình', async () => {
    await uploadAndCommit(f.tokenAdminA);

    const res = await request(app)
      .get('/api/v1/datasets')
      .query({ workspaceId: f.workspaceB })
      .set(bearer(f.tokenAdminB));

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
  });

  it('trỏ workspaceId sang tổ chức khác -> 404', async () => {
    const res = await request(app)
      .post('/api/v1/datasets/uploads')
      .set(bearer(f.tokenAdminA))
      .send({ workspaceId: f.workspaceB, filename: 'a.csv' });

    expect(res.status).toBe(404);
  });
});

describe('§7.4 khoá lưu trữ do SERVER sinh', () => {
  it('khoá client thấy được luôn nằm trong phạm vi tổ chức của chính họ', async () => {
    // Presigned URL BẮT BUỘC chứa khoá trong đường dẫn — đó là cách nó hoạt
    // động, và client cũng cần biết khoá của chính mình để PUT vào đó. Nên
    // "giấu khoá" không phải là điều đang bảo vệ hệ thống.
    //
    // Thứ bảo vệ là: khoá do server sinh, mang tiền tố tổ chức của người gọi, và
    // phần định danh là UUID ngẫu nhiên. Biết khoá của mình không giúp đoán được
    // khoá của người khác, và presigned URL chỉ có hiệu lực cho đúng một khoá.
    const res = await request(app)
      .post('/api/v1/datasets/uploads')
      .set(bearer(f.tokenAdminA))
      .send({ workspaceId: f.workspaceA, filename: 'bao-cao.csv' });

    expect(res.status).toBe(201);
    expect(res.body.uploadUrl).toContain(`t${f.tenantA}/w${f.workspaceA}/`);
    expect(res.body.uploadUrl).not.toContain(`t${f.tenantB}/`);

    // DTO không có trường khoá riêng: mọi thứ client cần đã nằm trong URL, và
    // thêm một trường nữa chỉ mời người ta gửi ngược nó lên ở bước sau.
    expect(res.body.key).toBeUndefined();
    expect(res.body.s3Key).toBeUndefined();
  });

  it('gửi kèm `key` tuỳ ý trong body KHÔNG có tác dụng', async () => {
    // Nếu lọt thì presigned URL sẽ cho phép ghi đè file của tổ chức khác — và
    // việc ghi đó diễn ra thẳng giữa trình duyệt và S3, không middleware nào
    // nhìn thấy.
    const res = await request(app)
      .post('/api/v1/datasets/uploads')
      .set(bearer(f.tokenAdminA))
      .send({
        workspaceId: f.workspaceA,
        filename: 'bao-cao.csv',
        key: 't999/w999/chiem-doat.csv',
        s3Key: 't999/w999/chiem-doat.csv',
      });

    expect(res.status).toBe(201);

    const [rows] = await mysqlPool.query<RowDataPacket[]>(
      'SELECT s3_key FROM datasets WHERE id = ?',
      [res.body.datasetId],
    );
    const key = String(rows[0]?.['s3_key']);
    expect(key).not.toContain('chiem-doat');
    expect(key).toMatch(new RegExp(`^t${f.tenantA}/w${f.workspaceA}/`));
  });

  it('đuôi file lạ bị từ chối ngay, không tạo bản ghi', async () => {
    const res = await request(app)
      .post('/api/v1/datasets/uploads')
      .set(bearer(f.tokenAdminA))
      .send({ workspaceId: f.workspaceA, filename: 'virus.exe' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('UnsupportedFormat');

    const [rows] = await mysqlPool.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM datasets');
    expect(Number(rows[0]?.['n'])).toBe(0);
  });

  it('.xls (định dạng cũ) bị từ chối rõ ràng, không bị coi là .xlsx', async () => {
    const res = await request(app)
      .post('/api/v1/datasets/uploads')
      .set(bearer(f.tokenAdminA))
      .send({ workspaceId: f.workspaceA, filename: 'bao-cao.xls' });

    expect(res.status).toBe(400);
  });
});

describe('§7.3 kiểm định dạng bằng magic bytes', () => {
  it('file .xlsx chứa nội dung text -> 400', async () => {
    // Kiểm bằng đuôi file là kiểm đúng thứ client vừa khai. Đổi tên một file bất
    // kỳ thành .xlsx mất hai giây; điều ngăn nó là bốn byte đầu.
    const datasetId = await upload(f.tokenAdminA, 'gia-mao.xlsx', 'day khong phai excel');

    const res = await request(app)
      .post(`/api/v1/datasets/${datasetId}/analyze`)
      .set(bearer(f.tokenAdminA));

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('UnsupportedFormat');
  });

  it('file .csv thật ra là Excel -> báo đúng chuyện gì xảy ra', async () => {
    const datasetId = await upload(f.tokenAdminA, 'thuc-ra-la-excel.csv', ZIP_HEADER);

    const res = await request(app)
      .post(`/api/v1/datasets/${datasetId}/analyze`)
      .set(bearer(f.tokenAdminA));

    expect(res.status).toBe(400);
    // Thông báo phải nói được người dùng cần làm gì, không phải "file hỏng".
    expect(res.body.message).toContain('.xlsx');
  });

  it('lý do hỏng được ghi lại vào bản ghi, không biến mất', async () => {
    const datasetId = await upload(f.tokenAdminA, 'gia-mao.xlsx', 'khong phai excel');
    await request(app).post(`/api/v1/datasets/${datasetId}/analyze`).set(bearer(f.tokenAdminA));

    const res = await request(app)
      .get(`/api/v1/datasets/${datasetId}`)
      .set(bearer(f.tokenAdminA));

    expect(res.body.dataset.status).toBe('failed');
    expect(res.body.dataset.errorMessage).toBeTruthy();
  });

  it('gọi analyze khi chưa tải file lên -> 409, không phải 500', async () => {
    const res = await request(app)
      .post('/api/v1/datasets/uploads')
      .set(bearer(f.tokenAdminA))
      .send({ workspaceId: f.workspaceA, filename: 'chua-tai.csv' });

    const analyzed = await request(app)
      .post(`/api/v1/datasets/${res.body.datasetId}/analyze`)
      .set(bearer(f.tokenAdminA));

    expect(analyzed.status).toBe(409);
    expect(analyzed.body.error).toBe('UploadNotFinished');
  });
});

describe('§7.5 đọc CSV khó', () => {
  it('dấu phẩy trong ngoặc kép không cắt nhầm cột', async () => {
    // Đây là toàn bộ lý do dùng papaparse thay vì `split(',')`.
    const csv = ['Ten,Dia chi,So', 'An,"Hà Nội, Việt Nam",10', 'Bình,"Huế, Việt Nam",20'].join('\n');
    const datasetId = await upload(f.tokenAdminA, 'dia-chi.csv', csv);

    const res = await request(app)
      .post(`/api/v1/datasets/${datasetId}/analyze`)
      .set(bearer(f.tokenAdminA));

    expect(res.status).toBe(200);
    expect(res.body.sheets[0].columns).toHaveLength(3);
    expect(res.body.sheets[0].previewRows[0][1]).toBe('Hà Nội, Việt Nam');
  });

  it('BOM UTF-8 không dính vào tên cột đầu tiên', async () => {
    // Excel thêm BOM vào mọi file CSV nó xuất ra. Không bỏ thì tên cột mang theo
    // một ký tự vô hình và mọi phép so sánh với 'Ngày' đều sai.
    const csv = '﻿Ngày,Doanh thu\n2024-01-15,1000';
    const datasetId = await upload(f.tokenAdminA, 'co-bom.csv', csv);

    const res = await request(app)
      .post(`/api/v1/datasets/${datasetId}/analyze`)
      .set(bearer(f.tokenAdminA));

    expect(res.body.sheets[0].columns[0].sourceName).toBe('Ngày');
  });

  it('dấu chấm phẩy làm dấu phân cách (Excel vùng châu Âu)', async () => {
    const csv = 'San pham;Doanh thu\nBàn;1000\nGhế;500';
    const datasetId = await upload(f.tokenAdminA, 'cham-phay.csv', csv);

    const res = await request(app)
      .post(`/api/v1/datasets/${datasetId}/analyze`)
      .set(bearer(f.tokenAdminA));

    expect(res.body.sheets[0].columns).toHaveLength(2);
  });

  it('kiểu dữ liệu được đoán và trả kèm giá trị mẫu', async () => {
    const datasetId = await upload(f.tokenAdminA, 'doanh-thu.csv', CSV_SIMPLE);

    const res = await request(app)
      .post(`/api/v1/datasets/${datasetId}/analyze`)
      .set(bearer(f.tokenAdminA));

    const columns = res.body.sheets[0].columns;
    expect(columns[0].dataType).toBe('text');
    expect(columns[2].dataType).toBe('number');
    // Mẫu để người dùng đối chiếu bằng mắt xem đoán có đúng không.
    expect(columns[0].samples.length).toBeGreaterThan(0);
  });
});

describe('§7.5 chốt sheet và nạp dữ liệu', () => {
  it('không tích sheet nào -> 400', async () => {
    const datasetId = await upload(f.tokenAdminA, 'doanh-thu.csv', CSV_SIMPLE);
    await request(app).post(`/api/v1/datasets/${datasetId}/analyze`).set(bearer(f.tokenAdminA));

    const res = await request(app)
      .post(`/api/v1/datasets/${datasetId}/commit`)
      .set(bearer(f.tokenAdminA))
      .send({ name: 'Rỗng', sheets: [] });

    expect(res.status).toBe(400);
  });

  it('sheet không có trong file -> 400 nói rõ tên sheet', async () => {
    const datasetId = await upload(f.tokenAdminA, 'doanh-thu.csv', CSV_SIMPLE);
    await request(app).post(`/api/v1/datasets/${datasetId}/analyze`).set(bearer(f.tokenAdminA));

    const res = await request(app)
      .post(`/api/v1/datasets/${datasetId}/commit`)
      .set(bearer(f.tokenAdminA))
      .send({ name: 'Sai sheet', sheets: ['Khong Ton Tai'] });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('Khong Ton Tai');
  });

  it('MỌI cột đều được nhập, tên field suy từ tiêu đề', async () => {
    // Bản cập nhật của §7.5 bỏ hẳn bước chọn cột: không còn ô tích nào, nên mọi
    // cột phải có mặt trong dữ liệu.
    const datasetId = await upload(f.tokenAdminA, 'doanh-thu.csv', CSV_SIMPLE);
    await request(app).post(`/api/v1/datasets/${datasetId}/analyze`).set(bearer(f.tokenAdminA));
    await commitSheets(f.tokenAdminA, datasetId, ['Sheet1']);

    const [rows] = await mysqlPool.query<RowDataPacket[]>(
      'SELECT data FROM dataset_rows WHERE dataset_id = ? ORDER BY row_index LIMIT 1',
      [datasetId],
    );
    const data = rows[0]?.['data'] as Record<string, unknown>;
    const parsed = typeof data === 'string' ? JSON.parse(data) : data;

    // `toEqual` trên mảng khoá sẽ SAI: MySQL không giữ thứ tự khoá của cột JSON,
    // nó sắp lại theo ĐỘ DÀI khoá rồi mới tới thứ tự byte. Ở đây `Khu vuc` (7 ký
    // tự) nhảy lên trước `San pham` (8).
    //
    // Vô hại với ứng dụng: thứ tự cột hiển thị lấy từ `dataset_columns.column_index`,
    // không phải từ thứ tự khoá JSON. Nhưng người viết truy vấn sau này cần biết
    // để không bao giờ dựa vào thứ tự đó.
    expect(Object.keys(parsed).sort()).toEqual(['Doanh thu', 'Khu vuc', 'San pham']);
    expect(parsed['San pham']).toBe('Bàn');
    // Cột số lưu thành SỐ, không phải chuỗi: `'10' > '9'` là false trong so sánh
    // chuỗi, nên mọi phép sắp xếp và min/max sẽ sai theo cách trông rất hợp lý.
    expect(parsed['Doanh thu']).toBe(1000);
  });

  it('cột trùng tên được đánh số, không đè lên nhau', async () => {
    // Khoá của document JSON là tên field. Hai cột cùng tên thì cột sau đè cột
    // trước và dữ liệu biến mất trong im lặng — file thật rất hay có hai cột
    // "Ghi chú".
    const csv = ['Ten,Ghi chu,Ghi chu', 'An,mot,hai'].join('\n');
    const datasetId = await upload(f.tokenAdminA, 'trung-ten.csv', csv);
    await request(app).post(`/api/v1/datasets/${datasetId}/analyze`).set(bearer(f.tokenAdminA));
    await commitSheets(f.tokenAdminA, datasetId, ['Sheet1']);

    const [rows] = await mysqlPool.query<RowDataPacket[]>(
      'SELECT data FROM dataset_rows WHERE dataset_id = ? LIMIT 1',
      [datasetId],
    );
    const data = rows[0]?.['data'] as Record<string, unknown>;
    const parsed = typeof data === 'string' ? JSON.parse(data) : data;

    // Sắp lại trước khi so: MySQL không giữ thứ tự khoá của cột JSON.
    expect(Object.keys(parsed).sort()).toEqual(['Ghi chu', 'Ghi chu (2)', 'Ten']);
    expect(parsed['Ghi chu']).toBe('mot');
    expect(parsed['Ghi chu (2)']).toBe('hai');
  });

  it('chỉ bản ghi `ready` hiện trong danh sách', async () => {
    // Bản ghi `pending` là rác của những lần đóng wizard giữa chừng.
    await request(app)
      .post('/api/v1/datasets/uploads')
      .set(bearer(f.tokenAdminA))
      .send({ workspaceId: f.workspaceA, filename: 'bo-do.csv' });

    await uploadAndCommit(f.tokenAdminA);

    const res = await request(app)
      .get('/api/v1/datasets')
      .query({ workspaceId: f.workspaceA })
      .set(bearer(f.tokenAdminA));

    expect(res.body.total).toBe(1);
    expect(res.body.items[0].status).toBe('ready');
  });
});

describe('trần số dòng', () => {
  it('file vượt trần bị cắt và ĐƯỢC ĐÁNH DẤU', async () => {
    // Cắt âm thầm rồi để người ta tin vào một biểu đồ thiếu chín phần mười dữ
    // liệu là kiểu sai tệ nhất trong sản phẩm BI. `rowCount` một mình nói dối,
    // nên phải có cờ `truncated` đi kèm.
    //
    // `DATASET_MAX_ROWS` trong `vitest.integration.config.ts` hạ xuống 100 để ca
    // này không phải dựng một file nửa triệu dòng.
    const lines = ['San pham,Doanh thu'];
    for (let i = 0; i < 150; i += 1) lines.push(`SP${i},${i * 10}`);

    const datasetId = await upload(f.tokenAdminA, 'nhieu-dong.csv', lines.join('\n'));
    const analyzed = await request(app)
      .post(`/api/v1/datasets/${datasetId}/analyze`)
      .set(bearer(f.tokenAdminA));

    expect(analyzed.body.truncated).toBe(true);
    expect(analyzed.body.sheets[0].rowCount).toBe(100);

    await commitSheets(f.tokenAdminA, datasetId, [analyzed.body.sheets[0].name], 'Bị cắt');

    const res = await request(app)
      .get(`/api/v1/datasets/${datasetId}`)
      .set(bearer(f.tokenAdminA));

    expect(res.body.dataset.rowCount).toBe(100);
    expect(res.body.dataset.truncated).toBe(true);
  });

  it('xem trước tối đa 100 dòng, nhưng NHẬP đủ số dòng', async () => {
    // Hai con số khác nhau và giao diện phải nói rõ. Người dùng thấy 100 rồi tin
    // rằng hệ thống chỉ nhập chừng đó là hiểu nhầm rất dễ xảy ra.
    const lines = ['San pham,Doanh thu'];
    for (let i = 0; i < 60; i += 1) lines.push(`SP${i},${i * 10}`);

    const datasetId = await upload(f.tokenAdminA, 'sau-muoi-dong.csv', lines.join('\n'));
    const analyzed = await request(app)
      .post(`/api/v1/datasets/${datasetId}/analyze`)
      .set(bearer(f.tokenAdminA));

    expect(analyzed.body.previewRowLimit).toBe(100);
    expect(analyzed.body.sheets[0].rowCount).toBe(60);
    expect(analyzed.body.sheets[0].previewRows.length).toBe(60);

    await commitSheets(f.tokenAdminA, datasetId, ['Sheet1']);
    const res = await request(app)
      .get(`/api/v1/datasets/${datasetId}`)
      .set(bearer(f.tokenAdminA));

    expect(res.body.dataset.rowCount).toBe(60);
    expect(res.body.dataset.truncated).toBe(false);
  });
});

describe('§7.5 mỗi sheet là MỘT bộ dữ liệu riêng', () => {
  /** File Excel ba sheet, mỗi sheet một hình dạng khác nhau. */
  async function makeWorkbook(): Promise<Buffer> {
    const ExcelJS = await import('exceljs');
    const wb = new ExcelJS.default.Workbook();

    const s1 = wb.addWorksheet('Doanh thu');
    s1.addRow(['San pham', 'Doanh thu']);
    s1.addRow(['Bàn', 1000]);
    s1.addRow(['Ghế', 500]);

    const s2 = wb.addWorksheet('Chi phi');
    s2.addRow(['Khoan muc', 'So tien', 'Ghi chu']);
    s2.addRow(['Thuê nhà', 300, 'thang 1']);

    const s3 = wb.addWorksheet('Nhan su');
    s3.addRow(['Ho ten', 'Ma NV']);
    s3.addRow(['Nguyễn An', '0012']);

    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  async function uploadWorkbook(): Promise<number> {
    const datasetId = await upload(f.tokenAdminA, 'bao-cao.xlsx', await makeWorkbook());
    const analyzed = await request(app)
      .post(`/api/v1/datasets/${datasetId}/analyze`)
      .set(bearer(f.tokenAdminA));
    expect(analyzed.status, JSON.stringify(analyzed.body)).toBe(200);
    return datasetId;
  }

  it('phân tích trả về đủ mọi sheet kèm số cột và số dòng', async () => {
    const datasetId = await upload(f.tokenAdminA, 'bao-cao.xlsx', await makeWorkbook());
    const res = await request(app)
      .post(`/api/v1/datasets/${datasetId}/analyze`)
      .set(bearer(f.tokenAdminA));

    expect(res.status).toBe(200);
    expect(res.body.sheets.map((s: { name: string }) => s.name)).toEqual([
      'Doanh thu',
      'Chi phi',
      'Nhan su',
    ]);
    // Đây là ba con số của dòng "X cột · Y dòng · đang xem N dòng đầu".
    expect(res.body.sheets[1].columns).toHaveLength(3);
    expect(res.body.sheets[1].rowCount).toBe(1);
  });

  it('tích 2 sheet -> 2 bộ dữ liệu, dùng CHUNG một file trên S3', async () => {
    // Đây là điều migration 7 mở ra: bỏ ràng buộc UNIQUE trên `s3_key`.
    const datasetId = await uploadWorkbook();
    const created = await commitSheets(
      f.tokenAdminA,
      datasetId,
      ['Doanh thu', 'Nhan su'],
      'Báo cáo quý 4',
    );

    expect(created).toHaveLength(2);
    // Bản ghi `pending` được DÙNG LẠI cho sheet đầu, không bỏ lại làm rác.
    expect(created[0]?.id).toBe(datasetId);

    const [rows] = await mysqlPool.query<RowDataPacket[]>(
      'SELECT s3_key FROM datasets WHERE id IN (?, ?)',
      [created[0]?.id, created[1]?.id],
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]?.['s3_key']).toBe(rows[1]?.['s3_key']);
  });

  it('MỌI bộ dữ liệu giữ đúng tên file gốc, không phải tên sheet', async () => {
    // Lỗi đã xảy ra: bộ dữ liệu thứ hai trở đi lấy tên SHEET làm tên file, nên
    // cột "File gốc" ở §7.8 hiện "Nhan su" thay vì "bao-cao.xlsx" — người dùng
    // không còn biết mình đã tải cái gì lên.
    const datasetId = await uploadWorkbook();
    const created = await commitSheets(f.tokenAdminA, datasetId, ['Doanh thu', 'Nhan su']);

    for (const item of created) {
      const res = await request(app)
        .get(`/api/v1/datasets/${item.id}`)
        .set(bearer(f.tokenAdminA));
      expect(res.body.dataset.originalFilename).toBe('bao-cao.xlsx');
      expect(res.body.dataset.fileExt).toBe('xlsx');
    }
  });

  it('nhiều sheet thì tên được nối thêm tên sheet cho phân biệt', async () => {
    const datasetId = await uploadWorkbook();
    const created = await commitSheets(
      f.tokenAdminA,
      datasetId,
      ['Doanh thu', 'Chi phi'],
      'Báo cáo quý 4',
    );

    expect(created.map((d) => d.name)).toEqual([
      'Báo cáo quý 4 · Doanh thu',
      'Báo cáo quý 4 · Chi phi',
    ]);
  });

  it('một sheet thì giữ nguyên tên người dùng đặt', async () => {
    const datasetId = await uploadWorkbook();
    const created = await commitSheets(f.tokenAdminA, datasetId, ['Doanh thu'], 'Báo cáo quý 4');

    expect(created[0]?.name).toBe('Báo cáo quý 4');
  });

  it('mỗi bộ dữ liệu giữ đúng cột và dòng của sheet mình', async () => {
    const datasetId = await uploadWorkbook();
    const created = await commitSheets(f.tokenAdminA, datasetId, ['Doanh thu', 'Nhan su']);

    const first = await request(app)
      .get(`/api/v1/datasets/${created[0]?.id}`)
      .set(bearer(f.tokenAdminA));
    const second = await request(app)
      .get(`/api/v1/datasets/${created[1]?.id}`)
      .set(bearer(f.tokenAdminA));

    expect(first.body.columns.map((c: { fieldName: string }) => c.fieldName)).toEqual([
      'San pham',
      'Doanh thu',
    ]);
    expect(second.body.columns.map((c: { fieldName: string }) => c.fieldName)).toEqual([
      'Ho ten',
      'Ma NV',
    ]);

    // Mã nhân viên `0012` phải là CHỮ. Đây là quy tắc giữ số 0 đầu, kiểm trên
    // đường đi thật chứ không chỉ ở test đơn vị.
    const maNv = second.body.columns.find((c: { fieldName: string }) => c.fieldName === 'Ma NV');
    expect(maNv.dataType).toBe('text');
  });

  it('cả lô nạp trong MỘT transaction — hỏng một sheet thì không sheet nào vào', async () => {
    // Sheet thứ hai không tồn tại. Không có transaction chung thì sheet đầu đã
    // `ready` còn người dùng nhận lỗi và tin rằng chưa có gì được tạo.
    const datasetId = await uploadWorkbook();

    const res = await request(app)
      .post(`/api/v1/datasets/${datasetId}/commit`)
      .set(bearer(f.tokenAdminA))
      .send({ name: 'Nửa chừng', sheets: ['Doanh thu', 'Khong Ton Tai'] });

    expect(res.status).toBe(400);

    const list = await request(app)
      .get('/api/v1/datasets')
      .query({ workspaceId: f.workspaceA })
      .set(bearer(f.tokenAdminA));
    expect(list.body.total).toBe(0);
  });

  it('quá 50 sheet một lần -> 400', async () => {
    const datasetId = await uploadWorkbook();
    const res = await request(app)
      .post(`/api/v1/datasets/${datasetId}/commit`)
      .set(bearer(f.tokenAdminA))
      .send({ name: 'Quá nhiều', sheets: Array.from({ length: 51 }, (_, i) => `S${i}`) });

    expect(res.status).toBe(400);
  });
});

// ─── Báo cáo ─────────────────────────────────────────────────────────────────

/** Tạo báo cáo RỖNG — đúng thứ §7.6 mô tả. */
async function createReport(token: string, datasetId: number): Promise<number> {
  const res = await request(app)
    .post('/api/v1/reports')
    .set(bearer(token))
    .send({ datasetId, name: 'Doanh thu theo sản phẩm' });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as number;
}

/** Dựng biểu đồ cho một báo cáo — việc người dùng làm trên trang Report. */
async function configureReport(
  token: string,
  reportId: number,
  body: Record<string, unknown>,
): Promise<request.Response> {
  return request(app).patch(`/api/v1/reports/${reportId}`).set(bearer(token)).send(body);
}

describe('§7.6 báo cáo được tạo RỖNG', () => {
  it('tạo xong thì CHƯA có biểu đồ, chưa có cấu hình', async () => {
    // Bản trước tự đoán trục rồi vẽ luôn một biểu đồ cột. Nó chạy được, nhưng
    // trả lời hộ một câu hỏi chưa ai đặt ra — và một cấu hình đoán bừa trông y
    // hệt một cấu hình người dùng đã chọn.
    const datasetId = await uploadAndCommit(f.tokenAdminA);
    const reportId = await createReport(f.tokenAdminA, datasetId);

    const res = await request(app)
      .get(`/api/v1/reports/${reportId}`)
      .set(bearer(f.tokenAdminA));

    expect(res.status).toBe(200);
    expect(res.body.chartType).toBeNull();
    expect(res.body.config).toBeNull();
    expect(res.body.datasetId).toBe(datasetId);
  });

  it('gửi kèm chartType/config lúc TẠO thì bị bỏ qua', async () => {
    // Schema cố ý không nhận hai trường đó. Nếu lọt thì cánh cửa vừa đóng lại
    // mở ra: wizard đoán hộ người dùng.
    const datasetId = await uploadAndCommit(f.tokenAdminA);

    const created = await request(app)
      .post('/api/v1/reports')
      .set(bearer(f.tokenAdminA))
      .send({
        datasetId,
        name: 'Cố tình gửi thêm',
        chartType: 'pie',
        config: { dimension: 'San pham', measure: 'Doanh thu', aggregate: 'sum', limit: 20 },
      });

    expect(created.status).toBe(201);
    expect(created.body.chartType).toBeNull();
    expect(created.body.config).toBeNull();
  });

  it('đọc dữ liệu của báo cáo chưa dựng biểu đồ -> 409 với mã riêng', async () => {
    // KHÔNG phải lỗi: đây là trạng thái mọi báo cáo đi qua. Mã riêng để giao
    // diện hiện lời mời dựng biểu đồ thay vì màn hình lỗi đỏ.
    const datasetId = await uploadAndCommit(f.tokenAdminA);
    const reportId = await createReport(f.tokenAdminA, datasetId);

    const res = await request(app)
      .get(`/api/v1/reports/${reportId}/data`)
      .set(bearer(f.tokenAdminA));

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('ReportNotConfigured');
  });

  it('đầu-cuối: dựng biểu đồ rồi mới có dữ liệu', async () => {
    // Bàn xuất hiện hai lần (1000 + 700).
    const datasetId = await uploadAndCommit(f.tokenAdminA);
    const reportId = await createReport(f.tokenAdminA, datasetId);

    const configured = await configureReport(f.tokenAdminA, reportId, {
      name: 'Doanh thu theo sản phẩm',
      chartType: 'bar',
      config: { dimension: 'San pham', measure: 'Doanh thu', aggregate: 'sum', limit: 20 },
    });
    expect(configured.status, JSON.stringify(configured.body)).toBe(200);
    expect(configured.body.chartType).toBe('bar');

    const res = await request(app)
      .get(`/api/v1/reports/${reportId}/data`)
      .set(bearer(f.tokenAdminA));

    expect(res.status).toBe(200);
    const byLabel = Object.fromEntries(
      res.body.rows.map((r: { label: string; value: number }) => [r.label, r.value]),
    );
    expect(byLabel['Bàn']).toBe(1700);
    expect(byLabel['Ghế']).toBe(500);
    expect(byLabel['Tủ']).toBe(1200);

    // Nhãn trục nói bằng ngôn ngữ người dùng, không phải tên cột kỹ thuật.
    expect(res.body.measureLabel).toContain('Doanh thu');
  });

  it('cấu hình trỏ vào cột không tồn tại -> 400', async () => {
    // zod chỉ kiểm được hình dạng. Một chuỗi không khớp cột nào sẽ cho ra biểu
    // đồ toàn nhãn "(trống)" — một báo cáo trông chạy được mà không có dữ liệu.
    const datasetId = await uploadAndCommit(f.tokenAdminA);
    const reportId = await createReport(f.tokenAdminA, datasetId);

    const res = await configureReport(f.tokenAdminA, reportId, {
      name: 'Sai cột',
      chartType: 'bar',
      config: { dimension: 'Cot khong ton tai', measure: null, aggregate: 'count', limit: 20 },
    });

    expect(res.status).toBe(400);
  });

  it('phép tổng hợp khác count mà thiếu cột đo -> 400', async () => {
    const datasetId = await uploadAndCommit(f.tokenAdminA);
    const reportId = await createReport(f.tokenAdminA, datasetId);

    const res = await configureReport(f.tokenAdminA, reportId, {
      name: 'Thiếu cột đo',
      chartType: 'bar',
      config: { dimension: 'San pham', measure: null, aggregate: 'sum', limit: 20 },
    });

    expect(res.status).toBe(400);
  });

  it('dựng báo cáo trên bộ dữ liệu chưa nhập xong -> 409', async () => {
    const res = await request(app)
      .post('/api/v1/datasets/uploads')
      .set(bearer(f.tokenAdminA))
      .send({ workspaceId: f.workspaceA, filename: 'chua-xong.csv' });

    const created = await request(app)
      .post('/api/v1/reports')
      .set(bearer(f.tokenAdminA))
      .send({ datasetId: res.body.datasetId, name: 'Quá sớm' });

    expect(created.status).toBe(409);
    expect(created.body.error).toBe('DatasetNotReady');
  });

  it('xoá bộ dữ liệu còn báo cáo -> 409, không xoá lan', async () => {
    const datasetId = await uploadAndCommit(f.tokenAdminA);
    await createReport(f.tokenAdminA, datasetId);

    const res = await request(app)
      .delete(`/api/v1/datasets/${datasetId}`)
      .set(bearer(f.tokenAdminA));

    expect(res.status).toBe(409);
    expect(res.body.message).toContain('1');
  });

  it('xoá báo cáo rồi thì xoá được bộ dữ liệu', async () => {
    const datasetId = await uploadAndCommit(f.tokenAdminA);
    const reportId = await createReport(f.tokenAdminA, datasetId);

    expect(
      (await request(app).delete(`/api/v1/reports/${reportId}`).set(bearer(f.tokenAdminA))).status,
    ).toBe(204);
    expect(
      (await request(app).delete(`/api/v1/datasets/${datasetId}`).set(bearer(f.tokenAdminA))).status,
    ).toBe(204);
  });

  it('phép đếm không cần cột đo', async () => {
    const datasetId = await uploadAndCommit(f.tokenAdminA);
    const reportId = await createReport(f.tokenAdminA, datasetId);

    const configured = await configureReport(f.tokenAdminA, reportId, {
      name: 'Số dòng theo khu vực',
      chartType: 'pie',
      config: { dimension: 'Khu vuc', measure: null, aggregate: 'count', limit: 20 },
    });
    expect(configured.status, JSON.stringify(configured.body)).toBe(200);

    const data = await request(app)
      .get(`/api/v1/reports/${reportId}/data`)
      .set(bearer(f.tokenAdminA));

    const byLabel = Object.fromEntries(
      data.body.rows.map((r: { label: string; value: number }) => [r.label, r.value]),
    );
    expect(byLabel['Hà Nội']).toBe(2);
    expect(data.body.measureLabel).toBe('Số dòng');
  });

  it('bộ dữ liệu bị xoá mềm thì báo cáo của nó biến khỏi danh sách', async () => {
    const datasetId = await uploadAndCommit(f.tokenAdminA);
    const reportId = await createReport(f.tokenAdminA, datasetId);

    // Xoá thẳng bằng SQL: qua API sẽ bị chặn bởi luật "còn báo cáo". Ở đây ta
    // đang kiểm nhánh phòng thủ của truy vấn danh sách, không phải luật kia.
    await mysqlPool.query('UPDATE datasets SET deleted_at = CURRENT_TIMESTAMP(3) WHERE id = ?', [
      datasetId,
    ]);

    const res = await request(app)
      .get('/api/v1/reports')
      .query({ workspaceId: f.workspaceA })
      .set(bearer(f.tokenAdminA));

    expect(res.body.total).toBe(0);
    expect(reportId).toBeGreaterThan(0);
  });
});
