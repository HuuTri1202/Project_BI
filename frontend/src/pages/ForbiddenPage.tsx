import { Link } from 'react-router-dom';

/** 403 — vào đúng đường dẫn nhưng không đủ quyền (§3.6). */
export default function ForbiddenPage(): React.ReactElement {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <p className="text-6xl font-bold text-slate-200">403</p>
      <h1 className="mt-4 text-xl font-semibold text-slate-900">Không có quyền truy cập</h1>
      <p className="mt-2 max-w-sm text-sm text-slate-500">
        Trang này chỉ dành cho quản trị viên hệ thống. Tài khoản đăng ký thông thường không truy
        cập được, kể cả khi bạn là quản trị viên của một tổ chức.
      </p>
      <Link
        to="/"
        className="mt-7 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
      >
        Về trang chủ
      </Link>
    </main>
  );
}
