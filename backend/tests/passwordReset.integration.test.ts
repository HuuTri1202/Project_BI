import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app';
import { closeMysql, mysqlPool } from '../src/config/mysql';
import { closeRedis } from '../src/config/redis';
import { verifyPassword } from '../src/services/auth/password';
import { bamVe } from '../src/services/auth/passwordReset';
import * as resetsRepo from '../src/repositories/passwordResets';
import type { Thu } from '../src/services/mail/mailer';
import { resetDatabase } from './helpers/db';
import { makeMembership, makeTenant, makeUser } from './helpers/fixtures';

/**
 * Bắt thư bằng `vi.mock`, KHÔNG bằng `vi.spyOn`.
 *
 * `vi.spyOn(mailer, 'guiMail')` là cách viết quen tay từ thời CommonJS, nhưng
 * namespace của một ES module là đối tượng ĐÓNG BĂNG — gán đè lên nó ném
 * TypeError, hoặc tệ hơn là im lặng không thay được gì và bài test xanh vì lý do
 * sai. `vi.mock` chặn ở tầng phân giải module nên `import { guiMail }` trong
 * `passwordReset.ts` nhận đúng bản giả này.
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
 * Quên mật khẩu — luồng đầy đủ, chạy trên MySQL thật.
 *
 * ─── Vì sao KHÔNG mock database ─────────────────────────────────────────────
 *
 * Hai luật quan trọng nhất của luồng này do chính database ép:
 *
 *   - `UPDATE ... WHERE id = ? AND used_at IS NULL` là thứ chặn dùng-hai-lần.
 *     Mock đi thì bài test chỉ còn kiểm tra một lệnh `if` ở tầng trên, mà lệnh
 *     `if` đó KHÔNG phải cơ chế thật.
 *   - `UNIQUE (token_hash)` và `ON DELETE CASCADE`.
 *
 * ─── Vé lấy ở đâu ra ────────────────────────────────────────────────────────
 *
 * Bắt `guiMail` rồi đọc liên kết trong thân thư — đúng như người dùng làm. Sinh
 * vé thẳng bằng cách gọi hàm nội bộ sẽ bỏ qua mất cả bước gửi lẫn bước dựng URL,
 * mà đó chính là hai chỗ đã từng hỏng thầm lặng nhất ở các hệ thống khác.
 */

const app = createApp();

let alice: number;
let bob: number;

function veTuThu(text: string): string {
  const m = /[?&]token=([^\s&]+)/.exec(text);
  if (!m?.[1]) throw new Error(`Không tìm thấy vé trong thư:\n${text}`);
  return decodeURIComponent(m[1]);
}

/** Gọi endpoint xin liên kết rồi trả về vé đọc được từ lá thư đã gửi. */
async function xinVe(email: string): Promise<string> {
  hopThu.thu.length = 0;
  await request(app).post('/api/auth/forgot-password').send({ email }).expect(202);
  expect(hopThu.thu).toHaveLength(1);
  return veTuThu(hopThu.thu[0]!.text);
}

beforeEach(async () => {
  await resetDatabase();
  hopThu.thu.length = 0;

  const tenant = await makeTenant('Công ty Alpha', 'cong-ty-alpha');
  alice = await makeUser('alice@alpha.test', 'Nguyễn Thị An', { password: 'Matkhau123' });
  bob = await makeUser('bob@alpha.test', 'Trần Văn Bình', { password: 'Matkhau123' });
  await makeMembership(alice, tenant, 'admin');
  await makeMembership(bob, tenant, 'viewer');
});

afterAll(async () => {
  await Promise.allSettled([closeMysql(), closeRedis()]);
});

describe('POST /api/auth/forgot-password — không được lộ email nào có thật', () => {
  it('email CÓ thật -> 202 và có gửi thư', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'alice@alpha.test' })
      .expect(202);

    expect(res.body.message).toContain('Nếu email này có tài khoản');
    expect(hopThu.thu).toHaveLength(1);
    expect(hopThu.thu[0]!.to).toBe('alice@alpha.test');
  });

  it('email KHÔNG tồn tại -> 202 với CÙNG một câu, và không gửi thư', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'khong-ai@alpha.test' })
      .expect(202);

    expect(res.body.message).toContain('Nếu email này có tài khoản');
    expect(hopThu.thu).toHaveLength(0);

    // Đây mới là điều bài test này bảo vệ: hai phản hồi phải GIỐNG HỆT nhau.
    const coThat = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'alice@alpha.test' })
      .expect(202);

    expect(coThat.body).toEqual(res.body);
  });

  it('tài khoản đã bị khoá -> vẫn 202, nhưng KHÔNG phát vé', async () => {
    await mysqlPool.query('UPDATE users SET is_active = 0 WHERE id = ?', [bob]);

    await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'bob@alpha.test' })
      .expect(202);

    expect(hopThu.thu).toHaveLength(0);
    const [rows] = await mysqlPool.query<RowDataPacket[]>(
      'SELECT id FROM password_reset_tokens WHERE user_id = ?',
      [bob],
    );
    expect(rows).toHaveLength(0);
  });

  it('email hoa/thường và thừa khoảng trắng vẫn tra ra đúng tài khoản', async () => {
    await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: '  ALICE@Alpha.TEST  ' })
      .expect(202);

    expect(hopThu.thu).toHaveLength(1);
  });

  it('thư mang liên kết trỏ đúng trang đặt lại của frontend', async () => {
    const ve = await xinVe('alice@alpha.test');
    const text = hopThu.thu[0]!.text;

    expect(text).toContain('/dat-lai-mat-khau?token=');
    expect(text).toContain('Nguyễn Thị An');
    // Vé phải sống sót qua encode/decode của URL — 43 ký tự base64url có thể
    // chứa '-' và '_', và một bản dựng URL cẩu thả sẽ làm hỏng đúng những vé đó.
    expect(ve).toHaveLength(43);
  });

  it('database CHỈ giữ băm, không giữ vé', async () => {
    const ve = await xinVe('alice@alpha.test');

    const [rows] = await mysqlPool.query<RowDataPacket[]>(
      'SELECT token_hash FROM password_reset_tokens WHERE user_id = ?',
      [alice],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!['token_hash']).toBe(bamVe(ve));
    expect(rows[0]!['token_hash']).not.toBe(ve);
  });

  it('xin lần hai thì vé lần MỘT chết ngay', async () => {
    const veCu = await xinVe('alice@alpha.test');
    const veMoi = await xinVe('alice@alpha.test');
    expect(veMoi).not.toBe(veCu);

    await request(app)
      .post('/api/auth/reset-password')
      .send({ token: veCu, newPassword: 'MatkhauMoi123' })
      .expect(410);

    await request(app)
      .post('/api/auth/reset-password')
      .send({ token: veMoi, newPassword: 'MatkhauMoi123' })
      .expect(204);
  });
});

describe('POST /api/auth/reset-password', () => {
  it('đổi được mật khẩu, và mật khẩu MỚI đăng nhập được còn CŨ thì không', async () => {
    const ve = await xinVe('alice@alpha.test');

    await request(app)
      .post('/api/auth/reset-password')
      .send({ token: ve, newPassword: 'MatkhauMoi123' })
      .expect(204);

    await request(app)
      .post('/api/auth/login')
      .send({ email: 'alice@alpha.test', password: 'MatkhauMoi123' })
      .expect(200);

    await request(app)
      .post('/api/auth/login')
      .send({ email: 'alice@alpha.test', password: 'Matkhau123' })
      .expect(401);
  });

  it('hash trong database thật sự đổi, không phải chỉ endpoint trả 204', async () => {
    const [truoc] = await mysqlPool.query<RowDataPacket[]>(
      'SELECT password_hash FROM users WHERE id = ?',
      [alice],
    );

    const ve = await xinVe('alice@alpha.test');
    await request(app)
      .post('/api/auth/reset-password')
      .send({ token: ve, newPassword: 'MatkhauMoi123' })
      .expect(204);

    const [sau] = await mysqlPool.query<RowDataPacket[]>(
      'SELECT password_hash, must_change_password FROM users WHERE id = ?',
      [alice],
    );
    expect(sau[0]!['password_hash']).not.toBe(truoc[0]!['password_hash']);
    expect(await verifyPassword('MatkhauMoi123', sau[0]!['password_hash'] as string)).toBe(true);
    // Người tự đặt mật khẩu thì không còn lý do bắt đổi lại ở màn kế tiếp.
    expect(sau[0]!['must_change_password']).toBe(0);
  });

  it('gỡ luôn cờ phải-đổi-mật-khẩu của tài khoản được cấp mật khẩu tạm', async () => {
    await mysqlPool.query('UPDATE users SET must_change_password = 1 WHERE id = ?', [bob]);

    const ve = await xinVe('bob@alpha.test');
    await request(app)
      .post('/api/auth/reset-password')
      .send({ token: ve, newPassword: 'MatkhauMoi123' })
      .expect(204);

    const [rows] = await mysqlPool.query<RowDataPacket[]>(
      'SELECT must_change_password FROM users WHERE id = ?',
      [bob],
    );
    expect(rows[0]!['must_change_password']).toBe(0);
  });

  it('vé chỉ dùng được MỘT lần', async () => {
    const ve = await xinVe('alice@alpha.test');

    await request(app)
      .post('/api/auth/reset-password')
      .send({ token: ve, newPassword: 'MatkhauMoi123' })
      .expect(204);

    const lai = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: ve, newPassword: 'MatkhauKhac123' })
      .expect(410);
    expect(lai.body.error).toBe('ResetTokenUsed');

    // Và lần thứ hai KHÔNG được đổi mật khẩu.
    await request(app)
      .post('/api/auth/login')
      .send({ email: 'alice@alpha.test', password: 'MatkhauMoi123' })
      .expect(200);
  });

  /*
   * ─── Vì sao bài này gọi THẲNG repository ────────────────────────────────
   *
   * Bài "hai request đồng thời" ngay dưới đi qua HTTP, và nó KHÔNG kiểm được
   * `AND used_at IS NULL`: đo bằng đột biến (gỡ mệnh đề đó khỏi câu UPDATE) thì
   * cả 19 bài vẫn xanh. Lý do là `traVe` đã đọc `used_at` và ném 410 trước đó,
   * nên trong thực tế hai request hiếm khi chồng đúng vào khe giữa lần ĐỌC và
   * lần GHI của nhau — bài test xanh nhờ thứ tự may mắn, không nhờ cơ chế.
   *
   * Một bài test xanh vì lý do sai thì tệ hơn không có bài test, vì nó khiến
   * người sau tin rằng chỗ đó đã được canh. Nên chỗ canh thật được gọi trực
   * tiếp, không qua HTTP: hai lời gọi `danhDauDaDung` cùng lúc trên cùng một
   * dòng, và đúng một cái được trả `true`.
   */
  it('danhDauDaDung: hai lời gọi song song thì đúng MỘT cái chiếm được vé', async () => {
    await xinVe('alice@alpha.test');
    const [rows] = await mysqlPool.query<RowDataPacket[]>(
      'SELECT id FROM password_reset_tokens WHERE user_id = ?',
      [alice],
    );
    const veId = rows[0]!['id'] as number;

    const ketQua = await Promise.all([
      resetsRepo.danhDauDaDung(veId),
      resetsRepo.danhDauDaDung(veId),
      resetsRepo.danhDauDaDung(veId),
    ]);

    expect(ketQua.filter(Boolean)).toHaveLength(1);
  });

  it('hai request ĐỒNG THỜI cùng một vé: đúng một cái thắng', async () => {
    const ve = await xinVe('alice@alpha.test');

    const ketQua = await Promise.all([
      request(app).post('/api/auth/reset-password').send({ token: ve, newPassword: 'MatkhauA123' }),
      request(app).post('/api/auth/reset-password').send({ token: ve, newPassword: 'MatkhauB123' }),
    ]);

    const ma = ketQua.map((r) => r.status).sort();
    expect(ma).toEqual([204, 410]);

    const [rows] = await mysqlPool.query<RowDataPacket[]>(
      'SELECT password_hash FROM users WHERE id = ?',
      [alice],
    );
    const hash = rows[0]!['password_hash'] as string;
    const khopA = await verifyPassword('MatkhauA123', hash);
    const khopB = await verifyPassword('MatkhauB123', hash);
    // Đúng MỘT trong hai, không phải cả hai và không phải không cái nào.
    expect([khopA, khopB].filter(Boolean)).toHaveLength(1);
  });

  it('vé hết hạn -> 410', async () => {
    const ve = await xinVe('alice@alpha.test');
    await mysqlPool.query<ResultSetHeader>(
      'UPDATE password_reset_tokens SET expires_at = NOW(3) - INTERVAL 1 HOUR WHERE user_id = ?',
      [alice],
    );

    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: ve, newPassword: 'MatkhauMoi123' })
      .expect(410);
    expect(res.body.error).toBe('ResetTokenExpired');
  });

  it('vé bịa -> 400, và KHÔNG nói gì về việc có tài khoản nào hay không', async () => {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'khong-phai-mot-ve-that', newPassword: 'MatkhauMoi123' })
      .expect(400);
    expect(res.body.error).toBe('ResetTokenInvalid');
  });

  it('mật khẩu mới yếu -> 400, và vé KHÔNG bị tiêu', async () => {
    const ve = await xinVe('alice@alpha.test');

    await request(app)
      .post('/api/auth/reset-password')
      .send({ token: ve, newPassword: 'abc' })
      .expect(400);

    // Vé vẫn còn nguyên: người gõ mật khẩu chưa đủ mạnh phải được thử lại ngay,
    // không phải quay về hộp thư xin liên kết mới.
    await request(app)
      .post('/api/auth/reset-password')
      .send({ token: ve, newPassword: 'MatkhauMoi123' })
      .expect(204);
  });
});

describe('POST /api/auth/reset-password/verify', () => {
  it('vé tốt -> 204', async () => {
    const ve = await xinVe('alice@alpha.test');
    await request(app).post('/api/auth/reset-password/verify').send({ token: ve }).expect(204);
  });

  it('kiểm vé KHÔNG tiêu vé', async () => {
    const ve = await xinVe('alice@alpha.test');

    await request(app).post('/api/auth/reset-password/verify').send({ token: ve }).expect(204);
    await request(app).post('/api/auth/reset-password/verify').send({ token: ve }).expect(204);

    await request(app)
      .post('/api/auth/reset-password')
      .send({ token: ve, newPassword: 'MatkhauMoi123' })
      .expect(204);
  });

  it('vé đã dùng -> 410 ngay ở bước kiểm', async () => {
    const ve = await xinVe('alice@alpha.test');
    await request(app)
      .post('/api/auth/reset-password')
      .send({ token: ve, newPassword: 'MatkhauMoi123' })
      .expect(204);

    await request(app).post('/api/auth/reset-password/verify').send({ token: ve }).expect(410);
  });
});

describe('xoá tài khoản thì vé mất theo (ON DELETE CASCADE)', () => {
  it('vé biến mất khi user bị xoá', async () => {
    await xinVe('alice@alpha.test');
    await mysqlPool.query('DELETE FROM users WHERE id = ?', [alice]);

    const [rows] = await mysqlPool.query<RowDataPacket[]>(
      'SELECT id FROM password_reset_tokens WHERE user_id = ?',
      [alice],
    );
    expect(rows).toHaveLength(0);
  });
});
