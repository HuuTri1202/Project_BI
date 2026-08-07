import type { RequestHandler } from 'express';
import type { UserRole } from '../repositories/users';
import { forbidden, unauthorized } from '../utils/httpError';

/**
 * Chặn theo vai trò (§3.6). Luôn đặt SAU `authenticate`.
 *
 * ĐÂY mới là nơi thực thi phân quyền thật. Việc ẩn menu ở frontend chỉ là trải
 * nghiệm người dùng — bất kỳ ai cũng gọi thẳng API được bằng curl.
 */
export function requireRole(...allowed: UserRole[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) {
      next(unauthorized());
      return;
    }
    if (!allowed.includes(req.auth.role)) {
      next(forbidden('Chức năng này chỉ dành cho quản trị viên.'));
      return;
    }
    next();
  };
}
