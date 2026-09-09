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

import { open } from '../services/connections/secretBox';
import { escapeLikeTerm } from '../utils/sql';
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

  /*
   * MoMo chạy bằng mã QR TĨNH: đủ điều kiện khi đã có ảnh.
   *
   * Không đòi partner code hay secret key, vì bản này không gọi API MoMo — xem
   * migration 31. Khách quét ảnh, tự nhập số tiền, ghi mã đơn vào lời nhắn, rồi
   * người vận hành đối chiếu và xác nhận.
   *
   * Đánh đổi phải nói ra: số tiền do KHÁCH nhập chứ không nằm sẵn trong mã như
   * VietQR động, nên chuyển nhầm số là chuyện sẽ xảy ra. Đó là lý do ô "số tiền
   * thực nhận" ở màn xác nhận sửa được, và vì sao nó điền sẵn chứ không khoá.
   */
  if (row.provider === 'momo') return row.static_qr_url !== null;

  // PayOS và Sepay chưa có adapter. Trả `false` để `createOrder` từ chối kèm
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
    /*
     * ĐƯỜNG DẪN API, không phải khoá lưu trữ.
     *
     * Cột trong database giữ khoá object trên MinIO (`billing/qr/<uuid>.png`).
     * Đưa khoá đó ra ngoài là lộ cấu trúc bucket cho mọi người dùng, và cũng vô
     * ích — trình duyệt không nói chuyện với MinIO được (nó nằm trong mạng
     * Docker nội bộ, và cố ý không publish ra ngoài).
     *
     * Nên DTO mang một đường dẫn về chính API này, và ảnh đi qua Express. Với
     * một file vài chục KB tải một lần thì đó là cái giá đúng để đổi lấy việc
     * ảnh vẫn nằm sau lớp xác thực.
     */
    staticQrUrl:
      row.static_qr_url === null ? null : `/v1/payment-methods/${String(row.id)}/qr`,
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
  payment_method_id: number;
  static_qr_url: string | null;
}

const ORDER_SELECT = `
  SELECT o.id, o.order_code, o.status, o.amount_vnd,
         o.plan_code, o.plan_name, o.plan_duration_days,
         pm.name AS method_name, pm.provider,
         o.expires_at, o.paid_at, o.created_at,
         o.qr_payload, pm.bank_bin, pm.bank_account_no, pm.bank_account_name,
         pm.instructions, o.note,
         o.payment_method_id, pm.static_qr_url
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
    // Đường dẫn API, cùng lý lẽ với `toMethodDto`: khoá object trên MinIO
    // không đi ra ngoài, và trình duyệt không nói chuyện với MinIO được.
    staticQrUrl:
      row.static_qr_url === null
        ? null
        : `/v1/payment-methods/${String(row.payment_method_id)}/qr`,
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

// ─── Console vận hành: xuyên MỌI tổ chức ─────────────────────────────────────
//
// Mọi hàm dưới đây CỐ Ý không nhận `tenantId` — chúng phục vụ `/api/admin`, nơi
// đã gác bằng `requirePlatformRole('superadmin') + requireFreshAdmin`. Đặt
// chúng cùng file với hàm theo-tổ-chức là chủ ý: hai nhóm nằm cạnh nhau thì
// người sửa thấy ngay mình đang ở nhóm nào, còn tách hai file thì rất dễ gọi
// nhầm hàm xuyên-tổ-chức từ một route của người dùng.

interface AdminOrderRow extends RowDataPacket {
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
  tenant_id: number;
  tenant_name: string;
  txn_ref: string | null;
}

const ADMIN_ORDER_SELECT = `
  SELECT o.id, o.order_code, o.status, o.amount_vnd,
         o.plan_code, o.plan_name, o.plan_duration_days,
         pm.name AS method_name, pm.provider,
         o.expires_at, o.paid_at, o.created_at,
         o.tenant_id, t.name AS tenant_name,
         (SELECT pt.provider_txn_ref FROM payment_transactions pt
           WHERE pt.order_id = o.id AND pt.status = 'succeeded'
           LIMIT 1) AS txn_ref
    FROM orders o
    JOIN payment_methods pm ON pm.id = o.payment_method_id
    JOIN tenants t ON t.id = o.tenant_id`;

export interface AdminOrderDto extends OrderDto {
  tenantId: number;
  tenantName: string;
  /** Số tham chiếu của giao dịch đã ghi nhận. `null` khi chưa có. */
  providerTxnRef: string | null;
}

function toAdminOrderDto(row: AdminOrderRow): AdminOrderDto {
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
    tenantId: Number(row.tenant_id),
    tenantName: row.tenant_name,
    providerTxnRef: row.txn_ref,
  };
}

export interface AdminOrderFilter {
  status?: OrderStatus | undefined;
  tenantId?: number | undefined;
  provider?: PaymentProvider | undefined;
  /** Tìm theo mã đơn hoặc tên tổ chức. */
  search?: string | undefined;
  sort: OrderSortKey;
  order: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

function adminOrderWhere(filter: AdminOrderFilter): { sql: string; params: unknown[] } {
  const parts: string[] = ['1 = 1'];
  const params: unknown[] = [];

  if (filter.status !== undefined) {
    parts.push('o.status = ?');
    params.push(filter.status);
  }
  if (filter.tenantId !== undefined) {
    parts.push('o.tenant_id = ?');
    params.push(filter.tenantId);
  }
  if (filter.provider !== undefined) {
    parts.push('pm.provider = ?');
    params.push(filter.provider);
  }
  if (filter.search !== undefined && filter.search !== '') {
    parts.push("(o.order_code LIKE ? ESCAPE '\\\\' OR t.name LIKE ? ESCAPE '\\\\')");
    const term = `%${escapeLikeTerm(filter.search)}%`;
    params.push(term, term);
  }

  return { sql: parts.join(' AND '), params };
}

export async function countAdminOrders(db: Db, filter: AdminOrderFilter): Promise<number> {
  const w = adminOrderWhere(filter);
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total
       FROM orders o
       JOIN payment_methods pm ON pm.id = o.payment_method_id
       JOIN tenants t ON t.id = o.tenant_id
      WHERE ${w.sql}`,
    w.params,
  );
  return Number(rows[0]?.['total'] ?? 0);
}

export async function listAdminOrders(
  db: Db,
  filter: AdminOrderFilter,
): Promise<AdminOrderDto[]> {
  const w = adminOrderWhere(filter);
  const direction = filter.order === 'asc' ? 'ASC' : 'DESC';
  const [rows] = await db.query<AdminOrderRow[]>(
    `${ADMIN_ORDER_SELECT} WHERE ${w.sql}
      ORDER BY ${ORDER_SORT_SQL[filter.sort]} ${direction}, o.id DESC
      LIMIT ? OFFSET ?`,
    [...w.params, filter.pageSize, (filter.page - 1) * filter.pageSize],
  );
  return rows.map(toAdminOrderDto);
}

/** MỌI gói, kể cả gói đã ẩn — console phải thấy thứ nó quản. */
export async function listAllPlans(db: Db): Promise<PlanDto[]> {
  const [rows] = await db.query<PlanRow[]>(
    `SELECT ${PLAN_COLUMNS} FROM plans
      WHERE deleted_at IS NULL
      ORDER BY sort_order ASC, id ASC`,
  );
  return rows.map(toPlanDto);
}

export async function listAllPaymentMethods(db: Db): Promise<PaymentMethodDto[]> {
  const [rows] = await db.query<MethodRow[]>(
    `SELECT ${METHOD_COLUMNS} FROM payment_methods
      WHERE deleted_at IS NULL
      ORDER BY sort_order ASC, id ASC`,
  );
  return rows.map(toMethodDto);
}

/**
 * Bốn ký tự cuối của khoá bí mật, để màn hình quản trị xác nhận "đúng khoá này".
 *
 * ⚠️ Trả về BỐN ký tự, không nhiều hơn. Đủ để người vận hành nhận ra khoá họ vừa
 * dán, không đủ để ai đó dựng lại nó. Và trả `null` khi chưa cấu hình — khác
 * hẳn chuỗi rỗng, vì giao diện phải nói được "chưa có khoá" thay vì "khoá rỗng".
 */
/**
 * Khoá object THẬT của ảnh QR — chỉ dùng để đọc file, không đưa ra ngoài.
 *
 * Tách khỏi `toMethodDto` (nơi cột này thành một đường dẫn API) vì hai nơi cần
 * hai thứ khác nhau: giao diện cần đường để tải ảnh, còn route phục vụ ảnh cần
 * khoá để hỏi MinIO. Trộn lại thì một trong hai sẽ nhận nhầm.
 */
export async function qrObjectKey(db: Db, id: number): Promise<string | null> {
  const [rows] = await db.query<(RowDataPacket & { static_qr_url: string | null })[]>(
    'SELECT static_qr_url FROM payment_methods WHERE id = ? AND deleted_at IS NULL LIMIT 1',
    [id],
  );
  return rows[0]?.static_qr_url ?? null;
}

export async function paymentSecretHint(db: Db, id: number): Promise<string | null> {
  const [rows] = await db.query<(RowDataPacket & { webhook_secret_sealed: string | null })[]>(
    'SELECT webhook_secret_sealed FROM payment_methods WHERE id = ? LIMIT 1',
    [id],
  );
  const sealed = rows[0]?.webhook_secret_sealed ?? null;
  if (sealed === null || sealed === '') return null;

  try {
    const plain = open(sealed);
    return plain.length <= 4 ? '****' : plain.slice(-4);
  } catch {
    // Giải mã hỏng: khoá mã hoá đã đổi, hoặc dữ liệu bị can thiệp. Nói ra bằng
    // một giá trị riêng thay vì để giao diện tưởng chưa cấu hình.
    return '????';
  }
}

export async function insertPlan(db: Db, input: PlanWriteInput): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    `INSERT INTO plans
       (code, name, description, price_vnd, duration_days,
        max_workspaces, max_reports, max_members, max_storage_bytes,
        is_public, is_featured, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.code,
      input.name,
      input.description,
      input.priceVnd,
      input.durationDays,
      input.maxWorkspaces,
      input.maxReports,
      input.maxMembers,
      input.maxStorageBytes,
      input.isPublic ? 1 : 0,
      input.isFeatured ? 1 : 0,
      input.sortOrder,
    ],
  );
  return result.insertId;
}

export interface PlanWriteInput {
  code: string;
  name: string;
  description: string | null;
  priceVnd: number;
  durationDays: number;
  maxWorkspaces: number | null;
  maxReports: number | null;
  maxMembers: number | null;
  maxStorageBytes: number | null;
  isPublic: boolean;
  isFeatured: boolean;
  sortOrder: number;
}

export async function updatePlan(
  db: Db,
  id: number,
  input: Omit<PlanWriteInput, 'code'>,
): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    `UPDATE plans
        SET name = ?, description = ?, price_vnd = ?, duration_days = ?,
            max_workspaces = ?, max_reports = ?, max_members = ?, max_storage_bytes = ?,
            is_public = ?, is_featured = ?, sort_order = ?
      WHERE id = ? AND deleted_at IS NULL`,
    [
      input.name,
      input.description,
      input.priceVnd,
      input.durationDays,
      input.maxWorkspaces,
      input.maxReports,
      input.maxMembers,
      input.maxStorageBytes,
      input.isPublic ? 1 : 0,
      input.isFeatured ? 1 : 0,
      input.sortOrder,
      id,
    ],
  );
  return result.affectedRows;
}

/**
 * Xoá MỀM một gói, và ẩn nó khỏi bảng giá cùng lúc.
 *
 * Xoá cứng không làm được: `fk_orders_plan` là RESTRICT, cố ý — đó là thứ giữ
 * cho ảnh chụp trong đơn cũ vẫn trỏ tới một dòng có thật. Đặt `is_public = 0`
 * cùng lúc vì `listPublicPlans` lọc theo cả hai, và để một gói "đã xoá" mà vẫn
 * `is_public = 1` là một trạng thái tự mâu thuẫn nằm chờ ai đó đọc nhầm.
 */
export async function softDeletePlan(db: Db, id: number): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    `UPDATE plans SET deleted_at = CURRENT_TIMESTAMP(3), is_public = 0
      WHERE id = ? AND deleted_at IS NULL`,
    [id],
  );
  return result.affectedRows;
}

export interface MethodWriteInput {
  name?: string | undefined;
  instructions?: string | null | undefined;
  bankBin?: string | null | undefined;
  bankAccountNo?: string | null | undefined;
  bankAccountName?: string | null | undefined;
  /** ĐÃ seal. Repository không mã hoá — xem route. */
  webhookSecretSealed?: string | null | undefined;
  /** KHOÁ object trên MinIO, không phải URL. Route lo việc tải file lên. */
  staticQrKey?: string | null | undefined;
  isActive?: boolean | undefined;
  sortOrder?: number | undefined;
}

/**
 * Sửa phương thức thanh toán — trường VẮNG MẶT thì giữ nguyên.
 *
 * Ghép mệnh đề SET động thay vì ghi đè cả dòng: bắt gửi lại khoá bí mật mỗi lần
 * đổi tên hiển thị nghĩa là ai muốn sửa một chữ cũng phải biết khoá API. Cùng
 * lý lẽ đã ghi cho `updateColumn` và cho `updateConnection` của §8.
 */
export async function updatePaymentMethod(
  db: Db,
  id: number,
  input: MethodWriteInput,
): Promise<number> {
  const sets: string[] = [];
  const params: unknown[] = [];

  const push = (col: string, value: unknown): void => {
    sets.push(`${col} = ?`);
    params.push(value);
  };

  if (input.name !== undefined) push('name', input.name);
  if (input.instructions !== undefined) push('instructions', input.instructions);
  if (input.bankBin !== undefined) push('bank_bin', input.bankBin);
  if (input.bankAccountNo !== undefined) push('bank_account_no', input.bankAccountNo);
  if (input.bankAccountName !== undefined) push('bank_account_name', input.bankAccountName);
  if (input.webhookSecretSealed !== undefined)
    push('webhook_secret_sealed', input.webhookSecretSealed);
  if (input.staticQrKey !== undefined) push('static_qr_url', input.staticQrKey);
  if (input.isActive !== undefined) push('is_active', input.isActive ? 1 : 0);
  if (input.sortOrder !== undefined) push('sort_order', input.sortOrder);

  // Không có gì để sửa thì đừng chạy `SET` rỗng — MySQL báo lỗi cú pháp, và
  // thông báo đó chẳng nói gì về việc body request trống.
  if (sets.length === 0) return 0;

  const [result] = await db.query<ResultSetHeader>(
    `UPDATE payment_methods SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`,
    [...params, id],
  );
  return result.affectedRows;
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
