import type { RowDataPacket } from 'mysql2';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app';
import { closeMysql, mysqlPool } from '../src/config/mysql';
import { closeRedis } from '../src/config/redis';
import type { DanhTinhGoogle } from '../src/services/auth/googleIdentity';
import { resetDatabase } from './helpers/db';
import { makeMembership, makeTenant, makeUser } from './helpers/fixtures';

/**
 * Đăng nhập bằng Google — luồng đầy đủ, chạy trên MySQL thật.
 *
 * ═══ Vì sao mock Google mà KHÔNG mock database ══════════════════════════════
 *
 * Hai thứ cần tách bạch ở bộ này.
 *
 * Phần gọi ra Google bị mock, vì nó là một lượt gọi mạng tới một hệ thống ta
 * không điều khiển: không dựng được một ID token hợp lệ trong test mà không có
 * khoá riêng của Google. `vi.mock` chặn ở tầng phân giải module — không dùng
 * `vi.spyOn`, vì namespace của một ES module là đối tượng ĐÓNG BĂNG (lý do đầy
 * đủ ghi ở `passwordReset.integration.test.ts`).
 *
 * Phần database thì KHÔNG mock, và đó là cả nội dung của bộ này: luật quan
 * trọng nhất của tính năng do chính database ép, không phải do một lệnh `if`.
 *
 *   uq_identity_subject  một tài khoản Google chỉ trỏ tới MỘT người dùng
 *   uq_identity_user     một người dùng chỉ liên kết MỘT tài khoản Google
 *
 * Mock database đi thì bộ này chỉ còn kiểm `INSERT IGNORE` có được gọi hay
 * không — mà đó không phải cơ chế thật.
 *
 * ═══ Ca đáng giá nhất: `sub` là khoá, email thì không ═══════════════════════
 *
 * Ca "đổi email bên Google" khẳng định đúng quyết định của migration 41. Nếu ai
 * đó sau này đổi phép tra cứu sang email cho "dễ hiểu", ca ấy đỏ ngay — và nó
 * đỏ vì đúng lý do: người dùng đổi email bên Google sẽ mất lối vào, còn người
 * nhận được email cũ thì vào được tài khoản của họ.
 */

const google = vi.hoisted(() => ({ danhTinh: null as DanhTinhGoogle | null }));

vi.mock('../src/services/auth/googleIdentity', () => ({
  xacMinhGoogle: (): Promise<DanhTinhGoogle> => {
    if (google.danhTinh === null) {
      return Promise.reject(new Error('ca test chưa đặt danh tính Google'));
    }
    return Promise.resolve(google.danhTinh);
  },
  coCauHinhGoogle: (): boolean => true,
  quenBoKhoa: (): void => undefined,
}));

const app = createApp();

interface IdentityRow extends RowDataPacket {
  user_id: number;
  provider_user_id: string;
  email_at_link: string;
  last_login_at: string | null;
}

async function dongLienKet(userId?: number): Promise<IdentityRow[]> {
  const [rows] = await mysqlPool.query<IdentityRow[]>(
    userId === undefined
      ? 'SELECT * FROM user_identities'
      : 'SELECT * FROM user_identities WHERE user_id = ?',
    userId === undefined ? [] : [userId],
  );
  return rows;
}

/** Một tài khoản bình thường: có tổ chức, đang hoạt động. */
async function dungTaiKhoan(email = 'ha@congty.vn'): Promise<number> {
  const userId = await makeUser(email, 'Trần Thu Hà');
  const tenantId = await makeTenant('Công ty ABC', `abc-${String(userId)}`);
  await makeMembership(userId, tenantId, 'admin');
  return userId;
}

function danhTinh(over: Partial<DanhTinhGoogle> = {}): DanhTinhGoogle {
  return {
    sub: '110000000000000000001',
    email: 'ha@congty.vn',
    emailVerified: true,
    fullName: 'Trần Thu Hà',
    ...over,
  };
}

const goi = (): request.Test =>
  request(app).post('/api/auth/google').send({ credential: 'id-token-gia-lap' });

describe('POST /api/auth/google', () => {
  beforeEach(async () => {
    await resetDatabase();
    google.danhTinh = null;
  });

  afterAll(async () => {
    await closeMysql();
    await closeRedis();
  });

  it('email đã có tài khoản và Google đã xác nhận → đăng nhập được, và lập liên kết', async () => {
    const userId = await dungTaiKhoan();
    google.danhTinh = danhTinh();

    const res = await goi();

    expect(res.status).toBe(200);
    // Đúng hình dạng của `POST /login` — frontend chỉ có một đường xử lý phiên.
    expect(res.body).toMatchObject({
      token: expect.any(String) as unknown,
      expiresIn: expect.any(Number) as unknown,
      mustChangePassword: false,
      role: 'admin',
    });
    expect(res.body.user.id).toBe(userId);
    expect(res.body.memberships).toHaveLength(1);

    const lienKet = await dongLienKet(userId);
    expect(lienKet).toHaveLength(1);
    expect(lienKet[0]?.provider_user_id).toBe(danhTinh().sub);
  });

  it('lần đăng nhập thứ hai KHÔNG tạo thêm dòng liên kết', async () => {
    const userId = await dungTaiKhoan();
    google.danhTinh = danhTinh();

    expect((await goi()).status).toBe(200);
    expect((await goi()).status).toBe(200);

    expect(await dongLienKet(userId)).toHaveLength(1);
  });

  /*
   * ⚠️ CA AN NINH QUAN TRỌNG NHẤT CỦA BỘ NÀY.
   *
   * Tự liên kết theo email chỉ an toàn chừng nào Google đã chứng minh người này
   * kiểm soát hộp thư. Bỏ chốt `email_verified` thì bất kỳ ai khai được một địa
   * chỉ đều nhận được tài khoản của người khác.
   *
   * Khẳng định cả hai vế: bị từ chối, VÀ không để lại liên kết nào. Chỉ kiểm mã
   * lỗi thì một bản vá ghi liên kết trước rồi mới từ chối vẫn xanh.
   */
  it('Google CHƯA xác nhận email → từ chối, và KHÔNG để lại liên kết nào', async () => {
    await dungTaiKhoan();
    google.danhTinh = danhTinh({ emailVerified: false });

    const res = await goi();

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('GoogleEmailUnverified');
    expect(await dongLienKet()).toHaveLength(0);
  });

  it('email chưa có tài khoản → mời đăng ký, KHÔNG tự tạo người dùng', async () => {
    google.danhTinh = danhTinh({ email: 'nguoila@congty.vn' });

    const res = await goi();

    expect(res.status).toBe(404);
    const [users] = await mysqlPool.query<RowDataPacket[]>('SELECT id FROM users');
    expect(users).toHaveLength(0);
    expect(await dongLienKet()).toHaveLength(0);
  });

  it('tài khoản đã bị khoá → từ chối, và KHÔNG để lại liên kết nào', async () => {
    const userId = await makeUser('khoa@congty.vn', 'Bị Khoá', { isActive: false });
    const tenantId = await makeTenant('Công ty ABC', 'abc-khoa');
    await makeMembership(userId, tenantId, 'admin');
    google.danhTinh = danhTinh({ email: 'khoa@congty.vn' });

    const res = await goi();

    expect(res.status).toBe(403);
    expect(await dongLienKet()).toHaveLength(0);
  });

  it('tài khoản không thuộc tổ chức nào → 403 NoMembership, không phải 401', async () => {
    // Mật khẩu đúng / Google đúng rồi mới tới bước này, nên báo "sai đăng nhập"
    // là nói dối — người dùng sẽ thử lại tới khi bị khoá.
    await makeUser('moi@congty.vn', 'Chưa vào tổ chức');
    google.danhTinh = danhTinh({ email: 'moi@congty.vn' });

    const res = await goi();

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('NoMembership');
  });

  /*
   * ĐÂY là ca khẳng định quyết định của migration 41.
   *
   * Người dùng đổi email bên Google (đổi tên miền công ty, đổi alias) nhưng
   * `sub` giữ nguyên. Tra theo `sub` thì họ vào đúng tài khoản cũ. Tra theo
   * email thì họ bị coi là người lạ — và hệ thống sẽ bảo họ đi đăng ký, trong
   * khi tài khoản của họ vẫn nằm đó.
   */
  it('đổi email bên Google mà sub giữ nguyên → vẫn vào đúng tài khoản cũ', async () => {
    const userId = await dungTaiKhoan('ha@congty.vn');
    google.danhTinh = danhTinh();
    expect((await goi()).status).toBe(200);

    // Cùng `sub`, email mới — và email mới này KHÔNG có trong bảng `users`.
    google.danhTinh = danhTinh({ email: 'ha@tencongtymoi.vn' });
    const res = await goi();

    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(userId);
    expect(res.body.user.email).toBe('ha@congty.vn');
    expect(await dongLienKet(userId)).toHaveLength(1);
  });

  /*
   * Chiều ngược lại: cùng một người, một tài khoản Google THỨ HAI.
   *
   * `uq_identity_user` chặn, và nó phải thành một câu trả lời tử tế chứ không
   * phải lỗi 500 — hai request đồng thời của cùng một người cũng đi vào đây.
   */
  it('tài khoản Google thứ hai cho cùng một người → 409, không phải 500', async () => {
    await dungTaiKhoan();
    google.danhTinh = danhTinh();
    expect((await goi()).status).toBe(200);

    google.danhTinh = danhTinh({ sub: '220000000000000000002' });
    const res = await goi();

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('IdentityConflict');
  });

  it('ghi lại mốc đăng nhập qua liên kết này', async () => {
    const userId = await dungTaiKhoan();
    google.danhTinh = danhTinh();

    await goi();

    const lienKet = await dongLienKet(userId);
    expect(lienKet[0]?.last_login_at).not.toBeNull();
  });
});
