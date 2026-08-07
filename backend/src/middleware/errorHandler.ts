import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { isProduction } from '../config/env';
import { HttpError } from '../utils/httpError';

/**
 * Mọi lỗi của API đều có đúng MỘT hình dạng:
 *   { error: '<Code>', message: '<tiếng Việt>', fields?: { <trường>: '<lý do>' } }
 *
 * Một API có hai dạng lỗi còn tệ hơn là chọn nhầm một dạng — client phải viết
 * hai nhánh parse và sẽ luôn quên một nhánh.
 */

/** Route không khớp -> 404 JSON (không trả HTML mặc định của Express). */
export function notFoundHandler(req: Request, res: Response): void {
  res
    .status(404)
    .json({ error: 'NotFound', message: 'Không tìm thấy đường dẫn này.', path: req.originalUrl });
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
 * Rút thông tin log AN TOÀN từ một lỗi.
 *
 * KHÔNG log nguyên object lỗi. Object lỗi của mysql2 mang theo cả `sql` lẫn
 * `sqlMessage`, mà câu `INSERT INTO users ...` thì có bcrypt hash nằm ngay
 * trong danh sách tham số. Log nguyên object là đưa hash mật khẩu của người
 * dùng vào file log — nơi thường được thu thập, chuyển đi và giữ lâu hơn cả
 * database.
 */
function describeForLog(err: unknown): string {
  if (err instanceof HttpError) {
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
    // Lỗi 4xx là chuyện bình thường (gõ sai mật khẩu, email trùng), không phải
    // sự cố — log ở mức warn và không kèm stack. Đổ stack cho mỗi lần ai đó gõ
    // sai mật khẩu sẽ nhấn chìm những lỗi thật sự đáng đọc.
    console.warn('[error]', describeForLog(err));

    res.status(err.status).json({
      error: err.code,
      message: err.message,
      ...(err.fields ? { fields: err.fields } : {}),
    });
    return;
  }

  // Còn lại là lỗi lập trình -> log ĐÃ LỌC, trả ra ngoài thông báo chung.
  console.error('[error]', describeForLog(err));
  if (!isProduction && err.stack) {
    console.error(err.stack);
  }

  res.status(500).json({
    error: 'InternalServerError',
    message: 'Có lỗi xảy ra phía máy chủ.',
    // Chỉ lộ chi tiết ở dev; production không rò rỉ thông tin nội bộ.
    ...(isProduction ? {} : { detail: err.message }),
  });
}
