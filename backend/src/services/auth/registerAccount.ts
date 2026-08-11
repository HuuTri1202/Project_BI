import type { RegisterResponseDto, TenantRole } from '@bi/shared';
import type { PoolConnection, ResultSetHeader } from 'mysql2/promise';
import { withTransaction } from '../../db/tx';
import { toPublicUser, type UserRow } from '../../repositories/users';
import { HttpError } from '../../utils/httpError';
import {
  DEFAULT_WORKSPACE_NAME,
  DEFAULT_WORKSPACE_SLUG,
  provisionTenant,
} from '../tenant/provisionTenant';
import { hashPassword } from './password';

/** Người tạo tổ chức là quản trị viên của chính tổ chức đó. */
const FOUNDER_ROLE: TenantRole = 'admin';

export interface RegisterAccountInput {
  fullName: string;
  companyName: string;
  /** Đã chuẩn hoá về chữ thường ở tầng schema. */
  email: string;
  password: string;
  /** Đã chuẩn hoá về dạng +84XXXXXXXXX ở tầng schema. */
  phone: string;
  jobTitle: string;
}

/**
 * Tạo tài khoản + tổ chức + workspace + tư cách thành viên, TẤT CẢ hoặc KHÔNG.
 *
 * Bốn câu INSERT phải nằm trong một transaction: nếu tạo được tenant rồi hỏng ở
 * bước tạo user, ta để lại một tổ chức rỗng không ai vào được và cũng không có
 * đường xoá qua giao diện. Kiểu rác đó chỉ tích lại chứ không tự dọn.
 *
 * Mọi hàm bên dưới NHẬN `conn` làm tham số đầu tiên. Nếu chúng tự gọi
 * `mysqlPool.query(...)` thì sẽ lấy một connection KHÁC, chạy ngoài
 * BEGIN/COMMIT của caller, và ROLLBACK sẽ âm thầm để lại dữ liệu mồ côi — lỗi
 * chỉ lộ ra ở nhánh thất bại mà không ai test.
 *
 * ─── Vì sao user đi TRƯỚC tenant ────────────────────────────────────────────
 *
 * `provisionTenant` dựng luôn workspace mặc định, mà `workspaces.created_by`
 * cần `userId`. Đổi thứ tự còn được thêm một thứ: email trùng nay thất bại
 * TRƯỚC khi kịp đốt một slug tenant trong không gian tên toàn cục.
 *
 * Tổ chức tạo ở đây có `owner_user_id = NULL` — nó là công ty thật do người dùng
 * khai, không phải không gian cá nhân. Người tự đăng ký KHÔNG được cấp thêm một
 * tổ chức cá nhân thứ hai: công ty họ vừa lập đã là nơi họ làm chủ rồi.
 */
export async function registerAccount(input: RegisterAccountInput): Promise<RegisterResponseDto> {
  // Băm mật khẩu TRƯỚC khi mở transaction. bcrypt cost 12 mất ~300 ms; giữ một
  // connection và một transaction mở suốt quãng đó là chiếm chỗ vô ích trong
  // pool 10 connection, và đủ để vài request đồng thời làm cạn pool.
  const passwordHash = await hashPassword(input.password);

  return withTransaction(async (conn) => {
    const userId = await insertUser(conn, { ...input, passwordHash });
    const tenant = await provisionTenant(conn, {
      name: input.companyName,
      createdBy: userId,
      ownerUserId: null,
    });
    await insertMembership(conn, userId, tenant.tenantId, FOUNDER_ROLE);

    const user = await readUser(conn, userId);

    return {
      user,
      tenant: { id: tenant.tenantId, name: input.companyName, slug: tenant.slug },
      workspace: {
        id: tenant.workspaceId,
        name: DEFAULT_WORKSPACE_NAME,
        slug: DEFAULT_WORKSPACE_SLUG,
      },
      role: FOUNDER_ROLE,
    };
  });
}

async function insertUser(
  conn: PoolConnection,
  input: RegisterAccountInput & { passwordHash: string },
): Promise<number> {
  try {
    const [result] = await conn.query<ResultSetHeader>(
      `INSERT INTO users (email, password_hash, full_name, phone, job_title, role)
       VALUES (?, ?, ?, ?, ?, 'user')`,
      [input.email, input.passwordHash, input.fullName, input.phone, input.jobTitle],
    );
    return result.insertId;
  } catch (err) {
    // ĐÂY mới là chỗ chặn trùng email thật sự. Câu SELECT kiểm tra trước ở tầng
    // route chỉ để trả thông báo tử tế; giữa nó và câu INSERT này luôn có khe
    // hở cho hai request đồng thời.
    if (isDuplicateEntry(err)) {
      throw new HttpError(409, 'EmailAlreadyRegistered', 'Email này đã được đăng ký.', {
        email: 'Email này đã được đăng ký',
      });
    }
    throw err;
  }
}

async function insertMembership(
  conn: PoolConnection,
  userId: number,
  tenantId: number,
  role: TenantRole,
): Promise<void> {
  await conn.query<ResultSetHeader>(
    'INSERT INTO memberships (user_id, tenant_id, role) VALUES (?, ?, ?)',
    [userId, tenantId, role],
  );
}

/** Đọc lại user vừa tạo để trả về đúng giá trị mà database đã sinh. */
async function readUser(conn: PoolConnection, userId: number) {
  const [rows] = await conn.query<UserRow[]>(
    `SELECT id, email, password_hash, full_name, phone, job_title, date_of_birth,
            role, is_active, must_change_password, email_verified_at, last_login_at, created_at
       FROM users WHERE id = ? LIMIT 1`,
    [userId],
  );
  const row = rows[0];
  if (!row) throw new Error('Không đọc lại được user vừa tạo');
  return toPublicUser(row);
}

/**
 * Nhận diện lỗi vi phạm ràng buộc UNIQUE.
 *
 * Dùng `code` chứ không so khớp `message`: message thay đổi theo phiên bản và
 * theo ngôn ngữ của server, còn `ER_DUP_ENTRY` thì ổn định.
 */
function isDuplicateEntry(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: string }).code === 'ER_DUP_ENTRY'
  );
}
