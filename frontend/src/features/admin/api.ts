import type {
  AdminOverviewDto,
  AdminUserDto,
  AdminWorkspaceDto,
  CreateAdminUserResultDto,
  PageResult,
  TenantRole,
} from '@bi/shared';
import { apiClient } from '../../services/apiClient';

/**
 * Lời gọi HTTP của khu quản trị.
 *
 * Đường dẫn tương đối với `VITE_API_BASE_URL` (mặc định `/api`), nên
 * `/admin/users` ra `GET /api/admin/users`. Token do interceptor của
 * `apiClient` tự gắn — không hàm nào ở đây được đụng tới localStorage.
 *
 * Cố ý KHÔNG bắt lỗi: react-query cần thấy Promise bị reject để chuyển sang
 * trạng thái error, và nơi gọi dùng `getApiError()` để lấy envelope.
 */

export async function fetchOverview(): Promise<AdminOverviewDto> {
  const { data } = await apiClient.get<AdminOverviewDto>('/admin/overview');
  return data;
}

export interface UserListQuery {
  page: number;
  pageSize: number;
  sort: string;
  order: 'asc' | 'desc';
  q: string;
  role: TenantRole | '';
  status: 'active' | 'locked' | 'removed' | '';
}

export async function fetchUsers(query: UserListQuery): Promise<PageResult<AdminUserDto>> {
  // Bỏ các tham số rỗng thay vì gửi `role=`: chuỗi rỗng sẽ trượt qua
  // `z.enum(...).optional()` ở backend và thành lỗi 400 khó hiểu.
  const params: Record<string, string | number> = {
    page: query.page,
    pageSize: query.pageSize,
    sort: query.sort,
    order: query.order,
  };
  if (query.q) params['q'] = query.q;
  if (query.role) params['role'] = query.role;
  if (query.status) params['status'] = query.status;

  const { data } = await apiClient.get<PageResult<AdminUserDto>>('/admin/users', { params });
  return data;
}

export interface CreateUserPayload {
  email: string;
  fullName: string;
  role: TenantRole;
  jobTitle?: string;
}

export async function createUser(
  payload: CreateUserPayload,
): Promise<CreateAdminUserResultDto> {
  const { data } = await apiClient.post<CreateAdminUserResultDto>('/admin/users', payload);
  return data;
}

export async function updateUserRole(userId: number, role: TenantRole): Promise<void> {
  await apiClient.patch(`/admin/users/${userId}/role`, { role });
}

export async function updateUserStatus(userId: number, isActive: boolean): Promise<void> {
  await apiClient.patch(`/admin/users/${userId}/status`, { isActive });
}

export async function removeUser(userId: number): Promise<void> {
  await apiClient.delete(`/admin/users/${userId}`);
}

export async function fetchWorkspaces(): Promise<AdminWorkspaceDto[]> {
  const { data } = await apiClient.get<AdminWorkspaceDto[]>('/admin/workspaces');
  return data;
}

export interface WorkspacePayload {
  name: string;
  description?: string;
}

export async function createWorkspace(payload: WorkspacePayload): Promise<AdminWorkspaceDto> {
  const { data } = await apiClient.post<AdminWorkspaceDto>('/admin/workspaces', payload);
  return data;
}

export async function updateWorkspace(
  id: number,
  payload: WorkspacePayload,
): Promise<AdminWorkspaceDto> {
  const { data } = await apiClient.patch<AdminWorkspaceDto>(`/admin/workspaces/${id}`, payload);
  return data;
}

export async function deleteWorkspace(id: number): Promise<void> {
  await apiClient.delete(`/admin/workspaces/${id}`);
}
