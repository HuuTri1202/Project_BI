import type { RegisterResponseDto, TenantRole } from '@bi/shared';
import type { PoolConnection, ResultSetHeader } from 'mysql2/promise';
import { withTransaction } from '../../db/tx';
import { createUser, toPublicUser, type UserRow } from '../../repositories/users';
import { HttpError } from '../../utils/httpError';
import {
  DEFAULT_WORKSPACE_NAME,
  DEFAULT_WORKSPACE_SLUG,
  personalTenantName,
  provisionTenant,
} from '../tenant/provisionTenant';
import { generateTempPassword, hashPassword } from './password';

/** Người tạo tổ chức là quản trị viên của chính tổ chức đó. */
const FOUNDER_ROLE: TenantRole = 'admin';

export interface RegisterAccountInput {
  fullName: string;
  /** Đã chuẩn hoá về chữ thường ở tầng schema. */
  email: string;
  /**
   * Vắng mặt -> tổ chức là KHÔNG GIAN RIÊNG mang tên người dùng
   * (`owner_user_id` = chính họ). Có -> tổ chức là công ty thật
   * (`owner_user_id = NULL`), y như trước.
   */
  companyName?: string | undefined;
  /** Vắng mặt -> tài khoản không có mật khẩu dùng được (đăng ký bằng Google). */
  password?: string | undefined;
  /**
   * `true` chỉ khi nơi gọi THỰC SỰ bảo đảm được hộp thư, và phải nói ra tại chỗ
   * gọi vì sao — xem `CreateUserInput.emailVerified`.
   */
  emailVerified?: boolean | undefined;
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
 * ─── Một tổ chức, hai loại ──────────────────────────────────────────────────
 *
 * Khai tên công ty -> `owner_user_id = NULL`, công ty thật, và người đăng ký làm
 * quản trị viên ở đó. Không khai -> `owner_user_id` trỏ về chính họ, tức một
 * KHÔNG GIAN RIÊNG, đúng loại mà `createMember` cấp cho người được mời.
 *
 * Phân biệt hai loại bằng `owner_user_id` chứ không bằng một cột riêng vì đó là
 * định nghĩa đã dùng khắp hệ thống: console hệ thống đếm "số tổ chức" bằng đúng
 * `owner_user_id IS NULL`, và bộ chuyển tổ chức gắn nhãn "không gian riêng" bằng
 * `owner_user_id <=> user_id`. Thêm một cột nữa là mời hai nguồn sự thật lệch
 * nhau.
 *
 * Dù loại nào thì cũng CHỈ MỘT tổ chức cho một lần đăng ký: người tự đăng ký
 * không được cấp thêm một tổ chức thứ hai, và `uq_tenants_owner` chặn ở tầng
 * database việc một người có hai không gian riêng.
 */
export async function registerAccount(input: RegisterAccountInput): Promise<RegisterResponseDto> {
  // Băm mật khẩu TRƯỚC khi mở transaction. bcrypt cost 12 mất ~300 ms; giữ một
  // connection và một transaction mở suốt quãng đó là chiếm chỗ vô ích trong
  // pool 10 connection, và đủ để vài request đồng thời làm cạn pool.
  /*
   * ─── Không có mật khẩu thì băm một chuỗi NGẪU NHIÊN, không để trống ────────
   *
   * `users.password_hash` là NOT NULL, nên đường đăng ký bằng Google vẫn phải
   * ghi một cái gì vào đó. Ghi hash của một chuỗi ngẫu nhiên mà KHÔNG AI BIẾT
   * nguyên bản chính là nghĩa của "tài khoản này không có mật khẩu": không ai
   * đoán ra, và `/login` vẫn chạy `verifyPassword` bình thường rồi từ chối.
   *
   * Nhét một chuỗi canh ('', 'google', 'khong-co') vào đây thì bcrypt gặp một
   * hash SAI DẠNG, và chuyện đó trả về `false` hay NÉM LỖI là tuỳ thư viện và
   * tuỳ phiên bản — một ngõ cụt khác hẳn, lộ ra dưới dạng 500 ở màn đăng nhập.
   *
   * Người đăng ký bằng Google muốn có thêm mật khẩu thì đi qua "Quên mật khẩu":
   * họ kiểm soát hộp thư đó (Google vừa chứng minh), nên thư đặt lại tới đúng
   * tay họ.
   */
  const passwordHash = await hashPassword(input.password ?? generateTempPassword(32));

  return withTransaction(async (conn) => {
    const userId = await insertUser(conn, { ...input, passwordHash });
    // Tên và chủ sở hữu phải đi CÙNG NHAU: tên mang họ tên người dùng thì
    // `ownerUserId` cũng phải trỏ về họ, không thì ta có một "Không gian của
    // Mai" bị cả hệ thống đếm như một công ty.
    const tenantName = input.companyName ?? personalTenantName(input.fullName);
    const tenant = await provisionTenant(conn, {
      name: tenantName,
      createdBy: userId,
      ownerUserId: input.companyName === undefined ? userId : null,
    });
    await insertMembership(conn, userId, tenant.tenantId, FOUNDER_ROLE);

    const user = await readUser(conn, userId);

    return {
      user,
      tenant: { id: tenant.tenantId, name: tenantName, slug: tenant.slug },
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
    // Dùng `createUser` của repository chứ không tự viết câu INSERT: danh sách
    // cột chỉ được có MỘT bản. Bản cũ ở đây đã bỏ sót `email_verified_at`, nên
    // thêm `emailVerified` vào input là phải sửa hai chỗ mới đúng.
    return await createUser(conn, {
      email: input.email,
      passwordHash: input.passwordHash,
      fullName: input.fullName,
      emailVerified: input.emailVerified === true,
    });
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
