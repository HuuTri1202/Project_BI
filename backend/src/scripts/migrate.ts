/**
 * Chạy migration một cách độc lập:
 *
 *   npm run migrate
 *
 * `npm run dev` / `node dist/index.js` cũng tự chạy migration lúc boot, nên
 * script này chỉ dùng khi muốn áp dụng schema mà chưa cần mở server — ví dụ
 * trong CI, hoặc để xem log migration cho gọn.
 */
import { closeMysql } from '../config/mysql';
import { runMigrations } from '../db/migrate';

runMigrations()
  .then(async () => {
    await closeMysql();
    process.exit(0);
  })
  .catch(async (err: unknown) => {
    console.error('[migrate] thất bại:', err);
    await closeMysql();
    process.exit(1);
  });
