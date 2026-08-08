import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { mysqlPool } from '../config/mysql';
import type { Db } from './db';

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
        AND m.removed_at IS NULL
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
        AND m.removed_at IS NULL
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
 *
 * `removed_at = NULL` trong nhánh UPDATE chính là cơ chế "mời lại người đã bị
 * gỡ": không cần bảng lời mời riêng, không cần xoá dòng cũ rồi chèn dòng mới
 * (làm thế sẽ mất `created_at` — mốc "vào tổ chức từ bao giờ").
 */
export async function upsert(
  db: Db,
  tenantId: number,
  userId: number,
  role: TenantRole,
): Promise<void> {
  await db.query<ResultSetHeader>(
    `INSERT INTO memberships (user_id, tenant_id, role)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE role = VALUES(role), is_active = 1, removed_at = NULL`,
    [userId, tenantId, role],
  );
}

/**
 * Đếm quản trị viên còn hoạt động của một tổ chức, CÓ KHOÁ DÒNG.
 *
 * Dùng để chặn hạ cấp / khoá / gỡ người quản trị CUỐI CÙNG — mất hết admin là
 * tổ chức không còn đường tự khôi phục.
 *
 * Ba điểm không được bỏ:
 *
 * 1. `db` bắt buộc truyền vào và phải là connection ĐANG GIỮ transaction. Đọc
 *    trên pool thì hai admin hạ quyền nhau cùng lúc đều thấy "còn 2", đều thành
 *    công, tổ chức còn 0 admin.
 * 2. `FOR UPDATE` là thứ thật sự chặn race đó: nó khoá các dòng admin cho tới
 *    khi transaction kết thúc, buộc request thứ hai xếp hàng và đọc lại số đã
 *    cập nhật. Một câu `COUNT(*)` thường không khoá gì cả.
 * 3. `SELECT m.id ... FOR UPDATE` rồi đếm trong JS, chứ không `SELECT COUNT(*)
 *    ... FOR UPDATE`: MySQL khoá theo DÒNG được đọc, mà một hàm tổng hợp trả về
 *    đúng một dòng kết quả — khoá đặt lên dòng kết quả tạm đó không bảo vệ được
 *    các dòng membership thật.
 *
 * Lọc thêm `u.is_active` và `u.deleted_at`: một admin đã bị khoá tài khoản
 * không cứu được tổ chức, nên không được tính là còn.
 */
export async function countActiveAdminsForUpdate(db: Db, tenantId: number): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT m.id
       FROM memberships m
       JOIN users u ON u.id = m.user_id
      WHERE m.tenant_id = ?
        AND m.role = 'admin'
        AND m.is_active = 1
        AND m.removed_at IS NULL
        AND u.is_active = 1
        AND u.deleted_at IS NULL
      FOR UPDATE`,
    [tenantId],
  );
  return rows.length;
}

function toMembership(row: MembershipRow): Membership {
  return {
    tenantId: Number(row.tenant_id),
    tenantName: row.tenant_name,
    tenantSlug: row.tenant_slug,
    role: row.role,
  };
}
