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
 * ─── Quản trị viên HỆ THỐNG vào thẳng console ───────────────────────────────
 *
 * `platformRole === 'superadmin'` là tài khoản VẬN HÀNH NỀN TẢNG (sinh bằng
 * `seed:admin`), không phải một người dùng tình cờ có thêm quyền. Việc của họ là
 * quản trị hệ thống, nên đó phải là nơi họ rơi vào.
 *
 * ⚠️ Đây là ĐẢO LẠI một quyết định trước đó, và lý lẽ cũ vẫn được ghi ở đây để
 * người sau không đảo ngược lần nữa mà không biết mình đang đảo cái gì. Bản
 * trước cho superadmin về trang chủ với hai lập luận:
 *
 *   1. "Superadmin cũng là người dùng bình thường của tổ chức mình."
 *   2. "Console thao tác trên dữ liệu MỌI tổ chức nên phải là nơi chủ động đi
 *      tới, không phải mặc định."
 *
 * Cả hai đúng về nguyên tắc và sai về thực tế của tài khoản này: tổ chức
 * `bi-platform` mà `seed:admin` tạo ra chỉ tồn tại để thoả ràng buộc membership
 * — nó không có dữ liệu, không có báo cáo, không có ai khác trong đó. Bắt người
 * vận hành đi qua một trang chủ trống rồi bấm thêm một nút là thêm một bước cho
 * mọi lần đăng nhập, để đổi lấy một quyền riêng tư mà không ai cần.
 *
 * Lập luận (2) vẫn được tôn trọng ở chỗ khác: `AdminRoute` và ba lớp guard ở
 * backend mới là thứ quyết định ai vào được console. Điều hướng này chỉ chọn
 * NƠI RƠI VÀO, nó không cấp quyền gì.
 *
 * Không phải cửa một chiều: `AdminLayout` có mục "Khu làm việc" dẫn về `/home`.
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
  // chủ động muốn tới. Bỏ phép kiểm này thì superadmin bị phiên hết hạn ở `/`
  // sẽ quay lại đúng `/` thay vì về console — và đó chính là cách lỗi cũ đã lọt
  // ra sản phẩm.
  if (from && from !== '/' && isSafeInternalPath(from)) return from;

  return user.platformRole === 'superadmin' ? '/admin' : '/';
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
