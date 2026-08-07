import type { RequestHandler } from 'express';
import type { TenantRole } from '../repositories/memberships';
import { forbidden, unauthorized } from '../utils/httpError';

/**
 * Chặn theo vai trò TRONG TỔ CHỨC (§3.6). Luôn đặt SAU `authenticate`.
 *
 * ĐÂY mới là nơi thực thi phân quyền thật. Việc ẩn menu ở frontend chỉ là trải
 * nghiệm người dùng — bất kỳ ai cũng gọi thẳng API được bằng curl.
 *
 * `superadmin` KHÔNG được đi tắt qua đây. Nghe có vẻ tiện, nhưng nó biến mọi
 * kiểm tra quyền trong hệ thống thành "trừ khi là superadmin", và một tài khoản
 * vận hành bị chiếm là mất sạch dữ liệu của mọi tổ chức. Muốn superadmin làm
 * việc trong một tổ chức thì cấp cho họ một `membership` thật — có dấu vết,
 * thu hồi được, và hiện ra trong danh sách thành viên.
 */
export function requireRole(...allowed: TenantRole[]): RequestHandler {
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

/** Chặn theo vai trò cấp NỀN TẢNG — dành cho khu vận hành hệ thống, chưa dùng. */
export function requirePlatformRole(...allowed: ('superadmin' | 'user')[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) {
      next(unauthorized());
      return;
    }
    if (!allowed.includes(req.auth.platformRole)) {
      next(forbidden('Chức năng này chỉ dành cho quản trị hệ thống.'));
      return;
    }
    next();
  };
}
