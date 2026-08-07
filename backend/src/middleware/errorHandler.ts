import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { isProduction } from '../config/env';
import { HttpError } from '../utils/httpError';

/** Route không khớp -> 404 JSON (không trả HTML mặc định của Express). */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: 'NotFound', message: 'Không tìm thấy đường dẫn này.', path: req.originalUrl });
}

/**
 * Gom các lỗi zod thành map theo từng trường để form hiển thị đúng chỗ.
 * Chỉ giữ lỗi ĐẦU TIÊN của mỗi trường — hiện một lúc ba lỗi cho cùng một ô chỉ
 * làm người dùng rối.
 */
function zodFields(error: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.');
    if (key && !(key in fields)) fields[key] = issue.message;
  }
  return fields;
}

/**
 * Error handler cuối chuỗi middleware.
 * Express nhận diện error handler bằng ĐỦ 4 tham số — không được bỏ `_next`
 * dù không dùng tới.
 */
export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  // Lỗi validate: trả 400 kèm map lỗi theo trường.
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'ValidationError',
      message: 'Dữ liệu không hợp lệ.',
      fields: zodFields(err),
    });
    return;
  }

  // Lỗi có chủ đích: dùng nguyên status/code/message do nơi ném quyết định.
  if (err instanceof HttpError) {
    res.status(err.status).json({
      error: err.code,
      message: err.message,
      ...(err.fields ? { fields: err.fields } : {}),
    });
    return;
  }

  // Còn lại là lỗi lập trình -> ghi log đầy đủ, trả ra ngoài thông báo chung.
  console.error('[error]', err);
  res.status(500).json({
    error: 'InternalServerError',
    message: 'Có lỗi xảy ra phía máy chủ.',
    // Chỉ lộ chi tiết ở dev; production không rò rỉ thông tin nội bộ.
    ...(isProduction ? {} : { detail: err.message }),
  });
}
