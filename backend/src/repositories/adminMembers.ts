import type { AdminUserDto, PlatformRole, TenantRole } from '@bi/shared';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { escapeLikeTerm } from '../utils/sql';
import type { Db } from './db';

/**
 * Truy vấn "thành viên CỦA một tổ chức" — phạm vi luôn là đúng một tenant.
 *
 * Phần lọc/sắp xếp/phân trang bên dưới từng bị gỡ khi khu `/admin` chuyển thành
 * console vận hành toàn hệ thống (`repositories/platform.ts`). Section 04 dựng
 * khu quản trị cho admin của TỪNG công ty nên nó quay lại, gần như nguyên vẹn từ
 * commit `ab71c0f`.
 *
 * ─── Hai luật của file này, không có ngoại lệ ────────────────────────────────
 *
 * 1. Chữ ký luôn là `(db, tenantId, ...)`. `db` để câu lệnh chạy đúng trong
 *    transaction của caller (xem `repositories/db.ts`); `tenantId` đứng ngay sau
 *    để việc quên phạm vi tổ chức là lỗi BIÊN DỊCH, không phải lỗ hổng dữ liệu.
 *
 * 2. Mọi câu lệnh đều có `m.tenant_id = ?`, kể cả khi đã biết `userId`. `userId`
 *    là định danh TOÀN CỤC — không kèm điều kiện tổ chức thì admin công ty A
 *    sửa được thành viên công ty B chỉ bằng cách đoán id. Hệ quả phụ mà ta muốn:
 *    id của tổ chức khác cho ra 0 dòng, nên nơi gọi trả 404. Trả 403 sẽ xác nhận
 *    rằng id đó có tồn tại — 404 thì không tiết lộ gì.
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

// ─── Danh sách thành viên (§4.7) ─────────────────────────────────────────────

export type MemberSortKey = 'fullName' | 'email' | 'role' | 'joinedAt' | 'lastLoginAt';

export const MEMBER_SORT_KEYS: readonly MemberSortKey[] = [
  'fullName',
  'email',
  'role',
  'joinedAt',
  'lastLoginAt',
];

/**
 * Ánh xạ khoá API sang tên cột SQL.
 *
 * Chỉ những giá trị đã qua `resolveSortColumn` mới tới được đây, nên map này là
 * chốt chặn thứ hai: kể cả khi ai đó nới whitelist, chuỗi đi vào `ORDER BY` vẫn
 * là hằng số viết tay trong file này, không phải dữ liệu từ query string.
 */
const SORT_SQL: Record<MemberSortKey, string> = {
  fullName: 'u.full_name',
  email: 'u.email',
  role: 'm.role',
  joinedAt: 'm.created_at',
  lastLoginAt: 'u.last_login_at',
};

export interface ListMembersFilter {
  /** Tìm trong họ tên và email. */
  search?: string | undefined;
  role?: TenantRole | undefined;
  /** Mặc định (undefined) = đang hoạt động + bị khoá, ẩn người đã gỡ. */
  status?: 'active' | 'locked' | 'removed' | undefined;
  sort: MemberSortKey;
  order: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

interface MemberRow extends RowDataPacket {
  user_id: number;
  email: string;
  full_name: string;
  job_title: string | null;
  role: TenantRole;
  member_active: number;
  user_active: number;
  removed_at: Date | null;
  must_change_password: number;
  last_login_at: Date | null;
  joined_at: Date;
}

/** Dựng mệnh đề WHERE dùng chung cho cả câu đếm lẫn câu lấy dữ liệu. */
function buildWhere(
  tenantId: number,
  filter: ListMembersFilter,
): { sql: string; params: (string | number)[] } {
  const conditions = ['m.tenant_id = ?', 'u.deleted_at IS NULL'];
  const params: (string | number)[] = [tenantId];

  if (filter.status === 'removed') {
    conditions.push('m.removed_at IS NOT NULL');
  } else {
    conditions.push('m.removed_at IS NULL');
    if (filter.status === 'active') conditions.push('m.is_active = 1');
    if (filter.status === 'locked') conditions.push('m.is_active = 0');
  }

  if (filter.role) {
    conditions.push('m.role = ?');
    params.push(filter.role);
  }

  if (filter.search) {
    const like = `%${escapeLikeTerm(filter.search)}%`;
    conditions.push(`(u.full_name LIKE ? ESCAPE '\\\\' OR u.email LIKE ? ESCAPE '\\\\')`);
    params.push(like, like);
  }

  return { sql: conditions.join(' AND '), params };
}

export async function countMembers(
  db: Db,
  tenantId: number,
  filter: ListMembersFilter,
): Promise<number> {
  const where = buildWhere(tenantId, filter);
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total
       FROM memberships m
       JOIN users u ON u.id = m.user_id
      WHERE ${where.sql}`,
    where.params,
  );
  return Number(rows[0]?.['total'] ?? 0);
}

export async function listMembers(
  db: Db,
  tenantId: number,
  filter: ListMembersFilter,
): Promise<AdminUserDto[]> {
  const where = buildWhere(tenantId, filter);
  const orderBy = SORT_SQL[filter.sort];
  const direction = filter.order === 'asc' ? 'ASC' : 'DESC';
  const offset = (filter.page - 1) * filter.pageSize;

  // `, u.id ASC` KHÔNG phải trang trí. Thiếu tiêu chí phá hoà, các dòng trùng
  // giá trị sắp xếp (rất hay gặp với `role`, và `last_login_at` NULL) đảo chỗ
  // giữa hai lần truy vấn — một bản ghi hiện hai lần ở hai trang, một bản ghi
  // khác không bao giờ hiện. Đây là lỗi phân trang phổ biến nhất.
  //
  // `LIMIT ?` chạy được vì schema dùng `z.coerce.number()`: mysql2 escape số
  // thành số, nhưng escape chuỗi '20' thành `'20'` và gây lỗi cú pháp. Ai tự
  // dựng tham số bằng tay cho hàm này phải nhớ điều đó.
  const [rows] = await db.query<MemberRow[]>(
    `SELECT u.id AS user_id, u.email, u.full_name, u.job_title,
            u.is_active AS user_active, u.must_change_password, u.last_login_at,
            m.role, m.is_active AS member_active, m.removed_at,
            m.created_at AS joined_at
       FROM memberships m
       JOIN users u ON u.id = m.user_id
      WHERE ${where.sql}
      ORDER BY ${orderBy} ${direction}, u.id ASC
      LIMIT ? OFFSET ?`,
    [...where.params, filter.pageSize, offset],
  );

  return rows.map(toAdminUser);
}

/** Một thành viên, dùng sau khi tạo/sửa để trả về trạng thái mới nhất. */
export async function findMember(
  db: Db,
  tenantId: number,
  userId: number,
): Promise<AdminUserDto | null> {
  const [rows] = await db.query<MemberRow[]>(
    `SELECT u.id AS user_id, u.email, u.full_name, u.job_title,
            u.is_active AS user_active, u.must_change_password, u.last_login_at,
            m.role, m.is_active AS member_active, m.removed_at,
            m.created_at AS joined_at
       FROM memberships m
       JOIN users u ON u.id = m.user_id
      WHERE m.tenant_id = ? AND m.user_id = ? AND u.deleted_at IS NULL
      LIMIT 1`,
    [tenantId, userId],
  );
  const row = rows[0];
  return row ? toAdminUser(row) : null;
}

// ─── Thao tác ghi (§4.7) ─────────────────────────────────────────────────────

/**
 * Khoá dòng membership để đọc trạng thái hiện tại trước khi sửa.
 *
 * `FOR UPDATE` giữ dòng tới hết transaction, nên hai admin thao tác lên cùng một
 * người sẽ xếp hàng thay vì cùng đọc trạng thái cũ rồi cùng ghi đè.
 */
export async function lockMemberForUpdate(
  db: Db,
  tenantId: number,
  userId: number,
): Promise<{ role: TenantRole; isActive: boolean; removed: boolean } | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT role, is_active, removed_at
       FROM memberships
      WHERE tenant_id = ? AND user_id = ?
      LIMIT 1
      FOR UPDATE`,
    [tenantId, userId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    role: row['role'] as TenantRole,
    isActive: row['is_active'] === 1,
    removed: row['removed_at'] !== null,
  };
}

export async function updateMemberRole(
  db: Db,
  tenantId: number,
  userId: number,
  role: TenantRole,
): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    `UPDATE memberships SET role = ?
      WHERE tenant_id = ? AND user_id = ? AND removed_at IS NULL`,
    [role, tenantId, userId],
  );
  return result.affectedRows;
}

export async function updateMemberActive(
  db: Db,
  tenantId: number,
  userId: number,
  isActive: boolean,
): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    `UPDATE memberships SET is_active = ?
      WHERE tenant_id = ? AND user_id = ? AND removed_at IS NULL`,
    [isActive ? 1 : 0, tenantId, userId],
  );
  return result.affectedRows;
}

/**
 * Gỡ khỏi tổ chức — xoá MỀM, và chỉ trong phạm vi tổ chức này.
 *
 * Bản ghi `users` không đụng tới: email là định danh toàn cục, người này có thể
 * đang làm ở tổ chức khác. Admin của một tổ chức không được phép phá huỷ một
 * danh tính dùng chung.
 */
export async function removeMember(db: Db, tenantId: number, userId: number): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    `UPDATE memberships
        SET removed_at = CURRENT_TIMESTAMP(3), is_active = 0
      WHERE tenant_id = ? AND user_id = ? AND removed_at IS NULL`,
    [tenantId, userId],
  );
  return result.affectedRows;
}

function toAdminUser(row: MemberRow): AdminUserDto {
  return {
    userId: Number(row.user_id),
    email: row.email,
    fullName: row.full_name,
    jobTitle: row.job_title,
    role: row.role,
    memberActive: row.member_active === 1,
    userActive: row.user_active === 1,
    removedAt: row.removed_at ? row.removed_at.toISOString() : null,
    mustChangePassword: row.must_change_password === 1,
    lastLoginAt: row.last_login_at ? row.last_login_at.toISOString() : null,
    joinedAt: row.joined_at.toISOString(),
  };
}
