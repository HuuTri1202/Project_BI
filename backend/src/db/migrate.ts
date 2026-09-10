import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { mysqlPool } from '../config/mysql';
import { migrations, type Migration } from './migrations';

/**
 * Áp dụng những migration chưa chạy.
 *
 * Không bọc transaction: MySQL tự động commit trước và sau mỗi câu lệnh DDL,
 * nên `START TRANSACTION` quanh `CREATE TABLE` chỉ tạo cảm giác an toàn giả.
 * Bù lại, mỗi migration được ghi nhận riêng nên lần chạy sau tiếp tục đúng từ
 * chỗ hỏng.
 *
 * ═══ Hai cách nó từng để lại một schema nửa vời ═════════════════════════════
 *
 * Bản đầu chạy thẳng `mysqlPool.query`, và ghi dòng vào `schema_migrations`
 * SAU KHI mọi câu lệnh đã xong. Với một migration một câu lệnh thì gần như
 * không bao giờ hỏng. Nhưng nó hỏng thật, hai kiểu:
 *
 *   1. HAI TIẾN TRÌNH CÙNG CHẠY. `tsx watch` khởi động lại backend trong lúc
 *      bản cũ đang migrate, hoặc `npm run migrate` chạy tay song song với dev
 *      server. Cả hai đọc `schema_migrations` thấy 30 chưa có, cả hai chạy
 *      `ALTER TABLE reports ADD COLUMN canvas` — người thua nhận
 *      `Duplicate column name 'canvas'`, và vì lỗi nổ TRƯỚC câu INSERT nên
 *      không ai ghi nhận gì cả. Kết quả: cột ĐÃ CÓ trong schema mà bảng ghi
 *      nhận thì trống, nên mọi lần chạy sau đều đâm vào đúng lỗi đó. Đây là
 *      chuyện đã xảy ra thật khi dựng §10.10.
 *
 *   2. BỊ GIẾT GIỮA CHỪNG. Migration nhiều câu lệnh, tiến trình chết sau câu
 *      thứ nhất. Không có dòng ghi nhận nào, lần sau chạy lại từ câu thứ nhất
 *      và đâm vào "đã tồn tại".
 *
 * Hai chỗ bịt, mỗi chỗ cho một kiểu:
 *
 *   (1) KHOÁ `GET_LOCK` — chỉ một tiến trình được migrate tại một thời điểm.
 *   (2) DÒNG GHI NHẬN ĐẶT TRƯỚC, đóng lại sau — xem `finished_at` bên dưới.
 *
 * ═══ Vì sao `GET_LOCK` chứ không phải một bảng khoá ═════════════════════════
 *
 * Khoá bằng một dòng trong bảng nghe đơn giản hơn, cho tới lúc tiến trình giữ
 * khoá bị `kill -9` — dòng đó nằm lại vĩnh viễn và không ai migrate được nữa,
 * trừ khi tự viết thêm phần dò khoá chết bằng timestamp (và chọn một ngưỡng
 * hết hạn, tức là chọn sai). `GET_LOCK` gắn với PHIÊN KẾT NỐI: tiến trình chết
 * là MySQL tự nhả. Đúng cái tình huống đã gây ra lỗi — `tsx watch` giết tiến
 * trình cũ — nên đây không phải chi tiết lý thuyết.
 *
 * Tên khoá có kèm `DATABASE()`: khoá của `GET_LOCK` phạm vi TOÀN MÁY CHỦ, nên
 * một tên cố định sẽ bắt `bi_platform` và `bi_platform_test` xếp hàng chờ
 * nhau — dev server và bộ test integration chạy cùng lúc là chuyện thường.
 *
 * ═══ `finished_at NULL` = đang chạy dở ══════════════════════════════════════
 *
 * Dòng ghi nhận được INSERT TRƯỚC khi chạy câu lệnh đầu tiên và chỉ được đóng
 * (`finished_at`) sau khi câu cuối xong, còn `done_statements` đếm tiến độ. Nên
 * một dòng `finished_at IS NULL` nghĩa là chính xác một điều: lần chạy trước
 * dừng giữa chừng.
 *
 * Ở đó runner DỪNG LẠI và nói ra, thay vì chạy tiếp trên một schema nửa vời.
 * Nó không thể tự chữa: nó không biết câu lệnh dở dang đã kịp làm gì, và đoán
 * sai thì hỏng theo cách khó lần hơn hẳn. Nhưng nó biết đã xong mấy câu và còn
 * câu nào — nên câu thông báo nói đủ để người ta xử trong một phút.
 */

/** Chờ tối đa bấy nhiêu giây để lấy khoá migrate. */
const LOCK_WAIT_SECONDS = 60;

/**
 * `DATABASE()` tính phía MySQL nên hai câu lấy/nhả chắc chắn cùng một tên —
 * ghép chuỗi ở TypeScript là mời một lỗi khoá không bao giờ nhả được.
 */
const LOCK_NAME_SQL = "CONCAT('bi_platform:migrate:', DATABASE())";

export async function runMigrations(): Promise<void> {
  /*
   * Connection RIÊNG, không phải `mysqlPool.query`.
   *
   * `GET_LOCK` và `RELEASE_LOCK` gắn với đúng một phiên kết nối. Gọi qua pool
   * thì mỗi câu bốc một connection bất kỳ, nên câu nhả khoá rất có thể chạy
   * trên phiên KHÔNG giữ khoá: nó trả về 0, không nhả gì cả, và khoá nằm lại
   * tới khi connection kia bị pool thu hồi.
   */
  const conn = await mysqlPool.getConnection();
  try {
    await acquireLock(conn);
    try {
      await ensureLedger(conn);
      await applyPending(conn);
    } finally {
      await conn.query(`DO RELEASE_LOCK(${LOCK_NAME_SQL})`);
    }
  } finally {
    conn.release();
  }
}

async function acquireLock(conn: PoolConnection): Promise<void> {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT ${LOCK_NAME_SQL} AS name, GET_LOCK(${LOCK_NAME_SQL}, ?) AS got`,
    [LOCK_WAIT_SECONDS],
  );

  // 1 = lấy được, 0 = hết giờ chờ, NULL = lỗi phía MySQL. Chỉ 1 mới đi tiếp.
  if (Number(rows[0]?.['got'] ?? 0) === 1) return;

  throw new Error(
    `[migrate] chờ ${LOCK_WAIT_SECONDS}s vẫn không lấy được khoá ` +
      `"${String(rows[0]?.['name'] ?? '?')}". Có tiến trình khác đang migrate ` +
      `cùng database này — đợi nó xong rồi chạy lại.`,
  );
}

/**
 * Dựng (hoặc nâng cấp) bảng ghi nhận.
 *
 * `finished_at` và `done_statements` là hai cột thêm ở lần bịt lỗi này. Chúng
 * KHÔNG đi qua danh sách `migrations` được: bảng này chính là thứ quyết định
 * migration nào đã chạy, nên nó phải đúng hình dạng TRƯỚC khi đọc được dòng
 * đầu tiên. Vì vậy ở đây tự dò `information_schema` — MySQL 8 không có
 * `ADD COLUMN IF NOT EXISTS` (đó là cú pháp MariaDB).
 */
async function ensureLedger(conn: PoolConnection): Promise<void> {
  await conn.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      id              INT UNSIGNED NOT NULL,
      name            VARCHAR(255) NOT NULL,
      applied_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      finished_at     DATETIME(3)  NULL,
      done_statements SMALLINT UNSIGNED NOT NULL DEFAULT 0,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  );

  const [cols] = await conn.query<RowDataPacket[]>(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schema_migrations'`,
  );
  const have = new Set(cols.map((row) => String(row['COLUMN_NAME'])));

  if (!have.has('finished_at')) {
    await conn.query(
      `ALTER TABLE schema_migrations ADD COLUMN finished_at DATETIME(3) NULL AFTER applied_at`,
    );
    /*
     * Backfill BẮT BUỘC, không phải dọn dẹp cho đẹp.
     *
     * Bản cũ chỉ ghi dòng SAU khi migration đã chạy xong, nên mọi dòng có sẵn
     * đều là "xong". Để chúng NULL thì lần chạy tiếp theo đọc ra 29 migration
     * dở dang và chặn đứng cả backend trên một database hoàn toàn lành lặn.
     */
    await conn.query(`UPDATE schema_migrations SET finished_at = applied_at`);
  }

  if (!have.has('done_statements')) {
    await conn.query(
      `ALTER TABLE schema_migrations
         ADD COLUMN done_statements SMALLINT UNSIGNED NOT NULL DEFAULT 0`,
    );
    // Không backfill: cột này chỉ được ĐỌC ở dòng dở dang, mà dòng cũ thì vừa
    // được đánh dấu xong ở trên.
  }
}

async function applyPending(conn: PoolConnection): Promise<void> {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT id, name, done_statements, finished_at IS NULL AS unfinished
       FROM schema_migrations ORDER BY id`,
  );

  const broken = rows.find((row) => Number(row['unfinished']) === 1);
  if (broken !== undefined) throw new Error(explainBroken(broken));

  const applied = new Set(rows.map((row) => Number(row['id'])));

  let count = 0;
  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;
    await applyOne(conn, migration);
    console.log(`[migrate] đã áp dụng ${migration.id} - ${migration.name}`);
    count += 1;
  }

  console.log(
    count > 0
      ? `[migrate] xong, ${count} migration mới`
      : `[migrate] database đã ở phiên bản mới nhất (${migrations.length} migration)`,
  );
}

async function applyOne(conn: PoolConnection, migration: Migration): Promise<void> {
  // Dòng ghi nhận đi TRƯỚC. Đây cũng là chốt chặn thứ hai sau `GET_LOCK`: khoá
  // chính (id) làm hai tiến trình cùng chạy migration này thành một lỗi trùng
  // khoá sạch sẽ, thay vì hai lần `ALTER TABLE` chồng lên nhau.
  await conn.query('INSERT INTO schema_migrations (id, name) VALUES (?, ?)', [
    migration.id,
    migration.name,
  ]);

  let done = 0;
  try {
    for (const statement of migration.statements) {
      await conn.query(statement);
      done += 1;
      await conn.query('UPDATE schema_migrations SET done_statements = ? WHERE id = ?', [
        done,
        migration.id,
      ]);
    }
  } catch (err) {
    /*
     * Câu ĐẦU TIÊN hỏng nghĩa là schema chưa bị đụng gì.
     *
     * MySQL 8 có atomic DDL: một câu lệnh DDL hoặc xong hẳn hoặc quay lui hẳn,
     * không có nửa vời TRONG một câu. Nên ở đây xoá dòng chờ là an toàn, và
     * đáng làm: một lỗi nhất thời (mất kết nối, hết hạn chờ khoá bảng) không
     * nên biến thành "phải vào sửa tay database" ở lần chạy sau.
     *
     * Hỏng từ câu thứ hai trở đi thì KHÁC: những câu trước đã đổi schema thật.
     * Để dòng chờ nằm lại, và lần sau `explainBroken` nói ra còn thiếu câu nào.
     */
    if (done === 0) {
      await conn.query('DELETE FROM schema_migrations WHERE id = ?', [migration.id]);
    }
    throw err;
  }

  await conn.query('UPDATE schema_migrations SET finished_at = CURRENT_TIMESTAMP(3) WHERE id = ?', [
    migration.id,
  ]);
}

/**
 * Câu thông báo cho một migration dở dang.
 *
 * Dài, và cố ý dài. Đây là thứ đọc được lúc 11 giờ đêm khi backend không lên và
 * lỗi duy nhất trên màn hình là `Duplicate column name`. Nói đủ để người ta xử
 * xong trong một phút mà không phải mở file này ra đọc.
 */
function explainBroken(row: RowDataPacket): string {
  const id = Number(row['id']);
  const done = Number(row['done_statements']);
  const known = migrations.find((m) => m.id === id);
  const total = known?.statements.length;

  const remaining = (known?.statements ?? []).slice(done);
  const list =
    remaining.length === 0
      ? '  (không rõ — id này không có trong danh sách migration của mã nguồn hiện tại)'
      : remaining.map((sql, i) => `  [${done + i + 1}] ${oneLine(sql)}`).join('\n');

  return [
    `[migrate] migration ${id} (${String(row['name'])}) đang DỞ DANG — lần chạy trước dừng giữa chừng.`,
    `Đã chạy xong ${done}/${total ?? '?'} câu lệnh, nên schema đang ở trạng thái nửa vời và`,
    `runner không chạy tiếp (chạy tiếp trên schema sai còn khó gỡ hơn).`,
    '',
    'Câu lệnh CÓ THỂ còn thiếu:',
    list,
    '',
    'Kiểm tra schema thật rồi chọn một trong hai:',
    `  a) đã đủ / chạy tay nốt phần thiếu  ->  UPDATE schema_migrations SET finished_at = NOW(3), done_statements = ${total ?? done} WHERE id = ${id};`,
    `  b) hoàn tác phần đã chạy            ->  DELETE FROM schema_migrations WHERE id = ${id};`,
  ].join('\n');
}

/** SQL nhiều dòng gọn lại thành một dòng đọc lướt được trong log. */
function oneLine(sql: string): string {
  const flat = sql.replace(/\s+/g, ' ').trim();
  return flat.length > 120 ? `${flat.slice(0, 117)}...` : flat;
}
