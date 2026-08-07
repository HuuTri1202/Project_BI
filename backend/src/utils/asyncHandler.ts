import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Bọc handler bất đồng bộ để lỗi rơi vào `next()`.
 *
 * Express 4 KHÔNG tự bắt promise bị reject. Viết `app.get('/x', async () => {
 * throw ... })` thì lỗi trở thành unhandled rejection, client treo cho tới khi
 * timeout, và errorHandler không bao giờ chạy. Mọi route async trong dự án đều
 * phải đi qua đây.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    void Promise.resolve(fn(req, res, next)).catch(next);
  };
}
