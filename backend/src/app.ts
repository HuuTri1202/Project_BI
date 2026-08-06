import compression from 'compression';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import morgan from 'morgan';

import { healthRouter } from './api/health';
import { v1Router } from './api/v1';
import { env, isProduction, isTest } from './config/env';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';

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
  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  if (!isTest) {
    app.use(morgan(isProduction ? 'combined' : 'dev'));
  }

  app.use('/health', healthRouter);
  app.use('/api/v1', v1Router);

  // Hai handler này phải đứng CUỐI, đúng thứ tự này.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
