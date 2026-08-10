import { Route, Routes } from 'react-router-dom';
import { RegisterPage } from './features/auth/RegisterPage';
import { AdminLayout } from './layouts/AdminLayout';
import ChangePasswordPage from './pages/ChangePasswordPage';
import ForbiddenPage from './pages/ForbiddenPage';
import HealthPage from './pages/HealthPage';
import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';
import NotFoundPage from './pages/NotFoundPage';
import OverviewPage from './pages/admin/OverviewPage';
import TenantsPage from './pages/admin/TenantsPage';
import UsersPage from './pages/admin/UsersPage';
import WorkspacesPage from './pages/admin/WorkspacesPage';
import { AdminRoute } from './routes/AdminRoute';
import { ProtectedRoute } from './routes/ProtectedRoute';

/**
 * Bảng route.
 *
 * Ba tầng cổng, xếp từ ngoài vào trong — mỗi tầng chỉ lo đúng một việc:
 *   ProtectedRoute  đã đăng nhập chưa? (+ cổng đổi mật khẩu bắt buộc)
 *   AdminRoute      có phải Admin không?
 *   AdminLayout     khung sidebar + topbar
 *
 * Trang kiểm tra kết nối nằm ở `/system-health`, KHÔNG phải `/health`:
 * vite.config.ts proxy `/health` thẳng sang Express nên đường dẫn đó không bao
 * giờ tới được SPA.
 */
export default function App(): React.ReactElement {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      {/* Đăng ký cố ý KHÔNG tự đăng nhập: xong thì điều hướng sang /login kèm
          state để trang đó chào đúng người và điền sẵn email (§1.5). */}
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/403" element={<ForbiddenPage />} />

      {/* Đã đăng nhập, nhưng ĐƯỢC PHÉP ở lại khi còn cờ mustChangePassword */}
      <Route element={<ProtectedRoute allowWhenMustChangePassword />}>
        <Route path="/change-password" element={<ChangePasswordPage />} />
      </Route>

      {/* Đã đăng nhập và mật khẩu tạm đã được thay */}
      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/system-health" element={<HealthPage />} />

        <Route element={<AdminRoute />}>
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<OverviewPage />} />
            <Route path="tenants" element={<TenantsPage />} />
            <Route path="users" element={<UsersPage />} />
            <Route path="workspaces" element={<WorkspacesPage />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
