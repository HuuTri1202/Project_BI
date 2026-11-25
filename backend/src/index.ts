/*
 * ⚠️ DÒNG NÀY PHẢI ĐỨNG ĐẦU, TRƯỚC MỌI IMPORT KHÁC.
 *
 * OpenTelemetry vá đè express/mysql2/ioredis ngay lúc chúng được `require`, nên
 * nó phải chạy trước `./app`. Backend biên dịch ra CommonJS nên tsc giữ nguyên
 * thứ tự này. Đổi chỗ nó xuống dưới thì hệ thống vẫn chạy bình thường — chỉ là
 * SigNoz không còn thấy một span nào của Express. Xem `tracing.ts`.
 *
 * eslint-disable-next-line import/order -- thứ tự ở đây là ràng buộc chạy được,
 * không phải sở thích sắp xếp.
 */
import './tracing';

import type { Server } from 'node:http';
import { createApp } from './app';
import { closeClickhouse } from './config/clickhouse';
import { env } from './config/env';
import { watchEnvFile } from './config/envWatch';
import { closeMysql } from './config/mysql';
import { closeRedis } from './config/redis';
import { runMigrations } from './db/migrate';
import { regenerateAllTenants } from './services/datamodel/cubeSchemaService';
import { cheDoMail } from './services/mail/mailer';
import { checkSchemaDir } from './services/datamodel/cubeSchemaStore';
import { startHamNongKhoiDong, stopHamNongKhoiDong } from './services/datamodel/hamNongKhoiDong';
import { startBillingRunner, stopBillingRunner } from './services/billing/runner';
import { startIngestRunner, stopIngestRunner } from './services/ingest/runner';
import { dongQuanTrac } from './tracing';

let server: Server | undefined;

/**
 * Production mà chưa khai SMTP thì KHÔNG mở cổng.
 *
 * ═══ Vì sao đây là lỗi chết người, không phải một tính năng thiếu ═════════
 *
 * Thiếu `SMTP_HOST`, hệ thống vẫn lên xanh: `/health` 200, `/health/ready` báo
 * MySQL và Redis đều OK, giao diện mở bình thường. Nhưng §1.10 chặn đăng nhập
 * cho tới khi email được xác minh, mà thư xác minh thì `mailer.ts` TỪ CHỐI gửi
 * ở production (in vé ra log là phát quyền chiếm tài khoản cho ai đọc log).
 *
 * Kết quả: mọi người đăng ký mới kẹt vĩnh viễn ở `EmailNotVerified`, và quên
 * mật khẩu cũng không có đường về. Một nền tảng chỉ còn đúng tài khoản đã seed
 * dùng được — mà mọi đèn đều xanh, nên không ai biết để đi sửa.
 *
 * `mailer.ts` đã viết "thà hỏng ồn ào lúc khởi động còn hơn" từ đầu, nhưng chốt
 * ấy chưa bao giờ được cài: nó chỉ ném lúc GỬI, tức lúc một người dùng thật đã
 * đăng ký xong và đang chờ thư. Đây là chỗ cài nó.
 *
 * ─── Vì sao ở `index.ts` chứ không ở `config/env.ts` ──────────────────────
 *
 * `env.ts` chết là chết cho MỌI tiến trình đọc nó — kể cả `migrate` và
 * `seed-admin`. Chặn luôn hai script đó là chặn chính đường sửa chữa. Chỉ máy
 * chủ API mới cần từ chối phục vụ.
 *
 * ─── Vì sao hỏi `cheDoMail()` chứ không tự kiểm `SMTP_HOST` ───────────────
 *
 * Luật "khi nào thì gửi được" chỉ nên có MỘT bản. Tự viết lại
 * `isProduction && SMTP_HOST === undefined` ở đây là dựng bản thứ hai, và hai
 * bản sẽ lệch nhau đúng vào lần sửa đầu tiên — lúc đó chốt này gác một luật
 * không còn ai dùng.
 */
function chanThieuSmtp(): void {
  if (cheDoMail() !== 'tat') return;

  console.error(
    [
      '',
      '[server] TỪ CHỐI khởi động: production nhưng chưa khai SMTP_HOST.',
      '',
      '  Hệ thống sẽ trông như đang chạy tốt, nhưng KHÔNG ai đăng ký mới vào',
      '  được: thư xác minh không gửi đi, nên mọi tài khoản mới kẹt ở',
      '  EmailNotVerified, và quên mật khẩu cũng không có đường về.',
      '',
      '  Khắc phục: khai SMTP_HOST (và SMTP_USER / SMTP_PASSWORD nếu máy chủ thư',
      '  đòi xác thực) trong backend/.env. Xem khối SMTP ở backend/.env.example',
      '  và mục 5 của docs/trien-khai.md.',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

async function start(): Promise<void> {
  // TRƯỚC migration: một cấu hình thiếu thì càng phát hiện sớm càng ít thứ phải
  // hoàn tác, và chốt này không chạm database nên không tốn gì.
  chanThieuSmtp();

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

  // Vòng lặp §11 — cho hết hạn đơn quá giờ, năm phút một lượt. Chỉ chạm MySQL
  // nên đặt trước hay sau `listen` đều được; đặt cạnh runner kia để hai vòng
  // lặp nền nằm chung một chỗ trong file này.
  startBillingRunner();

  // Sửa `.env` lúc đang chạy thì tự khởi động lại — chỉ khi dev. Không có nó,
  // thêm `SEPAY_API_TOKEN` rồi quét mã trả tiền là tiền về mà đơn đứng `pending`
  // mãi, vì tiến trình này chưa từng đọc token đó. Xem `config/envWatch.ts`.
  if (env.NODE_ENV === 'development') watchEnvFile();

  // Cube schema (§10) dựng lại từ database, cùng lý do đặt sau `listen`.
  //
  // Thư mục file cube nằm trong `.gitignore`, nên một lần `git clean` là mất
  // sạch trong khi database vẫn còn nguyên mô hình. Sinh lại lúc boot khép kín
  // khoảng lệch đó mà không ai phải nhớ làm gì. Cả hai hàm tự nuốt lỗi.
  await checkSchemaDir();

  /*
   * Hâm nóng NỐI SAU `regenerateAllTenants`, không song song — và thứ tự này là
   * điều kiện đúng đắn, không phải tối ưu. Hâm trước khi file schema được ghi
   * thì Cube biên dịch một thư mục rỗng rồi NHỚ bản rỗng đó dưới đúng
   * `schemaVersion` hiện tại; xem khối chú thích ở `startHamNongKhoiDong`.
   */
  void regenerateAllTenants().then(startHamNongKhoiDong);
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

  // TRƯỚC `closeMysql`, không phải sau: mấy việc nền này đang giữ connection từ
  // chính pool đó. Xem `stopIngestRunner`.
  await Promise.all([stopIngestRunner(), stopBillingRunner(), stopHamNongKhoiDong()]);

  const results = await Promise.allSettled([closeMysql(), closeRedis(), closeClickhouse()]);
  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('[server] lỗi khi đóng kết nối:', result.reason);
    }
  }

  /*
   * Quan trắc đóng SAU CÙNG, và cố ý như vậy: mấy dòng trên có thể ném lỗi, mà
   * đúng cái span ghi lại lỗi đó mới là thứ đáng gửi đi nhất. Tự nuốt lỗi — một
   * lượt xả span hỏng không được phép chặn tiến trình thoát.
   */
  await dongQuanTrac().catch((err: unknown) => {
    console.error('[server] lỗi khi đóng quan trắc:', err);
  });

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
