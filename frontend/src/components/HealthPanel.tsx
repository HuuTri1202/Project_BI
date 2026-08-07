import { useEffect, useState } from 'react';

type Health = {
  status: string;
  service: string;
  env: string;
  uptimeSeconds: number;
  timestamp: string;
};

type State =
  | { kind: 'loading' }
  | { kind: 'ok'; data: Health }
  | { kind: 'error'; message: string };

/** Bảng trạng thái kết nối backend — nội dung cũ của App.tsx, tách ra để App
 *  chỉ còn lo việc định tuyến. */
export function HealthPanel() {
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
        setState({ kind: 'error', message: err instanceof Error ? err.message : 'Unknown error' });
      });

    return () => controller.abort();
  }, []);

  if (state.kind === 'loading') {
    return <p className="text-sm text-slate-500">Đang kiểm tra…</p>;
  }

  if (state.kind === 'error') {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">
        Không kết nối được backend: {state.message}
        <br />
        <span className="text-red-600/80">Kiểm tra backend đang chạy ở http://localhost:4000</span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
      <span className="inline-flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-emerald-500" />
        <span className="font-medium text-slate-900">{state.data.status}</span>
      </span>
      <span className="text-slate-500">
        môi trường <span className="font-mono text-slate-700">{state.data.env}</span>
      </span>
      <span className="text-slate-500">
        uptime <span className="font-mono text-slate-700">{state.data.uptimeSeconds}s</span>
      </span>
    </div>
  );
}
