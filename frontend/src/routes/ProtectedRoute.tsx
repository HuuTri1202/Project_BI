import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { FullPageLoader } from '../components/FullPageLoader';
import { NguCanhProvider } from '../features/chat/NguCanhProvider';

/**
 * Chặn route chưa đăng nhập — §2.6.
 *
 * `allowWhenMustChangePassword` chỉ bật cho đúng trang `/change-password`.
 * Mọi trang khác đều bị kéo về đó cho tới khi mật khẩu tạm được thay — nếu
 * chỉ chặn ở lúc điều hướng sau đăng nhập thì gõ tay URL là đi vòng qua được.
 */
export function ProtectedRoute({
  allowWhenMustChangePassword = false,
}: {
  allowWhenMustChangePassword?: boolean;
}): React.ReactElement {
  const { status, user } = useAuth();
  const location = useLocation();

  // Đang hỏi `GET /me` -> CHỜ, tuyệt đối không kết luận là chưa đăng nhập.
  // Bỏ nhánh này thì mỗi lần F5 trang đăng nhập sẽ nháy lên một cái rồi biến
  // mất — lỗi kinh điển của bước này.
  if (status === 'loading') return <FullPageLoader label="Đang khôi phục phiên…" />;

  if (status === 'anonymous' || !user) {
    // Ghi lại trang đang định vào để đăng nhập xong quay lại đúng chỗ.
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }

  if (user.mustChangePassword && !allowWhenMustChangePassword) {
    return <Navigate to="/change-password" replace />;
  }

  /*
   * `NguCanhProvider` bọc ở ĐÂY, không bọc trong `UserLayout`.
   *
   * Nó dựng khung hỏi đáp, và khung đó phải có mặt trên mọi trang đã đăng
   * nhập — kể cả trang báo cáo, vốn CỐ Ý nằm ngoài `UserLayout` (xem khối chú
   * thích ở `App.tsx`). Bọc trong `UserLayout` là bỏ sót đúng cái trang có
   * nhiều số liệu nhất để hỏi; bọc hai chỗ là hai chỗ để quên khi thêm route.
   *
   * Chỗ này cũng là định nghĩa đúng của phạm vi: khung chỉ đọc dữ liệu trang đã
   * tải được, nên nó không có nghĩa gì trước khi biết người dùng là ai.
   */
  return (
    <NguCanhProvider>
      <Outlet />
    </NguCanhProvider>
  );
}
