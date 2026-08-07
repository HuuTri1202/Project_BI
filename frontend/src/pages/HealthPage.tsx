import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

/**
 * Trang kiểm tra kết nối backend (nội dung smoke test cũ của App.tsx).
 *
 * Route là `/system-health`, KHÔNG phải `/health`: vite.config.ts đang proxy
 * `/health` thẳng sang Express, nên gõ localhost:5173/health sẽ nhận JSON của
 * backend chứ không vào được SPA.
 *
 * Gọi bằng `fetch` chứ không qua `apiClient` vì `/health` nằm NGOÀI `/api` và
 * cố ý không cần token — đây là endpoint để biết máy chủ còn sống.
 */
type Health = {
  status: string;
  service: string;
  env: string;
  uptimeSeconds: number;
  timestamp: string;
};

type State =
  { kind: 'loading' } | { kind: 'ok'; data: Health } | { kind: 'error'; message: string };

export default function HealthPage(): React.ReactElement {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    const controller = new AbortController();

    fetch('/health', { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as Health;
      })
      .then((data) => setState({ kind: 'ok', data }))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setState({ kind: 'error', message: err instanceof Error ? err.message : 'Không rõ lỗi' });
      });

    return () => controller.abort();
  }, []);

  return (
    <main className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-2xl font-bold text-slate-900">Trạng thái hệ thống</h1>
      <p className="mt-1.5 text-sm text-slate-500">Kết nối tới backend:</p>

      <div className="mt-6">
        {state.kind === 'loading' && <p className="text-sm text-slate-500">Đang kiểm tra…</p>}

        {state.kind === 'error' && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            Không kết nối được backend: {state.message}
            <br />
            <span className="text-red-500">Kiểm tra backend đang chạy ở http://localhost:4000</span>
          </div>
        )}

        {state.kind === 'ok' && (
          <pre className="overflow-x-auto rounded-lg bg-slate-900 p-4 text-xs leading-relaxed text-slate-100">
            {JSON.stringify(state.data, null, 2)}
          </pre>
        )}
      </div>

      <Link to="/" className="mt-8 inline-block text-sm text-brand-600 hover:text-brand-700">
        ← Về trang chủ
      </Link>
    </main>
  );
}
