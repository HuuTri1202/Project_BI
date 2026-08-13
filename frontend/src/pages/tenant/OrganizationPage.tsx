import { NavLink, Outlet } from 'react-router-dom';
import { usePermissions, type PermissionFlag } from '../../auth/usePermissions';
import { useAuth } from '../../auth/useAuth';

/**
 * Khung "Quản lý tổ chức" — một trang, nhiều tab.
 *
 * Gộp ba việc trước đây nằm rải rác: thông tin tổ chức (mới), Workspace (§4.5)
 * và Thành viên (§4.7). Chúng cùng trả lời một câu hỏi — "tổ chức này được cấu
 * hình thế nào" — nên nằm cạnh nhau thì người quản trị không phải nhớ mỗi thứ
 * nằm ở mục nào trên sidebar.
 *
 * ─── Vì sao TAB LÀ ROUTE THẬT, không phải state ─────────────────────────────
 *
 * Đây là quyết định có hậu quả, không phải chuyện phong cách. Cả hai tab
 * Workspace và Thành viên đều dùng `useListQueryState`, tức là bộ lọc, trang và
 * cột sắp xếp của chúng sống trong QUERY STRING. Nếu tab chỉ là `useState` thì:
 *
 *   - hai tab dùng chung một query string và ghi đè tham số của nhau;
 *   - F5 hoặc gửi link cho người khác thì rơi về tab đầu, mất hết bộ lọc;
 *   - nút Back của trình duyệt nhảy ra khỏi trang thay vì về tab trước.
 *
 * Mỗi tab một `pathname` riêng thì cả ba vấn đề đó không tồn tại.
 *
 * ─── Quyền ──────────────────────────────────────────────────────────────────
 *
 * Mỗi tab đọc ĐÚNG ô quyền mà route của nó được gác bằng (xem `App.tsx`), nên
 * không thể có chuyện tab hiện lên rồi bấm vào ra trang 403. Tab nào không có
 * quyền thì biến mất khỏi thanh, chứ không hiện ra rồi báo lỗi.
 */
interface TabDef {
  to: string;
  label: string;
  needs: PermissionFlag;
  /** Tab mặc định trùng tiền tố với các tab khác nên phải so khớp chính xác. */
  end?: boolean;
}

const TABS: TabDef[] = [
  { to: '/organization', label: 'Tổ chức', needs: 'manageTenant', end: true },
  { to: '/organization/connections', label: 'Kết nối', needs: 'manageConnections' },
  { to: '/organization/workspaces', label: 'Workspace', needs: 'manageWorkspaces' },
  { to: '/organization/members', label: 'Thành viên', needs: 'manageMembers' },
];

export default function OrganizationPage(): React.ReactElement {
  const permissions = usePermissions();
  const { tenant } = useAuth();

  const tabs = TABS.filter((tab) => permissions[tab.needs]);

  return (
    <div className="mx-auto max-w-6xl">
      <header>
        <h1 className="text-xl font-bold text-slate-900">Quản lý tổ chức</h1>
        <p className="mt-1 text-sm text-slate-500">
          Thông tin, kết nối, workspace, thành viên và quyền của{' '}
          <strong className="font-semibold text-slate-700">{tenant?.name}</strong>.
        </p>
      </header>

      {/* `border-b` chạy hết chiều ngang còn tab active đè lên bằng viền riêng —
          đường kẻ liền mạch là thứ khiến thanh tab đọc ra là "cùng một trang,
          nhiều mặt" thay vì ba nút rời nhau. */}
      <nav className="mt-5 flex gap-1 border-b border-slate-200" aria-label="Mục quản lý">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end === true}
            className={({ isActive }) =>
              `-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'border-brand-600 text-brand-700'
                  : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800'
              }`
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>

      <div className="mt-6">
        <Outlet />
      </div>
    </div>
  );
}
