import {
  ORDER_STATUSES_LIVE,
  isAwaitingLatePayment,
  type BillingSummaryDto,
  type CreateOrderInput,
  type OrderDetailDto,
  type OrderDto,
  type PageResult,
  type PaymentMethodDto,
  type PlanDto,
  type SubscriptionDto,
  type TenantPlanDto,
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

/**
 * Gói của tổ chức đang mở — cho MỌI vai trò.
 *
 * Tách khỏi `useBillingSummary` vì hook kia gọi `/billing/me`, gác bằng quyền
 * QUẢN LÝ thanh toán: creator và viewer nhận 403. Mà họ vẫn cần biết tổ chức
 * đang ở gói nào và còn tạo được bao nhiêu báo cáo — gói quản trị viên mua là
 * gói của cả tổ chức.
 */
export function useTenantPlan(): UseQueryResult<TenantPlanDto> {
  return useQuery({ queryKey: billingKeys.tenantPlan(), queryFn: api.fetchTenantPlan });
}

/**
 * Còn tạo thêm được một thứ bị đếm hạn mức không — `null` là còn (hoặc chưa biết).
 *
 * Trả về CÂU NÓI chứ không phải cờ: nơi gọi hiện nó ngay tại nút bấm, trước khi
 * người dùng bỏ công dựng cả một báo cáo rồi mới bị từ chối lúc Lưu. Server vẫn
 * là nơi chặn thật (`trongHanMuc`); đây chỉ là báo trước.
 *
 * Đang tải hay lỗi thì coi như còn chỗ: chặn nhầm một người còn quyền tạo tệ hơn
 * nhiều so với để server từ chối một lần.
 */
export function useHetHanMuc(loai: 'reports' | 'workspaces' | 'members'): string | null {
  const { data } = useTenantPlan();
  if (data === undefined) return null;

  const { used, limit } = data.usage[loai];
  if (limit === null || used < limit) return null;

  const danhTu = { reports: 'báo cáo', workspaces: 'workspace', members: 'thành viên' }[loai];
  return `Gói ${data.planName} cho tối đa ${limit.toLocaleString('vi-VN')} ${danhTu}, tổ chức đang có ${used.toLocaleString('vi-VN')}.`;
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
    refetchInterval: (query) => orderStatusPollMs(query.state.data, Date.now()),
    refetchIntervalInBackground: true,
    staleTime: 0,
  });
}

/**
 * Bao lâu nữa thì hỏi lại trạng thái đơn; `false` là thôi hẳn.
 *
 * ─── Đơn `expired` VẪN hỏi tiếp, chậm hơn ─────────────────────────────────
 *
 * Bản cũ dừng ngay khi đơn rời `ORDER_STATUSES_LIVE`, và `expired` nằm ngoài
 * danh sách đó. Nhưng hết hạn chỉ là hết hạn MÃ QR: backend vẫn nhận tiền về
 * muộn trong `LATE_PAYMENT_WINDOW_HOURS`. Đơn thật đã đi đúng đường này (nhật ký
 * ghi `expired` -> `paid`): backend ghi nhận và bật gói, còn màn hình đã ngừng
 * hỏi từ lúc hết hạn nên đứng mãi ở câu "đơn đã đóng, hãy tạo đơn mới". Khách
 * không bao giờ thấy "thành công", và được mời chuyển tiền lần hai.
 *
 * 5 giây, bằng nhịp con quét sao kê ở backend: hỏi nhanh hơn thứ nó chờ không
 * mua được gì. Và có HẠN — hết cửa sổ thì thôi, một tab bỏ quên qua đêm không
 * gõ cửa server mãi.
 */
export function orderStatusPollMs(
  data: api.OrderStatusDto | undefined,
  now: number,
): number | false {
  if (data === undefined) return false;
  if (ORDER_STATUSES_LIVE.includes(data.status)) return 2_000;
  return isAwaitingLatePayment(data, now) ? 5_000 : false;
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
