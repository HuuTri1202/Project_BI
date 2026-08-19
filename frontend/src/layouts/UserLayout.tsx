import type { PermissionFlag } from '../auth/usePermissions';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { usePermissions } from '../auth/usePermissions';
import { AccountMenu } from '../components/ui/AccountMenu';
import { useAuth } from '../auth/useAuth';
import { TenantSwitcher } from '../features/tenant/TenantSwitcher';
import { WorkspaceSwitcher } from '../features/tenant/WorkspaceSwitcher';
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
  /*
   * §7.8 + §8.5 — MỘT mục cho cả hai nguồn dữ liệu.
   *
   * Trước khi gộp có hai dòng cùng trỏ về `/datasets`: "Bộ dữ liệu" (file tải
   * lên) và "Kho dữ liệu" (bảng đồng bộ từ CSDL). Với người dùng thì cả hai đều
   * là "thứ tôi dựng báo cáo lên được", nên tách ra chỉ bắt họ đoán xem dữ liệu
   * mình cần nằm ở dòng nào.
   *
   * Không có `needs`: mọi vai trò kể cả viewer đều có `dataset:read` trong ma
   * trận mặc định, nên giấu mục này là chặn họ khỏi thứ họ có quyền xem. Những
   * nút bên trong trang mới là thứ hỏi quyền.
   */
  {
    label: 'Kho dữ liệu',
    to: '/datasets',
    icon: 'M4 7c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3Zm0 0v10c0 1.7 3.6 3 8 3s8-1.3 8-3V7M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  },
  /*
   * §10 — tầng ngữ nghĩa dựng TRÊN kho dữ liệu, nên nằm ngay dưới nó.
   *
   * Cũng không có `needs`: mọi vai trò đều có `datamodel:read`, và giấu mục này
   * là chặn viewer khỏi thứ họ có quyền xem. Cùng lý do với "Kho dữ liệu".
   */
  {
    label: 'Mô hình dữ liệu',
    to: '/datamodels',
    icon: 'M4 5h6v5H4V5Zm10 9h6v5h-6v-5ZM7 10v3a1 1 0 0 0 1 1h6',
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
    needs: ['manageTenant', 'manageConnections', 'manageWorkspaces', 'manageMembers'],
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

function SidebarContent({
  items,
  onNavigate,
}: {
  items: NavItem[];
  onNavigate?: () => void;
}): React.ReactElement {
  return (
    <>
      <div className="flex h-16 shrink-0 items-center px-6">
        <span className="text-lg font-bold text-white">BI Platform</span>
      </div>

      {/* §5.1 — hai bộ chuyển đặt trên sidebar, ngay dưới tên sản phẩm.
          Thứ tự tổ chức trước, workspace sau là thứ tự bao hàm thật của dữ liệu
          (tenant -> workspace); đảo lại sẽ khiến người dùng đổi
          workspace rồi mới nhận ra mình đang ở sai tổ chức. */}
      <div className="shrink-0 border-y border-slate-800 py-2">
        <TenantSwitcher />
        <WorkspaceSwitcher />
      </div>

      {/* CHỈ khu menu cuộn, không phải cả sidebar. Cho cả sidebar cuộn thì khối
          tài khoản ở chân cũng trôi đi mất khi danh sách mục dài ra. */}
      <nav className="scrollbar-dark min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-3">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            // `end` cho mục có đường dẫn là tiền tố của mục khác. Các mục con
            // KHÔNG được `end`, để trang con của mục này vẫn làm mục cha sáng.
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

      {/* Khối tài khoản ở CHÂN sidebar.
          Trước đây nó nằm trên thanh ngang chiếm trọn 64px chiều cao của mọi
          trang — để hiện một cái tên và một nút bấm mỗi phiên một lần. Dời xuống
          đây thì bảng dữ liệu nhận thêm đúng 64px đó, và tài khoản về đúng chỗ
          quen thuộc: góc dưới cùng bên trái. */}
      <div className="shrink-0 border-t border-slate-800 p-3">
        <AccountMenu onNavigate={onNavigate} />
      </div>

    </>
  );
}

export function UserLayout(): React.ReactElement {
  // Chỉ còn `tenant`: tên người dùng, vai trò và nút đăng xuất đã chuyển hẳn
  // xuống chân sidebar, nên `SidebarContent` tự gọi `useAuth()` lấy chúng.
  const { tenant } = useAuth();
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
    // `h-screen overflow-hidden` chứ không `min-h-screen`: vỏ ngoài đứng yên,
    // phần dài cuộn TRONG hộp của nó (xem `components/ui/Page.tsx`). Đây là mắt
    // xích đầu của chuỗi chiều cao — đứt ở đây thì mọi `h-full` bên dưới vô nghĩa.
    <div className="h-screen overflow-hidden bg-slate-50">
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
            <SidebarContent items={items} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex h-full flex-col md:pl-64">
        {/* Thanh ngang chỉ còn ở màn HẸP. Từ `md` trở lên sidebar hiện sẵn và đã
            mang cả ngữ cảnh lẫn tài khoản, nên một thanh ngang trống rỗng chỉ
            ăn mất 64px chiều cao của mọi trang. Dưới `md` thì sidebar nằm sau
            nút menu, nên vẫn cần chỗ đặt nút đó và tên tổ chức đang mở. */}
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
            <p className="truncate text-sm font-semibold text-slate-900">{tenant?.name}</p>
            <p className="truncate text-xs text-slate-500">{current?.name ?? 'Chưa có workspace'}</p>
          </div>
        </header>

        {/* `min-h-0` bắt buộc: thiếu nó thì flex item không chịu co nhỏ hơn nội
            dung, `h-full` của trang nở ra bằng nội dung và cửa sổ cuộn lại. */}
        <main className="min-h-0 flex-1 px-4 py-5 sm:px-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
