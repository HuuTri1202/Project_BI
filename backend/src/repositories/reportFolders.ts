import { type ReportFolderDto } from '@bi/shared';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import type { Db } from './db';

/**
 * Thư mục báo cáo — §10.25. Cùng khuôn tenant-scoped với `reports.ts`.
 *
 * Bảng này KHÔNG có `deleted_at`: thư mục không mang dữ liệu của riêng nó, và
 * xoá nó chỉ đẩy các báo cáo bên trong về Chung (khoá ngoại `ON DELETE SET
 * NULL`). Lập luận đầy đủ nằm ở migration 37.
 *
 * ⚠️ Mọi hàm ở đây nhận `tenantId` và đưa nó vào WHERE, kể cả khi đã có `id`.
 * Khoá chính là duy nhất toàn bảng, nên thiếu vế đó là một mã đoán đúng đọc
 * được thư mục của tổ chức khác — đúng loại lỗ mà lớp route không đỡ hộ được.
 */

interface FolderRow extends RowDataPacket {
  id: number;
  workspace_id: number;
  name: string;
  report_count: number;
  created_at: Date;
  updated_at: Date;
}

function toDto(row: FolderRow): ReportFolderDto {
  return {
    id: Number(row.id),
    workspaceId: Number(row.workspace_id),
    name: row.name,
    reportCount: Number(row.report_count),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/**
 * Mọi thư mục của một workspace, kèm số báo cáo đang nằm trong.
 *
 * ⚠️ `LEFT JOIN` chứ không phải `JOIN`: một thư mục RỖNG vẫn phải hiện ra —
 * người dùng vừa bấm "Thư mục mới" xong mà nó không xuất hiện thì họ bấm lần
 * nữa, và lần đó đâm vào UNIQUE.
 *
 * Điều kiện lọc báo cáo nằm trong mệnh đề `ON`, KHÔNG phải `WHERE`. Chuyển nó
 * xuống `WHERE` là biến LEFT JOIN thành JOIN thường — mọi thư mục rỗng biến mất
 * khỏi danh sách, âm thầm, và chỉ lộ ra với đúng thư mục chưa có báo cáo nào.
 */
export async function listFolders(
  db: Db,
  tenantId: number,
  workspaceId: number,
): Promise<ReportFolderDto[]> {
  const [rows] = await db.query<FolderRow[]>(
    `SELECT f.id, f.workspace_id, f.name, f.created_at, f.updated_at,
            COUNT(r.id) AS report_count
       FROM report_folders f
       LEFT JOIN reports r ON r.folder_id = f.id AND r.deleted_at IS NULL
      WHERE f.tenant_id = ? AND f.workspace_id = ?
      GROUP BY f.id
      ORDER BY f.name ASC`,
    [tenantId, workspaceId],
  );
  return rows.map(toDto);
}

/** Số báo cáo CHƯA xếp thư mục — con số của "Chung" trên cột bên trái. */
export async function countChung(db: Db, tenantId: number, workspaceId: number): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM reports
      WHERE tenant_id = ? AND workspace_id = ? AND folder_id IS NULL AND deleted_at IS NULL`,
    [tenantId, workspaceId],
  );
  return Number(rows[0]?.['total'] ?? 0);
}

/**
 * Một thư mục, để route kiểm nó có thật và ĐÚNG WORKSPACE trước khi chuyển báo
 * cáo vào — xem ghi chú ở `reports.moveReport`.
 */
export async function findFolder(
  db: Db,
  tenantId: number,
  id: number,
): Promise<{ id: number; workspaceId: number; name: string } | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id, workspace_id, name FROM report_folders
      WHERE tenant_id = ? AND id = ? LIMIT 1`,
    [tenantId, id],
  );
  const row = rows[0];
  if (row === undefined) return null;
  return {
    id: Number(row['id']),
    workspaceId: Number(row['workspace_id']),
    name: String(row['name']),
  };
}

export async function countFolders(db: Db, tenantId: number, workspaceId: number): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM report_folders WHERE tenant_id = ? AND workspace_id = ?`,
    [tenantId, workspaceId],
  );
  return Number(rows[0]?.['total'] ?? 0);
}

export async function createFolder(
  db: Db,
  tenantId: number,
  input: { workspaceId: number; name: string; createdBy: number },
): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    `INSERT INTO report_folders (tenant_id, workspace_id, name, created_by)
     VALUES (?, ?, ?, ?)`,
    [tenantId, input.workspaceId, input.name, input.createdBy],
  );
  return result.insertId;
}

export async function renameFolder(
  db: Db,
  tenantId: number,
  id: number,
  name: string,
): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    `UPDATE report_folders SET name = ? WHERE tenant_id = ? AND id = ?`,
    [name, tenantId, id],
  );
  return result.affectedRows;
}

/**
 * Xoá một thư mục. Báo cáo bên trong KHÔNG mất — khoá ngoại `ON DELETE SET
 * NULL` đưa chúng về Chung, và luật đó nằm ở database chứ không ở đây, để nó
 * còn đúng với mọi đường xoá khác được thêm về sau.
 */
export async function deleteFolder(db: Db, tenantId: number, id: number): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    `DELETE FROM report_folders WHERE tenant_id = ? AND id = ?`,
    [tenantId, id],
  );
  return result.affectedRows;
}

/** Tên trùng trong cùng workspace — UNIQUE `uq_report_folders_name`. */
export function isDuplicateFolderName(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: string }).code === 'ER_DUP_ENTRY' &&
    String((err as { message?: string }).message ?? '').includes('uq_report_folders_name')
  );
}
