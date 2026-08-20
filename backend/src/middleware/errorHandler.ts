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
 * Lỗi do `express.json()` ném khi KHÔNG ĐỌC NỔI thân yêu cầu.
 *
 * ─── Vì sao phải có nhánh riêng ─────────────────────────────────────────────
 *
 * Không có nhánh này thì một thân JSON gõ sai rơi thẳng xuống nhánh cuối và trở
 * thành `500 InternalServerError`. Sai ở hai mức:
 *
 *   - Sai với client: nó vừa gửi một request hỏng, nhưng câu trả lời lại nói
 *     "lỗi phía máy chủ". Người đi sửa sẽ tìm nhầm chỗ.
 *   - Sai với người vận hành, và đây mới là chỗ đau: mọi công cụ theo dõi đều
 *     đếm 5xx như tín hiệu hệ thống đang hỏng. Một client gõ sai đủ sức đẩy tỉ
 *     lệ 5xx lên và gọi người trực dậy lúc ba giờ sáng cho một chuyện không hề
 *     xảy ra ở phía ta.
 *
 * ─── Vì sao nhận diện bằng `type`, KHÔNG bằng `instanceof SyntaxError` ──────
 *
 * Bắt `SyntaxError` thì rộng quá mức. Bất kỳ chỗ nào trong mã cũng có thể ném
 * `SyntaxError` — một `JSON.parse` trên dữ liệu ta tự tin là hợp lệ chẳng hạn —
 * và một lỗi như thế ĐÚNG LÀ lỗi lập trình đáng trả 500. Đổi nó thành 400 là
 * tự tay giấu đi một khiếm khuyết thật.
 *
 * `type` là nhãn body-parser gắn riêng cho "không đọc nổi thân request", nên nó
 * khoanh đúng vào tình huống ta muốn khoanh. Danh sách dưới đây là danh sách
 * TRẮNG: nhãn lạ vẫn rơi xuống nhánh 500, vì một nhãn ta chưa từng thấy thì
 * chưa có cơ sở nào để gọi nó là lỗi của client.
 */
const BODY_PARSER_ERRORS: Record<string, { code: string; message: string }> = {
  'entity.parse.failed': {
    code: 'MalformedBody',
    message: 'Thân yêu cầu không phải JSON hợp lệ.',
  },
  'entity.too.large': {
    code: 'PayloadTooLarge',
    message: 'Thân yêu cầu vượt quá giới hạn 1MB.',
  },
  'encoding.unsupported': {
    code: 'MalformedBody',
    message: 'Kiểu nén của thân yêu cầu không được hỗ trợ.',
  },
  'charset.unsupported': {
    code: 'MalformedBody',
    message: 'Bảng mã của thân yêu cầu không được hỗ trợ.',
  },
  'request.aborted': {
    code: 'MalformedBody',
    message: 'Yêu cầu bị ngắt trước khi gửi xong.',
  },
};

interface BodyParserError extends Error {
  /** Nhãn loại lỗi body-parser gắn, ví dụ `entity.parse.failed`. */
  type?: unknown;
  /** body-parser đã tự chọn sẵn mã trạng thái đúng cho từng loại. */
  status?: unknown;
}

/**
 * `null` nghĩa là không phải lỗi body-parser đã biết — để nhánh sau xử lý.
 *
 * ⚠️ Lấy `status` của chính lỗi thay vì đóng cứng 400. body-parser đã chọn đúng
 * rồi: `413` cho thân quá lớn, `415` cho bảng mã lạ. Ghi đè tất cả thành 400 sẽ
 * biến "file của bạn quá lớn" thành "yêu cầu của bạn sai định dạng" — một câu
 * trả lời sai, và sai theo hướng khiến người dùng sửa nhầm thứ.
 */
function asBodyParserError(err: Error): { status: number; code: string; message: string } | null {
  const { type, status } = err as BodyParserError;
  if (typeof type !== 'string') return null;

  const known = BODY_PARSER_ERRORS[type];
  if (known === undefined) return null;

  return {
    status: typeof status === 'number' ? status : 400,
    code: known.code,
    message: known.message,
  };
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

  // Thân yêu cầu không đọc nổi -> lỗi của client, không phải sự cố của ta.
  // Cùng mức log `warn` với 4xx ở trên, vì cùng loại chuyện: bình thường.
  const bodyErr = asBodyParserError(err);
  if (bodyErr !== null) {
    console.warn('[error]', `BodyParser(${bodyErr.code}): ${err.message}`);
    res.status(bodyErr.status).json({ error: bodyErr.code, message: bodyErr.message });
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
