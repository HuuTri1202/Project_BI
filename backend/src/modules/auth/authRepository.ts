import type { RoleCode } from '@bi/shared';
import type { PoolConnection } from 'mysql2/promise';

import { mysqlPool } from '../../config/mysql';
import type { MembershipRow, UserRow, WorkspaceRow } from './types';

/**
 * Chỉ SQL. Không nghiệp vụ, không băm mật khẩu, không đụng req/res.
 *
 * LUẬT: mọi hàm GHI dữ liệu nhận `conn` làm tham số đầu tiên.
 *
 * Nếu một hàm ở đây tự gọi `mysqlPool.query(...)`, nó sẽ lấy một connection
 * KHÁC với connection đang giữ BEGIN của caller. Câu lệnh khi đó chạy ngoài
 * transaction: ROLLBACK không xoá nó, dữ liệu mồ côi nằm lại im lặng, và lỗi chỉ
 * lộ ra ở nhánh thất bại mà thường không ai test. Truyền connection vào làm cho
 * sai lầm đó không viết ra được.
 *
 * Hàm chỉ ĐỌC được phép dùng thẳng pool, vì chúng không thuộc transaction nào.
 */

export interface InsertUserParams {
  id: string;
  email: string;
  passwordHash: string;
  fullName: string;
  phone: string;
  jobTitle: string;
}

export async function insertUser(conn: PoolConnection, params: InsertUserParams): Promise<void> {
  await conn.execute(
    `INSERT INTO users (id, email, password_hash, full_name, phone, job_title)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      params.id,
      params.email,
      params.passwordHash,
      params.fullName,
      params.phone,
      params.jobTitle,
    ],
  );
}

export async function insertTenant(
  conn: PoolConnection,
  params: { id: string; name: string },
): Promise<void> {
  await conn.execute('INSERT INTO tenants (id, name) VALUES (?, ?)', [params.id, params.name]);
}

export async function insertWorkspace(
  conn: PoolConnection,
  params: { id: string; tenantId: string; name: string },
): Promise<void> {
  await conn.execute('INSERT INTO workspaces (id, tenant_id, name) VALUES (?, ?, ?)', [
    params.id,
    params.tenantId,
    params.name,
  ]);
}

export async function insertMembership(
  conn: PoolConnection,
  params: { id: string; userId: string; tenantId: string; roleCode: RoleCode },
): Promise<void> {
  await conn.execute(
    'INSERT INTO memberships (id, user_id, tenant_id, role_code) VALUES (?, ?, ?, ?)',
    [params.id, params.userId, params.tenantId, params.roleCode],
  );
}

const USER_COLUMNS =
  'id, email, password_hash, full_name, phone, job_title, status, created_at';

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const [rows] = await mysqlPool.execute<UserRow[]>(
    `SELECT ${USER_COLUMNS} FROM users WHERE email = ? LIMIT 1`,
    [email],
  );
  // `noUncheckedIndexedAccess` làm rows[0] có kiểu `UserRow | undefined` — phải
  // thu hẹp tường minh, không được dùng `!`.
  return rows[0] ?? null;
}

export async function findUserById(id: string): Promise<UserRow | null> {
  const [rows] = await mysqlPool.execute<UserRow[]>(
    `SELECT ${USER_COLUMNS} FROM users WHERE id = ? LIMIT 1`,
    [id],
  );
  return rows[0] ?? null;
}

/** Danh sách tenant người dùng thuộc về, kèm vai trò. Sắp theo thời điểm tham
 *  gia để phần tử đầu là fallback ổn định khi token không nói rõ tenant nào. */
export async function findMembershipsByUser(userId: string): Promise<MembershipRow[]> {
  const [rows] = await mysqlPool.execute<MembershipRow[]>(
    `SELECT m.tenant_id, t.name AS tenant_name, m.role_code, m.created_at
       FROM memberships m
       JOIN tenants t ON t.id = m.tenant_id
      WHERE m.user_id = ? AND m.status = 'active' AND t.status = 'active'
      ORDER BY m.created_at ASC`,
    [userId],
  );
  return rows;
}

export async function findWorkspacesByTenant(tenantId: string): Promise<WorkspaceRow[]> {
  const [rows] = await mysqlPool.execute<WorkspaceRow[]>(
    `SELECT id, name FROM workspaces
      WHERE tenant_id = ? AND status = 'active'
      ORDER BY created_at ASC`,
    [tenantId],
  );
  return rows;
}

export async function touchLastLogin(userId: string): Promise<void> {
  await mysqlPool.execute('UPDATE users SET last_login_at = UTC_TIMESTAMP(3) WHERE id = ?', [
    userId,
  ]);
}
