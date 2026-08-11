import type { PoolConnection, ResultSetHeader } from 'mysql2/promise';
import { HttpError } from '../../utils/httpError';
import { slugifyOrFallback } from '../auth/slug';

/** Workspace được tạo sẵn cho tổ chức mới, để màn hình không mở ra danh sách rỗng. */
export const DEFAULT_WORKSPACE_NAME = 'Không gian mặc định';
export const DEFAULT_WORKSPACE_SLUG = 'mac-dinh';

export interface ProvisionTenantInput {
  /** Tên hiển thị của tổ chức. Slug sinh từ đây, tự né trùng. */
  name: string;
  /** Ghi vào `workspaces.created_by`. */
  createdBy: number;
  /**
   * Khác `null` -> đây là TỔ CHỨC CÁ NHÂN của người đó.
   *
   * Ràng buộc `uq_tenants_owner` (migration 5) chặn ở tầng database việc một
   * người có hai tổ chức cá nhân, nên không cần kiểm tra trước ở đây.
   */
  ownerUserId?: number | null;
}

export interface ProvisionedTenant {
  tenantId: number;
  slug: string;
  workspaceId: number;
}

/**
 * Dựng một tổ chức kèm workspace mặc định của nó.
 *
 * Tách ra khỏi `registerAccount` vì giờ có HAI đường sinh tổ chức, và chúng phải
 * cho ra đúng cùng một kết quả:
 *
 *   1. Tự đăng ký  -> tổ chức là công ty người dùng khai trong form.
 *   2. Admin tạo tài khoản cho người khác -> ngoài tổ chức được mời, người đó
 *      còn được cấp một tổ chức CÁ NHÂN ngang hàng, y như vừa tự đăng ký.
 *
 * Nếu để hai đường tự viết lấy phần INSERT của mình thì chỉ cần một bên quên
 * workspace mặc định là bên đó mở ra màn hình rỗng và `GET /v1/home` trả
 * `409 NoWorkspace` — một lỗi chỉ lộ ra ở luồng ít được thử.
 *
 * BẮT BUỘC nhận `conn` đang giữ transaction của caller. Tự gọi `mysqlPool` sẽ
 * lấy một connection KHÁC, chạy ngoài BEGIN/COMMIT, và ROLLBACK của caller sẽ
 * âm thầm để lại một tổ chức mồ côi.
 */
export async function provisionTenant(
  conn: PoolConnection,
  input: ProvisionTenantInput,
): Promise<ProvisionedTenant> {
  const { tenantId, slug } = await insertTenant(conn, input.name, input.ownerUserId ?? null);
  const workspaceId = await insertWorkspace(conn, tenantId, input.createdBy);
  return { tenantId, slug, workspaceId };
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
 *
 * ⚠️ Bảng này có HAI ràng buộc UNIQUE kể từ migration 5 (`uq_tenants_slug` và
 * `uq_tenants_owner`). Vòng lặp chỉ được thử lại khi đụng cái ĐẦU: trùng chủ sở
 * hữu nghĩa là người này đã có tổ chức cá nhân, và thử thêm 19 lần nữa cũng chỉ
 * hỏng y hệt. Nên phải soi tên index chứ không bắt trơn `ER_DUP_ENTRY`.
 */
async function insertTenant(
  conn: PoolConnection,
  name: string,
  ownerUserId: number | null,
): Promise<{ tenantId: number; slug: string }> {
  const base = slugifyOrFallback(name);

  for (let attempt = 1; attempt <= 20; attempt += 1) {
    const slug = attempt === 1 ? base : `${base}-${attempt}`;
    try {
      const [result] = await conn.query<ResultSetHeader>(
        'INSERT INTO tenants (name, slug, owner_user_id) VALUES (?, ?, ?)',
        [name, slug, ownerUserId],
      );
      return { tenantId: result.insertId, slug };
    } catch (err) {
      if (!isDuplicateOf(err, 'uq_tenants_slug')) throw err;
      // Trùng slug -> thử hậu tố kế tiếp.
    }
  }

  throw new HttpError(
    409,
    'TenantSlugExhausted',
    'Không tạo được định danh cho tổ chức. Thử đổi tên công ty.',
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

/**
 * Vi phạm UNIQUE ở ĐÚNG index nào.
 *
 * Dùng `code` chứ không so khớp `message` cho phần nhận diện lỗi: message thay
 * đổi theo phiên bản và theo ngôn ngữ của server, còn `ER_DUP_ENTRY` thì ổn
 * định. Tên index thì buộc phải đọc từ message vì mysql2 không phơi nó ra chỗ
 * nào khác — nhưng đó là tên do chính migration của ta đặt, không phải chuỗi
 * của nhà cung cấp.
 */
function isDuplicateOf(err: unknown, indexName: string): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: string }).code === 'ER_DUP_ENTRY' &&
    String((err as { message?: string }).message ?? '').includes(indexName)
  );
}
