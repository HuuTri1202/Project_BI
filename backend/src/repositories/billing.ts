import type {
  OrderDetailDto,
  OrderDto,
  OrderStatus,
  PaymentMethodDto,
  PaymentProvider,
  PlanDto,
  SubscriptionDto,
  SubscriptionSource,
  SubscriptionStatus,
} from '@bi/shared';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

import type { Db } from './db';

/**
 * Gói dịch vụ, đơn hàng, subscription — §11.
 *
 * MỘT file cho cả khối, cùng lập luận đã ghi ở `repositories/datamodels.ts`:
 * không thao tác nào chạm `orders` mà không đi qua một gói, và không màn hình
 * nào hiện một subscription tách khỏi đơn sinh ra nó.
 *
 * Cùng khuôn tenant-scoped với phần còn lại: `db` là tham số đầu và KHÔNG có
 * giá trị mặc định (mặc định `mysqlPool` sẽ âm thầm cho câu lệnh thoát khỏi
 * transaction của nơi gọi), `tenantId` ngay sau đó.
 *
 * ⚠️ MỌI câu SELECT ở đây liệt kê cột TƯỜNG MINH, không dùng `SELECT *`. Hai
 * bảng có cột SINH (`payment_transactions.succeeded_order_id`,
 * `subscriptions.active_tenant_id`) và chúng sẽ lọt vào kết quả — mang theo một
 * trường không ai khai trong DTO, và với `exactOptionalPropertyTypes` thì đó là
 * loại lỗi chỉ lộ ra ở chỗ khác.
 */

// ─── Gói dịch vụ ─────────────────────────────────────────────────────────────

interface PlanRow extends RowDataPacket {
  id: number;
  code: string;
  name: string;
  description: string | null;
  price_vnd: number;
  duration_days: number;
  max_workspaces: number | null;
  max_reports: number | null;
  max_members: number | null;
  max_storage_bytes: number | null;
  is_public: number;
  is_featured: number;
  sort_order: number;
}

const PLAN_COLUMNS = `id, code, name, description, price_vnd, duration_days,
       max_workspaces, max_reports, max_members, max_storage_bytes,
       is_public, is_featured, sort_order`;

function toPlanDto(row: PlanRow): PlanDto {
  return {
    id: Number(row.id),
    code: row.code,
    name: row.name,
    description: row.description,
    priceVnd: Number(row.price_vnd),
    durationDays: Number(row.duration_days),
    // `null` giữ NGUYÊN là null — nó nghĩa là KHÔNG GIỚI HẠN. Đổi thành 0 ở đây
    // là biến gói đắt nhất thành gói không làm được gì.
    maxWorkspaces: row.max_workspaces === null ? null : Number(row.max_workspaces),
    maxReports: row.max_reports === null ? null : Number(row.max_reports),
    maxMembers: row.max_members === null ? null : Number(row.max_members),
    maxStorageBytes: row.max_storage_bytes === null ? null : Number(row.max_storage_bytes),
    isPublic: row.is_public === 1,
    isFeatured: row.is_featured === 1,
    sortOrder: Number(row.sort_order),
  };
}

/** Bảng giá công khai, theo đúng thứ tự người vận hành đã sắp. */
export async function listPublicPlans(db: Db): Promise<PlanDto[]> {
  const [rows] = await db.query<PlanRow[]>(
    `SELECT ${PLAN_COLUMNS} FROM plans
      WHERE deleted_at IS NULL AND is_public = 1
      ORDER BY sort_order ASC, id ASC`,
  );
  return rows.map(toPlanDto);
}

export async function findPlanById(db: Db, id: number): Promise<PlanDto | null> {
  const [rows] = await db.query<PlanRow[]>(
    `SELECT ${PLAN_COLUMNS} FROM plans WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    [id],
  );
  const row = rows[0];
  return row ? toPlanDto(row) : null;
}

/**
 * Gói theo mã — dùng cho phép suy "không subscription nào thì đang ở Free".
 *
 * KHÔNG lọc `is_public`: người vận hành ẩn gói Free khỏi trang bảng giá là
 * chuyện có thể xảy ra, và khi đó mọi tổ chức chưa mua gói sẽ mất hạn mức nếu
 * hàm này bỏ qua dòng đó.
 */
export async function findPlanByCode(db: Db, code: string): Promise<PlanDto | null> {
  const [rows] = await db.query<PlanRow[]>(
    `SELECT ${PLAN_COLUMNS} FROM plans WHERE code = ? AND deleted_at IS NULL LIMIT 1`,
    [code],
  );
  const row = rows[0];
  return row ? toPlanDto(row) : null;
}

// ─── Phương thức thanh toán ──────────────────────────────────────────────────

interface MethodRow extends RowDataPacket {
  id: number;
  code: string;
  provider: PaymentProvider;
  name: string;
  instructions: string | null;
  bank_bin: string | null;
  bank_account_no: string | null;
  bank_account_name: string | null;
  static_qr_url: string | null;
  is_active: number;
  sort_order: number;
}

/**
 * ⚠️ KHÔNG có `config_sealed` và `webhook_secret_sealed` trong danh sách này.
 *
 * Cùng luật đã áp cho `connections.password_cipher`: bí mật đi vào database thì
 * không đi ra qua API. Thêm chúng vào đây là đủ để chúng rò ra ngoài, vì
 * `toMethodDto` sẽ không ngăn được — nó chỉ ánh xạ những gì nó nhận.
 */
const METHOD_COLUMNS = `id, code, provider, name, instructions,
       bank_bin, bank_account_no, bank_account_name, static_qr_url,
       is_active, sort_order`;

/**
 * Phương thức đã ĐỦ thông tin để tạo đơn chưa.
 *
 * Tính ở backend chứ không để giao diện tự suy: luật khác nhau theo `provider`,
 * và hai nơi cùng suy sẽ lệch nhau ngay lần thêm cổng thứ hai.
 */
function isConfigured(row: MethodRow): boolean {
  if (row.provider === 'bank_transfer') {
    return (
      row.bank_bin !== null && row.bank_account_no !== null && row.bank_account_name !== null
    );
  }
  // Ba cổng còn lại chưa có adapter. Trả `false` để `createOrder` từ chối kèm
  // câu giải thích, thay vì tạo một đơn không bao giờ thanh toán được.
  return false;
}

function toMethodDto(row: MethodRow): PaymentMethodDto {
  return {
    id: Number(row.id),
    code: row.code,
    provider: row.provider,
    name: row.name,
    instructions: row.instructions,
    bankBin: row.bank_bin,
    bankAccountNo: row.bank_account_no,
    bankAccountName: row.bank_account_name,
    staticQrUrl: row.static_qr_url,
    isActive: row.is_active === 1,
    sortOrder: Number(row.sort_order),
    isConfigured: isConfigured(row),
  };
}

export async function listActivePaymentMethods(db: Db): Promise<PaymentMethodDto[]> {
  const [rows] = await db.query<MethodRow[]>(
    `SELECT ${METHOD_COLUMNS} FROM payment_methods
      WHERE deleted_at IS NULL AND is_active = 1
      ORDER BY sort_order ASC, id ASC`,
  );
  return rows.map(toMethodDto);
}

export async function findPaymentMethodById(
  db: Db,
  id: number,
): Promise<PaymentMethodDto | null> {
  const [rows] = await db.query<MethodRow[]>(
    `SELECT ${METHOD_COLUMNS} FROM payment_methods WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
    [id],
  );
  const row = rows[0];
  return row ? toMethodDto(row) : null;
}

// ─── Đơn hàng ────────────────────────────────────────────────────────────────

interface OrderRow extends RowDataPacket {
  id: number;
  order_code: string;
  status: OrderStatus;
  amount_vnd: number;
  plan_code: string;
  plan_name: string;
  plan_duration_days: number;
  method_name: string;
  provider: PaymentProvider;
  expires_at: Date;
  paid_at: Date | null;
  created_at: Date;
  qr_payload: string | null;
  bank_bin: string | null;
  bank_account_no: string | null;
  bank_account_name: string | null;
  instructions: string | null;
  note: string | null;
}

const ORDER_SELECT = `
  SELECT o.id, o.order_code, o.status, o.amount_vnd,
         o.plan_code, o.plan_name, o.plan_duration_days,
         pm.name AS method_name, pm.provider,
         o.expires_at, o.paid_at, o.created_at,
         o.qr_payload, pm.bank_bin, pm.bank_account_no, pm.bank_account_name,
         pm.instructions, o.note
    FROM orders o
    JOIN payment_methods pm ON pm.id = o.payment_method_id`;

function toOrderDto(row: OrderRow): OrderDto {
  return {
    id: Number(row.id),
    orderCode: row.order_code,
    status: row.status,
    amountVnd: Number(row.amount_vnd),
    planCode: row.plan_code,
    planName: row.plan_name,
    planDurationDays: Number(row.plan_duration_days),
    paymentMethodName: row.method_name,
    provider: row.provider,
    expiresAt: row.expires_at.toISOString(),
    paidAt: row.paid_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

function toOrderDetailDto(row: OrderRow): OrderDetailDto {
  return {
    ...toOrderDto(row),
    qrPayload: row.qr_payload,
    // Thông tin ngân hàng lấy từ phương thức HIỆN TẠI, còn `qr_payload` là ảnh
    // chụp lúc tạo đơn. Hai thứ có thể lệch nhau nếu người vận hành đổi tài
    // khoản — và khi đó thứ ĐÚNG là mã QR, vì đó là thứ khách đã quét. Giao
    // diện phải ưu tiên `qrPayload`; mấy dòng chữ dưới đây chỉ để đọc.
    bankBin: row.bank_bin,
    bankAccountNo: row.bank_account_no,
    bankAccountName: row.bank_account_name,
    instructions: row.instructions,
    note: row.note,
  };
}

export const ORDER_SORT_KEYS = ['createdAt', 'amount', 'status'] as const;
export type OrderSortKey = (typeof ORDER_SORT_KEYS)[number];

const ORDER_SORT_SQL: Record<OrderSortKey, string> = {
  createdAt: 'o.created_at',
  amount: 'o.amount_vnd',
  status: 'o.status',
};

export interface OrderFilter {
  status?: OrderStatus | undefined;
  sort: OrderSortKey;
  order: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

function orderWhere(tenantId: number, filter: OrderFilter): { sql: string; params: unknown[] } {
  const parts = ['o.tenant_id = ?'];
  const params: unknown[] = [tenantId];

  if (filter.status !== undefined) {
    parts.push('o.status = ?');
    params.push(filter.status);
  }

  return { sql: parts.join(' AND '), params };
}

export async function countOrders(
  db: Db,
  tenantId: number,
  filter: OrderFilter,
): Promise<number> {
  const w = orderWhere(tenantId, filter);
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM orders o WHERE ${w.sql}`,
    w.params,
  );
  return Number(rows[0]?.['total'] ?? 0);
}

export async function listOrders(
  db: Db,
  tenantId: number,
  filter: OrderFilter,
): Promise<OrderDto[]> {
  const w = orderWhere(tenantId, filter);
  const direction = filter.order === 'asc' ? 'ASC' : 'DESC';
  const [rows] = await db.query<OrderRow[]>(
    // Tie-breaker `o.id` bắt buộc: không có nó thì hai đơn cùng mốc thời gian
    // đổi chỗ giữa hai lần tải trang, và phân trang bỏ sót hoặc lặp bản ghi.
    `${ORDER_SELECT} WHERE ${w.sql}
      ORDER BY ${ORDER_SORT_SQL[filter.sort]} ${direction}, o.id DESC
      LIMIT ? OFFSET ?`,
    [...w.params, filter.pageSize, (filter.page - 1) * filter.pageSize],
  );
  return rows.map(toOrderDto);
}

/**
 * Tra đơn theo MÃ, trong phạm vi một tổ chức.
 *
 * `tenant_id` trong câu WHERE là thứ chặn đọc chéo tổ chức — mã đơn tuy khó
 * đoán nhưng nó vẫn hiện trên màn hình và trong sao kê, nên không được coi là
 * bí mật. Cùng nguyên tắc đã ghi ở `middleware/authorize.ts`: quyền trả lời
 * "vai trò này được xem đơn hàng", còn `WHERE tenant_id = ?` mới trả lời "đơn
 * SỐ NÀY có phải của họ không".
 */
export async function findOrderByCode(
  db: Db,
  tenantId: number,
  code: string,
): Promise<OrderDetailDto | null> {
  const [rows] = await db.query<OrderRow[]>(
    `${ORDER_SELECT} WHERE o.tenant_id = ? AND o.order_code = ? LIMIT 1`,
    [tenantId, code],
  );
  const row = rows[0];
  return row ? toOrderDetailDto(row) : null;
}

export interface CreateOrderRow {
  tenantId: number;
  orderCode: string;
  planId: number;
  paymentMethodId: number;
  amountVnd: number;
  planCode: string;
  planName: string;
  planDurationDays: number;
  qrPayload: string | null;
  expiresAt: Date;
  createdBy: number | null;
}

export async function insertOrder(db: Db, input: CreateOrderRow): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    `INSERT INTO orders
       (tenant_id, order_code, plan_id, payment_method_id, amount_vnd,
        plan_code, plan_name, plan_duration_days, qr_payload, expires_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.tenantId,
      input.orderCode,
      input.planId,
      input.paymentMethodId,
      input.amountVnd,
      input.planCode,
      input.planName,
      input.planDurationDays,
      input.qrPayload,
      input.expiresAt,
      input.createdBy,
    ],
  );
  return result.insertId;
}

/**
 * Đơn `pending` CÒN HẠN của tổ chức cho một gói.
 *
 * Dùng để không đẻ ra một đơn thứ hai khi người dùng bấm "Nâng cấp" hai lần
 * hoặc mở hai tab: mỗi đơn là một mã QR khác nhau, và hai mã cùng chờ tiền cho
 * một lần mua là chuyện người vận hành sẽ phải gỡ tay.
 */
export async function findLivePendingOrder(
  db: Db,
  tenantId: number,
  planId: number,
  now: Date,
): Promise<OrderDetailDto | null> {
  const [rows] = await db.query<OrderRow[]>(
    `${ORDER_SELECT}
      WHERE o.tenant_id = ? AND o.plan_id = ?
        AND o.status = 'pending' AND o.expires_at > ?
      ORDER BY o.id DESC LIMIT 1`,
    [tenantId, planId, now],
  );
  const row = rows[0];
  return row ? toOrderDetailDto(row) : null;
}

/**
 * Cho hết hạn những đơn `pending` đã quá giờ.
 *
 * Nhận `tenantId` tuỳ chọn để phục vụ CẢ hai đường: kiểm lười lúc người dùng mở
 * danh sách (bó theo tổ chức), và quét định kỳ toàn hệ thống (bỏ trống).
 *
 * Chỉ có quét định kỳ thì đơn vừa hết hạn ba giây vẫn hiện "đang chờ"; chỉ có
 * kiểm lười thì đơn không ai mở nằm `pending` vĩnh viễn và làm hỏng mọi thống
 * kê. Cần cả hai.
 */
export async function expireOverdueOrders(
  db: Db,
  now: Date,
  tenantId?: number,
): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    `UPDATE orders SET status = 'expired'
      WHERE status = 'pending' AND expires_at <= ?
        ${tenantId === undefined ? '' : 'AND tenant_id = ?'}`,
    tenantId === undefined ? [now] : [now, tenantId],
  );
  return result.affectedRows;
}

export async function cancelOrder(
  db: Db,
  tenantId: number,
  code: string,
): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    // Chỉ huỷ được đơn CÒN CHỜ. Một đơn đã trả tiền mà huỷ được là đường ngắn
    // nhất tới việc mất dấu một khoản tiền đã vào tài khoản.
    `UPDATE orders SET status = 'cancelled'
      WHERE tenant_id = ? AND order_code = ? AND status = 'pending'`,
    [tenantId, code],
  );
  return result.affectedRows;
}

// ─── Subscription ────────────────────────────────────────────────────────────

interface SubscriptionRow extends RowDataPacket {
  id: number;
  plan_code: string;
  plan_name: string;
  status: SubscriptionStatus;
  source: SubscriptionSource;
  price_vnd: number;
  period_start: Date;
  period_end: Date;
  carried_over_days: number;
}

const SUBSCRIPTION_COLUMNS = `id, plan_id, plan_code, plan_name, status, source,
       price_vnd, period_start, period_end, carried_over_days`;

function toSubscriptionDto(row: SubscriptionRow): SubscriptionDto {
  return {
    id: Number(row.id),
    planCode: row.plan_code,
    planName: row.plan_name,
    status: row.status,
    source: row.source,
    priceVnd: Number(row.price_vnd),
    periodStart: row.period_start.toISOString(),
    periodEnd: row.period_end.toISOString(),
    carriedOverDays: Number(row.carried_over_days),
  };
}

/**
 * Gói ĐANG hiệu lực của một tổ chức, hoặc `null` khi họ ở Free.
 *
 * `null` là câu trả lời BÌNH THƯỜNG, không phải lỗi: hệ thống cố ý không chèn
 * một dòng subscription Free mồi cho tổ chức mới — xem migration 30.
 *
 * Lọc cả `period_end > now` chứ không chỉ `status = 'active'`: con cron cho hết
 * hạn có thể chưa chạy, và một gói hết hạn từ hôm qua vẫn mang `status =
 * 'active'` trong khoảng thời gian đó. Tin vào mỗi cột `status` nghĩa là hạn
 * mức của khách phụ thuộc vào việc cron có chạy đúng giờ không.
 */
export async function findActiveSubscription(
  db: Db,
  tenantId: number,
  now: Date,
): Promise<(SubscriptionDto & { planId: number }) | null> {
  const [rows] = await db.query<(SubscriptionRow & { plan_id: number })[]>(
    `SELECT ${SUBSCRIPTION_COLUMNS} FROM subscriptions
      WHERE tenant_id = ? AND status = 'active' AND period_end > ?
      LIMIT 1`,
    [tenantId, now],
  );
  const row = rows[0];
  return row ? { ...toSubscriptionDto(row), planId: Number(row.plan_id) } : null;
}

export async function listSubscriptionHistory(
  db: Db,
  tenantId: number,
  limit: number,
): Promise<SubscriptionDto[]> {
  const [rows] = await db.query<SubscriptionRow[]>(
    `SELECT ${SUBSCRIPTION_COLUMNS} FROM subscriptions
      WHERE tenant_id = ?
      ORDER BY period_start DESC, id DESC
      LIMIT ?`,
    [tenantId, limit],
  );
  return rows.map(toSubscriptionDto);
}
