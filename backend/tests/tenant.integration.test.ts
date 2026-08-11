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
 * Test tích hợp KHU NGƯỜI DÙNG (Section 04).
 *
 * Chạy: `npm run test:integration` — cần MySQL + Redis, và database
 * `bi_platform_test` đã được migrate:
 *   $env:MYSQL_DATABASE='bi_platform_test'; npm --workspace backend run migrate
 *
 * ─── Bộ này kiểm điều NGƯỢC với bộ console ──────────────────────────────────
 *
 * `admin.integration.test.ts` kiểm rằng console NHÌN XUYÊN mọi tổ chức. Ở đây
 * thì ngược lại: cách ly tổ chức là toàn bộ vấn đề. Phần lớn khẳng định là
 * `not.toContain` và `expect(404)`.
 *
 * Hai khối quan trọng nhất, và vì sao:
 *
 *   "bảng route"   — mọi endpoint phải có guard. Viết theo bảng nên endpoint
 *                    THÊM MỚI mà quên gắn `requireRole` sẽ tự động làm đỏ CI,
 *                    không cần ai nhớ viết thêm test.
 *   "cách ly"      — quên một `WHERE tenant_id` là lỗ hổng nghiêm trọng nhất có
 *                    thể mắc ở phần này, và nó không gây lỗi nào nhìn thấy được.
 */

const app = createApp();

interface Fixture {
  tenantA: number;
  tenantB: number;
  /** Admin công ty A. */
  alice: number;
  /** Creator công ty A. */
  bob: number;
  /** Viewer công ty A. */
  dave: number;
  /** Admin công ty B — dùng để chứng minh cách ly. */
  carol: number;
  /** Superadmin CÓ membership ở A: chứng minh nền tảng không cho đi tắt. */
  root: number;
  wsA: number;
  wsA2: number;
  wsB: number;
  tokenAlice: string;
  tokenBob: string;
  tokenDave: string;
  tokenCarol: string;
}

let f: Fixture;

beforeEach(async () => {
  await resetDatabase();

  const tenantA = await makeTenant('Công ty Alpha', 'cong-ty-alpha');
  const tenantB = await makeTenant('Công ty Beta', 'cong-ty-beta');

  const alice = await makeUser('alice@alpha.test', 'Nguyễn Thị An');
  const bob = await makeUser('bob@alpha.test', 'Trần Văn Bình');
  const dave = await makeUser('dave@alpha.test', 'Phạm Văn Dũng');
  const carol = await makeUser('carol@beta.test', 'Lê Thị Cúc');
  const root = await makeUser('root@test.local', 'Quản trị hệ thống', {
    platformRole: 'superadmin',
  });

  await makeMembership(alice, tenantA, 'admin');
  await makeMembership(bob, tenantA, 'creator');
  await makeMembership(dave, tenantA, 'viewer');
  await makeMembership(carol, tenantB, 'admin');
  // Superadmin nhưng chỉ là `viewer` trong tổ chức này.
  await makeMembership(root, tenantA, 'viewer');

  f = {
    tenantA,
    tenantB,
    alice,
    bob,
    dave,
    carol,
    root,
    wsA: await makeWorkspace(tenantA, 'Kinh doanh', 'kinh-doanh'),
    wsA2: await makeWorkspace(tenantA, 'Kế toán', 'ke-toan'),
    wsB: await makeWorkspace(tenantB, 'Nhân sự', 'nhan-su'),
    tokenAlice: signTokenFor(alice, tenantA, 'admin'),
    tokenBob: signTokenFor(bob, tenantA, 'creator'),
    tokenDave: signTokenFor(dave, tenantA, 'viewer'),
    tokenCarol: signTokenFor(carol, tenantB, 'admin'),
  };
});

afterAll(async () => {
  await closeMysql();
  await closeRedis();
});

// ─────────────────────────────────────────────────────────────────────────────

describe('bảng route — mọi endpoint đều có guard', () => {
  type Method = 'get' | 'post' | 'patch' | 'delete';

  /** Đọc được với MỌI vai trò. */
  const READ_ROUTES: [Method, string][] = [
    ['get', '/api/v1/home'],
    ['get', '/api/v1/tenant'],
    ['get', '/api/v1/workspaces'],
    ['get', '/api/v1/members'],
  ];

  /** CHỈ admin tổ chức. */
  const ADMIN_ROUTES: [Method, string][] = [
    ['patch', '/api/v1/tenant'],
    ['post', '/api/v1/workspaces'],
    ['patch', '/api/v1/workspaces/1'],
    ['delete', '/api/v1/workspaces/1'],
    ['post', '/api/v1/members'],
    ['post', '/api/v1/members/1/reset-password'],
    ['patch', '/api/v1/members/1/role'],
    ['patch', '/api/v1/members/1/status'],
    ['delete', '/api/v1/members/1'],
  ];

  /** Admin HOẶC creator — viewer bị chặn. */
  const EDITOR_ROUTES: [Method, string][] = [
    ['post', '/api/v1/projects'],
    ['patch', '/api/v1/projects/1'],
    ['delete', '/api/v1/projects/1'],
  ];

  const ALL = [...READ_ROUTES, ...ADMIN_ROUTES, ...EDITOR_ROUTES];

  it.each(ALL)('không token: %s %s -> 401', async (method, path) => {
    const res = await request(app)[method](path);
    expect(res.status).toBe(401);
  });

  it.each([...ADMIN_ROUTES, ...EDITOR_ROUTES])(
    'viewer: %s %s -> 403',
    async (method, path) => {
      const res = await request(app)[method](path).set(bearer(f.tokenDave)).send({});
      expect(res.status).toBe(403);
    },
  );

  it.each(ADMIN_ROUTES)('creator: %s %s -> 403', async (method, path) => {
    const res = await request(app)[method](path).set(bearer(f.tokenBob)).send({});
    expect(res.status).toBe(403);
  });

  it.each(READ_ROUTES)('viewer ĐỌC được: %s %s -> 200', async (method, path) => {
    const res = await request(app)[method](path).set(bearer(f.tokenDave));
    expect(res.status).toBe(200);
  });
});

describe('superadmin KHÔNG đi tắt qua vai trò tổ chức', () => {
  /**
   * Người này là `superadmin` ở cấp nền tảng nhưng chỉ `viewer` trong công ty A.
   * Nếu `requireRole` cho superadmin đi tắt thì mọi kiểm tra quyền trong hệ thống
   * biến thành "trừ khi là superadmin", và một tài khoản vận hành bị chiếm là mất
   * sạch dữ liệu của MỌI tổ chức.
   */
  it('superadmin làm viewer trong tổ chức thì vẫn bị chặn như viewer', async () => {
    const token = signTokenFor(f.root, f.tenantA, 'viewer', 'superadmin');

    const res = await request(app)
      .post('/api/v1/workspaces')
      .set(bearer(token))
      .send({ name: 'Không gian mới' });

    expect(res.status).toBe(403);
  });
});

describe('token cũ — requireFreshMembership đọc lại từ database', () => {
  it('token ghi admin nhưng DB đã hạ xuống viewer -> 403', async () => {
    // Đúng tình huống của cửa sổ 7 ngày: token được cấp lúc còn là admin.
    await mysqlPool.query('UPDATE memberships SET role = ? WHERE user_id = ? AND tenant_id = ?', [
      'viewer',
      f.alice,
      f.tenantA,
    ]);

    const res = await request(app)
      .post('/api/v1/workspaces')
      .set(bearer(f.tokenAlice))
      .send({ name: 'Không gian mới' });

    expect(res.status).toBe(403);
  });

  it('đã bị gỡ khỏi tổ chức -> 401, không phải 403', async () => {
    // 401 vì đây là PHIÊN không còn giá trị, không phải chuyện thiếu quyền —
    // frontend thấy 401 sẽ đưa về trang đăng nhập, đúng việc cần làm.
    await mysqlPool.query(
      'UPDATE memberships SET removed_at = NOW(3), is_active = 0 WHERE user_id = ? AND tenant_id = ?',
      [f.alice, f.tenantA],
    );

    const res = await request(app).get('/api/v1/home').set(bearer(f.tokenAlice));
    expect(res.status).toBe(401);
  });

  it('tài khoản bị khoá TOÀN HỆ THỐNG -> 401', async () => {
    await mysqlPool.query('UPDATE users SET is_active = 0 WHERE id = ?', [f.alice]);

    const res = await request(app).get('/api/v1/home').set(bearer(f.tokenAlice));
    expect(res.status).toBe(401);
  });

  it('tổ chức bị khoá -> 401', async () => {
    await mysqlPool.query('UPDATE tenants SET is_active = 0 WHERE id = ?', [f.tenantA]);

    const res = await request(app).get('/api/v1/home').set(bearer(f.tokenAlice));
    expect(res.status).toBe(401);
  });
});

describe('cách ly tổ chức', () => {
  it('chỉ thấy workspace của tổ chức mình', async () => {
    const res = await request(app).get('/api/v1/workspaces').set(bearer(f.tokenAlice));

    expect(res.status).toBe(200);
    const slugs = (res.body as { slug: string }[]).map((w) => w.slug);
    expect(slugs).toContain('kinh-doanh');
    expect(slugs).toContain('ke-toan');
    expect(slugs).not.toContain('nhan-su');
  });

  it('chỉ thấy thành viên của tổ chức mình', async () => {
    const res = await request(app).get('/api/v1/members').set(bearer(f.tokenAlice));

    expect(res.status).toBe(200);
    const emails = (res.body as { items: { email: string }[] }).items.map((u) => u.email);
    expect(emails).toContain('bob@alpha.test');
    expect(emails).not.toContain('carol@beta.test');
  });

  it('workspace của tổ chức khác -> 404, KHÔNG phải 403', async () => {
    // 403 sẽ xác nhận rằng id đó có tồn tại. 404 không tiết lộ gì.
    const res = await request(app)
      .get(`/api/v1/home?workspaceId=${f.wsB}`)
      .set(bearer(f.tokenAlice));

    expect(res.status).toBe(404);
  });

  it('sửa workspace của tổ chức khác -> 404', async () => {
    const res = await request(app)
      .patch(`/api/v1/workspaces/${f.wsB}`)
      .set(bearer(f.tokenAlice))
      .send({ name: 'Bị chiếm' });

    expect(res.status).toBe(404);

    const [rows] = await mysqlPool.query<RowDataPacket[]>(
      'SELECT name FROM workspaces WHERE id = ?',
      [f.wsB],
    );
    expect(rows[0]?.['name']).toBe('Nhân sự');
  });

  it('đổi vai trò thành viên của tổ chức khác -> 404', async () => {
    const res = await request(app)
      .patch(`/api/v1/members/${f.carol}/role`)
      .set(bearer(f.tokenAlice))
      .send({ role: 'viewer' });

    expect(res.status).toBe(404);
  });

  it('project của tổ chức khác -> 404', async () => {
    const projectB = await makeProject(f.tenantB, f.wsB, 'Báo cáo Beta');

    const res = await request(app)
      .patch(`/api/v1/projects/${projectB}`)
      .set(bearer(f.tokenAlice))
      .send({ name: 'Bị chiếm' });

    expect(res.status).toBe(404);
  });

  it('không gắn được project vào workspace của tổ chức khác', async () => {
    const res = await request(app)
      .post('/api/v1/projects')
      .set(bearer(f.tokenAlice))
      .send({ workspaceId: f.wsB, name: 'Vượt biên' });

    expect(res.status).toBe(404);
  });
});

describe('trang Home (§4.3)', () => {
  it('không truyền workspaceId thì backend tự chọn cái đầu tiên và trả về', async () => {
    const res = await request(app).get('/api/v1/home').set(bearer(f.tokenAlice));

    expect(res.status).toBe(200);
    // Frontend cần biết mình đang xem workspace nào, kể cả khi không tự chọn.
    expect(res.body.workspace).toBeDefined();
    expect([f.wsA, f.wsA2]).toContain(res.body.workspace.id);
  });

  it('chỉ liệt kê project của workspace đang chọn', async () => {
    await makeProject(f.tenantA, f.wsA, 'Doanh thu');
    await makeProject(f.tenantA, f.wsA2, 'Công nợ');

    const res = await request(app)
      .get(`/api/v1/home?workspaceId=${f.wsA}`)
      .set(bearer(f.tokenAlice));

    const names = (res.body as { projects: { name: string }[] }).projects.map((p) => p.name);
    expect(names).toEqual(['Doanh thu']);
  });

  it('workspace bị quản trị hệ thống khoá -> 403, không lặng lẽ đổi sang cái khác', async () => {
    await mysqlPool.query('UPDATE workspaces SET is_active = 0 WHERE id = ?', [f.wsA]);

    const res = await request(app)
      .get(`/api/v1/home?workspaceId=${f.wsA}`)
      .set(bearer(f.tokenAlice));

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('WorkspaceLocked');
  });

  it('không còn workspace nào dùng được -> 409 NoWorkspace', async () => {
    await mysqlPool.query('UPDATE workspaces SET deleted_at = NOW(3) WHERE tenant_id = ?', [
      f.tenantA,
    ]);

    const res = await request(app).get('/api/v1/home').set(bearer(f.tokenAlice));

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('NoWorkspace');
  });
});

describe('project', () => {
  it('creator tạo, sửa và xoá được', async () => {
    const created = await request(app)
      .post('/api/v1/projects')
      .set(bearer(f.tokenBob))
      .send({ workspaceId: f.wsA, name: 'Doanh thu quý 3', description: 'Theo khu vực' });

    expect(created.status).toBe(201);
    expect(created.body.name).toBe('Doanh thu quý 3');
    // `created_by` phải là NGƯỜI GỌI, không phải giá trị nào client gửi lên.
    expect(created.body.createdBy).toBe(f.bob);

    const id = created.body.id as number;

    const updated = await request(app)
      .patch(`/api/v1/projects/${id}`)
      .set(bearer(f.tokenBob))
      .send({ name: 'Doanh thu quý 4' });
    expect(updated.status).toBe(200);
    expect(updated.body.name).toBe('Doanh thu quý 4');

    expect(
      (await request(app).delete(`/api/v1/projects/${id}`).set(bearer(f.tokenBob))).status,
    ).toBe(204);

    // Xoá MỀM: dòng vẫn còn, chỉ có `deleted_at`.
    const [rows] = await mysqlPool.query<RowDataPacket[]>(
      'SELECT deleted_at FROM projects WHERE id = ?',
      [id],
    );
    expect(rows[0]?.['deleted_at']).not.toBeNull();
  });

  it('sort ngoài whitelist -> 400, không đi vào ORDER BY', async () => {
    const res = await request(app)
      .get(`/api/v1/projects?workspaceId=${f.wsA}&sort=password_hash`)
      .set(bearer(f.tokenAlice));

    expect(res.status).toBe(400);
  });
});

describe('thông tin tổ chức (§6.2)', () => {
  /**
   * Tài liệu §6.2 hứa "Admin sửa được thông tin Company" nhưng trước đây không
   * có endpoint nào làm việc đó — tên tổ chức khai lúc đăng ký rồi đóng băng.
   *
   * Hai thứ đáng canh nhất ở đây đều là chuyện CÁCH LY, không phải chuyện form:
   * đường dẫn không có `:id` nên không thể sửa nhầm tổ chức khác, và `slug` phải
   * đứng yên vì nó là định danh đã đi ra ngoài.
   */
  it('admin đổi được tên, slug KHÔNG đổi theo', async () => {
    const res = await request(app)
      .patch('/api/v1/tenant')
      .set(bearer(f.tokenAlice))
      .send({ name: 'Công ty Alpha Toàn Cầu' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Công ty Alpha Toàn Cầu');
    // Đổi slug theo tên là phá mọi liên kết người khác đã lưu. Đây là cùng một
    // luật với đổi tên workspace.
    expect(res.body.slug).toBe('cong-ty-alpha');
    expect(res.body.id).toBe(f.tenantA);
  });

  it('chỉ đụng tổ chức TRONG TOKEN, không đụng tổ chức khác', async () => {
    await request(app)
      .patch('/api/v1/tenant')
      .set(bearer(f.tokenAlice))
      .send({ name: 'Alpha đổi tên' });

    const [rows] = await mysqlPool.query<RowDataPacket[]>(
      'SELECT id, name FROM tenants WHERE id IN (?, ?) ORDER BY id',
      [f.tenantA, f.tenantB],
    );
    const byId = Object.fromEntries(rows.map((r) => [Number(r['id']), r['name'] as string]));
    expect(byId[f.tenantA]).toBe('Alpha đổi tên');
    // Đường dẫn không có `:id` nên không có tham số nào để tráo — nhưng vẫn phải
    // có test, vì "không có tham số" là thứ một lần refactor có thể xoá mất.
    expect(byId[f.tenantB]).toBe('Công ty Beta');
  });

  it('GET trả về tổ chức đang mở, mọi vai trò đọc được', async () => {
    const res = await request(app).get('/api/v1/tenant').set(bearer(f.tokenDave));

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(f.tenantA);
    expect(res.body.slug).toBe('cong-ty-alpha');
  });

  it('creator và viewer KHÔNG đổi được tên', async () => {
    for (const token of [f.tokenBob, f.tokenDave]) {
      const res = await request(app)
        .patch('/api/v1/tenant')
        .set(bearer(token))
        .send({ name: 'Tên do người không có quyền đặt' });
      expect(res.status).toBe(403);
    }

    const [rows] = await mysqlPool.query<RowDataPacket[]>('SELECT name FROM tenants WHERE id = ?', [
      f.tenantA,
    ]);
    expect(rows[0]?.['name']).toBe('Công ty Alpha');
  });

  it('tên rỗng hoặc chỉ khoảng trắng -> 400', async () => {
    for (const name of ['', '   ', 'a']) {
      const res = await request(app)
        .patch('/api/v1/tenant')
        .set(bearer(f.tokenAlice))
        .send({ name });
      expect(res.status).toBe(400);
    }
  });

  it('khoảng trắng thừa bị gộp lại trước khi lưu', async () => {
    const res = await request(app)
      .patch('/api/v1/tenant')
      .set(bearer(f.tokenAlice))
      .send({ name: '  Công   ty   Alpha  ' });

    // Frontend nạp lại ô nhập từ phản hồi này, nên nếu backend chuẩn hoá mà
    // không trả về bản đã chuẩn hoá thì nút Lưu cứ sáng lên mãi.
    expect(res.body.name).toBe('Công ty Alpha');
  });

  it('KHÔNG đổi được slug dù có cố gửi lên', async () => {
    await request(app)
      .patch('/api/v1/tenant')
      .set(bearer(f.tokenAlice))
      .send({ name: 'Alpha', slug: 'toi-tu-dat-slug', id: f.tenantB });

    const [rows] = await mysqlPool.query<RowDataPacket[]>(
      'SELECT name, slug FROM tenants WHERE id = ?',
      [f.tenantA],
    );
    expect(rows[0]?.['slug']).toBe('cong-ty-alpha');
    expect(rows[0]?.['name']).toBe('Alpha');
  });
});

describe('workspace (§4.5)', () => {
  it('tạo, đổi tên (KHÔNG đổi slug), xoá', async () => {
    const created = await request(app)
      .post('/api/v1/workspaces')
      .set(bearer(f.tokenAlice))
      .send({ name: 'Marketing' });
    expect(created.status).toBe(201);
    expect(created.body.slug).toBe('marketing');

    const id = created.body.id as number;

    const renamed = await request(app)
      .patch(`/api/v1/workspaces/${id}`)
      .set(bearer(f.tokenAlice))
      .send({ name: 'Truyền thông' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe('Truyền thông');
    // Slug là định danh URL. Đổi tên mà viết lại slug là phá mọi link đã chia sẻ.
    expect(renamed.body.slug).toBe('marketing');

    expect(
      (await request(app).delete(`/api/v1/workspaces/${id}`).set(bearer(f.tokenAlice))).status,
    ).toBe(204);
  });

  it('xoá workspace còn project -> 409, không xoá lan sang project', async () => {
    const projectId = await makeProject(f.tenantA, f.wsA, 'Đang dùng');

    const res = await request(app)
      .delete(`/api/v1/workspaces/${f.wsA}`)
      .set(bearer(f.tokenAlice));

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('WorkspaceNotEmpty');

    const [rows] = await mysqlPool.query<RowDataPacket[]>(
      'SELECT deleted_at FROM projects WHERE id = ?',
      [projectId],
    );
    expect(rows[0]?.['deleted_at']).toBeNull();
  });

  it('xoá workspace CUỐI CÙNG -> 409', async () => {
    // Xoá cái thứ hai trước để chỉ còn một.
    await request(app).delete(`/api/v1/workspaces/${f.wsA2}`).set(bearer(f.tokenAlice));

    const res = await request(app)
      .delete(`/api/v1/workspaces/${f.wsA}`)
      .set(bearer(f.tokenAlice));

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('LastWorkspace');
  });

  it('xoá giải phóng slug để tạo lại cùng tên', async () => {
    await request(app).delete(`/api/v1/workspaces/${f.wsA2}`).set(bearer(f.tokenAlice));

    const again = await request(app)
      .post('/api/v1/workspaces')
      .set(bearer(f.tokenAlice))
      .send({ name: 'Kế toán' });

    expect(again.status).toBe(201);
    // Không giải phóng thì đây sẽ là `ke-toan-2` và tên sạch mất vĩnh viễn.
    expect(again.body.slug).toBe('ke-toan');
  });
});

describe('thành viên (§4.7)', () => {
  it('email chưa có -> tạo tài khoản kèm mật khẩu tạm, hiện đúng một lần', async () => {
    const res = await request(app)
      .post('/api/v1/members')
      .set(bearer(f.tokenAlice))
      .send({ email: 'eve@alpha.test', fullName: 'Đỗ Thị Ế', role: 'viewer' });

    expect(res.status).toBe(201);
    expect(res.body.mode).toBe('created');
    expect(typeof res.body.tempPassword).toBe('string');
    expect(res.body.user.mustChangePassword).toBe(true);
  });

  it('email ĐÃ CÓ ở tổ chức khác -> gắn vào, KHÔNG cấp mật khẩu mới', async () => {
    const res = await request(app)
      .post('/api/v1/members')
      .set(bearer(f.tokenAlice))
      .send({ email: 'carol@beta.test', fullName: 'Lê Thị Cúc', role: 'creator' });

    expect(res.status).toBe(201);
    expect(res.body.mode).toBe('attached');
    // Họ đã có mật khẩu riêng; admin tổ chức này không có quyền đặt lại mật khẩu
    // của một danh tính dùng chung.
    expect(res.body.tempPassword).toBeUndefined();
  });

  describe('tổ chức cá nhân cấp kèm tài khoản mới', () => {
    /**
     * Người tự đăng ký lập ra công ty của mình và làm `admin` ở đó. Người được
     * Admin tạo tài khoản trước đây không có gì của riêng mình — chỉ tồn tại bên
     * trong tổ chức của người mời. Migration 5 cấp cho họ một không gian riêng
     * ngang hàng: cùng bảng `tenants`, cùng workspace mặc định, cùng vai trò
     * `admin`.
     *
     * Hai thứ dễ hỏng nhất và cả hai đều IM LẶNG:
     *   - thứ tự chèn membership, quyết định đăng nhập vào đâu;
     *   - phép đếm "danh tính dùng chung" của nút cấp lại mật khẩu.
     */
    const inviteEve = () =>
      request(app)
        .post('/api/v1/members')
        .set(bearer(f.tokenAlice))
        .send({ email: 'eve@alpha.test', fullName: 'Đỗ Thị Ế', role: 'viewer' });

    /** Mọi membership của một người, kèm thông tin tổ chức, theo đúng thứ tự id. */
    async function membershipsOf(userId: number): Promise<RowDataPacket[]> {
      const [rows] = await mysqlPool.query<RowDataPacket[]>(
        `SELECT m.tenant_id, m.role, t.name, t.owner_user_id
           FROM memberships m JOIN tenants t ON t.id = m.tenant_id
          WHERE m.user_id = ? ORDER BY m.id ASC`,
        [userId],
      );
      return rows;
    }

    it('nhận HAI membership: tổ chức được mời, rồi không gian riêng làm admin', async () => {
      const created = await inviteEve();
      expect(created.status).toBe(201);

      const rows = await membershipsOf(created.body.user.userId as number);
      expect(rows).toHaveLength(2);

      // Thứ tự id CÓ NGHĨA: `listActiveByUser` sắp `m.id ASC` và màn đăng nhập
      // lấy phần tử đầu làm tổ chức mở sẵn.
      expect(Number(rows[0]?.['tenant_id'])).toBe(f.tenantA);
      expect(rows[0]?.['role']).toBe('viewer');
      expect(rows[0]?.['owner_user_id']).toBeNull();

      expect(rows[1]?.['role']).toBe('admin');
      expect(Number(rows[1]?.['owner_user_id'])).toBe(created.body.user.userId);
      expect(rows[1]?.['name']).toBe('Không gian của Đỗ Thị Ế');
    });

    it('không gian riêng có sẵn workspace mặc định', async () => {
      const created = await inviteEve();

      // Thiếu workspace thì `GET /v1/home` trả 409 NoWorkspace và người dùng mở
      // không gian của chính mình ra một màn hình lỗi.
      const [rows] = await mysqlPool.query<RowDataPacket[]>(
        `SELECT w.name FROM workspaces w JOIN tenants t ON t.id = w.tenant_id
          WHERE t.owner_user_id = ?`,
        [created.body.user.userId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.['name']).toBe('Không gian mặc định');
    });

    it('đăng nhập lần đầu rơi vào TỔ CHỨC ĐƯỢC MỜI, không phải không gian riêng', async () => {
      const created = await inviteEve();

      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'eve@alpha.test', password: created.body.tempPassword });

      expect(res.status).toBe(200);
      // Đây là lý do tài khoản được tạo ra. Mở ra một không gian trống rỗng thì
      // người vừa được mời sẽ tưởng mình bị mời nhầm chỗ.
      expect(res.body.tenant.id).toBe(f.tenantA);
      expect(res.body.role).toBe('viewer');

      const memberships = res.body.memberships as { id: number; isPersonal: boolean }[];
      expect(memberships).toHaveLength(2);
      // Đúng MỘT cái là của mình — dữ liệu nuôi nhãn trên bộ chuyển tổ chức.
      expect(memberships.filter((m) => m.isPersonal)).toHaveLength(1);
      expect(memberships.find((m) => m.id === f.tenantA)?.isPersonal).toBe(false);
    });

    it('đổi sang không gian riêng thì làm admin và tạo được workspace ở đó', async () => {
      const created = await inviteEve();
      const login = await request(app)
        .post('/api/auth/login')
        .send({ email: 'eve@alpha.test', password: created.body.tempPassword });

      const personal = (login.body.memberships as { id: number; isPersonal: boolean }[]).find(
        (m) => m.isPersonal,
      );
      expect(personal).toBeDefined();

      const switched = await request(app)
        .post('/api/auth/switch-tenant')
        .set(bearer(login.body.token))
        .send({ tenantId: personal?.id });

      expect(switched.status).toBe(200);
      expect(switched.body.role).toBe('admin');

      // Vai trò phải được THỰC THI chứ không chỉ hiển thị: Eve là `viewer` ở
      // công ty A, nên nếu token mới mang nhầm vai trò cũ thì câu này ra 403.
      const ws = await request(app)
        .post('/api/v1/workspaces')
        .set(bearer(switched.body.token))
        .send({ name: 'Ghi chú riêng' });

      expect(ws.status).toBe(201);
    });

    it('email ĐÃ CÓ (nhánh attached) thì KHÔNG sinh thêm tổ chức nào', async () => {
      const before = await membershipsOf(f.carol);

      await request(app)
        .post('/api/v1/members')
        .set(bearer(f.tokenAlice))
        .send({ email: 'carol@beta.test', fullName: 'Lê Thị Cúc', role: 'viewer' });

      // Đúng một dòng mới (tổ chức A). Cấp thêm không gian riêng cho người đã có
      // tài khoản là sinh tổ chức rác, và `uq_tenants_owner` cũng sẽ chặn ở lần
      // thứ hai — nhưng dưới dạng lỗi 500, không phải một hành vi có chủ đích.
      const after = await membershipsOf(f.carol);
      expect(after).toHaveLength(before.length + 1);
      expect(after.filter((r) => r['owner_user_id'] !== null)).toHaveLength(0);
    });

    it('cấp lại mật khẩu NGAY sau khi tạo tài khoản vẫn được — 200, không phải 409', async () => {
      // Hồi quy của cả thay đổi này. `countOtherActiveMemberships` đếm trơn "tổ
      // chức khác" thì không gian riêng vừa cấp làm mọi tài khoản mới trông như
      // danh tính dùng chung, và nút cấp lại mật khẩu trả 409 ở 100% số lần —
      // chết đúng tình huống nó sinh ra để cứu.
      const created = await inviteEve();

      const res = await request(app)
        .post(`/api/v1/members/${created.body.user.userId}/reset-password`)
        .set(bearer(f.tokenAlice));

      expect(res.status).toBe(200);
      expect(typeof res.body.tempPassword).toBe('string');
    });

    it('thành viên trong không gian riêng của NGƯỜI KHÁC vẫn là danh tính dùng chung', async () => {
      const created = await inviteEve();
      const eve = created.body.user.userId as number;

      // Alice có không gian riêng của mình rồi kéo Eve vào đó. Đứng từ Eve, đấy
      // là dữ liệu của người khác — mệnh đề lọc chỉ được bỏ qua không gian riêng
      // CỦA CHÍNH Eve, không phải mọi tổ chức cá nhân.
      const [tenant] = await mysqlPool.query<RowDataPacket[]>(
        'INSERT INTO tenants (name, slug, owner_user_id) VALUES (?, ?, ?)',
        ['Không gian của Nguyễn Thị An', 'khong-gian-cua-nguyen-thi-an', f.alice],
      );
      const aliceSpace = (tenant as unknown as { insertId: number }).insertId;
      await makeMembership(eve, aliceSpace, 'viewer');

      const res = await request(app)
        .post(`/api/v1/members/${eve}/reset-password`)
        .set(bearer(f.tokenAlice));

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('SharedIdentity');
    });
  });

  it('mời vào tổ chức mình KHÔNG đụng vai trò của họ ở tổ chức khác', async () => {
    // `upsert` dùng ON DUPLICATE KEY trên (user_id, tenant_id). Nếu khoá đó sai
    // hoặc tham số bị tráo thì mời một người vào công ty mình sẽ ghi đè vai trò
    // của họ ở công ty khác — một admin bị hạ thành viewer ở nơi ta không có
    // quyền gì cả, và không ai thấy chuyện đó xảy ra.
    const before = await mysqlPool.query<RowDataPacket[]>(
      'SELECT role FROM memberships WHERE user_id = ? AND tenant_id = ?',
      [f.carol, f.tenantB],
    );
    expect(before[0][0]?.['role']).toBe('admin');

    await request(app)
      .post('/api/v1/members')
      .set(bearer(f.tokenAlice))
      .send({ email: 'carol@beta.test', fullName: 'Lê Thị Cúc', role: 'viewer' });

    const [rows] = await mysqlPool.query<RowDataPacket[]>(
      'SELECT tenant_id, role FROM memberships WHERE user_id = ? ORDER BY tenant_id',
      [f.carol],
    );
    const byTenant = Object.fromEntries(
      rows.map((r) => [Number(r['tenant_id']), r['role'] as string]),
    );

    // Vai trò MỚI chỉ áp cho tổ chức của người mời…
    expect(byTenant[f.tenantA]).toBe('viewer');
    // …còn tổ chức cũ giữ nguyên.
    expect(byTenant[f.tenantB]).toBe('admin');
  });

  it('không tự đổi vai trò / tự khoá / tự gỡ chính mình', async () => {
    for (const call of [
      request(app)
        .patch(`/api/v1/members/${f.alice}/role`)
        .set(bearer(f.tokenAlice))
        .send({ role: 'viewer' }),
      request(app)
        .patch(`/api/v1/members/${f.alice}/status`)
        .set(bearer(f.tokenAlice))
        .send({ isActive: false }),
      request(app).delete(`/api/v1/members/${f.alice}`).set(bearer(f.tokenAlice)),
    ]) {
      const res = await call;
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('CannotModifySelf');
    }
  });

  it('không hạ cấp / khoá / gỡ ADMIN CUỐI CÙNG', async () => {
    // Alice là admin duy nhất của A. Nâng Bob lên admin rồi hạ Alice thì được;
    // nhưng hạ Bob trong lúc chỉ còn hai admin thì hợp lệ, còn hạ người cuối thì không.
    await mysqlPool.query('UPDATE memberships SET role = ? WHERE user_id = ? AND tenant_id = ?', [
      'admin',
      f.bob,
      f.tenantA,
    ]);
    const tokenBobAdmin = signTokenFor(f.bob, f.tenantA, 'admin');

    // Còn hai admin -> hạ Alice được.
    expect(
      (
        await request(app)
          .patch(`/api/v1/members/${f.alice}/role`)
          .set(bearer(tokenBobAdmin))
          .send({ role: 'viewer' })
      ).status,
    ).toBe(200);

    // Giờ Bob là admin duy nhất. Nâng Alice lên rồi thử hạ Bob bằng token Alice.
    await mysqlPool.query('UPDATE memberships SET role = ? WHERE user_id = ? AND tenant_id = ?', [
      'admin',
      f.alice,
      f.tenantA,
    ]);
    await mysqlPool.query('UPDATE memberships SET role = ? WHERE user_id = ? AND tenant_id = ?', [
      'viewer',
      f.bob,
      f.tenantA,
    ]);

    // Alice lại là admin duy nhất -> gỡ chính Alice bị chặn bởi CannotModifySelf,
    // nên dùng một admin thứ hai để thử gỡ Alice.
    await makeMembership(f.carol, f.tenantA, 'admin');
    const tokenCarolInA = signTokenFor(f.carol, f.tenantA, 'admin');
    await mysqlPool.query('UPDATE memberships SET role = ? WHERE user_id = ? AND tenant_id = ?', [
      'viewer',
      f.carol,
      f.tenantA,
    ]);

    const res = await request(app)
      .delete(`/api/v1/members/${f.alice}`)
      .set(bearer(tokenCarolInA));

    // Carol đã bị hạ xuống viewer trong A -> requireFreshMembership + requireRole
    // chặn ở cửa, chứ không phải luật admin-cuối-cùng. Cả hai đều là "không cho".
    expect(res.status).toBe(403);
  });

  it('khoá thành viên KHÔNG đụng users.is_active', async () => {
    const res = await request(app)
      .patch(`/api/v1/members/${f.bob}/status`)
      .set(bearer(f.tokenAlice))
      .send({ isActive: false });

    expect(res.status).toBe(200);

    // `users.is_active` là cột TOÀN CỤC. Admin của một tổ chức sửa nó là khoá
    // người ta khỏi mọi tổ chức khác và khỏi cả việc đăng nhập.
    const [rows] = await mysqlPool.query<RowDataPacket[]>(
      'SELECT is_active FROM users WHERE id = ?',
      [f.bob],
    );
    expect(rows[0]?.['is_active']).toBe(1);
  });

  it('gỡ thành viên KHÔNG xoá bản ghi users', async () => {
    expect(
      (await request(app).delete(`/api/v1/members/${f.bob}`).set(bearer(f.tokenAlice))).status,
    ).toBe(204);

    const [rows] = await mysqlPool.query<RowDataPacket[]>(
      'SELECT deleted_at FROM users WHERE id = ?',
      [f.bob],
    );
    expect(rows[0]?.['deleted_at']).toBeNull();
  });

  it('người đã gỡ biến khỏi danh sách mặc định, chỉ hiện khi lọc đúng', async () => {
    await request(app).delete(`/api/v1/members/${f.bob}`).set(bearer(f.tokenAlice));

    const normal = await request(app).get('/api/v1/members').set(bearer(f.tokenAlice));
    expect((normal.body.items as { email: string }[]).map((u) => u.email)).not.toContain(
      'bob@alpha.test',
    );

    const removed = await request(app)
      .get('/api/v1/members?status=removed')
      .set(bearer(f.tokenAlice));
    expect((removed.body.items as { email: string }[]).map((u) => u.email)).toContain(
      'bob@alpha.test',
    );
  });

  it('sort ngoài whitelist -> 400', async () => {
    const res = await request(app)
      .get('/api/v1/members?sort=password_hash')
      .set(bearer(f.tokenAlice));

    expect(res.status).toBe(400);
  });
});

describe('cấp lại mật khẩu tạm', () => {
  /**
   * Mật khẩu tạm hiện đúng một lần rồi biến mất vĩnh viễn — database chỉ giữ
   * hash bcrypt. Admin quên chép là người vừa được tạo tài khoản không đăng nhập
   * được, và trước khi có endpoint này thì KHÔNG có lối thoát nào: gỡ rồi mời
   * lại cũng vô ích, vì `createMember` thấy email đã tồn tại nên đi vào nhánh
   * 'attached' và cố ý không cấp mật khẩu.
   *
   * Bộ test này canh hai thứ khác hẳn nhau. Nhóm đầu: nó có THẬT SỰ cứu được
   * tài khoản không. Nhóm sau: nó có mở ra đường chiếm tài khoản người khác
   * không — vì đặt lại mật khẩu là quyền duy nhất trong màn này cho phép ĐĂNG
   * NHẬP BẰNG tài khoản người khác, chứ không chỉ sửa dữ liệu của họ.
   */

  /** Tạo một thành viên mới qua API và trả về id + mật khẩu tạm đầu tiên. */
  async function inviteEve(): Promise<{ userId: number; password: string }> {
    const res = await request(app)
      .post('/api/v1/members')
      .set(bearer(f.tokenAlice))
      .send({ email: 'eve@alpha.test', fullName: 'Đỗ Thị Ế', role: 'viewer' });

    expect(res.status).toBe(201);
    return { userId: res.body.user.userId as number, password: res.body.tempPassword as string };
  }

  const login = (email: string, password: string) =>
    request(app).post('/api/auth/login').send({ email, password });

  it('mật khẩu MỚI đăng nhập được, mật khẩu cũ chết ngay', async () => {
    const eve = await inviteEve();

    // Mật khẩu tạm đầu tiên phải dùng được trước đã — nếu không thì mọi khẳng
    // định phía dưới đều đúng vì lý do sai.
    expect((await login('eve@alpha.test', eve.password)).status).toBe(200);

    const res = await request(app)
      .post(`/api/v1/members/${eve.userId}/reset-password`)
      .set(bearer(f.tokenAlice));

    expect(res.status).toBe(200);
    const fresh = res.body.tempPassword as string;
    expect(typeof fresh).toBe('string');
    expect(fresh).not.toBe(eve.password);

    // Đây mới là khẳng định quan trọng: đây là CẤP LẠI, không phải xem lại.
    // Mật khẩu cũ phải chết, kể cả khi ai đó đã kịp chép nó đi đâu đó.
    expect((await login('eve@alpha.test', eve.password)).status).toBe(401);

    const withNew = await login('eve@alpha.test', fresh);
    expect(withNew.status).toBe(200);
    expect(withNew.body.mustChangePassword).toBe(true);
  });

  it('bật lại must_change_password kể cả khi người dùng đã tự đổi mật khẩu', async () => {
    const eve = await inviteEve();
    await mysqlPool.query('UPDATE users SET must_change_password = 0 WHERE id = ?', [eve.userId]);

    const res = await request(app)
      .post(`/api/v1/members/${eve.userId}/reset-password`)
      .set(bearer(f.tokenAlice));

    expect(res.status).toBe(200);
    // Admin vừa đọc mật khẩu này trên màn hình, nên nó phải chết sau lần đăng
    // nhập đầu tiên của chủ tài khoản.
    expect(res.body.user.mustChangePassword).toBe(true);
  });

  it('KHÔNG đụng vai trò hay trạng thái thành viên', async () => {
    const res = await request(app)
      .post(`/api/v1/members/${f.bob}/reset-password`)
      .set(bearer(f.tokenAlice));

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('creator');
    expect(res.body.user.memberActive).toBe(true);
  });

  it('không tự cấp lại cho chính mình', async () => {
    const res = await request(app)
      .post(`/api/v1/members/${f.alice}/reset-password`)
      .set(bearer(f.tokenAlice));

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('CannotModifySelf');
  });

  it('thành viên của tổ chức khác -> 404, KHÔNG phải 403', async () => {
    // Carol chỉ thuộc công ty B. 403 sẽ xác nhận rằng id đó có tồn tại.
    const res = await request(app)
      .post(`/api/v1/members/${f.carol}/reset-password`)
      .set(bearer(f.tokenAlice));

    expect(res.status).toBe(404);
  });

  it('người đã bị gỡ khỏi tổ chức -> 404', async () => {
    await request(app).delete(`/api/v1/members/${f.dave}`).set(bearer(f.tokenAlice));

    const res = await request(app)
      .post(`/api/v1/members/${f.dave}/reset-password`)
      .set(bearer(f.tokenAlice));

    expect(res.status).toBe(404);
  });

  it('tài khoản bị khoá TOÀN HỆ THỐNG -> 409, không cấp mật khẩu mới', async () => {
    await mysqlPool.query('UPDATE users SET is_active = 0 WHERE id = ?', [f.dave]);

    const res = await request(app)
      .post(`/api/v1/members/${f.dave}/reset-password`)
      .set(bearer(f.tokenAlice));

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('AccountUnavailable');
  });

  it('KHÔNG đặt lại được mật khẩu của quản trị viên HỆ THỐNG', async () => {
    // `root` là superadmin và đồng thời là viewer trong công ty A. Nếu admin tổ
    // chức đặt lại được mật khẩu của họ thì một tài khoản không có quyền gì
    // ngoài phạm vi công ty mình vừa chiếm được console vận hành toàn hệ thống.
    const res = await request(app)
      .post(`/api/v1/members/${f.root}/reset-password`)
      .set(bearer(f.tokenAlice));

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('PlatformAdminProtected');
  });

  /**
   * Chốt quan trọng nhất: tài khoản DÙNG CHUNG giữa nhiều tổ chức.
   *
   * `createMember` đã cố ý không cấp mật khẩu ở nhánh 'attached' vì lý do đó.
   * Nếu `reset-password` bỏ qua luật này thì nó mở lại đúng cái cửa vừa khoá:
   * mời một email bất kỳ vào công ty mình, bấm cấp lại mật khẩu, và đăng nhập
   * được vào tài khoản người ta đang dùng ở công ty khác.
   */
  describe('tài khoản dùng chung với tổ chức khác', () => {
    /** Alice mời Carol sang công ty A. Carol giờ là thành viên HỢP LỆ của A. */
    async function attachCarolToA(): Promise<void> {
      const res = await request(app)
        .post('/api/v1/members')
        .set(bearer(f.tokenAlice))
        .send({ email: 'carol@beta.test', fullName: 'Lê Thị Cúc', role: 'viewer' });
      expect(res.body.mode).toBe('attached');
    }

    const resetCarol = () =>
      request(app).post(`/api/v1/members/${f.carol}/reset-password`).set(bearer(f.tokenAlice));

    it('-> 409 SharedIdentity, và mật khẩu của họ còn nguyên', async () => {
      await attachCarolToA();

      const res = await resetCarol();
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('SharedIdentity');

      // Mã lỗi đúng mà vẫn ghi đè hash thì lỗ hổng vẫn còn nguyên. Chứng minh
      // bằng thứ duy nhất không nói dối được: đăng nhập bằng mật khẩu cũ.
      expect((await login('carol@beta.test', 'Matkhau123')).status).toBe(200);
    });

    it('membership bên kia đang bị KHOÁ vẫn tính là dùng chung', async () => {
      await attachCarolToA();
      await mysqlPool.query(
        'UPDATE memberships SET is_active = 0 WHERE user_id = ? AND tenant_id = ?',
        [f.carol, f.tenantB],
      );

      // "Còn đang bị khoá" không phải là "không còn nữa": bên kia mở lại lúc nào
      // cũng được. Lọc `is_active` ra khỏi phép đếm nghĩa là chỉ cần chờ đúng
      // lúc công ty B khoá tạm là chiếm được tài khoản.
      const res = await resetCarol();
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('SharedIdentity');
    });

    it('đã bị GỠ hẳn khỏi tổ chức kia thì cấp lại được', async () => {
      await attachCarolToA();
      await mysqlPool.query(
        `UPDATE memberships SET removed_at = CURRENT_TIMESTAMP(3), is_active = 0
          WHERE user_id = ? AND tenant_id = ?`,
        [f.carol, f.tenantB],
      );

      // Gỡ khỏi tổ chức là hành động một chiều có chủ đích, khác hẳn khoá tạm.
      // Tài khoản không còn dùng chung nữa, nên A cấp lại được.
      const res = await resetCarol();
      expect(res.status).toBe(200);
      expect(typeof res.body.tempPassword).toBe('string');
    });
  });
});

describe('đổi tổ chức (§5.1)', () => {
  /**
   * Bob là `creator` ở công ty A. Cho anh ta thêm một membership `viewer` ở công
   * ty B để có người thật sự thuộc hai tổ chức với hai vai trò khác nhau — đó là
   * hình dạng duy nhất mà bài kiểm "không mang vai trò cũ sang" có nghĩa.
   */
  beforeEach(async () => {
    await makeMembership(f.bob, f.tenantB, 'viewer');
  });

  it('đổi sang tổ chức mình là thành viên -> token mới, vai trò của tổ chức MỚI', async () => {
    const res = await request(app)
      .post('/api/auth/switch-tenant')
      .set(bearer(f.tokenBob))
      .send({ tenantId: f.tenantB });

    expect(res.status).toBe(200);
    expect(res.body.tenant.id).toBe(f.tenantB);
    // Bob là `creator` ở A nhưng `viewer` ở B. Mang vai trò cũ sang là leo thang
    // đặc quyền ngang hàng.
    expect(res.body.role).toBe('viewer');
    expect(typeof res.body.token).toBe('string');
  });

  it('token mới thật sự mở tổ chức mới, và CHỈ tổ chức đó', async () => {
    const switched = await request(app)
      .post('/api/auth/switch-tenant')
      .set(bearer(f.tokenBob))
      .send({ tenantId: f.tenantB });

    const newToken = switched.body.token as string;

    const ws = await request(app).get('/api/v1/workspaces').set(bearer(newToken));
    const slugs = (ws.body as { slug: string }[]).map((w) => w.slug);
    expect(slugs).toContain('nhan-su');
    expect(slugs).not.toContain('kinh-doanh');
  });

  it('vai trò mới được THỰC THI, không chỉ hiển thị', async () => {
    const switched = await request(app)
      .post('/api/auth/switch-tenant')
      .set(bearer(f.tokenBob))
      .send({ tenantId: f.tenantB });

    // Ở A anh ta là creator nên tạo được project. Ở B là viewer -> phải 403.
    const res = await request(app)
      .post('/api/v1/projects')
      .set(bearer(switched.body.token as string))
      .send({ workspaceId: f.wsB, name: 'Thử vượt quyền' });

    expect(res.status).toBe(403);
  });

  it('tổ chức mình KHÔNG thuộc về -> 403, không cấp token', async () => {
    // Alice chỉ thuộc công ty A. Đây là cửa quan trọng nhất của endpoint: nếu
    // `tenantId` gửi lên được tin thì bất kỳ ai cũng tự cấp cho mình một token
    // mở tổ chức bất kỳ.
    const res = await request(app)
      .post('/api/auth/switch-tenant')
      .set(bearer(f.tokenAlice))
      .send({ tenantId: f.tenantB });

    expect(res.status).toBe(403);
    expect(res.body.token).toBeUndefined();
  });

  it('tổ chức không tồn tại -> 403', async () => {
    const res = await request(app)
      .post('/api/auth/switch-tenant')
      .set(bearer(f.tokenAlice))
      .send({ tenantId: 999999 });

    expect(res.status).toBe(403);
  });

  it('membership đã bị gỡ -> 403 dù danh sách cũ còn hiện tên tổ chức', async () => {
    await mysqlPool.query(
      'UPDATE memberships SET removed_at = NOW(3), is_active = 0 WHERE user_id = ? AND tenant_id = ?',
      [f.bob, f.tenantB],
    );

    const res = await request(app)
      .post('/api/auth/switch-tenant')
      .set(bearer(f.tokenBob))
      .send({ tenantId: f.tenantB });

    expect(res.status).toBe(403);
  });

  it('tổ chức đích bị khoá -> 403', async () => {
    await mysqlPool.query('UPDATE tenants SET is_active = 0 WHERE id = ?', [f.tenantB]);

    const res = await request(app)
      .post('/api/auth/switch-tenant')
      .set(bearer(f.tokenBob))
      .send({ tenantId: f.tenantB });

    expect(res.status).toBe(403);
  });

  it('tài khoản bị khoá toàn hệ thống -> 403', async () => {
    await mysqlPool.query('UPDATE users SET is_active = 0 WHERE id = ?', [f.bob]);

    const res = await request(app)
      .post('/api/auth/switch-tenant')
      .set(bearer(f.tokenBob))
      .send({ tenantId: f.tenantB });

    expect(res.status).toBe(403);
  });

  it('không token -> 401', async () => {
    const res = await request(app).post('/api/auth/switch-tenant').send({ tenantId: f.tenantB });
    expect(res.status).toBe(401);
  });

  it('tenantId không phải số -> 400', async () => {
    const res = await request(app)
      .post('/api/auth/switch-tenant')
      .set(bearer(f.tokenBob))
      .send({ tenantId: '2' });

    expect(res.status).toBe(400);
  });

  it('trả về đủ danh sách tổ chức để dropdown vẽ được ngay', async () => {
    const res = await request(app)
      .post('/api/auth/switch-tenant')
      .set(bearer(f.tokenBob))
      .send({ tenantId: f.tenantB });

    const ids = (res.body.memberships as { id: number }[]).map((m) => m.id);
    expect(ids).toContain(f.tenantA);
    expect(ids).toContain(f.tenantB);
  });
});

describe('hồ sơ cá nhân (§4.4)', () => {
  it('sửa được tên, điện thoại chuẩn hoá về +84', async () => {
    const res = await request(app)
      .patch('/api/auth/me')
      .set(bearer(f.tokenDave))
      .send({ fullName: 'Phạm Văn Dũng', phone: '0987 654 321' });

    expect(res.status).toBe(200);
    expect(res.body.phone).toBe('+84987654321');
  });

  it('gửi thiếu trường thì GIỮ NGUYÊN giá trị cũ (đúng nghĩa PATCH)', async () => {
    await request(app)
      .patch('/api/auth/me')
      .set(bearer(f.tokenDave))
      .send({ phone: '0987654321' });

    const res = await request(app)
      .patch('/api/auth/me')
      .set(bearer(f.tokenDave))
      .send({ fullName: 'Tên Mới' });

    expect(res.body.fullName).toBe('Tên Mới');
    expect(res.body.phone).toBe('+84987654321');
  });

  it('chuỗi rỗng nghĩa là XOÁ TRỐNG', async () => {
    await request(app)
      .patch('/api/auth/me')
      .set(bearer(f.tokenDave))
      .send({ phone: '0987654321' });

    const res = await request(app).patch('/api/auth/me').set(bearer(f.tokenDave)).send({ phone: '' });

    expect(res.body.phone).toBeNull();
  });

  it('KHÔNG đổi được email, vai trò nền tảng hay trạng thái khoá', async () => {
    const res = await request(app).patch('/api/auth/me').set(bearer(f.tokenDave)).send({
      fullName: 'Kẻ tấn công',
      email: 'attacker@evil.com',
      role: 'superadmin',
      isActive: false,
    });

    expect(res.status).toBe(200);
    // Zod strip những khoá không khai báo, nên chúng không bao giờ tới câu UPDATE.
    expect(res.body.email).toBe('dave@alpha.test');
    expect(res.body.platformRole).toBe('user');
    expect(res.body.isActive).toBe(true);
  });

  it('sửa hồ sơ người khác là chuyện không tồn tại — chỉ có /me', async () => {
    // Không có endpoint nào nhận userId từ client. Bài test này là bản ghi của
    // quyết định đó: nếu ai đó thêm `PATCH /users/:id` thì phải nghĩ lại từ đầu.
    const res = await request(app)
      .patch(`/api/auth/me?userId=${f.alice}`)
      .set(bearer(f.tokenDave))
      .send({ fullName: 'Đổi tên người khác' });

    expect(res.status).toBe(200);
    const [rows] = await mysqlPool.query<RowDataPacket[]>(
      'SELECT full_name FROM users WHERE id = ?',
      [f.alice],
    );
    expect(rows[0]?.['full_name']).toBe('Nguyễn Thị An');
  });
});
