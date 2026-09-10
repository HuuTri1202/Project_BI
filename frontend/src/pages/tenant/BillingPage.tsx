import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';

import { Button } from '../../components/ui/Button';
import { Page, PageBody, PageHeader } from '../../components/ui/Page';
import { useBillingSummary } from '../../features/billing/hooks';

/**
 * Khung trang "Gói dịch vụ & Thanh toán" — §11.
 *
 * ─── Tab là ROUTE THẬT, không phải state ───────────────────────────────────
 *
 * Cùng luật đã ghi ở `OrganizationPage`: tab nào có danh sách dùng
 * `useListQueryState` thì PHẢI là route. Tab Đơn hàng có phân trang và bộ lọc
 * trạng thái, nên nếu tab chỉ là `useState` thì hai tab dùng chung một query
 * string và ghi đè tham số của nhau, F5 rơi về tab đầu và mất bộ lọc, còn nút
 * Back nhảy ra khỏi trang thay vì về tab trước.
 *
 * Khung này KHÔNG gác quyền riêng — cả ba route con cùng cần đúng một ô
 * `manageBilling`, và cổng đã đặt ở `App.tsx`.
 */

const TABS = [
  { to: '/billing', label: 'Tổng quan', end: true },
  { to: '/billing/plans', label: 'Bảng giá' },
  { to: '/billing/orders', label: 'Đơn hàng' },
];

export default function BillingPage(): React.ReactElement {
  const { data } = useBillingSummary();
  const location = useLocation();

  // Nút "Nâng cấp gói" ẩn đi khi đang đứng ở chính trang bảng giá — một nút dẫn
  // tới nơi người dùng đang đứng là một nút không làm gì.
  const dangOBangGia = location.pathname.startsWith('/billing/plans');

  return (
    <Page>
      <PageHeader
        title="Gói dịch vụ & Thanh toán"
        description={
          data === undefined
            ? undefined
            : `Tổ chức đang dùng gói ${data.plan.name}${
                data.subscription === null ? '' : ''
              }.`
        }
        actions={
          dangOBangGia ? undefined : (
            <Link to="/billing/plans">
              <Button variant="primary">Nâng cấp gói</Button>
            </Link>
          )
        }
      >
        <nav className="mt-4 flex gap-1 border-b border-slate-200" aria-label="Mục thanh toán">
          {TABS.map((tab) => (
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
      </PageHeader>

      <PageBody scroll={false}>
        <Outlet />
      </PageBody>
    </Page>
  );
}
