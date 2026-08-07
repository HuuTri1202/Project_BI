import type { NextFunction, Request, Response } from 'express';
import { isProduction } from '../config/env';
import { AppError } from '../errors/AppError';

/**
 * Mọi lỗi của API đều có đúng một hình dạng:
 *   { error: { code, message, fields? } }
 *
 * Một API có hai dạng lỗi còn tệ hơn là chọn nhầm một dạng — client phải viết
 * hai nhánh parse và sẽ luôn quên một nhánh.
 */

/** Route không khớp -> 404 JSON (không trả HTML mặc định của Express). */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: 'Not Found', path: req.originalUrl },
  });
}

/**
 * Rút thông tin log an toàn từ một lỗi.
 *
 * KHÔNG log nguyên object lỗi: object lỗi của mysql2 mang theo cả `sql` và
 * `sqlMessage`, mà câu `INSERT INTO users` thì có bcrypt hash nằm trong tham số.
 * Log nguyên object là đưa hash mật khẩu vào file log.
 */
function describeForLog(err: unknown): string {
  if (err instanceof AppError) {
    return `${err.name}(${err.code}): ${err.message}`;
  }
  if (err instanceof Error) {
    const { code } = err as NodeJS.ErrnoException;
    return code ? `${err.name}(${code}): ${err.message}` : `${err.name}: ${err.message}`;
  }
  return String(err);
}

/**
 * Error handler cuối chuỗi middleware.
 * Express nhận diện error handler bằng ĐỦ 4 tham số — không được bỏ `_next`
 * dù không dùng tới.
 */
export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    // Lỗi 4xx là chuyện bình thường (gõ sai mật khẩu, email trùng), không phải
    // sự cố — log ở mức warn và không kèm stack.
    console.warn('[error]', describeForLog(err));

    res.status(err.httpStatus).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.fields ? { fields: err.fields } : {}),
      },
    });
    return;
  }

  console.error('[error]', describeForLog(err));
  if (!isProduction && err.stack) {
    console.error(err.stack);
  }

  res.status(500).json({
    error: {
      code: 'INTERNAL',
      message: 'Internal Server Error',
      // Chỉ lộ message ở dev; production không rò rỉ chi tiết nội bộ.
      ...(isProduction ? {} : { debug: err.message }),
    },
  });
}
