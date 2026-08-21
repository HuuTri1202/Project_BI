import type { RowDataPacket } from 'mysql2';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
import { closeMysql, mysqlPool } from '../src/config/mysql';
import { closeRedis } from '../src/config/redis';
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
 * Test tích hợp tầng ngữ nghĩa — §10.
 *
 * Chạy: `npm run test:integration` — cần MySQL + Redis. KHÔNG cần ClickHouse
 * hay Cube.js: mọi ca ở đây dừng trước ranh giới đó.
 *
 * ─── Vì sao bộ dữ liệu được dựng bằng SQL thô ───────────────────────────────
 *
 * Tạo mô hình đòi bộ dữ liệu ở trạng thái `load_status = 'loaded'`, mà đưa một
 * bộ tới trạng thái đó qua API nghĩa là tải file lên MinIO rồi nạp vào
 * ClickHouse thật. Đi đường đó biến mọi ca ở đây thành ca của §7 và §9, và bắt
 * chúng đỏ mỗi khi một container chưa bật.
 *
 * Cái giá: những ca CHẠM tới ClickHouse (đọc cấu trúc cột lúc tạo mô hình) sẽ
 * hỏng ở tầng dưới. Nên bộ này kiểm đúng thứ kiểm được mà không cần kho — phân
 * quyền, cách ly tổ chức, và ràng buộc dữ liệu — còn phần đọc cấu trúc thật là
 * việc của kiểm chứng bằng trình duyệt ở cổng cuối.
 */

const app = createApp();

interface Fixture {
  tenantA: number;
  tenantB: number;
  workspaceA: number;
  workspaceB: number;
  datasetA: number;
  tokenAdminA: string;
  tokenCreatorA: string;
  tokenViewerA: string;
  tokenAdminB: string;
  modelA: number;
  modelB: number;
}

let f: Fixture;

/** Bộ dữ liệu đã nạp xong, dựng thẳng bằng SQL — xem ghi chú ở đầu file. */
async function makeLoadedDataset(
  tenantId: number,
  workspaceId: number,
  name: string,
): Promise<number> {
  const [result] = await mysqlPool.query<RowDataPacket[] & { insertId: number }>(
    `INSERT INTO datasets
       (tenant_id, source, workspace_id, name, original_filename, file_ext,
        status, load_status, column_count, row_count)
     VALUES (?, 'file', ?, ?, ?, 'csv', 'ready', 'loaded', 3, 10)`,
    [tenantId, workspaceId, name, `${name}.csv`],
  );
  return (result as unknown as { insertId: number }).insertId;
}

/** Mô hình dựng thẳng bằng SQL, bỏ qua bước đọc ClickHouse. */
async function makeModel(
  tenantId: number,
  workspaceId: number,
  name: string,
): Promise<number> {
  const [result] = await mysqlPool.query(
    'INSERT INTO datamodels (tenant_id, workspace_id, name) VALUES (?, ?, ?)',
    [tenantId, workspaceId, name],
  );
  return (result as unknown as { insertId: number }).insertId;
}

/**
 * Gắn một bảng kèm hai cột vào mô hình — cũng bằng SQL thô.
 *
 * Đi qua `POST /datamodels/:id/datasets` sẽ kéo theo một vòng đọc ClickHouse
 * (đó là nơi cấu trúc cột thật sự đến từ), và bộ test này cố ý chạy được khi
 * chưa có kho — xem ghi chú đầu file.
 */
async function attachDataset(
  tenantId: number,
  dataModelId: number,
  datasetId: number,
): Promise<{ refId: number; columnIds: number[] }> {
  const [ref] = await mysqlPool.query(
    'INSERT INTO datamodel_datasets (tenant_id, datamodel_id, dataset_id) VALUES (?, ?, ?)',
    [tenantId, dataModelId, datasetId],
  );
  const refId = (ref as unknown as { insertId: number }).insertId;

  const columnIds: number[] = [];
  for (const [ordinal, name] of ['ma_don', 'so_tien'].entries()) {
    const [col] = await mysqlPool.query(
      `INSERT INTO datamodel_columns
         (tenant_id, datamodel_dataset_id, column_name, role, ch_type, ordinal)
       VALUES (?, ?, ?, 'dimension', 'Nullable(String)', ?)`,
      [tenantId, refId, name, ordinal],
    );
    columnIds.push((col as unknown as { insertId: number }).insertId);
  }

  return { refId, columnIds };
}

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

  const workspaceA = await makeWorkspace(tenantA, 'Kinh doanh', 'kinh-doanh');
  const workspaceB = await makeWorkspace(tenantB, 'Kế toán', 'ke-toan');

  f = {
    tenantA,
    tenantB,
    workspaceA,
    workspaceB,
    datasetA: await makeLoadedDataset(tenantA, workspaceA, 'don-hang'),
    tokenAdminA: signTokenFor(adminA, tenantA, 'admin'),
    tokenCreatorA: signTokenFor(creatorA, tenantA, 'creator'),
    tokenViewerA: signTokenFor(viewerA, tenantA, 'viewer'),
    tokenAdminB: signTokenFor(adminB, tenantB, 'admin'),
    modelA: await makeModel(tenantA, workspaceA, 'Doanh thu 2026'),
    modelB: await makeModel(tenantB, workspaceB, 'Mô hình của B'),
  };
});

afterAll(async () => {
  await closeMysql();
  await closeRedis();
});

// ─────────────────────────────────────────────────────────────────────────────

describe('§10 phân quyền theo bảng route', () => {
  type Method = 'get' | 'post' | 'patch' | 'delete';

  /**
   * Mọi route viewer phải bị chặn.
   *
   * Từ migration 26 gồm cả hai đường ĐỌC. Mô hình dữ liệu là chỗ siết đáng giá
   * nhất: bên trong nó là Explorer, tức là khả năng tự đặt câu hỏi MỚI trên dữ
   * liệu — khác hẳn việc đọc lại một câu hỏi người khác đã chọn và chia sẻ.
   */
  const WRITE_ROUTES: [Method, string][] = [
    ['post', '/api/v1/datamodels'],
    ['patch', '/api/v1/datamodels/1'],
    ['delete', '/api/v1/datamodels/1'],
    ['post', '/api/v1/datamodels/1/datasets'],
    ['delete', '/api/v1/datamodels/1/datasets/1'],
    ['patch', '/api/v1/datamodels/1/layout'],
    ['get', '/api/v1/datamodels'],
    ['get', '/api/v1/datamodels/1'],
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

  // Theo BẢNG chứ không viết tay từng ca: route mới thêm mà quên gắn
  // `authorize` sẽ tự động làm đỏ, không cần ai nhớ bổ sung.
  it.each(WRITE_ROUTES)('không token: %s %s -> 401', async (method, path) => {
    const res = await call(method, path).send({});
    expect(res.status).toBe(401);
  });

  it.each(WRITE_ROUTES)('viewer: %s %s -> 403', async (method, path) => {
    const res = await call(method, path).set(bearer(f.tokenViewerA)).send({});
    expect(res.status).toBe(403);
  });

  it('creator ĐỌC được danh sách mô hình', async () => {
    // Ca này TỪNG là "viewer ĐỌC được". Đổi sang creator chứ không xoá đi: nếu
    // migration 26 quét quá tay và lấy luôn `datamodel:read` của creator thì
    // toàn bộ §10 tắt ngóm, mà mọi ca 403 ở trên vẫn xanh rờn.
    const res = await request(app).get('/api/v1/datamodels').set(bearer(f.tokenCreatorA));
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
  });

  it('creator XOÁ được mô hình', async () => {
    // §10 gieo `creator datamodel:delete` trong migration 10. Ca này là thứ
    // khẳng định dòng đó có thật trong database, không chỉ trong DEFAULT_POLICY.
    const res = await request(app)
      .delete(`/api/v1/datamodels/${f.modelA}`)
      .set(bearer(f.tokenCreatorA));
    expect(res.status).toBe(204);
  });
});

describe('§10 cách ly tổ chức', () => {
  it('mô hình của tổ chức khác -> 404 ở mọi route', async () => {
    const token = bearer(f.tokenAdminA);
    const id = f.modelB;

    expect((await request(app).get(`/api/v1/datamodels/${id}`).set(token)).status).toBe(404);
    expect(
      (await request(app).patch(`/api/v1/datamodels/${id}`).set(token).send({ name: 'Đổi' }))
        .status,
    ).toBe(404);
    expect((await request(app).delete(`/api/v1/datamodels/${id}`).set(token)).status).toBe(404);
    expect(
      (await request(app).patch(`/api/v1/datamodels/${id}/layout`).set(token).send({ positions: [] }))
        .status,
    ).toBe(404);
    // 404 chứ KHÔNG 403: 403 xác nhận rằng id đó có tồn tại, và một vòng lặp
    // thử id là một cách đếm số mô hình của tổ chức khác.
  });

  it('danh sách chỉ thấy mô hình của tổ chức mình', async () => {
    const a = await request(app).get('/api/v1/datamodels').set(bearer(f.tokenAdminA));
    const b = await request(app).get('/api/v1/datamodels').set(bearer(f.tokenAdminB));

    expect(a.body.items.map((m: { name: string }) => m.name)).toEqual(['Doanh thu 2026']);
    expect(b.body.items.map((m: { name: string }) => m.name)).toEqual(['Mô hình của B']);
  });

  /**
   * Cách ly theo workspace — đường đi mà giao diện thật sự dùng.
   *
   * Mỗi workspace có nội dung riêng: mô hình dựng ở workspace này KHÔNG được
   * hiện ở workspace khác. Đây là yêu cầu, không phải tác dụng phụ.
   *
   * ⚠️ Cách ly chỉ đúng nếu đường TẠO mô hình gửi `workspaceId` tường minh. Bỏ
   * trống thì backend chọn workspace đầu tiên theo TÊN, mô hình rơi nhầm chỗ, và
   * người dùng thấy nó biến mất ngay sau khi tạo. Chốt chặn cho việc đó nằm ở
   * TẦNG KIỂU chứ không phải ở đây: `CreateDataModelInput.workspaceId` là bắt
   * buộc, nên quên gửi là lỗi biên dịch. (Không kiểm bằng test tích hợp được vì
   * `POST /datamodels` đọc cấu trúc cột từ ClickHouse, mà bộ test này cố ý chạy
   * không cần kho — xem ghi chú đầu file.)
   */
  it('danh sách CHỈ thấy mô hình của workspace được gửi lên', async () => {
    const khac = await makeWorkspace(f.tenantA, 'Kho vận', 'kho-van');
    await makeModel(f.tenantA, khac, 'Mô hình ở workspace khác');

    const dangMo = await request(app)
      .get('/api/v1/datamodels')
      .query({ workspaceId: f.workspaceA })
      .set(bearer(f.tokenAdminA));
    const benKia = await request(app)
      .get('/api/v1/datamodels')
      .query({ workspaceId: khac })
      .set(bearer(f.tokenAdminA));

    expect(dangMo.body.items.map((m: { name: string }) => m.name)).toEqual(['Doanh thu 2026']);
    expect(benKia.body.items.map((m: { name: string }) => m.name)).toEqual([
      'Mô hình ở workspace khác',
    ]);
  });

  /**
   * Bỏ trống `workspaceId` = cả tổ chức.
   *
   * KHÔNG phải đường đi thường ngày — giao diện luôn gửi workspace đang mở.
   * Nhánh này chỉ phục vụ khung rỗng: khi workspace đang mở không có mô hình
   * nào, trang đếm xem còn mô hình ở workspace khác không để nói ra chỗ cần
   * tới, thay vì để một khung rỗng im lặng bị đọc thành mất dữ liệu.
   */
  it('không gửi workspaceId thì thấy cả tổ chức — phục vụ gợi ý ở khung rỗng', async () => {
    const khac = await makeWorkspace(f.tenantA, 'Kho vận', 'kho-van');
    await makeModel(f.tenantA, khac, 'Mô hình ở workspace khác');

    const res = await request(app).get('/api/v1/datamodels').set(bearer(f.tokenAdminA));

    expect(res.status).toBe(200);
    expect(res.body.items.map((m: { name: string }) => m.name).sort()).toEqual([
      'Doanh thu 2026',
      'Mô hình ở workspace khác',
    ]);
  });

  it('không tạo được mô hình trên bộ dữ liệu của tổ chức khác', async () => {
    const res = await request(app)
      .post('/api/v1/datamodels')
      .set(bearer(f.tokenAdminB))
      .send({ name: 'Trộm dữ liệu', datasetIds: [f.datasetA] });

    // Bộ dữ liệu thuộc tổ chức A; B không nhìn thấy nó nên là 404, và điều đó
    // xảy ra TRƯỚC bất kỳ lời gọi nào tới ClickHouse.
    expect(res.status).toBe(404);
  });
});

describe('§10 vòng đời mô hình', () => {
  it('đổi tên và xoá mềm', async () => {
    const token = bearer(f.tokenAdminA);

    const renamed = await request(app)
      .patch(`/api/v1/datamodels/${f.modelA}`)
      .set(token)
      .send({ name: 'Doanh thu quý 4', description: 'Bán hàng theo vùng' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe('Doanh thu quý 4');
    expect(renamed.body.description).toBe('Bán hàng theo vùng');

    expect((await request(app).delete(`/api/v1/datamodels/${f.modelA}`).set(token)).status).toBe(
      204,
    );
    expect((await request(app).get(`/api/v1/datamodels/${f.modelA}`).set(token)).status).toBe(404);

    // Xoá MỀM: dòng vẫn còn, chỉ khuất khỏi mọi truy vấn.
    const [rows] = await mysqlPool.query<RowDataPacket[]>(
      'SELECT deleted_at FROM datamodels WHERE id = ?',
      [f.modelA],
    );
    expect(rows[0]?.['deleted_at']).not.toBeNull();
  });

  it('xoá rồi xoá lại -> 404, không phải 204 lần hai', async () => {
    const token = bearer(f.tokenAdminA);
    await request(app).delete(`/api/v1/datamodels/${f.modelA}`).set(token);
    expect((await request(app).delete(`/api/v1/datamodels/${f.modelA}`).set(token)).status).toBe(
      404,
    );
  });

  it('chi tiết trả về đủ bốn phần cho bốn tab', async () => {
    const res = await request(app)
      .get(`/api/v1/datamodels/${f.modelA}`)
      .set(bearer(f.tokenAdminA));

    expect(res.status).toBe(200);
    expect(res.body.datasets).toEqual([]);
    expect(res.body.measures).toEqual([]);
    expect(res.body.relationships).toEqual([]);
    expect(res.body.datasetCount).toBe(0);
  });

  it('tên rỗng và thiếu bộ dữ liệu đều bị từ chối', async () => {
    const token = bearer(f.tokenAdminA);

    const noName = await request(app)
      .post('/api/v1/datamodels')
      .set(token)
      .send({ name: '   ', datasetIds: [f.datasetA] });
    expect(noName.status).toBe(400);

    const noDataset = await request(app)
      .post('/api/v1/datamodels')
      .set(token)
      .send({ name: 'Mô hình rỗng', datasetIds: [] });
    expect(noDataset.status).toBe(400);
  });

  it('bộ dữ liệu CHƯA NẠP bị từ chối kèm tên bộ đó', async () => {
    // Chưa nạp thì chưa có bảng nào trong ClickHouse, nên không có cấu trúc nào
    // để dựng mô hình lên. Thông báo phải gọi tên bộ dữ liệu — người dùng vừa
    // tích nhiều ô và cần biết ô nào hỏng.
    const [result] = await mysqlPool.query(
      `INSERT INTO datasets
         (tenant_id, source, workspace_id, name, original_filename, file_ext, status, load_status)
       VALUES (?, 'file', ?, 'Chưa nạp', 'chua-nap.csv', 'csv', 'ready', 'idle')`,
      [f.tenantA, f.workspaceA],
    );
    const idleId = (result as unknown as { insertId: number }).insertId;

    const res = await request(app)
      .post('/api/v1/datamodels')
      .set(bearer(f.tokenAdminA))
      .send({ name: 'Mô hình mới', datasetIds: [idleId] });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('DatasetNotLoaded');
    expect(res.body.message).toContain('Chưa nạp');
  });

  /**
   * Khoá chính nghiệp vụ — §10.3.
   *
   * Đây là thứ tab Quan hệ dùng để điền sẵn cột nối, nên nó phải chịu đúng một
   * ràng buộc: cột khai làm khoá phải thuộc CHÍNH bảng đó. Khoá ngoại trong
   * database chỉ có một cột (xem migration 12), nên tầng ứng dụng là nơi duy
   * nhất chặn được một id lạ.
   */
  it('đặt khoá chính, sửa tên hiển thị và mô tả', async () => {
    const { refId, columnIds } = await attachDataset(f.tenantA, f.modelA, f.datasetA);
    const token = bearer(f.tokenAdminA);

    const res = await request(app)
      .patch(`/api/v1/datamodels/${f.modelA}/datasets/${refId}`)
      .set(token)
      .send({ displayName: 'Đơn hàng', description: 'Mỗi dòng một mặt hàng' });
    expect(res.status).toBe(200);

    const withKey = await request(app)
      .patch(`/api/v1/datamodels/${f.modelA}/datasets/${refId}`)
      .set(token)
      .send({ primaryColumnId: columnIds[0] });
    expect(withKey.status).toBe(200);

    const dataset = withKey.body.dataModel.datasets[0];
    expect(dataset.displayName).toBe('Đơn hàng');
    expect(dataset.description).toBe('Mỗi dòng một mặt hàng');
    expect(dataset.primaryColumnId).toBe(columnIds[0]);
    expect(dataset.primaryColumnName).toBe('ma_don');
  });

  it('gửi thiếu trường thì GIỮ NGUYÊN giá trị cũ, không xoá trắng', async () => {
    // Hai hộp thoại gửi hai tập trường khác nhau. Ghi đè cả ba bằng giá trị nhận
    // được sẽ khiến "Đặt khoá chính" lặng lẽ xoá mất mô tả người dùng vừa viết.
    const { refId, columnIds } = await attachDataset(f.tenantA, f.modelA, f.datasetA);
    const token = bearer(f.tokenAdminA);

    await request(app)
      .patch(`/api/v1/datamodels/${f.modelA}/datasets/${refId}`)
      .set(token)
      .send({ displayName: 'Đơn hàng', description: 'Mô tả gốc' });

    const res = await request(app)
      .patch(`/api/v1/datamodels/${f.modelA}/datasets/${refId}`)
      .set(token)
      .send({ primaryColumnId: columnIds[1] });

    const dataset = res.body.dataModel.datasets[0];
    expect(dataset.displayName).toBe('Đơn hàng');
    expect(dataset.description).toBe('Mô tả gốc');
    expect(dataset.primaryColumnName).toBe('so_tien');
  });

  it('cột khoá của bảng KHÁC -> 400', async () => {
    const a = await attachDataset(f.tenantA, f.modelA, f.datasetA);
    const khac = await makeLoadedDataset(f.tenantA, f.workspaceA, 'kho-hang');
    const b = await attachDataset(f.tenantA, f.modelA, khac);

    const res = await request(app)
      .patch(`/api/v1/datamodels/${f.modelA}/datasets/${a.refId}`)
      .set(bearer(f.tokenAdminA))
      .send({ primaryColumnId: b.columnIds[0] });

    expect(res.status).toBe(400);
  });

  it('sắp xếp theo cột không hợp lệ -> 400 kèm danh sách cột nhận được', async () => {
    const res = await request(app)
      .get('/api/v1/datamodels?sort=; DROP TABLE datamodels')
      .set(bearer(f.tokenAdminA));

    expect(res.status).toBe(400);
    expect(res.body.fields.sort).toContain('name');
  });
});

describe('§10 vị trí canvas', () => {
  it('lưu vị trí KHÔNG làm đổi updated_at của mô hình', async () => {
    // Kéo một cái hộp không phải thay đổi ngữ nghĩa. `updated_at` là
    // `schemaVersion` mà Express ký vào JWT gửi Cube, nên đụng vào nó ở đây là
    // bắt Cube biên dịch lại cả schema mỗi lần người dùng di chuột.
    const before = await request(app)
      .get(`/api/v1/datamodels/${f.modelA}`)
      .set(bearer(f.tokenAdminA));

    const res = await request(app)
      .patch(`/api/v1/datamodels/${f.modelA}/layout`)
      .set(bearer(f.tokenAdminA))
      .send({ positions: [] });
    expect(res.status).toBe(204);

    const after = await request(app)
      .get(`/api/v1/datamodels/${f.modelA}`)
      .set(bearer(f.tokenAdminA));
    expect(after.body.updatedAt).toBe(before.body.updatedAt);
  });

  it('toạ độ vô lý bị từ chối', async () => {
    const res = await request(app)
      .patch(`/api/v1/datamodels/${f.modelA}/layout`)
      .set(bearer(f.tokenAdminA))
      .send({ positions: [{ id: 1, x: 99_999_999, y: 0 }] });
    expect(res.status).toBe(400);
  });
});

/**
 * Báo cáo dựng trên MÔ HÌNH — §10.8.
 *
 * Không ca nào ở đây vẽ được biểu đồ thật: việc đó cần ClickHouse và Cube, và
 * `modelA` trong bộ cố định này chưa có bảng nào. Kiểm đúng phần kiểm được mà
 * không cần kho — và đó cũng chính là phần dễ hỏng im lặng nhất: cách ly tổ
 * chức, và ràng buộc "một ID phải thuộc chính mô hình này".
 */
describe('§10.8 tạo báo cáo từ mô hình', () => {
  const body = (datamodelId: number, dimensionId = 1, measureId = 1): Record<string, unknown> => ({
    datamodelId,
    name: 'Doanh thu theo vùng',
    chartType: 'bar',
    config: { dimensionId, measureId, limit: 10 },
  });

  it('mô hình của tổ chức khác -> 404, không phải 403', async () => {
    // 403 sẽ xác nhận rằng mô hình đó CÓ THẬT — một rò rỉ nhỏ nhưng đủ để dò ra
    // tổ chức khác đang có bao nhiêu mô hình. Cùng luật với mọi route §10.
    const res = await request(app)
      .post('/api/v1/reports/from-datamodel')
      .set(bearer(f.tokenAdminA))
      .send(body(f.modelB));

    expect(res.status).toBe(404);
  });

  it('chiều và thước đo không thuộc mô hình -> 400 ngay lúc TẠO', async () => {
    // Hoãn tới lúc vẽ thì bản ghi hỏng đã nằm trong database, và chưa có màn
    // sửa cấu hình nào để chọn lại — báo cáo hỏng vĩnh viễn.
    const res = await request(app)
      .post('/api/v1/reports/from-datamodel')
      .set(bearer(f.tokenAdminA))
      .send(body(f.modelA, 999_999, 999_999));

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('Chiều');
  });

  it('thiếu chiều hoặc thước đo -> 400', async () => {
    const res = await request(app)
      .post('/api/v1/reports/from-datamodel')
      .set(bearer(f.tokenAdminA))
      .send({ datamodelId: f.modelA, name: 'Thiếu', chartType: 'bar', config: { limit: 10 } });

    expect(res.status).toBe(400);
  });

  it('viewer không tạo được', async () => {
    const res = await request(app)
      .post('/api/v1/reports/from-datamodel')
      .set(bearer(f.tokenViewerA))
      .send(body(f.modelA));

    expect(res.status).toBe(403);
  });

  /**
   * Ca quan trọng nhất của migration 26 — mặt CÒN LẠI của nó.
   *
   * Siết viewer khỏi `datamodel:read` chỉ đúng chừng nào việc họ được mời vào
   * để làm vẫn chạy. Nếu ai đó "dọn dẹp cho nhất quán" bằng cách gắn
   * `authorize('datamodel', 'read')` lên `/reports/:id/data`, mọi báo cáo dựng
   * trên mô hình sẽ trắng xoá với viewer — và không một ca 403 nào ở trên đỏ
   * lên, vì tất cả chúng đều đang khẳng định điều ngược lại.
   *
   * `modelA` chưa có bảng nào trong ClickHouse nên đường vẽ không ra số thật
   * được. Nhưng thứ đang kiểm là CÁNH CỬA, không phải con số: chỉ cần khác 403
   * là guard đã không chặn. Ca ra số thật thuộc lane có ClickHouse.
   */
  it('viewer VẪN xem được báo cáo trên mô hình, dù không còn datamodel:read', async () => {
    // Một chiều và một thước đo THẬT, vì `POST /reports/from-datamodel` kiểm cả
    // hai id có nằm trong mô hình không. `count` là đếm dòng nên không cần cột.
    const { refId, columnIds } = await attachDataset(f.tenantA, f.modelA, f.datasetA);
    const thuocDo = await request(app)
      .post(`/api/v1/datamodels/${f.modelA}/measures`)
      .set(bearer(f.tokenAdminA))
      .send({ datamodelDatasetId: refId, name: 'Số dòng', agg: 'count' });
    expect(thuocDo.status).toBe(201);

    const taoRes = await request(app)
      .post('/api/v1/reports/from-datamodel')
      .set(bearer(f.tokenAdminA))
      .send(body(f.modelA, columnIds[0], thuocDo.body.id as number));
    expect(taoRes.status).toBe(201);
    const reportId = taoRes.body.id as number;

    // Metadata: 200 tròn trịa. `authorize('report', 'read')` cho viewer qua.
    const meta = await request(app)
      .get(`/api/v1/reports/${reportId}`)
      .set(bearer(f.tokenViewerA));
    expect(meta.status).toBe(200);
    expect(meta.body.source).toBe('datamodel');

    // Số liệu: có thể hỏng vì thiếu kho, nhưng KHÔNG được hỏng vì thiếu quyền.
    const data = await request(app)
      .get(`/api/v1/reports/${reportId}/data`)
      .set(bearer(f.tokenViewerA));
    expect(data.status, `phải không phải 403, nhận ${data.status}`).not.toBe(403);
  });
});
