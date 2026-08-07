import type { MeDto } from '@bi/shared';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { HealthPanel } from '../components/HealthPanel';
import { ApiError, authApi } from '../features/auth/authApi';

type Session = { kind: 'loading' } | { kind: 'anonymous' } | { kind: 'signed-in'; me: MeDto };

/**
 * Trang chủ tạm thời. Nó gọi `GET /auth/me` để khôi phục phiên — đây mới là chỗ
 * thực sự thoả yêu cầu "load Tenant + Workspace khi đăng nhập", vì nó chạy ở
 * MỌI lần tải trang chứ không chỉ ngay sau khi bấm nút đăng nhập.
 */
export function HomePage() {
  const [session, setSession] = useState<Session>({ kind: 'loading' });

  useEffect(() => {
    authApi
      .me()
      .then((me) => setSession({ kind: 'signed-in', me }))
      .catch((err: unknown) => {
        // 401 là trạng thái bình thường của khách chưa đăng nhập, không phải lỗi.
        if (err instanceof ApiError && err.status === 401) {
          setSession({ kind: 'anonymous' });
          return;
        }
        setSession({ kind: 'anonymous' });
      });
  }, []);

  const onLogout = () => {
    void authApi.logout().then(() => setSession({ kind: 'anonymous' }));
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
              BI
            </span>
            <span className="font-semibold tracking-tight text-slate-900">BI Platform</span>
          </div>

          {session.kind === 'anonymous' && (
            <nav className="flex items-center gap-3 text-sm">
              <Link to="/login" className="font-medium text-slate-600 hover:text-slate-900">
                Đăng nhập
              </Link>
              <Link
                to="/register"
                className="rounded-lg bg-brand-600 px-3.5 py-2 font-semibold text-white hover:bg-brand-700"
              >
                Đăng ký
              </Link>
            </nav>
          )}

          {session.kind === 'signed-in' && (
            <button
              type="button"
              onClick={onLogout}
              className="rounded-lg border border-slate-300 px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Đăng xuất
            </button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-6 px-4 py-8">
        {session.kind === 'loading' && <p className="text-slate-500">Đang tải phiên…</p>}

        {session.kind === 'anonymous' && (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              Chưa đăng nhập
            </h1>
            <p className="mx-auto mt-2 max-w-md text-slate-500">
              Tạo tài khoản để hệ thống dựng sẵn tổ chức và không gian làm việc cho bạn.
            </p>
            <Link
              to="/register"
              className="mt-5 inline-block rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700"
            >
              Đăng ký ngay
            </Link>
          </div>
        )}

        {session.kind === 'signed-in' && (
          <section className="rounded-2xl border border-slate-200 bg-white p-6">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-100 text-base font-semibold text-brand-700">
                {session.me.user.fullName.trim().charAt(0).toUpperCase()}
              </span>
              <div>
                <p className="font-semibold text-slate-900">{session.me.user.fullName}</p>
                <p className="text-sm text-slate-500">{session.me.user.email}</p>
              </div>
            </div>

            <dl className="mt-6 grid gap-4 sm:grid-cols-3">
              <Stat label="Tổ chức" value={session.me.tenant.name} />
              <Stat label="Vai trò" value={session.me.role} mono />
              <Stat
                label="Không gian làm việc"
                value={session.me.workspaces.map((w) => w.name).join(', ') || '(chưa có)'}
              />
            </dl>
          </section>
        )}

        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Kết nối backend</h2>
          <HealthPanel />
        </section>
      </main>
    </div>
  );
}

function Stat({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl bg-slate-50 p-4">
      <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</dt>
      <dd
        className={`mt-1 text-sm font-medium text-slate-900 ${mono ? 'font-mono text-brand-700' : ''}`}
      >
        {value}
      </dd>
    </div>
  );
}
