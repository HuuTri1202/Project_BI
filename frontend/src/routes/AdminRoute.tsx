import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';

/**
 * Chỉ cho Admin vào — §3.6, PHẦN GIAO DIỆN.
 *
 * ĐÂY KHÔNG PHẢI LÀ BẢO MẬT. Ẩn menu và chặn route ở trình duyệt chỉ giúp
 * người dùng khỏi lạc vào trang không dùng được; ai cũng sửa được biến trong
 * bộ nhớ trình duyệt hoặc gọi thẳng API bằng curl.
 *
 * Thực thi thật nằm ở backend: `authenticate` -> `requireRole('admin')` gắn cho
 * toàn bộ router `/api/admin`. Hai middleware đó đã viết xong ở Giai đoạn 1
 * nhưng chưa có endpoint `/api/admin` nào để gắn vào — sẽ nối ở Giai đoạn 3,
 * kèm bài kiểm tra "token Viewer curl vào /api/admin/... phải nhận 403".
 *
 * Đặt SAU `ProtectedRoute` trong cây route nên tới đây chắc chắn đã có `user`.
 */
export function AdminRoute(): React.ReactElement {
  // `role` là vai trò TRONG TỔ CHỨC đang mở, không phải `user.platformRole`.
  // Khu quản trị này quản lý một tổ chức nên nó hỏi đúng trục vai trò đó — một
  // `superadmin` cấp hệ thống không tự động là quản trị viên của tổ chức nào.
  const { role } = useAuth();

  if (role !== 'admin') return <Navigate to="/403" replace />;

  return <Outlet />;
}
