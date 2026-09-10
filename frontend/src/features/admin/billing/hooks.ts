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

/**
 * Khoá của chuông báo — CỐ Ý nằm ngoài `adminBillingKeys.all`.
 *
 * Mọi mutation của khu này gọi `invalidateQueries(adminBillingKeys.all)`. Nếu
 * chuông nằm trong nhánh đó thì mỗi lần xác nhận một đơn sẽ huỷ và dựng lại query
 * của chuông, tức là ĐẶT LẠI vòng thăm dò — và một vòng thăm dò bị đặt lại liên
 * tục thì không còn là vòng thăm dò nữa. Cùng lý do đã ghi cho `orderStatus` ở
 * `features/billing/keys.ts`.
 *
 * Đổi lại phải tự làm mới nó sau khi xác nhận — xem `useConfirmOrder`.
 */
const chuongKey = ['admin-billing-attention'] as const;

/**
 * Số đơn đang cần người vận hành nhìn.
 *
 * ⚠️ Đây là vòng thăm dò CHẠY MÃI, khác hẳn ba vòng thăm dò còn lại của repo —
 * chúng đều tự dừng khi việc chúng theo dõi kết thúc. Ở đây không có "kết thúc":
 * tiền có thể về bất cứ lúc nào, kể cả lúc không ai bấm gì.
 *
 * Nên nhịp phải chọn có ý thức: 60 giây, không phải 3 giây. Đây là thông báo,
 * không phải thanh tiến trình — chậm một phút không ai thiệt, còn gõ cửa server
 * hai mươi lần mỗi phút cho mỗi tab admin đang mở thì có.
 *
 * `refetchIntervalInBackground` để MẶC ĐỊNH (tắt): tab admin nằm im dưới đáy
 * cửa sổ suốt đêm không cần đếm lại; nó sẽ tự đếm khi người ta quay lại.
 */
export function useDonCanNhin(): UseQueryResult<number> {
  return useQuery({
    queryKey: chuongKey,
    queryFn: api.fetchDonCanNhin,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

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

/**
 * Bắn một biến động số dư giả vào đúng đường webhook thật — §11.2, chỉ ở dev.
 *
 * Dọn cache RỘNG sau khi xong, kể cả chuông: một lần giả lập có thể đổi trạng
 * thái đơn, kích hoạt gói cho một tổ chức, và làm số đơn chờ đối chiếu tăng hoặc
 * giảm — cả ba đều đang hiện trên màn hình người vừa bấm.
 */
export function useGiaLapChuyenKhoan(): UseMutationResult<
  { message: string },
  Error,
  { orderCode: string; amountVnd: number }
> {
  const invalidate = useInvalidate();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.giaLapChuyenKhoan,
    onSuccess: async () => {
      await invalidate();
      await queryClient.invalidateQueries({ queryKey: chuongKey });
    },
  });
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
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.confirmOrder,
    onSuccess: async () => {
      await invalidate();
      /*
       * Chuông phải tự làm mới ở ĐÂY, tường minh.
       *
       * Nó cố ý nằm ngoài `adminBillingKeys.all` để `invalidate` không đặt lại
       * vòng thăm dò của nó — cái giá phải trả là chỗ này. Không có dòng dưới
       * thì người vận hành vừa xử lý xong đơn cuối cùng vẫn thấy số đếm cũ trên
       * sidebar tới một phút, và sẽ đi tìm một đơn không còn ở đó.
       */
      await queryClient.invalidateQueries({ queryKey: chuongKey });
    },
  });
}

export function useOverrideSubscription(): UseMutationResult<
  { subscriptionId: number },
  Error,
  api.OverrideInput
> {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: api.overrideSubscription, onSuccess: invalidate });
}
