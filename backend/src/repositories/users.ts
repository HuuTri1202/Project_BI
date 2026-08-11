import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { mysqlPool } from '../config/mysql';
import type { Db } from './db';

/**
 * Vai trò cấp NỀN TẢNG — người vận hành hệ thống, đứng ngoài mọi tổ chức.
 *
 * Đừng nhầm với `TenantRole` ('admin' | 'creator' | 'viewer') trong
 * repositories/memberships.ts. Hai trục hoàn toàn độc lập:
 *
 *   users.role        quyền trên HỆ THỐNG   ('superadmin' | 'user')
 *   memberships.role  quyền trong TỔ CHỨC   ('admin' | 'creator' | 'viewer')
 *
 * Một người có thể là `user` bình thường ở cấp nền tảng nhưng `admin` của công
 * ty mình. Trộn hai trục vào một cột là thứ không gỡ ra được về sau.
 */
export type PlatformRole = 'superadmin' | 'user';

/**
 * Dữ liệu user trả ra ngoài — KHÔNG bao giờ chứa `password_hash`.
 *
 * Cố ý KHÔNG có `tenantId` và không có vai trò tổ chức: bảng `users` giờ là
 * định danh toàn cục. Việc người này thuộc tổ chức nào với vai trò gì nằm ở
 * `Membership`, và API trả hai thứ đó cạnh nhau.
 */
export interface PublicUser {
  id: number;
  email: string;
  fullName: string;
  phone: string | null;
  jobTitle: string | null;
  /** Dạng 'YYYY-MM-DD'. Xem `dateStrings` trong config/mysql.ts. */
  dateOfBirth: string | null;
  platformRole: PlatformRole;
  isActive: boolean;
  mustChangePassword: boolean;
  emailVerifiedAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

interface UserRow extends RowDataPacket {
  id: number;
  email: string;
  password_hash: string;
  full_name: string;
  phone: string | null;
  job_title: string | null;
  date_of_birth: string | null;
  role: PlatformRole;
  is_active: number;
  must_change_password: number;
  email_verified_at: Date | null;
  last_login_at: Date | null;
  created_at: Date;
}

function toPublicUser(row: UserRow): PublicUser {
  return {
    id: Number(row.id),
    email: row.email,
    fullName: row.full_name,
    phone: row.phone,
    jobTitle: row.job_title,
    dateOfBirth: row.date_of_birth,
    platformRole: row.role,
    isActive: row.is_active === 1,
    mustChangePassword: row.must_change_password === 1,
    emailVerifiedAt: row.email_verified_at ? row.email_verified_at.toISOString() : null,
    lastLoginAt: row.last_login_at ? row.last_login_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  };
}

const SELECT_COLUMNS = `id, email, password_hash, full_name, phone, job_title, date_of_birth,
                        role, is_active, must_change_password, email_verified_at,
                        last_login_at, created_at`;

/*
 * ─── Về quy tắc "mọi hàm nhận tenantId đầu tiên" ─────────────────────────────
 *
 * Quy tắc đó vẫn còn hiệu lực, nhưng CHỖ ÁP DỤNG đã đổi cùng với mô hình dữ
 * liệu. Bảng `users` bây giờ là định danh toàn cục, không thuộc tổ chức nào,
 * nên các hàm dưới đây thao tác trên một danh tính và chỉ cần `userId`.
 *
 * Ranh giới tổ chức giờ nằm ở `memberships`. Mọi truy vấn kiểu "những người
 * dùng CỦA tổ chức này" (§3.3, §3.4) BẮT BUỘC phải JOIN qua memberships và lọc
 * `m.tenant_id = ?` — quên một lần là dữ liệu công ty này lọt sang công ty
 * khác. Những hàm đó thuộc về một repository riêng cho khu quản trị, không
 * trộn vào file này, để ranh giới nhìn thấy được ngay ở tên file.
 */

/**
 * Tra cứu lúc đăng nhập. Không nhận tenantId vì tại thời điểm này CHƯA BIẾT tổ
 * chức — form chỉ có email + mật khẩu. Chính vì vậy `email` phải duy nhất toàn
 * cục (xem migration 1).
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

export async function findById(userId: number): Promise<PublicUser | null> {
  const [rows] = await mysqlPool.query<UserRow[]>(
    `SELECT ${SELECT_COLUMNS} FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    [userId],
  );
  const row = rows[0];
  return row ? toPublicUser(row) : null;
}

export async function findPasswordHash(userId: number): Promise<string | null> {
  const [rows] = await mysqlPool.query<UserRow[]>(
    'SELECT password_hash FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1',
    [userId],
  );
  return rows[0]?.password_hash ?? null;
}

/**
 * Kiểm tra email đã dùng chưa — chỉ để trả thông báo tử tế cho form đăng ký.
 *
 * Thứ THẬT SỰ chặn trùng là ràng buộc UNIQUE trên cột: giữa câu SELECT này và
 * câu INSERT sau đó luôn có khe hở cho hai request đồng thời cùng lọt qua.
 */
export async function emailExists(email: string): Promise<boolean> {
  const [rows] = await mysqlPool.query<RowDataPacket[]>(
    'SELECT 1 AS x FROM users WHERE email = ? AND deleted_at IS NULL LIMIT 1',
    [email],
  );
  return rows.length > 0;
}

export interface CreateUserInput {
  email: string;
  passwordHash: string;
  fullName: string;
  phone?: string | null;
  jobTitle?: string | null;
  dateOfBirth?: string | null;
  platformRole?: PlatformRole;
  mustChangePassword?: boolean;
}

/**
 * `db` bắt buộc truyền vào (xem repositories/db.ts): tạo user hầu như luôn đi
 * kèm tạo membership trong cùng một transaction — đăng ký (§1.3) và Admin tạo
 * tài khoản (§3.4) đều vậy. Nếu hàm này lén dùng pool riêng thì rollback sẽ để
 * lại một user mồ côi không thuộc tổ chức nào, đăng nhập được nhưng không vào
 * được đâu cả.
 */
export async function createUser(db: Db, input: CreateUserInput): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    `INSERT INTO users
       (email, password_hash, full_name, phone, job_title, date_of_birth, role, must_change_password)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.email,
      input.passwordHash,
      input.fullName,
      input.phone ?? null,
      input.jobTitle ?? null,
      input.dateOfBirth ?? null,
      input.platformRole ?? 'user',
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
  userId: number,
  passwordHash: string,
  mustChangePassword: boolean,
): Promise<void> {
  await mysqlPool.query(
    `UPDATE users SET password_hash = ?, must_change_password = ?
      WHERE id = ? AND deleted_at IS NULL`,
    [passwordHash, mustChangePassword ? 1 : 0, userId],
  );
}

/**
 * Sửa hồ sơ cá nhân (§4.4).
 *
 * Cố ý KHÔNG nhận `tenantId`: `users` là bảng định danh TOÀN CỤC, một người có
 * đúng một hồ sơ dù làm ở bao nhiêu tổ chức. Đây là ngoại lệ duy nhất của luật
 * "hàm repository nhận tenantId trước", và nó hợp lệ vì bảng này không có cột
 * `tenant_id` nào để lọc.
 *
 * Đổi lại, `userId` PHẢI là `req.auth.userId` — không bao giờ là id lấy từ URL
 * hay body. Nhận id từ client ở đây nghĩa là ai cũng sửa được hồ sơ của người
 * khác trên toàn nền tảng.
 *
 * Danh sách cột viết cứng, không dựng động từ khoá của object: một `UPDATE users
 * SET ${key} = ?` sẽ cho phép client tự chọn cột và ghi thẳng vào `role` hay
 * `password_hash`.
 */
export async function updateProfile(
  userId: number,
  input: {
    fullName: string;
    phone: string | null;
    jobTitle: string | null;
    dateOfBirth: string | null;
  },
): Promise<number> {
  const [result] = await mysqlPool.query<ResultSetHeader>(
    `UPDATE users SET full_name = ?, phone = ?, job_title = ?, date_of_birth = ?
      WHERE id = ? AND deleted_at IS NULL`,
    [input.fullName, input.phone, input.jobTitle, input.dateOfBirth, userId],
  );
  return result.affectedRows;
}

export { toPublicUser };
export type { UserRow };
