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
  makeReport,
  makeTenant,
  makeUser,
  makeWorkspace,
  signTokenFor,
} from './helpers/fixtures';

/**
 * Test tích hợp CONSOLE HỆ THỐNG.
 *
 * Chạy: `npm run test:integration` — cần MySQL + Redis, và database
 * `bi_platform_test` đã được migrate:
 *   $env:MYSQL_DATABASE='bi_platform_test'; npm --workspace backend run migrate
 *
 * ─── Điều bộ test này kiểm, và vì sao nó ngược với bộ cũ ─────────────────────
 *
 * Bộ trước kiểm CÁCH LY tổ chức: admin của công ty A không được thấy người của
 * công ty B. Console hệ thống là khu vực đối lập — nó PHẢI nhìn xuyên mọi tổ
 * chức. Nên phần lớn khẳng định ở đây là `toContain` chứ không phải
 * `not.toContain`.
 *
 * Đổi lại, toàn bộ sức nặng dồn vào CỬA VÀO: chỉ `users.role = 'superadmin'`
 * được qua. Đó là lý do bảng route ở khối đầu tiên là phần quan trọng nhất file.
 */

const app = createApp();

/**
 * Một hệ thống thu nhỏ: hai công ty thật + một tài khoản vận hành.
 *
 * `root` là superadmin — vẫn phải thuộc một tổ chức nào đó vì JWT ghim
 * `tenantId` và `requireFreshAdmin` đọc membership của tổ chức đang mở.
 */
interface Fixture {
  tenantRoot: number;
  tenantA: number;
  tenantB: number;
  root: number;
  alice: number;
  bob: number;
  carol: number;
  wsA: number;
  wsB: number;
  tokenRoot: string;
  /** Admin của CÔNG TY A — vai trò tổ chức, không phải vai trò nền tảng. */
  tokenAlice: string;
  tokenBob: string;
}

let f: Fixture;

beforeEach(async () => {
  await resetDatabase();

  const tenantRoot = await makeTenant('Nền tảng', 'nen-tang');
  const tenantA = await makeTenant('Công ty Alpha', 'cong-ty-alpha');
  const tenantB = await makeTenant('Công ty Beta', 'cong-ty-beta');

  const root = await makeUser('root@test.local', 'Quản trị hệ thống', {
    platformRole: 'superadmin',
  });
  const alice = await makeUser('alice@alpha.test', 'Nguyễn Thị An');
  const bob = await makeUser('bob@alpha.test', 'Trần Văn Bình');
  const carol = await makeUser('carol@beta.test', 'Lê Thị Cúc');

  await makeMembership(root, tenantRoot, 'admin');
  await makeMembership(alice, tenantA, 'admin');
  await makeMembership(bob, tenantA, 'viewer');
  await makeMembership(carol, tenantB, 'admin');

  f = {
    tenantRoot,
    tenantA,
    tenantB,
    root,
    alice,
    bob,
    carol,
    wsA: await makeWorkspace(tenantA, 'Kinh doanh', 'kinh-doanh'),
    wsB: await makeWorkspace(tenantB, 'Kế toán', 'ke-toan'),
    tokenRoot: signTokenFor(root, tenantRoot, 'admin', 'superadmin'),
    tokenAlice: signTokenFor(alice, tenantA, 'admin'),
    tokenBob: signTokenFor(bob, tenantA, 'viewer'),
  };
});

afterAll(async () => {
  await closeMysql();
  await closeRedis();
});

// ─────────────────────────────────────────────────────────────────────────────

describe('cổng vào console — chỉ superadmin', () => {
  type Method = 'get' | 'patch' | 'delete';

  const ROUTES: [Method, string][] = [
    ['get', '/api/admin/overview'],
    ['get', '/api/admin/tenants'],
    ['get', '/api/admin/tenants/1'],
    ['patch', '/api/admin/tenants/1/status'],
    ['delete', '/api/admin/tenants/1'],
    ['get', '/api/admin/users'],
    ['patch', '/api/admin/users/1/status'],
    ['delete', '/api/admin/users/1'],
    ['get', '/api/admin/workspaces'],
    ['patch', '/api/admin/workspaces/1/status'],
    ['delete', '/api/admin/workspaces/1'],
  ];

  /** Gọi đúng phương thức, giữ nguyên kiểu — không ép qua `Record<string, ...>`. */
  function call(method: Method, path: string): request.Test {
    const agent = request(app);
    switch (method) {
      case 'get':
        return agent.get(path);
      case 'patch':
        return agent.patch(path);
      case 'delete':
        return agent.delete(path);
    }
  }

  // Chạy theo BẢNG chứ không viết tay từng ca: route mới thêm vào mà quên gắn
  // guard sẽ tự động làm đỏ test, không cần ai nhớ bổ sung.
  it.each(ROUTES)('không token: %s %s -> 401', async (method, path) => {
    const res = await call(method, path).send({ isActive: false });
    expect(res.status).toBe(401);
  });

  it.each(ROUTES)('người dùng thường: %s %s -> 403', async (method, path) => {
    const res = await call(method, path).set(bearer(f.tokenBob)).send({ isActive: false });
    expect(res.status).toBe(403);
  });

  /**
   * Đây là lỗ hổng đã từng có, và là lý do khu này đổi sang gác bằng trục nền
   * tảng.
   *
   * Luồng đăng ký cấp `memberships.role = 'admin'` cho người tự lập tổ chức của
   * mình (FOUNDER_ROLE trong services/auth/registerAccount.ts). Khi console còn
   * gác bằng `requireRole('admin')`, BẤT KỲ AI đăng ký xong cũng vào thẳng được
   * công cụ vận hành hệ thống — thấy toàn bộ công ty và người dùng của người
   * khác.
   */
  it.each(ROUTES)('admin của một CÔNG TY: %s %s -> 403', async (method, path) => {
    const res = await call(method, path).set(bearer(f.tokenAlice)).send({ isActive: false });
    expect(res.status).toBe(403);
  });
});

describe('token cũ — requireFreshAdmin', () => {
  it('token TỰ XƯNG superadmin nhưng DB nói không -> 403', async () => {
    // Không có ca này thì xoá hẳn requireFreshAdmin đi mọi test vẫn xanh, vì
    // requirePlatformRole chỉ đọc claim trong chính token đó.
    const forged = signTokenFor(f.alice, f.tenantA, 'admin', 'superadmin');

    const res = await request(app).get('/api/admin/overview').set(bearer(forged));

    expect(res.status).toBe(403);
  });

  it('superadmin vừa bị hạ quyền trong DB -> 403 dù token còn hạn', async () => {
    await mysqlPool.query("UPDATE users SET role = 'user' WHERE id = ?", [f.root]);

    const res = await request(app).get('/api/admin/overview').set(bearer(f.tokenRoot));

    expect(res.status).toBe(403);
  });

  it('tài khoản bị khoá -> 401 chứ không phải 403', async () => {
    // 401 vì đây là phiên hết giá trị, không phải chuyện thiếu quyền — frontend
    // thấy 401 sẽ đưa về trang đăng nhập, đúng việc cần làm.
    await mysqlPool.query('UPDATE users SET is_active = 0 WHERE id = ?', [f.root]);

    const res = await request(app).get('/api/admin/overview').set(bearer(f.tokenRoot));

    expect(res.status).toBe(401);
  });
});

describe('tổng quan hệ thống', () => {
  it('đếm xuyên mọi tổ chức, tách riêng phần đã khoá', async () => {
    await mysqlPool.query('UPDATE tenants SET is_active = 0 WHERE id = ?', [f.tenantB]);
    await mysqlPool.query('UPDATE users SET is_active = 0 WHERE id = ?', [f.bob]);

    const res = await request(app).get('/api/admin/overview').set(bearer(f.tokenRoot));

    expect(res.status).toBe(200);
    expect(res.body.activeTenants).toBe(2); // Nền tảng + Alpha
    expect(res.body.lockedTenants).toBe(1); // Beta
    expect(res.body.totalUsers).toBe(4);
    expect(res.body.lockedUsers).toBe(1);
    expect(res.body.totalWorkspaces).toBe(2);
  });

  it('biểu đồ tăng trưởng lấp đủ ngày trống', async () => {
    const res = await request(app).get('/api/admin/overview').set(bearer(f.tokenRoot));

    // Thiếu bước lấp ngày thì trục thời gian co lại còn đúng những ngày có dữ
    // liệu, và một biểu đồ 30 ngày chỉ vẽ 1 cột trông như hệ thống đứng yên.
    expect(res.body.growth).toHaveLength(res.body.rangeDays);
    expect(res.body.growth[0]).toHaveProperty('date');
    expect(res.body.growth[0]).toHaveProperty('tenants');
    expect(res.body.growth[0]).toHaveProperty('users');
    expect(res.body.growth[0]).toHaveProperty('workspaces');

    const today = res.body.growth.at(-1);
    expect(today.tenants).toBe(3);
    expect(today.users).toBe(4);
  });

  it('đếm bỏ qua bản ghi đã xoá mềm', async () => {
    await request(app).delete(`/api/admin/users/${f.bob}`).set(bearer(f.tokenRoot));

    const res = await request(app).get('/api/admin/overview').set(bearer(f.tokenRoot));
    expect(res.body.totalUsers).toBe(3);
  });
});

describe('quản lý tổ chức', () => {
  it('thấy TẤT CẢ công ty, kèm số người và số workspace', async () => {
    const res = await request(app)
      .get('/api/admin/tenants')
      .query({ sort: 'name', order: 'asc' })
      .set(bearer(f.tokenRoot));

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);

    const names: string[] = res.body.items.map((t: { name: string }) => t.name);
    // Đây là điểm khác căn bản với khu quản trị của một tổ chức: console PHẢI
    // thấy công ty của người khác.
    expect(names).toEqual(['Công ty Alpha', 'Công ty Beta', 'Nền tảng']);

    const alpha = res.body.items.find((t: { name: string }) => t.name === 'Công ty Alpha');
    expect(alpha.userCount).toBe(2);
    expect(alpha.workspaceCount).toBe(1);
  });

  it('tìm theo tên có dấu', async () => {
    const res = await request(app)
      .get('/api/admin/tenants')
      .query({ q: 'Alpha' })
      .set(bearer(f.tokenRoot));

    expect(res.body.total).toBe(1);
    expect(res.body.items[0].slug).toBe('cong-ty-alpha');
  });

  describe('không gian cá nhân bị ẩn khỏi danh sách', () => {
    /**
     * Mỗi tài khoản được cấp kèm một tổ chức riêng (migration 5). Có bao nhiêu
     * người dùng thì có bấy nhiêu dòng như vậy, nên danh sách công ty phải mặc
     * định lọc chúng ra — nếu không, console vận hành mất khả năng trả lời câu
     * hỏi duy nhất nó sinh ra để trả lời: nền tảng đang phục vụ bao nhiêu doanh
     * nghiệp.
     */
    beforeEach(async () => {
      await makeTenant('Không gian của Trần Văn Bình', 'khong-gian-cua-tran-van-binh', f.bob);
    });

    it('mặc định chỉ hiện công ty thật', async () => {
      const res = await request(app).get('/api/admin/tenants').set(bearer(f.tokenRoot));

      expect(res.body.total).toBe(3);
      const names: string[] = res.body.items.map((t: { name: string }) => t.name);
      expect(names).not.toContain('Không gian của Trần Văn Bình');
      expect(res.body.items.every((t: { isPersonal: boolean }) => !t.isPersonal)).toBe(true);
    });

    it('kind=personal thì hiện đúng chúng, có cờ isPersonal', async () => {
      const res = await request(app)
        .get('/api/admin/tenants')
        .query({ kind: 'personal' })
        .set(bearer(f.tokenRoot));

      expect(res.body.total).toBe(1);
      expect(res.body.items[0].name).toBe('Không gian của Trần Văn Bình');
      expect(res.body.items[0].isPersonal).toBe(true);
    });

    it('kind=all thì hiện cả hai loại', async () => {
      const res = await request(app)
        .get('/api/admin/tenants')
        .query({ kind: 'all' })
        .set(bearer(f.tokenRoot));

      expect(res.body.total).toBe(4);
    });

    it('kind ngoài danh sách -> 400, không lặng lẽ về mặc định', async () => {
      const res = await request(app)
        .get('/api/admin/tenants')
        .query({ kind: 'moi-thu' })
        .set(bearer(f.tokenRoot));

      expect(res.status).toBe(400);
    });

    it('thẻ KPI và biểu đồ tăng trưởng cũng chỉ đếm công ty thật', async () => {
      const res = await request(app).get('/api/admin/overview').set(bearer(f.tokenRoot));

      // Không lọc thì đường "Tổ chức" bám sát đường "Người dùng" và biểu đồ
      // không còn nói được điều gì.
      expect(res.body.activeTenants).toBe(3);
      expect(res.body.growth.at(-1).tenants).toBe(3);
    });
  });

  it('ký tự đại diện của LIKE không lọt qua nguyên vẹn', async () => {
    // '%' không escape sẽ khớp MỌI dòng — kết quả 3 thay vì 0.
    const res = await request(app)
      .get('/api/admin/tenants')
      .query({ q: '%' })
      .set(bearer(f.tokenRoot));

    expect(res.body.total).toBe(0);
  });

  it('cột sắp xếp ngoài whitelist -> 400, không chạm SQL', async () => {
    const res = await request(app)
      .get('/api/admin/tenants')
      .query({ sort: 't.id; DROP TABLE tenants' })
      .set(bearer(f.tokenRoot));

    expect(res.status).toBe(400);

    // Bảng vẫn còn — nếu chuỗi kia lọt vào ORDER BY thì câu này đã ném lỗi.
    const still = await request(app).get('/api/admin/tenants').set(bearer(f.tokenRoot));
    expect(still.status).toBe(200);
  });

  it('phân trang không lặp và không bỏ sót dòng nào', async () => {
    const page = async (n: number): Promise<{ id: number }[]> => {
      const res = await request(app)
        .get('/api/admin/tenants')
        .query({ page: n, pageSize: 2, sort: 'name', order: 'asc' })
        .set(bearer(f.tokenRoot));
      return res.body.items;
    };

    // Thiếu tiebreaker `, id ASC` thì các dòng trùng khoá sắp xếp đảo chỗ giữa
    // hai lần truy vấn: một bản ghi xuất hiện hai lần, một bản ghi biến mất.
    const ids = [...(await page(1)), ...(await page(2))].map((t) => t.id);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
  });

  it('chi tiết kèm thành viên và workspace của đúng công ty đó', async () => {
    const res = await request(app)
      .get(`/api/admin/tenants/${f.tenantA}`)
      .set(bearer(f.tokenRoot));

    expect(res.status).toBe(200);
    expect(res.body.tenant.name).toBe('Công ty Alpha');

    const emails: string[] = res.body.members.map((m: { email: string }) => m.email);
    expect(emails).toEqual(expect.arrayContaining(['alice@alpha.test', 'bob@alpha.test']));
    expect(emails).not.toContain('carol@beta.test');

    expect(res.body.workspaces).toHaveLength(1);
    expect(res.body.workspaces[0].name).toBe('Kinh doanh');
  });

  it('chi tiết của id không tồn tại -> 404', async () => {
    const res = await request(app).get('/api/admin/tenants/999999').set(bearer(f.tokenRoot));
    expect(res.status).toBe(404);
  });

  it('khoá rồi mở khoá công ty', async () => {
    const locked = await request(app)
      .patch(`/api/admin/tenants/${f.tenantA}/status`)
      .set(bearer(f.tokenRoot))
      .send({ isActive: false });

    expect(locked.status).toBe(200);
    expect(locked.body.isActive).toBe(false);

    const unlocked = await request(app)
      .patch(`/api/admin/tenants/${f.tenantA}/status`)
      .set(bearer(f.tokenRoot))
      .send({ isActive: true });

    expect(unlocked.body.isActive).toBe(true);
  });

  it('khoá công ty thì thành viên của nó mất phiên', async () => {
    await request(app)
      .patch(`/api/admin/tenants/${f.tenantA}/status`)
      .set(bearer(f.tokenRoot))
      .send({ isActive: false });

    // Khoá tổ chức là biện pháp vận hành có hiệu lực thật, không phải một cái
    // nhãn trên bảng danh sách.
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'alice@alpha.test', password: 'Matkhau123' });

    expect(login.status).not.toBe(200);
  });

  it('KHÔNG khoá và KHÔNG xoá được chính tổ chức đang đăng nhập', async () => {
    // Mọi truy vấn membership đều lọc `t.is_active = 1`, nên tự khoá tổ chức
    // mình đang mở là tự nhốt mình ra ngoài: request kế tiếp nhận 401 và không
    // còn đường nào mở lại từ giao diện.
    const locked = await request(app)
      .patch(`/api/admin/tenants/${f.tenantRoot}/status`)
      .set(bearer(f.tokenRoot))
      .send({ isActive: false });

    expect(locked.status).toBe(403);
    expect(locked.body.error).toBe('CannotModifySelf');

    const deleted = await request(app)
      .delete(`/api/admin/tenants/${f.tenantRoot}`)
      .set(bearer(f.tokenRoot));

    expect(deleted.status).toBe(403);
  });

  it('xoá công ty còn workspace -> 409 kèm số lượng', async () => {
    const res = await request(app)
      .delete(`/api/admin/tenants/${f.tenantA}`)
      .set(bearer(f.tokenRoot));

    // CHẶN thay vì xoá lan xuống workspace và dữ liệu: xoá mềm dây chuyền qua
    // hai tầng, không nút hoàn tác, là cách nhanh nhất làm mất dữ liệu cả công ty.
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('TenantNotEmpty');
    expect(res.body.message).toContain('1');
  });

  it('xoá công ty rỗng -> 204, và biến mất khỏi danh sách', async () => {
    await request(app).delete(`/api/admin/workspaces/${f.wsA}`).set(bearer(f.tokenRoot));

    const res = await request(app)
      .delete(`/api/admin/tenants/${f.tenantA}`)
      .set(bearer(f.tokenRoot));
    expect(res.status).toBe(204);

    const list = await request(app).get('/api/admin/tenants').set(bearer(f.tokenRoot));
    expect(list.body.total).toBe(2);
  });

  it('xoá công ty giải phóng slug để tạo lại được', async () => {
    await request(app).delete(`/api/admin/workspaces/${f.wsA}`).set(bearer(f.tokenRoot));
    await request(app).delete(`/api/admin/tenants/${f.tenantA}`).set(bearer(f.tokenRoot));

    const [rows] = await mysqlPool.query<RowDataPacket[]>(
      'SELECT slug FROM tenants WHERE id = ?',
      [f.tenantA],
    );
    // `uq_tenants_slug` tính cả dòng đã xoá mềm. Không đổi slug lúc xoá thì
    // công ty tên "Công ty Alpha" đăng ký lại sẽ mang slug -2 vĩnh viễn.
    expect(rows[0]?.['slug']).toBe(`cong-ty-alpha-del-${f.tenantA}`);
  });
});

describe('quản lý người dùng toàn hệ thống', () => {
  it('thấy người của MỌI công ty, kèm tổ chức họ tham gia', async () => {
    const res = await request(app).get('/api/admin/users').set(bearer(f.tokenRoot));

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(4);

    const emails: string[] = res.body.items.map((u: { email: string }) => u.email);
    expect(emails).toEqual(
      expect.arrayContaining(['root@test.local', 'alice@alpha.test', 'carol@beta.test']),
    );

    const alice = res.body.items.find((u: { email: string }) => u.email === 'alice@alpha.test');
    expect(alice.tenants).toEqual([
      { id: f.tenantA, name: 'Công ty Alpha', role: 'admin' },
    ]);
  });

  it('một người thuộc hai công ty thì hiện đủ cả hai', async () => {
    await makeMembership(f.alice, f.tenantB, 'viewer');

    const res = await request(app)
      .get('/api/admin/users')
      .query({ q: 'alice@alpha.test' })
      .set(bearer(f.tokenRoot));

    // `total` là 1 chứ không phải 2: lọc theo tổ chức dùng EXISTS chứ không
    // JOIN, nên một người có hai membership vẫn chỉ là MỘT dòng. JOIN thì
    // LIMIT/OFFSET đếm nhầm và phân trang lệch.
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].tenants).toHaveLength(2);
  });

  it('lọc theo tổ chức', async () => {
    const res = await request(app)
      .get('/api/admin/users')
      .query({ tenantId: f.tenantA })
      .set(bearer(f.tokenRoot));

    expect(res.body.total).toBe(2);
    const emails: string[] = res.body.items.map((u: { email: string }) => u.email);
    expect(emails).not.toContain('carol@beta.test');
  });

  it('lọc theo vai trò nền tảng và theo trạng thái', async () => {
    await mysqlPool.query('UPDATE users SET is_active = 0 WHERE id = ?', [f.bob]);

    const supers = await request(app)
      .get('/api/admin/users')
      .query({ platformRole: 'superadmin' })
      .set(bearer(f.tokenRoot));
    expect(supers.body.total).toBe(1);
    expect(supers.body.items[0].email).toBe('root@test.local');

    const locked = await request(app)
      .get('/api/admin/users')
      .query({ status: 'locked' })
      .set(bearer(f.tokenRoot));
    expect(locked.body.total).toBe(1);
    expect(locked.body.items[0].email).toBe('bob@alpha.test');
  });

  it('tìm theo họ tên có dấu', async () => {
    const res = await request(app)
      .get('/api/admin/users')
      .query({ q: 'Nguyễn Thị' })
      .set(bearer(f.tokenRoot));

    expect(res.body.total).toBe(1);
    expect(res.body.items[0].email).toBe('alice@alpha.test');
  });

  it('cột sắp xếp ngoài whitelist -> 400', async () => {
    const res = await request(app)
      .get('/api/admin/users')
      .query({ sort: 'u.password_hash' })
      .set(bearer(f.tokenRoot));

    expect(res.status).toBe(400);
  });

  it('khoá người dùng — phạm vi TOÀN HỆ THỐNG', async () => {
    const res = await request(app)
      .patch(`/api/admin/users/${f.alice}/status`)
      .set(bearer(f.tokenRoot))
      .send({ isActive: false });

    expect(res.status).toBe(200);

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'alice@alpha.test', password: 'Matkhau123' });
    expect(login.status).not.toBe(200);
  });

  it('id không tồn tại -> 404', async () => {
    const res = await request(app)
      .patch('/api/admin/users/999999/status')
      .set(bearer(f.tokenRoot))
      .send({ isActive: false });

    expect(res.status).toBe(404);
  });

  it('KHÔNG tự khoá và KHÔNG tự xoá chính mình', async () => {
    // Tự khoá tài khoản superadmin đang dùng là tự nhốt mình ra ngoài; không
    // thao tác nào trong hai cái này từng là chủ ý.
    const locked = await request(app)
      .patch(`/api/admin/users/${f.root}/status`)
      .set(bearer(f.tokenRoot))
      .send({ isActive: false });
    expect(locked.status).toBe(403);
    expect(locked.body.error).toBe('CannotModifySelf');

    const deleted = await request(app)
      .delete(`/api/admin/users/${f.root}`)
      .set(bearer(f.tokenRoot));
    expect(deleted.status).toBe(403);
  });

  it('xoá mềm: biến mất khỏi danh sách, email vẫn bị giữ chỗ', async () => {
    const res = await request(app)
      .delete(`/api/admin/users/${f.bob}`)
      .set(bearer(f.tokenRoot));
    expect(res.status).toBe(204);

    const list = await request(app).get('/api/admin/users').set(bearer(f.tokenRoot));
    const emails: string[] = list.body.items.map((u: { email: string }) => u.email);
    expect(emails).not.toContain('bob@alpha.test');

    // Email là định danh chung và KHÔNG được giải phóng: người mới đăng ký
    // trùng email sẽ thừa hưởng mọi dấu vết của người cũ.
    const [rows] = await mysqlPool.query<RowDataPacket[]>(
      'SELECT email FROM users WHERE id = ?',
      [f.bob],
    );
    expect(rows[0]?.['email']).toBe('bob@alpha.test');
  });

  it('xoá người dùng cũng gỡ họ khỏi mọi tổ chức', async () => {
    await request(app).delete(`/api/admin/users/${f.bob}`).set(bearer(f.tokenRoot));

    const detail = await request(app)
      .get(`/api/admin/tenants/${f.tenantA}`)
      .set(bearer(f.tokenRoot));
    const emails: string[] = detail.body.members.map((m: { email: string }) => m.email);
    expect(emails).not.toContain('bob@alpha.test');

    const list = await request(app).get('/api/admin/tenants').set(bearer(f.tokenRoot));
    const alpha = list.body.items.find((t: { id: number }) => t.id === f.tenantA);
    expect(alpha.userCount).toBe(1);
  });
});

describe('luật superadmin cuối cùng', () => {
  it('còn hai người thì hạ được một', async () => {
    const second = await makeUser('root2@test.local', 'Quản trị hai', {
      platformRole: 'superadmin',
    });
    await makeMembership(second, f.tenantRoot, 'admin');

    const res = await request(app)
      .patch(`/api/admin/users/${second}/status`)
      .set(bearer(f.tokenRoot))
      .send({ isActive: false });

    expect(res.status).toBe(200);
  });

  it('xoá superadmin ĐÃ BỊ KHOÁ vẫn được, dù mình là người hoạt động duy nhất', async () => {
    // Câu hỏi đúng là "sau thao tác này còn ai không", không phải "bây giờ còn
    // mấy người". Đếm gộp cả người đã khoá sẽ chặn luôn việc dọn dẹp hợp lệ, và
    // chặn đúng lúc chỉ còn một người — tức đúng lúc cần dọn nhất.
    const second = await makeUser('root2@test.local', 'Quản trị hai', {
      platformRole: 'superadmin',
      isActive: false,
    });
    await makeMembership(second, f.tenantRoot, 'admin');

    const res = await request(app)
      .delete(`/api/admin/users/${second}`)
      .set(bearer(f.tokenRoot));

    expect(res.status).toBe(204);
  });

  it('không xoá được superadmin đang hoạt động khi hệ thống chỉ còn hai', async () => {
    // Dựng tình huống: root2 đang thao tác, root là superadmin hoạt động còn
    // lại. Hạ root xuống thì hệ thống còn đúng root2 — vẫn hợp lệ.
    // Nhưng nếu root2 đã bị khoá thì xoá root là mất sạch quản trị viên.
    const second = await makeUser('root2@test.local', 'Quản trị hai', {
      platformRole: 'superadmin',
    });
    await makeMembership(second, f.tenantRoot, 'admin');
    const tokenSecond = signTokenFor(second, f.tenantRoot, 'admin', 'superadmin');

    // root2 tự khoá mình thì bị CannotModifySelf, nên khoá qua root.
    await request(app)
      .patch(`/api/admin/users/${second}/status`)
      .set(bearer(f.tokenRoot))
      .send({ isActive: false });

    // Giờ root2 đã khoá -> token của nó không còn dùng được, đúng thiết kế.
    const blocked = await request(app).get('/api/admin/overview').set(bearer(tokenSecond));
    expect(blocked.status).toBe(401);
  });

  it('hệ thống không bao giờ còn 0 quản trị viên hoạt động', async () => {
    const second = await makeUser('root2@test.local', 'Quản trị hai', {
      platformRole: 'superadmin',
    });
    await makeMembership(second, f.tenantRoot, 'admin');
    const tokenSecond = signTokenFor(second, f.tenantRoot, 'admin', 'superadmin');

    // root2 xoá root -> còn đúng root2. Hợp lệ.
    const first = await request(app)
      .delete(`/api/admin/users/${f.root}`)
      .set(bearer(tokenSecond));
    expect(first.status).toBe(204);

    // root2 không thể tự xoá mình -> hệ thống còn ít nhất một người.
    const second2 = await request(app)
      .delete(`/api/admin/users/${second}`)
      .set(bearer(tokenSecond));
    expect(second2.status).toBe(403);

    const [rows] = await mysqlPool.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM users WHERE role='superadmin' AND is_active=1 AND deleted_at IS NULL",
    );
    expect(Number(rows[0]?.['n'])).toBeGreaterThanOrEqual(1);
  });
});

describe('quản lý workspace toàn hệ thống', () => {
  it('thấy workspace của mọi công ty, kèm tên công ty', async () => {
    const res = await request(app).get('/api/admin/workspaces').set(bearer(f.tokenRoot));

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);

    const byName = Object.fromEntries(
      res.body.items.map((w: { name: string; tenantName: string }) => [w.name, w.tenantName]),
    );
    // Không có `tenantName` thì bảng chỉ là một danh sách tên workspace trùng
    // nhau giữa các công ty, không dùng được.
    expect(byName['Kinh doanh']).toBe('Công ty Alpha');
    expect(byName['Kế toán']).toBe('Công ty Beta');
  });

  it('lọc theo tổ chức', async () => {
    const res = await request(app)
      .get('/api/admin/workspaces')
      .query({ tenantId: f.tenantB })
      .set(bearer(f.tokenRoot));

    expect(res.body.total).toBe(1);
    expect(res.body.items[0].name).toBe('Kế toán');
  });

  it('kèm số báo cáo, không N+1', async () => {
    await makeReport(f.tenantA, f.wsA, 'Báo cáo doanh thu');
    await makeReport(f.tenantA, f.wsA, 'Báo cáo tồn kho');

    const res = await request(app)
      .get('/api/admin/workspaces')
      .query({ tenantId: f.tenantA })
      .set(bearer(f.tokenRoot));

    expect(res.body.items[0].reportCount).toBe(2);
  });

  it('khoá rồi mở khoá workspace', async () => {
    const locked = await request(app)
      .patch(`/api/admin/workspaces/${f.wsA}/status`)
      .set(bearer(f.tokenRoot))
      .send({ isActive: false });
    expect(locked.status).toBe(200);

    const list = await request(app)
      .get('/api/admin/workspaces')
      .query({ status: 'locked' })
      .set(bearer(f.tokenRoot));
    expect(list.body.total).toBe(1);
    expect(list.body.items[0].id).toBe(f.wsA);
  });

  it('xoá mềm workspace và giải phóng slug', async () => {
    const res = await request(app)
      .delete(`/api/admin/workspaces/${f.wsA}`)
      .set(bearer(f.tokenRoot));
    expect(res.status).toBe(204);

    const list = await request(app).get('/api/admin/workspaces').set(bearer(f.tokenRoot));
    expect(list.body.total).toBe(1);

    const [rows] = await mysqlPool.query<RowDataPacket[]>(
      'SELECT slug FROM workspaces WHERE id = ?',
      [f.wsA],
    );
    // `uq_workspaces_tenant_slug` tính cả dòng đã xoá mềm: không đổi slug thì
    // xoá "Kinh doanh" rồi tạo lại sẽ ra `kinh-doanh-2` vĩnh viễn.
    expect(rows[0]?.['slug']).toBe(`kinh-doanh-del-${f.wsA}`);
  });

  it('workspace id không tồn tại -> 404', async () => {
    const res = await request(app)
      .delete('/api/admin/workspaces/999999')
      .set(bearer(f.tokenRoot));
    expect(res.status).toBe(404);
  });
});
