import type { RequestHandler } from 'express';

import { mysqlPool } from '../config/mysql';
import * as adminMembersRepo from '../repositories/adminMembers';
import { forbidden, unauthorized } from '../utils/httpError';
import { requireAuth } from './authenticate';

/**
 * Đọc lại quyền quản trị TỪ DATABASE ở mỗi request của khu quản trị.
 *
 * ─── Gác bằng trục NỀN TẢNG, không phải trục tổ chức ─────────────────────────
 *
 * Khu quản trị này là công cụ VẬN HÀNH HỆ THỐNG, chỉ dành cho tài khoản
 * `users.role = 'superadmin'` (tài khoản sinh bằng `npm run seed:admin`).
 *
 * Trước đây nó gác bằng `memberships.role = 'admin'` — trục TỔ CHỨC — và đó là
 * lỗi: luồng đăng ký cấp cho người tự đăng ký vai trò `admin` trong chính tổ
 * chức họ vừa lập (xem FOUNDER_ROLE trong services/auth/registerAccount.ts).
 * Nghĩa là BẤT KỲ AI đăng ký xong cũng vào thẳng được khu quản trị. Hai trục vai
 * trò tồn tại sẵn trong schema chính là để tránh chuyện này, nhưng chưa được
 * dùng đúng chỗ.
 *
 * Người dùng đăng ký bình thường sẽ có khu vực riêng của họ — chưa xây.
 *
 * ─── Vì sao vẫn phải hỏi lại database ────────────────────────────────────────
 *
 * `authenticate` cố ý không truy vấn database, còn `JWT_EXPIRES_IN` mặc định là
 * 7 ngày. Claim `platformRole` trong token phản ánh trạng thái tại thời điểm
 * ĐĂNG NHẬP, có thể đã cũ cả tuần — một tài khoản vừa bị hạ khỏi superadmin,
 * vừa bị khoá, hoặc vừa bị gỡ khỏi tổ chức vẫn cầm token hợp lệ về chữ ký.
 *
 * `requirePlatformRole` đứng trước file này đọc claim nên tốn 0 truy vấn: token
 * của người thường bị chặn mà không chạm MySQL. Chỉ request TỰ XƯNG là
 * superadmin mới phải trả giá một vòng DB. Lớp rẻ lọc phần lớn, lớp đắt mới là
 * lớp đáng tin.
 */
export const requireFreshAdmin: RequestHandler = (req, _res, next) => {
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
      // Không còn membership hợp lệ trong tổ chức đang mở, hoặc tài khoản đã bị
      // khoá/xoá toàn hệ thống -> 401 chứ không phải 403: đây là phiên không còn
      // giá trị, không phải chuyện thiếu quyền. Frontend thấy 401 sẽ đưa về
      // trang đăng nhập, đúng việc cần làm.
      if (!ctx || !ctx.userActive) {
        next(unauthorized('Phiên đăng nhập không còn hiệu lực.'));
        return;
      }
      if (ctx.platformRole !== 'superadmin') {
        next(forbidden('Chức năng này chỉ dành cho quản trị hệ thống.'));
        return;
      }

      // DB thắng token: handler phía sau đọc `req.auth` sẽ thấy vai trò THẬT,
      // không phải vai trò lúc đăng nhập.
      req.auth = { ...auth, role: ctx.role, platformRole: ctx.platformRole };
      next();
    })
    .catch(next);
};
