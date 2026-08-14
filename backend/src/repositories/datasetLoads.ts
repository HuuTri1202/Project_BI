import type { DatasetLoadDto, DatasetLoadErrorDto, LoadRunStatus } from '@bi/shared';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import type { Db } from './db';

/**
 * Sổ ghi chép của việc nạp vào kho phân tích (§9).
 *
 * ⚠️ Ở đây KHÔNG có dữ liệu của khách hàng. Dòng dữ liệu thật nằm bên ClickHouse;
 * hai bảng này chỉ ghi ai bấm nạp lúc nào, chạy tới đâu, ô nào hỏng vì sao. Ngày
 * nào có người thêm một cột "dữ liệu" vào đây thì hệ thống có hai kho phân tích
 * và không ai biết kho nào đúng.
 *
 * Cùng quy ước với phần còn lại của repo: executor trước, `tenantId` ngay sau,
 * mọi câu lệnh đọc/ghi theo dataset đều lọc theo nó.
 */

interface RunRow extends RowDataPacket {
  id: number;
  dataset_id: number;
  status: LoadRunStatus;
  rows_read: number;
  rows_loaded: number;
  rows_failed: number;
  error_message: string | null;
  queued_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  ch_table: string | null;
}

/**
 * Lần nạp gần nhất của một bộ dữ liệu, kèm tên bảng đang phục vụ.
 *
 * JOIN sang `datasets` để lấy `ch_table` và lọc `tenant_id` trong CÙNG một câu:
 * `dataset_load_runs` có cột `tenant_id` riêng, nhưng đọc qua bảng cha thì một
 * dataset của tổ chức khác không thể lọt ra kể cả khi hai cột lệch nhau vì một
 * lỗi ghi nào đó.
 */
export async function findLatestRun(
  db: Db,
  tenantId: number,
  datasetId: number,
): Promise<Omit<DatasetLoadDto, 'datasetStatus'> | null> {
  const [rows] = await db.query<RunRow[]>(
    `SELECT r.id, r.dataset_id, r.status, r.rows_read, r.rows_loaded, r.rows_failed,
            r.error_message, r.queued_at, r.started_at, r.finished_at, d.ch_table
       FROM dataset_load_runs r
       JOIN datasets d ON d.id = r.dataset_id AND d.tenant_id = r.tenant_id
      WHERE r.tenant_id = ? AND r.dataset_id = ?
      ORDER BY r.id DESC LIMIT 1`,
    [tenantId, datasetId],
  );
  const row = rows[0];
  if (!row) return null;

  return {
    runId: Number(row.id),
    status: row.status,
    rowsRead: Number(row.rows_read),
    rowsLoaded: Number(row.rows_loaded),
    rowsFailed: Number(row.rows_failed),
    errorMessage: row.error_message,
    chTable: row.ch_table,
    queuedAt: row.queued_at.toISOString(),
    startedAt: row.started_at?.toISOString() ?? null,
    finishedAt: row.finished_at?.toISOString() ?? null,
  };
}

/** Còn một lần nạp chưa xong -> endpoint trả 409 thay vì xếp thêm một cái nữa. */
export async function hasPendingRun(
  db: Db,
  tenantId: number,
  datasetId: number,
): Promise<boolean> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT 1 FROM dataset_load_runs
      WHERE tenant_id = ? AND dataset_id = ? AND status IN ('queued','running')
      LIMIT 1`,
    [tenantId, datasetId],
  );
  return rows.length > 0;
}

export async function enqueue(
  db: Db,
  tenantId: number,
  datasetId: number,
  triggeredBy: number | null,
): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    `INSERT INTO dataset_load_runs (tenant_id, dataset_id, status, triggered_by)
     VALUES (?, ?, 'queued', ?)`,
    [tenantId, datasetId, triggeredBy],
  );
  return result.insertId;
}

export interface ClaimedRun {
  runId: number;
  tenantId: number;
  datasetId: number;
}

/**
 * Nhặt MỘT việc từ hàng đợi — và đây là chỗ chống chạy trùng.
 *
 * ─── Vì sao là một câu UPDATE, không phải SELECT rồi UPDATE ─────────────────
 *
 * Một cờ `busy` trong bộ nhớ không đủ. `tsx watch` restart mỗi lần lưu file, và
 * hai terminal cùng `npm run dev` là chuyện xảy ra thật — mỗi lần như vậy là một
 * TIẾN TRÌNH mới với bộ nhớ riêng, nên cờ của tiến trình này không nói gì được
 * với tiến trình kia.
 *
 * `UPDATE … WHERE status='queued' … LIMIT 1` để chính InnoDB làm trọng tài:
 * người thắng là người đọc được `affectedRows === 1`. Không cần bảng khoá, không
 * cần Redis, không cần `SELECT … FOR UPDATE`.
 *
 * Hai bước (UPDATE rồi SELECT lại) chứ không một, vì MySQL không có
 * `UPDATE … RETURNING`. Câu SELECT ngay sau đó an toàn: dòng đã mang
 * `status='running'` nên không tiến trình nào khác chạm được nữa.
 */
export async function claimNext(db: Db): Promise<ClaimedRun | null> {
  const [result] = await db.query<ResultSetHeader>(
    `UPDATE dataset_load_runs
        SET status = 'running', started_at = CURRENT_TIMESTAMP(3)
      WHERE status = 'queued'
      ORDER BY id ASC
      LIMIT 1`,
  );
  if (result.affectedRows !== 1) return null;

  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id, tenant_id, dataset_id FROM dataset_load_runs
      WHERE status = 'running' ORDER BY started_at DESC, id DESC LIMIT 1`,
  );
  const row = rows[0];
  if (!row) return null;

  return {
    runId: Number(row['id']),
    tenantId: Number(row['tenant_id']),
    datasetId: Number(row['dataset_id']),
  };
}

/** Tiến độ, ghi lại sau mỗi lô để giao diện thấy con số nhích lên. */
export async function updateProgress(
  db: Db,
  runId: number,
  progress: { rowsRead: number; rowsLoaded: number; rowsFailed: number },
): Promise<void> {
  await db.query<ResultSetHeader>(
    `UPDATE dataset_load_runs SET rows_read = ?, rows_loaded = ?, rows_failed = ? WHERE id = ?`,
    [progress.rowsRead, progress.rowsLoaded, progress.rowsFailed, runId],
  );
}

export async function finish(
  db: Db,
  runId: number,
  status: 'succeeded' | 'failed',
  errorMessage: string | null,
): Promise<void> {
  await db.query<ResultSetHeader>(
    `UPDATE dataset_load_runs
        SET status = ?, error_message = ?, finished_at = CURRENT_TIMESTAMP(3)
      WHERE id = ?`,
    [status, errorMessage?.slice(0, 500) ?? null, runId],
  );
}

/**
 * Dọn tàn dư lúc boot.
 *
 * Mọi dòng còn `running` khi tiến trình vừa khởi động là xác của một tiến trình
 * đã chết — `tsx watch` restart, Ctrl+C, hay máy tắt. Không có bước này thì một
 * lần restart giữa chừng để lại một job kẹt VĨNH VIỄN ở "đang chạy", và nút Nạp
 * lại bị khoá bởi chính câu kiểm 409 — người dùng không có đường nào thoát ngoài
 * việc sửa tay database.
 *
 * Đánh `failed` kèm lý do đọc được, chứ không xếp lại hàng: xếp lại thì một bộ
 * dữ liệu làm sập tiến trình sẽ sập lại ngay sau mỗi lần khởi động, và vòng lặp
 * đó không tự thoát. Bấm nạp lại là một cú nhấp chuột.
 */
export async function failStaleRuns(db: Db): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    `UPDATE dataset_load_runs
        SET status = 'failed', finished_at = CURRENT_TIMESTAMP(3),
            error_message = 'Máy chủ khởi động lại khi lần nạp đang chạy. Hãy bấm Nạp lại.'
      WHERE status = 'running'`,
  );
  if (result.affectedRows > 0) {
    await db.query<ResultSetHeader>(
      `UPDATE datasets SET load_status = 'failed' WHERE load_status = 'running'`,
    );
  }
  return result.affectedRows;
}

// ─── Ô lỗi (§9.8) ────────────────────────────────────────────────────────────

/**
 * Trần số ô lỗi lưu cho MỘT lần nạp.
 *
 * Một cột ngày sai định dạng trên file 50.000 dòng sinh ra 50.000 lỗi GIỐNG HỆT
 * NHAU. Lưu hết là 50.000 dòng không mang thêm một bit thông tin nào so với 100
 * dòng đầu, một trang không mở nổi, và một bảng sổ ghi chép to hơn cả thứ nó ghi
 * chép.
 *
 * Con số TỔNG vẫn được đếm đủ ở `dataset_load_runs.rows_failed`. Người dùng cần
 * hai điều: "hỏng bao nhiêu" và "hỏng thế nào" — 100 trả lời được cả hai.
 */
export const MAX_LOAD_ERRORS = 100;

export interface LoadErrorInput {
  rowIndex: number;
  columnName: string | null;
  rawValue: string | null;
  reason: string;
}

export async function insertErrors(
  db: Db,
  runId: number,
  errors: readonly LoadErrorInput[],
): Promise<void> {
  if (errors.length === 0) return;

  await db.query<ResultSetHeader>(
    'INSERT INTO dataset_load_errors (run_id, row_index, column_name, raw_value, reason) VALUES ?',
    [
      errors.map((e) => [
        runId,
        e.rowIndex,
        e.columnName?.slice(0, 255) ?? null,
        e.rawValue?.slice(0, 255) ?? null,
        e.reason.slice(0, 255),
      ]),
    ],
  );
}

export async function countErrors(db: Db, runId: number): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>(
    'SELECT COUNT(*) AS total FROM dataset_load_errors WHERE run_id = ?',
    [runId],
  );
  return Number(rows[0]?.['total'] ?? 0);
}

export async function listErrors(
  db: Db,
  runId: number,
  page: number,
  pageSize: number,
): Promise<DatasetLoadErrorDto[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id, row_index, column_name, raw_value, reason
       FROM dataset_load_errors WHERE run_id = ?
      ORDER BY id ASC LIMIT ? OFFSET ?`,
    [runId, pageSize, (page - 1) * pageSize],
  );
  return rows.map((r) => ({
    id: Number(r['id']),
    rowIndex: Number(r['row_index']),
    columnName: r['column_name'] === null ? null : String(r['column_name']),
    rawValue: r['raw_value'] === null ? null : String(r['raw_value']),
    reason: String(r['reason']),
  }));
}
