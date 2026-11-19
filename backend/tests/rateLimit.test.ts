import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { errorHandler } from '../src/middleware/errorHandler';
import { rateLimit } from '../src/middleware/rateLimit';

/**
 * Hạn nhịp — §2.4.
 *
 * ⚠️ Lỗi đã đo trên hệ thống đang chạy, và đó là lý do tệp này tồn tại: bản
 * trước tăng bộ đếm TRƯỚC handler, nên 10 lần đăng nhập ĐÚNG trong 15 phút cũng
 * bị khoá. Tui tự bị khoá hai lần khi chỉ đang dùng bình thường, và bộ e2e phải
 * nhớ token lại để không đụng trần. Vì đếm theo IP, một văn phòng sau cùng một
 * NAT còn khoá lẫn nhau.
 *
 * Bộ test này canh CẢ HAI chiều, vì sửa lệch một chiều là bỏ mất lớp phòng thủ:
 * đăng nhập đúng không tiêu lượt, nhưng đoán sai thì vẫn bị chặn đúng ở ngưỡng,
 * và những bucket đếm MỌI request (chat, gửi thư, lập tổ chức) phải giữ nguyên
 * cách đếm cũ.
 *
 * Redis bị thay bằng một Map trong bộ nhớ: câu hỏi ở đây là luật đếm, không
 * phải ioredis. `vi.hoisted` vì factory của `vi.mock` chạy trước mọi khai báo
 * ở thân module.
 */
const kho = vi.hoisted(() => ({
  dem: new Map<string, number>(),
  /** Đặt riêng để một ca có thể hẹn TTL khác, và để giả lập Redis chết. */
  ttl: 900,
  chet: false,
}));

vi.mock('../src/config/redis', () => ({
  redis: {
    incr: (key: string): Promise<number> => {
      if (kho.chet) return Promise.reject(new Error('Redis chết'));
      const v = (kho.dem.get(key) ?? 0) + 1;
      kho.dem.set(key, v);
      return Promise.resolve(v);
    },
    get: (key: string): Promise<string | null> => {
      if (kho.chet) return Promise.reject(new Error('Redis chết'));
      const v = kho.dem.get(key);
      return Promise.resolve(v === undefined ? null : String(v));
    },
    expire: (): Promise<number> => Promise.resolve(1),
    ttl: (key: string): Promise<number> => Promise.resolve(kho.dem.has(key) ? kho.ttl : -2),
  },
}));

/** App tối giản: một route trả về đúng mã mà ca test yêu cầu qua query `ma`. */
function appVoi(mw: express.RequestHandler): express.Express {
  const app = express();
  app.post('/thu', mw, (req, res) => {
    const ma = Number(req.query['ma'] ?? 200);
    res.status(ma).json({ ma });
  });
  app.use(errorHandler);
  return app;
}

const dangNhap = () =>
  appVoi(rateLimit({ bucket: 'login', max: 3, windowSeconds: 900, demMaLoi: [401] }));

beforeEach(() => {
  kho.dem.clear();
  kho.ttl = 900;
  kho.chet = false;
});

describe('chỉ đếm lần đoán sai', () => {
  it('đăng nhập ĐÚNG không tiêu lượt — 20 lần vẫn vào được', async () => {
    const app = dangNhap();
    for (let i = 0; i < 20; i += 1) {
      await request(app).post('/thu').expect(200);
    }
    // Không có key nào được tạo: thành công thì không ghi gì cả.
    expect(kho.dem.size).toBe(0);
  });

  it('mã KHÁC 401 cũng không tiêu lượt — 403 là người đã biết mật khẩu', async () => {
    // `/login` trả 403 khi mật khẩu ĐÚNG mà email chưa xác minh. Đếm nó là tái
    // hiện đúng lỗi vừa sửa dưới một bộ mặt khác: người dùng thật mắc kẹt, kẻ dò
    // không bị chặn thêm lượt nào.
    const app = dangNhap();
    for (let i = 0; i < 10; i += 1) {
      await request(app).post('/thu?ma=403').expect(403);
    }
    await request(app).post('/thu').expect(200);
  });

  it('đoán sai quá ngưỡng -> 429, và ngưỡng đúng là max', async () => {
    const app = dangNhap();
    for (let i = 0; i < 3; i += 1) {
      await request(app).post('/thu?ma=401').expect(401);
    }
    // Lần thứ 4 bị chặn — kể cả khi lần đó gõ ĐÚNG mật khẩu. Đó là chủ đích:
    // sau 3 lần sai thì không ai được thử thêm từ IP này nữa.
    await request(app).post('/thu').expect(429);
  });

  it('429 nói đúng số phút còn lại và gửi Retry-After', async () => {
    kho.ttl = 840;
    const app = dangNhap();
    for (let i = 0; i < 3; i += 1) await request(app).post('/thu?ma=401');

    const res = await request(app).post('/thu').expect(429);
    // "ít phút" là nói dối khi cửa sổ dài 15 phút: người dùng thử lại sau hai
    // phút, vẫn bị chặn, và kết luận hệ thống hỏng.
    expect(res.body.message).toContain('14 phút');
    expect(res.headers['retry-after']).toBe('840');
    expect(res.body.error).toBe('TooManyRequests');
  });
});

describe('mặc định vẫn đếm MỌI request', () => {
  /**
   * Phải giữ: một lượt `/chat/*` thành công vẫn tốn một lượt gọi mô hình, một
   * lượt `/register` thành công vẫn gửi thư và lập tổ chức. Ở đó thứ phải chặn
   * là khối lượng, không phải số lần đoán sai.
   */
  it('thành công vẫn tiêu lượt, đúng max request thì chặn', async () => {
    const app = appVoi(rateLimit({ bucket: 'chat', max: 3, windowSeconds: 600 }));
    for (let i = 0; i < 3; i += 1) {
      await request(app).post('/thu').expect(200);
    }
    await request(app).post('/thu').expect(429);
  });
});

describe('Redis chết thì CHO QUA', () => {
  it('không chặn ai, không ném 500', async () => {
    kho.chet = true;
    const app = dangNhap();
    await request(app).post('/thu').expect(200);
    await request(app).post('/thu?ma=401').expect(401);

    const app2 = appVoi(rateLimit({ bucket: 'chat', max: 1, windowSeconds: 600 }));
    await request(app2).post('/thu').expect(200);
    await request(app2).post('/thu').expect(200);
  });
});
