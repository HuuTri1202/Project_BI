import { type ReportFolderDto } from '@bi/shared';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import type { Db } from './db';
import { LIVE_REPORTS_SQL } from './reports';

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
  item_count: number;
  created_at: Date;
  updated_at: Date;
}

function toDto(row: FolderRow): ReportFolderDto {
  return {
    id: Number(row.id),
    workspaceId: Number(row.workspace_id),
    name: row.name,
    itemCount: Number(row.item_count),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/**
 * Mọi thư mục của một workspace, kèm số báo cáo đang nằm trong.
 *
 * ⚠️ Con số này phải KHỚP từng đơn vị với danh sách báo cáo bên cạnh, nên nó
 * đếm trên `LIVE_REPORTS_SQL` — đúng định nghĩa mà danh sách dùng. Đếm thẳng
 * trên bảng `reports` là cách bản đầu làm, và nó cho ra 12 trong khi danh sách
 * hiện 4: chênh lệch chính là những báo cáo có nguồn đã bị xoá mềm.
 *
 * ⚠️ `LEFT JOIN` chứ không phải `JOIN`: một thư mục RỖNG vẫn phải hiện ra —
 * người dùng vừa tạo thư mục xong mà nó không xuất hiện thì họ tạo lần nữa, và
 * lần đó đâm vào UNIQUE. Vì bảng con đã lọc sẵn, không có điều kiện nào phải
 * nhét vào `WHERE` — mà nhét vào đó thì thư mục toàn báo cáo mất nguồn sẽ biến
 * mất khỏi danh sách, không chỉ sai con số.
 */
export async function listFolders(
  db: Db,
  tenantId: number,
  workspaceId: number,
): Promise<ReportFolderDto[]> {
  const [rows] = await db.query<FolderRow[]>(
    `SELECT f.id, f.workspace_id, f.name, f.created_at, f.updated_at,
            COUNT(live.id) AS item_count
       FROM report_folders f
       LEFT JOIN (${LIVE_REPORTS_SQL}) live ON live.folder_id = f.id
      WHERE f.tenant_id = ? AND f.workspace_id = ?
      GROUP BY f.id
      ORDER BY f.name ASC`,
    [tenantId, workspaceId],
  );
  return rows.map(toDto);
}

/**
 * Số báo cáo CHƯA xếp thư mục — con số in cạnh chữ "Chung".
 *
 * Cùng `LIVE_REPORTS_SQL` với `listFolders` và với danh sách báo cáo. Xem ghi
 * chú ở đó: ba chỗ này phải nói cùng một con số, nếu không người dùng đếm tay
 * ra một kết quả khác kết quả hệ thống in ra.
 */
export async function countChung(db: Db, tenantId: number, workspaceId: number): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM (${LIVE_REPORTS_SQL}) live
      WHERE live.tenant_id = ? AND live.workspace_id = ? AND live.folder_id IS NULL`,
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
