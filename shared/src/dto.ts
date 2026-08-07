/**
 * Hình dạng dữ liệu đi qua dây giữa backend và frontend.
 *
 * Cố ý viết bằng `interface` thuần chứ không phải zod: đây là dữ liệu ĐI RA từ
 * backend, backend là nơi tạo ra nó nên không cần validate lại lúc build; còn
 * frontend chỉ cần kiểu để không gõ nhầm tên trường. Zod chỉ dùng cho dữ liệu
 * ĐI VÀO (§auth.ts), nơi thật sự không tin được.
 */

export type RoleCode = 'tenant_admin' | 'creator' | 'viewer';

export type UserStatus = 'active' | 'pending_verification' | 'suspended' | 'deleted';

export interface UserDto {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  jobTitle: string | null;
  status: UserStatus;
  createdAt: string;
}

export interface TenantDto {
  id: string;
  name: string;
}

export interface WorkspaceDto {
  id: string;
  name: string;
}

/** Trả về từ POST /auth/register và POST /auth/login. */
export interface AuthSessionDto {
  user: UserDto;
  tenant: TenantDto;
  workspace: WorkspaceDto;
  role: RoleCode;
}

/** Trả về từ GET /auth/me. */
export interface MeDto {
  user: UserDto;
  role: RoleCode;
  tenant: TenantDto;
  workspaces: WorkspaceDto[];
  /** Toàn bộ tenant người dùng thuộc về — hiện luôn dài 1, để sẵn cho bộ chuyển tenant. */
  tenants: Array<TenantDto & { role: RoleCode }>;
}

/**
 * Envelope lỗi thống nhất của API. Mọi lỗi 4xx/5xx đều có đúng hình dạng này.
 * `fields` chỉ xuất hiện ở lỗi validate, map từ tên trường sang danh sách thông báo.
 */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string[]>;
  };
}

export const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  EMAIL_ALREADY_REGISTERED: 'EMAIL_ALREADY_REGISTERED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN_ORIGIN: 'FORBIDDEN_ORIGIN',
  RATE_LIMITED: 'RATE_LIMITED',
  NOT_FOUND: 'NOT_FOUND',
  INTERNAL: 'INTERNAL',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
