import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { mysqlPool } from '../config/mysql';

/**
 * Vai trò trong MỘT tổ chức. Khác hoàn toàn với `PlatformRole` ở users.ts —
 * xem ghi chú hai trục vai trò trong db/migrations.ts.
 */
export type TenantRole = 'admin' | 'creator' | 'viewer';
export const TENANT_ROLES: readonly TenantRole[] = ['admin', 'creator', 'viewer'];

export function isTenantRole(value: unknown): value is TenantRole {
  return typeof value === 'string' && (TENANT_ROLES as readonly string[]).includes(value);
}

/** Một tư cách thành viên, kèm tên tổ chức để frontend hiển thị thẳng. */
export interface Membership {
  tenantId: number;
  tenantName: string;
  tenantSlug: string;
  role: TenantRole;
}

interface MembershipRow extends RowDataPacket {
  tenant_id: number;
  tenant_name: string;
  tenant_slug: string;
  role: TenantRole;
}

/**
 * Mọi tổ chức mà người này còn hoạt động, cũ nhất trước.
 *
 * Thứ tự `m.id ASC` là CÓ CHỦ Ý chứ không phải ngẫu nhiên: lúc đăng nhập ta
 * phải chọn một tổ chức mặc định mà form thì không có ô chọn, nên quy tắc phải
 * ổn định — cùng một tài khoản luôn vào cùng một tổ chức. Sắp theo tên hay theo
 * ngày cập nhật đều khiến tổ chức mặc định tự đổi sau lưng người dùng.
 *
 * Lọc cả `t.deleted_at` và `t.is_active`: tổ chức bị khoá thì tư cách thành
 * viên trong đó cũng không dùng được.
 */
export async function listActiveByUser(userId: number): Promise<Membership[]> {
  const [rows] = await mysqlPool.query<MembershipRow[]>(
    `SELECT m.tenant_id, t.name AS tenant_name, t.slug AS tenant_slug, m.role
       FROM memberships m
       JOIN tenants t ON t.id = m.tenant_id
      WHERE m.user_id = ?
        AND m.is_active = 1
        AND t.is_active = 1
        AND t.deleted_at IS NULL
      ORDER BY m.id ASC`,
    [userId],
  );
  return rows.map(toMembership);
}

/**
 * Tư cách thành viên của một người trong ĐÚNG một tổ chức.
 *
 * Đây là hàm mà middleware xác thực gọi ở mỗi request để biết token còn hợp lệ
 * về mặt quyền hay không: vai trò có thể vừa bị đổi, thành viên có thể vừa bị
 * gỡ khỏi tổ chức sau khi token được cấp.
 */
export async function findByUserAndTenant(
  userId: number,
  tenantId: number,
): Promise<Membership | null> {
  const [rows] = await mysqlPool.query<MembershipRow[]>(
    `SELECT m.tenant_id, t.name AS tenant_name, t.slug AS tenant_slug, m.role
       FROM memberships m
       JOIN tenants t ON t.id = m.tenant_id
      WHERE m.user_id = ?
        AND m.tenant_id = ?
        AND m.is_active = 1
        AND t.is_active = 1
        AND t.deleted_at IS NULL
      LIMIT 1`,
    [userId, tenantId],
  );
  const row = rows[0];
  return row ? toMembership(row) : null;
}

/**
 * Tạo hoặc cập nhật tư cách thành viên.
 *
 * `ON DUPLICATE KEY UPDATE` dựa vào UNIQUE (user_id, tenant_id) nên gọi lại
 * không sinh dòng thứ hai — cần thiết để `seed:admin` chạy lại được nhiều lần.
 */
export async function upsert(userId: number, tenantId: number, role: TenantRole): Promise<void> {
  await mysqlPool.query<ResultSetHeader>(
    `INSERT INTO memberships (user_id, tenant_id, role)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE role = VALUES(role), is_active = 1`,
    [userId, tenantId, role],
  );
}

/**
 * Đếm quản trị viên còn hoạt động của một tổ chức.
 *
 * Dùng để chặn hạ cấp / gỡ người quản trị CUỐI CÙNG — mất hết admin là tổ chức
 * không còn đường tự khôi phục.
 *
 * Lọc thêm `u.is_active` và `u.deleted_at`: một admin đã bị khoá tài khoản
 * không cứu được tổ chức, nên không được tính là còn.
 */
export async function countActiveAdmins(tenantId: number): Promise<number> {
  const [rows] = await mysqlPool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total
       FROM memberships m
       JOIN users u ON u.id = m.user_id
      WHERE m.tenant_id = ?
        AND m.role = 'admin'
        AND m.is_active = 1
        AND u.is_active = 1
        AND u.deleted_at IS NULL`,
    [tenantId],
  );
  return Number(rows[0]?.['total'] ?? 0);
}

function toMembership(row: MembershipRow): Membership {
  return {
    tenantId: Number(row.tenant_id),
    tenantName: row.tenant_name,
    tenantSlug: row.tenant_slug,
    role: row.role,
  };
}
