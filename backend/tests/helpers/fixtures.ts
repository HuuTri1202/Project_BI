import type { TenantRole } from '@bi/shared';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
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

/**
 * Cấp cho tổ chức một gói KHÔNG GIỚI HẠN — §11.2.
 *
 * ═══ Vì sao thứ này cần tồn tại ════════════════════════════════════════════
 *
 * Từ §11.2 hạn mức gói CHẶN thật, và gói mặc định (Free) cho 1 workspace, 3 báo
 * cáo, 3 thành viên. Rất nhiều bài test không nói gì về thanh toán vẫn dựng bốn
 * thành viên hoặc hai workspace — vì tới hôm qua không có gì cản.
 *
 * Chúng đỏ là ĐÚNG, và câu trả lời KHÔNG phải là nới hạn mức gói Free trong
 * `reseedBillingCatalog`: làm vậy thì không bài test nào còn đi qua lớp chặn
 * nữa, và nó sẽ hỏng trong im lặng.
 *
 * Câu trả lời là nói ra: bài test nào cần nhiều hơn gói mặc định thì gọi hàm này
 * và nêu rõ điều đó. `grep` ra là thấy ngay bài nào phụ thuộc vào việc được cấp
 * gói, bài nào đang kiểm chính lớp chặn.
 *
 * ⚠️ Bốn cột hạn mức để NULL (= không giới hạn) và `limits_captured_at` khác
 * NULL. Cặp đó bắt buộc đi cùng nhau — `ck_subscriptions_limits_snapshot` chặn
 * ngay nếu không, vì "có hạn mức mà không có cờ" sẽ âm thầm thành gói vô hạn ở
 * đường đọc sống.
 *
 * ⚠️ `grantedBy` BẮT BUỘC, và phải là một user có thật. Bản đầu của hàm này
 * truyền `NULL` và mọi lời gọi đều nổ:
 *
 *     ck_subscriptions_override_has_reason:
 *       source <> 'admin_override' OR (granted_by IS NOT NULL AND reason IS NOT NULL)
 *
 * Ràng buộc đó có lý do riêng của nó — một gói cấp tay mà không biết AI cấp là
 * thứ không được tồn tại — nên hàm này phải chiều nó, và người gọi phải tạo user
 * TRƯỚC khi gọi.
 */
export async function capGoiKhongGioiHan(tenantId: number, grantedBy: number): Promise<void> {
  const [plan] = await mysqlPool.query<(RowDataPacket & { id: number })[]>(
    "SELECT id FROM plans WHERE code = 'business' LIMIT 1",
  );
  const planId = plan[0]?.id;
  if (planId === undefined) {
    throw new Error("Không tìm thấy gói 'business' — migration 30 chưa chạy?");
  }

  await mysqlPool.query(
    `INSERT INTO subscriptions
       (tenant_id, plan_id, order_id, status, source, plan_code, plan_name, price_vnd,
        max_workspaces, max_reports, max_members, max_storage_bytes, limits_captured_at,
        period_start, period_end, granted_by, reason)
     VALUES (?, ?, NULL, 'active', 'admin_override', 'business', 'Doanh nghiệp', 0,
             NULL, NULL, NULL, NULL, NOW(3),
             NOW(3), NOW(3) + INTERVAL 365 DAY, ?, 'fixture test')`,
    [tenantId, planId, grantedBy],
  );
}

export async function makeWorkspace(tenantId: number, name: string, slug: string): Promise<number> {
  const [result] = await mysqlPool.query<ResultSetHeader>(
    'INSERT INTO workspaces (tenant_id, name, slug) VALUES (?, ?, ?)',
    [tenantId, name, slug],
  );
  return result.insertId;
}

/**
 * Một bộ dữ liệu tối thiểu + một báo cáo dựng trên nó.
 *
 * Báo cáo không đứng một mình được: `ck_reports_one_source` (migration 15) đòi
 * đúng một trong `dataset_id`/`datamodel_id`, và cột đầu có khoá ngoại sang
 * `datasets`. Nên fixture này dựng cả cặp.
 */
export async function makeReport(
  tenantId: number,
  workspaceId: number,
  name: string,
): Promise<number> {
  const [ds] = await mysqlPool.query<ResultSetHeader>(
    `INSERT INTO datasets (tenant_id, workspace_id, source, name, status, load_status)
     VALUES (?, ?, 'file', ?, 'ready', 'idle')`,
    [tenantId, workspaceId, `${name} (bộ dữ liệu)`],
  );
  const [result] = await mysqlPool.query<ResultSetHeader>(
    'INSERT INTO reports (tenant_id, workspace_id, dataset_id, name) VALUES (?, ?, ?, ?)',
    [tenantId, workspaceId, ds.insertId, name],
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
