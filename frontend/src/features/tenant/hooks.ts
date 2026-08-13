import type {
  AdminUserDto,
  ConnectionDto,
  ConnectionPrerequisitesDto,
  DatasetDetailDto,
  DatasetDto,
  DatasetPreviewDto,
  PageResult,
  ProjectDto,
  SourceTableDto,
  TenantDto,
  TenantRole,
} from '@bi/shared';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useAuth } from '../../auth/useAuth';
import { useWorkspace } from '../../workspace/useWorkspace';
import * as api from './api';
import { tenantKeys } from './keys';

/**
 * Hook dữ liệu của khu người dùng.
 *
 * ─── Luật dọn cache sau khi ghi ─────────────────────────────────────────────
 *
 * Mọi mutation `invalidate` ở mức CAO NHẤT còn đúng, không phải mức hẹp nhất:
 * tạo một project làm đổi cả danh sách project LẪN số `projectCount` trong bộ
 * chuyển workspace LẪN thẻ số trên trang Home. Nhắm đúng một key nghĩa là hai
 * chỗ kia hiện số cũ cho tới lần refetch tự nhiên — và người dùng tin vào số cũ
 * đó, vì họ vừa mới tự tay tạo ra thứ làm nó thay đổi.
 */

// ─── Home (§4.3) ─────────────────────────────────────────────────────────────

export function useHome() {
  const { current, isLoading } = useWorkspace();
  const workspaceId = current?.id ?? null;

  return useQuery({
    queryKey: tenantKeys.home(workspaceId),
    queryFn: () => api.fetchHome(workspaceId),
    // Chờ bộ chuyển workspace xong đã. Gọi trước sẽ tốn một request với
    // `workspaceId` rỗng, backend chọn giúp cái đầu tiên, rồi ngay sau đó là một
    // request thứ hai với id thật — trang nhảy số hai lần trước mắt người dùng.
    enabled: !isLoading,
  });
}

// ─── Project ─────────────────────────────────────────────────────────────────

export function useProjects(
  query: Omit<api.ProjectListQuery, 'workspaceId'>,
): UseQueryResult<ProjectDto[]> {
  const { current } = useWorkspace();
  const workspaceId = current?.id ?? null;

  return useQuery({
    queryKey: tenantKeys.projectList(workspaceId, query),
    queryFn: () => api.fetchProjects({ ...query, workspaceId: workspaceId as number }),
    enabled: workspaceId !== null,
    // Giữ kết quả cũ trong lúc tải trang mới — nếu không, mỗi lần gõ một ký tự
    // tìm kiếm thì lưới chớp trắng rồi hiện lại, và chiều cao trang nhảy khiến
    // con trỏ chuột trượt khỏi thứ đang định bấm.
    placeholderData: keepPreviousData,
  });
}

/** Dọn mọi thứ mà một thay đổi project có thể chạm tới. */
function useInvalidateProjects(): () => Promise<void> {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: tenantKeys.projects() });
    await queryClient.invalidateQueries({ queryKey: tenantKeys.all, predicate: (q) =>
      q.queryKey[1] === 'home' || q.queryKey[1] === 'workspaces' });
  };
}

export function useCreateProject(): UseMutationResult<
  ProjectDto,
  unknown,
  api.ProjectFormValues
> {
  const { current } = useWorkspace();
  const invalidate = useInvalidateProjects();

  return useMutation({
    mutationFn: (values: api.ProjectFormValues) =>
      api.createProject(current?.id as number, values),
    onSuccess: invalidate,
  });
}

export function useUpdateProject(): UseMutationResult<
  ProjectDto,
  unknown,
  { id: number; values: api.ProjectFormValues }
> {
  const invalidate = useInvalidateProjects();
  return useMutation({
    mutationFn: ({ id, values }: { id: number; values: api.ProjectFormValues }) =>
      api.updateProject(id, values),
    onSuccess: invalidate,
  });
}

export function useDeleteProject(): UseMutationResult<void, unknown, number> {
  const invalidate = useInvalidateProjects();
  return useMutation({ mutationFn: api.deleteProject, onSuccess: invalidate });
}

// ─── Tổ chức ─────────────────────────────────────────────────────────────────

export function useTenant(): UseQueryResult<TenantDto> {
  return useQuery({ queryKey: tenantKeys.tenant(), queryFn: api.fetchTenant });
}

/**
 * Đổi tên tổ chức.
 *
 * `applyTenant` là phần KHÔNG ĐƯỢC QUÊN. Tên tổ chức nằm trong state phiên
 * (topbar, bộ chuyển tổ chức) chứ không phải trong cache react-query, nên chỉ
 * `invalidateQueries` thôi thì bảng đổi tên hiện tên mới còn topbar ngay phía
 * trên vẫn hiện tên cũ cho tới khi F5 — hai câu trả lời khác nhau cho cùng một
 * câu hỏi trên cùng một màn hình.
 */
export function useUpdateTenant() {
  const queryClient = useQueryClient();
  const { applyTenant } = useAuth();
  return useMutation({
    mutationFn: api.updateTenant,
    onSuccess: async (tenant) => {
      applyTenant(tenant);
      await queryClient.invalidateQueries({ queryKey: tenantKeys.tenant() });
    },
  });
}

// ─── Kết nối CSDL (§8) ───────────────────────────────────────────────────────

export function usePrerequisites(): UseQueryResult<ConnectionPrerequisitesDto> {
  return useQuery({
    queryKey: tenantKeys.prerequisites(),
    queryFn: api.fetchPrerequisites,
    // Nội dung là hằng số cấu hình phía server — IP hệ thống và danh sách quyền
    // không đổi giữa hai lần mở wizard.
    staleTime: Infinity,
  });
}

export function useConnections(): UseQueryResult<ConnectionDto[]> {
  return useQuery({ queryKey: tenantKeys.connections(), queryFn: api.fetchConnections });
}

function useInvalidateConnections(): () => Promise<void> {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: tenantKeys.connections() });
  };
}

export function useCreateConnection() {
  const invalidate = useInvalidateConnections();
  return useMutation({ mutationFn: api.createConnection, onSuccess: invalidate });
}

export function useUpdateConnection() {
  const invalidate = useInvalidateConnections();
  return useMutation({
    mutationFn: ({ id, values }: { id: number; values: api.ConnectionFormValues }) =>
      api.updateConnection(id, values),
    onSuccess: invalidate,
  });
}

export function useDeleteConnection() {
  const invalidate = useInvalidateConnections();
  return useMutation({ mutationFn: api.deleteConnection, onSuccess: invalidate });
}

/**
 * Thử lại một kết nối đã lưu.
 *
 * Làm mới danh sách sau khi chạy vì backend ghi kết quả vào `last_tested_at` /
 * `last_test_error` — không invalidate thì huy hiệu trạng thái trên bảng vẫn
 * hiện kết quả của lần thử trước.
 */
export function useTestSavedConnection() {
  const invalidate = useInvalidateConnections();
  return useMutation({ mutationFn: api.testSavedConnection, onSuccess: invalidate });
}

/**
 * Bảng trong CSDL nguồn.
 *
 * `enabled` để nó CHỈ chạy khi hộp thoại đã mở và đã chọn kết nối: mỗi lần gọi
 * là một kết nối TCP thật tới máy chủ của khách hàng, không phải một truy vấn
 * rẻ tiền trong database của mình.
 */
export function useSourceTables(connectionId: number | null): UseQueryResult<SourceTableDto[]> {
  return useQuery({
    queryKey: tenantKeys.sourceTables(connectionId),
    queryFn: () => api.fetchSourceTables(connectionId as number),
    enabled: connectionId !== null,
    // Không tự chạy lại khi người dùng quay lại tab: xem lý do ở trên.
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });
}

export function useSyncTables() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, tables }: { id: number; tables: { schema: string; table: string }[] }) =>
      api.syncTables(id, tables),
    onSuccess: async () => {
      // Đồng bộ đổi CẢ BA thứ: kho dữ liệu, cờ `imported` của danh sách bảng, và
      // `datasetCount` trên từng kết nối. Nhắm đúng một key nghĩa là hai chỗ kia
      // hiện số cũ ngay sau khi người dùng vừa tự tay làm nó thay đổi.
      await queryClient.invalidateQueries({ queryKey: tenantKeys.datasets() });
      await queryClient.invalidateQueries({ queryKey: tenantKeys.connections() });
    },
  });
}

// ─── Kho dữ liệu (§8.5) ──────────────────────────────────────────────────────

export function useDatasets(query: api.DatasetListQuery): UseQueryResult<PageResult<DatasetDto>> {
  return useQuery({
    queryKey: tenantKeys.datasetList(query),
    queryFn: () => api.fetchDatasets(query),
    placeholderData: keepPreviousData,
  });
}

export function useDataset(id: number | null): UseQueryResult<DatasetDetailDto> {
  return useQuery({
    queryKey: tenantKeys.dataset(id),
    queryFn: () => api.fetchDataset(id as number),
    enabled: id !== null,
  });
}

/**
 * Xem trước dữ liệu của một dataset.
 *
 * `enabled` để nó chỉ chạy khi tab "Dữ liệu" đang mở: mỗi lần gọi là một câu
 * SELECT trên CSDL của khách hàng, không phải một truy vấn rẻ tiền trong database
 * của mình. Người vào thẳng tab "Cấu trúc" thì không tốn kết nối nào.
 *
 * `staleTime` 60 giây và không tự chạy lại khi quay lại tab trình duyệt — cùng
 * lý do với `useSourceTables`.
 */
export function useDatasetPreview(id: number | null): UseQueryResult<DatasetPreviewDto> {
  return useQuery({
    queryKey: tenantKeys.datasetPreview(id),
    queryFn: () => api.fetchDatasetPreview(id as number),
    enabled: id !== null,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
    // Không thử lại: lỗi ở đây gần như luôn là lỗi phía CSDL nguồn (mất quyền,
    // bảng đã xoá, máy chủ không tới được), và thử lại chỉ nhân số kết nối mở ra
    // máy chủ của khách hàng lên trong khi kết quả không đổi.
    retry: false,
  });
}

function useInvalidateDatasets(): () => Promise<void> {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: tenantKeys.datasets() });
    await queryClient.invalidateQueries({ queryKey: tenantKeys.connections() });
  };
}

export function useRenameDataset() {
  const invalidate = useInvalidateDatasets();
  return useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => api.renameDataset(id, name),
    onSuccess: invalidate,
  });
}

export function useDeleteDataset() {
  const invalidate = useInvalidateDatasets();
  return useMutation({ mutationFn: api.deleteDataset, onSuccess: invalidate });
}

// ─── Workspace (§4.5) ────────────────────────────────────────────────────────

/**
 * Danh sách workspace lấy thẳng từ `WorkspaceProvider`, KHÔNG gọi `useQuery`
 * lần nữa.
 *
 * Provider đã giữ đúng query key này rồi; thêm một `useQuery` cùng key ở đây chỉ
 * là cách viết dài dòng hơn cho cùng một cache. Quan trọng hơn: nó khiến người
 * đọc tưởng có hai nguồn dữ liệu và phải tự hỏi cái nào mới đúng.
 */
export function useWorkspaceList(): {
  items: ReturnType<typeof useWorkspace>['all'];
  isLoading: boolean;
  error: string | null;
} {
  const { all, isLoading, error } = useWorkspace();
  return { items: all, isLoading, error };
}

function useInvalidateWorkspaces(): () => Promise<void> {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: tenantKeys.workspaces() });
    await queryClient.invalidateQueries({ queryKey: tenantKeys.projects() });
    await queryClient.invalidateQueries({
      queryKey: tenantKeys.all,
      predicate: (q) => q.queryKey[1] === 'home',
    });
  };
}

export function useCreateWorkspace() {
  const invalidate = useInvalidateWorkspaces();
  return useMutation({ mutationFn: api.createWorkspace, onSuccess: invalidate });
}

export function useUpdateWorkspace() {
  const invalidate = useInvalidateWorkspaces();
  return useMutation({
    mutationFn: ({ id, values }: { id: number; values: api.WorkspaceFormValues }) =>
      api.updateWorkspace(id, values),
    onSuccess: invalidate,
  });
}

export function useDeleteWorkspace() {
  const invalidate = useInvalidateWorkspaces();
  return useMutation({ mutationFn: api.deleteWorkspace, onSuccess: invalidate });
}

// ─── Thành viên (§4.7) ───────────────────────────────────────────────────────

export function useMembers(query: api.MemberListQuery): UseQueryResult<PageResult<AdminUserDto>> {
  return useQuery({
    queryKey: tenantKeys.memberList(query),
    queryFn: () => api.fetchMembers(query),
    placeholderData: keepPreviousData,
  });
}

function useInvalidateMembers(): () => Promise<void> {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: tenantKeys.members() });
    await queryClient.invalidateQueries({
      queryKey: tenantKeys.all,
      predicate: (q) => q.queryKey[1] === 'home',
    });
  };
}

export function useCreateMember() {
  const invalidate = useInvalidateMembers();
  return useMutation({ mutationFn: api.createMember, onSuccess: invalidate });
}

export function useUpdateMemberRole() {
  const invalidate = useInvalidateMembers();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: number; role: TenantRole }) =>
      api.updateMemberRole(userId, role),
    onSuccess: invalidate,
  });
}

export function useSetMemberActive() {
  const invalidate = useInvalidateMembers();
  return useMutation({
    mutationFn: ({ userId, isActive }: { userId: number; isActive: boolean }) =>
      api.setMemberActive(userId, isActive),
    onSuccess: invalidate,
  });
}

export function useRemoveMember() {
  const invalidate = useInvalidateMembers();
  return useMutation({ mutationFn: api.removeMember, onSuccess: invalidate });
}

/**
 * Vẫn `invalidate` dù danh sách trông như không đổi: cấp lại mật khẩu bật lại
 * `must_change_password`, và cột Email hiện huy hiệu "Chưa đổi mật khẩu tạm" dựa
 * đúng vào cờ đó. Bỏ qua bước này thì huy hiệu không hiện lên cho tới lần refetch
 * tự nhiên, và admin sẽ tưởng thao tác vừa rồi không ăn.
 */
export function useResetMemberPassword() {
  const invalidate = useInvalidateMembers();
  return useMutation({ mutationFn: api.resetMemberPassword, onSuccess: invalidate });
}

// ─── Hồ sơ cá nhân (§4.4) ────────────────────────────────────────────────────

/**
 * Sửa hồ sơ xong phải đồng bộ lại `AuthProvider`, không chỉ cache react-query:
 * tên trên topbar đọc từ `useAuth()`, nên thiếu bước này người dùng lưu xong sẽ
 * thấy tên cũ ở góc màn hình và tên mới trong form — hai sự thật cùng lúc.
 */
export function useUpdateProfile() {
  const { applyProfile } = useAuth();
  return useMutation({
    mutationFn: api.updateProfile,
    onSuccess: (user) => applyProfile(user),
  });
}

export function useChangePassword() {
  const { markPasswordChanged } = useAuth();
  return useMutation({
    mutationFn: ({
      currentPassword,
      newPassword,
    }: {
      currentPassword: string;
      newPassword: string;
    }) => api.changePassword(currentPassword, newPassword),
    onSuccess: () => markPasswordChanged(),
  });
}
