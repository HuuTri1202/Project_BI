import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Bọc handler async để lỗi của nó đến được `errorHandler`.
 *
 * BẮT BUỘC với mọi route async, không phải tuỳ chọn. Express 4 không hiểu
 * Promise: nếu handler trả về một Promise bị reject, Express không biết gì cả —
 * `next(err)` không bao giờ được gọi, `errorHandler` không bao giờ chạy, request
 * treo cho tới khi client timeout, và Node chỉ in một unhandled rejection.
 *
 * (Express 5 làm việc này sẵn. Repo đang ở Express 4.)
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    void fn(req, res, next).catch(next);
  };
}
