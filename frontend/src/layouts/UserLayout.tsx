import type { PermissionFlag } from '../auth/usePermissions';
import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { usePermissions } from '../auth/usePermissions';
import { useAuth } from '../auth/useAuth';
import { TenantSwitcher } from '../features/tenant/TenantSwitcher';
import { WorkspaceSwitcher } from '../features/tenant/WorkspaceSwitcher';
import { ROLE_LABELS } from '../types/auth';
import { useWorkspace } from '../workspace/useWorkspace';

/**
 * Khung khu người dùng — §4.1: sidebar + topbar + bộ chuyển workspace.
 *
 * ─── §5.8, §6.8 Ẩn/hiện theo vai trò ─────────────────────────────────────────
 *
 * `needs` trỏ tới một ô trong ma trận quyền, và ma trận đó do backend tính bằng
 * Casbin rồi trả về qua `GET /v1/permissions`. Mục nào không có `needs` thì mọi
 * vai trò đều thấy.
 *
 * `TenantAdminRoute` của route tương ứng đọc CÙNG một ô, nên không thể có
 * chuyện menu hiện lên rồi dẫn thẳng tới trang 403.
 *
 * ĐÂY KHÔNG PHẢI LÀ BẢO MẬT. Ẩn menu chỉ giúp người dùng khỏi lạc vào trang họ
 * không dùng được; ai cũng sửa được biến trong bộ nhớ trình duyệt hoặc gọi thẳng
 * API bằng curl. Thực thi thật nằm ở backend: router `/api/v1` gắn
 * `authenticate` -> `requireFreshMembership` -> `authorize(tài nguyên, hành động)`.
 * Lớp giữa đọc lại vai trò TỪ DATABASE mỗi request, vì claim trong token có thể
 * đã cũ tới 7 ngày (JWT_EXPIRES_IN).
 */
interface NavItem {
  label: string;
  to: string;
  exact?: boolean;
  /**
   * Ô quyền quyết định mục này hiện hay không. Mục hiện khi có ÍT NHẤT MỘT ô
   * đúng — "Quản lý tổ chức" gom ba tab với ba quyền khác nhau, và giấu cả mục
   * chỉ vì thiếu một trong ba là chặn người ta khỏi hai tab họ có quyền dùng.
   */
  needs?: PermissionFlag[];
  icon: string;
}

const NAV_ITEMS: NavItem[] = [
  {
    label: 'Trang chủ',
    to: '/home',
    exact: true,
    icon: 'M3 11.5 12 4l9 7.5M5.5 10V20h13V10',
  },
  {
    label: 'Hồ sơ cá nhân',
    to: '/profile',
    icon: 'M16 20v-2a4 4 0 0 0-8 0v2M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  },
  /*
   * Ba mục cũ — Workspace, Thành viên và (chưa từng có) thông tin tổ chức — gom
   * thành MỘT. Chúng cùng trả lời câu hỏi "tổ chức này được cấu hình thế nào",
   * nên tách ra thành nhiều dòng sidebar chỉ bắt người quản trị phải nhớ mỗi thứ
   * nằm ở đâu. Điều hướng giữa chúng giờ là thanh tab bên trong trang.
   */
  {
    label: 'Quản lý tổ chức',
    to: '/organization',
    needs: ['manageTenant', 'manageWorkspaces', 'manageMembers'],
    icon: 'M4 21V7l6-3 6 3v14M4 21h16M10 21v-4h4v4M8 11h.01M12 11h.01M8 15h.01M12 15h.01',
  },
];

function NavIcon({ path }: { path: string }): React.ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5 shrink-0"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

function SidebarContent({ items }: { items: NavItem[] }): React.ReactElement {
  return (
    <>
      <div className="flex h-16 items-center px-6">
        <span className="text-lg font-bold text-white">BI Platform</span>
      </div>

      {/* §5.1 — hai bộ chuyển đặt trên sidebar, ngay dưới tên sản phẩm.
          Thứ tự tổ chức trước, workspace sau là thứ tự bao hàm thật của dữ liệu
          (tenant -> workspace -> project); đảo lại sẽ khiến người dùng đổi
          workspace rồi mới nhận ra mình đang ở sai tổ chức. */}
      <div className="border-y border-slate-800 py-2">
        <TenantSwitcher />
        <WorkspaceSwitcher />
      </div>

      <nav className="space-y-1 px-3 py-3">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            // `end` cho mục có đường dẫn là tiền tố của mục khác. Các mục con
            // KHÔNG được `end`, để sau này có `/projects/:id` thì mục cha vẫn sáng.
            end={item.exact === true}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-brand-600 text-white'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`
            }
          >
            <NavIcon path={item.icon} />
            {item.label}
          </NavLink>
        ))}
      </nav>
    </>
  );
}

export function UserLayout(): React.ReactElement {
  const { user, tenant, role, logout } = useAuth();
  const permissions = usePermissions();
  const { current } = useWorkspace();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Đổi trang thì đóng lớp phủ. Thiếu cái này, người dùng trên điện thoại bấm
  // vào một mục rồi phải tự tay đóng sidebar mới thấy nội dung.
  useEffect(() => setMobileOpen(false), [location.pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  // §5.8 — lọc mục sidebar theo bảng quyền, không so sánh chuỗi vai trò tại chỗ.
  const items = NAV_ITEMS.filter(
    (item) => item.needs === undefined || item.needs.some((flag) => permissions[flag]),
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col bg-slate-900 md:flex">
        <SidebarContent items={items} />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="Đóng menu"
            onClick={() => setMobileOpen(false)}
            className="absolute inset-0 bg-slate-900/60"
          />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-slate-900">
            <SidebarContent items={items} />
          </aside>
        </div>
      )}

      <div className="md:pl-64">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-slate-200 bg-white px-4 sm:px-6">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Mở menu"
            aria-expanded={mobileOpen}
            className="-ml-1 rounded-lg p-2 text-slate-600 hover:bg-slate-100 md:hidden"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              className="h-5 w-5"
              aria-hidden="true"
            >
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>

          {/* Hai bộ chuyển đã dời xuống sidebar (§5.1). Topbar giữ lại phần
              HIỂN THỊ ngữ cảnh đang mở, vì trên màn hẹp sidebar bị ẩn sau nút
              hamburger — không có dòng này thì người dùng điện thoại không có
              cách nào biết mình đang ở tổ chức nào. */}
          <div className="min-w-0 md:hidden">
            <p className="truncate text-sm font-semibold text-slate-900">{tenant?.name}</p>
            <p className="truncate text-xs text-slate-500">{current?.name ?? 'Chưa có workspace'}</p>
          </div>

          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="truncate text-sm font-medium text-slate-900">{user?.fullName}</p>
              <p className="truncate text-xs text-slate-500">
                {tenant?.name} · {role ? ROLE_LABELS[role] : ''}
              </p>
            </div>
            <Link
              to="/profile"
              aria-label="Hồ sơ cá nhân"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-200"
            >
              {user?.fullName?.trim().charAt(0).toUpperCase() ?? '?'}
            </Link>
            <button
              type="button"
              onClick={() => void logout()}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100"
            >
              Đăng xuất
            </button>
          </div>
        </header>

        <main className="px-4 py-8 sm:px-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
