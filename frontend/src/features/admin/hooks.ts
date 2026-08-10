import type {
  PageResult,
  PlatformOverviewDto,
  PlatformTenantDetailDto,
  PlatformTenantDto,
  PlatformUserDto,
  PlatformWorkspaceDto,
} from '@bi/shared';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import * as api from './api';
import { adminKeys } from './keys';

/**
 * `placeholderData: keepPreviousData` giữ kết quả cũ trong lúc tải trang mới.
 *
 * Không có nó, mỗi lần gõ một ký tự tìm kiếm hoặc bấm sang trang thì bảng chớp
 * trắng rồi hiện lại — nhìn như trang bị giật, và tệ hơn: chiều cao trang nhảy
 * lên nhảy xuống khiến con trỏ chuột trượt khỏi nút đang định bấm.
 */

export function useOverview(): UseQueryResult<PlatformOverviewDto> {
  return useQuery({ queryKey: adminKeys.overview(), queryFn: api.fetchOverview });
}

export function useTenants(
  query: api.TenantListQuery,
): UseQueryResult<PageResult<PlatformTenantDto>> {
  return useQuery({
    queryKey: adminKeys.tenantList(query),
    queryFn: () => api.fetchTenants(query),
    placeholderData: keepPreviousData,
  });
}

export function useTenantDetail(id: number | null): UseQueryResult<PlatformTenantDetailDto> {
  return useQuery({
    queryKey: adminKeys.tenantDetail(id ?? 0),
    queryFn: () => api.fetchTenantDetail(id as number),
    enabled: id !== null,
  });
}

export function useUsers(query: api.UserListQuery): UseQueryResult<PageResult<PlatformUserDto>> {
  return useQuery({
    queryKey: adminKeys.userList(query),
    queryFn: () => api.fetchUsers(query),
    placeholderData: keepPreviousData,
  });
}

export function useWorkspaces(
  query: api.WorkspaceListQuery,
): UseQueryResult<PageResult<PlatformWorkspaceDto>> {
  return useQuery({
    queryKey: adminKeys.workspaceList(query),
    queryFn: () => api.fetchWorkspaces(query),
    placeholderData: keepPreviousData,
  });
}

/**
 * Huỷ cache sau mỗi thao tác ghi.
 *
 * Luôn huỷ CẢ danh sách LẪN `overview`: mọi thao tác đều làm đổi ít nhất một
 * chỉ số ở trang tổng quan (khoá tenant đổi số tổ chức hoạt động, xoá user đổi
 * tổng số user…). Quên `overview` thì các con số nói một đằng còn bảng nói một
 * nẻo, cho tới lần tải lại tiếp theo.
 *
 * Xoá tenant/workspace cũng đổi số liệu của nhau, nên đơn giản nhất là huỷ từ
 * gốc `adminKeys.all` — console này ít dữ liệu, tải lại toàn bộ không đáng kể.
 */
function useInvalidateAll(): () => Promise<void> {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: adminKeys.all });
  };
}

export function useSetTenantActive(): UseMutationResult<
  void,
  unknown,
  { id: number; isActive: boolean }
> {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, isActive }) => api.setTenantActive(id, isActive),
    onSuccess: invalidate,
  });
}

export function useDeleteTenant(): UseMutationResult<void, unknown, number> {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: api.deleteTenant, onSuccess: invalidate });
}

export function useSetUserActive(): UseMutationResult<
  void,
  unknown,
  { id: number; isActive: boolean }
> {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, isActive }) => api.setUserActive(id, isActive),
    onSuccess: invalidate,
  });
}

export function useDeleteUser(): UseMutationResult<void, unknown, number> {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: api.deleteUser, onSuccess: invalidate });
}

export function useSetWorkspaceActive(): UseMutationResult<
  void,
  unknown,
  { id: number; isActive: boolean }
> {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ id, isActive }) => api.setWorkspaceActive(id, isActive),
    onSuccess: invalidate,
  });
}

export function useDeleteWorkspace(): UseMutationResult<void, unknown, number> {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: api.deleteWorkspace, onSuccess: invalidate });
}
