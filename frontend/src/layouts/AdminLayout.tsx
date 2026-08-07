import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { ROLE_LABELS } from '../types/auth';

/**
 * Khung trang quản trị — §3.1: sidebar + topbar.
 *
 * `to: null` nghĩa là trang chưa tồn tại (làm ở Giai đoạn 4). Hiện dạng vô hiệu
 * kèm nhãn "sắp có" thay vì link chết dẫn tới 404 — người dùng thấy được lộ
 * trình mà không bị lừa bấm vào chỗ trống.
 */
const NAV_ITEMS: { label: string; to: string | null; icon: string }[] = [
  { label: 'Tổng quan', to: '/admin', icon: 'M3 12h7V3H3v9Zm11 9h7V3h-7v18ZM3 21h7v-6H3v6Z' },
  {
    label: 'Người dùng',
    to: null,
    icon: 'M16 20v-2a4 4 0 0 0-8 0v2M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  },
  { label: 'Workspace', to: null, icon: 'M3 7h18v12H3V7Zm0 0 3-3h5l2 3' },
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

function SidebarContent(): React.ReactElement {
  return (
    <>
      <div className="flex h-16 items-center px-6">
        <span className="text-lg font-bold text-white">BI Platform</span>
      </div>

      <nav className="space-y-1 px-3 py-2">
        {NAV_ITEMS.map((item) =>
          item.to ? (
            <NavLink
              key={item.label}
              to={item.to}
              end
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
          ) : (
            <span
              key={item.label}
              aria-disabled="true"
              className="flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-500"
            >
              <NavIcon path={item.icon} />
              {item.label}
              <span className="ml-auto rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-slate-400 uppercase">
                sắp có
              </span>
            </span>
          ),
        )}
      </nav>
    </>
  );
}

export function AdminLayout(): React.ReactElement {
  const { user, tenant, role, logout } = useAuth();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Đổi trang thì đóng lớp phủ. Thiếu cái này, người dùng trên điện thoại bấm
  // vào một mục rồi phải tự tay đóng sidebar mới thấy nội dung.
  useEffect(() => setMobileOpen(false), [location.pathname]);

  // Escape đóng lớp phủ — thói quen chuẩn của mọi hộp thoại.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Sidebar cố định — chỉ hiện từ breakpoint md trở lên */}
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col bg-slate-900 md:flex">
        <SidebarContent />
      </aside>

      {/* Lớp phủ cho màn hẹp */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="Đóng menu"
            onClick={() => setMobileOpen(false)}
            className="absolute inset-0 bg-slate-900/60"
          />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-slate-900">
            <SidebarContent />
          </aside>
        </div>
      )}

      <div className="md:pl-64">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-slate-200 bg-white px-4 sm:px-6">
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

          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">
              {tenant?.name ?? 'Không rõ tổ chức'}
            </p>
            <p className="truncate text-xs text-slate-500">Trang quản trị</p>
          </div>

          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="truncate text-sm font-medium text-slate-900">{user?.fullName}</p>
              <p className="truncate text-xs text-slate-500">{role ? ROLE_LABELS[role] : ''}</p>
            </div>
            <span
              aria-hidden="true"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700"
            >
              {user?.fullName?.trim().charAt(0).toUpperCase() ?? '?'}
            </span>
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
