import type { PlatformRole, TenantRole } from './dto';

/**
 * Hợp đồng dữ liệu của CONSOLE HỆ THỐNG — khu vực chỉ dành cho `superadmin`.
 *
 * Khác hẳn `admin.ts`: những kiểu trong file kia mô tả dữ liệu BÊN TRONG một tổ
 * chức (thành viên của tenant đang mở). Các kiểu ở đây nhìn XUYÊN mọi tổ chức,
 * nên hầu hết đều mang theo `tenantId`/`tenantName` để biết dòng đó thuộc về ai.
 *
 * Mô hình:
 *   Tenant (công ty)  ──<  Workspace  ──<  Dataset / DataModel / Report
 *          │
 *          └──<  Membership  >──  User (định danh toàn cục)
 */

/** Một công ty trong danh sách của console. */
export interface PlatformTenantDto {
  id: number;
  name: string;
  slug: string;
  /** `tenants.is_active`. Khoá tenant là chặn mọi thành viên đăng nhập vào đó. */
  isActive: boolean;
  /**
   * `tenants.owner_user_id IS NOT NULL` — không gian riêng của một người dùng,
   * cấp tự động khi tài khoản được tạo, không phải một công ty thật.
   *
   * Danh sách của console MẶC ĐỊNH ẩn loại này: có bao nhiêu người dùng thì có
   * bấy nhiêu dòng, và chúng sẽ chôn vùi các công ty thật.
   */
  isPersonal: boolean;
  userCount: number;
  workspaceCount: number;
  createdAt: string;
}

/** Chi tiết một công ty: thông tin chung + thành viên + workspace. */
export interface PlatformTenantDetailDto {
  tenant: PlatformTenantDto;
  members: PlatformTenantMemberDto[];
  workspaces: PlatformWorkspaceDto[];
}

export interface PlatformTenantMemberDto {
  userId: number;
  email: string;
  fullName: string;
  role: TenantRole;
  /** `memberships.is_active` — phạm vi tổ chức này. */
  memberActive: boolean;
  /** `users.is_active` — phạm vi toàn hệ thống, chỉ đọc ở màn hình tenant. */
  userActive: boolean;
  joinedAt: string;
}

/**
 * Một người dùng trong danh sách toàn hệ thống.
 *
 * `tenants` là danh sách rút gọn những tổ chức người này còn tham gia — một
 * người có thể thuộc nhiều tổ chức, nên không thể nhét vào một cột duy nhất.
 */
export interface PlatformUserDto {
  id: number;
  email: string;
  fullName: string;
  jobTitle: string | null;
  platformRole: PlatformRole;
  /** `users.is_active` — khoá ở đây là khoá đăng nhập toàn hệ thống. */
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  tenants: PlatformUserTenantDto[];
}

/**
 * Một tổ chức người dùng đang tham gia, KÈM gói tổ chức đó đang dùng.
 *
 * Gói gắn với tổ chức chứ không gắn với người: một người thuộc công ty gói Doanh
 * nghiệp và có thêm không gian cá nhân gói Miễn phí thì đang dùng CẢ HAI, tuỳ
 * lúc họ mở tổ chức nào. Nên gói nằm trên từng dòng tổ chức, không phải một ô
 * "gói của người dùng" — ô đó không có câu trả lời đúng.
 */
export interface PlatformUserTenantDto {
  id: number;
  name: string;
  role: TenantRole;
  plan: {
    code: string;
    name: string;
    isPaid: boolean;
    /** `null` = gói Miễn phí, không có hạn. */
    periodEnd: string | null;
  };
}

/** Số đơn đã thanh toán của MỘT gói trong MỘT ngày (UTC). */
export interface PaidOrdersPoint {
  date: string;
  planCode: string;
  planName: string;
  orders: number;
  revenueVnd: number;
}

/** Một đơn vừa thanh toán — ai mua, cho tổ chức nào, gói gì. */
export interface RecentPaidOrderDto {
  orderCode: string;
  tenantId: number;
  tenantName: string;
  /** Người bấm mua. `null` khi tài khoản đó đã bị xoá. */
  buyerName: string | null;
  buyerEmail: string | null;
  planName: string;
  amountVnd: number;
  paidAt: string;
}

/** Khối đơn thanh toán trên trang Tổng quan của quản trị hệ thống. */
export interface PlatformBillingOverviewDto {
  /** Số đơn đã thanh toán trong `rangeDays` ngày gần nhất. */
  paidOrders: number;
  /** Tổng tiền của chính các đơn đó. */
  revenueVnd: number;
  /** Tổ chức đang có gói TRẢ PHÍ còn hạn, tính tại thời điểm hỏi. */
  payingTenants: number;
  /** Chỉ những ngày có đơn — giao diện tự trải ra đủ `rangeDays` ngày. */
  daily: PaidOrdersPoint[];
  recentOrders: RecentPaidOrderDto[];
}

export interface PlatformWorkspaceDto {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  isActive: boolean;
  tenantId: number;
  tenantName: string;
  /** Số báo cáo còn sống — xem `AdminWorkspaceDto.reportCount`. */
  reportCount: number;
  createdAt: string;
}

/** Một điểm trên biểu đồ tăng trưởng. `date` là ngày UTC 'YYYY-MM-DD'. */
export interface GrowthPoint {
  date: string;
  tenants: number;
  users: number;
  workspaces: number;
}

export interface PlatformOverviewDto {
  /** Tổ chức đang hoạt động (`is_active = 1`, chưa xoá mềm). */
  activeTenants: number;
  /** Tổ chức đã bị khoá nhưng chưa xoá. */
  lockedTenants: number;
  totalUsers: number;
  lockedUsers: number;
  totalWorkspaces: number;
  /**
   * Tăng trưởng theo ngày — số MỚI của từng loại trong mỗi ngày, đã lấp đủ
   * những ngày không có gì.
   *
   * Là số mới theo ngày chứ không phải luỹ kế: biểu đồ luỹ kế lúc nào cũng đi
   * lên nên nhìn đâu cũng thấy "tăng trưởng tốt", kể cả khi đã hai tuần không
   * có ai đăng ký.
   */
  growth: GrowthPoint[];
  rangeDays: number;
  /** Đơn thanh toán trong cùng `rangeDays` ngày. */
  billing: PlatformBillingOverviewDto;
}

export const PLATFORM_ERROR_CODES = {
  /** Không thể tự khoá/xoá chính tài khoản đang đăng nhập. */
  CANNOT_MODIFY_SELF: 'CannotModifySelf',
  /** Không thể xoá superadmin cuối cùng của hệ thống. */
  LAST_SUPERADMIN: 'LastSuperadmin',
  /** Tổ chức còn workspace đang hoạt động. */
  TENANT_NOT_EMPTY: 'TenantNotEmpty',
} as const;

export type PlatformErrorCode =
  (typeof PLATFORM_ERROR_CODES)[keyof typeof PLATFORM_ERROR_CODES];
