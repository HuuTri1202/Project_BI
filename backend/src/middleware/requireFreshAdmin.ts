import type { RequestHandler } from 'express';

import { mysqlPool } from '../config/mysql';
import * as adminMembersRepo from '../repositories/adminMembers';
import { forbidden, unauthorized } from '../utils/httpError';
import { requireAuth } from './authenticate';

/**
 * Đọc lại quyền quản trị TỪ DATABASE ở mỗi request của khu quản trị.
 *
 * ─── Vì sao `requireRole('admin')` một mình là chưa đủ ───────────────────────
 *
 * `authenticate` cố ý không truy vấn database (ghi rõ trong file đó), còn
 * `JWT_EXPIRES_IN` mặc định là 7 ngày. Nghĩa là claim `role` trong token phản
 * ánh trạng thái tại thời điểm ĐĂNG NHẬP, có thể đã cũ cả tuần. Một người vừa bị
 * hạ xuống `viewer`, vừa bị khoá, hoặc vừa bị gỡ khỏi tổ chức vẫn cầm một token
 * ghi `role: 'admin'` hoàn toàn hợp lệ về chữ ký.
 *
 * Chính comment trong `authenticate.ts` đã hẹn rằng "API quản trị sẽ đọc lại
 * user từ DB" — file này là chỗ thực hiện lời hẹn đó, vì không có gì khác ép
 * được nó.
 *
 * ─── Vì sao vẫn giữ `requireRole` đứng trước ─────────────────────────────────
 *
 * `requireRole` đọc claim nên tốn 0 truy vấn: token của `viewer` bị chặn mà
 * không chạm MySQL. Chỉ request TỰ XƯNG là admin mới phải trả giá một vòng DB.
 * Hai lớp bổ sung cho nhau — lớp rẻ lọc phần lớn, lớp đắt mới là lớp đáng tin.
 *
 * ─── Về chi phí, và vì sao không cache ───────────────────────────────────────
 *
 * Một round trip, các lần tra đều đi theo index — cỡ 0.3–1 ms trên localhost, so
 * với 10–20 ms xử lý của một request Express. Khu quản trị cũng là mặt ít lưu
 * lượng nhất sản phẩm.
 *
 * Cache Redis với TTL chỉ làm nhỏ lại độ trễ chứ không xoá bỏ nó, đổi lại phải
 * viết code vô hiệu hoá cache ở mọi chỗ đổi vai trò. Còn phương án "đọc thì chấp
 * nhận cũ, chỉ kiểm lại khi ghi" thì bỏ sót đúng mối nguy chính: một admin vừa
 * bị gỡ quyền ĐỌC được toàn bộ danh sách nhân sự kèm email — bản thân việc đọc
 * đã là rò rỉ, không cần sửa gì cả.
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
      // Không còn membership hợp lệ, hoặc tài khoản đã bị khoá/xoá toàn hệ
      // thống -> 401 chứ không phải 403: đây là phiên không còn giá trị, không
      // phải chuyện thiếu quyền. Frontend thấy 401 sẽ đưa về trang đăng nhập,
      // đúng việc cần làm.
      if (!ctx || !ctx.userActive) {
        next(unauthorized('Phiên đăng nhập không còn hiệu lực.'));
        return;
      }
      if (ctx.role !== 'admin') {
        next(forbidden('Chức năng này chỉ dành cho quản trị viên.'));
        return;
      }

      // DB thắng token: những handler phía sau đọc `req.auth.role` sẽ thấy vai
      // trò THẬT, không phải vai trò lúc đăng nhập.
      req.auth = { ...auth, role: ctx.role };
      next();
    })
    .catch(next);
};
