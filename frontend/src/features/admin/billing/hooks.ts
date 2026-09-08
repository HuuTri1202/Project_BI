import type { PageResult, PlanDto } from '@bi/shared';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import * as api from './api';

/**
 * Hook dữ liệu của console vận hành cho §11.
 *
 * Khoá cache tách hẳn khỏi `billingKeys` của khu người dùng: hai bên đọc hai
 * nguồn khác nhau, và một lần `invalidateQueries(['billing'])` ở khu người dùng
 * không nên kéo theo việc tải lại danh sách đơn của toàn nền tảng.
 */
export const adminBillingKeys = {
  all: ['admin-billing'] as const,
  plans: () => [...adminBillingKeys.all, 'plans'] as const,
  methods: () => [...adminBillingKeys.all, 'methods'] as const,
  orders: (query: unknown) => [...adminBillingKeys.all, 'orders', query] as const,
};

export function useAdminPlans(): UseQueryResult<PlanDto[]> {
  return useQuery({ queryKey: adminBillingKeys.plans(), queryFn: api.fetchAdminPlans });
}

export function useAdminPaymentMethods(): UseQueryResult<api.AdminPaymentMethodDto[]> {
  return useQuery({ queryKey: adminBillingKeys.methods(), queryFn: api.fetchAdminPaymentMethods });
}

export function useAdminOrders(
  query: api.AdminOrderQuery,
): UseQueryResult<PageResult<api.AdminOrderDto>> {
  return useQuery({
    queryKey: adminBillingKeys.orders(query),
    queryFn: () => api.fetchAdminOrders(query),
    placeholderData: keepPreviousData,
  });
}

function useInvalidate(): () => Promise<void> {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: adminBillingKeys.all });
  };
}

export function useCreatePlan(): UseMutationResult<PlanDto, Error, api.PlanWriteInput> {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: api.createPlan, onSuccess: invalidate });
}

export function useUpdatePlan(): UseMutationResult<
  PlanDto,
  Error,
  { id: number; input: api.PlanWriteInput }
> {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, input }) => api.updatePlan(id, input),
    onSuccess: invalidate,
  });
}

export function useDeletePlan(): UseMutationResult<void, Error, number> {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: api.deletePlan, onSuccess: invalidate });
}

export function useUpdatePaymentMethod(): UseMutationResult<
  api.AdminPaymentMethodDto,
  Error,
  { id: number; input: api.PaymentMethodPatch }
> {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, input }) => api.updatePaymentMethod(id, input),
    onSuccess: invalidate,
  });
}

/**
 * Xác nhận đã nhận tiền.
 *
 * Dọn cache RỘNG sau khi thành công: một đơn chuyển sang đã thanh toán làm đổi
 * danh sách đơn, và cũng làm đổi gói của tổ chức đó. Thà gọi lại vài request
 * thừa còn hơn để màn hình hiện "chờ thanh toán" cho một đơn người vận hành vừa
 * tự tay xác nhận.
 */
export function useConfirmOrder(): UseMutationResult<api.ConfirmResult, Error, api.ConfirmInput> {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: api.confirmOrder, onSuccess: invalidate });
}

export function useOverrideSubscription(): UseMutationResult<
  { subscriptionId: number },
  Error,
  api.OverrideInput
> {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: api.overrideSubscription, onSuccess: invalidate });
}
