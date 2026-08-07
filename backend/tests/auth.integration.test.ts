import type { RoleCode } from '@bi/shared';
import type { RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
import { closeMysql, mysqlPool } from '../src/config/mysql';
import { closeRedis, redis } from '../src/config/redis';
import { newId } from '../src/db/id';
import { withTransaction } from '../src/db/tx';
import * as repo from '../src/modules/auth/authRepository';

/**
 * Test tích hợp — CẦN MySQL + Redis đang chạy.
 *
 * Chạy bằng `npm run test:integration` (config riêng đặt INTEGRATION_DB=1) trên
 * database `bi_platform_test`, KHÔNG phải database dev. Một test hỏng giữa chừng
 * không được để lại rác trong dữ liệu đang phát triển.
 *
 * Chuẩn bị một lần:
 *   docker exec bi-mysql mysql -uroot -prootpassword -e "CREATE DATABASE IF NOT EXISTS bi_platform_test; GRANT ALL ON bi_platform_test.* TO 'bi_user'@'%';"
 *   $env:MYSQL_DATABASE='bi_platform_test'; npm --workspace backend run migrate
 */

const app = createApp();

const VALID_USER = {
  fullName: 'Nguyễn Thái Hiền',
  companyName: 'Công ty Cổ phần ABC',
  email: 'hien@example.com',
  password: 'Matkhau123',
  confirmPassword: 'Matkhau123',
  phone: '0901234567',
  jobTitle: 'Data Analyst',
};

async function countOf(table: string): Promise<number> {
  const [rows] = await mysqlPool.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM ${table}`);
  return Number(rows[0]?.['n'] ?? 0);
}

async function resetState(): Promise<void> {
  // Tắt kiểm tra khoá ngoại để không phải xoá đúng thứ tự phụ thuộc.
  // CHỈ làm được vì đây là database test dùng riêng.
  await mysqlPool.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const table of ['memberships', 'projects', 'workspaces', 'tenants', 'users']) {
    await mysqlPool.query(`TRUNCATE TABLE ${table}`);
  }
  await mysqlPool.query('SET FOREIGN_KEY_CHECKS = 1');

  // Bộ đếm rate limit sống trong Redis với TTL 10 phút, KHÔNG tự mất khi test
  // kết thúc. Không xoá thì suite này (đăng ký hàng chục lần từ cùng một IP) tự
  // đâm vào giới hạn của chính nó và mọi test sau đều nhận 429.
  const keys = await redis.keys('ratelimit:*');
  if (keys.length > 0) {
    await redis.del(...keys);
  }
}

describe.skipIf(!process.env['INTEGRATION_DB'])('auth API (tích hợp)', () => {
  beforeEach(async () => {
    await resetState();
  });

  afterAll(async () => {
    await closeMysql();
    await closeRedis();
  });

  describe('POST /auth/register', () => {
    it('tạo user + tenant + workspace + membership trong một lần', async () => {
      const res = await request(app).post('/api/v1/auth/register').send(VALID_USER);

      expect(res.status).toBe(201);
      expect(res.body.user.email).toBe('hien@example.com');
      expect(res.body.user.fullName).toBe('Nguyễn Thái Hiền');
      expect(res.body.user.phone).toBe('+84901234567');
      expect(res.body.user.status).toBe('active');
      expect(res.body.tenant.name).toBe('Công ty Cổ phần ABC');
      expect(res.body.workspace.name).toBe('Không gian làm việc mặc định');
      expect(res.body.role).toBe('tenant_admin' satisfies RoleCode);

      expect(await countOf('users')).toBe(1);
      expect(await countOf('tenants')).toBe(1);
      expect(await countOf('workspaces')).toBe(1);
      expect(await countOf('memberships')).toBe(1);
      // Đăng ký KHÔNG tạo sẵn project — xem migration 0001.
      expect(await countOf('projects')).toBe(0);
    });

    it('không để lộ mật khẩu hay hash ở bất cứ đâu trong response', async () => {
      const res = await request(app).post('/api/v1/auth/register').send(VALID_USER);
      const serialized = JSON.stringify(res.body);

      expect(serialized).not.toContain(VALID_USER.password);
      expect(serialized).not.toContain('password_hash');
      expect(serialized).not.toContain('$2b$');
    });

    it('lưu mật khẩu dưới dạng bcrypt hash, không phải chữ thô', async () => {
      await request(app).post('/api/v1/auth/register').send(VALID_USER);

      const user = await repo.findUserByEmail('hien@example.com');
      expect(user).not.toBeNull();
      expect(user?.password_hash).toMatch(/^\$2[aby]\$/);
      expect(user?.password_hash).not.toContain(VALID_USER.password);
    });

    it('đặt cookie phiên httpOnly, SameSite=Lax', async () => {
      const res = await request(app).post('/api/v1/auth/register').send(VALID_USER);
      const cookies = res.headers['set-cookie'] as unknown as string[];

      expect(cookies).toBeDefined();
      const session = cookies.find((c) => c.startsWith('bi_session='));
      expect(session).toBeDefined();
      expect(session).toContain('HttpOnly');
      expect(session).toMatch(/SameSite=Lax/i);
      // secure: isProduction — ở môi trường test phải KHÔNG có, nếu không trình
      // duyệt sẽ từ chối cookie trên http://localhost và /me luôn trả 401.
      expect(session).not.toContain('Secure');
    });

    it('trả 409 khi email đã tồn tại (yêu cầu 1.4)', async () => {
      await request(app).post('/api/v1/auth/register').send(VALID_USER);
      const res = await request(app).post('/api/v1/auth/register').send(VALID_USER);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('EMAIL_ALREADY_REGISTERED');
      // Không tạo thêm tenant mồ côi khi lần đăng ký thứ hai thất bại.
      expect(await countOf('tenants')).toBe(1);
    });

    it('coi email khác hoa thường là trùng', async () => {
      await request(app).post('/api/v1/auth/register').send(VALID_USER);
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({ ...VALID_USER, email: 'HIEN@Example.com' });

      expect(res.status).toBe(409);
    });

    it('lấy tên công ty người dùng khai làm tên tenant', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({ ...VALID_USER, companyName: '  FPT   Software  ' });

      // Gộp khoảng trắng thừa nhưng giữ nguyên chữ người dùng gõ.
      expect(res.body.tenant.name).toBe('FPT Software');
    });

    it('hai người khai TRÙNG tên công ty vẫn ra hai tenant riêng', async () => {
      // Hành vi CÓ CHỦ Ý, không phải thiếu sót. `tenants.name` không unique:
      // "FPT Software" ở hai nơi hoàn toàn có thể là hai tổ chức khác nhau, và
      // gộp nhầm hai công ty thành một là để lộ dữ liệu giữa các khách hàng.
      // Muốn vào chung một công ty thì phải qua lời mời, không phải qua việc gõ
      // trùng tên.
      const a = await request(app).post('/api/v1/auth/register').send(VALID_USER);
      const b = await request(app)
        .post('/api/v1/auth/register')
        .send({ ...VALID_USER, email: 'nguoikhac@example.com' });

      expect(a.body.tenant.name).toBe(b.body.tenant.name);
      expect(a.body.tenant.id).not.toBe(b.body.tenant.id);
      expect(await countOf('tenants')).toBe(2);
      // Mỗi người là quản trị viên của tổ chức mình, không đụng vào tổ chức kia.
      expect(a.body.role).toBe('tenant_admin');
      expect(b.body.role).toBe('tenant_admin');
    });

    it('trả 400 kèm lỗi từng trường khi dữ liệu sai', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({ ...VALID_USER, password: 'yeu', confirmPassword: 'yeu', phone: '123' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.fields.password).toBeDefined();
      expect(res.body.error.fields.phone).toBeDefined();
    });
  });

  describe('transaction', () => {
    it('rollback TOÀN BỘ khi một câu insert trong chuỗi thất bại', async () => {
      // Đây là test duy nhất thật sự chứng minh cả bốn câu insert nằm trong CÙNG
      // một transaction — tức là luật "repository nhận connection làm tham số"
      // đang được tôn trọng. Nếu một hàm repo lén dùng mysqlPool trực tiếp, câu
      // lệnh đó chạy ngoài BEGIN và sẽ SỐNG SÓT qua rollback.
      const userId = newId();
      const tenantId = newId();

      await expect(
        withTransaction(async (conn) => {
          await repo.insertUser(conn, {
            id: userId,
            email: 'rollback@example.com',
            passwordHash: '$2b$04$khonglienquan',
            fullName: 'Rollback Test',
            phone: '+84901234567',
            jobTitle: 'QA',
          });
          await repo.insertTenant(conn, { id: tenantId, name: 'Tổ chức Rollback' });
          await repo.insertWorkspace(conn, { id: newId(), tenantId, name: 'WS' });
          // role_code không tồn tại -> vi phạm khoá ngoại -> cả khối phải bị huỷ.
          await repo.insertMembership(conn, {
            id: newId(),
            userId,
            tenantId,
            roleCode: 'vai_tro_khong_ton_tai' as RoleCode,
          });
        }),
      ).rejects.toThrow();

      expect(await countOf('users')).toBe(0);
      expect(await countOf('tenants')).toBe(0);
      expect(await countOf('workspaces')).toBe(0);
      expect(await countOf('memberships')).toBe(0);
    });
  });

  describe('POST /auth/login', () => {
    beforeEach(async () => {
      await request(app).post('/api/v1/auth/register').send(VALID_USER);
    });

    it('đăng nhập được và trả về tenant + workspace (yêu cầu 1.3)', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: VALID_USER.email, password: VALID_USER.password });

      expect(res.status).toBe(200);
      expect(res.body.tenant.name).toBe('Công ty Cổ phần ABC');
      expect(res.body.workspace.name).toBe('Không gian làm việc mặc định');
      expect(res.body.role).toBe('tenant_admin');
    });

    it('sai mật khẩu và email không tồn tại trả về CÙNG một thông báo', async () => {
      const wrongPassword = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: VALID_USER.email, password: 'SaiMatKhau123' });
      const unknownEmail = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'khongcoai@example.com', password: 'SaiMatKhau123' });

      expect(wrongPassword.status).toBe(401);
      expect(unknownEmail.status).toBe(401);
      // Khác nhau một chữ thôi cũng đủ để dò xem email nào đã đăng ký.
      expect(wrongPassword.body).toEqual(unknownEmail.body);
    });
  });

  describe('GET /auth/me', () => {
    it('trả 401 khi không có cookie', async () => {
      const res = await request(app).get('/api/v1/auth/me');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('trả 401 khi cookie bị sửa', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Cookie', 'bi_session=day.khong.phai.jwt');
      expect(res.status).toBe(401);
    });

    it('khôi phục phiên kèm tenant + workspaces', async () => {
      const agent = request.agent(app);
      await agent.post('/api/v1/auth/register').send(VALID_USER);

      const res = await agent.get('/api/v1/auth/me');

      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe('hien@example.com');
      expect(res.body.role).toBe('tenant_admin');
      expect(res.body.tenant.name).toBe('Công ty Cổ phần ABC');
      expect(res.body.workspaces).toHaveLength(1);
      expect(res.body.tenants).toHaveLength(1);
    });
  });

  describe('POST /auth/logout', () => {
    it('xoá cookie và làm /me trả về 401', async () => {
      const agent = request.agent(app);
      await agent.post('/api/v1/auth/register').send(VALID_USER);
      expect((await agent.get('/api/v1/auth/me')).status).toBe(200);

      const logout = await agent.post('/api/v1/auth/logout');
      expect(logout.status).toBe(204);

      expect((await agent.get('/api/v1/auth/me')).status).toBe(401);
    });
  });

  describe('múi giờ', () => {
    it('created_at là UTC, không lệch 7 tiếng theo TZ của container', async () => {
      await request(app).post('/api/v1/auth/register').send(VALID_USER);
      const user = await repo.findUserByEmail('hien@example.com');

      expect(user).not.toBeNull();
      const skewMs = Math.abs(Date.now() - (user?.created_at.getTime() ?? 0));
      // Nếu bản sửa `SET time_zone` ở config/mysql.ts bị gỡ, con số này sẽ là
      // khoảng 25.200.000ms (7 tiếng) chứ không phải vài trăm mili-giây.
      expect(skewMs).toBeLessThan(60_000);
    });
  });
});
