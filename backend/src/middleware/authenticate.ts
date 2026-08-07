import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { verifyAccessToken } from '../services/auth/token';
import { unauthorized } from '../utils/httpError';

/**
 * Đọc `Authorization: Bearer <token>`, xác thực, gắn `req.auth`.
 *
 * Chỉ kiểm token — KHÔNG truy vấn database. Đổi lại tốc độ, ta chấp nhận độ trễ
 * giữa lúc tài khoản bị khoá và lúc token hết hạn. Những thao tác nhạy cảm
 * (đổi mật khẩu, API quản trị) sẽ đọc lại user từ DB nên vẫn thấy trạng thái
 * mới nhất.
 */
export const authenticate: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;

  if (!header?.startsWith('Bearer ')) {
    next(unauthorized('Thiếu token xác thực.'));
    return;
  }

  const token = header.slice('Bearer '.length).trim();
  if (!token) {
    next(unauthorized('Thiếu token xác thực.'));
    return;
  }

  try {
    req.auth = verifyAccessToken(token);
    next();
  } catch (err) {
    next(err);
  }
};

/**
 * Lấy `req.auth` đã thu hẹp kiểu.
 *
 * TypeScript không biết `authenticate` đã chạy trước đó nên `req.auth` vẫn là
 * optional. Gọi hàm này thay vì `req.auth!` để nếu ai đó quên gắn middleware
 * thì nhận 401 rõ ràng chứ không phải lỗi đọc thuộc tính của undefined.
 */
export function requireAuth(req: Request): NonNullable<Request['auth']> {
  if (!req.auth) throw unauthorized();
  return req.auth;
}

export type { NextFunction, Response };
