import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';

/**
 * Chỉ cho Admin vào — §3.6, PHẦN GIAO DIỆN.
 *
 * ĐÂY KHÔNG PHẢI LÀ BẢO MẬT. Ẩn menu và chặn route ở trình duyệt chỉ giúp
 * người dùng khỏi lạc vào trang không dùng được; ai cũng sửa được biến trong
 * bộ nhớ trình duyệt hoặc gọi thẳng API bằng curl.
 *
 * Thực thi thật nằm ở backend, và ĐÃ được nối: router `/api/admin` gắn ba lớp
 * `authenticate` -> `requireRole('admin')` -> `requireFreshAdmin`. Lớp cuối đọc
 * lại vai trò từ database mỗi request, vì claim trong token có thể đã cũ tới 7
 * ngày (JWT_EXPIRES_IN). Bộ test tích hợp chạy theo bảng route, nên endpoint
 * thêm mới mà quên guard sẽ tự động làm đỏ CI.
 *
 * Đặt SAU `ProtectedRoute` trong cây route nên tới đây chắc chắn đã có `user`.
 */
export function AdminRoute(): React.ReactElement {
  // Hỏi trục NỀN TẢNG (`users.role`), KHÔNG phải `memberships.role`.
  //
  // Khu này là công cụ vận hành hệ thống, chỉ dành cho tài khoản `superadmin`
  // sinh bằng `npm run seed:admin`. Bản trước hỏi `role === 'admin'` — vai trò
  // trong tổ chức — nên ai đăng ký cũng lọt vào, vì luồng đăng ký cấp `admin`
  // cho người tự lập tổ chức của mình.
  //
  // Người dùng đăng ký bình thường sẽ có khu vực riêng — chưa xây.
  const { user } = useAuth();

  if (user?.platformRole !== 'superadmin') return <Navigate to="/403" replace />;

  return <Outlet />;
}
