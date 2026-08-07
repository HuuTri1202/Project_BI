/**
 * Kiểu dữ liệu xác thực — phải khớp từng chữ với backend.
 *
 * Nguồn sự thật:
 *   backend/src/repositories/users.ts    -> PublicUser
 *   backend/src/repositories/tenants.ts  -> Tenant
 *   backend/src/api/auth/index.ts        -> hình dạng response
 *   backend/src/middleware/errorHandler.ts -> hình dạng lỗi
 *
 * Sửa một bên thì phải sửa bên kia. TypeScript không nối được hai package nên
 * không có gì bắt lỗi giúp — đây là chỗ duy nhất chép tay, giữ nó ngắn.
 */

export type UserRole = 'admin' | 'creator' | 'viewer';

/** Nhãn tiếng Việt của vai trò, dùng ở topbar và bảng người dùng. */
export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Quản trị viên',
  creator: 'Người tạo báo cáo',
  viewer: 'Người xem',
};

export interface PublicUser {
  id: number;
  tenantId: number;
  fullName: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface Tenant {
  id: number;
  name: string;
  slug: string;
}

export interface LoginResponse {
  token: string;
  /** Số giây token còn hiệu lực. */
  expiresIn: number;
  mustChangePassword: boolean;
  user: PublicUser;
  tenant: Tenant | null;
}

export interface MeResponse {
  user: PublicUser;
  tenant: Tenant | null;
}

/**
 * Hình dạng lỗi thống nhất của backend.
 * `fields` chỉ có ở lỗi validate — map tên trường sang thông báo tiếng Việt.
 */
export interface ApiErrorBody {
  error: string;
  message: string;
  fields?: Record<string, string>;
}
