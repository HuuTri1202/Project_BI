import { useEffect, useState } from 'react';

type Health = {
  status: string;
  service: string;
  env: string;
  uptimeSeconds: number;
  timestamp: string;
};

type State =
  { kind: 'loading' } | { kind: 'ok'; data: Health } | { kind: 'error'; message: string };

export default function App() {
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

  return (
    <main
      style={{
        fontFamily: 'system-ui, sans-serif',
        maxWidth: 640,
        margin: '4rem auto',
        padding: '0 1rem',
      }}
    >
      <h1>BI Platform</h1>
      <p>Frontend đã chạy. Trạng thái kết nối tới backend:</p>

      {state.kind === 'loading' && <p>Đang kiểm tra…</p>}

      {state.kind === 'error' && (
        <p style={{ color: '#b00020' }}>
          Không kết nối được backend: {state.message}
          <br />
          <small>Kiểm tra backend đang chạy ở http://localhost:4000</small>
        </p>
      )}

      {state.kind === 'ok' && (
        <pre style={{ background: '#f4f4f5', padding: '1rem', borderRadius: 8, overflowX: 'auto' }}>
          {JSON.stringify(state.data, null, 2)}
        </pre>
      )}
    </main>
  );
}
