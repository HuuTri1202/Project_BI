import type {
  BillingSummaryDto,
  CreateOrderInput,
  OrderDetailDto,
  OrderDto,
  OrderStatus,
  PageResult,
  PaymentMethodDto,
  PlanDto,
  SubscriptionDto,
} from '@bi/shared';

import { apiClient } from '../../services/apiClient';

/**
 * Lời gọi HTTP của §11 — gói dịch vụ và thanh toán.
 *
 * Cùng quy ước với các feature khác: đường dẫn tương đối với
 * `VITE_API_BASE_URL`, token do interceptor tự gắn, không hàm nào nhận
 * `tenantId` (backend lấy từ token), và không hàm nào bắt lỗi — react-query cần
 * thấy Promise bị reject.
 *
 * ⚠️ KHÔNG có hàm nào đánh dấu một đơn là đã thanh toán. Trình duyệt chỉ HỎI
 * trạng thái; việc đổi nó là của webhook hoặc của người vận hành đối chiếu sao
 * kê. Một endpoint "tôi đã trả tiền rồi" là endpoint cho không dịch vụ.
 */

export async function fetchPlans(): Promise<PlanDto[]> {
  const { data } = await apiClient.get<PlanDto[]>('/v1/plans');
  return data;
}

export async function fetchPaymentMethods(): Promise<PaymentMethodDto[]> {
  const { data } = await apiClient.get<PaymentMethodDto[]>('/v1/payment-methods');
  return data;
}

export async function fetchBillingSummary(): Promise<BillingSummaryDto> {
  const { data } = await apiClient.get<BillingSummaryDto>('/v1/billing/me');
  return data;
}

export async function fetchSubscriptionHistory(): Promise<SubscriptionDto[]> {
  const { data } = await apiClient.get<SubscriptionDto[]>('/v1/billing/subscriptions');
  return data;
}

export interface OrderListQuery {
  page: number;
  pageSize: number;
  status: string;
  sort: string;
  order: 'asc' | 'desc';
}

/** Bỏ chuỗi rỗng: `z.enum().optional()` ném 400 khi nhận `''`. */
function clean(input: Record<string, string | number | undefined>): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== '') out[key] = value;
  }
  return out;
}

export async function fetchOrders(query: OrderListQuery): Promise<PageResult<OrderDto>> {
  const { data } = await apiClient.get<PageResult<OrderDto>>('/v1/orders', {
    params: clean({ ...query }),
  });
  return data;
}

export async function fetchOrder(code: string): Promise<OrderDetailDto> {
  const { data } = await apiClient.get<OrderDetailDto>(`/v1/orders/${code}`);
  return data;
}

/**
 * Trạng thái đơn — endpoint NHẸ, dành riêng cho việc hỏi lại mỗi ba giây.
 *
 * Không dùng `fetchOrder` cho việc này: cái kia trả về cả chuỗi QR, vài trăm
 * byte mỗi lần, nhân với một request mỗi ba giây trên mọi màn hình đang mở.
 */
export interface OrderStatusDto {
  orderCode: string;
  status: OrderStatus;
  paidAt: string | null;
  expiresAt: string;
}

export async function fetchOrderStatus(code: string): Promise<OrderStatusDto> {
  const { data } = await apiClient.get<OrderStatusDto>(`/v1/orders/${code}/status`);
  return data;
}

export async function createOrder(input: CreateOrderInput): Promise<OrderDetailDto> {
  const { data } = await apiClient.post<OrderDetailDto>('/v1/orders', input);
  return data;
}

export async function cancelOrder(code: string): Promise<void> {
  await apiClient.post(`/v1/orders/${code}/cancel`);
}
