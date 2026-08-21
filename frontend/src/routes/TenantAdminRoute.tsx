import type { PermissionFlag } from '../auth/usePermissions';
import { Navigate, Outlet } from 'react-router-dom';
import { usePermissions } from '../auth/usePermissions';

/**
 * Cổng route theo QUYỀN TRONG TỔ CHỨC — §4.8, phía giao diện.
 *
 * Tên còn chữ "Admin" là dấu vết lịch sử: lúc mới viết, mọi ô nó gác đều là ô
 * của admin. Nay `readDatasets` và `readDataModels` cũng đi qua đây, và creator
 * qua được — nên đọc cái tên như "cổng theo vai trò tổ chức", đừng đọc như
 * "chỉ admin". Ô nào gác thì `needs` nói ra, không phải cái tên.
 *
 * Hỏi `role` (`memberships.role`), KHÔNG phải `user.platformRole`. Đây là ranh
 * giới dễ lẫn nhất trong dự án, nên nói rõ:
 *
 *   AdminRoute       hỏi `platformRole === 'superadmin'`  -> console vận hành /admin
 *   TenantAdminRoute hỏi `role === 'admin'`               -> §4.5, §4.7 trong khu người dùng
 *
 * Người tự đăng ký được cấp `admin` trong tổ chức họ vừa lập, nên họ QUA được
 * cổng này — đúng ý — nhưng không qua được `AdminRoute`.
 *
 * ĐÂY KHÔNG PHẢI LÀ BẢO MẬT. Ẩn menu và chặn route ở trình duyệt chỉ giúp người
 * dùng khỏi lạc vào trang không dùng được; ai cũng sửa được biến trong bộ nhớ
 * trình duyệt hoặc gọi thẳng API bằng curl. Thực thi thật là
 * `requireFreshMembership` -> `requireRole('admin')` trên router `/api/v1`.
 *
 * Đặt SAU `ProtectedRoute` trong cây route nên tới đây chắc chắn đã có phiên.
 */
export function TenantAdminRoute({
  needs,
}: {
  /**
   * Quyền mà route bên trong đòi hỏi.
   *
   * Nhận tham số thay vì cứng `role === 'admin'` để cổng route và mục sidebar
   * đọc CÙNG một ô trong bảng quyền. Hai chỗ tự so sánh riêng là cách sinh ra
   * mục menu hiện lên rồi dẫn thẳng tới trang 403.
   */
  needs: PermissionFlag;
}): React.ReactElement {
  const permissions = usePermissions();

  if (!permissions[needs]) return <Navigate to="/403" replace />;

  return <Outlet />;
}
