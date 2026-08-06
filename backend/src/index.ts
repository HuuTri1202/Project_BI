import { createApp } from './app';
import { env } from './config/env';
import { closeMysql } from './config/mysql';
import { closeRedis } from './config/redis';

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.log(`[server] listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
});

// --- Graceful shutdown ---
// Ngừng nhận kết nối mới, đóng kết nối MySQL/Redis, rồi mới thoát. Quan trọng
// khi lên Kubernetes: pod bị SIGTERM lúc rolling update, thoát ẩu sẽ cắt ngang
// request đang xử lý.
let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`[server] ${signal} received, shutting down...`);

  server.close(() => {
    console.log('[server] HTTP server closed');
  });

  const results = await Promise.allSettled([closeMysql(), closeRedis()]);
  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('[server] lỗi khi đóng kết nối:', result.reason);
    }
  }

  process.exit(0);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}
