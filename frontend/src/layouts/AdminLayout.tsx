import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { AccountMenu } from '../components/ui/AccountMenu';

/**
 * Khung trang quản trị — §3.1: sidebar + topbar.
 *
 * `to: null` nghĩa là trang chưa tồn tại. Hiện dạng vô hiệu kèm nhãn "sắp có"
 * thay vì link chết dẫn tới 404 — người dùng thấy được lộ trình mà không bị lừa
 * bấm vào chỗ trống. Nhánh đó vẫn giữ lại cho những mục sắp thêm.
 *
 * `end` chỉ đặt cho mục "Tổng quan": đường dẫn của nó (`/admin`) là tiền tố của
 * mọi mục khác, nên thiếu `end` thì nó sáng lên ở cả trang Người dùng lẫn
 * Workspace. Ngược lại, các mục con KHÔNG được `end`, để sau này có
 * `/admin/users/:id` thì mục cha vẫn sáng.
 */
const NAV_ITEMS: { label: string; to: string | null; exact?: boolean; icon: string }[] = [
  {
    label: 'Tổng quan',
    to: '/admin',
    exact: true,
    icon: 'M3 12h7V3H3v9Zm11 9h7V3h-7v18ZM3 21h7v-6H3v6Z',
  },
  {
    label: 'Tổ chức',
    to: '/admin/tenants',
    icon: 'M4 21V7l6-3 6 3v14M4 21h16M10 21v-4h4v4M8 11h.01M12 11h.01M8 15h.01M12 15h.01',
  },
  {
    label: 'Người dùng',
    to: '/admin/users',
    icon: 'M16 20v-2a4 4 0 0 0-8 0v2M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  },
  { label: 'Workspace', to: '/admin/workspaces', icon: 'M3 7h18v12H3V7Zm0 0 3-3h5l2 3' },
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

function SidebarContent({ onNavigate }: { onNavigate?: () => void }): React.ReactElement {
  return (
    <>
      <div className="flex h-16 shrink-0 items-center px-6">
        <span className="text-lg font-bold text-white">BI Platform</span>
        <span className="ml-2 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-slate-400 uppercase">
          quản trị
        </span>
      </div>

      {/* CHỈ khu menu cuộn, không phải cả sidebar — khối tài khoản ở chân phải
          đứng yên. */}
      <nav className="scrollbar-dark min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-2">
        {NAV_ITEMS.map((item) =>
          item.to ? (
            <NavLink
              key={item.label}
              to={item.to}
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

      {/* Tài khoản + đường về khu làm việc, đặt ở CHÂN sidebar thay vì trên thanh
          ngang. Xem ghi chú cùng chỗ trong `UserLayout`. */}
      <div className="shrink-0 border-t border-slate-800 p-3">
        {/* "Khu làm việc" ở NGOÀI menu tài khoản, vì nó là điều hướng chứ không
            phải thao tác tài khoản — và không có nó thì vào khu quản trị xong là
            kẹt: ở đây không có đường nào dẫn ngược ra. */}
        <Link
          to="/home"
          className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
        >
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
            <path d="M19 12H5m0 0 6-6m-6 6 6 6" />
          </svg>
          Khu làm việc
        </Link>

        <div className="mt-1">
          <AccountMenu onNavigate={onNavigate} />
        </div>
      </div>

    </>
  );
}

export function AdminLayout(): React.ReactElement {
  // Chỉ còn `tenant`: phần tài khoản đã chuyển xuống chân sidebar, nơi
  // `SidebarContent` tự gọi `useAuth()`.
  const { tenant } = useAuth();
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
    // `h-screen overflow-hidden`: vỏ ngoài đứng yên, phần dài cuộn trong hộp
    // của nó. Cùng kiến trúc với `UserLayout` — xem `components/ui/Page.tsx`.
    <div className="h-screen overflow-hidden bg-slate-50">
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
            <SidebarContent onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex h-full flex-col md:pl-64">
        {/* Thanh ngang chỉ còn ở màn HẸP — xem ghi chú cùng chỗ trong
            `UserLayout`. */}
        <header className="z-30 flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 md:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Mở menu"
            aria-expanded={mobileOpen}
            className="-ml-1 rounded-lg p-2 text-slate-600 hover:bg-slate-100"
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
        </header>

        <main className="min-h-0 flex-1 px-4 py-5 sm:px-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
