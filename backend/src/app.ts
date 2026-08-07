import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import morgan from 'morgan';

import { healthRouter } from './api/health';
import { v1Router } from './api/v1';
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
  // `credentials: true` + origin cụ thể (không phải '*') là điều kiện bắt buộc
  // để trình duyệt gửi kèm cookie phiên. Wildcard origin thì trình duyệt cấm
  // gửi credential.
  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  // CỐ Ý KHÔNG dùng `express.urlencoded`.
  //
  // Một form HTML cross-origin chỉ gửi được urlencoded/multipart/text-plain —
  // nó KHÔNG gửi được `application/json`. Nên một API chỉ hiểu JSON là đã tự
  // chống được CSRF dạng form, miễn phí. Bật urlencoded lên là cho không lớp
  // phòng thủ đó. Nếu sau này cần nhận form thật (upload...), hãy mount parser
  // riêng cho đúng route đó chứ đừng mount toàn cục.
  app.use(cookieParser());
  if (!isTest) {
    app.use(morgan(isProduction ? 'combined' : 'dev'));
  }
  // Đứng sau parser, trước router: mọi mutation đều phải qua cửa này.
  app.use(originGuard);

  app.use('/health', healthRouter);
  app.use('/api/v1', v1Router);

  // Hai handler này phải đứng CUỐI, đúng thứ tự này.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
