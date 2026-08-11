import type {
  PageResult,
  PlatformOverviewDto,
  PlatformTenantDetailDto,
  PlatformTenantDto,
  PlatformUserDto,
  PlatformWorkspaceDto,
} from '@bi/shared';
import { apiClient } from '../../services/apiClient';

/**
 * Lời gọi HTTP của console hệ thống.
 *
 * Đường dẫn tương đối với `VITE_API_BASE_URL` (mặc định `/api`), nên
 * `/admin/tenants` ra `GET /api/admin/tenants`. Token do interceptor của
 * `apiClient` tự gắn — không hàm nào ở đây được đụng tới localStorage.
 *
 * Cố ý KHÔNG bắt lỗi: react-query cần thấy Promise bị reject để chuyển sang
 * trạng thái error, và nơi gọi dùng `getApiError()` để lấy envelope.
 */

/** Bỏ tham số rỗng thay vì gửi `status=`: chuỗi rỗng trượt qua `z.enum().optional()`
 *  ở backend và thành lỗi 400 khó hiểu. */
function clean(input: Record<string, string | number | undefined>): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== '') out[key] = value;
  }
  return out;
}

export async function fetchOverview(): Promise<PlatformOverviewDto> {
  const { data } = await apiClient.get<PlatformOverviewDto>('/admin/overview');
  return data;
}

// ─── Tenant ──────────────────────────────────────────────────────────────────

export interface TenantListQuery {
  page: number;
  pageSize: number;
  sort: string;
  order: 'asc' | 'desc';
  q: string;
  status: 'active' | 'locked' | '';
  /**
   * Loại tổ chức. Chuỗi rỗng bị `clean()` loại khỏi query string, và backend
   * hiểu "không truyền" là `org` — nên mặc định của màn hình là **công ty thật**,
   * không phải "tất cả". Xem `tenantWhere` ở backend.
   */
  kind: 'org' | 'personal' | 'all' | '';
}

export async function fetchTenants(
  query: TenantListQuery,
): Promise<PageResult<PlatformTenantDto>> {
  const { data } = await apiClient.get<PageResult<PlatformTenantDto>>('/admin/tenants', {
    params: clean({ ...query }),
  });
  return data;
}

export async function fetchTenantDetail(id: number): Promise<PlatformTenantDetailDto> {
  const { data } = await apiClient.get<PlatformTenantDetailDto>(`/admin/tenants/${id}`);
  return data;
}

export async function setTenantActive(id: number, isActive: boolean): Promise<void> {
  await apiClient.patch(`/admin/tenants/${id}/status`, { isActive });
}

export async function deleteTenant(id: number): Promise<void> {
  await apiClient.delete(`/admin/tenants/${id}`);
}

// ─── User ────────────────────────────────────────────────────────────────────

export interface UserListQuery {
  page: number;
  pageSize: number;
  sort: string;
  order: 'asc' | 'desc';
  q: string;
  tenantId: number | '';
  status: 'active' | 'locked' | '';
  platformRole: 'superadmin' | 'user' | '';
}

export async function fetchUsers(query: UserListQuery): Promise<PageResult<PlatformUserDto>> {
  const { data } = await apiClient.get<PageResult<PlatformUserDto>>('/admin/users', {
    params: clean({ ...query }),
  });
  return data;
}

export async function setUserActive(id: number, isActive: boolean): Promise<void> {
  await apiClient.patch(`/admin/users/${id}/status`, { isActive });
}

export async function deleteUser(id: number): Promise<void> {
  await apiClient.delete(`/admin/users/${id}`);
}

// ─── Workspace ───────────────────────────────────────────────────────────────

export interface WorkspaceListQuery {
  page: number;
  pageSize: number;
  q: string;
  tenantId: number | '';
  status: 'active' | 'locked' | '';
  /** Giống `TenantListQuery.kind`. Backend bỏ qua khi đã lọc theo `tenantId`. */
  kind: 'org' | 'personal' | 'all' | '';
}

export async function fetchWorkspaces(
  query: WorkspaceListQuery,
): Promise<PageResult<PlatformWorkspaceDto>> {
  const { data } = await apiClient.get<PageResult<PlatformWorkspaceDto>>('/admin/workspaces', {
    params: clean({ ...query }),
  });
  return data;
}

export async function setWorkspaceActive(id: number, isActive: boolean): Promise<void> {
  await apiClient.patch(`/admin/workspaces/${id}/status`, { isActive });
}

export async function deleteWorkspace(id: number): Promise<void> {
  await apiClient.delete(`/admin/workspaces/${id}`);
}
