import type { TenantRole } from './dto';

/**
 * Hợp đồng dữ liệu của khu quản trị (§3.2 – §3.5).
 *
 * Chỉ chứa KIỂU, không chứa schema zod. Lý do nằm ở luật đã ghi trong
 * `shared/src/auth.ts`: schema dùng chung phải thuần validate, không transform —
 * nếu không thì kiểu input và output của zod lệch nhau và `zodResolver` của
 * react-hook-form bắt phải khai `useForm<Input, Ctx, Output>`. Mà schema phân
 * trang thì buộc phải dùng `z.coerce.number()` (query string luôn là chuỗi), tức
 * là transform. Nên schema request ở lại backend, chỗ này chỉ chia sẻ kiểu.
 */

/**
 * Kết quả phân trang. Trước đây định nghĩa trong `backend/src/utils/pagination.ts`;
 * chuyển sang đây để backend và frontend dùng CHUNG một kiểu — hai interface
 * giống hệt nhau ở hai package sẽ lệch nhau lúc nào không biết, và TypeScript
 * không cảnh báo được điều đó.
 */
export interface PageResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/**
 * Một thành viên trong danh sách quản trị (§3.3).
 *
 * Có HAI cờ trạng thái và chúng khác nhau về phạm vi — đừng gộp:
 *
 *   memberActive  `memberships.is_active` — khoá trong PHẠM VI TỔ CHỨC NÀY.
 *                 Admin của tổ chức bật/tắt được.
 *   userActive    `users.is_active`       — khoá TOÀN HỆ THỐNG. Admin tổ chức
 *                 chỉ ĐỌC, không sửa: cột đó ảnh hưởng tới mọi tổ chức khác mà
 *                 người này tham gia, và tới cả việc đăng nhập.
 *
 * Giao diện phải hiện được cả hai, nếu không admin sẽ bối rối trước một người
 * `memberActive = true` mà vẫn không đăng nhập được.
 */
export interface AdminUserDto {
  userId: number;
  email: string;
  fullName: string;
  jobTitle: string | null;
  role: TenantRole;
  memberActive: boolean;
  userActive: boolean;
  /** Khác null nghĩa là đã bị gỡ khỏi tổ chức. Bản ghi `users` vẫn còn nguyên. */
  removedAt: string | null;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  /** Thời điểm vào tổ chức — `memberships.created_at`, không phải ngày tạo tài khoản. */
  joinedAt: string;
}

/** Trạng thái thành viên, suy ra từ cặp (memberActive, removedAt). */
export type MemberStatus = 'active' | 'locked' | 'removed';

export function memberStatusOf(user: {
  memberActive: boolean;
  removedAt: string | null;
}): MemberStatus {
  if (user.removedAt !== null) return 'removed';
  return user.memberActive ? 'active' : 'locked';
}

export const MEMBER_STATUS_LABELS: Record<MemberStatus, string> = {
  active: 'Đang hoạt động',
  locked: 'Bị khoá',
  removed: 'Đã gỡ',
};

/**
 * Kết quả tạo thành viên (§3.4).
 *
 * `mode` phân biệt hai luồng khác hẳn nhau:
 *   'created'  — email chưa từng có trên hệ thống, tạo tài khoản mới
 *   'attached' — email đã có (người này làm ở tổ chức khác), chỉ gắn vào tổ chức
 *
 * Chỉ luồng 'created' mới có mật khẩu tạm. Luồng 'attached' thì người ta đã có
 * mật khẩu riêng rồi — đặt lại mật khẩu của họ chỉ vì admin tổ chức này mời họ
 * vào là vượt quyền.
 */
export interface CreateAdminUserResultDto {
  mode: 'created' | 'attached';
  user: AdminUserDto;
  /**
   * CHỈ có khi `mode === 'created'`. Hiện đúng MỘT LẦN — backend không lưu lại,
   * không ghi log, và không có cách nào lấy lại. Mất thì phải CẤP LẠI, bằng
   * `POST /v1/members/:userId/reset-password` (xem DTO ngay dưới).
   */
  tempPassword?: string;
}

/**
 * Kết quả cấp lại mật khẩu tạm.
 *
 * ─── Vì sao "cấp lại" chứ không phải "xem lại" ───────────────────────────────
 *
 * Database chỉ giữ hash bcrypt của mật khẩu, và bcrypt là hàm một chiều. Không
 * có endpoint nào đọc lại được mật khẩu tạm đã cấp — không phải vì chưa viết, mà
 * vì thông tin đó KHÔNG CÒN TỒN TẠI. Một API "xem lại mật khẩu" chỉ dựng được
 * nếu ta lưu mật khẩu ở dạng đọc được, và khi đó một lần lộ database là lộ mật
 * khẩu của tất cả mọi người.
 *
 * Nên đường phục hồi duy nhất đúng là sinh một mật khẩu MỚI, ghi đè cái cũ, và
 * bật lại `must_change_password`. Mật khẩu tạm cũ chết ngay tại đó — kể cả khi
 * admin có lỡ chép nó vào đâu đó.
 *
 * Không có `mode` như `CreateAdminUserResultDto`: tới được đây thì chắc chắn đã
 * có tài khoản, và `tempPassword` luôn có. Nhánh 'attached' không tồn tại.
 */
export interface ResetMemberPasswordResultDto {
  user: AdminUserDto;
  tempPassword: string;
}

export interface AdminWorkspaceDto {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  /**
   * `workspaces.is_active` — bị KHOÁ bởi quản trị HỆ THỐNG, không phải bởi admin
   * tổ chức. Admin tổ chức chỉ ĐỌC cờ này; console vận hành mới bật/tắt được.
   *
   * Giao diện phải hiện nó, nếu không workspace bị khoá trông y hệt workspace
   * bình thường mà lại không chọn được ở bộ chuyển (§4.6) — người dùng sẽ đi tìm
   * lỗi ở chỗ không có lỗi.
   */
  isActive: boolean;
  /** Số project còn sống trong workspace. Dùng để cảnh báo trước khi xoá. */
  projectCount: number;
  createdAt: string;
}

/** Một điểm trên biểu đồ §3.2. `date` là ngày UTC dạng 'YYYY-MM-DD'. */
export interface DailyCountPoint {
  date: string;
  count: number;
}

/** Một lát trong biểu đồ phân bổ vai trò. */
export interface RoleBreakdownSlice {
  role: TenantRole;
  /** Nhãn tiếng Việt, backend tính sẵn để biểu đồ không phải tra bảng. */
  label: string;
  count: number;
}

export interface AdminOverviewDto {
  totalMembers: number;
  admins: number;
  lockedMembers: number;
  workspaces: number;
  /**
   * Phân bổ vai trò của những thành viên còn trong tổ chức.
   *
   * Luôn đủ ba phần tử kể cả khi count = 0, để biểu đồ có trục ổn định và không
   * nhảy chỗ khi một vai trò từ 0 thành 1.
   */
  roleBreakdown: RoleBreakdownSlice[];
  /**
   * Thành viên mới theo ngày, đã lấp đủ những ngày không có ai vào.
   *
   * Đây là chuỗi thời gian DUY NHẤT schema hiện tại đỡ được: không có bảng sự
   * kiện, không có audit log, `last_login_at` bị ghi đè chứ không phải lịch sử.
   * Với tổ chức mới vài tuần, biểu đồ sẽ gần như phẳng và có một cột dựng đứng ở
   * ngày đầu — đó là sự thật của dữ liệu, không phải lỗi hiển thị.
   */
  newMembersDaily: DailyCountPoint[];
  rangeDays: number;
}

/**
 * Mã lỗi riêng của khu quản trị, nối tiếp `ERROR_CODES` trong dto.ts.
 *
 * Frontend phân nhánh theo mã này chứ không so khớp chuỗi tiếng Việt — đổi câu
 * chữ thông báo không được làm hỏng logic giao diện.
 */
export const ADMIN_ERROR_CODES = {
  /** Người này đã là thành viên của tổ chức rồi. */
  MEMBER_ALREADY_EXISTS: 'MemberAlreadyExists',
  /** Thao tác sẽ khiến tổ chức không còn quản trị viên nào. */
  LAST_ADMIN: 'LastAdmin',
  /** Không thể tự đổi vai trò / tự khoá / tự gỡ chính mình. */
  CANNOT_MODIFY_SELF: 'CannotModifySelf',
  /** Tài khoản tồn tại nhưng đã bị khoá hoặc xoá ở cấp hệ thống. */
  ACCOUNT_UNAVAILABLE: 'AccountUnavailable',
  /**
   * Người này còn là thành viên của tổ chức khác, nên tài khoản của họ là danh
   * tính DÙNG CHUNG. Admin của một tổ chức không được đặt lại mật khẩu của nó.
   */
  SHARED_IDENTITY: 'SharedIdentity',
  /** Mục tiêu là quản trị viên HỆ THỐNG — nằm ngoài thẩm quyền của admin tổ chức. */
  PLATFORM_ADMIN_PROTECTED: 'PlatformAdminProtected',
  /** Workspace còn project đang hoạt động. */
  WORKSPACE_NOT_EMPTY: 'WorkspaceNotEmpty',
  /** Đã thử hết hậu tố mà vẫn trùng slug. */
  WORKSPACE_SLUG_EXHAUSTED: 'WorkspaceSlugExhausted',
} as const;

export type AdminErrorCode = (typeof ADMIN_ERROR_CODES)[keyof typeof ADMIN_ERROR_CODES];
