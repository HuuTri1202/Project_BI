import type { RowDataPacket } from 'mysql2';
import { mysqlPool } from '../config/mysql';
import { migrations } from './migrations';

/**
 * Áp dụng những migration chưa chạy.
 *
 * Không bọc transaction: MySQL tự động commit trước và sau mỗi câu lệnh DDL,
 * nên `START TRANSACTION` quanh `CREATE TABLE` chỉ tạo cảm giác an toàn giả.
 * Bù lại, mỗi migration được ghi nhận riêng nên lần chạy sau tiếp tục đúng từ
 * chỗ hỏng.
 */
export async function runMigrations(): Promise<void> {
  await mysqlPool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      id         INT UNSIGNED NOT NULL,
      name       VARCHAR(255) NOT NULL,
      applied_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  );

  const [rows] = await mysqlPool.query<RowDataPacket[]>('SELECT id FROM schema_migrations');
  const applied = new Set(rows.map((row) => Number(row['id'])));

  let count = 0;
  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;

    for (const statement of migration.statements) {
      await mysqlPool.query(statement);
    }
    await mysqlPool.query('INSERT INTO schema_migrations (id, name) VALUES (?, ?)', [
      migration.id,
      migration.name,
    ]);

    console.log(`[migrate] đã áp dụng ${migration.id} - ${migration.name}`);
    count += 1;
  }

  console.log(
    count > 0
      ? `[migrate] xong, ${count} migration mới`
      : `[migrate] database đã ở phiên bản mới nhất (${migrations.length} migration)`,
  );
}
