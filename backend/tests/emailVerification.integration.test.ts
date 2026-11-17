import type { RowDataPacket } from 'mysql2';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app';
import { closeMysql, mysqlPool } from '../src/config/mysql';
import { closeRedis } from '../src/config/redis';
import * as usersRepo from '../src/repositories/users';
import { bamVe } from '../src/services/auth/emailVerification';
import type { Thu } from '../src/services/mail/mailer';
import { resetDatabase } from './helpers/db';
import { bearer, makeMembership, makeTenant, makeUser, signTokenFor } from './helpers/fixtures';

/**
 * Bắt thư bằng `vi.mock`, KHÔNG bằng `vi.spyOn` — namespace của ES module là đối
 * tượng đóng băng. Lý lẽ đầy đủ ở `passwordReset.integration.test.ts`.
 */
const hopThu = vi.hoisted(() => ({ thu: [] as Thu[] }));

vi.mock('../src/services/mail/mailer', () => ({
  guiMail: (thu: Thu): Promise<void> => {
    hopThu.thu.push(thu);
    return Promise.resolve();
  },
  cheDoMail: () => 'log' as const,
  resetMailer: () => undefined,
}));

/**
 * Xác minh email (§1.10) và chốt mật khẩu tạm ở backend — trên MySQL thật.
 *
 * ═══ Hai thứ bộ này canh, và vì sao chúng đi cùng nhau ══════════════════════
 *
 * Cả hai đều là cùng một loại lỗi: một luật được tuyên bố ở một nơi nhưng không
 * được CƯỠNG CHẾ ở nơi duy nhất có quyền cưỡng chế.
 *
 *   - `must_change_password` từng chỉ là một lệnh điều hướng của React Router.
 *   - `email_verified_at` từng là một cột không ai ghi và không ai đọc.
 *
 * Cách kiểm chứng duy nhất đáng tin cho cả hai là đi đường HTTP với một token
 * thật, vì chính "đi vòng qua giao diện" mới là tình huống cần chặn.
 *
 * ═══ Vì sao KHÔNG mock database ════════════════════════════════════════════
 *
 * Thứ chặn dùng-vé-hai-lần là `UPDATE ... WHERE id = ? AND used_at IS NULL`, và
 * thứ chặn mật khẩu tạm là một cột đọc lại từ DB ở MỖI request. Mock đi thì bài
 * test chỉ còn soi mấy lệnh `if` ở tầng trên — mà chúng không phải cơ chế thật.
 */

const app = createApp();

const NGUOI_MOI = {
  email: 'nguoimoi@example.com',
  password: 'Matkhau123',
  confirmPassword: 'Matkhau123',
  fullName: 'Nguyen Nguoi Moi',
  phone: '0912345678',
  jobTitle: 'Data Analyst',
  companyName: 'Cong ty Moi',
};

function veTuThu(text: string): string {
  const m = /[?&]token=([^\s&]+)/.exec(text);
  if (!m?.[1]) throw new Error(`Không tìm thấy vé trong thư:\n${text}`);
  return decodeURIComponent(m[1]);
}

/** Đăng ký rồi trả về vé xác minh đọc được từ lá thư đã gửi. */
async function dangKyRoiLayVe(): Promise<string> {
  hopThu.thu.length = 0;
  await request(app).post('/api/auth/register').send(NGUOI_MOI).expect(201);
  expect(hopThu.thu).toHaveLength(1);
  return veTuThu(hopThu.thu[0]!.text);
}

async function docCotXacMinh(email: string): Promise<Date | null> {
  const [rows] = await mysqlPool.query<(RowDataPacket & { email_verified_at: Date | null })[]>(
    'SELECT email_verified_at FROM users WHERE email = ?',
    [email],
  );
  if (!rows[0]) throw new Error(`Không có user ${email}`);
  return rows[0].email_verified_at;
}

beforeEach(async () => {
  await resetDatabase();
  hopThu.thu.length = 0;
});

afterAll(async () => {
  await Promise.allSettled([closeMysql(), closeRedis()]);
});

describe('Đăng ký -> chưa xác minh thì KHÔNG vào được', () => {
  it('đăng ký xong, cột xác minh còn NULL và có một lá thư đi ra', async () => {
    await request(app).post('/api/auth/register').send(NGUOI_MOI).expect(201);

    expect(await docCotXacMinh(NGUOI_MOI.email)).toBeNull();
    expect(hopThu.thu).toHaveLength(1);
    expect(hopThu.thu[0]!.to).toBe(NGUOI_MOI.email);
  });

  /**
   * ⚠️ CA QUAN TRỌNG NHẤT CỦA CẢ BỘ.
   *
   * Đây là thứ làm cho tài khoản squat trở nên vô dụng: kẻ đăng ký bằng email
   * của người khác không nhận được lá thư, nên không xác minh được, nên không
   * đăng nhập được. Bỏ chốt này đi thì toàn bộ §1.10 chỉ còn là một cột dữ liệu
   * trang trí — y như trước migration 42.
   */
  it('mật khẩu ĐÚNG nhưng chưa xác minh -> 403 EmailNotVerified', async () => {
    await request(app).post('/api/auth/register').send(NGUOI_MOI).expect(201);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: NGUOI_MOI.email, password: NGUOI_MOI.password })
      .expect(403);

    expect(res.body.error).toBe('EmailNotVerified');
  });

  /**
   * Chốt chống dò email: SAI mật khẩu phải cho ra 401 của mật khẩu sai, KHÔNG
   * phải 403 "chưa xác minh".
   *
   * Nếu chốt xác minh bị đặt TRƯỚC `verifyPassword`, bài này đỏ — và lúc đó
   * `/login` thành máy dò "email nào đã đăng ký mà chưa xác minh", đúng thứ mà
   * một thông báo lỗi duy nhất đang cẩn thận che.
   */
  it('mật khẩu SAI trên tài khoản chưa xác minh -> vẫn là 401 InvalidCredentials', async () => {
    await request(app).post('/api/auth/register').send(NGUOI_MOI).expect(201);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: NGUOI_MOI.email, password: 'SaiHoanToan123' })
      .expect(401);

    expect(res.body.error).toBe('InvalidCredentials');
  });

  it('xác minh bằng vé trong thư -> đăng nhập được', async () => {
    const ve = await dangKyRoiLayVe();

    await request(app).post('/api/auth/verify-email').send({ token: ve }).expect(204);
    expect(await docCotXacMinh(NGUOI_MOI.email)).not.toBeNull();

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: NGUOI_MOI.email, password: NGUOI_MOI.password })
      .expect(200);

    expect(typeof res.body.token).toBe('string');
  });

  it('lá thư nói rõ TÀI KHOẢN NÀO và cảnh báo nếu không tự đăng ký', async () => {
    /*
     * Không phải kiểm câu chữ cho vui. Pre-hijacking sống được nhờ IM LẶNG:
     * lá thư này tới hộp thư của NGƯỜI THẬT, nên nó là thứ duy nhất cho họ biết
     * có ai đang dùng email của mình. Mà biết rồi cũng vô dụng nếu thư không nói
     * tài khoản nào vừa được tạo và đừng bấm vào đâu.
     */
    await request(app).post('/api/auth/register').send(NGUOI_MOI).expect(201);

    const text = hopThu.thu[0]!.text;
    expect(text).toContain(NGUOI_MOI.fullName);
    expect(text).toContain(NGUOI_MOI.companyName);
    expect(text).toContain('KHÔNG TỰ ĐĂNG KÝ');
  });
});

describe('Vé xác minh — chỉ dùng một lần, và chỉ lưu băm', () => {
  it('database KHÔNG giữ vé thô, chỉ giữ SHA-256 của nó', async () => {
    const ve = await dangKyRoiLayVe();

    const [rows] = await mysqlPool.query<(RowDataPacket & { token_hash: string })[]>(
      'SELECT token_hash FROM email_verification_tokens',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.token_hash).toBe(bamVe(ve));
    expect(rows[0]!.token_hash).not.toBe(ve);
  });

  it('dùng lần hai -> 410 VerifyTokenUsed', async () => {
    const ve = await dangKyRoiLayVe();

    await request(app).post('/api/auth/verify-email').send({ token: ve }).expect(204);
    const res = await request(app).post('/api/auth/verify-email').send({ token: ve }).expect(410);

    expect(res.body.error).toBe('VerifyTokenUsed');
  });

  it('vé bịa -> 400 VerifyTokenInvalid', async () => {
    const res = await request(app)
      .post('/api/auth/verify-email')
      .send({ token: 'khong-he-ton-tai' })
      .expect(400);

    expect(res.body.error).toBe('VerifyTokenInvalid');
  });

  it('vé đã hết hạn -> 410 VerifyTokenExpired, và email vẫn chưa xác minh', async () => {
    const ve = await dangKyRoiLayVe();
    await mysqlPool.query('UPDATE email_verification_tokens SET expires_at = NOW(3) - INTERVAL 1 MINUTE');

    const res = await request(app).post('/api/auth/verify-email').send({ token: ve }).expect(410);

    expect(res.body.error).toBe('VerifyTokenExpired');
    expect(await docCotXacMinh(NGUOI_MOI.email)).toBeNull();
  });

  /**
   * `markEmailVerified` không được DỜI mốc thời gian.
   *
   * Mốc ấy là bằng chứng "email này đã được chứng minh từ bao giờ", nên lần ghi
   * thứ hai phải là no-op. Gọi thẳng repository vì qua HTTP thì không tới được
   * đường này: `vohieuVeCu` giết vé cũ và `yeuCauGuiLai` im lặng với tài khoản
   * đã xác minh, nên không có cách nào xác minh hai lần từ bên ngoài.
   *
   * ⚠️ Không có ca này thì mệnh đề `WHERE email_verified_at IS NULL` là một chốt
   * không bài test nào bẻ được — tức một chốt không ai biết nó còn sống hay đã
   * chết.
   */
  it('xác minh lần hai KHÔNG dời mốc thời gian đã ghi', async () => {
    const userId = await makeUser('mocthoigian@alpha.test', 'Mốc Thời Gian', {
      emailVerified: false,
    });

    await usersRepo.markEmailVerified(userId);
    const lan1 = await docCotXacMinh('mocthoigian@alpha.test');
    expect(lan1).not.toBeNull();

    await new Promise((r) => setTimeout(r, 50));
    await usersRepo.markEmailVerified(userId);

    expect((await docCotXacMinh('mocthoigian@alpha.test'))?.getTime()).toBe(lan1?.getTime());
  });

  it('gửi lại thư -> vé CŨ chết, chỉ vé mới dùng được', async () => {
    const veCu = await dangKyRoiLayVe();

    hopThu.thu.length = 0;
    await request(app)
      .post('/api/auth/resend-verification')
      .send({ email: NGUOI_MOI.email })
      .expect(202);
    const veMoi = veTuThu(hopThu.thu[0]!.text);
    expect(veMoi).not.toBe(veCu);

    await request(app).post('/api/auth/verify-email').send({ token: veCu }).expect(410);
    await request(app).post('/api/auth/verify-email').send({ token: veMoi }).expect(204);
  });
});

describe('POST /api/auth/resend-verification — không được lộ email nào có thật', () => {
  const CAU_CHUNG = 'Nếu email này có tài khoản chưa xác minh';

  it('email KHÔNG tồn tại -> vẫn 202, cùng một câu, và KHÔNG gửi thư', async () => {
    const res = await request(app)
      .post('/api/auth/resend-verification')
      .send({ email: 'khongcoai@example.com' })
      .expect(202);

    expect(res.body.message).toContain(CAU_CHUNG);
    expect(hopThu.thu).toHaveLength(0);
  });

  it('email ĐÃ xác minh -> vẫn 202, cùng một câu, và KHÔNG gửi thư', async () => {
    const tenant = await makeTenant('Công ty Alpha', 'cong-ty-alpha');
    const alice = await makeUser('alice@alpha.test', 'Nguyễn Thị An');
    await makeMembership(alice, tenant, 'admin');

    const res = await request(app)
      .post('/api/auth/resend-verification')
      .send({ email: 'alice@alpha.test' })
      .expect(202);

    expect(res.body.message).toContain(CAU_CHUNG);
    expect(hopThu.thu).toHaveLength(0);
  });
});

describe('Đăng nhập Google KHÔNG tự liên kết vào tài khoản chưa xác minh', () => {
  /*
   * ⚠️ Đây là nửa thứ hai của lỗ hổng pre-hijacking (migration 42).
   *
   * Chặn `/login` một mình là không đủ: nếu đường Google vẫn liên kết, kẻ squat
   * vẫn thắng — nạn nhân vào được bằng Google, tin đó là workspace của mình, nạp
   * dữ liệu lên, và mật khẩu của kẻ squat vẫn dùng được.
   *
   * Bộ `googleLogin.integration.test.ts` mock `googleIdentity` để giả lập Google;
   * ở đây chỉ cần canh đúng một điều, nên kiểm bằng chính cột trong DB.
   */
  it('tài khoản chưa xác minh -> không có dòng liên kết nào được tạo', async () => {
    await request(app).post('/api/auth/register').send(NGUOI_MOI).expect(201);

    const [truoc] = await mysqlPool.query<RowDataPacket[]>('SELECT id FROM user_identities');
    expect(truoc).toHaveLength(0);

    // ID token bịa -> `xacMinhGoogle` từ chối trước khi tới chốt xác minh, nên
    // ca này canh phần CÒN LẠI: không có đường nào tạo được liên kết cho một
    // tài khoản chưa xác minh. Ca đi qua Google thật nằm ở bộ googleLogin.
    await request(app).post('/api/auth/google').send({ credential: 'khong-phai-id-token' });

    const [sau] = await mysqlPool.query<RowDataPacket[]>('SELECT id FROM user_identities');
    expect(sau).toHaveLength(0);
  });
});

describe('Mật khẩu TẠM — chốt phải ở backend, không chỉ ở giao diện', () => {
  let userId: number;
  let tenantId: number;
  let token: string;

  beforeEach(async () => {
    tenantId = await makeTenant('Công ty Alpha', 'cong-ty-alpha');
    userId = await makeUser('tam@alpha.test', 'Người Mật Khẩu Tạm', {
      password: 'MatKhauTam123',
      mustChangePassword: true,
    });
    await makeMembership(userId, tenantId, 'admin');
    token = signTokenFor(userId, tenantId, 'admin');
  });

  /**
   * ⚠️ CA CỐT LÕI.
   *
   * Trước bản sửa này, token cấp cho một mật khẩu TẠM đi qua được mọi endpoint
   * của `/api/v1`, và thứ duy nhất buộc đổi mật khẩu là một lệnh điều hướng của
   * React Router. Ai gọi API trực tiếp — hoặc chỉ cần copy token khỏi
   * `localStorage` — là đi thẳng qua cổng, trong khi Admin vẫn biết mật khẩu đó.
   */
  it('token hợp lệ nhưng còn cờ mật khẩu tạm -> 403 trên /api/v1', async () => {
    const res = await request(app).get('/api/v1/workspaces').set(bearer(token)).expect(403);

    expect(res.body.error).toBe('PasswordChangeRequired');
  });

  it('chốt áp cả cho console vận hành (/api/admin)', async () => {
    const sa = await makeUser('sa@alpha.test', 'Quản trị hệ thống', {
      password: 'MatKhauTam123',
      platformRole: 'superadmin',
      mustChangePassword: true,
    });
    await makeMembership(sa, tenantId, 'admin');

    const res = await request(app)
      .get('/api/admin/tenants')
      .set(bearer(signTokenFor(sa, tenantId, 'admin', 'superadmin')))
      .expect(403);

    expect(res.body.error).toBe('PasswordChangeRequired');
  });

  /**
   * Lối ra phải luôn mở, nếu không người dùng kẹt vĩnh viễn.
   *
   * `/api/auth/*` cố ý KHÔNG đi qua `requireFreshMembership`, nên chốt trên
   * không chạm tới endpoint này. Ca này giữ lấy điều đó: ai thêm middleware
   * "tươi" cho cả `authRouter` sẽ làm bài này đỏ, trước khi kịp đẩy người dùng
   * vào một vòng lặp không có cửa thoát.
   */
  it('vẫn đổi được mật khẩu, và sau khi đổi thì đi qua được', async () => {
    await request(app)
      .post('/api/auth/change-password')
      .set(bearer(token))
      .send({ currentPassword: 'MatKhauTam123', newPassword: 'MatKhauThat456' })
      .expect(204);

    // CÙNG một token cũ — nó vẫn mang cờ bật trong payload. Đi qua được chứng tỏ
    // chốt đọc cờ từ DATABASE chứ không từ token.
    await request(app).get('/api/v1/workspaces').set(bearer(token)).expect(200);
  });
});
