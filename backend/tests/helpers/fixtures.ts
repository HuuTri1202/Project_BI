import type { TenantRole } from '@bi/shared';
import type { ResultSetHeader } from 'mysql2';
import { mysqlPool } from '../../src/config/mysql';
import { hashPassword } from '../../src/services/auth/password';
import { signAccessToken } from '../../src/services/auth/token';

/**
 * Dựng dữ liệu cho test bằng SQL trực tiếp, KHÔNG qua API.
 *
 * Cố ý như vậy: nếu fixture gọi `POST /auth/register` thì một lỗi trong luồng
 * đăng ký sẽ làm đỏ toàn bộ test quản trị, và người đọc phải mất công lần xem
 * cái gì thực sự hỏng. Test nào kiểm luồng nào thì chỉ luồng đó được nằm trên
 * đường đi.
 */

/**
 * Tạo một tổ chức.
 *
 * `ownerUserId` khác `null` -> đây là KHÔNG GIAN CÁ NHÂN của người đó, loại tổ
 * chức mà `createMember` cấp kèm mỗi tài khoản mới (migration 5). Console hệ
 * thống mặc định ẩn loại này, nên test nào kiểm bộ lọc đó đều cần dựng một cái.
 */
export async function makeTenant(
  name: string,
  slug: string,
  ownerUserId: number | null = null,
): Promise<number> {
  const [result] = await mysqlPool.query<ResultSetHeader>(
    'INSERT INTO tenants (name, slug, owner_user_id) VALUES (?, ?, ?)',
    [name, slug, ownerUserId],
  );
  return result.insertId;
}

export async function makeUser(
  email: string,
  fullName: string,
  options: {
    password?: string;
    isActive?: boolean;
    /** Trục NỀN TẢNG. Mặc định 'user' — chỉ tài khoản seed mới là superadmin. */
    platformRole?: 'superadmin' | 'user';
  } = {},
): Promise<number> {
  const [result] = await mysqlPool.query<ResultSetHeader>(
    `INSERT INTO users (email, password_hash, full_name, role, is_active)
     VALUES (?, ?, ?, ?, ?)`,
    [
      email,
      // Cost thấp do vitest.config.ts đặt BCRYPT_COST=4 — cost 12 nhân với vài
      // chục tài khoản trong suite là hàng chục giây chờ vô ích.
      await hashPassword(options.password ?? 'Matkhau123'),
      fullName,
      options.platformRole ?? 'user',
      options.isActive === false ? 0 : 1,
    ],
  );
  return result.insertId;
}

export async function makeMembership(
  userId: number,
  tenantId: number,
  role: TenantRole,
  options: { isActive?: boolean; removed?: boolean } = {},
): Promise<void> {
  await mysqlPool.query(
    `INSERT INTO memberships (user_id, tenant_id, role, is_active, removed_at)
     VALUES (?, ?, ?, ?, ?)`,
    [
      userId,
      tenantId,
      role,
      options.isActive === false || options.removed === true ? 0 : 1,
      options.removed === true ? new Date() : null,
    ],
  );
}

export async function makeWorkspace(tenantId: number, name: string, slug: string): Promise<number> {
  const [result] = await mysqlPool.query<ResultSetHeader>(
    'INSERT INTO workspaces (tenant_id, name, slug) VALUES (?, ?, ?)',
    [tenantId, name, slug],
  );
  return result.insertId;
}

export async function makeProject(
  tenantId: number,
  workspaceId: number,
  name: string,
): Promise<number> {
  const [result] = await mysqlPool.query<ResultSetHeader>(
    'INSERT INTO projects (tenant_id, workspace_id, name) VALUES (?, ?, ?)',
    [tenantId, workspaceId, name],
  );
  return result.insertId;
}

/**
 * Ký token với nội dung TUỲ Ý — kể cả nội dung không khớp database.
 *
 * Đây là công cụ để kiểm `requireFreshAdmin`: ký một token ghi `role: 'admin'`
 * cho người thực tế chỉ là `viewer`, đúng như một token được cấp trước khi bị hạ
 * quyền. Không có khả năng này thì không cách nào tái hiện được cửa sổ 7 ngày
 * mà token còn hiệu lực.
 */
export function signTokenFor(
  userId: number,
  tenantId: number,
  role: TenantRole,
  platformRole: 'superadmin' | 'user' = 'user',
): string {
  return signAccessToken({ userId, tenantId, role, platformRole });
}

export const bearer = (token: string): Record<string, string> => ({
  Authorization: `Bearer ${token}`,
});
