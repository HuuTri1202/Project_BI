import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { ROLE_LABELS } from '../types/auth';

/**
 * Trang chủ cho người dùng không phải Admin.
 *
 * Chưa có nội dung nghiệp vụ vì dashboard/biểu đồ thuộc các feature sau (F5–F8).
 * Giữ tối giản và nói thẳng điều đó, thay vì đắp giao diện giả.
 */
export default function HomePage(): React.ReactElement {
  const { user, tenant, role, logout } = useAuth();

  // Quản trị viên HỆ THỐNG đi thẳng vào khu quản trị.
  //
  // Hỏi `user.platformRole`, không phải `role` — `role` là vai trò trong tổ
  // chức, mà ai đăng ký cũng là `admin` của tổ chức mình vừa lập.
  //
  // Trang này hiện KHÔNG có gì cho họ, chỉ một link phải bấm thêm lần nữa.
  //
  // TẠM THỜI: khi khu vực làm việc của người dùng được xây (chưa lên kế hoạch),
  // PHẢI xem lại đoạn này — lúc đó trang chủ mới có nội dung thật.
  if (user?.platformRole === 'superadmin') return <Navigate to="/admin" replace />;

  return (
    <main className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-2xl font-bold text-slate-900">Xin chào, {user?.fullName ?? 'bạn'}</h1>
      <p className="mt-1.5 text-sm text-slate-500">
        {tenant?.name ?? 'Không rõ tổ chức'} · {role ? ROLE_LABELS[role] : ''}
      </p>

      <div className="mt-8 rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="text-sm font-semibold text-slate-900">Khu vực làm việc</h2>
        <p className="mt-2 text-sm text-slate-500">
          Phần dashboard và báo cáo sẽ được bổ sung ở các bước sau. Hiện tại hệ thống mới có đăng
          nhập và trang quản trị.
        </p>
      </div>

      <div className="mt-8 flex items-center gap-5 text-sm">
        {role === 'admin' && (
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
