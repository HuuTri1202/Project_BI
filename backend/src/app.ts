import compression from 'compression';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import morgan from 'morgan';

import { adminRouter } from './api/admin';
import { authRouter } from './api/auth';
import { healthRouter } from './api/health';
import { v1Router } from './api/v1';
import { webhookRouter } from './api/webhooks';
import { env, isProduction, isTest } from './config/env';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { originGuard } from './middleware/originGuard';

/**
 * Dựng Express app nhưng KHÔNG listen.
 *
 * Tách khỏi `index.ts` để test có thể `createApp()` rồi bắn request thẳng vào
 * (supertest) mà không cần mở cổng thật.
 */
export function createApp(): Express {
  const app = express();

  // Express tự thêm header X-Powered-By: Express — không có lợi ích gì ngoài
  // việc quảng cáo stack cho người quét lỗ hổng.
  app.disable('x-powered-by');

  app.use(helmet());
  // Origin cụ thể, không phải '*': phiên đăng nhập dùng header Authorization
  // nên về mặt kỹ thuật wildcard vẫn chạy, nhưng khai đúng origin giữ cho API
  // không bị trang lạ gọi bằng token mà người dùng vô tình để lộ.
  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
  app.use(compression());
  /*
   * `verify` giữ lại THÂN REQUEST THÔ cho webhook thanh toán (§11).
   *
   * Chữ ký HMAC của cổng thanh toán tính trên đúng chuỗi byte họ gửi. Dựng lại
   * chuỗi đó bằng `JSON.stringify(req.body)` là sai theo cách rất khó tìm:
   * thứ tự khoá, khoảng trắng và cách viết số thực đều có thể khác bản gốc, nên
   * chữ ký không khớp trong khi mọi thứ trông đúng — và ta sẽ đi tìm lỗi ở khoá
   * bí mật thay vì ở chỗ này.
   *
   * Chỉ giữ cho route webhook: mọi request khác không cần và giữ lại là nhân đôi
   * bộ nhớ cho mỗi body.
   */
  app.use(
    express.json({
      limit: '1mb',
      verify: (req, _res, buf) => {
        if (req.url?.startsWith('/api/webhooks/')) {
          (req as { rawBody?: Buffer }).rawBody = buf;
        }
      },
    }),
  );
  // CỐ Ý KHÔNG dùng `express.urlencoded`.
  //
  // Một form HTML cross-origin chỉ gửi được urlencoded/multipart/text-plain —
  // nó KHÔNG gửi được `application/json`. Nên một API chỉ hiểu JSON là đã tự
  // chống được CSRF dạng form, miễn phí. Bật urlencoded lên là cho không lớp
  // phòng thủ đó. Nếu sau này cần nhận form thật (upload...), hãy mount parser
  // riêng cho đúng route đó chứ đừng mount toàn cục.
  if (!isTest) {
    app.use(morgan(isProduction ? 'combined' : 'dev'));
  }
  // Đứng sau parser, trước router: mọi mutation đều phải qua cửa này.
  app.use(originGuard);

  // Chạy sau reverse proxy (Vite dev, nginx, Ingress) -> tin X-Forwarded-For
  // để req.ip là IP thật của client. Bộ đếm chống dò mật khẩu dựa vào giá trị
  // này; không bật thì mọi request đều mang IP của proxy và chung một bộ đếm.
  app.set('trust proxy', 1);

  app.use('/health', healthRouter);
  app.use('/api/auth', authRouter);
  // §11 — webhook của cổng thanh toán. NGOÀI `/api/v1` một cách có chủ ý: người
  // gọi là máy chủ của cổng, không có token và không thuộc tổ chức nào. Thứ
  // thay cho phiên đăng nhập là chữ ký HMAC trên thân request.
  app.use('/api/webhooks', webhookRouter);
  // Khu quản trị tổ chức — tự gắn đủ ba lớp guard bên trong router của nó.
  app.use('/api/admin', adminRouter);
  app.use('/api/v1', v1Router);

  // Hai handler này phải đứng CUỐI, đúng thứ tự này.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
