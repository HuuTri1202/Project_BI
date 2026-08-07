import { Link } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { ROLE_LABELS } from '../types/auth';

/**
 * Trang chủ cho người dùng không phải Admin.
 *
 * Chưa có nội dung nghiệp vụ vì dashboard/biểu đồ thuộc các feature sau (F5–F8).
 * Giữ tối giản và nói thẳng điều đó, thay vì đắp giao diện giả.
 */
export default function HomePage(): React.ReactElement {
  const { user, tenant, logout } = useAuth();

  return (
    <main className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-2xl font-bold text-slate-900">Xin chào, {user?.fullName ?? 'bạn'}</h1>
      <p className="mt-1.5 text-sm text-slate-500">
        {tenant?.name ?? 'Không rõ tổ chức'} · {user ? ROLE_LABELS[user.role] : ''}
      </p>

      <div className="mt-8 rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="text-sm font-semibold text-slate-900">Khu vực làm việc</h2>
        <p className="mt-2 text-sm text-slate-500">
          Phần dashboard và báo cáo sẽ được bổ sung ở các bước sau. Hiện tại hệ thống mới có đăng
          nhập và trang quản trị.
        </p>
      </div>

      <div className="mt-8 flex items-center gap-5 text-sm">
        {user?.role === 'admin' && (
          <Link to="/admin" className="font-medium text-brand-600 hover:text-brand-700">
            Vào trang quản trị →
          </Link>
        )}
        <Link to="/system-health" className="text-slate-500 hover:text-slate-700">
          Trạng thái hệ thống
        </Link>
        <button
          type="button"
          onClick={() => void logout()}
          className="text-slate-500 transition-colors hover:text-slate-700"
        >
          Đăng xuất
        </button>
      </div>
    </main>
  );
}
