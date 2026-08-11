import type { AdminUserDto, PageResult, ProjectDto, TenantDto, TenantRole } from '@bi/shared';
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
