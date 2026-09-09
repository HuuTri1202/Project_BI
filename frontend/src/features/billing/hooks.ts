import {
  ORDER_STATUSES_LIVE,
  type BillingSummaryDto,
  type CreateOrderInput,
  type OrderDetailDto,
  type OrderDto,
  type PageResult,
  type PaymentMethodDto,
  type PlanDto,
  type SubscriptionDto,
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
import { billingKeys } from './keys';

/**
 * Hook dữ liệu của §11.
 *
 * Luật dọn cache: invalidate ở mức CAO NHẤT còn đúng. Một đơn chuyển sang đã
 * thanh toán làm đổi gói hiện tại, mức sử dụng, danh sách đơn VÀ huy hiệu gói
 * trên sidebar — nhắm đúng một khoá nghĩa là một trong bốn chỗ hiện dữ liệu cũ
 * ngay sau khi người dùng vừa trả tiền, và đó là chỗ tệ nhất để hiện dữ liệu cũ.
 */

export function usePlans(): UseQueryResult<PlanDto[]> {
  return useQuery({
    queryKey: billingKeys.plans(),
    queryFn: api.fetchPlans,
    // Bảng giá gần như không đổi trong một phiên làm việc. 5 phút để người dùng
    // đi qua đi lại giữa trang Billing và trang chọn gói mà không gọi lại.
    staleTime: 300_000,
  });
}

export function usePaymentMethods(): UseQueryResult<PaymentMethodDto[]> {
  return useQuery({
    queryKey: billingKeys.paymentMethods(),
    queryFn: api.fetchPaymentMethods,
    staleTime: 300_000,
  });
}

export function useBillingSummary(): UseQueryResult<BillingSummaryDto> {
  return useQuery({ queryKey: billingKeys.summary(), queryFn: api.fetchBillingSummary });
}

export function useSubscriptionHistory(): UseQueryResult<SubscriptionDto[]> {
  return useQuery({
    queryKey: billingKeys.subscriptions(),
    queryFn: api.fetchSubscriptionHistory,
  });
}

export function useOrders(query: api.OrderListQuery): UseQueryResult<PageResult<OrderDto>> {
  return useQuery({
    queryKey: billingKeys.orderList(query),
    queryFn: () => api.fetchOrders(query),
    placeholderData: keepPreviousData,
  });
}

export function useOrder(code: string | null): UseQueryResult<OrderDetailDto> {
  return useQuery({
    queryKey: billingKeys.order(code ?? ''),
    queryFn: () => api.fetchOrder(code as string),
    enabled: code !== null,
  });
}

/**
 * Hỏi lại trạng thái đơn mỗi HAI giây, và TỰ DỪNG khi đơn kết thúc.
 *
 * ─── Hai giây, và vì sao không nhanh hơn nữa ──────────────────────────────
 *
 * Độ trễ khách cảm nhận được là tổng của ba đoạn, và chỉ đoạn cuối nằm ở đây:
 *
 *   1. ngân hàng -> Sepay      vài giây tới vài chục giây, KHÔNG kiểm soát được
 *   2. Sepay -> hệ thống       tối đa 5 giây (`SEPAY_MS` ở backend runner)
 *   3. hệ thống -> màn hình    tối đa 2 giây, chính là con số dưới đây
 *
 * Rút đoạn 3 xuống nữa chỉ làm tăng số request mà không rút ngắn được tổng, vì
 * hai đoạn đầu đã lớn hơn hẳn. Đây là endpoint NHẸ (chỉ trả trạng thái, không
 * kèm chuỗi QR) nên hai giây không đáng ngại.
 *
 * ─── Vì sao `refetchInterval` là HÀM chứ không phải hằng số ────────────────
 *
 * `refetchInterval: 2000` sẽ gõ cửa server hai giây một lần MÃI MÃI — kể cả sau
 * khi đơn đã thanh toán xong, kể cả khi người dùng để tab đó mở qua đêm. Dạng
 * hàm được react-query gọi lại sau MỖI lần fetch với dữ liệu mới nhất trong
 * tay, và trả `false` là dừng hẳn. Cùng khuôn đã dùng ở `useDatasetLoad` của §9.
 *
 * Danh sách trạng thái "còn sống" lấy từ `@bi/shared` để giao diện và backend
 * không bao giờ nói hai đằng: thêm một trạng thái mới ở đó mà quên ở đây thì
 * màn hình đứng im vĩnh viễn trên một đơn vẫn đang chạy.
 *
 * `refetchIntervalInBackground` vì đây chính là lúc người dùng CHUYỂN TAB: họ
 * sang ứng dụng ngân hàng để chuyển tiền rồi mới quay lại. Không bật thì màn
 * hình đứng im đúng lúc nó cần chạy nhất.
 *
 * `staleTime: 0` để ghi đè mặc định 30 giây của `queryClient` — nếu không thì
 * mỗi lần fetch trả về dữ liệu cache và vòng thăm dò thành vô nghĩa.
 */
export function useOrderStatus(
  code: string | null,
  enabled = true,
): UseQueryResult<api.OrderStatusDto> {
  return useQuery({
    queryKey: billingKeys.orderStatus(code ?? ''),
    queryFn: () => api.fetchOrderStatus(code as string),
    enabled: code !== null && enabled,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status !== undefined && ORDER_STATUSES_LIVE.includes(status) ? 2_000 : false;
    },
    refetchIntervalInBackground: true,
    staleTime: 0,
  });
}

/**
 * Dọn MỌI thứ liên quan tới thanh toán.
 *
 * Gọi khi một đơn đổi trạng thái. Rộng tay là đúng ở đây: bốn màn hình cùng
 * phản ánh một sự thật, và thà gọi lại vài request thừa còn hơn để một trong
 * bốn chỗ hiện gói cũ sau khi khách vừa trả tiền.
 */
export function useInvalidateBilling(): () => Promise<void> {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: billingKeys.all });
  };
}

export function useCreateOrder(): UseMutationResult<OrderDetailDto, Error, CreateOrderInput> {
  const invalidate = useInvalidateBilling();
  return useMutation({
    mutationFn: api.createOrder,
    onSuccess: invalidate,
  });
}

export function useCancelOrder(): UseMutationResult<void, Error, string> {
  const invalidate = useInvalidateBilling();
  return useMutation({
    mutationFn: api.cancelOrder,
    onSuccess: invalidate,
  });
}
