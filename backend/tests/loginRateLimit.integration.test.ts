import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
import { env } from '../src/config/env';
import { closeMysql } from '../src/config/mysql';
import { closeRedis } from '../src/config/redis';
import { resetDatabase } from './helpers/db';
import { makeMembership, makeTenant, makeUser } from './helpers/fixtures';

/**
 * Hạn nhịp đăng nhập đi ĐƯỜNG HTTP THẬT — §2.4.
 *
 * ⚠️ Lỗi đã đo khi dùng hệ thống như người thật: tui bị khoá hai lần trong lúc
 * chỉ đang đăng nhập đi vào ra giữa các tổ chức. `rateLimit` tăng bộ đếm TRƯỚC
 * handler, nên LOGIN_MAX_ATTEMPTS lần đăng nhập ĐÚNG cũng khoá — và vì đếm theo
 * IP, cả một văn phòng sau NAT khoá lẫn nhau. `.env.example` đã ghi luật đúng
 * ("Sai quá LOGIN_MAX_ATTEMPTS lần"), chỉ có mã làm khác.
 *
 * `rateLimit.test.ts` canh luật đếm trên một app tối giản. Bộ này canh phần duy
 * nhất bộ kia không thấy được: `/auth/login` CÓ thật sự được gắn `demMaLoi` hay
 * không. Xoá một tham số ở `api/auth/index.ts` là đủ để lỗi quay lại mà toàn bộ
 * test đơn vị vẫn xanh.
 */

const app = createApp();

const NGUOI = {
  email: 'nguoi-dang-nhap-nhieu@example.com',
  password: 'Matkhau123',
};

beforeEach(async () => {
  // `resetDatabase` xoá luôn key `ratelimit:*`, nên mỗi ca bắt đầu từ bộ đếm 0.
  await resetDatabase();
  const userId = await makeUser(NGUOI.email, 'Nguoi Dang Nhap Nhieu', {
    password: NGUOI.password,
  });
  const tenantId = await makeTenant('Cong ty Dang Nhap', 'cong-ty-dang-nhap', userId);
  await makeMembership(userId, tenantId, 'admin');
});

afterAll(async () => {
  await Promise.allSettled([closeMysql(), closeRedis()]);
});

describe('đăng nhập ĐÚNG không tiêu lượt', () => {
  it(`${env.LOGIN_MAX_ATTEMPTS + 2} lần đăng nhập đúng liên tiếp vẫn vào được`, async () => {
    for (let lan = 1; lan <= env.LOGIN_MAX_ATTEMPTS + 2; lan += 1) {
      const res = await request(app).post('/api/auth/login').send(NGUOI);
      expect(res.status, `lần đăng nhập đúng thứ ${lan} phải được vào`).toBe(200);
    }
  });
});

describe('đoán sai mật khẩu thì vẫn bị khoá', () => {
  it('sai đủ ngưỡng -> 429, kèm Retry-After và số phút THẬT', async () => {
    for (let lan = 1; lan <= env.LOGIN_MAX_ATTEMPTS; lan += 1) {
      await request(app)
        .post('/api/auth/login')
        .send({ email: NGUOI.email, password: 'SaiHoanToan123' })
        .expect(401);
    }

    // Lần kế tiếp bị chặn kể cả khi mật khẩu ĐÚNG: đó là chủ đích của hạn nhịp.
    const res = await request(app).post('/api/auth/login').send(NGUOI).expect(429);

    expect(res.body.error).toBe('TooManyRequests');
    // Câu cũ ghi "thử lại sau ít phút" trong khi cửa sổ dài 15 phút.
    expect(res.body.message).toContain(`${env.LOGIN_LOCKOUT_MINUTES} phút`);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });
});
