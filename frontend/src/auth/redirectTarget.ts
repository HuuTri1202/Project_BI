import type { PublicUser, TenantRole } from '../types/auth';

/**
 * Nơi cần tới sau khi đăng nhập — §2.6.
 *
 * Thứ tự ưu tiên, và lý do cho thứ tự đó:
 *
 *  1. `mustChangePassword` — cổng CỨNG, đứng trên tất cả. Người vừa được cấp
 *     mật khẩu tạm mà đi thẳng vào trang cũ là lọt cổng. `ProtectedRoute` chặn
 *     thêm một lần nữa để không phụ thuộc vào mỗi chỗ điều hướng này.
 *  2. `from` — trang họ đang định vào lúc bị đẩy về `/login`, TRỪ `/`.
 *  3. Quản trị viên HỆ THỐNG về `/admin`.
 *  4. Còn lại về trang chủ.
 *
 * Bước 3 hỏi `user.platformRole` (`users.role`), KHÔNG phải `role`
 * (`memberships.role`). Khu quản trị là công cụ vận hành hệ thống; vai trò
 * `admin` trong một tổ chức không mở được nó. Tham số `role` giữ lại vì nơi gọi
 * đã truyền sẵn và các bước sau sẽ cần khi có khu vực riêng cho người dùng.
 */
export function redirectTargetFor(
  user: PublicUser,
  role: TenantRole,
  from?: string | null,
): string {
  void role;
  if (user.mustChangePassword) return '/change-password';
  // `from === '/'` KHÔNG được tính là "trang đang dở".
  //
  // `/` là điểm rơi mặc định của mọi phiên hết hạn, không phải nơi người dùng
  // chủ động muốn tới. Coi nó là một đích cụ thể sẽ khiến quy tắc "nhớ trang
  // đang dở" đè lên quy tắc "quản trị viên về /admin", và admin bị trả về một
  // trang trống dù vừa đăng nhập xong. Lỗi này chỉ xuất hiện khi phiên hết hạn
  // đúng lúc đang ở trang chủ, nên rất dễ lọt qua khâu thử tay.
  if (from && from !== '/' && isSafeInternalPath(from)) return from;
  if (user.platformRole === 'superadmin') return '/admin';
  return '/';
}

/**
 * Chỉ nhận đường dẫn nội bộ.
 *
 * `location.state` do chính app đặt nên trên lý thuyết là an toàn, nhưng nó đi
 * qua history của trình duyệt và sửa được bằng `history.pushState`. Không lọc
 * thì `//evil.com` hay `https://evil.com` trở thành open redirect: người dùng
 * đăng nhập xong bị ném thẳng sang trang giả mạo.
 *
 * Chặn cả `//` và `\\` vì trình duyệt hiểu cả hai là URL giao thức tương đối.
 */
function isSafeInternalPath(path: string): boolean {
  return path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\');
}
