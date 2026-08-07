import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { mysqlPool } from '../config/mysql';

export type UserRole = 'admin' | 'creator' | 'viewer';
export const USER_ROLES: readonly UserRole[] = ['admin', 'creator', 'viewer'];

/** Dữ liệu user trả ra ngoài — KHÔNG bao giờ chứa `password_hash`. */
export interface PublicUser {
  id: number;
  tenantId: number;
  fullName: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

interface UserRow extends RowDataPacket {
  id: number;
  tenant_id: number;
  full_name: string;
  email: string;
  password_hash: string;
  role: UserRole;
  is_active: number;
  must_change_password: number;
  last_login_at: Date | null;
  created_at: Date;
}

function toPublicUser(row: UserRow): PublicUser {
  return {
    id: Number(row.id),
    tenantId: Number(row.tenant_id),
    fullName: row.full_name,
    email: row.email,
    role: row.role,
    isActive: row.is_active === 1,
    mustChangePassword: row.must_change_password === 1,
    lastLoginAt: row.last_login_at ? row.last_login_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  };
}

const SELECT_COLUMNS = `id, tenant_id, full_name, email, password_hash, role,
                        is_active, must_change_password, last_login_at, created_at`;

/**
 * ĐÂY LÀ HÀM DUY NHẤT TRONG FILE NÀY KHÔNG LỌC THEO TENANT.
 *
 * Lý do: lúc đăng nhập chưa biết tenant nào — form chỉ có email + mật khẩu.
 * Chính vì vậy `email` phải duy nhất toàn cục (xem migration 1).
 *
 * Mọi hàm còn lại BẮT BUỘC nhận `tenantId` làm tham số đầu tiên, để không có
 * đường nào gọi mà quên lọc.
 */
export async function findByEmailForLogin(
  email: string,
): Promise<{ user: PublicUser; passwordHash: string } | null> {
  const [rows] = await mysqlPool.query<UserRow[]>(
    `SELECT ${SELECT_COLUMNS} FROM users WHERE email = ? AND deleted_at IS NULL LIMIT 1`,
    [email],
  );
  const row = rows[0];
  if (!row) return null;
  return { user: toPublicUser(row), passwordHash: row.password_hash };
}

export async function findById(tenantId: number, userId: number): Promise<PublicUser | null> {
  const [rows] = await mysqlPool.query<UserRow[]>(
    `SELECT ${SELECT_COLUMNS} FROM users
      WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL LIMIT 1`,
    [userId, tenantId],
  );
  const row = rows[0];
  return row ? toPublicUser(row) : null;
}

export async function findPasswordHash(tenantId: number, userId: number): Promise<string | null> {
  const [rows] = await mysqlPool.query<UserRow[]>(
    `SELECT ${SELECT_COLUMNS} FROM users
      WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL LIMIT 1`,
    [userId, tenantId],
  );
  return rows[0]?.password_hash ?? null;
}

export async function emailExists(email: string): Promise<boolean> {
  const [rows] = await mysqlPool.query<RowDataPacket[]>(
    'SELECT 1 AS x FROM users WHERE email = ? AND deleted_at IS NULL LIMIT 1',
    [email],
  );
  return rows.length > 0;
}

export interface CreateUserInput {
  fullName: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  mustChangePassword: boolean;
}

export async function createUser(tenantId: number, input: CreateUserInput): Promise<number> {
  const [result] = await mysqlPool.query<ResultSetHeader>(
    `INSERT INTO users (tenant_id, full_name, email, password_hash, role, must_change_password)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      tenantId,
      input.fullName,
      input.email,
      input.passwordHash,
      input.role,
      input.mustChangePassword ? 1 : 0,
    ],
  );
  return result.insertId;
}

export async function touchLastLogin(userId: number): Promise<void> {
  await mysqlPool.query('UPDATE users SET last_login_at = CURRENT_TIMESTAMP(3) WHERE id = ?', [
    userId,
  ]);
}

export async function updatePassword(
  tenantId: number,
  userId: number,
  passwordHash: string,
  mustChangePassword: boolean,
): Promise<void> {
  await mysqlPool.query(
    `UPDATE users SET password_hash = ?, must_change_password = ?
      WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL`,
    [passwordHash, mustChangePassword ? 1 : 0, userId, tenantId],
  );
}

/** Đếm admin còn hoạt động trong tenant — dùng để chặn xoá admin cuối cùng. */
export async function countActiveAdmins(tenantId: number): Promise<number> {
  const [rows] = await mysqlPool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM users
      WHERE tenant_id = ? AND role = 'admin' AND is_active = 1 AND deleted_at IS NULL`,
    [tenantId],
  );
  return Number(rows[0]?.['total'] ?? 0);
}

export { toPublicUser };
export type { UserRow };
