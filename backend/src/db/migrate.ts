import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import mysql, { type RowDataPacket } from 'mysql2/promise';

import { env } from '../config/env';

/**
 * Chạy các file .sql trong `backend/migrations/` đúng một lần, theo thứ tự tên.
 *
 * Vì sao không dùng `infrastructure/mysql/init/`: thư mục đó chỉ được MySQL chạy
 * KHI VOLUME CÒN RỖNG. Với schema còn tiến hoá thì đó là cái bẫy — người đã có
 * volume cũ sẽ không bao giờ nhận được bảng mới. Thư mục đó giữ đúng việc hẹp
 * của nó: tạo database/user (Strapi, user CDC).
 *
 * Vì sao tự viết thay vì dùng umzug/db-migrate: cả hai đều xoay quanh một lớp
 * storage/adapter mà repo này không có (không ORM), nên vẫn phải tự viết
 * storage + resolver cho file .sql — tức là cùng chừng ấy code, cộng thêm một
 * dependency và một file config nằm ngoài quy ước "cấu hình chỉ qua env.ts".
 */

/**
 * ĐỘ SÂU CỦA FILE NÀY LÀ MỘT PHẦN CỦA THIẾT KẾ: phải đúng `src/db/`, hai tầng.
 *
 * `tsc` chỉ emit .ts, nên nếu để file .sql trong `src/` thì `dist/` sẽ không có
 * chúng và `npm start` hỏng theo kiểu chỉ lộ ra ở production. Đặt migrations
 * ngang hàng với `src/` thì đường dẫn tương đối giống hệt nhau ở cả hai nơi:
 *   dev   backend/src/db/migrate.ts  -> backend/migrations/
 *   build backend/dist/db/migrate.js -> backend/migrations/
 *
 * Dùng `__dirname` chứ không phải `import.meta.url`: backend không đặt
 * "type": "module" nên tsc emit ra CommonJS, ở đó `import.meta` là lỗi biên dịch.
 */
const migrationsDir = join(__dirname, '..', '..', 'migrations');

const LOCK_NAME = 'bi_platform_migrate';

interface AppliedRow extends RowDataPacket {
  version: string;
  checksum: string;
}

const LEDGER_DDL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    VARCHAR(20)  NOT NULL,
  name       VARCHAR(150) NOT NULL,
  checksum   CHAR(64) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
  applied_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`;

function versionOf(fileName: string): string {
  const [version] = fileName.split('_');
  return version ?? fileName;
}

async function main(): Promise<void> {
  const connection = await mysql.createConnection({
    host: env.MYSQL_HOST,
    port: env.MYSQL_PORT,
    user: env.MYSQL_USER,
    password: env.MYSQL_PASSWORD,
    database: env.MYSQL_DATABASE,
    timezone: 'Z',
    // Bật ở ĐÚNG chỗ này và không ở đâu khác: một file migration là nhiều câu
    // lệnh. Pool của ứng dụng phải giữ tuỳ chọn này TẮT, vì nó biến mọi lỗ hổng
    // injection thành stacked-query injection.
    multipleStatements: true,
  });

  // Pool có hook riêng làm việc này; connection ở đây không đi qua pool.
  await connection.query("SET time_zone = '+00:00'");

  let lockAcquired = false;
  try {
    // Khoá tư vấn: chặn hai người (hoặc `dev` và `migrate` ở hai terminal) cùng
    // áp dụng một file. Không có nó thì hai tiến trình cùng thấy "chưa áp dụng".
    const [lockRows] = await connection.query<RowDataPacket[]>('SELECT GET_LOCK(?, 10) AS ok', [
      LOCK_NAME,
    ]);
    lockAcquired = lockRows[0]?.['ok'] === 1;
    if (!lockAcquired) {
      throw new Error('Không lấy được khoá migrate sau 10 giây — có tiến trình khác đang chạy?');
    }

    await connection.query(LEDGER_DDL);

    const [appliedRows] = await connection.query<AppliedRow[]>(
      'SELECT version, checksum FROM schema_migrations',
    );
    const applied = new Map(appliedRows.map((row) => [row.version, row.checksum]));

    const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();

    let count = 0;
    for (const file of files) {
      const version = versionOf(file);
      const sql = await readFile(join(migrationsDir, file), 'utf8');
      const checksum = createHash('sha256').update(sql, 'utf8').digest('hex');
      const previous = applied.get(version);

      if (previous !== undefined) {
        if (previous !== checksum) {
          // Đây là toàn bộ giá trị của cột checksum: phát hiện người sửa một
          // migration đã chạy trên máy mình, khiến máy đồng đội có schema khác.
          throw new Error(
            `Migration ${file} đã được áp dụng nhưng nội dung file đã thay đổi.\n` +
              'Đừng sửa migration cũ — hãy tạo file mới với số thứ tự tiếp theo.',
          );
        }
        continue;
      }

      console.log(`[migrate] + ${file}`);
      // CỐ Ý không bọc BEGIN/COMMIT: MySQL tự commit ngầm quanh mọi câu lệnh
      // DDL, nên transaction ở đây không rollback được gì mà chỉ tạo cảm giác
      // an toàn giả. Hệ quả: migration là forward-only, không có `down`. Ở giai
      // đoạn dev, cách phục hồi là `docker compose down -v` rồi migrate lại.
      await connection.query(sql);
      await connection.query(
        'INSERT INTO schema_migrations (version, name, checksum) VALUES (?, ?, ?)',
        [version, file, checksum],
      );
      count++;
    }

    console.log(
      count === 0
        ? `[migrate] Không có migration mới (${files.length} file đã áp dụng).`
        : `[migrate] Xong: áp dụng ${count} migration.`,
    );
  } finally {
    if (lockAcquired) {
      await connection.query('SELECT RELEASE_LOCK(?)', [LOCK_NAME]);
    }
    await connection.end();
  }
}

main().catch((err: unknown) => {
  console.error('[migrate] THẤT BẠI:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
