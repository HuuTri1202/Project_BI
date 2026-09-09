/**
 * Gói dịch vụ và thanh toán — §11.
 *
 * ═══ Tiền là SỐ NGUYÊN ĐỒNG, không bao giờ là số thực ═══════════════════════
 *
 * Mọi trường tiền trong file này là `number` mang đơn vị ĐỒNG, và tên trường
 * luôn có hậu tố `Vnd` để không ai phải đoán. Ba điều đi kèm, cả ba đều là ràng
 * buộc chứ không phải khuyến nghị:
 *
 *   1. VND không có đơn vị phụ, nên KHÔNG nhân 100 như cách quen thuộc với USD.
 *      299000 nghĩa là hai trăm chín mươi chín nghìn đồng.
 *   2. Cột trong MySQL là `BIGINT UNSIGNED`, không phải `DECIMAL`. Pool ở
 *      `config/mysql.ts` không bật `decimalNumbers`, nên mysql2 trả mọi cột
 *      DECIMAL — và mọi kết quả `SUM()` — dưới dạng CHUỖI. `"299000" + "199000"`
 *      cho ra `"299000199000"`: chạy được, hiện ra màn hình được, và sai.
 *   3. Không có trường `currency`. Một trường chỉ từng mang đúng một giá trị là
 *      một trường nói dối — nó tạo cảm giác hệ thống đa tiền tệ trong khi mọi
 *      phép cộng đều cộng mù. Hậu tố trong tên đắt bằng không.
 *
 * ═══ Hai mặt phẳng, đừng trộn ══════════════════════════════════════════════
 *
 *   NGƯỜI DÙNG   `/api/v1/billing/*`  — tổ chức xem gói của chính mình, tạo đơn.
 *                Gác bằng Casbin: `authorize('billing', …)`.
 *   VẬN HÀNH     `/api/admin/billing/*` — đặt giá, duyệt giao dịch, xem đơn của
 *                MỌI tổ chức. Gác bằng trục nền tảng (`users.role`), KHÔNG qua
 *                Casbin — superadmin đứng ngoài mọi tổ chức.
 */

// ─── Từ vựng ─────────────────────────────────────────────────────────────────

/**
 * Cổng thanh toán. Khai đủ bốn ngay từ đầu dù bản này chỉ chạy `bank_transfer`.
 *
 * ⚠️ Thứ tự ĐÓNG BĂNG, khớp ENUM trong MySQL. Giá trị mới nối vào CUỐI — MySQL
 * lưu ENUM theo số thứ tự, nên chèn vào giữa là viết lại toàn bộ dữ liệu bảng.
 */
export const PAYMENT_PROVIDERS = ['bank_transfer', 'payos', 'sepay', 'momo'] as const;
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

export const PAYMENT_PROVIDER_LABELS: Record<PaymentProvider, string> = {
  bank_transfer: 'Chuyển khoản ngân hàng',
  payos: 'PayOS',
  sepay: 'Sepay',
  momo: 'MoMo',
};

/**
 * Trạng thái đơn hàng.
 *
 * ─── Vì sao chữ thường, khác đề bài ────────────────────────────────────────
 *
 * Toàn bộ ENUM của repo là chữ thường (`'shared'`, `'admin'`, `'superadmin'`).
 * Một bảng viết hoa giữa mười lăm bảng viết thường là chỗ mọi người sẽ gõ nhầm
 * mãi mãi. Chữ hoa nếu cần là việc của tầng hiển thị.
 *
 * ─── Vì sao có `cancelled`, khác đề bài ────────────────────────────────────
 *
 * `failed` nghĩa là cổng thanh toán TỪ CHỐI. `cancelled` nghĩa là khách ĐỔI Ý.
 * Trộn hai thứ đó vào một giá trị làm mọi biểu đồ tỷ lệ thất bại thành vô nghĩa,
 * và không có cách nào tách lại sau khi dữ liệu đã lẫn.
 */
export const ORDER_STATUSES = [
  /** Vừa tạo, đang chờ khách chuyển tiền. Hết hạn sau `expiresAt`. */
  'pending',
  /** Khách báo đã chuyển; đang chờ người vận hành đối chiếu sao kê. */
  'awaiting_confirmation',
  'paid',
  /** Cổng thanh toán từ chối. KHÁC `cancelled`. */
  'failed',
  'expired',
  'refunded',
  /** Khách tự huỷ. KHÁC `failed`. */
  'cancelled',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'Chờ thanh toán',
  awaiting_confirmation: 'Chờ đối chiếu',
  paid: 'Đã thanh toán',
  failed: 'Thất bại',
  expired: 'Hết hạn',
  refunded: 'Đã hoàn tiền',
  cancelled: 'Đã huỷ',
};

/**
 * Những trạng thái CÒN SỐNG — đơn vẫn có thể đổi trạng thái mà không cần thao
 * tác mới của khách.
 *
 * Giao diện dùng đúng danh sách này để quyết định có tiếp tục hỏi lại server
 * hay không. Viết lại danh sách ở phía giao diện là cách nó lệch dần: thêm một
 * trạng thái mới ở đây mà quên bên kia thì màn hình đứng im vĩnh viễn ở một đơn
 * vẫn đang chạy. Cùng khuôn với `LOAD_STATUSES_LIVE` của §9.
 */
export const ORDER_STATUSES_LIVE: readonly OrderStatus[] = ['pending', 'awaiting_confirmation'];

/** Đơn đã kết thúc, không đổi trạng thái nữa trừ khi hoàn tiền. */
export const ORDER_STATUSES_FINAL: readonly OrderStatus[] = [
  'paid',
  'failed',
  'expired',
  'refunded',
  'cancelled',
];

export const SUBSCRIPTION_STATUSES = [
  'active',
  /** Hết hạn tự nhiên. */
  'expired',
  /** Bị một gói mới thay thế trước khi hết hạn (nâng cấp giữa chu kỳ). */
  'superseded',
  'cancelled',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const SUBSCRIPTION_SOURCES = ['purchase', 'admin_override'] as const;
export type SubscriptionSource = (typeof SUBSCRIPTION_SOURCES)[number];

/** Chu kỳ người dùng chọn ở trang bảng giá. Quy ra `plans.durationDays`. */
export const BILLING_CYCLES = ['monthly', 'yearly'] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

export const PLAN_CODE_MAX = 50;
export const PLAN_NAME_MAX = 255;

/**
 * Trần tiền, khớp `CHECK` trong migration.
 *
 * Không phải để chống tràn số (`Number.MAX_SAFE_INTEGER` còn xa) mà để một lỗi
 * nhân sai đơn vị — nhân 1000 lặp lại là lỗi kinh điển khi làm việc với VND —
 * nổ ngay tại `INSERT` thay vì thành một đơn 299 tỷ đồng nằm chờ admin duyệt.
 */
export const AMOUNT_VND_MAX = 100_000_000_000;

// ─── Mã lỗi ──────────────────────────────────────────────────────────────────

export const BILLING_ERROR_CODES = {
  /** Gói không tồn tại, đã xoá mềm, hoặc `is_public = 0`. */
  PLAN_UNAVAILABLE: 'PlanUnavailable',
  /** Phương thức thanh toán đã tắt hoặc không tồn tại. */
  PAYMENT_METHOD_UNAVAILABLE: 'PaymentMethodUnavailable',
  /**
   * Phương thức có tồn tại nhưng người vận hành CHƯA điền đủ thông tin.
   *
   * Tách khỏi `PAYMENT_METHOD_UNAVAILABLE` vì hai bên phải làm hai việc khác
   * hẳn nhau: một bên là khách chọn nhầm, bên kia là người vận hành còn nợ một
   * bước cấu hình. Gộp lại thì thông báo phải chung chung tới mức không ai biết
   * phải đi hỏi ai.
   */
  PAYMENT_METHOD_NOT_CONFIGURED: 'PaymentMethodNotConfigured',
  /** Tổ chức đã có một đơn `pending` cho cùng gói — không tạo thêm. */
  ORDER_ALREADY_PENDING: 'OrderAlreadyPending',
  ORDER_NOT_FOUND: 'OrderNotFound',
  /** Thao tác không hợp lệ với trạng thái hiện tại của đơn. */
  ORDER_STATE_INVALID: 'OrderStateInvalid',
  /** Số tham chiếu giao dịch đã dùng cho một đơn khác. */
  TRANSACTION_DUPLICATE: 'TransactionDuplicate',
  /** Đơn này đã được ghi nhận thanh toán rồi. Chặn bởi UNIQUE của database. */
  ORDER_ALREADY_PAID: 'OrderAlreadyPaid',
  /** Chữ ký webhook không khớp. Sự kiện vẫn được lưu lại. */
  WEBHOOK_SIGNATURE_INVALID: 'WebhookSignatureInvalid',
} as const;

export type BillingErrorCode = (typeof BILLING_ERROR_CODES)[keyof typeof BILLING_ERROR_CODES];

// ─── DTO ─────────────────────────────────────────────────────────────────────

export interface PlanDto {
  id: number;
  /** Khoá tra cứu ổn định trong code (`'free'`, `'pro'`). Khác `id` tự tăng. */
  code: string;
  name: string;
  description: string | null;
  priceVnd: number;
  /**
   * Số NGÀY của một chu kỳ, không phải "1 tháng".
   *
   * Cộng 30 ngày không có trường hợp biên nào; "cộng một tháng" từ ngày 31/01
   * thì mỗi thư viện trả lời một kiểu. Đánh đổi đã chấp nhận: chu kỳ trôi dần
   * khỏi một ngày cố định trong tháng.
   */
  durationDays: number;
  /** `null` = KHÔNG GIỚI HẠN. Không dùng `0` — nó mang hai nghĩa đối nghịch. */
  maxWorkspaces: number | null;
  maxReports: number | null;
  maxMembers: number | null;
  maxStorageBytes: number | null;
  isPublic: boolean;
  /** Gói được tô nổi trên trang bảng giá. */
  isFeatured: boolean;
  sortOrder: number;
}

/**
 * Phương thức thanh toán như NGƯỜI DÙNG thấy.
 *
 * ⚠️ KHÔNG có `configSealed` hay `webhookSecretSealed`, và không bao giờ được
 * có. Cùng luật đã áp cho `connections.password_cipher`: bí mật đi vào database
 * thì không đi ra qua API. Màn hình quản trị chỉ hiện bốn ký tự cuối, và chuỗi
 * đó do backend cắt sẵn.
 */
export interface PaymentMethodDto {
  id: number;
  code: string;
  provider: PaymentProvider;
  name: string;
  instructions: string | null;
  /** Ngân hàng nhận tiền — công khai, vì nó được in lên chính mã QR. */
  bankBin: string | null;
  bankAccountNo: string | null;
  bankAccountName: string | null;
  staticQrUrl: string | null;
  isActive: boolean;
  sortOrder: number;
  /**
   * Đã điền đủ thông tin để tạo đơn chưa.
   *
   * Backend tính, không để giao diện tự suy: luật "đủ thông tin" khác nhau theo
   * `provider` (chuyển khoản cần số tài khoản, PayOS cần API key), và hai nơi
   * cùng suy sẽ lệch nhau ngay lần thêm cổng thứ hai.
   */
  isConfigured: boolean;
}

export interface OrderDto {
  id: number;
  /** Mã hiện cho khách, và cũng là NỘI DUNG CHUYỂN KHOẢN. Không có mã thứ hai. */
  orderCode: string;
  status: OrderStatus;
  amountVnd: number;
  /** Ảnh chụp lúc tạo đơn — đơn cũ giữ đúng gói và đúng giá dù bảng giá đã đổi. */
  planCode: string;
  planName: string;
  planDurationDays: number;
  paymentMethodName: string;
  provider: PaymentProvider;
  /** ISO 8601. Mốc TUYỆT ĐỐI, giao diện không phải tự cộng thêm luật nào. */
  expiresAt: string;
  paidAt: string | null;
  createdAt: string;
}

/** Chi tiết một đơn, kèm thứ cần để hiện màn hình thanh toán. */
export interface OrderDetailDto extends OrderDto {
  /**
   * Chuỗi EMVCo của mã QR, đã chốt lúc tạo đơn.
   *
   * Đóng băng đúng số tài khoản khách đã quét: nếu người vận hành đổi số tài
   * khoản tuần sau, đơn cũ vẫn hiện đúng thứ khách đã thấy. Đây là bằng chứng,
   * không phải cache.
   */
  qrPayload: string | null;
  /**
   * Ảnh QR TĨNH của phương thức (MoMo) — đường dẫn API, không phải URL công khai.
   *
   * ─── Vì sao có HAI trường mã QR ────────────────────────────────────────
   *
   * Chúng là hai thứ khác nhau về bản chất, không phải hai cách lưu một thứ:
   *
   *   `qrPayload`    chuỗi EMVCo sinh RIÊNG cho đơn này, đã mang sẵn số tiền
   *                  và mã đơn. Khách quét là xong — không gõ gì thêm.
   *   `staticQrUrl`  ảnh QR nhận tiền CỐ ĐỊNH của người vận hành. Khách phải
   *                  tự nhập số tiền và tự ghi mã đơn vào lời nhắn.
   *
   * Đúng một trong hai có giá trị. Cái đầu tốt hơn hẳn và là lý do VietQR được
   * chọn làm đường chính; cái sau tồn tại vì MoMo không cho sinh QR động nếu
   * chưa có tài khoản merchant.
   */
  staticQrUrl: string | null;
  bankBin: string | null;
  bankAccountNo: string | null;
  bankAccountName: string | null;
  instructions: string | null;
  note: string | null;
}

export interface SubscriptionDto {
  id: number;
  planCode: string;
  planName: string;
  status: SubscriptionStatus;
  source: SubscriptionSource;
  priceVnd: number;
  periodStart: string;
  periodEnd: string;
  /** Số ngày còn lại của gói cũ được cộng sang — để màn hình giải thích được. */
  carriedOverDays: number;
}

/** Mức sử dụng thật so với hạn mức của gói. `limit: null` = không giới hạn. */
export interface UsageItemDto {
  used: number;
  limit: number | null;
}

export interface BillingUsageDto {
  workspaces: UsageItemDto;
  reports: UsageItemDto;
  /**
   * Dung lượng, đơn vị BYTE (không phải GB — quy đổi ở tầng hiển thị).
   *
   * ⚠️ Con số này gom theo OBJECT LƯU TRỮ chứ không cộng thẳng từng dataset:
   * một file Excel nhiều sheet sinh nhiều dataset dùng CHUNG một `s3_key`, nên
   * cộng thẳng thì một file 50MB ba sheet thành 150MB và khách bị báo vượt hạn
   * mức vì một phép cộng. Xem `repositories/usage.ts`.
   */
  storageBytes: UsageItemDto;
}

/**
 * Trang Billing của một tổ chức, một lần gọi.
 *
 * `subscription: null` nghĩa là tổ chức đang ở gói **Free** — không phải "chưa
 * tải xong" và cũng không phải lỗi. Hệ thống cố ý KHÔNG chèn một dòng
 * subscription Free mồi cho tổ chức mới: bất biến "mọi tổ chức đều có một dòng"
 * phải được móc vào mọi đường tạo tổ chức và sẽ hỏng ở đường bị quên, nên nhánh
 * "không có dòng" dù sao cũng phải viết. `plan` luôn có mặt và mang gói đang
 * hiệu lực — Free khi `subscription` là `null`.
 */
export interface BillingSummaryDto {
  plan: PlanDto;
  subscription: SubscriptionDto | null;
  usage: BillingUsageDto;
}

// ─── Input ───────────────────────────────────────────────────────────────────

export interface CreateOrderInput {
  planId: number;
  paymentMethodId: number;
  cycle: BillingCycle;
}

export interface ConfirmOrderInput {
  /**
   * Số tham chiếu giao dịch trên sao kê ngân hàng. BẮT BUỘC, không có ô trống.
   *
   * Hai việc trong một trường: nó là khoá idempotency thật ở tầng database
   * (`UNIQUE (provider, provider_txn_ref)`), và nó khiến mọi lần xác nhận tay
   * truy ngược được về một dòng sao kê cụ thể khi có tranh chấp.
   */
  providerTxnRef: string;
  /** Số tiền THỰC NHẬN. Có thể lệch với `amountVnd` của đơn — cố ý cho phép. */
  amountVnd: number;
  reason?: string | undefined;
}
