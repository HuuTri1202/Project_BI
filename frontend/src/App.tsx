import { Navigate, Route, Routes } from 'react-router-dom';
import { RegisterPage } from './features/auth/RegisterPage';
import { AdminLayout } from './layouts/AdminLayout';
import { UserLayout } from './layouts/UserLayout';
import ChangePasswordPage from './pages/ChangePasswordPage';
import ForbiddenPage from './pages/ForbiddenPage';
import HealthPage from './pages/HealthPage';
import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';
import NotFoundPage from './pages/NotFoundPage';
import ProfilePage from './pages/ProfilePage';
import ReportPage from './pages/ReportPage';
import OverviewPage from './pages/admin/OverviewPage';
import TenantsPage from './pages/admin/TenantsPage';
import UsersPage from './pages/admin/UsersPage';
import WorkspacesPage from './pages/admin/WorkspacesPage';
import ConnectionFormPage from './pages/tenant/ConnectionFormPage';
import ConnectionsPage from './pages/tenant/ConnectionsPage';
import DatasetDetailPage from './pages/tenant/DatasetDetailPage';
import DatasetsPage from './pages/tenant/DatasetsPage';
import MembersPage from './pages/tenant/MembersPage';
import OrganizationPage from './pages/tenant/OrganizationPage';
import OrganizationProfilePage from './pages/tenant/OrganizationProfilePage';
import TenantWorkspacesPage from './pages/tenant/WorkspacesPage';
import { AdminRoute } from './routes/AdminRoute';
import { ProtectedRoute } from './routes/ProtectedRoute';
import { TenantAdminRoute } from './routes/TenantAdminRoute';
import { WorkspaceProvider } from './workspace/WorkspaceProvider';

/**
 * Bảng route.
 *
 * ─── Hai khu vực, hai trục vai trò ───────────────────────────────────────────
 *
 *   /admin/**   console VẬN HÀNH HỆ THỐNG — `users.role = 'superadmin'`
 *   còn lại     khu NGƯỜI DÙNG            — vào bằng `memberships.role`
 *
 * Người tự đăng ký là `admin` của tổ chức mình nhưng là `user` ở cấp nền tảng,
 * nên họ thấy §4.5/§4.7 trong khu người dùng và KHÔNG vào được `/admin`.
 *
 * Bốn tầng cổng, xếp từ ngoài vào trong — mỗi tầng chỉ lo đúng một việc:
 *   ProtectedRoute    đã đăng nhập chưa? (+ cổng đổi mật khẩu bắt buộc)
 *   AdminRoute        có phải quản trị HỆ THỐNG không?
 *   TenantAdminRoute  có phải quản trị TỔ CHỨC không?
 *   *Layout           khung sidebar + topbar
 *
 * `WorkspaceProvider` bọc TRONG `UserLayout` chứ không bọc cả app: nó gọi
 * `GET /v1/workspaces`, mà request đó cần token và cần tổ chức đang mở. Đặt ở
 * ngoài thì trang đăng nhập cũng bắn request rồi ăn 401.
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
        <Route path="/system-health" element={<HealthPage />} />

        {/* ─── Khu người dùng (Section 04) ─────────────────────────────── */}
        <Route
          element={
            <WorkspaceProvider>
              <UserLayout />
            </WorkspaceProvider>
          }
        >
          {/* `/` là điểm rẽ, không phải trang nội dung: giữ nó là một trang thật
              nghĩa là có hai đường dẫn cùng hiện trang chủ, và mọi link nội bộ
              phải chọn một trong hai. */}
          <Route path="/" element={<Navigate to="/home" replace />} />
          <Route path="/home" element={<HomePage />} />
          <Route path="/profile" element={<ProfilePage />} />

          {/* §7 + §8 — kho dữ liệu và báo cáo.
              KHÔNG bọc `TenantAdminRoute`: mọi vai trò, kể cả viewer, đều có
              `dataset:read` và `report:read` trong ma trận mặc định. Chặn ở
              route sẽ giấu mất thứ họ có quyền xem. Các thao tác GHI vẫn bị
              `authorize()` chặn ở backend, và giao diện ẩn nút tương ứng.

              MỘT trang `/datasets` cho cả hai nguồn. Trước khi gộp có hai khai
              báo cùng đường dẫn này, và react-router chỉ dùng cái đầu — nên bộ
              dữ liệu từ CSDL không có cách nào hiện ra. */}
          <Route path="/datasets" element={<DatasetsPage />} />
          {/* Chi tiết là TRANG chứ không phải hộp thoại: một bảng thật có 40–80
              cột, và cột "Kiểu dữ liệu" bị cắt cụt trong khung 32rem thì trang
              xem schema mất đúng thứ nó sinh ra để hiện. */}
          <Route path="/datasets/:id" element={<DatasetDetailPage />} />
          <Route path="/reports/:id" element={<ReportPage />} />

          {/* ─── Quản lý tổ chức: một trang, ba tab ─────────────────────────
              Tab là ROUTE THẬT chứ không phải state — xem `OrganizationPage`.
              Khung `element` KHÔNG gác quyền: mỗi tab khai đúng ô quyền nó cần,
              cùng ô mà thanh tab dùng để ẩn/hiện, nên tab hiện lên không bao giờ
              dẫn tới 403. Người không có ô nào sẽ đụng cổng của route con và bị
              đẩy sang /403 như trước. */}
          <Route path="/organization" element={<OrganizationPage />}>
            <Route element={<TenantAdminRoute needs="manageTenant" />}>
              <Route index element={<OrganizationProfilePage />} />
            </Route>
            <Route element={<TenantAdminRoute needs="manageConnections" />}>
              <Route path="connections" element={<ConnectionsPage />} />
            </Route>
            <Route element={<TenantAdminRoute needs="manageWorkspaces" />}>
              <Route path="workspaces" element={<TenantWorkspacesPage />} />
            </Route>
            <Route element={<TenantAdminRoute needs="manageMembers" />}>
              <Route path="members" element={<MembersPage />} />
            </Route>
          </Route>

          {/* Wizard kết nối là ANH EM của `/organization`, không phải con: nó
              chiếm trọn khu nội dung thay vì nằm dưới tiêu đề và thanh bốn tab.
              Xem `ConnectionFormPage`. Cùng ô quyền với tab Kết nối, nên không
              có đường nào bấm vào rồi ăn 403. */}
          <Route element={<TenantAdminRoute needs="manageConnections" />}>
            <Route path="/organization/connections/new" element={<ConnectionFormPage />} />
            <Route path="/organization/connections/:id/edit" element={<ConnectionFormPage />} />
          </Route>

          {/* Đường dẫn cũ vẫn sống. Người dùng đã lưu bookmark hoặc dán link cho
              đồng nghiệp trước khi gộp trang; để chúng rơi vào trang 404 là bắt
              họ trả giá cho một thay đổi trong nhà. `replace` để nút Back không
              kẹt trong vòng lặp chuyển hướng. */}
          <Route path="/workspaces" element={<Navigate to="/organization/workspaces" replace />} />
          <Route path="/members" element={<Navigate to="/organization/members" replace />} />
        </Route>

        {/* ─── Console vận hành hệ thống ───────────────────────────────── */}
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
