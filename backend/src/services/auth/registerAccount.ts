import type { RegisterResponseDto, TenantRole } from '@bi/shared';
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { withTransaction } from '../../db/tx';
import { toPublicUser, type UserRow } from '../../repositories/users';
import { HttpError } from '../../utils/httpError';
import { hashPassword } from './password';
import { slugifyOrFallback } from './slug';

/** Workspace được tạo sẵn cho tổ chức mới, để màn hình không mở ra danh sách rỗng. */
const DEFAULT_WORKSPACE_NAME = 'Không gian mặc định';
const DEFAULT_WORKSPACE_SLUG = 'mac-dinh';

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
 * Tạo tổ chức + tài khoản + tư cách thành viên + workspace, TẤT CẢ hoặc KHÔNG.
 *
 * Bốn câu INSERT phải nằm trong một transaction: nếu tạo được tenant rồi hỏng ở
 * bước tạo user, ta để lại một tổ chức rỗng không ai vào được và cũng không có
 * đường xoá qua giao diện. Kiểu rác đó chỉ tích lại chứ không tự dọn.
 *
 * Mọi hàm bên dưới NHẬN `conn` làm tham số đầu tiên. Nếu chúng tự gọi
 * `mysqlPool.query(...)` thì sẽ lấy một connection KHÁC, chạy ngoài
 * BEGIN/COMMIT của caller, và ROLLBACK sẽ âm thầm để lại dữ liệu mồ côi — lỗi
 * chỉ lộ ra ở nhánh thất bại mà không ai test.
 */
export async function registerAccount(input: RegisterAccountInput): Promise<RegisterResponseDto> {
  // Băm mật khẩu TRƯỚC khi mở transaction. bcrypt cost 12 mất ~300 ms; giữ một
  // connection và một transaction mở suốt quãng đó là chiếm chỗ vô ích trong
  // pool 10 connection, và đủ để vài request đồng thời làm cạn pool.
  const passwordHash = await hashPassword(input.password);

  return withTransaction(async (conn) => {
    const tenantId = await insertTenant(conn, input.companyName);
    const userId = await insertUser(conn, { ...input, passwordHash });
    await insertMembership(conn, userId, tenantId, FOUNDER_ROLE);
    const workspaceId = await insertWorkspace(conn, tenantId, userId);

    const user = await readUser(conn, userId);

    return {
      user,
      tenant: { id: tenantId, name: input.companyName, slug: await readTenantSlug(conn, tenantId) },
      workspace: { id: workspaceId, name: DEFAULT_WORKSPACE_NAME, slug: DEFAULT_WORKSPACE_SLUG },
      role: FOUNDER_ROLE,
    };
  });
}

/**
 * Tạo tổ chức, tự né trùng slug.
 *
 * `tenants.slug` UNIQUE toàn cục nên hai công ty cùng tên là chuyện bình thường
 * chứ không phải lỗi người dùng — không được từ chối đăng ký vì lý do đó. Thử
 * lần lượt `cong-ty-abc`, `cong-ty-abc-2`, `cong-ty-abc-3`…
 *
 * Bắt đúng mã `ER_DUP_ENTRY` rồi thử tiếp, thay vì SELECT kiểm tra trước: giữa
 * SELECT và INSERT luôn có khe hở cho hai request đồng thời cùng lọt qua, và
 * ràng buộc UNIQUE mới là thứ thật sự chặn.
 */
async function insertTenant(conn: PoolConnection, companyName: string): Promise<number> {
  const base = slugifyOrFallback(companyName);

  for (let attempt = 1; attempt <= 20; attempt += 1) {
    const slug = attempt === 1 ? base : `${base}-${attempt}`;
    try {
      const [result] = await conn.query<ResultSetHeader>(
        'INSERT INTO tenants (name, slug) VALUES (?, ?)',
        [companyName, slug],
      );
      return result.insertId;
    } catch (err) {
      if (!isDuplicateEntry(err)) throw err;
      // Trùng slug -> thử hậu tố kế tiếp.
    }
  }

  throw new HttpError(
    409,
    'TenantSlugExhausted',
    'Không tạo được định danh cho tổ chức. Thử đổi tên công ty.',
  );
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

async function insertWorkspace(
  conn: PoolConnection,
  tenantId: number,
  createdBy: number,
): Promise<number> {
  const [result] = await conn.query<ResultSetHeader>(
    'INSERT INTO workspaces (tenant_id, name, slug, created_by) VALUES (?, ?, ?, ?)',
    [tenantId, DEFAULT_WORKSPACE_NAME, DEFAULT_WORKSPACE_SLUG, createdBy],
  );
  return result.insertId;
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

async function readTenantSlug(conn: PoolConnection, tenantId: number): Promise<string> {
  const [rows] = await conn.query<RowDataPacket[]>('SELECT slug FROM tenants WHERE id = ? LIMIT 1', [
    tenantId,
  ]);
  return String(rows[0]?.['slug'] ?? '');
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
