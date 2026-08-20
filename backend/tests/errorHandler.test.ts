import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

import { errorHandler } from '../src/middleware/errorHandler';
import { HttpError } from '../src/utils/httpError';

/**
 * Test ĐƠN VỊ cho bộ xử lý lỗi — dựng một app express tối giản, không chạm
 * database.
 *
 * Cố ý KHÔNG dùng `createApp()`: bài này chỉ hỏi một câu — "lỗi loại này ra mã
 * trạng thái nào" — và kéo cả ứng dụng thật vào chỉ để hỏi câu đó sẽ buộc bộ
 * test nhanh phải có MySQL, Redis và toàn bộ phần còn lại. Khi đó nó không còn
 * là bộ test nhanh nữa.
 */
function appVoi(handler: express.RequestHandler): express.Express {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.post('/thu', handler);
  app.use(errorHandler);
  return app;
}

const khongBaoGioToi: express.RequestHandler = (_req, res) => {
  res.json({ toiDuoc: true });
};

describe('thân yêu cầu không đọc nổi -> 4xx, KHÔNG phải 500', () => {
  /**
   * Đây là lỗi V-02 trong hồ sơ kiểm thử: trước bản vá, một thân JSON gõ sai
   * trả `500 InternalServerError`. Hại không nằm ở người dùng mà ở chỗ mọi công
   * cụ theo dõi đều đếm 5xx như tín hiệu hệ thống đang hỏng.
   */
  it('JSON hỏng -> 400 MalformedBody', async () => {
    const res = await request(appVoi(khongBaoGioToi))
      .post('/thu')
      .set('Content-Type', 'application/json')
      .send('{"name": khong-phai-json')
      .expect(400);

    expect(res.body).toMatchObject({ error: 'MalformedBody' });
    expect(res.body.message).toContain('JSON');
  });

  it('KHÔNG chạm tới route — request dừng ngay ở tầng đọc thân', async () => {
    const res = await request(appVoi(khongBaoGioToi))
      .post('/thu')
      .set('Content-Type', 'application/json')
      .send('{');

    expect(res.body.toiDuoc).toBeUndefined();
  });

  it('thân vượt trần 1MB -> 413, GIỮ nguyên mã của body-parser', async () => {
    // Đóng cứng 400 cho mọi lỗi body-parser sẽ biến "quá lớn" thành "sai định
    // dạng", và người dùng đi sửa nhầm thứ.
    const qua_to = JSON.stringify({ x: 'a'.repeat(1_100_000) });

    const res = await request(appVoi(khongBaoGioToi))
      .post('/thu')
      .set('Content-Type', 'application/json')
      .send(qua_to)
      .expect(413);

    expect(res.body).toMatchObject({ error: 'PayloadTooLarge' });
  });

  it('thân JSON hợp lệ vẫn đi tới route như thường', async () => {
    const res = await request(appVoi(khongBaoGioToi))
      .post('/thu')
      .send({ name: 'hop le' })
      .expect(200);

    expect(res.body).toEqual({ toiDuoc: true });
  });
});

describe('các nhánh lỗi còn lại không bị bản vá làm lệch', () => {
  it('SyntaxError do CHÍNH MÃ NGUỒN ném vẫn là 500', async () => {
    // Ranh giới quan trọng nhất của bản vá. Nếu bắt theo `instanceof
    // SyntaxError` thay vì theo nhãn `type` của body-parser, ca này sẽ thành
    // 400 — tức là một lỗi lập trình thật bị che thành lỗi của người dùng.
    const res = await request(
      appVoi(() => {
        JSON.parse('{ hong');
      }),
    )
      .post('/thu')
      .send({})
      .expect(500);

    expect(res.body).toMatchObject({ error: 'InternalServerError' });
  });

  it('lỗi mang nhãn `type` lạ vẫn là 500 — danh sách là danh sách TRẮNG', async () => {
    const res = await request(
      appVoi(() => {
        const err = new Error('nhãn chưa từng thấy') as Error & { type: string };
        err.type = 'mot.nhan.la';
        throw err;
      }),
    )
      .post('/thu')
      .send({})
      .expect(500);

    expect(res.body).toMatchObject({ error: 'InternalServerError' });
  });

  it('HttpError vẫn giữ nguyên status và code do nơi ném quyết định', async () => {
    const res = await request(
      appVoi(() => {
        throw new HttpError(409, 'SharedIdentity', 'Tài khoản dùng chung.');
      }),
    )
      .post('/thu')
      .send({})
      .expect(409);

    expect(res.body).toMatchObject({ error: 'SharedIdentity', message: 'Tài khoản dùng chung.' });
  });

  it('ZodError vẫn ra 400 kèm map lỗi theo từng trường', async () => {
    const res = await request(
      appVoi(() => {
        throw new ZodError([
          { code: 'custom', path: ['email'], message: 'Email không hợp lệ' },
        ]);
      }),
    )
      .post('/thu')
      .send({})
      .expect(400);

    expect(res.body).toMatchObject({
      error: 'ValidationError',
      fields: { email: 'Email không hợp lệ' },
    });
  });
});
