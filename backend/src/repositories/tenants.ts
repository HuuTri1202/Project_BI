import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { mysqlPool } from '../config/mysql';

export interface Tenant {
  id: number;
  name: string;
  slug: string;
}

interface TenantRow extends RowDataPacket {
  id: number;
  name: string;
  slug: string;
}

export async function findTenantById(tenantId: number): Promise<Tenant | null> {
  const [rows] = await mysqlPool.query<TenantRow[]>(
    'SELECT id, name, slug FROM tenants WHERE id = ? LIMIT 1',
    [tenantId],
  );
  const row = rows[0];
  return row ? { id: Number(row.id), name: row.name, slug: row.slug } : null;
}

export async function findTenantBySlug(slug: string): Promise<Tenant | null> {
  const [rows] = await mysqlPool.query<TenantRow[]>(
    'SELECT id, name, slug FROM tenants WHERE slug = ? LIMIT 1',
    [slug],
  );
  const row = rows[0];
  return row ? { id: Number(row.id), name: row.name, slug: row.slug } : null;
}

/**
 * Đổi tên tổ chức — §6.2 "Admin sửa thông tin Company".
 *
 * `slug` KHÔNG đổi theo, cố ý và giống hệt luật của workspace: slug là định danh
 * đã đi vào đường dẫn, vào tài liệu người ta lưu lại, và có thể vào cả cấu hình
 * bên ngoài. Đổi tên hiển thị là chuyện thẩm mỹ; đổi định danh là phá liên kết
 * của người khác. Muốn đổi slug thì phải là một thao tác riêng, nói rõ hậu quả.
 *
 * `AND deleted_at IS NULL` để tổ chức đã xoá mềm không hồi sinh qua đường này.
 * Trả về số dòng đổi để caller phân biệt "không tìm thấy" với "đã ghi".
 */
export async function renameTenant(tenantId: number, name: string): Promise<number> {
  const [result] = await mysqlPool.query<ResultSetHeader>(
    'UPDATE tenants SET name = ? WHERE id = ? AND deleted_at IS NULL',
    [name, tenantId],
  );
  return result.affectedRows;
}

export async function createTenant(name: string, slug: string): Promise<number> {
  const [result] = await mysqlPool.query<ResultSetHeader>(
    'INSERT INTO tenants (name, slug) VALUES (?, ?)',
    [name, slug],
  );
  return result.insertId;
}
