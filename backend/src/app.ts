import { datLoiTiengViet } from '@bi/shared';
import compression from 'compression';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import morgan from 'morgan';

import { adminRouter } from './api/admin';
import { authRouter } from './api/auth';
import { healthRouter } from './api/health';
import { v1Router } from './api/v1';
import { publicRouter } from './api/public';
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
  /*
   * Câu báo lỗi của zod bằng TIẾNG VIỆT — đặt trước khi có bất kỳ `parse` nào.
   *
   * Phần lớn rule trong `api/v1/schemas.ts` không khai câu chữ riêng, nên không
   * có dòng này thì `fields` của lỗi 400 trả ra tiếng Anh ("Required",
   * "Expected number, received nan") và giao diện gắn thẳng câu đó vào ô của
   * form. Xem `loiTiengViet.ts` ở gói chung cho bảng đo.
   */
  datLoiTiengViet();

  const app = express();

  // Express tự thêm header X-Powered-By: Express — không có lợi ích gì ngoài
  // việc quảng cáo stack cho người quét lỗ hổng.
  app.disable('x-powered-by');

  /*
   * `helmet()` lo phần phản hồi của API — và CHỈ phần đó.
   *
   * ⚠️ Đừng nhầm nó là lớp chống clickjacking của sản phẩm. Thứ bị nhúng vào
   * iframe để lừa người dùng bấm là TRANG HTML, mà trang đó do Vite (dev) hoặc
   * Caddy (production) phục vụ — helmet không chạy qua đó. Lớp thật nằm ở
   * `frontend/vite.config.ts` và `infrastructure/Caddyfile`; cả hai đặt
   * `frame-ancestors 'none'`. Không ai nhúng `/health` vào iframe để lừa ai cả.
   *
   * `frameguard: deny` ở đây là siết mặc định `SAMEORIGIN` của helmet xuống
   * `DENY`, cùng một lập luận: API này không tự nhúng chính nó ở đâu, nên
   * `'self'` chỉ là một cánh cửa không ai dùng mà vẫn mở.
   */
  app.use(
    helmet({
      frameguard: { action: 'deny' },
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          // Mặc định của helmet là `frame-ancestors 'self'`. Phản hồi JSON
          // không có lý do gì để nhúng được, kể cả bởi chính mình.
          'frame-ancestors': ["'none'"],
        },
      },
    }),
  );
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
  /*
   * Bề mặt CÔNG KHAI — mong muốn D5, liên kết xem báo cáo.
   *
   * NGOÀI `/api/v1` một cách có chủ ý, cùng lý lẽ đã đặt webhook ra ngoài: người
   * gọi không có token và không thuộc tổ chức nào. `v1Router` gắn xác thực cho
   * MỌI route của nó, và đó là một tài sản — bỏ guard cho đúng một đường ở giữa
   * là làm câu "mọi route v1 đều được xác thực" thành một câu không còn tin
   * được. Luật của bề mặt này nằm ở `api/public/index.ts`.
   */
  app.use('/api/public', publicRouter);
  // Khu quản trị tổ chức — tự gắn đủ ba lớp guard bên trong router của nó.
  app.use('/api/admin', adminRouter);
  app.use('/api/v1', v1Router);

  // Hai handler này phải đứng CUỐI, đúng thứ tự này.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
