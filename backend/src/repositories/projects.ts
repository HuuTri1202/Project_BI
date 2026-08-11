import type { ProjectDto } from '@bi/shared';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { escapeLikeTerm } from '../utils/sql';
import type { Db } from './db';

/**
 * Project — cấp dưới workspace: `tenant -> workspace -> project -> dataset/chart`.
 *
 * Bảng đã có từ migration 1 nhưng tới Section 04 mới có người gọi.
 *
 * ─── Vì sao mọi hàm nhận CẢ `tenantId` lẫn `workspaceId` ────────────────────
 *
 * `projects.tenant_id` là dữ liệu lặp (suy ra được qua `workspace_id`) và nó tồn
 * tại có chủ đích — xem ghi chú trong `db/migrations.ts`. Nhờ nó, mọi câu lệnh ở
 * đây thành `WHERE tenant_id = ? AND id = ?`, tức là chạm nhầm tổ chức cho ra
 * "không có dòng nào" thay vì "thiếu một câu if". Nơi gọi thấy 0 dòng thì trả
 * 404, và 404 không tiết lộ rằng id đó có tồn tại.
 *
 * Khoá ngoại GHÉP `(tenant_id, workspace_id) -> workspaces(tenant_id, id)` khiến
 * việc gắn project vào workspace của tổ chức khác là BẤT KHẢ THI ở tầng database,
 * bất kể code phía trên làm gì. Đó là lớp phòng thủ không quên được, nhưng nó chỉ
 * chặn INSERT/UPDATE — câu SELECT vẫn phải tự lọc `tenant_id`.
 */

export interface ListProjectsFilter {
  workspaceId: number;
  search?: string | undefined;
  sort: ProjectSortKey;
  order: 'asc' | 'desc';
}

export type ProjectSortKey = 'name' | 'createdAt' | 'updatedAt';

export const PROJECT_SORT_KEYS: readonly ProjectSortKey[] = ['name', 'createdAt', 'updatedAt'];

/** Chuỗi đi vào `ORDER BY` luôn là hằng số viết tay ở đây, không phải query string. */
const SORT_SQL: Record<ProjectSortKey, string> = {
  name: 'p.name',
  createdAt: 'p.created_at',
  updatedAt: 'p.updated_at',
};

interface ProjectRow extends RowDataPacket {
  id: number;
  workspace_id: number;
  name: string;
  description: string | null;
  created_by: number | null;
  creator_name: string | null;
  created_at: Date;
  updated_at: Date;
}

const SELECT_COLUMNS = `p.id, p.workspace_id, p.name, p.description, p.created_by,
            u.full_name AS creator_name, p.created_at, p.updated_at
       FROM projects p
       LEFT JOIN users u ON u.id = p.created_by`;

function toDto(row: ProjectRow): ProjectDto {
  return {
    id: Number(row.id),
    workspaceId: Number(row.workspace_id),
    name: row.name,
    description: row.description,
    createdBy: row.created_by === null ? null : Number(row.created_by),
    // Người tạo đã bị xoá thì `created_by` thành NULL (ON DELETE SET NULL), nên
    // tên cũng NULL. Giao diện hiển thị "Không rõ" chứ không giấu cả dòng.
    creatorName: row.creator_name,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function listByWorkspace(
  db: Db,
  tenantId: number,
  filter: ListProjectsFilter,
): Promise<ProjectDto[]> {
  const conditions = ['p.tenant_id = ?', 'p.workspace_id = ?', 'p.deleted_at IS NULL'];
  const params: (string | number)[] = [tenantId, filter.workspaceId];

  if (filter.search) {
    conditions.push(`p.name LIKE ? ESCAPE '\\\\'`);
    params.push(`%${escapeLikeTerm(filter.search)}%`);
  }

  const direction = filter.order === 'asc' ? 'ASC' : 'DESC';

  // `, p.id ASC` phá hoà: thiếu nó, các project trùng tên hoặc tạo cùng một
  // mili-giây đảo chỗ giữa hai lần truy vấn.
  const [rows] = await db.query<ProjectRow[]>(
    `SELECT ${SELECT_COLUMNS}
      WHERE ${conditions.join(' AND ')}
      ORDER BY ${SORT_SQL[filter.sort]} ${direction}, p.id ASC`,
    params,
  );
  return rows.map(toDto);
}

export async function findById(db: Db, tenantId: number, id: number): Promise<ProjectDto | null> {
  const [rows] = await db.query<ProjectRow[]>(
    `SELECT ${SELECT_COLUMNS}
      WHERE p.tenant_id = ? AND p.id = ? AND p.deleted_at IS NULL
      LIMIT 1`,
    [tenantId, id],
  );
  const row = rows[0];
  return row ? toDto(row) : null;
}

export interface CreateProjectInput {
  workspaceId: number;
  name: string;
  description: string | null;
  createdBy: number;
}

/**
 * Trả về id vừa tạo. Không tự đọc lại bản ghi ở đây — nơi gọi quyết định có cần
 * đọc hay không, và đọc bằng executor nào.
 *
 * Không có `slug`: project được tham chiếu bằng id trong URL (`/projects/12`),
 * khác workspace vốn cần slug thân thiện. Bảng cũng không có cột đó.
 */
export async function createProject(
  db: Db,
  tenantId: number,
  input: CreateProjectInput,
): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    `INSERT INTO projects (tenant_id, workspace_id, name, description, created_by)
     VALUES (?, ?, ?, ?, ?)`,
    [tenantId, input.workspaceId, input.name, input.description, input.createdBy],
  );
  return result.insertId;
}

export async function updateProject(
  db: Db,
  tenantId: number,
  id: number,
  input: { name: string; description: string | null },
): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    `UPDATE projects SET name = ?, description = ?
      WHERE tenant_id = ? AND id = ? AND deleted_at IS NULL`,
    [input.name, input.description, tenantId, id],
  );
  return result.affectedRows;
}

/**
 * Xoá mềm. Không phải đổi tên như `softDeleteWorkspace`: project không có ràng
 * buộc UNIQUE nào trên tên, nên chẳng có gì cần giải phóng.
 */
export async function softDeleteProject(db: Db, tenantId: number, id: number): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    `UPDATE projects SET deleted_at = CURRENT_TIMESTAMP(3)
      WHERE tenant_id = ? AND id = ? AND deleted_at IS NULL`,
    [tenantId, id],
  );
  return result.affectedRows;
}

/** Project mới đụng tới gần đây nhất — dùng cho trang Home (§4.2). */
export async function listRecent(
  db: Db,
  tenantId: number,
  workspaceId: number,
  limit: number,
): Promise<ProjectDto[]> {
  const [rows] = await db.query<ProjectRow[]>(
    `SELECT ${SELECT_COLUMNS}
      WHERE p.tenant_id = ? AND p.workspace_id = ? AND p.deleted_at IS NULL
      ORDER BY p.updated_at DESC, p.id DESC
      LIMIT ?`,
    [tenantId, workspaceId, limit],
  );
  return rows.map(toDto);
}
