/**
 * Lỗi có chủ đích, mang sẵn mã HTTP để `errorHandler` trả đúng status.
 *
 * Mọi lỗi KHÔNG phải HttpError đều bị coi là lỗi lập trình và trả 500 với thông
 * báo chung — nhờ vậy không có đường nào rò rỉ chi tiết nội bộ ra ngoài do sơ ý.
 */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  /** Lỗi theo từng trường, dùng cho form: { email: 'Email không đúng định dạng' } */
  readonly fields: Readonly<Record<string, string>> | undefined;

  constructor(
    status: number,
    code: string,
    message: string,
    fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

export const badRequest = (message: string, fields?: Record<string, string>): HttpError =>
  new HttpError(400, 'ValidationError', message, fields);

export const unauthorized = (message = 'Bạn cần đăng nhập.'): HttpError =>
  new HttpError(401, 'Unauthorized', message);

export const forbidden = (message = 'Bạn không có quyền thực hiện thao tác này.'): HttpError =>
  new HttpError(403, 'Forbidden', message);

export const notFound = (message = 'Không tìm thấy.'): HttpError =>
  new HttpError(404, 'NotFound', message);

export const conflict = (code: string, message: string): HttpError =>
  new HttpError(409, code, message);
