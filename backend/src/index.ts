import type { Server } from 'node:http';
import { createApp } from './app';
import { closeClickhouse } from './config/clickhouse';
import { env } from './config/env';
import { closeMysql } from './config/mysql';
import { closeRedis } from './config/redis';
import { runMigrations } from './db/migrate';
import { startIngestRunner, stopIngestRunner } from './services/ingest/runner';

let server: Server | undefined;

async function start(): Promise<void> {
  // Chạy migration TRƯỚC khi mở cổng: không có bảng thì mọi request đều lỗi,
  // thà chết lúc boot với thông báo rõ ràng còn hơn phục vụ request rồi 500.
  await runMigrations();

  const app = createApp();
  server = app.listen(env.PORT, () => {
    console.log(`[server] listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
  });

  // Không có listener nào cho 'error' thì Node coi đó là "unhandled error event"
  // và đổ ra hơn hai chục dòng stack trace của node:net — trong đó không dòng
  // nào nói được việc cần làm. Bắt lấy để đổi thành một câu.
  server.on('error', onListenError);

  // Vòng lặp nạp (§9.6) khởi động SAU khi cổng đã mở, và thứ tự đó có chủ ý: nó
  // chạm ClickHouse, mà ClickHouse hoàn toàn có thể chưa chạy trên máy của người
  // đang làm phần giao diện. Đặt trước `listen` thì máy đó không mở nổi cổng
  // 4000 vì một thứ họ không dùng tới. Vòng lặp tự nuốt lỗi kết nối và ghi log.
  startIngestRunner();
}

/**
 * Cổng đã bị chiếm là lỗi VẬN HÀNH, không phải lỗi lập trình.
 *
 * Gần như luôn cùng một nguyên nhân: một tiến trình dev cũ chưa chết hẳn. Trên
 * Windows nó xảy ra thường xuyên vì `npm run dev` dựng cây bốn tầng
 * (concurrently → npm → tsx watch → node) mà `child.kill()` chỉ hạ được tầng
 * trên — xem `scripts/free-ports.mjs`.
 */
function onListenError(err: NodeJS.ErrnoException): void {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `\n[server] Cổng ${env.PORT} đang bị một tiến trình khác chiếm.\n` +
        '         Gần như chắc chắn là một server dev cũ chưa tắt hẳn.\n\n' +
        '         Dọn bằng:  npm run ports:free\n' +
        '         Rồi chạy lại:  npm run dev\n\n' +
        '         (Muốn đổi cổng thì sửa PORT trong backend/.env)\n',
    );
    process.exit(1);
  }

  console.error('[server] không mở được cổng:', err);
  process.exit(1);
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

  // TRƯỚC `closeMysql`, không phải sau: vòng lặp nạp đang giữ connection từ
  // chính pool đó. Xem `stopIngestRunner`.
  await stopIngestRunner();

  const results = await Promise.allSettled([closeMysql(), closeRedis(), closeClickhouse()]);
  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('[server] lỗi khi đóng kết nối:', result.reason);
    }
  }

  process.exit(0);
}

// SIGHUP và SIGBREAK là hai đường thoát mà Windows dùng nhiều hơn hẳn: Node phát
// SIGHUP khi cửa sổ console bị đóng, SIGBREAK khi người dùng bấm Ctrl+Break. Bỏ
// chúng nghĩa là đóng terminal thì tiến trình chết ngang mà không kịp trả cổng —
// đúng cái tình huống sinh ra lỗi EADDRINUSE ở lần chạy sau.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'] as const) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}

start().catch((err: unknown) => {
  console.error('[server] không khởi động được:', err);
  process.exit(1);
});
