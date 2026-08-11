import type { RequestHandler } from 'express';

import { mysqlPool } from '../config/mysql';
import * as adminMembersRepo from '../repositories/adminMembers';
import { unauthorized } from '../utils/httpError';
import { requireAuth } from './authenticate';

/**
 * Đọc lại vai trò TRONG TỔ CHỨC từ database ở mỗi request của khu người dùng.
 *
 * ─── Vì sao `requireRole` một mình là không đủ ───────────────────────────────
 *
 * `requireRole('admin')` đọc claim `role` trong token. `authenticate` cố ý không
 * truy vấn database, còn `JWT_EXPIRES_IN` mặc định là 7 ngày. Nghĩa là claim đó
 * phản ánh trạng thái tại thời điểm ĐĂNG NHẬP: một người vừa bị hạ xuống
 * `viewer`, vừa bị khoá, hay vừa bị gỡ khỏi tổ chức vẫn cầm một token hợp lệ về
 * chữ ký và vẫn qua được `requireRole('admin')` suốt cả tuần.
 *
 * Middleware này chạy TRƯỚC `requireRole` và ghi đè `req.auth.role` bằng vai trò
 * thật trong DB. Sau nó, `requireRole` mới là thứ đáng tin — và dùng lại được
 * nguyên vẹn, không phải sửa một dòng nào.
 *
 * ─── Khác gì `requireFreshAdmin` ─────────────────────────────────────────────
 *
 * `requireFreshAdmin` gác trục NỀN TẢNG (`users.role = 'superadmin'`) cho console
 * vận hành. File này gác trục TỔ CHỨC và không đòi vai trò nào cả — nó chỉ trả
 * lời "phiên này còn là thành viên hợp lệ không". Việc đòi `admin` là của
 * `requireRole('admin')` gắn thêm cho từng route ghi.
 *
 * Cả hai dùng chung `findAdminContext` nên tiêu chí "còn hợp lệ" chỉ có một định
 * nghĩa: user chưa xoá và chưa khoá, tenant chưa xoá và chưa khoá, membership
 * còn `is_active = 1` và `removed_at IS NULL`.
 *
 * ─── Vì sao 401 chứ không phải 403 ───────────────────────────────────────────
 *
 * Không còn membership hợp lệ nghĩa là PHIÊN này không còn giá trị, không phải
 * "bạn thiếu quyền cho việc vừa rồi". Frontend thấy 401 sẽ dọn token và đưa về
 * trang đăng nhập — đúng việc cần làm. Trả 403 sẽ để người dùng kẹt trong một
 * giao diện mà mọi thứ đều báo lỗi và không có lối ra.
 */
export const requireFreshMembership: RequestHandler = (req, _res, next) => {
  let auth: NonNullable<typeof req.auth>;
  try {
    auth = requireAuth(req);
  } catch (err) {
    next(err);
    return;
  }

  adminMembersRepo
    .findAdminContext(mysqlPool, auth.tenantId, auth.userId)
    .then((ctx) => {
      if (!ctx || !ctx.userActive) {
        next(unauthorized('Phiên đăng nhập không còn hiệu lực.'));
        return;
      }

      // DB thắng token. Từ đây trở đi, handler đọc `req.auth.role` là đọc vai
      // trò THẬT, không phải vai trò lúc đăng nhập.
      req.auth = { ...auth, role: ctx.role, platformRole: ctx.platformRole };
      next();
    })
    .catch(next);
};
