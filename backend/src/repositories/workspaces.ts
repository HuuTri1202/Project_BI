import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { mysqlPool } from '../config/mysql';

export interface Workspace {
  id: number;
  tenantId: number;
  name: string;
  slug: string;
  description: string | null;
  createdBy: number | null;
  createdAt: string;
}

interface WorkspaceRow extends RowDataPacket {
  id: number;
  tenant_id: number;
  name: string;
  slug: string;
  description: string | null;
  created_by: number | null;
  created_at: Date;
}

/*
 * Workspace THUỘC về một tổ chức, nên mọi hàm ở đây BẮT BUỘC nhận `tenantId`
 * làm tham số đầu tiên. Không có hàm nào tra cứu workspace chỉ bằng `id`, kể cả
 * khi id là khoá chính và nghe có vẻ đủ: một endpoint nhận id từ URL rồi tra
 * thẳng như vậy chính là lỗ hổng IDOR — đổi số trên thanh địa chỉ là đọc được
 * workspace của công ty khác.
 *
 * Chữ ký hàm là thứ duy nhất bắt được lỗi này lúc biên dịch, thay vì trông chờ
 * người viết nhớ thêm một câu `if`.
 */

function toWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: Number(row.id),
    tenantId: Number(row.tenant_id),
    name: row.name,
    slug: row.slug,
    description: row.description,
    createdBy: row.created_by === null ? null : Number(row.created_by),
    createdAt: row.created_at.toISOString(),
  };
}

const SELECT_COLUMNS = 'id, tenant_id, name, slug, description, created_by, created_at';

export async function findById(tenantId: number, id: number): Promise<Workspace | null> {
  const [rows] = await mysqlPool.query<WorkspaceRow[]>(
    `SELECT ${SELECT_COLUMNS} FROM workspaces
      WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL LIMIT 1`,
    [id, tenantId],
  );
  const row = rows[0];
  return row ? toWorkspace(row) : null;
}

export async function findBySlug(tenantId: number, slug: string): Promise<Workspace | null> {
  const [rows] = await mysqlPool.query<WorkspaceRow[]>(
    `SELECT ${SELECT_COLUMNS} FROM workspaces
      WHERE slug = ? AND tenant_id = ? AND deleted_at IS NULL LIMIT 1`,
    [slug, tenantId],
  );
  const row = rows[0];
  return row ? toWorkspace(row) : null;
}

export async function listByTenant(tenantId: number): Promise<Workspace[]> {
  const [rows] = await mysqlPool.query<WorkspaceRow[]>(
    `SELECT ${SELECT_COLUMNS} FROM workspaces
      WHERE tenant_id = ? AND deleted_at IS NULL
      ORDER BY name ASC`,
    [tenantId],
  );
  return rows.map(toWorkspace);
}

export interface CreateWorkspaceInput {
  name: string;
  slug: string;
  description?: string | null;
  createdBy?: number | null;
}

export async function createWorkspace(
  tenantId: number,
  input: CreateWorkspaceInput,
): Promise<number> {
  const [result] = await mysqlPool.query<ResultSetHeader>(
    `INSERT INTO workspaces (tenant_id, name, slug, description, created_by)
     VALUES (?, ?, ?, ?, ?)`,
    [tenantId, input.name, input.slug, input.description ?? null, input.createdBy ?? null],
  );
  return result.insertId;
}

export async function countByTenant(tenantId: number): Promise<number> {
  const [rows] = await mysqlPool.query<RowDataPacket[]>(
    'SELECT COUNT(*) AS total FROM workspaces WHERE tenant_id = ? AND deleted_at IS NULL',
    [tenantId],
  );
  return Number(rows[0]?.['total'] ?? 0);
}
