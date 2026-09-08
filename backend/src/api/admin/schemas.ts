import {
  AMOUNT_VND_MAX,
  ORDER_STATUSES,
  PAYMENT_PROVIDERS,
  PLAN_CODE_MAX,
  PLAN_NAME_MAX,
} from '@bi/shared';
import { z } from 'zod';
import { TENANT_SORT_KEYS, USER_SORT_KEYS } from '../../repositories/platform';
import { paginationSchema } from '../../utils/pagination';

/**
 * Schema request của console hệ thống.
 *
 * Ở BACKEND chứ không phải `@bi/shared`, vì `paginationSchema` dùng
 * `z.coerce.number()` — query string luôn là chuỗi nên buộc phải ép kiểu, mà ép
 * kiểu là transform, và luật ghi trong `shared/src/auth.ts` là schema dùng chung
 * chỉ được validate chứ không transform.
 *
 * Router gọi `.parse()` rồi để `ZodError` bay lên; `errorHandler` có nhánh riêng
 * đổi nó thành 400 kèm map lỗi theo trường.
 *
 * `sort` cố ý để `z.string()` chứ không phải `z.enum(...)`: việc đối chiếu
 * whitelist giao cho `resolveSortColumn` để có thông báo lỗi do ta viết, và để
 * giữ đúng MỘT chỗ quyết định cột nào được đi vào `ORDER BY`.
 */

const statusFilter = z.enum(['active', 'locked']).optional();

/**
 * Loại tổ chức: công ty thật / không gian cá nhân / cả hai.
 *
 * `.optional()` và bỏ trống KHÔNG có nghĩa là "tất cả" — repository hiểu là
 * `org`. Xem `tenantWhere` để biết vì sao mặc định phải là loại hẹp nhất.
 */
const kindFilter = z.enum(['org', 'personal', 'all']).optional();

export const listTenantsQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(100).optional(),
  status: statusFilter,
  kind: kindFilter,
  sort: z.string().optional(),
});

export const listUsersQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(100).optional(),
  tenantId: z.coerce.number().int().positive().optional(),
  status: statusFilter,
  platformRole: z.enum(['superadmin', 'user']).optional(),
  sort: z.string().optional(),
});

export const listWorkspacesQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(100).optional(),
  tenantId: z.coerce.number().int().positive().optional(),
  status: statusFilter,
  kind: kindFilter,
});

export const setActiveBodySchema = z.object({
  isActive: z.boolean(),
});

/**
 * Tham số id trên URL.
 *
 * Ép sang số ngay ở đây để mọi so sánh phía sau đúng kiểu — `'3' === 3` là false,
 * và luật chống-tự-sửa-mình dựa vào đúng phép so sánh đó. Lỗi im lặng, và im
 * lặng ở chỗ nguy hiểm nhất.
 */
export const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

/** Chỉ để nhắc rằng hai danh sách whitelist phải khớp nhau; không dùng lúc chạy. */
export const SORT_KEYS_FOR_DOCS = { TENANT_SORT_KEYS, USER_SORT_KEYS };

// ─── §11 Gói dịch vụ & thanh toán ────────────────────────────────────────────

/**
 * Tiền: SỐ NGUYÊN ĐỒNG, có trần.
 *
 * Trần khớp `ck_plans_price_sane` trong migration 30 — không phải để chống tràn
 * số (`Number.MAX_SAFE_INTEGER` còn xa) mà để bắt lỗi nhân sai đơn vị. Nhân
 * 1000 lặp lại là lỗi kinh điển khi làm việc với VND, và không có trần thì nó
 * thành một gói giá 299 tỷ nằm trên bảng giá công khai.
 *
 * `z.number()` chứ không `z.coerce.number()`: đây là body JSON thật, nên kiểu
 * số gốc là đủ. `coerce` sẽ nuốt cả chuỗi `"abc"` thành `NaN` rồi để `.int()`
 * bắt — một vòng thừa với thông báo lỗi kém hơn.
 */
const vndAmount = z.number().int().nonnegative().max(AMOUNT_VND_MAX);

export const createPlanBodySchema = z.object({
  /**
   * Khoá tra cứu ổn định trong code (`'free'`, `'pro'`). Không đổi được sau khi
   * tạo — xem `updatePlanBodySchema`.
   *
   * Chỉ chữ thường, số và gạch dưới: nó đi vào ảnh chụp `orders.plan_code` và
   * vào phép suy "không subscription nào = gói free", nên một khoảng trắng hay
   * chữ hoa lọt vào sẽ làm hai chỗ so khớp trượt nhau.
   */
  code: z
    .string()
    .trim()
    .min(1)
    .max(PLAN_CODE_MAX)
    .regex(/^[a-z0-9_]+$/, 'Mã gói chỉ gồm chữ thường, số và dấu gạch dưới'),
  name: z.string().trim().min(1, 'Tên gói không được để trống').max(PLAN_NAME_MAX),
  description: z.string().trim().max(500).nullable().optional(),
  priceVnd: vndAmount,
  /**
   * Trần 3650 ngày (10 năm). Một gói dài hơn thế gần như chắc chắn là gõ nhầm
   * số, và hậu quả là một subscription hết hạn năm 2140.
   */
  durationDays: z.number().int().min(0).max(3650),
  /**
   * `null` = KHÔNG GIỚI HẠN, và đó là lý do dùng `.nullable()` chứ không để `0`
   * mang nghĩa đó. `0` nghĩa là "không được tạo cái nào" — hai ý đối nghịch
   * trong cùng một cột là thứ code sẽ chọn sai.
   */
  maxWorkspaces: z.number().int().nonnegative().nullable(),
  maxReports: z.number().int().nonnegative().nullable(),
  maxMembers: z.number().int().nonnegative().nullable(),
  maxStorageBytes: z.number().int().nonnegative().nullable(),
  isPublic: z.boolean().default(true),
  isFeatured: z.boolean().default(false),
  sortOrder: z.number().int().nonnegative().max(65535).default(0),
});

/**
 * Sửa gói — KHÔNG nhận `code`.
 *
 * `code` là khoá tra cứu mà mã nguồn dựa vào (`findPlanByCode('free')`) và cũng
 * là thứ đã được chụp vào mọi đơn hàng cũ. Cho đổi nó nghĩa là một hôm nào đó
 * gói `free` biến mất và mọi tổ chức chưa mua gì rơi vào nhánh lỗi.
 */
export const updatePlanBodySchema = createPlanBodySchema.omit({ code: true });

/**
 * Cấu hình phương thức thanh toán.
 *
 * ⚠️ Ba trạng thái cho mỗi trường bí mật: vắng mặt = GIỮ NGUYÊN, `null` = xoá,
 * chuỗi = đặt mới. Bắt gửi lại bí mật mỗi lần sửa nghĩa là muốn đổi tên hiển
 * thị cũng phải biết khoá API — thứ mà người dựng cấu hình ban đầu có thể đã
 * không chia sẻ. Cùng khuôn với `updateConnectionBodySchema` của §8.
 */
export const updatePaymentMethodBodySchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  instructions: z.string().trim().max(1000).nullable().optional(),
  /** Mã ngân hàng theo NAPAS — đúng 6 chữ số, và mã QR sai một số là mã vô dụng. */
  bankBin: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Mã ngân hàng phải là 6 chữ số')
    .nullable()
    .optional(),
  bankAccountNo: z
    .string()
    .trim()
    .regex(/^\d{6,32}$/, 'Số tài khoản chỉ gồm chữ số')
    .nullable()
    .optional(),
  bankAccountName: z.string().trim().max(255).nullable().optional(),
  /** Đi qua `secretBox.seal()` trước khi xuống database. KHÔNG bao giờ trả ra. */
  webhookSecret: z.string().min(8).max(512).nullable().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().nonnegative().max(65535).optional(),
});

export const listAdminOrdersQuerySchema = paginationSchema.extend({
  status: z.enum(ORDER_STATUSES).optional(),
  tenantId: z.coerce.number().int().positive().optional(),
  provider: z.enum(PAYMENT_PROVIDERS).optional(),
  q: z.string().trim().max(100).optional(),
  sort: z.string().optional(),
});

/**
 * Xác nhận đã nhận tiền — §11 mục 3.3.
 *
 * `providerTxnRef` BẮT BUỘC và không được rỗng. Nó làm hai việc trong một
 * trường: là khoá idempotency thật ở tầng database (`uq_payment_txn_provider_ref`)
 * và là sợi dây nối một lần xác nhận tay về đúng một dòng sao kê khi có tranh
 * chấp. Cho phép để trống là bỏ cả hai.
 */
export const confirmOrderBodySchema = z.object({
  providerTxnRef: z
    .string()
    .trim()
    .min(1, 'Phải nhập số tham chiếu giao dịch trên sao kê')
    .max(191),
  /** Số tiền THỰC NHẬN — cố ý cho phép lệch với đơn. Xem migration 30. */
  amountVnd: vndAmount,
  reason: z.string().trim().max(500).optional(),
});

/**
 * Gán gói thủ công cho một tổ chức — khách ký hợp đồng riêng.
 *
 * `reason` BẮT BUỘC, và `ck_subscriptions_override_has_reason` ở database cưỡng
 * chế lần nữa. Một lần ghi đè không có lý do là một dòng mà kiểm toán không trả
 * lời được, và đó chính là thứ đầu tiên họ sẽ hỏi.
 */
export const overrideSubscriptionBodySchema = z.object({
  tenantId: z.coerce.number().int().positive(),
  planId: z.coerce.number().int().positive(),
  /** Số ngày hiệu lực. Trần 10 năm, cùng lý do với `durationDays` của gói. */
  durationDays: z.number().int().positive().max(3650),
  reason: z.string().trim().min(1, 'Phải ghi lý do gán gói thủ công').max(500),
});
