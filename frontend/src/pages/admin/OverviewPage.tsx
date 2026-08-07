import { useAuth } from '../../auth/useAuth';

/**
 * Trang Tổng quan — §3.2, mới có KHUNG.
 *
 * Các ô số cố ý để dấu gạch ngang chứ không bịa số giả: `GET /api/admin/overview`
 * làm ở Giai đoạn 3. Số giả trong bản demo là cách nhanh nhất để tự lừa mình
 * rằng tính năng đã xong.
 */
const KPI_CARDS = [
  { label: 'Tổng người dùng', hint: 'trong tổ chức' },
  { label: 'Quản trị viên', hint: 'vai trò admin' },
  { label: 'Tài khoản bị khoá', hint: 'đang vô hiệu' },
  { label: 'Workspace', hint: 'đang hoạt động' },
];

export default function OverviewPage(): React.ReactElement {
  const { user, tenant } = useAuth();

  return (
    <div className="mx-auto max-w-6xl">
      <header>
        <h1 className="text-xl font-bold text-slate-900">Tổng quan</h1>
        <p className="mt-1 text-sm text-slate-500">
          {tenant?.name ?? 'Không rõ tổ chức'} · đăng nhập bởi {user?.email}
        </p>
      </header>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {KPI_CARDS.map((card) => (
          <div key={card.label} className="rounded-xl border border-slate-200 bg-white p-5">
            <p className="text-sm font-medium text-slate-600">{card.label}</p>
            <p className="mt-2 text-3xl font-bold text-slate-300">—</p>
            <p className="mt-1 text-xs text-slate-400">{card.hint}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-xl border border-dashed border-slate-300 bg-white px-5 py-6">
        <h2 className="text-sm font-semibold text-slate-900">Chưa có số liệu</h2>
        <p className="mt-1.5 text-sm text-slate-500">
          Các ô trên sẽ hiện số thật khi endpoint{' '}
          <code className="text-slate-700">GET /api/admin/overview</code> hoàn thành ở Giai đoạn 3.
          Quản lý người dùng và workspace nằm ở Giai đoạn 4.
        </p>
      </div>
    </div>
  );
}
