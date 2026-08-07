/**
 * Kiểu dữ liệu xác thực — phải khớp từng chữ với backend.
 *
 * Nguồn sự thật:
 *   backend/src/repositories/users.ts        -> PublicUser, PlatformRole
 *   backend/src/repositories/memberships.ts  -> TenantRole
 *   backend/src/api/auth/index.ts            -> hình dạng response
 *   backend/src/middleware/errorHandler.ts   -> hình dạng lỗi
 *
 * Sửa một bên thì phải sửa bên kia. TypeScript không nối được hai package nên
 * không có gì bắt lỗi giúp — đây là chỗ duy nhất chép tay, giữ nó ngắn.
 */

/**
 * HAI trục vai trò độc lập, đừng nhầm lẫn:
 *
 *   PlatformRole  quyền trên HỆ THỐNG   ('superadmin' | 'user')
 *   TenantRole    quyền trong TỔ CHỨC   ('admin' | 'creator' | 'viewer')
 *
 * Một người có thể là `user` bình thường ở cấp nền tảng nhưng `admin` của công
 * ty mình. Mọi kiểm tra quyền trong giao diện hiện tại dùng `TenantRole`.
 */
export type PlatformRole = 'superadmin' | 'user';
export type TenantRole = 'admin' | 'creator' | 'viewer';

/** Nhãn tiếng Việt của vai trò trong tổ chức, dùng ở topbar và bảng người dùng. */
export const ROLE_LABELS: Record<TenantRole, string> = {
  admin: 'Quản trị viên',
  creator: 'Người tạo báo cáo',
  viewer: 'Người xem',
};

/**
 * Danh tính người dùng. Cố ý KHÔNG có `tenantId` và không có vai trò tổ chức:
 * bảng `users` phía backend là định danh toàn cục, còn việc thuộc tổ chức nào
 * với vai trò gì nằm ở `Membership`.
 */
export interface PublicUser {
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

export interface Tenant {
  id: number;
  name: string;
  slug: string;
}

/** Một tổ chức mà người dùng thuộc về, kèm vai trò trong đó. */
export interface Membership extends Tenant {
  role: TenantRole;
}

/**
 * Phần chung của phản hồi `POST /auth/login` và `GET /auth/me`.
 *
 * `tenant` + `role` là tổ chức ĐANG MỞ. `memberships` là tất cả tổ chức người
 * này thuộc về — backend trả sẵn kể cả khi mới có một phần tử, để lúc thêm
 * chức năng đổi tổ chức không phải sửa hợp đồng API.
 */
export interface SessionPayload {
  user: PublicUser;
  tenant: Tenant;
  role: TenantRole;
  memberships: Membership[];
}

export interface LoginResponse extends SessionPayload {
  token: string;
  /** Số giây token còn hiệu lực. */
  expiresIn: number;
  mustChangePassword: boolean;
}

export type MeResponse = SessionPayload;

/**
 * Hình dạng lỗi thống nhất của backend.
 * `fields` chỉ có ở lỗi validate — map tên trường sang thông báo tiếng Việt.
 */
export interface ApiErrorBody {
  error: string;
  message: string;
  fields?: Record<string, string>;
}
