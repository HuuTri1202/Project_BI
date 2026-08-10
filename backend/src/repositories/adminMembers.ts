import type { PlatformRole, TenantRole } from '@bi/shared';
import type { RowDataPacket } from 'mysql2';
import type { Db } from './db';

/**
 * Đọc quyền THẬT của người gọi từ database, dùng cho `requireFreshAdmin`.
 *
 * File này từng chứa cả bộ truy vấn quản lý thành viên trong PHẠM VI MỘT TỔ
 * CHỨC. Khu quản trị đã chuyển thành console vận hành toàn hệ thống (xem
 * `repositories/platform.ts`), nên phần đó bị gỡ — code không có người gọi thì
 * không ai chạy, không ai test, và sẽ lệch dần khỏi schema mà không ai biết.
 *
 * Khi nào dựng khu quản trị dành cho admin của từng công ty, lấy lại từ lịch sử
 * git (commit `ab71c0f`) là có sẵn cả phần lọc, sắp xếp và phân trang đã viết.
 */

export interface AdminContext {
  /** `memberships.role` — quyền trong tổ chức đang mở. */
  role: TenantRole;
  /** `users.role` — trục NỀN TẢNG, thứ quyết định ai vào được console. */
  platformRole: PlatformRole;
  memberActive: boolean;
  userActive: boolean;
}

interface AdminContextRow extends RowDataPacket {
  role: TenantRole;
  platform_role: PlatformRole;
  member_active: number;
  user_active: number;
}

/**
 * Vì sao không dùng `memberships.findByUserAndTenant` có sẵn: hàm đó lọc
 * `m.is_active`, `t.is_active`, `t.deleted_at` nhưng KHÔNG lọc `u.is_active` và
 * `u.deleted_at`, và cũng không trả về `users.role`. Một tài khoản đã bị khoá
 * toàn hệ thống sẽ lọt qua nó.
 *
 * Một round trip, cả ba lần tra đều đi theo index (`uq_memberships_user_tenant`
 * rồi hai lần khoá chính).
 */
export async function findAdminContext(
  db: Db,
  tenantId: number,
  userId: number,
): Promise<AdminContext | null> {
  const [rows] = await db.query<AdminContextRow[]>(
    `SELECT m.role, u.role AS platform_role,
            m.is_active AS member_active, u.is_active AS user_active
       FROM memberships m
       JOIN users   u ON u.id = m.user_id   AND u.deleted_at IS NULL
       JOIN tenants t ON t.id = m.tenant_id AND t.deleted_at IS NULL AND t.is_active = 1
      WHERE m.tenant_id = ?
        AND m.user_id = ?
        AND m.is_active = 1
        AND m.removed_at IS NULL
      LIMIT 1`,
    [tenantId, userId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    role: row.role,
    platformRole: row.platform_role,
    memberActive: row.member_active === 1,
    userActive: row.user_active === 1,
  };
}
