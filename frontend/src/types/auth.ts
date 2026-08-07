/**
 * Cầu nối tới `@bi/shared`.
 *
 * Trước đây file này chép tay lại kiểu của backend. Đó chính là vấn đề mà gói
 * `@bi/shared` sinh ra để giải: hai phía viết riêng thì sớm muộn cũng lệch, và
 * TypeScript không nối được hai package nên không có gì bắt lỗi giúp.
 *
 * File vẫn tồn tại để những chỗ đang import `../types/auth` không phải sửa hàng
 * loạt, và để đặt những thứ CHỈ frontend cần.
 */
export type {
  ApiErrorBody,
  MembershipDto as Membership,
  MeResponseDto as MeResponse,
  LoginResponseDto as LoginResponse,
  PlatformRole,
  RegisterResponseDto,
  TenantDto as Tenant,
  TenantRole,
  UserDto as PublicUser,
} from '@bi/shared';

export { TENANT_ROLE_LABELS as ROLE_LABELS } from '@bi/shared';
