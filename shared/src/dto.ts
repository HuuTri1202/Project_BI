/**
 * Hình dạng dữ liệu đi qua dây giữa backend và frontend.
 *
 * Cố ý viết bằng `interface` thuần chứ không phải zod: đây là dữ liệu ĐI RA từ
 * backend, backend là nơi tạo ra nó nên không cần validate lại lúc build; còn
 * frontend chỉ cần kiểu để không gõ nhầm tên trường. Zod chỉ dùng cho dữ liệu
 * ĐI VÀO (§auth.ts), nơi thật sự không tin được.
 *
 * File này thay thế `frontend/src/types/auth.ts` chép tay trước đây — đó chính
 * là lý do gói này tồn tại.
 */

/**
 * HAI trục vai trò độc lập. Xem ghi chú đầy đủ trong
 * `backend/src/db/migrations.ts`.
 *
 *   PlatformRole  quyền trên HỆ THỐNG   — cột `users.role`
 *   TenantRole    quyền trong TỔ CHỨC   — cột `memberships.role`
 *
 * Một người có thể là `user` bình thường ở cấp nền tảng nhưng `admin` của công
 * ty mình. Mọi kiểm tra quyền hiện tại đều dùng `TenantRole`.
 */
export type PlatformRole = 'superadmin' | 'user';
export type TenantRole = 'admin' | 'creator' | 'viewer';

/** Nhãn tiếng Việt của vai trò trong tổ chức. */
export const TENANT_ROLE_LABELS: Record<TenantRole, string> = {
  admin: 'Quản trị viên',
  creator: 'Người tạo báo cáo',
  viewer: 'Người xem',
};

/**
 * `id` là `number` chứ không phải `string`: khoá chính đã chốt là
 * `BIGINT UNSIGNED AUTO_INCREMENT`.
 *
 * Cố ý KHÔNG có `tenantId` và không có vai trò tổ chức — bảng `users` là định
 * danh toàn cục, việc thuộc tổ chức nào với vai trò gì nằm ở `MembershipDto`.
 */
export interface UserDto {
  id: number;
  email: string;
  fullName: string;
  phone: string | null;
  jobTitle: string | null;
  /** Dạng 'YYYY-MM-DD'. */
  dateOfBirth: string | null;
  platformRole: PlatformRole;
  isActive: boolean;
  mustChangePassword: boolean;
  emailVerifiedAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface TenantDto {
  id: number;
  name: string;
  slug: string;
}

export interface WorkspaceDto {
  id: number;
  name: string;
  slug: string;
}

/** Một tổ chức người dùng thuộc về, kèm vai trò trong đó. */
export interface MembershipDto extends TenantDto {
  role: TenantRole;
  /**
   * Đây có phải KHÔNG GIAN RIÊNG của chính người đang đăng nhập không.
   *
   * Mọi tài khoản do Admin tạo đều được cấp kèm một tổ chức cá nhân, nên bộ
   * chuyển tổ chức phải phân biệt được nó với công ty thật — hai dòng cùng hình
   * dạng mà một cái là chỗ làm việc chung, một cái là chỗ riêng.
   *
   * Được tính THEO NGƯỜI ĐANG HỎI: tổ chức cá nhân của người khác mà mình được
   * mời vào thì với mình nó là `false`.
   */
  isPersonal: boolean;
}

/**
 * Phần chung của `POST /auth/login` và `GET /auth/me`.
 *
 * `tenant` + `role` là tổ chức ĐANG MỞ. `memberships` là tất cả tổ chức người
 * này thuộc về — backend trả sẵn kể cả khi mới có một phần tử, để lúc thêm
 * chức năng đổi tổ chức không phải sửa hợp đồng API.
 */
export interface SessionDto {
  user: UserDto;
  tenant: TenantDto;
  role: TenantRole;
  memberships: MembershipDto[];
}

export interface LoginResponseDto extends SessionDto {
  token: string;
  /** Số giây token còn hiệu lực. */
  expiresIn: number;
  mustChangePassword: boolean;
}

export type MeResponseDto = SessionDto;

/**
 * Trả về từ `POST /auth/register`.
 *
 * CỐ Ý không kèm token: đăng ký xong người dùng được đưa sang trang đăng nhập
 * (§1.5). Tự đăng nhập luôn nghe tiện hơn, nhưng nó khiến bước "đăng nhập lần
 * đầu" không bao giờ được thực hiện — và đó là bước duy nhất chứng minh mật
 * khẩu họ vừa đặt đúng như họ nghĩ.
 */
export interface RegisterResponseDto {
  user: UserDto;
  tenant: TenantDto;
  workspace: WorkspaceDto;
  role: TenantRole;
}

/**
 * Envelope lỗi thống nhất của API — mọi lỗi 4xx/5xx đều có đúng hình dạng này.
 *
 * `fields` chỉ xuất hiện ở lỗi validate: map tên trường sang MỘT thông báo.
 * Một ô hiện cùng lúc ba lỗi chỉ làm người dùng rối, nên backend đã chọn sẵn
 * lỗi đầu tiên của mỗi trường.
 */
export interface ApiErrorBody {
  error: string;
  message: string;
  fields?: Record<string, string>;
}

export const ERROR_CODES = {
  VALIDATION_ERROR: 'ValidationError',
  /**
   * Thân yêu cầu không đọc được — hỏng JSON, sai charset, bị ngắt giữa chừng.
   *
   * Khác `VALIDATION_ERROR` ở một điểm quan trọng với client: ở đây request
   * chưa bao giờ được phân tích thành object, nên KHÔNG có `fields` để tô đỏ
   * ô nào. Đây gần như luôn là lỗi của tầng gửi request, không phải của người
   * đang gõ vào form.
   */
  MALFORMED_BODY: 'MalformedBody',
  /** Thân yêu cầu vượt trần 1MB của `express.json()`. */
  PAYLOAD_TOO_LARGE: 'PayloadTooLarge',
  EMAIL_ALREADY_REGISTERED: 'EmailAlreadyRegistered',
  INVALID_CREDENTIALS: 'InvalidCredentials',
  ACCOUNT_DISABLED: 'AccountDisabled',
  NO_MEMBERSHIP: 'NoMembership',
  UNAUTHENTICATED: 'Unauthorized',
  FORBIDDEN: 'Forbidden',
  FORBIDDEN_ORIGIN: 'ForbiddenOrigin',
  RATE_LIMITED: 'TooManyRequests',
  NOT_FOUND: 'NotFound',
  INTERNAL: 'InternalServerError',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
