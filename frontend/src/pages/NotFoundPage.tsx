import { Link } from 'react-router-dom';

/** 404 — đường dẫn không tồn tại. */
export default function NotFoundPage(): React.ReactElement {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <p className="text-6xl font-bold text-slate-200">404</p>
      <h1 className="mt-4 text-xl font-semibold text-slate-900">Không tìm thấy trang</h1>
      <p className="mt-2 max-w-sm text-sm text-slate-500">
        Đường dẫn bạn vừa mở không tồn tại hoặc đã bị đổi.
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
