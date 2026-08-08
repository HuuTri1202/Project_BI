import type { AdminWorkspaceDto } from '@bi/shared';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useAuth } from '../../auth/useAuth';
import * as api from './api';
import { adminKeys } from './keys';

export function useAdminWorkspaces(): UseQueryResult<AdminWorkspaceDto[]> {
  const { tenant } = useAuth();
  const tenantId = tenant?.id ?? 0;

  return useQuery({
    queryKey: adminKeys.workspaces(tenantId),
    queryFn: api.fetchWorkspaces,
    enabled: tenantId > 0,
  });
}

/** Tạo/sửa/xoá workspace đều làm đổi thẻ KPI "Workspace" ở trang tổng quan. */
function useInvalidateWorkspaces(): () => Promise<void> {
  const queryClient = useQueryClient();
  const { tenant } = useAuth();
  const tenantId = tenant?.id ?? 0;

  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: adminKeys.workspaces(tenantId) }),
      queryClient.invalidateQueries({ queryKey: adminKeys.overview(tenantId) }),
    ]);
  };
}

export function useCreateWorkspace(): UseMutationResult<
  AdminWorkspaceDto,
  unknown,
  api.WorkspacePayload
> {
  const invalidate = useInvalidateWorkspaces();
  return useMutation({ mutationFn: api.createWorkspace, onSuccess: invalidate });
}

export function useUpdateWorkspace(): UseMutationResult<
  AdminWorkspaceDto,
  unknown,
  { id: number; payload: api.WorkspacePayload }
> {
  const invalidate = useInvalidateWorkspaces();
  return useMutation({
    mutationFn: ({ id, payload }) => api.updateWorkspace(id, payload),
    onSuccess: invalidate,
  });
}

export function useDeleteWorkspace(): UseMutationResult<void, unknown, number> {
  const invalidate = useInvalidateWorkspaces();
  return useMutation({ mutationFn: api.deleteWorkspace, onSuccess: invalidate });
}
