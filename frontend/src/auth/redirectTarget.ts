import type { PublicUser, TenantRole } from '../types/auth';

/**
 * Nơi cần tới sau khi đăng nhập — §2.6.
 *
 * Thứ tự ưu tiên, và lý do cho thứ tự đó:
 *
 *  1. `mustChangePassword` — cổng CỨNG, đứng trên tất cả. Người vừa được cấp
 *     mật khẩu tạm mà đi thẳng vào trang cũ là lọt cổng. `ProtectedRoute` chặn
 *     thêm một lần nữa để không phụ thuộc vào mỗi chỗ điều hướng này.
 *  2. `from` — trang họ đang định vào lúc bị đẩy về `/login`.
 *  3. Quản trị viên của tổ chức về `/admin`.
 *  4. Còn lại về trang chủ.
 *
 * `role` là vai trò TRONG TỔ CHỨC đang mở, không phải `user.platformRole`.
 * Khu quản trị ở đây quản lý một tổ chức, nên nó hỏi đúng trục vai trò đó.
 */
export function redirectTargetFor(
  user: PublicUser,
  role: TenantRole,
  from?: string | null,
): string {
  if (user.mustChangePassword) return '/change-password';
  if (from && isSafeInternalPath(from)) return from;
  if (role === 'admin') return '/admin';
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
