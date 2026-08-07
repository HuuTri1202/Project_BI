import type { Server } from 'node:http';
import { createApp } from './app';
import { env } from './config/env';
import { closeMysql } from './config/mysql';
import { closeRedis } from './config/redis';
import { runMigrations } from './db/migrate';

let server: Server | undefined;

async function start(): Promise<void> {
  // Chạy migration TRƯỚC khi mở cổng: không có bảng thì mọi request đều lỗi,
  // thà chết lúc boot với thông báo rõ ràng còn hơn phục vụ request rồi 500.
  await runMigrations();

  const app = createApp();
  server = app.listen(env.PORT, () => {
    console.log(`[server] listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
  });
}

// --- Graceful shutdown ---
// Ngừng nhận kết nối mới, đóng kết nối MySQL/Redis, rồi mới thoát. Quan trọng
// khi lên Kubernetes: pod bị SIGTERM lúc rolling update, thoát ẩu sẽ cắt ngang
// request đang xử lý.
let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`[server] ${signal} received, shutting down...`);

  server?.close(() => {
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

start().catch((err: unknown) => {
  console.error('[server] không khởi động được:', err);
  process.exit(1);
});
