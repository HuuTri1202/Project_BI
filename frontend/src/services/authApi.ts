import { apiClient } from './apiClient';
import type { LoginResponse, MeResponse } from '../types/auth';

/**
 * Bọc các endpoint của `/api/auth`.
 *
 * Đường dẫn ở đây là TƯƠNG ĐỐI với `baseURL` = `/api`, nên `/auth/login` sẽ
 * thành `/api/auth/login`. Giữ đúng dạng này để danh sách SESSION_ENDPOINTS
 * trong apiClient khớp được.
 */

export async function login(email: string, password: string): Promise<LoginResponse> {
  const { data } = await apiClient.post<LoginResponse>('/auth/login', { email, password });
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
