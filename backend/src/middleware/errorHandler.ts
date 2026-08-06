import type { NextFunction, Request, Response } from 'express';
import { isProduction } from '../config/env';

/** Route không khớp -> 404 JSON (không trả HTML mặc định của Express). */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: 'Not Found', path: req.originalUrl });
}

/**
 * Error handler cuối chuỗi middleware.
 * Express nhận diện error handler bằng ĐỦ 4 tham số — không được bỏ `_next`
 * dù không dùng tới.
 */
export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  console.error('[error]', err);

  res.status(500).json({
    error: 'Internal Server Error',
    // Chỉ lộ message ở dev; production không rò rỉ chi tiết nội bộ.
    ...(isProduction ? {} : { message: err.message }),
  });
}
