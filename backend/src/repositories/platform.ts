import type {
  GrowthPoint,
  PlatformRole,
  PlatformTenantDto,
  PlatformTenantMemberDto,
  PlatformUserDto,
  PlatformWorkspaceDto,
  TenantRole,
} from '@bi/shared';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { escapeLikeTerm } from '../utils/sql';
import type { Db } from './db';

/**
 * Truy vấn của CONSOLE HỆ THỐNG — nhìn xuyên mọi tổ chức.
 *
 * ─── Vì sao file này KHÔNG nhận `tenantId` ───────────────────────────────────
 *
 * Đây là chỗ phá vỡ có chủ ý luật "mọi hàm nhận tenantId đầu tiên" của
 * `repositories/workspaces.ts` và `adminMembers.ts`. Luật đó tồn tại để chống
 * IDOR giữa các tổ chức; ở đây người gọi ĐÃ là `superadmin` và mục đích chính là
 * nhìn toàn hệ thống, nên ràng buộc kia không áp dụng.
 *
 * Vì mất đi lớp bảo vệ ở chữ ký hàm, phần bảo vệ dồn hết về một chỗ:
 * `requirePlatformRole('superadmin')` + `requireFreshAdmin` gắn ở router. Tên
 * file là `platform.ts` để ai đọc cũng thấy ngay ranh giới đó — đừng import nó
 * vào bất kỳ route nào không phải console hệ thống.
 */

// ─── Tổng quan ───────────────────────────────────────────────────────────────

interface OverviewRow extends RowDataPacket {
  active_tenants: number | null;
  locked_tenants: number | null;
  total_users: number | null;
  locked_users: number | null;
  total_workspaces: number | null;
}

/**
 * Năm con số của trang tổng quan, trong MỘT câu.
 *
 * Ba bảng độc lập nên không JOIN được — dùng ba truy vấn con vô hướng, mỗi cái
 * là một lần quét index. Vẫn tốt hơn `Promise.all` ba câu riêng: pool chỉ có 10
 * connection và đây là trang mọi superadmin mở đầu tiên.
 *
 * `owner_user_id IS NULL` ở hai con số tenant: chỉ đếm CÔNG TY THẬT. Không lọc
 * thì "Tổ chức" bám sát "Người dùng" — mỗi tài khoản được cấp kèm một không gian
 * riêng — và thẻ KPI mất hết ý nghĩa: nó không còn trả lời được "nền tảng đang
 * phục vụ bao nhiêu doanh nghiệp".
 */
export async function fetchOverviewCounts(db: Db): Promise<{
  activeTenants: number;
  lockedTenants: number;
  totalUsers: number;
  lockedUsers: number;
  totalWorkspaces: number;
}> {
  const [rows] = await db.query<OverviewRow[]>(
    `SELECT
       (SELECT COUNT(*) FROM tenants
         WHERE deleted_at IS NULL AND is_active = 1 AND owner_user_id IS NULL)      AS active_tenants,
       (SELECT COUNT(*) FROM tenants
         WHERE deleted_at IS NULL AND is_active = 0 AND owner_user_id IS NULL)      AS locked_tenants,
       (SELECT COUNT(*) FROM users      WHERE deleted_at IS NULL)                   AS total_users,
       (SELECT COUNT(*) FROM users      WHERE deleted_at IS NULL AND is_active = 0) AS locked_users,
       (SELECT COUNT(*) FROM workspaces WHERE deleted_at IS NULL)                   AS total_workspaces`,
  );
  const row = rows[0];
  return {
    activeTenants: Number(row?.active_tenants ?? 0),
    lockedTenants: Number(row?.locked_tenants ?? 0),
    totalUsers: Number(row?.total_users ?? 0),
    lockedUsers: Number(row?.locked_users ?? 0),
    totalWorkspaces: Number(row?.total_workspaces ?? 0),
  };
}

interface GrowthRow extends RowDataPacket {
  d: string;
  kind: string;
  c: number;
}

/**
 * Tăng trưởng theo ngày của cả ba loại, trong MỘT câu bằng UNION ALL.
 *
 * Ba `SELECT ... GROUP BY DATE(created_at)` gộp lại rồi phân loại bằng cột
 * `kind`, thay vì ba vòng đi về database. `DATE()` chạy theo session time_zone
 * mà `config/mysql.ts` ghim `+00:00`, nên đây là ngày UTC.
 *
 * Đường "Tổ chức" chỉ đếm công ty thật (`owner_user_id IS NULL`), cùng lý do với
 * thẻ KPI ở trên: không lọc thì nó chồng lên đường "Người dùng" và biểu đồ không
 * còn nói được điều gì.
 */
export async function fetchGrowth(db: Db, rangeDays: number): Promise<GrowthPoint[]> {
  const since = new Date(Date.now() - rangeDays * 86_400_000);

  const [rows] = await db.query<GrowthRow[]>(
    `SELECT DATE(created_at) AS d, 'tenant' AS kind, COUNT(*) AS c
       FROM tenants    WHERE created_at >= ? AND deleted_at IS NULL
                         AND owner_user_id IS NULL GROUP BY d
     UNION ALL
     SELECT DATE(created_at) AS d, 'user' AS kind, COUNT(*) AS c
       FROM users      WHERE created_at >= ? AND deleted_at IS NULL GROUP BY d
     UNION ALL
     SELECT DATE(created_at) AS d, 'workspace' AS kind, COUNT(*) AS c
       FROM workspaces WHERE created_at >= ? AND deleted_at IS NULL GROUP BY d`,
    [since, since, since],
  );

  const byDate = new Map<string, GrowthPoint>();
  for (const row of rows) {
    const date = String(row.d);
    const point = byDate.get(date) ?? { date, tenants: 0, users: 0, workspaces: 0 };
    if (row.kind === 'tenant') point.tenants = Number(row.c);
    if (row.kind === 'user') point.users = Number(row.c);
    if (row.kind === 'workspace') point.workspaces = Number(row.c);
    byDate.set(date, point);
  }

  // Lấp ngày trống bằng 0. Không lấp thì biểu đồ đường nối thẳng qua khoảng
  // trống, khiến "hai tuần không ai đăng ký" trông giống "tăng đều".
  const points: GrowthPoint[] = [];
  const today = Date.now();
  for (let i = rangeDays - 1; i >= 0; i--) {
    const date = new Date(today - i * 86_400_000).toISOString().slice(0, 10);
    points.push(byDate.get(date) ?? { date, tenants: 0, users: 0, workspaces: 0 });
  }
  return points;
}

// ─── Tenant ──────────────────────────────────────────────────────────────────

export type TenantSortKey = 'name' | 'userCount' | 'workspaceCount' | 'createdAt';
export const TENANT_SORT_KEYS: readonly TenantSortKey[] = [
  'name',
  'userCount',
  'workspaceCount',
  'createdAt',
];

const TENANT_SORT_SQL: Record<TenantSortKey, string> = {
  name: 't.name',
  userCount: 'user_count',
  workspaceCount: 'workspace_count',
  createdAt: 't.created_at',
};

/**
 * Loại tổ chức muốn xem.
 *
 * `org` — công ty thật. `personal` — không gian riêng cấp tự động cho từng tài
 * khoản. `all` — cả hai.
 */
export type TenantKindFilter = 'org' | 'personal' | 'all';

export interface TenantFilter {
  search?: string | undefined;
  status?: 'active' | 'locked' | undefined;
  /** Bỏ trống = `org`. Xem ghi chú trong `tenantWhere`. */
  kind?: TenantKindFilter | undefined;
  sort: TenantSortKey;
  order: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

function tenantWhere(filter: TenantFilter): { sql: string; params: (string | number)[] } {
  const conditions = ['t.deleted_at IS NULL'];
  const params: (string | number)[] = [];

  // MẶC ĐỊNH là `org`, không phải `all`. Mỗi tài khoản được cấp kèm một tổ chức
  // cá nhân, nên `all` nghĩa là danh sách công ty bị chôn dưới một dòng cho mỗi
  // người dùng ngay khi nền tảng có vài chục người. Muốn thấy chúng thì phải hỏi
  // đúng — bộ lọc trên giao diện có sẵn lựa chọn đó.
  if (filter.kind === 'personal') conditions.push('t.owner_user_id IS NOT NULL');
  else if (filter.kind !== 'all') conditions.push('t.owner_user_id IS NULL');

  if (filter.status === 'active') conditions.push('t.is_active = 1');
  if (filter.status === 'locked') conditions.push('t.is_active = 0');

  if (filter.search) {
    const like = `%${escapeLikeTerm(filter.search)}%`;
    conditions.push(`(t.name LIKE ? ESCAPE '\\\\' OR t.slug LIKE ? ESCAPE '\\\\')`);
    params.push(like, like);
  }
  return { sql: conditions.join(' AND '), params };
}

interface TenantRow extends RowDataPacket {
  id: number;
  name: string;
  slug: string;
  is_active: number;
  owner_user_id: number | null;
  user_count: number;
  workspace_count: number;
  created_at: Date;
}

const TENANT_SELECT = `
  SELECT t.id, t.name, t.slug, t.is_active, t.owner_user_id, t.created_at,
         -- JOIN sang users, không chỉ đếm memberships: xoá mềm một tài khoản
         -- đặt users.deleted_at chứ KHÔNG đụng vào các dòng membership của
         -- họ. Đếm thiếu vế này thì cột "Người dùng" ở bảng tổ chức vẫn tính cả
         -- người đã xoá, trong khi màn hình chi tiết (có join) lại không — hai
         -- con số lệch nhau ngay trong cùng một trang.
         (SELECT COUNT(*) FROM memberships m
             JOIN users mu ON mu.id = m.user_id AND mu.deleted_at IS NULL
           WHERE m.tenant_id = t.id AND m.removed_at IS NULL)        AS user_count,
         (SELECT COUNT(*) FROM workspaces w
           WHERE w.tenant_id = t.id AND w.deleted_at IS NULL)        AS workspace_count
    FROM tenants t`;

function toTenant(row: TenantRow): PlatformTenantDto {
  return {
    id: Number(row.id),
    name: row.name,
    slug: row.slug,
    isActive: row.is_active === 1,
    isPersonal: row.owner_user_id !== null,
    userCount: Number(row.user_count),
    workspaceCount: Number(row.workspace_count),
    createdAt: row.created_at.toISOString(),
  };
}

export async function countTenants(db: Db, filter: TenantFilter): Promise<number> {
  const where = tenantWhere(filter);
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM tenants t WHERE ${where.sql}`,
    where.params,
  );
  return Number(rows[0]?.['total'] ?? 0);
}

export async function listTenants(db: Db, filter: TenantFilter): Promise<PlatformTenantDto[]> {
  const where = tenantWhere(filter);
  const direction = filter.order === 'asc' ? 'ASC' : 'DESC';
  const [rows] = await db.query<TenantRow[]>(
    // `, t.id ASC` là tiêu chí phá hoà: thiếu nó, các dòng trùng giá trị sắp xếp
    // đảo chỗ giữa hai lần truy vấn và một bản ghi hiện hai lần ở hai trang.
    `${TENANT_SELECT}
      WHERE ${where.sql}
      ORDER BY ${TENANT_SORT_SQL[filter.sort]} ${direction}, t.id ASC
      LIMIT ? OFFSET ?`,
    [...where.params, filter.pageSize, (filter.page - 1) * filter.pageSize],
  );
  return rows.map(toTenant);
}

export async function findTenant(db: Db, id: number): Promise<PlatformTenantDto | null> {
  const [rows] = await db.query<TenantRow[]>(
    `${TENANT_SELECT} WHERE t.id = ? AND t.deleted_at IS NULL LIMIT 1`,
    [id],
  );
  const row = rows[0];
  return row ? toTenant(row) : null;
}

interface MemberRow extends RowDataPacket {
  user_id: number;
  email: string;
  full_name: string;
  role: TenantRole;
  member_active: number;
  user_active: number;
  joined_at: Date;
}

export async function listTenantMembers(
  db: Db,
  tenantId: number,
): Promise<PlatformTenantMemberDto[]> {
  const [rows] = await db.query<MemberRow[]>(
    `SELECT u.id AS user_id, u.email, u.full_name, m.role,
            m.is_active AS member_active, u.is_active AS user_active,
            m.created_at AS joined_at
       FROM memberships m
       JOIN users u ON u.id = m.user_id AND u.deleted_at IS NULL
      WHERE m.tenant_id = ? AND m.removed_at IS NULL
      ORDER BY m.role ASC, u.full_name ASC, u.id ASC`,
    [tenantId],
  );
  return rows.map((row) => ({
    userId: Number(row.user_id),
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    memberActive: row.member_active === 1,
    userActive: row.user_active === 1,
    joinedAt: row.joined_at.toISOString(),
  }));
}

export async function setTenantActive(db: Db, id: number, isActive: boolean): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    'UPDATE tenants SET is_active = ? WHERE id = ? AND deleted_at IS NULL',
    [isActive ? 1 : 0, id],
  );
  return result.affectedRows;
}

/**
 * Xoá mềm tổ chức, đồng thời giải phóng slug.
 *
 * `uq_tenants_slug` là UNIQUE toàn cục và tính cả dòng đã xoá mềm, nên nếu chỉ
 * đặt `deleted_at` thì tên đường dẫn cũ bị giữ vĩnh viễn — lập lại công ty cùng
 * tên sẽ mãi mang hậu tố `-2`, `-3`.
 */
export async function softDeleteTenant(db: Db, id: number): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    `UPDATE tenants
        SET deleted_at = CURRENT_TIMESTAMP(3),
            is_active = 0,
            slug = CONCAT(LEFT(slug, 80), '-del-', id)
      WHERE id = ? AND deleted_at IS NULL`,
    [id],
  );
  return result.affectedRows;
}

// ─── User toàn hệ thống ──────────────────────────────────────────────────────

export type UserSortKey = 'fullName' | 'email' | 'createdAt' | 'lastLoginAt';
export const USER_SORT_KEYS: readonly UserSortKey[] = [
  'fullName',
  'email',
  'createdAt',
  'lastLoginAt',
];

const USER_SORT_SQL: Record<UserSortKey, string> = {
  fullName: 'u.full_name',
  email: 'u.email',
  createdAt: 'u.created_at',
  lastLoginAt: 'u.last_login_at',
};

export interface UserFilter {
  search?: string | undefined;
  /** Lọc theo tổ chức: chỉ lấy người còn là thành viên của tổ chức này. */
  tenantId?: number | undefined;
  status?: 'active' | 'locked' | undefined;
  platformRole?: PlatformRole | undefined;
  sort: UserSortKey;
  order: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

function userWhere(filter: UserFilter): { sql: string; params: (string | number)[] } {
  const conditions = ['u.deleted_at IS NULL'];
  const params: (string | number)[] = [];

  if (filter.status === 'active') conditions.push('u.is_active = 1');
  if (filter.status === 'locked') conditions.push('u.is_active = 0');
  if (filter.platformRole) {
    conditions.push('u.role = ?');
    params.push(filter.platformRole);
  }
  if (filter.search) {
    const like = `%${escapeLikeTerm(filter.search)}%`;
    conditions.push(`(u.full_name LIKE ? ESCAPE '\\\\' OR u.email LIKE ? ESCAPE '\\\\')`);
    params.push(like, like);
  }
  if (filter.tenantId !== undefined) {
    // EXISTS thay vì JOIN: một người thuộc nhiều tổ chức sẽ ra nhiều dòng nếu
    // JOIN, và khi đó LIMIT/OFFSET đếm sai — trang 2 bỏ sót người.
    conditions.push(
      `EXISTS (SELECT 1 FROM memberships m
                WHERE m.user_id = u.id AND m.tenant_id = ? AND m.removed_at IS NULL)`,
    );
    params.push(filter.tenantId);
  }
  return { sql: conditions.join(' AND '), params };
}

interface PlatformUserRow extends RowDataPacket {
  id: number;
  email: string;
  full_name: string;
  job_title: string | null;
  role: PlatformRole;
  is_active: number;
  must_change_password: number;
  last_login_at: Date | null;
  created_at: Date;
}

export async function countUsers(db: Db, filter: UserFilter): Promise<number> {
  const where = userWhere(filter);
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM users u WHERE ${where.sql}`,
    where.params,
  );
  return Number(rows[0]?.['total'] ?? 0);
}

interface UserTenantRow extends RowDataPacket {
  user_id: number;
  tenant_id: number;
  tenant_name: string;
  role: TenantRole;
}

export async function listUsers(db: Db, filter: UserFilter): Promise<PlatformUserDto[]> {
  const where = userWhere(filter);
  const direction = filter.order === 'asc' ? 'ASC' : 'DESC';

  const [rows] = await db.query<PlatformUserRow[]>(
    `SELECT u.id, u.email, u.full_name, u.job_title, u.role,
            u.is_active, u.must_change_password, u.last_login_at, u.created_at
       FROM users u
      WHERE ${where.sql}
      ORDER BY ${USER_SORT_SQL[filter.sort]} ${direction}, u.id ASC
      LIMIT ? OFFSET ?`,
    [...where.params, filter.pageSize, (filter.page - 1) * filter.pageSize],
  );

  if (rows.length === 0) return [];

  // Nạp tổ chức của cả trang trong MỘT câu, thay vì mỗi người một truy vấn.
  // Hai mươi dòng là hai mươi vòng đi về nếu làm kiểu N+1.
  const ids = rows.map((row) => Number(row.id));
  const [tenantRows] = await db.query<UserTenantRow[]>(
    `SELECT m.user_id, m.tenant_id, t.name AS tenant_name, m.role
       FROM memberships m
       JOIN tenants t ON t.id = m.tenant_id AND t.deleted_at IS NULL
      WHERE m.user_id IN (${ids.map(() => '?').join(',')}) AND m.removed_at IS NULL
      ORDER BY t.name ASC`,
    ids,
  );

  const byUser = new Map<number, { id: number; name: string; role: TenantRole }[]>();
  for (const row of tenantRows) {
    const list = byUser.get(Number(row.user_id)) ?? [];
    list.push({ id: Number(row.tenant_id), name: row.tenant_name, role: row.role });
    byUser.set(Number(row.user_id), list);
  }

  return rows.map((row) => ({
    id: Number(row.id),
    email: row.email,
    fullName: row.full_name,
    jobTitle: row.job_title,
    platformRole: row.role,
    isActive: row.is_active === 1,
    mustChangePassword: row.must_change_password === 1,
    lastLoginAt: row.last_login_at ? row.last_login_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    tenants: byUser.get(Number(row.id)) ?? [],
  }));
}

export async function setUserActive(db: Db, id: number, isActive: boolean): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    'UPDATE users SET is_active = ? WHERE id = ? AND deleted_at IS NULL',
    [isActive ? 1 : 0, id],
  );
  return result.affectedRows;
}

/**
 * Xoá mềm tài khoản, phạm vi TOÀN HỆ THỐNG.
 *
 * Người này biến mất khỏi mọi tổ chức và không đăng nhập được nữa.
 *
 * Email KHÔNG được giải phóng: `uq_users_email` vẫn giữ chỗ. Đó là chủ ý — email
 * là định danh, và cho phép đăng ký lại bằng email của một tài khoản đã xoá sẽ
 * khiến người mới thừa hưởng mọi dấu vết của người cũ (`created_by` trên
 * workspace chẳng hạn). Muốn dùng lại email thì phải khôi phục tài khoản cũ.
 */
export async function softDeleteUser(db: Db, id: number): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    `UPDATE users SET deleted_at = CURRENT_TIMESTAMP(3), is_active = 0
      WHERE id = ? AND deleted_at IS NULL`,
    [id],
  );
  return result.affectedRows;
}

/**
 * Đọc và KHOÁ một tài khoản để sửa.
 *
 * `FOR UPDATE` giữ dòng tới hết transaction, nên hai superadmin thao tác lên
 * cùng một người sẽ xếp hàng thay vì cùng đọc trạng thái cũ rồi cùng ghi đè.
 */
export async function findUserForUpdate(
  db: Db,
  id: number,
): Promise<{ platformRole: PlatformRole; isActive: boolean } | null> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT role, is_active FROM users
      WHERE id = ? AND deleted_at IS NULL
      LIMIT 1
      FOR UPDATE`,
    [id],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    platformRole: row['role'] as PlatformRole,
    isActive: row['is_active'] === 1,
  };
}

/**
 * Đếm quản trị viên hệ thống còn hoạt động, CÓ KHOÁ DÒNG.
 *
 * `SELECT id ... FOR UPDATE` rồi đếm trong JS, chứ không `SELECT COUNT(*)`:
 * MySQL khoá theo DÒNG được đọc, mà hàm tổng hợp chỉ trả đúng một dòng kết quả
 * tạm — khoá đặt lên dòng đó không bảo vệ được các bản ghi thật.
 */
export async function countActiveSuperadmins(db: Db): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id FROM users
      WHERE role = 'superadmin' AND is_active = 1 AND deleted_at IS NULL
      FOR UPDATE`,
  );
  return rows.length;
}

// ─── Workspace toàn hệ thống ─────────────────────────────────────────────────

interface PlatformWorkspaceRow extends RowDataPacket {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  is_active: number;
  tenant_id: number;
  tenant_name: string;
  report_count: number;
  created_at: Date;
}

export interface WorkspaceFilter {
  search?: string | undefined;
  tenantId?: number | undefined;
  status?: 'active' | 'locked' | undefined;
  /** Bỏ trống = `org`, giống `TenantFilter`. Bị BỎ QUA khi đã lọc theo `tenantId`. */
  kind?: TenantKindFilter | undefined;
  page: number;
  pageSize: number;
}

function workspaceWhere(filter: WorkspaceFilter): { sql: string; params: (string | number)[] } {
  const conditions = ['w.deleted_at IS NULL', 't.deleted_at IS NULL'];
  const params: (string | number)[] = [];

  if (filter.status === 'active') conditions.push('w.is_active = 1');
  if (filter.status === 'locked') conditions.push('w.is_active = 0');
  if (filter.tenantId !== undefined) {
    // Đã hỏi đích danh một tổ chức thì KHÔNG áp bộ lọc loại nữa. Áp vào thì mở
    // trang chi tiết của một tổ chức cá nhân sẽ ra danh sách workspace rỗng,
    // trong khi ngay bên cạnh cột "Workspace" ghi số 1 — hai con số cãi nhau
    // trên cùng một màn hình.
    conditions.push('w.tenant_id = ?');
    params.push(filter.tenantId);
  } else if (filter.kind === 'personal') {
    conditions.push('t.owner_user_id IS NOT NULL');
  } else if (filter.kind !== 'all') {
    // Cùng lý do với `tenantWhere`: mỗi tài khoản kéo theo một workspace mặc
    // định trong không gian riêng của họ, và chúng sẽ lấn át workspace thật.
    conditions.push('t.owner_user_id IS NULL');
  }
  if (filter.search) {
    const like = `%${escapeLikeTerm(filter.search)}%`;
    conditions.push(`(w.name LIKE ? ESCAPE '\\\\' OR t.name LIKE ? ESCAPE '\\\\')`);
    params.push(like, like);
  }
  return { sql: conditions.join(' AND '), params };
}

export async function countWorkspaces(db: Db, filter: WorkspaceFilter): Promise<number> {
  const where = workspaceWhere(filter);
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total
       FROM workspaces w JOIN tenants t ON t.id = w.tenant_id
      WHERE ${where.sql}`,
    where.params,
  );
  return Number(rows[0]?.['total'] ?? 0);
}

export async function listWorkspaces(
  db: Db,
  filter: WorkspaceFilter,
): Promise<PlatformWorkspaceDto[]> {
  const where = workspaceWhere(filter);
  const [rows] = await db.query<PlatformWorkspaceRow[]>(
    `SELECT w.id, w.name, w.slug, w.description, w.is_active, w.created_at,
            w.tenant_id, t.name AS tenant_name,
            (SELECT COUNT(*) FROM reports r
              WHERE r.workspace_id = w.id AND r.deleted_at IS NULL) AS report_count
       FROM workspaces w
       JOIN tenants t ON t.id = w.tenant_id
      WHERE ${where.sql}
      ORDER BY t.name ASC, w.name ASC, w.id ASC
      LIMIT ? OFFSET ?`,
    [...where.params, filter.pageSize, (filter.page - 1) * filter.pageSize],
  );

  return rows.map((row) => ({
    id: Number(row.id),
    name: row.name,
    slug: row.slug,
    description: row.description,
    isActive: row.is_active === 1,
    tenantId: Number(row.tenant_id),
    tenantName: row.tenant_name,
    reportCount: Number(row.report_count),
    createdAt: row.created_at.toISOString(),
  }));
}

/** Workspace của một tổ chức, dùng cho màn hình chi tiết tenant. */
export async function listWorkspacesOfTenant(
  db: Db,
  tenantId: number,
): Promise<PlatformWorkspaceDto[]> {
  return listWorkspaces(db, { tenantId, page: 1, pageSize: 200 });
}

export async function setWorkspaceActive(db: Db, id: number, isActive: boolean): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    'UPDATE workspaces SET is_active = ? WHERE id = ? AND deleted_at IS NULL',
    [isActive ? 1 : 0, id],
  );
  return result.affectedRows;
}

export async function softDeleteWorkspace(db: Db, id: number): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    `UPDATE workspaces
        SET deleted_at = CURRENT_TIMESTAMP(3), is_active = 0,
            slug = CONCAT(LEFT(slug, 80), '-del-', id)
      WHERE id = ? AND deleted_at IS NULL`,
    [id],
  );
  return result.affectedRows;
}

export async function countLiveWorkspacesOfTenant(db: Db, tenantId: number): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>(
    'SELECT COUNT(*) AS total FROM workspaces WHERE tenant_id = ? AND deleted_at IS NULL',
    [tenantId],
  );
  return Number(rows[0]?.['total'] ?? 0);
}
