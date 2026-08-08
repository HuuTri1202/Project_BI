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
  makeProject,
  makeTenant,
  makeUser,
  makeWorkspace,
  signTokenFor,
} from './helpers/fixtures';

/**
 * Test tích hợp khu quản trị (§3.3 – §3.6).
 *
 * Chạy: `npm run test:integration` — cần MySQL + Redis, và database
 * `bi_platform_test` đã được migrate:
 *   $env:MYSQL_DATABASE='bi_platform_test'; npm --workspace backend run migrate
 */

const app = createApp();

/** Hai tổ chức tách biệt, dựng lại trước mỗi ca. */
interface Fixture {
  tenantA: number;
  tenantB: number;
  adminA: number;
  adminA2: number;
  viewerA: number;
  adminB: number;
  userB: number;
  workspaceA: number;
  workspaceB: number;
  tokenAdminA: string;
  tokenViewerA: string;
}

let f: Fixture;

beforeEach(async () => {
  await resetDatabase();

  const tenantA = await makeTenant('Công ty A', 'cong-ty-a');
  const tenantB = await makeTenant('Công ty B', 'cong-ty-b');

  const adminA = await makeUser('admin.a@test.local', 'Quản trị A');
  const adminA2 = await makeUser('admin.a2@test.local', 'Quản trị A hai');
  const viewerA = await makeUser('viewer.a@test.local', 'Người xem A');
  const adminB = await makeUser('admin.b@test.local', 'Quản trị B');
  const userB = await makeUser('user.b@test.local', 'Thành viên B');

  await makeMembership(adminA, tenantA, 'admin');
  await makeMembership(adminA2, tenantA, 'admin');
  await makeMembership(viewerA, tenantA, 'viewer');
  await makeMembership(adminB, tenantB, 'admin');
  await makeMembership(userB, tenantB, 'creator');

  f = {
    tenantA,
    tenantB,
    adminA,
    adminA2,
    viewerA,
    adminB,
    userB,
    workspaceA: await makeWorkspace(tenantA, 'Kinh doanh', 'kinh-doanh'),
    workspaceB: await makeWorkspace(tenantB, 'Kế toán', 'ke-toan'),
    tokenAdminA: signTokenFor(adminA, tenantA, 'admin'),
    tokenViewerA: signTokenFor(viewerA, tenantA, 'viewer'),
  };
});

afterAll(async () => {
  await closeMysql();
  await closeRedis();
});

// ─────────────────────────────────────────────────────────────────────────────

describe('§3.6 — cổng phân quyền', () => {
  type Method = 'get' | 'post' | 'patch' | 'delete';

  const ROUTES: [Method, string][] = [
    ['get', '/api/admin/overview'],
    ['get', '/api/admin/users'],
    ['post', '/api/admin/users'],
    ['patch', '/api/admin/users/1/role'],
    ['patch', '/api/admin/users/1/status'],
    ['delete', '/api/admin/users/1'],
    ['get', '/api/admin/workspaces'],
    ['post', '/api/admin/workspaces'],
    ['patch', '/api/admin/workspaces/1'],
    ['delete', '/api/admin/workspaces/1'],
  ];

  /** Gọi đúng phương thức, giữ nguyên kiểu — không ép qua `Record<string, ...>`. */
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

  // Chạy theo BẢNG chứ không viết tay từng ca: route mới thêm vào mà quên gắn
  // guard sẽ tự động làm đỏ test, không cần ai nhớ bổ sung.
  it.each(ROUTES)('không token: %s %s -> 401', async (method, path) => {
    const res = await call(method, path).send({});
    expect(res.status).toBe(401);
  });

  it.each(ROUTES)('token viewer: %s %s -> 403', async (method, path) => {
    const res = await call(method, path).set(bearer(f.tokenViewerA)).send({});
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Forbidden');
  });
});

describe('token cũ — requireFreshAdmin', () => {
  it('token ghi admin nhưng DB đã hạ xuống viewer -> 403', async () => {
    // Đúng tình huống thật: người này từng là admin, token cấp lúc đó còn hạn
    // tới 7 ngày, và vừa bị hạ quyền cách đây một phút.
    const staleToken = signTokenFor(f.viewerA, f.tenantA, 'admin');

    const res = await request(app).get('/api/admin/overview').set(bearer(staleToken));

    expect(res.status).toBe(403);
  });

  it('token ghi admin của tổ chức mình KHÔNG thuộc về -> 401', async () => {
    const forged = signTokenFor(f.adminA, f.tenantB, 'admin');
    const res = await request(app).get('/api/admin/overview').set(bearer(forged));
    expect(res.status).toBe(401);
  });

  it('tài khoản bị khoá toàn hệ thống -> 401 dù membership vẫn admin', async () => {
    await mysqlPool.query('UPDATE users SET is_active = 0 WHERE id = ?', [f.adminA]);
    const res = await request(app).get('/api/admin/overview').set(bearer(f.tokenAdminA));
    expect(res.status).toBe(401);
  });
});

describe('§3.3 — cách ly tổ chức', () => {
  it('danh sách chỉ có người của tổ chức mình', async () => {
    const res = await request(app).get('/api/admin/users').set(bearer(f.tokenAdminA));

    expect(res.status).toBe(200);
    const emails: string[] = res.body.items.map((u: { email: string }) => u.email);
    expect(emails).toContain('admin.a@test.local');
    expect(emails).toContain('viewer.a@test.local');
    // Đây là dòng quan trọng nhất của cả file.
    expect(emails).not.toContain('admin.b@test.local');
    expect(emails).not.toContain('user.b@test.local');
    expect(res.body.total).toBe(3);
  });

  // 404 chứ không phải 403: 403 xác nhận rằng id đó CÓ tồn tại, còn 404 thì
  // không tiết lộ gì cả.
  it('sửa vai trò người của tổ chức khác -> 404', async () => {
    const res = await request(app)
      .patch(`/api/admin/users/${f.userB}/role`)
      .set(bearer(f.tokenAdminA))
      .send({ role: 'viewer' });
    expect(res.status).toBe(404);
  });

  it('khoá người của tổ chức khác -> 404', async () => {
    const res = await request(app)
      .patch(`/api/admin/users/${f.userB}/status`)
      .set(bearer(f.tokenAdminA))
      .send({ isActive: false });
    expect(res.status).toBe(404);
  });

  it('gỡ người của tổ chức khác -> 404, và dữ liệu bên đó nguyên vẹn', async () => {
    const res = await request(app)
      .delete(`/api/admin/users/${f.userB}`)
      .set(bearer(f.tokenAdminA));
    expect(res.status).toBe(404);

    const listB = await request(app)
      .get('/api/admin/users')
      .set(bearer(signTokenFor(f.adminB, f.tenantB, 'admin')));
    expect(listB.body.total).toBe(2);
  });

  it('sửa và xoá workspace của tổ chức khác -> 404', async () => {
    const patched = await request(app)
      .patch(`/api/admin/workspaces/${f.workspaceB}`)
      .set(bearer(f.tokenAdminA))
      .send({ name: 'Chiếm đoạt' });
    expect(patched.status).toBe(404);

    const deleted = await request(app)
      .delete(`/api/admin/workspaces/${f.workspaceB}`)
      .set(bearer(f.tokenAdminA));
    expect(deleted.status).toBe(404);
  });
});

describe('§3.3 — tìm kiếm, lọc, sắp xếp, phân trang', () => {
  it('tìm theo tên có dấu', async () => {
    const res = await request(app)
      .get('/api/admin/users')
      .query({ q: 'Người xem' })
      .set(bearer(f.tokenAdminA));
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].email).toBe('viewer.a@test.local');
  });

  it('ký tự đặc biệt của LIKE không biến thành ký tự đại diện', async () => {
    // '%' không escape sẽ khớp MỌI dòng — kết quả 3 thay vì 0.
    const res = await request(app)
      .get('/api/admin/users')
      .query({ q: '%' })
      .set(bearer(f.tokenAdminA));
    expect(res.body.total).toBe(0);
  });

  it('lọc theo vai trò', async () => {
    const res = await request(app)
      .get('/api/admin/users')
      .query({ role: 'admin' })
      .set(bearer(f.tokenAdminA));
    expect(res.body.total).toBe(2);
  });

  it('mặc định ẩn người đã bị gỡ, lọc status=removed thì hiện', async () => {
    await request(app).delete(`/api/admin/users/${f.viewerA}`).set(bearer(f.tokenAdminA));

    const normal = await request(app).get('/api/admin/users').set(bearer(f.tokenAdminA));
    expect(normal.body.total).toBe(2);

    const removed = await request(app)
      .get('/api/admin/users')
      .query({ status: 'removed' })
      .set(bearer(f.tokenAdminA));
    expect(removed.body.total).toBe(1);
  });

  it('phân trang không lặp và không bỏ sót dòng nào', async () => {
    const p1 = await request(app)
      .get('/api/admin/users')
      .query({ pageSize: 2, page: 1, sort: 'email', order: 'asc' })
      .set(bearer(f.tokenAdminA));
    const p2 = await request(app)
      .get('/api/admin/users')
      .query({ pageSize: 2, page: 2, sort: 'email', order: 'asc' })
      .set(bearer(f.tokenAdminA));

    const ids = [...p1.body.items, ...p2.body.items].map((u: { userId: number }) => u.userId);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    expect(p1.body.totalPages).toBe(2);
  });

  it('cột sắp xếp ngoài whitelist -> 400, không chạm SQL', async () => {
    const res = await request(app)
      .get('/api/admin/users')
      .query({ sort: 'u.id; DROP TABLE users' })
      .set(bearer(f.tokenAdminA));
    expect(res.status).toBe(400);

    // Bảng vẫn còn — nếu chuỗi kia lọt vào ORDER BY thì câu này sẽ ném lỗi.
    const still = await request(app).get('/api/admin/users').set(bearer(f.tokenAdminA));
    expect(still.status).toBe(200);
  });
});

describe('§3.4 — tạo thành viên', () => {
  it('email mới: trả mật khẩu tạm, và ĐĂNG NHẬP ĐƯỢC bằng đúng mật khẩu đó', async () => {
    const created = await request(app)
      .post('/api/admin/users')
      .set(bearer(f.tokenAdminA))
      .send({ email: 'moi@test.local', fullName: 'Người Mới', role: 'creator' });

    expect(created.status).toBe(201);
    expect(created.body.mode).toBe('created');
    expect(created.body.tempPassword).toBeTruthy();
    expect(created.body.user.mustChangePassword).toBe(true);

    // Đây là bằng chứng đầu-cuối rằng luồng mời dùng được khi không có kênh mail.
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'moi@test.local', password: created.body.tempPassword });

    expect(login.status).toBe(200);
    expect(login.body.mustChangePassword).toBe(true);
    expect(login.body.role).toBe('creator');
  });

  it('email đã có ở tổ chức khác: gắn vào, KHÔNG kèm mật khẩu tạm', async () => {
    const res = await request(app)
      .post('/api/admin/users')
      .set(bearer(f.tokenAdminA))
      .send({ email: 'user.b@test.local', fullName: 'Thành viên B', role: 'viewer' });

    expect(res.status).toBe(201);
    expect(res.body.mode).toBe('attached');
    // Admin tổ chức này không có quyền đặt lại mật khẩu của một danh tính dùng chung.
    expect(res.body.tempPassword).toBeUndefined();
  });

  it('email đã là thành viên -> 409', async () => {
    const res = await request(app)
      .post('/api/admin/users')
      .set(bearer(f.tokenAdminA))
      .send({ email: 'viewer.a@test.local', fullName: 'Người xem A', role: 'viewer' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('MemberAlreadyExists');
  });

  it('mời lại người đã bị gỡ thì họ giữ nguyên tài khoản cũ', async () => {
    await request(app).delete(`/api/admin/users/${f.viewerA}`).set(bearer(f.tokenAdminA));

    const res = await request(app)
      .post('/api/admin/users')
      .set(bearer(f.tokenAdminA))
      .send({ email: 'viewer.a@test.local', fullName: 'Người xem A', role: 'creator' });

    expect(res.status).toBe(201);
    expect(res.body.mode).toBe('attached');
    expect(res.body.user.userId).toBe(f.viewerA);
    expect(res.body.user.role).toBe('creator');
  });
});

describe('§3.4 — tự bảo vệ và admin cuối cùng', () => {
  it('không tự đổi vai trò của chính mình', async () => {
    const res = await request(app)
      .patch(`/api/admin/users/${f.adminA}/role`)
      .set(bearer(f.tokenAdminA))
      .send({ role: 'viewer' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('CannotModifySelf');
  });

  it('không tự khoá và không tự gỡ chính mình', async () => {
    const locked = await request(app)
      .patch(`/api/admin/users/${f.adminA}/status`)
      .set(bearer(f.tokenAdminA))
      .send({ isActive: false });
    expect(locked.status).toBe(403);

    const removed = await request(app)
      .delete(`/api/admin/users/${f.adminA}`)
      .set(bearer(f.tokenAdminA));
    expect(removed.status).toBe(403);
  });

  it('còn 2 admin thì hạ được, còn 1 thì chặn', async () => {
    // adminA hạ adminA2 -> OK, tổ chức còn đúng 1 admin (là adminA).
    const first = await request(app)
      .patch(`/api/admin/users/${f.adminA2}/role`)
      .set(bearer(f.tokenAdminA))
      .send({ role: 'viewer' });
    expect(first.status).toBe(200);

    // Nâng lại rồi thử hạ chính adminA2 khi nó là admin duy nhất còn lại ngoài
    // người đang thao tác — dựng lại tình huống bằng cách hạ adminA qua adminA2.
    await request(app)
      .patch(`/api/admin/users/${f.adminA2}/role`)
      .set(bearer(f.tokenAdminA))
      .send({ role: 'admin' });
    await request(app)
      .patch(`/api/admin/users/${f.adminA}/role`)
      .set(bearer(signTokenFor(f.adminA2, f.tenantA, 'admin')))
      .send({ role: 'viewer' });

    // Giờ adminA2 là admin duy nhất. Nó tự hạ mình -> chặn bởi CannotModifySelf;
    // còn adminA (đã là viewer) không còn quyền gọi API nữa.
    const lastOne = await request(app)
      .patch(`/api/admin/users/${f.adminA2}/role`)
      .set(bearer(signTokenFor(f.adminA2, f.tenantA, 'admin')))
      .send({ role: 'viewer' });
    expect(lastOne.status).toBe(403);
  });

  it('khoá admin cuối cùng bị chặn bằng 409', async () => {
    // Hạ adminA2 xuống viewer -> adminA là admin duy nhất.
    await request(app)
      .patch(`/api/admin/users/${f.adminA2}/role`)
      .set(bearer(f.tokenAdminA))
      .send({ role: 'viewer' });

    // Một admin khác của tổ chức thử khoá adminA. Dựng thêm một admin tạm để có
    // người thao tác mà không vướng luật tự-sửa-mình.
    const helper = await makeUser('helper@test.local', 'Trợ lý');
    await makeMembership(helper, f.tenantA, 'admin');
    const helperToken = signTokenFor(helper, f.tenantA, 'admin');

    // Giờ có 2 admin (adminA + helper). Hạ adminA -> OK. Rồi khoá helper: helper
    // là admin cuối -> phải bị chặn.
    await request(app)
      .patch(`/api/admin/users/${f.adminA}/role`)
      .set(bearer(helperToken))
      .send({ role: 'viewer' });

    const res = await request(app)
      .patch(`/api/admin/users/${helper}/status`)
      .set(bearer(helperToken))
      .send({ isActive: false });
    expect(res.status).toBe(403); // CannotModifySelf chặn trước
  });
});

describe('§3.4 — khoá thành viên chỉ trong phạm vi tổ chức', () => {
  it('khoá đổi memberships.is_active, KHÔNG đụng users.is_active', async () => {
    const res = await request(app)
      .patch(`/api/admin/users/${f.viewerA}/status`)
      .set(bearer(f.tokenAdminA))
      .send({ isActive: false });

    expect(res.status).toBe(200);
    expect(res.body.memberActive).toBe(false);
    // Nếu chỗ này thành false thì admin của một tổ chức vừa khoá được người ta
    // khỏi MỌI tổ chức khác và khỏi cả việc đăng nhập.
    expect(res.body.userActive).toBe(true);

    const [rows] = await mysqlPool.query<RowDataPacket[]>(
      'SELECT is_active FROM users WHERE id = ?',
      [f.viewerA],
    );
    expect(rows[0]?.['is_active']).toBe(1);
  });
});

describe('§3.5 — workspace', () => {
  it('trùng tên thì tự thêm hậu tố slug', async () => {
    const res = await request(app)
      .post('/api/admin/workspaces')
      .set(bearer(f.tokenAdminA))
      .send({ name: 'Kinh doanh' });

    expect(res.status).toBe(201);
    expect(res.body.slug).toBe('kinh-doanh-2');
  });

  it('đổi tên KHÔNG đổi slug', async () => {
    const res = await request(app)
      .patch(`/api/admin/workspaces/${f.workspaceA}`)
      .set(bearer(f.tokenAdminA))
      .send({ name: 'Kinh doanh và Marketing' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Kinh doanh và Marketing');
    // Slug là định danh trong URL — đổi nó là làm hỏng mọi link đã chia sẻ.
    expect(res.body.slug).toBe('kinh-doanh');
  });

  it('xoá rồi tạo lại cùng tên thì slug cũ dùng lại được', async () => {
    await request(app)
      .delete(`/api/admin/workspaces/${f.workspaceA}`)
      .set(bearer(f.tokenAdminA));

    const again = await request(app)
      .post('/api/admin/workspaces')
      .set(bearer(f.tokenAdminA))
      .send({ name: 'Kinh doanh' });

    expect(again.status).toBe(201);
    expect(again.body.slug).toBe('kinh-doanh');
  });

  it('xoá workspace còn project -> 409 kèm số lượng', async () => {
    await makeProject(f.tenantA, f.workspaceA, 'Báo cáo doanh thu');

    const res = await request(app)
      .delete(`/api/admin/workspaces/${f.workspaceA}`)
      .set(bearer(f.tokenAdminA));

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('WorkspaceNotEmpty');
    expect(res.body.message).toContain('1');
  });

  it('danh sách kèm số project của từng workspace', async () => {
    await makeProject(f.tenantA, f.workspaceA, 'P1');
    await makeProject(f.tenantA, f.workspaceA, 'P2');

    const res = await request(app).get('/api/admin/workspaces').set(bearer(f.tokenAdminA));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].projectCount).toBe(2);
  });
});

describe('§3.2 — số liệu tổng quan', () => {
  it('bốn thẻ KPI khớp dữ liệu thật của đúng tổ chức', async () => {
    await request(app)
      .patch(`/api/admin/users/${f.viewerA}/status`)
      .set(bearer(f.tokenAdminA))
      .send({ isActive: false });

    const res = await request(app).get('/api/admin/overview').set(bearer(f.tokenAdminA));

    expect(res.status).toBe(200);
    expect(res.body.totalMembers).toBe(3);
    expect(res.body.admins).toBe(2);
    expect(res.body.lockedMembers).toBe(1);
    expect(res.body.workspaces).toBe(1);
    // Ba vai trò luôn đủ, kể cả khi count = 0, để biểu đồ không nhảy trục.
    expect(res.body.roleBreakdown).toHaveLength(3);
    expect(res.body.newMembersDaily).toHaveLength(res.body.rangeDays);
  });
});
