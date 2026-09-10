import { CANVAS_MAX_PAGES, CANVAS_MAX_VISUALS } from '@bi/shared';
import type { RowDataPacket } from 'mysql2';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
import { closeMysql, mysqlPool } from '../src/config/mysql';
import { closeRedis } from '../src/config/redis';
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
async function makeModel(tenantId: number, workspaceId: number, name: string): Promise<number> {
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

  // Gói không giới hạn — §11.2. Bộ này không kiểm thanh toán, nhưng nó dựng
  // nhiều workspace/thành viên hơn hạn mức gói mặc định. Đặt SAU khi user đã có:
  // `ck_subscriptions_override_has_reason` đòi `granted_by` khác NULL.
  await capGoiKhongGioiHan(tenantA, adminA);
  await capGoiKhongGioiHan(tenantB, adminB);

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
    // §10.9 — xem trước biểu đồ trong trình dựng. Gác bằng `datamodel:read`
    // chứ không `report:modify`: nó không tạo ra gì, nó chỉ hỏi mô hình theo
    // một cách khác. Nên nó thuộc đúng bảng này, và viewer bị chặn cùng lý do
    // với Explorer — đây là khả năng tự đặt câu hỏi MỚI trên dữ liệu.
    ['post', '/api/v1/datamodels/1/report-preview'],
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
      (
        await request(app)
          .patch(`/api/v1/datamodels/${id}/layout`)
          .set(token)
          .send({ positions: [] })
      ).status,
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
    const res = await request(app).get(`/api/v1/datamodels/${f.modelA}`).set(bearer(f.tokenAdminA));

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
    const meta = await request(app).get(`/api/v1/reports/${reportId}`).set(bearer(f.tokenViewerA));
    expect(meta.status).toBe(200);
    expect(meta.body.source).toBe('datamodel');

    // Số liệu: có thể hỏng vì thiếu kho, nhưng KHÔNG được hỏng vì thiếu quyền.
    const data = await request(app)
      .get(`/api/v1/reports/${reportId}/data`)
      .set(bearer(f.tokenViewerA));
    expect(data.status, `phải không phải 403, nhận ${data.status}`).not.toBe(403);
  });
});

/**
 * Trình dựng biểu đồ — §10.9.
 *
 * Cùng giới hạn với khối §10.8 ngay trên: không ca nào ra được con số thật, vì
 * `modelA` chưa có bảng nào trong ClickHouse. Nhưng ba thứ §10.9 thêm vào đều
 * kiểm được mà không cần kho, và cả ba đều thuộc loại hỏng im lặng:
 *
 *   - luật của chiều THỨ HAI (bắt buộc / bị cấm / phải khác chiều chính),
 *   - `config` mở rộng có ĐI TRỌN vòng lưu-rồi-đọc-lại hay không,
 *   - đường SỬA mới, và ranh giới của nó với đường sửa của báo cáo bộ dữ liệu.
 *
 * Vế thứ hai đáng một ca riêng vì `parseModelConfig` đọc JSON bằng tay: một
 * trường mới không được nhắc tới ở đó sẽ biến mất lúc đọc lại, và triệu chứng
 * là "lưu xong mở lại thì mất định dạng" — không lỗi, không log.
 */
describe('§10.9 trình dựng biểu đồ', () => {
  /** Mô hình có hai chiều thật và một thước đo thật — đủ để thả vào cả ba ô. */
  async function fields(): Promise<{ dims: number[]; measureId: number }> {
    const { refId, columnIds } = await attachDataset(f.tenantA, f.modelA, f.datasetA);
    const res = await request(app)
      .post(`/api/v1/datamodels/${f.modelA}/measures`)
      .set(bearer(f.tokenAdminA))
      .send({ datamodelDatasetId: refId, name: 'Số dòng', agg: 'count' });
    expect(res.status).toBe(201);
    return { dims: columnIds, measureId: res.body.id as number };
  }

  function tao(payload: Record<string, unknown>): request.Test {
    return request(app)
      .post('/api/v1/reports/from-datamodel')
      .set(bearer(f.tokenAdminA))
      .send(payload);
  }

  it('chiều nhóm màu TRÙNG chiều trên trục -> 400', async () => {
    // Nó chạy được về mặt SQL, và đó mới là vấn đề: kết quả là một chuỗi trên
    // mỗi nhóm, tức một biểu đồ trông y hệt biểu đồ một chuỗi nhưng tốn gấp đôi
    // truy vấn và kèm một chú giải chép lại đúng trục ngang.
    const { dims, measureId } = await fields();
    const res = await tao({
      datamodelId: f.modelA,
      name: 'Trùng chiều',
      chartType: 'bar',
      config: { dimensionId: dims[0], measureId, limit: 10, seriesDimensionId: dims[0] },
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('nhóm màu');
  });

  it('bản đồ nhiệt THIẾU chiều thứ hai -> 400', async () => {
    // Loại duy nhất BẮT BUỘC có chiều thứ hai: thiếu nó thì không có ô nào để
    // tô, và Vega vẽ ra một dải một hàng chứ không báo lỗi.
    const { dims, measureId } = await fields();
    const res = await tao({
      datamodelId: f.modelA,
      name: 'Nhiệt thiếu trục',
      chartType: 'heatmap',
      config: { dimensionId: dims[0], measureId, limit: 10 },
    });

    expect(res.status).toBe(400);
  });

  it('biểu đồ tròn KHÔNG nhận chiều thứ hai -> 400', async () => {
    const { dims, measureId } = await fields();
    const res = await tao({
      datamodelId: f.modelA,
      name: 'Tròn có chuỗi',
      chartType: 'pie',
      config: { dimensionId: dims[0], measureId, limit: 10, seriesDimensionId: dims[1] },
    });

    expect(res.status).toBe(400);
  });

  it('chiều nhóm màu không thuộc mô hình -> 400', async () => {
    const { dims, measureId } = await fields();
    const res = await tao({
      datamodelId: f.modelA,
      name: 'Chuỗi lạ',
      chartType: 'bar',
      config: { dimensionId: dims[0], measureId, limit: 10, seriesDimensionId: 999_999 },
    });

    expect(res.status).toBe(400);
  });

  it('tuỳ chọn trình bày viết sai tên bị TỪ CHỐI, không lưu im lặng', async () => {
    // `.strict()` ở zod. Nhận bừa thì trường đó nằm trong `config` mãi mãi và
    // không bao giờ có tác dụng — người dùng bật một công tắc không nối vào đâu.
    const { dims, measureId } = await fields();
    const res = await tao({
      datamodelId: f.modelA,
      name: 'Sai tên tuỳ chọn',
      chartType: 'bar',
      config: { dimensionId: dims[0], measureId, limit: 10, options: { stack: true } },
    });

    expect(res.status).toBe(400);
  });

  it('chiều thứ hai và tuỳ chọn ĐI TRỌN vòng lưu rồi đọc lại', async () => {
    const { dims, measureId } = await fields();
    const created = await tao({
      datamodelId: f.modelA,
      name: 'Doanh thu theo vùng và năm',
      chartType: 'hbar',
      config: {
        dimensionId: dims[0],
        measureId,
        limit: 25,
        seriesDimensionId: dims[1],
        options: {
          stacked: false,
          showLegend: true,
          showValues: true,
          sort: 'label',
          palette: 'dark',
        },
      },
    });
    expect(created.status).toBe(201);

    const back = await request(app)
      .get(`/api/v1/reports/${created.body.id}`)
      .set(bearer(f.tokenAdminA));

    expect(back.status).toBe(200);
    expect(back.body.chartType).toBe('hbar');
    expect(back.body.modelConfig).toMatchObject({
      dimensionId: dims[0],
      measureId,
      limit: 25,
      seriesDimensionId: dims[1],
      options: { stacked: false, showValues: true, sort: 'label', palette: 'dark' },
    });
  });

  it('"giữ lại nhóm nào" đi trọn vòng, và mặc định là nhóm LỚN nhất', async () => {
    // `pick` đổi câu hỏi gửi xuống Cube, nên nó phải nằm trong `config` chứ
    // không trong `options`. Ca này khoá đúng ranh giới đó: nếu ai đó chuyển nó
    // sang `options` thì `.strict()` của `reportChartOptionsSchema` sẽ từ chối,
    // và `modelConfig.pick` ở dưới sẽ vắng mặt.
    const { dims, measureId } = await fields();

    const nhoNhat = await tao({
      datamodelId: f.modelA,
      name: 'Năm nhóm nhỏ nhất',
      chartType: 'bar',
      config: { dimensionId: dims[0], measureId, limit: 5, pick: 'bottom' },
    });
    expect(nhoNhat.status).toBe(201);
    expect(nhoNhat.body.modelConfig.pick).toBe('bottom');

    // Không gửi cờ = giữ nhóm lớn nhất, tức hành vi của mọi báo cáo lưu trước
    // bản này. Một mặc định khác ở đây là lặng lẽ đổi số liệu của cả kho báo cáo.
    const macDinh = await tao({
      datamodelId: f.modelA,
      name: 'Không gửi cờ',
      chartType: 'bar',
      config: { dimensionId: dims[0], measureId, limit: 5 },
    });
    expect(macDinh.status).toBe(201);
    expect(macDinh.body.modelConfig.pick).toBe('top');

    const bay = await tao({
      datamodelId: f.modelA,
      name: 'Giữ nhóm bịa',
      chartType: 'bar',
      config: { dimensionId: dims[0], measureId, limit: 5, pick: 'giua' },
    });
    expect(bay.status).toBe(400);
  });

  it('bốn cách sắp trục đều lưu được, và chỉ bốn cách đó', async () => {
    // `reportChartOptionsSchema` lấy danh sách từ `CHART_SORTS` của `shared`,
    // cùng chỗ ô chọn bên trình dựng đọc. Ca này khoá cái nối đó: chép tay danh
    // sách ở một trong hai bên thì người dùng chọn một dòng có thật và nhận về
    // 400, hoặc lưu được một giá trị mà trình vẽ không hiểu.
    const { dims, measureId } = await fields();

    for (const sort of ['value', 'value-asc', 'label', 'label-desc']) {
      const created = await tao({
        datamodelId: f.modelA,
        name: `Sắp ${sort}`,
        chartType: 'bar',
        config: { dimensionId: dims[0], measureId, limit: 10, options: { sort } },
      });

      expect(created.status, sort).toBe(201);
      expect(created.body.modelConfig.options.sort, sort).toBe(sort);
    }

    const bay = await tao({
      datamodelId: f.modelA,
      name: 'Sắp bịa',
      chartType: 'bar',
      config: { dimensionId: dims[0], measureId, limit: 10, options: { sort: 'ngau-nhien' } },
    });
    expect(bay.status).toBe(400);
  });

  it('bảng màu CŨ vẫn lưu lại được, dù bộ chọn không còn mời nó', async () => {
    // Báo cáo đã lưu mang `palette: 'pastel'` trong cột `config`; mở ra rồi bấm
    // Lưu là gửi lại chính nó. Bỏ khỏi `z.enum` thì mọi báo cáo cũ trở thành
    // không sửa nổi — chúng vẫn hiện ra, vẫn cho bấm Lưu, và Lưu luôn trả 400.
    const { dims, measureId } = await fields();

    for (const palette of ['tableau10', 'tableau20', 'pastel', 'dark', 'powerbi', 'teal']) {
      const res = await tao({
        datamodelId: f.modelA,
        name: `Màu ${palette}`,
        chartType: 'bar',
        config: { dimensionId: dims[0], measureId, limit: 10, options: { palette } },
      });

      expect(res.status, palette).toBe(201);
      expect(res.body.modelConfig.options.palette, palette).toBe(palette);
    }
  });

  it('báo cáo §10.8 cũ (không có hai trường mới) vẫn đọc ra được', async () => {
    // Mọi dòng đã lưu trước bản này đều thiếu `seriesDimensionId` và `options`.
    // `parseModelConfig` phải đọc chúng thành một báo cáo một chuỗi bình thường,
    // không phải thành `null` — `null` nghĩa là "chưa có biểu đồ", tức cả kho
    // báo cáo cũ trắng xoá.
    const { dims, measureId } = await fields();
    const created = await tao({
      datamodelId: f.modelA,
      name: 'Kiểu cũ',
      chartType: 'bar',
      config: { dimensionId: dims[0], measureId, limit: 10 },
    });
    expect(created.status).toBe(201);

    const back = await request(app)
      .get(`/api/v1/reports/${created.body.id}`)
      .set(bearer(f.tokenAdminA));

    expect(back.body.modelConfig).toMatchObject({ dimensionId: dims[0], measureId, limit: 10 });
    expect(back.body.modelConfig.seriesDimensionId).toBeNull();
  });

  it('sửa được: đổi loại biểu đồ, thêm chiều thứ hai, đổi tên', async () => {
    const { dims, measureId } = await fields();
    const created = await tao({
      datamodelId: f.modelA,
      name: 'Bản đầu',
      chartType: 'bar',
      config: { dimensionId: dims[0], measureId, limit: 10 },
    });
    expect(created.status).toBe(201);

    const res = await request(app)
      .patch(`/api/v1/reports/${created.body.id}/from-datamodel`)
      .set(bearer(f.tokenAdminA))
      .send({
        name: 'Bản sửa',
        chartType: 'area',
        config: {
          dimensionId: dims[0],
          measureId,
          limit: 50,
          seriesDimensionId: dims[1],
          options: { stacked: true },
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Bản sửa');
    expect(res.body.chartType).toBe('area');
    expect(res.body.modelConfig.seriesDimensionId).toBe(dims[1]);
    expect(res.body.modelConfig.limit).toBe(50);
  });

  it('sửa bằng cấu hình vẫn phải HỢP LỆ — không có cửa sau', async () => {
    // Đường sửa dùng chung `assertModelChartConfig` với đường tạo. Lệch một
    // luật ở đây thì trình dựng cho lưu một cấu hình mà chính nó từ chối tạo.
    const { dims, measureId } = await fields();
    const created = await tao({
      datamodelId: f.modelA,
      name: 'Bản đầu',
      chartType: 'bar',
      config: { dimensionId: dims[0], measureId, limit: 10 },
    });

    const res = await request(app)
      .patch(`/api/v1/reports/${created.body.id}/from-datamodel`)
      .set(bearer(f.tokenAdminA))
      .send({
        name: 'Hỏng',
        chartType: 'heatmap',
        config: { dimensionId: dims[0], measureId, limit: 10 },
      });

    expect(res.status).toBe(400);
  });

  it('đường sửa cũ KHÔNG ghi đè được báo cáo trên mô hình', async () => {
    // Hai hình dạng `config` không giao nhau. Ghi nhầm bên nào cũng cho ra một
    // báo cáo mà bên đọc tương ứng phân giải thành `null` — mất biểu đồ, không
    // một dòng lỗi nào.
    const { dims, measureId } = await fields();
    const created = await tao({
      datamodelId: f.modelA,
      name: 'Trên mô hình',
      chartType: 'bar',
      config: { dimensionId: dims[0], measureId, limit: 10 },
    });

    const res = await request(app)
      .patch(`/api/v1/reports/${created.body.id}`)
      .set(bearer(f.tokenAdminA))
      .send({
        name: 'Ghi đè bằng tên cột',
        chartType: 'bar',
        config: { dimension: 'ma_don', measure: null, aggregate: 'count', limit: 10 },
      });

    expect(res.status).toBe(400);
  });

  it('mô hình của tổ chức khác không xem trước được -> 404', async () => {
    const res = await request(app)
      .post(`/api/v1/datamodels/${f.modelB}/report-preview`)
      .set(bearer(f.tokenAdminA))
      .send({ chartType: 'bar', config: { dimensionId: 1, measureId: 1, limit: 10 } });

    // `assertModelChartConfig` gọi `explorerFields`, và hàm đó tra mô hình
    // TRONG phạm vi tổ chức trước khi làm bất cứ việc gì khác.
    expect(res.status).toBe(404);
  });
});

/**
 * Khung nhiều biểu đồ — §10.10.
 *
 * Dùng lại đúng bộ đồ nghề của §10.9 (`modelA` + `attachDataset` + một thước đo
 * `count`), vì phần được kiểm ở đây nằm hoàn toàn ở tầng CẤU HÌNH: hình dạng
 * khung, luật của từng ô, và ranh giới với báo cáo một biểu đồ. Không ca nào
 * cần ClickHouse trả về số thật — việc đó đã được chứng minh bằng tay trên dữ
 * liệu thật, và buộc nó vào CI sẽ biến một bộ test cấu hình thành một bộ test
 * hạ tầng.
 */
describe('§10.10 khung nhiều biểu đồ', () => {
  async function fields(): Promise<{ dims: number[]; measureId: number }> {
    const { refId, columnIds } = await attachDataset(f.tenantA, f.modelA, f.datasetA);
    const res = await request(app)
      .post(`/api/v1/datamodels/${f.modelA}/measures`)
      .set(bearer(f.tokenAdminA))
      .send({ datamodelDatasetId: refId, name: 'Số dòng', agg: 'count' });
    expect(res.status).toBe(201);
    return { dims: columnIds, measureId: res.body.id as number };
  }

  /** Một ô mặc định — mọi ca chỉ ghi đè đúng thứ nó đang kiểm. */
  function o(
    id: string,
    dimensionId: number | undefined,
    measureId: number,
    extra: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      id,
      chartType: 'bar',
      config: { dimensionId, measureId, limit: 10 },
      x: 0,
      y: 0,
      w: 6,
      h: 6,
      ...extra,
    };
  }

  function taoKhung(visuals: Record<string, unknown>[], name = 'Khung'): request.Test {
    return request(app)
      .post('/api/v1/reports/canvas')
      .set(bearer(f.tokenAdminA))
      .send({ datamodelId: f.modelA, name, canvas: { visuals } });
  }

  it('tạo khung ba ô — vị trí và tiêu đề riêng đi qua nguyên vẹn', async () => {
    const { dims, measureId } = await fields();
    const res = await taoKhung([
      o('a', dims[0], measureId, { x: 0, y: 0, w: 4, h: 7 }),
      o('b', dims[1], measureId, { x: 4, y: 0, w: 8, h: 7, title: 'Tên riêng' }),
      o('c', dims[0], measureId, { x: 0, y: 7, w: 12, h: 5, chartType: 'table' }),
    ]);

    expect(res.status).toBe(201);
    // Gửi hình dạng CŨ (`{ visuals }`), nhận về hình dạng mới: đường ghi vẫn
    // nhận cả hai, và đường đọc luôn quy về một trang. Xem `reportCanvasSchema`.
    expect(res.body.canvas.pages).toHaveLength(1);
    const oCua = res.body.canvas.pages[0].visuals;
    expect(oCua).toHaveLength(3);
    expect(oCua[1]).toMatchObject({ x: 4, w: 8, title: 'Tên riêng' });
    expect(oCua[2].chartType).toBe('table');
  });

  it('ô ĐẦU TIÊN được chép sang chart_type/config để đường cũ còn đọc được', async () => {
    // Đây là hợp đồng giữ cho mọi thứ viết trước §10.10 chạy tiếp: danh sách báo
    // cáo, `GET /reports/:id/data`, và bất kỳ client cũ nào. Bỏ bản sao đi thì
    // một khung vừa lưu xong hiện ra là "Chưa có biểu đồ".
    const { dims, measureId } = await fields();
    const res = await taoKhung([
      o('a', dims[0], measureId, { chartType: 'pie' }),
      o('b', dims[1], measureId, { chartType: 'line', x: 6 }),
    ]);

    expect(res.status).toBe(201);
    expect(res.body.chartType).toBe('pie');
    expect(res.body.modelConfig).toMatchObject({ dimensionId: dims[0], measureId });
  });

  it('MỘT ô sai làm hỏng cả lần lưu — không lưu một nửa', async () => {
    // Ô thứ hai là bản đồ nhiệt thiếu chiều thứ hai. Lưu ô hợp lệ rồi lặng lẽ bỏ
    // ô sai sẽ cho người dùng một khung khác thứ họ vừa dựng.
    const { dims, measureId } = await fields();
    const res = await taoKhung([
      o('ok', dims[0], measureId),
      o('bad', dims[0], measureId, { chartType: 'heatmap', x: 6 }),
    ]);

    expect(res.status).toBe(400);
  });

  it('hai ô TRÙNG mã -> 400', async () => {
    // Trùng mã thì `canvas-data` trả hai bản ghi cùng khoá và trình vẽ ghép số
    // liệu vào nhầm ô: biểu đồ đúng hình, sai số. Không ai nhìn ra bằng mắt.
    const { dims, measureId } = await fields();
    const res = await taoKhung([o('same', dims[0], measureId), o('same', dims[1], measureId)]);

    expect(res.status).toBe(400);
  });

  it('khung RỖNG -> 400', async () => {
    const res = await taoKhung([]);
    expect(res.status).toBe(400);
  });

  it('ô tràn khỏi lưới 12 cột -> 400', async () => {
    const { dims, measureId } = await fields();
    const res = await taoKhung([o('a', dims[0], measureId, { x: 12 })]);
    expect(res.status).toBe(400);
  });

  it('bề rộng bị KẸP vào mép phải thay vì bị từ chối', async () => {
    // Kéo một ô sang phải rồi nới rộng là thao tác bình thường, và trả 400 cho
    // nó nghĩa là mất cả lần lưu vì một ô thò ra ngoài mép.
    const { dims, measureId } = await fields();
    const res = await taoKhung([o('a', dims[0], measureId, { x: 9, w: 6 })]);

    expect(res.status).toBe(201);
    expect(res.body.canvas.pages[0].visuals[0]).toMatchObject({ x: 9, w: 3 });
  });

  it('quá trần số ô -> 400', async () => {
    const { dims, measureId } = await fields();
    const many = Array.from({ length: CANVAS_MAX_VISUALS + 1 }, (_, i) =>
      o(`v${i}`, dims[0], measureId),
    );
    const res = await taoKhung(many);

    expect(res.status).toBe(400);
  });

  it('trường lạ trong ô bị TỪ CHỐI, không lưu im lặng', async () => {
    const { dims, measureId } = await fields();
    const res = await taoKhung([o('a', dims[0], measureId, { mauNen: 'do' })]);
    expect(res.status).toBe(400);
  });

  it('canvas-data trên báo cáo MỘT biểu đồ -> 409, không phải 500', async () => {
    const { dims, measureId } = await fields();
    const created = await request(app)
      .post('/api/v1/reports/from-datamodel')
      .set(bearer(f.tokenAdminA))
      .send({
        datamodelId: f.modelA,
        name: 'Một biểu đồ',
        chartType: 'bar',
        config: { dimensionId: dims[0], measureId, limit: 10 },
      });
    expect(created.status).toBe(201);
    expect(created.body.canvas).toBeNull();

    const res = await request(app)
      .get(`/api/v1/reports/${created.body.id}/canvas-data`)
      .set(bearer(f.tokenAdminA));

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('ReportNotConfigured');
  });

  it('CHUYỂN ĐỔI: báo cáo một biểu đồ nhận thêm ô thứ hai', async () => {
    // Đường để một báo cáo dựng ở §10.9 lớn lên thành khung, thay vì phải tạo
    // lại từ đầu. Một chiều, và ô đầu tiên giữ nguyên cấu hình cũ.
    const { dims, measureId } = await fields();
    const created = await request(app)
      .post('/api/v1/reports/from-datamodel')
      .set(bearer(f.tokenAdminA))
      .send({
        datamodelId: f.modelA,
        name: 'Sẽ thành khung',
        chartType: 'bar',
        config: { dimensionId: dims[0], measureId, limit: 10 },
      });

    const res = await request(app)
      .patch(`/api/v1/reports/${created.body.id}/canvas`)
      .set(bearer(f.tokenAdminA))
      .send({
        name: 'Đã thành khung',
        canvas: { visuals: [o('a', dims[0], measureId), o('b', dims[1], measureId, { x: 6 })] },
      });

    expect(res.status).toBe(200);
    expect(res.body.canvas.pages[0].visuals).toHaveLength(2);
    // Bản sao vẫn được cập nhật, nên `GET /reports/:id/data` không mồ côi.
    expect(res.body.modelConfig).toMatchObject({ dimensionId: dims[0] });
  });

  it('không ghi được khung lên báo cáo dựng trên BỘ DỮ LIỆU', async () => {
    // Cấu hình dạng ID ghi lên một báo cáo dạng tên cột sẽ làm `parseConfig`
    // đọc ra `null` — xoá trắng biểu đồ mà không báo gì.
    const { dims, measureId } = await fields();
    const onDataset = await request(app)
      .post('/api/v1/reports')
      .set(bearer(f.tokenAdminA))
      .send({ datasetId: f.datasetA, name: 'Trên bộ dữ liệu' });
    expect(onDataset.status).toBe(201);

    const res = await request(app)
      .patch(`/api/v1/reports/${onDataset.body.id}/canvas`)
      .set(bearer(f.tokenAdminA))
      .send({ name: 'Ép thành khung', canvas: { visuals: [o('a', dims[0], measureId)] } });

    expect(res.status).toBe(400);
  });

  it('mô hình của tổ chức KHÁC không tạo khung được -> 404', async () => {
    const res = await request(app)
      .post('/api/v1/reports/canvas')
      .set(bearer(f.tokenAdminA))
      .send({
        datamodelId: f.modelB,
        name: 'Khung xuyên tổ chức',
        canvas: { visuals: [o('a', 1, 1)] },
      });

    expect(res.status).toBe(404);
  });

  /* ─── §10.12 nhiều TRANG trên một báo cáo ─────────────────────────────────
   *
   * Cột `reports.canvas` là JSON và KHÔNG được migrate, nên hai hình dạng cùng
   * tồn tại trên đĩa. Khối này khoá đúng chỗ đó: hình dạng cũ vẫn ghi được và
   * đọc ra một trang, hình dạng mới đi trọn vòng, và ba luật của cả khung
   * (trần trang, mã ô duy nhất XUYÊN trang, ít nhất một ô) thật sự chặn.
   */
  function taoTrang(pages: Record<string, unknown>[], name = 'Khung nhiều trang'): request.Test {
    return request(app)
      .post('/api/v1/reports/canvas')
      .set(bearer(f.tokenAdminA))
      .send({ datamodelId: f.modelA, name, canvas: { pages } });
  }

  it('hai trang ĐI TRỌN vòng lưu rồi đọc lại — tên và thứ tự giữ nguyên', async () => {
    const { dims, measureId } = await fields();
    const res = await taoTrang([
      { id: 'p1', name: 'Tổng quan', visuals: [o('a', dims[0], measureId)] },
      { id: 'p2', name: 'Chi tiết', visuals: [o('b', dims[1], measureId, { chartType: 'table' })] },
    ]);

    expect(res.status).toBe(201);
    expect(res.body.canvas.pages.map((p: { name: string }) => p.name)).toEqual([
      'Tổng quan',
      'Chi tiết',
    ]);
    expect(res.body.canvas.pages[1].visuals[0].chartType).toBe('table');
  });

  it('trang RỖNG được giữ, miễn cả khung còn ít nhất một ô', async () => {
    // Người ta thêm một trang TRƯỚC rồi mới dựng biểu đồ cho nó. Từ chối trang
    // rỗng nghĩa là bấm Lưu giữa chừng sẽ làm biến mất trang vừa tạo.
    const { dims, measureId } = await fields();
    const res = await taoTrang([
      { id: 'p1', name: 'Có ô', visuals: [o('a', dims[0], measureId)] },
      { id: 'p2', name: 'Chưa dựng gì', visuals: [] },
    ]);

    expect(res.status).toBe(201);
    expect(res.body.canvas.pages).toHaveLength(2);
    expect(res.body.canvas.pages[1].visuals).toHaveLength(0);
  });

  it('MỌI trang đều rỗng -> 400', async () => {
    const res = await taoTrang([
      { id: 'p1', name: 'Một', visuals: [] },
      { id: 'p2', name: 'Hai', visuals: [] },
    ]);
    expect(res.status).toBe(400);
  });

  it('hai ô trùng mã ở HAI TRANG KHÁC NHAU -> 400', async () => {
    // Duy nhất trong phạm vi một trang là KHÔNG đủ: chuyển ô sang trang khác là
    // thao tác bình thường và nó mang mã cũ đi theo. Trùng mã thì
    // `canvas-data` trả hai bản ghi cùng khoá và trình vẽ ghép nhầm số liệu.
    const { dims, measureId } = await fields();
    const res = await taoTrang([
      { id: 'p1', name: 'Một', visuals: [o('same', dims[0], measureId)] },
      { id: 'p2', name: 'Hai', visuals: [o('same', dims[1], measureId)] },
    ]);

    expect(res.status).toBe(400);
  });

  it('quá trần số trang -> 400', async () => {
    const { dims, measureId } = await fields();
    const many = Array.from({ length: CANVAS_MAX_PAGES + 1 }, (_, i) => ({
      id: `p${i}`,
      name: `Trang ${i}`,
      visuals: [o(`v${i}`, dims[0], measureId)],
    }));

    expect((await taoTrang(many)).status).toBe(400);
  });

  it('ô đầu tiên chép sang chart_type/config kể cả khi TRANG ĐẦU rỗng', async () => {
    // Soi đúng `pages[0].visuals[0]` sẽ ghi NULL ở đây, và báo cáo vừa lưu xong
    // hiện ra là "Chưa có biểu đồ" ở trang danh sách.
    const { dims, measureId } = await fields();
    const res = await taoTrang([
      { id: 'p1', name: 'Trống', visuals: [] },
      { id: 'p2', name: 'Có ô', visuals: [o('a', dims[0], measureId, { chartType: 'pie' })] },
    ]);

    expect(res.status).toBe(201);
    expect(res.body.chartType).toBe('pie');
    expect(res.body.modelConfig).toMatchObject({ dimensionId: dims[0], measureId });
  });

  it('canvas-data tính ĐÚNG trang được hỏi, không phải cả báo cáo', async () => {
    const { dims, measureId } = await fields();
    const created = await taoTrang([
      { id: 'p1', name: 'Một', visuals: [o('a', dims[0], measureId)] },
      {
        id: 'p2',
        name: 'Hai',
        visuals: [o('b', dims[1], measureId), o('c', dims[0], measureId, { x: 6 })],
      },
    ]);
    expect(created.status).toBe(201);

    // Không có `pageId` -> trang đầu, đúng một ô.
    const dau = await request(app)
      .get(`/api/v1/reports/${created.body.id}/canvas-data`)
      .set(bearer(f.tokenAdminA));
    expect(dau.status).toBe(200);
    expect(dau.body.visuals.map((v: { visualId: string }) => v.visualId)).toEqual(['a']);

    const hai = await request(app)
      .get(`/api/v1/reports/${created.body.id}/canvas-data?pageId=p2`)
      .set(bearer(f.tokenAdminA));
    expect(hai.status).toBe(200);
    expect(hai.body.visuals.map((v: { visualId: string }) => v.visualId)).toEqual(['b', 'c']);

    // Mã trang LẠ rơi về trang đầu chứ không phải 404: nó xảy ra thật khi hai
    // người mở cùng một báo cáo và một người xoá một trang.
    const la = await request(app)
      .get(`/api/v1/reports/${created.body.id}/canvas-data?pageId=khong-co`)
      .set(bearer(f.tokenAdminA));
    expect(la.status).toBe(200);
    expect(la.body.visuals.map((v: { visualId: string }) => v.visualId)).toEqual(['a']);
  });
});

/* ═══ §10.12 chia trang nhóm, §10.15 bỏ ô chọn ════════════════════════════
 *
 * §10.12 thêm `overflow` vào `config`: gộp phần vượt thành cột "Khác", hay chia
 * trang. §10.15 bỏ hẳn trường đó — mọi biểu đồ dựng trên mô hình đều chia
 * trang — nên bộ ca ở đây đổi theo, và ca quan trọng nhất là ca CŨ: một client
 * chưa cập nhật vẫn gửi `overflow` lên, và nó không được phép làm hỏng lần lưu.
 */
describe('§10.12 chia trang nhóm', () => {
  /** Cùng bộ đồ nghề với §10.10 — mô hình rỗng chưa có thước đo nào. */
  async function fields(): Promise<{ dimensionId: number; measureId: number }> {
    const { refId, columnIds } = await attachDataset(f.tenantA, f.modelA, f.datasetA);
    const res = await request(app)
      .post(`/api/v1/datamodels/${f.modelA}/measures`)
      .set(bearer(f.tokenAdminA))
      .send({ datamodelDatasetId: refId, name: 'Số dòng', agg: 'count' });
    expect(res.status).toBe(201);
    return { dimensionId: columnIds[0] as number, measureId: res.body.id as number };
  }

  function taoBaoCao(config: Record<string, unknown>): request.Test {
    return request(app)
      .post('/api/v1/reports/from-datamodel')
      .set(bearer(f.tokenAdminA))
      .send({ datamodelId: f.modelA, name: 'Chia trang', chartType: 'bar', config });
  }

  it('`overflow` của client CŨ được nhận rồi bỏ qua, không 400 — §10.15', async () => {
    /*
     * Một tab đang mở từ trước bản này vẫn gửi `overflow` kèm mỗi lần lưu. Nếu
     * `reportModelConfigSchema` là `.strict()` thì người dùng ấy bấm Lưu và nhận
     * 400 mà không hiểu vì sao — một lỗi chỉ hiện ra sau khi deploy, và chỉ với
     * người chưa tải lại trang.
     *
     * Trường bị BỎ HẲN chứ không lưu im lặng: giữ lại một trường không ai đọc
     * nữa là hẹn cho người sau đọc nó và tưởng nó có tác dụng.
     */
    const { dimensionId, measureId } = await fields();

    const res = await taoBaoCao({ dimensionId, measureId, limit: 5, overflow: 'pages' });
    expect(res.status).toBe(201);
    expect(res.body.modelConfig.overflow).toBeUndefined();

    const la = await taoBaoCao({ dimensionId, measureId, limit: 5, overflow: 'cuon' });
    expect(la.status).toBe(201);
    expect(la.body.modelConfig.overflow).toBeUndefined();
  });

  it('`?page=` chỉ nhận số không âm và có TRẦN', async () => {
    // `offset` đi thẳng vào truy vấn Cube; một `?page=99999999` là một lượt quét
    // bỏ qua mười tỉ dòng.
    const { dimensionId, measureId } = await fields();
    const created = await taoBaoCao({ dimensionId, measureId, limit: 5 });

    const am = await request(app)
      .get(`/api/v1/reports/${created.body.id}/data?page=-1`)
      .set(bearer(f.tokenAdminA));
    expect(am.status).toBe(400);

    const qua = await request(app)
      .get(`/api/v1/reports/${created.body.id}/data?page=99999999`)
      .set(bearer(f.tokenAdminA));
    expect(qua.status).toBe(400);
  });

  it('số liệu MỘT ô: mã ô lạ -> 404, báo cáo một biểu đồ -> 409', async () => {
    // Endpoint này đọc cấu hình từ chính báo cáo đã lưu, nên nó chỉ nhận một mã
    // ô — không có đường lén gửi lên một cấu hình khác.
    const { dimensionId, measureId } = await fields();
    const mot = await taoBaoCao({ dimensionId, measureId, limit: 5 });

    const khung = await request(app)
      .get(`/api/v1/reports/${mot.body.id}/visuals/a/data?page=1`)
      .set(bearer(f.tokenAdminA));
    expect(khung.status).toBe(409);

    const tao = await request(app)
      .post('/api/v1/reports/canvas')
      .set(bearer(f.tokenAdminA))
      .send({
        datamodelId: f.modelA,
        name: 'Khung để hỏi ô',
        canvas: {
          pages: [
            {
              id: 'p1',
              name: 'Một',
              visuals: [
                {
                  id: 'co-that',
                  chartType: 'bar',
                  config: { dimensionId, measureId, limit: 5 },
                  x: 0,
                  y: 0,
                  w: 6,
                  h: 6,
                },
              ],
            },
          ],
        },
      });
    expect(tao.status).toBe(201);

    const laO = await request(app)
      .get(`/api/v1/reports/${tao.body.id}/visuals/khong-co/data?page=1`)
      .set(bearer(f.tokenAdminA));
    expect(laO.status).toBe(404);
  });
});

describe('§10.13 mô hình dựng-hộ được LƯU như mọi mô hình khác', () => {
  /*
   * ═══ Khối này ĐẢO khối §10.11 cũ ══════════════════════════════════════════
   *
   * §10.11 giấu mô hình dựng-hộ khỏi danh sách bằng một cột `datamodels.hidden`,
   * và khối cũ ở đây khoá ranh giới "ẩn nghĩa là không bày, không phải không
   * tồn tại". Người dùng gặp mặt trái của nó ngay lần dùng đầu:
   *
   *     "tui vẫn thấy nút mở mô hình nhưng khi thoát ra thì lại không thấy
   *      trong phần mô hình dữ liệu"
   *
   * Một mô hình mở được nhưng không có mặt trong danh sách đọc ra như dữ liệu
   * BỊ MẤT. Cột đó chưa bao giờ rời khỏi máy dựng nên nó được bỏ hẳn — không
   * còn migration nào cho nó — và những ca dưới đây khoá chiều ngược lại: không
   * đường tạo nào giấu được một mô hình nữa.
   */

  async function create(name: string, extra: Record<string, unknown> = {}): Promise<number> {
    const res = await request(app)
      .post('/api/v1/datamodels')
      .set(bearer(f.tokenAdminA))
      .send({ workspaceId: f.workspaceA, name, datasetIds: [f.datasetA], ...extra });
    expect(res.status).toBe(201);
    return res.body.id as number;
  }

  function danhSach(): request.Test {
    return request(app).get('/api/v1/datamodels?page=1&pageSize=100').set(bearer(f.tokenAdminA));
  }

  it('mô hình vừa tạo CÓ trong danh sách', async () => {
    // Đây là đúng câu người dùng hỏi: tạo xong, thoát ra, có thấy nó không.
    const id = await create('Dựng từ file Excel');

    const list = await danhSach();
    expect(list.status).toBe(200);
    expect(list.body.items.map((m: { id: number }) => m.id)).toContain(id);
  });

  it('và được TÍNH vào `total`, không phải chỉ hiện ra', async () => {
    // `count` và `list` dùng chung hàm `where`. Lệch nhau thì phân trang hiện
    // "1–10 trong 11" trên một danh sách có 10 dòng, và trang 2 rỗng.
    const before = (await danhSach()).body.total as number;
    await create('Dựng từ file lần hai');
    expect((await danhSach()).body.total).toBe(before + 1);
  });

  it('client CŨ gửi cờ `hidden` vẫn không giấu được gì', async () => {
    // Bản frontend trước §10.13 gửi `hidden: true` ở luồng "tạo báo cáo nhanh".
    // Một tab chưa tải lại vẫn đang chạy bản đó, và nó không được phép làm mô
    // hình biến mất — cột `hidden` không còn, nên trường thừa này bị bỏ qua.
    const id = await create('Cờ cũ còn sót', { hidden: true });

    const list = await danhSach();
    expect(list.body.items.map((m: { id: number }) => m.id)).toContain(id);
  });

  it('DTO không còn mang `hidden` — cột đã bị bỏ hẳn', async () => {
    // Không phải chuyện thẩm mỹ: một trường luôn bằng `false` còn nằm trong DTO
    // là lời mời cho ai đó viết một nhánh `if` dựa vào nó.
    const id = await create('Xem DTO');

    const one = await request(app).get(`/api/v1/datamodels/${id}`).set(bearer(f.tokenAdminA));
    expect(one.status).toBe(200);
    expect(one.body).not.toHaveProperty('hidden');
    expect((await danhSach()).body.items[0]).not.toHaveProperty('hidden');
  });

  it('vẫn đi qua CÙNG đường tạo — bảng được gắn vào như mô hình thường', async () => {
    // Giữ lại từ khối cũ: "tạo báo cáo nhanh" chỉ có nghĩa khi mô hình dựng hộ
    // giống hệt mô hình người dùng tự dựng.
    //
    // ⚠️ Ca này KHÔNG kiểm được việc gieo thước đo: `makeLoadedDataset` chỉ chèn
    // một dòng MySQL, phía sau nó KHÔNG có bảng ClickHouse nào, nên
    // `createDataModel` đọc ra một schema rỗng và không có cột nào để gieo.
    const id = await create('Cùng đường tạo');

    const detail = await request(app).get(`/api/v1/datamodels/${id}`).set(bearer(f.tokenAdminA));

    expect(detail.status).toBe(200);
    expect(detail.body.datasetCount).toBe(1);
    expect(detail.body.datasets).toHaveLength(1);
    expect(detail.body.datasets[0].datasetId).toBe(f.datasetA);
  });

  it('tổ chức khác vẫn KHÔNG tra được — cách ly không đổi', async () => {
    // Bỏ `hidden` chỉ đụng chuyện BÀY RA. Tầng bảo mật thật phải y nguyên.
    const id = await create('Của tổ chức A');

    const res = await request(app).get(`/api/v1/datamodels/${id}`).set(bearer(f.tokenAdminB));

    expect(res.status).toBe(404);
  });
});
