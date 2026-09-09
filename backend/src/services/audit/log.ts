import type { Request } from 'express';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

import type { Db } from '../../repositories/db';

/**
 * Nhật ký kiểm toán — §11, nhưng dùng chung CẢ REPO.
 *
 * ═══ Ghi cái gì, và quan trọng hơn: KHÔNG ghi cái gì ═══════════════════════
 *
 * Chỉ ghi thao tác QUẢN TRỊ và TIỀN BẠC — đổi giá gói, xác nhận đã nhận tiền,
 * ghi đè gói cho một tổ chức. KHÔNG ghi mỗi lần ai đó mở một báo cáo.
 *
 * Ranh giới đó không phải để tiết kiệm dung lượng. Một nhật ký ghi tất cả là
 * một nhật ký không ai đọc: khi cần tìm "ai đã đổi giá gói Pro tuần trước", câu
 * trả lời nằm lẫn giữa hàng chục nghìn dòng xem báo cáo, và người đi tìm sẽ bỏ
 * cuộc. Nhật ký kiểm toán có giá trị tỉ lệ NGHỊCH với số dòng nó chứa.
 *
 * ═══ Ghi trong CÙNG transaction với thao tác nó mô tả ══════════════════════
 *
 * Mọi hàm ở đây nhận `db: Db` chứ không tự lấy `mysqlPool`. Ghi ngoài
 * transaction nghĩa là thao tác rollback mà nhật ký vẫn còn — một dòng nói rằng
 * điều gì đó đã xảy ra trong khi nó không xảy ra. Với sổ sách tiền bạc, sai theo
 * chiều đó còn tệ hơn thiếu.
 */

/**
 * Tên hành động, quy ước `<đối tượng>.<động từ>`.
 *
 * Hằng số chứ không chuỗi rời: gõ nhầm `'plan.updated'` một chỗ và
 * `'plan.update'` chỗ khác thì màn hình lọc theo hành động bỏ sót đúng những
 * dòng người ta đi tìm, và không có gì báo.
 *
 * Cột trong database là VARCHAR chứ không ENUM — thêm một hành động mới không
 * cần migration. Xem ghi chú ở migration 30.
 */
export const AUDIT_ACTIONS = {
  PLAN_CREATE: 'plan.create',
  PLAN_UPDATE: 'plan.update',
  PLAN_DELETE: 'plan.delete',
  PAYMENT_METHOD_UPDATE: 'payment_method.update',
  /** Quản trị viên đối chiếu sao kê rồi xác nhận đã nhận tiền. */
  ORDER_CONFIRM_MANUAL: 'order.confirm_manual',
  /** Webhook của cổng thanh toán báo về. `actorUserId` là null. */
  ORDER_CONFIRM_WEBHOOK: 'order.confirm_webhook',
  /** Gán gói cho một tổ chức không qua thanh toán — khách ký hợp đồng riêng. */
  SUBSCRIPTION_OVERRIDE: 'subscription.admin_override',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export interface AuditEntry {
  /**
   * Tổ chức mà thao tác này TÁC ĐỘNG TỚI, không phải tổ chức của người làm.
   *
   * `null` khi thao tác không thuộc tổ chức nào — superadmin đổi giá gói Pro là
   * ví dụ: nó ảnh hưởng mọi tổ chức nên không quy về tổ chức nào cả.
   */
  tenantId: number | null;
  actorUserId: number | null;
  /**
   * Email người thực hiện, chụp lại thành VĂN BẢN.
   *
   * Email trong bảng `users` đổi được, và tài khoản xoá được. Câu hỏi "ai đã bấm
   * nút này, vào lúc đó" phải trả lời được mà không cần JOIN với một bảng đã
   * thay đổi từ lâu — đó là lý do bảng này không có khoá ngoại nào.
   */
  actorEmail: string | null;
  actorPlatformRole?: 'superadmin' | 'user' | null;
  actorTenantRole?: 'admin' | 'creator' | 'viewer' | null;
  action: AuditAction;
  entityType: string;
  entityId: number | null;
  /** Trạng thái TRƯỚC và SAU. Cả hai `null` khi thao tác không sửa gì sẵn có. */
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * `undefined` và `null` đều thành `null`; còn lại thành chuỗi JSON.
 *
 * mysql2 nhận object cho cột JSON, nhưng chuyển sẵn ở đây để một giá trị không
 * tuần tự hoá được (BigInt, hàm, vòng lặp tham chiếu) nổ ngay tại chỗ gọi thay
 * vì ở giữa một transaction đang mở.
 */
function toJson(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return JSON.stringify(value);
}

/**
 * User-Agent cắt còn 255 ký tự, khớp cột.
 *
 * Không cắt thì một chuỗi dài hơn bị MySQL từ chối và cả transaction rollback —
 * tức là một cái header vô hại giết mất một lần xác nhận thanh toán.
 */
function short(value: string | null | undefined, max: number): string | null {
  if (value === null || value === undefined || value === '') return null;
  return value.length > max ? value.slice(0, max) : value;
}

export async function writeAudit(db: Db, entry: AuditEntry): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    `INSERT INTO audit_logs
       (tenant_id, actor_user_id, actor_email, actor_platform_role, actor_tenant_role,
        action, entity_type, entity_id, before_json, after_json, reason,
        ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.tenantId,
      entry.actorUserId,
      short(entry.actorEmail, 255),
      entry.actorPlatformRole ?? null,
      entry.actorTenantRole ?? null,
      entry.action,
      entry.entityType,
      entry.entityId,
      toJson(entry.before),
      toJson(entry.after),
      short(entry.reason, 500),
      short(entry.ipAddress, 45),
      short(entry.userAgent, 255),
    ],
  );
  return result.insertId;
}

/** Bóc thông tin người gọi từ request — để nơi gọi khỏi lặp lại bốn dòng này. */
export function actorFrom(req: Request): Pick<AuditEntry, 'ipAddress' | 'userAgent'> {
  return {
    ipAddress: req.ip ?? null,
    userAgent: req.get('user-agent') ?? null,
  };
}

/**
 * Email của người thực hiện, tra từ `users`.
 *
 * ─── Vì sao một truy vấn thêm thay vì nhét email vào token ─────────────────
 *
 * `req.auth` cố ý chỉ mang bốn trường (`userId`, `tenantId`, `role`,
 * `platformRole`) — xem `types/express.d.ts`. Nhồi email vào đó nghĩa là mọi
 * token đang lưu trên máy người dùng phải được cấp lại, và giá trị trong token
 * có thể cũ tới 7 ngày (`JWT_EXPIRES_IN`) — tức là nhật ký sẽ chụp lại một
 * email người đó đã đổi từ tuần trước.
 *
 * Một lần dò khoá chính, chỉ ở thao tác quản trị và tiền bạc (vài lần mỗi
 * ngày), đổi lấy một ảnh chụp ĐÚNG tại thời điểm hành động. Rẻ.
 *
 * `null` khi không tìm thấy: tài khoản vừa bị xoá cứng trong lúc request đang
 * chạy là chuyện gần như không xảy ra, nhưng ném ở đây sẽ giết một thao tác
 * hợp lệ vì một trường chỉ dùng để ghi chép.
 */
export async function actorEmailOf(db: Db, userId: number): Promise<string | null> {
  const [rows] = await db.query<(RowDataPacket & { email: string })[]>(
    'SELECT email FROM users WHERE id = ? LIMIT 1',
    [userId],
  );
  return rows[0]?.email ?? null;
}
