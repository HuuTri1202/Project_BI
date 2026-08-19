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
 *  3. Còn lại về trang chủ, và `/` tự rẽ sang `/home`.
 *
 * ─── Vì sao quản trị viên HỆ THỐNG cũng về trang chủ ────────────────────────
 *
 * Bản trước đưa thẳng `platformRole === 'superadmin'` vào `/admin`. Bỏ đi vì hai
 * lý do:
 *
 *   - Superadmin cũng là một người dùng bình thường của tổ chức mình. Ném họ vào
 *     console vận hành ngay khi đăng nhập nghĩa là muốn xem workspace hay dữ liệu
 *     của chính mình thì phải tự gõ địa chỉ.
 *   - Console là nơi thao tác trên dữ liệu của MỌI tổ chức. Rơi thẳng vào đó mỗi
 *     lần đăng nhập biến nó thành mặc định, trong khi nó nên là một nơi người ta
 *     chủ động đi tới.
 *
 * Đường vào giờ là nút "Admin Console" hiện trên trang chủ, chỉ với superadmin.
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
  // chủ động muốn tới. Hiện tại cả hai nhánh đều ra `/` nên phép kiểm này không
  // đổi kết quả — giữ lại vì nó là thứ giữ cho quy tắc "nhớ trang đang dở" không
  // âm thầm đè lên bất kỳ nhánh theo vai trò nào được thêm sau này. Đó đúng là
  // cách lỗi cũ đã lọt ra sản phẩm.
  if (from && from !== '/' && isSafeInternalPath(from)) return from;
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
