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

  /** Route GHI — viewer phải bị chặn ở mọi cái. */
  const WRITE_ROUTES: [Method, string][] = [
    ['post', '/api/v1/datamodels'],
    ['patch', '/api/v1/datamodels/1'],
    ['delete', '/api/v1/datamodels/1'],
    ['post', '/api/v1/datamodels/1/datasets'],
    ['delete', '/api/v1/datamodels/1/datasets/1'],
    ['patch', '/api/v1/datamodels/1/layout'],
  ];

  const READ_ROUTES: [Method, string][] = [
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
  it.each([...WRITE_ROUTES, ...READ_ROUTES])('không token: %s %s -> 401', async (method, path) => {
    const res = await call(method, path).send({});
    expect(res.status).toBe(401);
  });

  it.each(WRITE_ROUTES)('viewer: %s %s -> 403', async (method, path) => {
    const res = await call(method, path).set(bearer(f.tokenViewerA)).send({});
    expect(res.status).toBe(403);
  });

  it('viewer ĐỌC được danh sách mô hình', async () => {
    const res = await request(app).get('/api/v1/datamodels').set(bearer(f.tokenViewerA));
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
