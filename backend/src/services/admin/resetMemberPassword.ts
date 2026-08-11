import { ADMIN_ERROR_CODES, type ResetMemberPasswordResultDto } from '@bi/shared';

import { mysqlPool } from '../../config/mysql';
import * as adminMembersRepo from '../../repositories/adminMembers';
import * as membershipsRepo from '../../repositories/memberships';
import * as usersRepo from '../../repositories/users';
import { HttpError, notFound } from '../../utils/httpError';
import { generateTempPassword, hashPassword } from '../auth/password';

/**
 * Cấp lại mật khẩu tạm cho một thành viên (§4.7).
 *
 * ─── Vấn đề mà nó giải ───────────────────────────────────────────────────────
 *
 * Mật khẩu tạm hiện đúng một lần trên màn hình rồi biến mất vĩnh viễn. Admin
 * quên chép, hoặc đóng nhầm bảng, hoặc F5 — và người vừa được tạo tài khoản
 * không có cách nào đăng nhập. Trước khi có hàm này, lối thoát duy nhất là gỡ họ
 * khỏi tổ chức rồi mời lại, mà việc đó KHÔNG hoạt động: `createMember` thấy email
 * đã tồn tại nên đi vào nhánh 'attached' và cố tình không cấp mật khẩu nào cả.
 * Tức là tài khoản đó chết hẳn.
 *
 * Không có đường nào ĐỌC LẠI mật khẩu cũ — database chỉ giữ hash bcrypt. Nên
 * "phục hồi" ở đây nghĩa là sinh mật khẩu MỚI và bật lại `must_change_password`.
 *
 * ─── Vì sao lắm chốt chặn thế ────────────────────────────────────────────────
 *
 * Đặt lại mật khẩu của ai đó là quyền mạnh nhất trong cả màn quản lý thành viên:
 * nó cho phép ĐĂNG NHẬP BẰNG tài khoản của người khác, chứ không chỉ sửa dữ liệu
 * của họ. Đổi vai trò hay khoá thành viên đều chỉ tác dụng trong phạm vi tổ chức
 * này; chiếm được tài khoản thì đi theo tài khoản đó tới mọi nơi nó vào được.
 * Vì vậy mỗi chốt dưới đây chặn đúng một đường leo thang, không cái nào thừa.
 */
export interface ResetMemberPasswordInput {
  tenantId: number;
  /** `req.auth.userId` — người bấm nút. KHÔNG bao giờ lấy từ body. */
  actorUserId: number;
  targetUserId: number;
}

export async function resetMemberPassword(
  input: ResetMemberPasswordInput,
): Promise<ResetMemberPasswordResultDto> {
  const { tenantId, actorUserId, targetUserId } = input;

  // ── Chốt 1: không tự cấp lại cho chính mình ────────────────────────────────
  //
  // Không phải để bảo vệ ai khỏi ai, mà vì nó vô nghĩa và có hại: admin sẽ tự
  // đặt mình vào trạng thái `must_change_password` bằng một mật khẩu họ vừa đọc
  // trên màn hình. Đường đúng là `/profile` -> đổi mật khẩu, ở đó có kiểm mật
  // khẩu hiện tại.
  if (actorUserId === targetUserId) {
    throw new HttpError(
      403,
      ADMIN_ERROR_CODES.CANNOT_MODIFY_SELF,
      'Không thể tự cấp lại mật khẩu cho chính mình. Dùng mục Hồ sơ cá nhân để đổi mật khẩu.',
    );
  }

  // ── Chốt 2: phải là thành viên CỦA TỔ CHỨC NÀY ─────────────────────────────
  //
  // `findMember` đã lọc `m.tenant_id = ?`, nên userId của tổ chức khác cho ra
  // `null` và ta trả 404. Trả 403 sẽ xác nhận rằng id đó có tồn tại.
  const member = await adminMembersRepo.findMember(mysqlPool, tenantId, targetUserId);
  if (!member || member.removedAt !== null) {
    throw notFound('Không tìm thấy thành viên này.');
  }

  // Đọc bản ghi `users` để biết trục NỀN TẢNG. `findMember` không trả về nó, và
  // `findAdminContext` thì lọc `m.is_active = 1` nên một thành viên đang bị khoá
  // sẽ cho ra null — không dùng được ở đây.
  const account = await usersRepo.findById(targetUserId);
  if (!account) throw notFound('Không tìm thấy thành viên này.');

  // ── Chốt 3: tài khoản bị khoá ở cấp hệ thống thì không đụng tới ────────────
  //
  // `users.is_active = 0` là quyết định của quản trị HỆ THỐNG. Cấp mật khẩu mới
  // cho một tài khoản đang bị đình chỉ là làm ngược lại ý định đó, dù mật khẩu
  // mới cũng chưa đăng nhập được.
  if (!account.isActive) {
    throw new HttpError(
      409,
      ADMIN_ERROR_CODES.ACCOUNT_UNAVAILABLE,
      'Tài khoản này đang bị khoá ở cấp hệ thống. Liên hệ quản trị hệ thống.',
    );
  }

  // ── Chốt 4: không đụng tới quản trị viên hệ thống ──────────────────────────
  //
  // Nếu một `superadmin` tình cờ là thành viên của tổ chức này, thì admin tổ
  // chức đặt lại được mật khẩu của họ nghĩa là chiếm được console vận hành toàn
  // hệ thống — từ một tài khoản không có quyền gì ngoài phạm vi tổ chức mình.
  if (account.platformRole === 'superadmin') {
    throw new HttpError(
      403,
      ADMIN_ERROR_CODES.PLATFORM_ADMIN_PROTECTED,
      'Không thể đặt lại mật khẩu của quản trị viên hệ thống.',
    );
  }

  // ── Chốt 5: tài khoản dùng chung với tổ chức khác thì không đụng tới ───────
  //
  // Đây là chốt quan trọng nhất, và là luật đã có sẵn trong `createMember`:
  // luồng 'attached' cố ý KHÔNG cấp mật khẩu cho người đã có tài khoản, vì
  // "admin của tổ chức này không có quyền đặt lại mật khẩu của một danh tính
  // dùng chung". Không có chốt này thì `reset-password` mở lại đúng cái cửa mà
  // `createMember` đã khoá: mời một email bất kỳ vào tổ chức mình, bấm cấp lại
  // mật khẩu, và thế là đăng nhập được vào tài khoản họ đang dùng ở công ty khác.
  const elsewhere = await membershipsRepo.countOtherActiveMemberships(
    mysqlPool,
    tenantId,
    targetUserId,
  );
  if (elsewhere > 0) {
    throw new HttpError(
      409,
      ADMIN_ERROR_CODES.SHARED_IDENTITY,
      'Người này còn là thành viên của tổ chức khác nên tài khoản của họ dùng chung cho ' +
        'cả nền tảng. Họ cần tự đặt lại mật khẩu, hoặc nhờ quản trị hệ thống.',
    );
  }

  // ── Ghi ────────────────────────────────────────────────────────────────────
  //
  // Băm ngoài mọi transaction: bcrypt cost 12 mất khoảng 290ms và chỉ đốt CPU.
  //
  // Không bọc transaction vì đây là MỘT câu UPDATE. Đánh đổi đã biết: hai admin
  // bấm cấp lại cùng lúc thì cả hai đều thành công và người bấm trước cầm một
  // mật khẩu không dùng được. Vô hại — bấm lại là xong — và không đáng đổi lấy
  // việc giữ một connection suốt thời gian băm.
  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  // `must_change_password = true`: admin vừa đọc mật khẩu này, nên nó phải chết
  // ngay sau lần đăng nhập đầu tiên của chủ tài khoản.
  await usersRepo.updatePassword(targetUserId, passwordHash, true);

  const updated = await adminMembersRepo.findMember(mysqlPool, tenantId, targetUserId);
  if (!updated) {
    throw new Error('Vừa cấp lại mật khẩu xong nhưng đọc lại thành viên không thấy');
  }

  return { user: updated, tempPassword };
}
