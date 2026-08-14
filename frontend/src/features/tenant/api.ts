import type {
  AdminUserDto,
  AdminWorkspaceDto,
  ConnectionDto,
  ConnectionKind,
  ConnectionPrerequisitesDto,
  CreateAdminUserResultDto,
  DatabaseOptionDto,
  DatasetDetailDto,
  DatasetDto,
  DatasetLoadDto,
  DatasetLoadErrorDto,
  DatasetPreviewDto,
  DatasetSource,
  HomeDataDto,
  JobTitle,
  PageResult,
  ProjectDto,
  ResetMemberPasswordResultDto,
  SourceTableDto,
  SyncResultDto,
  TenantDto,
  TenantRole,
  TestConnectionResultDto,
  UpdateProfileDto,
  UserDto,
  WarehousePageDto,
  WarehouseSchemaDto,
} from '@bi/shared';
import { apiClient } from '../../services/apiClient';

/**
 * Lời gọi HTTP của KHU NGƯỜI DÙNG.
 *
 * Đường dẫn tương đối với `VITE_API_BASE_URL` (mặc định `/api`), nên
 * `/v1/workspaces` ra `GET /api/v1/workspaces`. Token do interceptor của
 * `apiClient` tự gắn — không hàm nào ở đây được đụng tới localStorage.
 *
 * Không hàm nào nhận `tenantId`: backend lấy nó từ token. Nhận từ client nghĩa
 * là ai cũng đọc được dữ liệu tổ chức khác bằng cách đổi một con số.
 *
 * Cố ý KHÔNG bắt lỗi: react-query cần thấy Promise bị reject để chuyển sang
 * trạng thái error, và nơi gọi dùng `getApiError()` để lấy envelope.
 */

/** Bỏ tham số rỗng thay vì gửi `status=`: chuỗi rỗng trượt qua `z.enum().optional()`
 *  ở backend và thành lỗi 400 khó hiểu. */
function clean(
  input: Record<string, string | number | undefined>,
): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== '') out[key] = value;
  }
  return out;
}

// ─── Home (§4.3) ─────────────────────────────────────────────────────────────

export async function fetchHome(workspaceId: number | null): Promise<HomeDataDto> {
  const { data } = await apiClient.get<HomeDataDto>('/v1/home', {
    params: clean({ workspaceId: workspaceId ?? undefined }),
  });
  return data;
}

// ─── Tổ chức ─────────────────────────────────────────────────────────────────

export async function fetchTenant(): Promise<TenantDto> {
  const { data } = await apiClient.get<TenantDto>('/v1/tenant');
  return data;
}

/**
 * Đổi tên tổ chức.
 *
 * Không gửi id: backend lấy tổ chức từ token. Không gửi slug: nó không đổi được
 * qua đường này, và gửi lên chỉ tạo cảm giác là đổi được.
 */
export async function updateTenant(name: string): Promise<TenantDto> {
  const { data } = await apiClient.patch<TenantDto>('/v1/tenant', { name });
  return data;
}

// ─── Kết nối CSDL (§8) ───────────────────────────────────────────────────────

export async function fetchPrerequisites(): Promise<ConnectionPrerequisitesDto> {
  const { data } = await apiClient.get<ConnectionPrerequisitesDto>(
    '/v1/connections/prerequisites',
  );
  return data;
}

export async function fetchConnections(): Promise<ConnectionDto[]> {
  const { data } = await apiClient.get<ConnectionDto[]>('/v1/connections');
  return data;
}

export interface ConnectionFormValues {
  name: string;
  kind: ConnectionKind;
  host: string;
  port: number;
  useSsl: boolean;
  databaseName: string;
  username: string;
  password: string;
}

/** Thử kết nối CHƯA lưu — bước 3 của wizard. */
export async function testConnection(
  input: ConnectionFormValues,
): Promise<TestConnectionResultDto> {
  const { data } = await apiClient.post<TestConnectionResultDto>('/v1/connections/test', input);
  return data;
}

/**
 * Database mà thông tin vừa gõ nhìn thấy — nuôi bộ chọn ở bước 2.
 *
 * Gửi cả `databaseName` hiện tại lên cho khớp schema của backend, nhưng backend
 * bỏ qua nó: câu hỏi ở đây là "có những cái nào", nên tự lọc theo cái đang chọn
 * là tự mâu thuẫn.
 */
export async function listDatabases(input: ConnectionFormValues): Promise<DatabaseOptionDto[]> {
  const { data } = await apiClient.post<DatabaseOptionDto[]>('/v1/connections/databases', input);
  return data;
}

/** Như trên nhưng cho kết nối ĐÃ lưu — dùng khi sửa, lúc ô mật khẩu để trống. */
export async function listSavedDatabases(id: number): Promise<DatabaseOptionDto[]> {
  const { data } = await apiClient.get<DatabaseOptionDto[]>(`/v1/connections/${id}/databases`);
  return data;
}

export async function createConnection(input: ConnectionFormValues): Promise<ConnectionDto> {
  const { data } = await apiClient.post<ConnectionDto>('/v1/connections', input);
  return data;
}

/** Mật khẩu chuỗi rỗng = giữ nguyên mật khẩu đang lưu. */
export async function updateConnection(
  id: number,
  input: ConnectionFormValues,
): Promise<ConnectionDto> {
  const { data } = await apiClient.patch<ConnectionDto>(`/v1/connections/${id}`, input);
  return data;
}

export async function testSavedConnection(id: number): Promise<TestConnectionResultDto> {
  const { data } = await apiClient.post<TestConnectionResultDto>(`/v1/connections/${id}/test`);
  return data;
}

export async function deleteConnection(id: number): Promise<void> {
  await apiClient.delete(`/v1/connections/${id}`);
}

export async function fetchSourceTables(id: number): Promise<SourceTableDto[]> {
  const { data } = await apiClient.get<SourceTableDto[]>(`/v1/connections/${id}/tables`);
  return data;
}

export async function syncTables(
  id: number,
  tables: { schema: string; table: string }[],
): Promise<SyncResultDto> {
  const { data } = await apiClient.post<SyncResultDto>(`/v1/connections/${id}/sync`, { tables });
  return data;
}

// ─── Kho dữ liệu (§8.5) ──────────────────────────────────────────────────────

export interface DatasetListQuery {
  page: number;
  pageSize: number;
  sort: string;
  order: 'asc' | 'desc';
  q: string;
  connectionId: number | '';
  /** `''` = cả hai nguồn. Xem `DATASET_SOURCE_LABELS`. */
  source: DatasetSource | '';
}

export async function fetchDatasets(
  query: DatasetListQuery,
): Promise<PageResult<DatasetDto>> {
  const { data } = await apiClient.get<PageResult<DatasetDto>>('/v1/datasets', {
    params: clean({ ...query }),
  });
  return data;
}

export async function fetchDataset(id: number): Promise<DatasetDetailDto> {
  const { data } = await apiClient.get<DatasetDetailDto>(`/v1/datasets/${id}`);
  return data;
}

/**
 * Vài dòng đầu, đọc TRỰC TIẾP từ CSDL nguồn.
 *
 * Không nhận tham số `limit`: số dòng do backend quyết. Cho client chọn nghĩa là
 * ai đó gửi một con số rất lớn và ta kéo cả bảng của khách hàng qua mạng.
 */
export async function fetchDatasetPreview(id: number): Promise<DatasetPreviewDto> {
  const { data } = await apiClient.get<DatasetPreviewDto>(`/v1/datasets/${id}/preview`);
  return data;
}

export async function renameDataset(id: number, name: string): Promise<DatasetDto> {
  const { data } = await apiClient.patch<DatasetDto>(`/v1/datasets/${id}`, { name });
  return data;
}

export async function deleteDataset(id: number): Promise<void> {
  await apiClient.delete(`/v1/datasets/${id}`);
}

// ─── Nạp vào kho phân tích ClickHouse (§9) ───────────────────────────────────

/** Xếp hàng một lần nạp. Trả về NGAY, việc chạy nền — theo dõi bằng `fetchLoad`. */
export async function startLoad(id: number): Promise<DatasetLoadDto> {
  const { data } = await apiClient.post<DatasetLoadDto>(`/v1/datasets/${id}/load`);
  return data;
}

export async function fetchLoad(id: number): Promise<DatasetLoadDto> {
  const { data } = await apiClient.get<DatasetLoadDto>(`/v1/datasets/${id}/load`);
  return data;
}

/**
 * Một trang dữ liệu của bảng TRONG KHO ClickHouse.
 *
 * Khác `fetchDatasetPreview` ở chỗ quan trọng nhất: cái kia đọc từ NGUỒN, cái
 * này đọc từ ĐÍCH. Đặt hai bảng cạnh nhau là cách kiểm chứng một lần nạp.
 */
export async function fetchWarehousePreview(
  id: number,
  query: { page: number; pageSize: number },
): Promise<WarehousePageDto> {
  const { data } = await apiClient.get<WarehousePageDto>(`/v1/datasets/${id}/load/preview`, {
    params: query,
  });
  return data;
}

/** Cấu trúc bảng trong kho — kiểu ClickHouse thật, không phải kiểu của nguồn. */
export async function fetchWarehouseSchema(id: number): Promise<WarehouseSchemaDto> {
  const { data } = await apiClient.get<WarehouseSchemaDto>(`/v1/datasets/${id}/load/schema`);
  return data;
}

export async function fetchLoadErrors(
  id: number,
  query: { page: number; pageSize: number },
): Promise<PageResult<DatasetLoadErrorDto>> {
  const { data } = await apiClient.get<PageResult<DatasetLoadErrorDto>>(
    `/v1/datasets/${id}/load/errors`,
    { params: clean({ ...query }) },
  );
  return data;
}

// ─── Workspace (§4.5, §4.6) ──────────────────────────────────────────────────

export async function fetchWorkspaces(): Promise<AdminWorkspaceDto[]> {
  const { data } = await apiClient.get<AdminWorkspaceDto[]>('/v1/workspaces');
  return data;
}

export interface WorkspaceFormValues {
  name: string;
  description: string;
}

/**
 * Ô mô tả để trống phải BỎ HẲN khỏi payload, không gửi chuỗi rỗng.
 *
 * Schema backend là `z.string().optional()` nên `''` lọt qua và được ghi vào cột
 * — khi đó database có hai cách biểu diễn "không có mô tả" (`NULL` và `''`), và
 * mọi câu `WHERE description IS NULL` sau này sẽ sót một nửa số dòng.
 */
function withOptionalDescription(input: { name: string; description: string }): {
  name: string;
  description?: string;
} {
  return input.description.trim() === ''
    ? { name: input.name }
    : { name: input.name, description: input.description };
}

export async function createWorkspace(input: WorkspaceFormValues): Promise<AdminWorkspaceDto> {
  const { data } = await apiClient.post<AdminWorkspaceDto>(
    '/v1/workspaces',
    withOptionalDescription(input),
  );
  return data;
}

export async function updateWorkspace(
  id: number,
  input: WorkspaceFormValues,
): Promise<AdminWorkspaceDto> {
  const { data } = await apiClient.patch<AdminWorkspaceDto>(
    `/v1/workspaces/${id}`,
    withOptionalDescription(input),
  );
  return data;
}

export async function deleteWorkspace(id: number): Promise<void> {
  await apiClient.delete(`/v1/workspaces/${id}`);
}

// ─── Project (§4.2) ──────────────────────────────────────────────────────────

export interface ProjectListQuery {
  workspaceId: number;
  q: string;
  sort: string;
  order: 'asc' | 'desc';
}

export async function fetchProjects(query: ProjectListQuery): Promise<ProjectDto[]> {
  const { data } = await apiClient.get<ProjectDto[]>('/v1/projects', { params: clean({ ...query }) });
  return data;
}

export interface ProjectFormValues {
  name: string;
  description: string;
}

export async function createProject(
  workspaceId: number,
  input: ProjectFormValues,
): Promise<ProjectDto> {
  const { data } = await apiClient.post<ProjectDto>('/v1/projects', {
    workspaceId,
    ...withOptionalDescription(input),
  });
  return data;
}

export async function updateProject(id: number, input: ProjectFormValues): Promise<ProjectDto> {
  const { data } = await apiClient.patch<ProjectDto>(
    `/v1/projects/${id}`,
    withOptionalDescription(input),
  );
  return data;
}

export async function deleteProject(id: number): Promise<void> {
  await apiClient.delete(`/v1/projects/${id}`);
}

// ─── Thành viên (§4.7) ───────────────────────────────────────────────────────

export interface MemberListQuery {
  page: number;
  pageSize: number;
  sort: string;
  order: 'asc' | 'desc';
  q: string;
  role: TenantRole | '';
  status: 'active' | 'locked' | 'removed' | '';
}

export async function fetchMembers(query: MemberListQuery): Promise<PageResult<AdminUserDto>> {
  const { data } = await apiClient.get<PageResult<AdminUserDto>>('/v1/members', {
    params: clean({ ...query }),
  });
  return data;
}

export interface CreateMemberValues {
  email: string;
  fullName: string;
  role: TenantRole;
  jobTitle?: JobTitle | undefined;
}

export async function createMember(input: CreateMemberValues): Promise<CreateAdminUserResultDto> {
  const { data } = await apiClient.post<CreateAdminUserResultDto>('/v1/members', input);
  return data;
}

/**
 * Cấp lại mật khẩu tạm khi bản hiện một lần đã mất.
 *
 * POST chứ không phải GET, và đó là điểm cần nhớ: không có gì để "lấy về" cả.
 * Database chỉ giữ hash bcrypt, nên lời gọi này SINH một mật khẩu mới và giết
 * mật khẩu cũ. Một `GET /members/:id/password` là thứ không dựng được nếu không
 * lưu mật khẩu ở dạng đọc được — mà lưu như vậy thì một lần lộ database là lộ
 * mật khẩu của tất cả mọi người.
 */
export async function resetMemberPassword(
  userId: number,
): Promise<ResetMemberPasswordResultDto> {
  const { data } = await apiClient.post<ResetMemberPasswordResultDto>(
    `/v1/members/${userId}/reset-password`,
  );
  return data;
}

export async function updateMemberRole(userId: number, role: TenantRole): Promise<void> {
  await apiClient.patch(`/v1/members/${userId}/role`, { role });
}

export async function setMemberActive(userId: number, isActive: boolean): Promise<void> {
  await apiClient.patch(`/v1/members/${userId}/status`, { isActive });
}

export async function removeMember(userId: number): Promise<void> {
  await apiClient.delete(`/v1/members/${userId}`);
}

// ─── Hồ sơ cá nhân (§4.4) ────────────────────────────────────────────────────

/**
 * Nằm ở `/auth/me` chứ không phải `/v1/...`: hồ sơ là danh tính TOÀN CỤC, không
 * thuộc tổ chức nào. Xem ghi chú trong `backend/src/api/auth/index.ts`.
 */
export async function updateProfile(input: UpdateProfileDto): Promise<UserDto> {
  const { data } = await apiClient.patch<UserDto>('/auth/me', input);
  return data;
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  await apiClient.post('/auth/change-password', { currentPassword, newPassword });
}
