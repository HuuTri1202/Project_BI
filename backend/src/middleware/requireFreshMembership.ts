import { ERROR_CODES } from '@bi/shared';
import type { RequestHandler } from 'express';

import { mysqlPool } from '../config/mysql';
import * as adminMembersRepo from '../repositories/adminMembers';
import { HttpError, unauthorized } from '../utils/httpError';
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

/**
 * Chốt mật khẩu TẠM — dùng chung cho cả hai middleware "tươi".
 *
 * ═══ Vì sao chốt này phải nằm ở BACKEND ════════════════════════════════════
 *
 * `must_change_password` bật lên khi Admin tạo thành viên bằng một mật khẩu
 * tạm (`services/admin/createMember.ts`) — một chứng thực mà NGƯỜI KHÁC đang
 * biết. Trước đây thứ duy nhất buộc đổi nó là một lệnh điều hướng của React
 * Router (`auth/redirectTarget.ts` tự gọi mình là "cổng CỨNG"), trong khi
 * `/login` vẫn cấp một token 7 ngày đầy quyền. Nghĩa là ai gọi API trực tiếp,
 * hoặc chỉ cần copy token khỏi `localStorage`, là đi thẳng qua cổng — và mật
 * khẩu tạm ấy không bao giờ phải hết hiệu lực.
 *
 * ═══ Vì sao 403 chứ không phải 401 ═════════════════════════════════════════
 *
 * Phiên này HỢP LỆ, chỉ là chưa được phép làm gì khác ngoài đổi mật khẩu. Trả
 * 401 sẽ khiến frontend dọn token và đá về trang đăng nhập, nơi họ đăng nhập
 * lại bằng đúng mật khẩu tạm đó rồi lặp vô hạn.
 *
 * ═══ Lối ra luôn mở ════════════════════════════════════════════════════════
 *
 * `/api/auth/*` KHÔNG đi qua middleware này, nên `POST /auth/change-password`
 * vẫn gọi được. Người bị chặn ở đây luôn có đúng một việc làm được, và đó là
 * việc ta muốn họ làm. Ai mất luôn mật khẩu tạm thì đi `forgot-password` —
 * `datLaiMatKhau` hạ cờ này xuống.
 */
const MAT_KHAU_TAM =
  'Tài khoản đang dùng mật khẩu tạm. Hãy đổi mật khẩu trước khi dùng các chức năng khác.';

export function loiMatKhauTam(): HttpError {
  return new HttpError(403, ERROR_CODES.PASSWORD_CHANGE_REQUIRED, MAT_KHAU_TAM);
}
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

      // Đọc từ DB, KHÔNG từ token: cờ này hạ xuống ngay khi người dùng đổi mật
      // khẩu, mà token trong tay họ vẫn là token cũ còn mang cờ bật.
      if (ctx.mustChangePassword) {
        next(loiMatKhauTam());
        return;
      }

      // DB thắng token. Từ đây trở đi, handler đọc `req.auth.role` là đọc vai
      // trò THẬT, không phải vai trò lúc đăng nhập.
      req.auth = { ...auth, role: ctx.role, platformRole: ctx.platformRole };
      next();
    })
    .catch(next);
};
