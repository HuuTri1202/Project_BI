import type { AdminUserDto, PageResult, TenantRole } from '@bi/shared';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useAuth } from '../../auth/useAuth';
import * as api from './api';
import { adminKeys } from './keys';

/**
 * Danh sách thành viên (§3.3).
 *
 * `placeholderData: keepPreviousData` giữ lại kết quả cũ trong lúc tải trang
 * mới — nếu không, mỗi lần gõ một ký tự tìm kiếm hoặc bấm sang trang, bảng sẽ
 * chớp trắng rồi hiện lại. Nhìn như trang bị giật, và tệ hơn: chiều cao trang
 * nhảy lên nhảy xuống khiến con trỏ chuột trượt khỏi nút đang định bấm.
 */
export function useAdminUsers(
  query: api.UserListQuery,
): UseQueryResult<PageResult<AdminUserDto>> {
  const { tenant } = useAuth();
  const tenantId = tenant?.id ?? 0;

  return useQuery({
    queryKey: adminKeys.usersList(tenantId, query),
    queryFn: () => api.fetchUsers(query),
    enabled: tenantId > 0,
    placeholderData: keepPreviousData,
  });
}

/**
 * Gom việc huỷ cache sau mỗi thao tác ghi.
 *
 * Luôn huỷ CẢ `users` LẪN `overview`: mọi thao tác trong §3.4 đều làm đổi ít
 * nhất một thẻ KPI (thêm người đổi tổng, khoá người đổi số bị khoá, đổi vai trò
 * đổi số quản trị viên). Quên `overview` thì bốn con số ở trang tổng quan sẽ nói
 * một đằng còn bảng nói một nẻo, cho tới lần tải lại tiếp theo.
 */
function useInvalidateAdmin(): () => Promise<void> {
  const queryClient = useQueryClient();
  const { tenant } = useAuth();
  const tenantId = tenant?.id ?? 0;

  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: adminKeys.users(tenantId) }),
      queryClient.invalidateQueries({ queryKey: adminKeys.overview(tenantId) }),
    ]);
  };
}

export function useCreateUser(): UseMutationResult<
  Awaited<ReturnType<typeof api.createUser>>,
  unknown,
  api.CreateUserPayload
> {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: api.createUser,
    onSuccess: invalidate,
  });
}

export function useUpdateUserRole(): UseMutationResult<
  void,
  unknown,
  { userId: number; role: TenantRole }
> {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: ({ userId, role }) => api.updateUserRole(userId, role),
    onSuccess: invalidate,
  });
}

export function useUpdateUserStatus(): UseMutationResult<
  void,
  unknown,
  { userId: number; isActive: boolean }
> {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: ({ userId, isActive }) => api.updateUserStatus(userId, isActive),
    onSuccess: invalidate,
  });
}

export function useRemoveUser(): UseMutationResult<void, unknown, number> {
  const invalidate = useInvalidateAdmin();
  return useMutation({
    mutationFn: api.removeUser,
    onSuccess: invalidate,
  });
}
