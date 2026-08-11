import type { RegisterInput } from '@bi/shared';
import { apiClient } from './apiClient';
import type { LoginResponse, MeResponse, RegisterResponseDto } from '../types/auth';

/**
 * Bọc các endpoint của `/api/auth`.
 *
 * Đường dẫn ở đây là TƯƠNG ĐỐI với `baseURL` = `/api`, nên `/auth/login` sẽ
 * thành `/api/auth/login`. Giữ đúng dạng này để danh sách SESSION_ENDPOINTS
 * trong apiClient khớp được.
 */

/**
 * §1.4 Đăng ký.
 *
 * KHÔNG trả token — backend cố ý không tự đăng nhập, người dùng được đưa sang
 * trang đăng nhập (§1.5). Gửi cả `confirmPassword` để backend kiểm lại ràng
 * buộc chéo bằng đúng schema mà form đã dùng, thay vì tin frontend đã đối chiếu.
 */
export async function register(input: RegisterInput): Promise<RegisterResponseDto> {
  const { data } = await apiClient.post<RegisterResponseDto>('/auth/register', input);
  return data;
}

export async function login(email: string, password: string): Promise<LoginResponse> {
  const { data } = await apiClient.post<LoginResponse>('/auth/login', { email, password });
  return data;
}

/**
 * §5.1 Đổi tổ chức đang mở.
 *
 * Trả về ĐÚNG hình dạng của `/auth/login` — kể cả `token` — vì `tenantId` được
 * ký trong JWT nên đổi tổ chức bắt buộc phải cấp token mới. Nhờ dùng chung kiểu,
 * `AuthProvider` xử lý hai luồng bằng một đoạn code.
 */
export async function switchTenant(tenantId: number): Promise<LoginResponse> {
  const { data } = await apiClient.post<LoginResponse>('/auth/switch-tenant', { tenantId });
  return data;
}

export async function fetchMe(): Promise<MeResponse> {
  const { data } = await apiClient.get<MeResponse>('/auth/me');
  return data;
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await apiClient.post('/auth/change-password', { currentPassword, newPassword });
}

/**
 * Gọi cho có nghi thức: JWT vô trạng thái nên server không xoá được gì.
 * Endpoint vẫn tồn tại để sau này thêm danh sách token bị thu hồi trên Redis
 * mà không phải đổi hợp đồng API. Lỗi ở đây KHÔNG được chặn việc đăng xuất
 * phía client — token vẫn phải bị xoá khỏi máy người dùng.
 */
export async function logout(): Promise<void> {
  try {
    await apiClient.post('/auth/logout');
  } catch {
    /* mất mạng vẫn phải đăng xuất được */
  }
}
