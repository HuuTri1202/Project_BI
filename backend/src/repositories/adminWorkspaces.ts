import type { AdminWorkspaceDto } from '@bi/shared';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import type { Db } from './db';

/**
 * Thao tác workspace của khu quản trị (§3.5).
 *
 * Tách khỏi `repositories/workspaces.ts` vì file đó phục vụ luồng đăng ký và
 * seed — nó chỉ đọc/tạo, và cố ý không có hàm nào sửa hay xoá. Các hàm ở đây
 * cần transaction và cần `Db` truyền vào, nên trộn chung sẽ thành hai quy ước
 * chữ ký trong một file.
 *
 * Giữ nguyên luật của file gốc: `tenantId` luôn đứng ngay sau executor, và mọi
 * câu lệnh đều lọc theo nó.
 */

interface WorkspaceListRow extends RowDataPacket {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  created_at: Date;
  project_count: number;
}

/**
 * Danh sách workspace kèm số project còn sống.
 *
 * `LEFT JOIN ... GROUP BY` chứ không phải đếm từng cái trong vòng lặp: mười
 * workspace là mười vòng đi về database, và đó đúng là kiểu N+1 lặng lẽ trở
 * thành vấn đề khi dữ liệu lớn dần mà không ai để ý.
 *
 * `LEFT` chứ không phải `INNER`: workspace chưa có project nào vẫn phải xuất
 * hiện trong danh sách, với số 0.
 */
export async function listWithProjectCount(
  db: Db,
  tenantId: number,
): Promise<AdminWorkspaceDto[]> {
  const [rows] = await db.query<WorkspaceListRow[]>(
    `SELECT w.id, w.name, w.slug, w.description, w.created_at,
            COUNT(p.id) AS project_count
       FROM workspaces w
       LEFT JOIN projects p
              ON p.workspace_id = w.id
             AND p.tenant_id = w.tenant_id
             AND p.deleted_at IS NULL
      WHERE w.tenant_id = ? AND w.deleted_at IS NULL
      GROUP BY w.id, w.name, w.slug, w.description, w.created_at
      ORDER BY w.name ASC`,
    [tenantId],
  );

  return rows.map((row) => ({
    id: Number(row.id),
    name: row.name,
    slug: row.slug,
    description: row.description,
    projectCount: Number(row.project_count),
    createdAt: row.created_at.toISOString(),
  }));
}

export async function findOne(
  db: Db,
  tenantId: number,
  id: number,
): Promise<AdminWorkspaceDto | null> {
  const [rows] = await db.query<WorkspaceListRow[]>(
    `SELECT w.id, w.name, w.slug, w.description, w.created_at,
            COUNT(p.id) AS project_count
       FROM workspaces w
       LEFT JOIN projects p
              ON p.workspace_id = w.id
             AND p.tenant_id = w.tenant_id
             AND p.deleted_at IS NULL
      WHERE w.tenant_id = ? AND w.id = ? AND w.deleted_at IS NULL
      GROUP BY w.id, w.name, w.slug, w.description, w.created_at
      LIMIT 1`,
    [tenantId, id],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    name: row.name,
    slug: row.slug,
    description: row.description,
    projectCount: Number(row.project_count),
    createdAt: row.created_at.toISOString(),
  };
}

/**
 * Đổi tên và mô tả. CỐ Ý KHÔNG đụng tới `slug`.
 *
 * Slug là định danh trong URL. Đổi tên workspace mà viết lại slug là làm hỏng
 * mọi đường dẫn đã được lưu, chia sẻ, hay đánh dấu — một thao tác nghe vô hại
 * ("sửa lỗi chính tả cái tên") lại phá link của cả nhóm. Muốn đổi slug thì phải
 * là một hành động riêng, có cảnh báo riêng.
 */
export async function renameWorkspace(
  db: Db,
  tenantId: number,
  id: number,
  input: { name: string; description: string | null },
): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    `UPDATE workspaces SET name = ?, description = ?
      WHERE tenant_id = ? AND id = ? AND deleted_at IS NULL`,
    [input.name, input.description, tenantId, id],
  );
  return result.affectedRows;
}

/** Số project còn sống — dùng để chặn xoá workspace không rỗng. */
export async function countLiveProjects(db: Db, tenantId: number, id: number): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM projects
      WHERE tenant_id = ? AND workspace_id = ? AND deleted_at IS NULL`,
    [tenantId, id],
  );
  return Number(rows[0]?.['total'] ?? 0);
}

/**
 * Xoá mềm, ĐỒNG THỜI giải phóng slug.
 *
 * `uq_workspaces_tenant_slug` tính cả những dòng đã xoá mềm, nên nếu chỉ đặt
 * `deleted_at` thì slug cũ bị giữ vĩnh viễn: xoá "Kinh doanh" rồi tạo lại sẽ ra
 * `kinh-doanh-2`, xoá tiếp lại ra `kinh-doanh-3`, không bao giờ về lại được tên
 * sạch. Đổi slug thành `<cũ>-del-<id>` trả lại tên cho lần tạo sau.
 *
 * `LEFT(slug, 80)` vì cột chỉ có 100 ký tự và hậu tố cần chỗ.
 */
export async function softDeleteWorkspace(db: Db, tenantId: number, id: number): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    `UPDATE workspaces
        SET deleted_at = CURRENT_TIMESTAMP(3),
            slug = CONCAT(LEFT(slug, 80), '-del-', id)
      WHERE tenant_id = ? AND id = ? AND deleted_at IS NULL`,
    [tenantId, id],
  );
  return result.affectedRows;
}
