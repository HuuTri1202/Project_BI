import type { OrderDto, PageResult, PaymentMethodDto, PlanDto } from '@bi/shared';

import { apiClient } from '../../../services/apiClient';

/**
 * Lời gọi HTTP của console vận hành cho §11.
 *
 * Tách khỏi `features/billing/api.ts` một cách có chủ ý: hai bộ hàm gọi hai khu
 * API khác nhau (`/v1` với `/admin`), gác bằng hai trục vai trò khác nhau, và
 * trả về những thứ khác nhau — danh sách đơn ở đây mang tên tổ chức, còn bên
 * kia thì không có khái niệm "tổ chức khác".
 *
 * Trộn chung một file là cách một hôm nào đó ai đó gọi nhầm hàm xuyên-tổ-chức
 * từ một màn hình của người dùng.
 */

/** Đơn hàng như console thấy: kèm tổ chức và mã tham chiếu đã ghi nhận. */
export interface AdminOrderDto extends OrderDto {
  tenantId: number;
  tenantName: string;
  providerTxnRef: string | null;
}

/**
 * Phương thức thanh toán kèm GỢI Ý khoá bí mật.
 *
 * ⚠️ `webhookSecretHint` là BỐN ký tự cuối, do backend cắt. Không có trường nào
 * mang khoá đầy đủ, và không được thêm — đủ để người vận hành nhận ra khoá họ
 * vừa dán, không đủ để dựng lại nó.
 *
 * `null` = chưa cấu hình. `'????'` = có dữ liệu nhưng giải mã hỏng (khoá mã hoá
 * đã đổi) — hai chuyện khác nhau, và giao diện phải nói được cả hai.
 */
export interface AdminPaymentMethodDto extends PaymentMethodDto {
  webhookSecretHint: string | null;
}

export interface PlanWriteInput {
  code?: string;
  name: string;
  description?: string | null;
  priceVnd: number;
  durationDays: number;
  maxWorkspaces: number | null;
  maxReports: number | null;
  maxMembers: number | null;
  maxStorageBytes: number | null;
  isPublic?: boolean;
  isFeatured?: boolean;
  sortOrder?: number;
}

export async function fetchAdminPlans(): Promise<PlanDto[]> {
  const { data } = await apiClient.get<PlanDto[]>('/admin/billing/plans');
  return data;
}

export async function createPlan(input: PlanWriteInput): Promise<PlanDto> {
  const { data } = await apiClient.post<PlanDto>('/admin/billing/plans', input);
  return data;
}

export async function updatePlan(id: number, input: PlanWriteInput): Promise<PlanDto> {
  const { data } = await apiClient.patch<PlanDto>(`/admin/billing/plans/${String(id)}`, input);
  return data;
}

export async function deletePlan(id: number): Promise<void> {
  await apiClient.delete(`/admin/billing/plans/${String(id)}`);
}

export async function fetchAdminPaymentMethods(): Promise<AdminPaymentMethodDto[]> {
  const { data } = await apiClient.get<AdminPaymentMethodDto[]>('/admin/billing/payment-methods');
  return data;
}

export interface PaymentMethodPatch {
  name?: string;
  instructions?: string | null;
  bankBin?: string | null;
  bankAccountNo?: string | null;
  bankAccountName?: string | null;
  /** Bỏ trống = GIỮ NGUYÊN khoá đang có. `null` = xoá khoá. */
  webhookSecret?: string | null;
  /**
   * Ảnh QR tĩnh dạng data URL base64. Bỏ trống = GIỮ NGUYÊN ảnh đang có,
   * `null` = gỡ ảnh.
   *
   * Gửi trong JSON chứ không multipart: repo cố ý không bật
   * `express.urlencoded`, và thêm parser multipart chỉ vì một ảnh vài chục KB
   * là mở lại đúng lớp phòng thủ CSRF mà việc đó đang giữ.
   */
  staticQrImage?: string | null;
  isActive?: boolean;
}

export async function updatePaymentMethod(
  id: number,
  input: PaymentMethodPatch,
): Promise<AdminPaymentMethodDto> {
  const { data } = await apiClient.patch<AdminPaymentMethodDto>(
    `/admin/billing/payment-methods/${String(id)}`,
    input,
  );
  return data;
}

export interface AdminOrderQuery {
  page: number;
  pageSize: number;
  status: string;
  provider: string;
  q: string;
  sort: string;
  order: 'asc' | 'desc';
}

function clean(input: Record<string, string | number | undefined>): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== '') out[key] = value;
  }
  return out;
}

export async function fetchAdminOrders(
  query: AdminOrderQuery,
): Promise<PageResult<AdminOrderDto>> {
  const { data } = await apiClient.get<PageResult<AdminOrderDto>>('/admin/billing/orders', {
    params: clean({ ...query }),
  });
  return data;
}

export interface ConfirmInput {
  code: string;
  providerTxnRef: string;
  amountVnd: number;
  reason?: string;
}

export interface ConfirmResult {
  orderCode: string;
  tenantId: number;
  /** `true` = đơn đã được ghi nhận từ trước. KHÔNG phải lỗi. */
  alreadyProcessed: boolean;
  subscriptionId: number | null;
}

export async function confirmOrder(input: ConfirmInput): Promise<ConfirmResult> {
  const { code, ...body } = input;
  const { data } = await apiClient.post<ConfirmResult>(
    `/admin/billing/orders/${code}/confirm`,
    body,
  );
  return data;
}

export interface OverrideInput {
  tenantId: number;
  planId: number;
  durationDays: number;
  /** BẮT BUỘC. Database cũng cưỡng chế bằng `ck_subscriptions_override_has_reason`. */
  reason: string;
}

export async function overrideSubscription(input: OverrideInput): Promise<{ subscriptionId: number }> {
  const { data } = await apiClient.post<{ subscriptionId: number }>(
    '/admin/billing/subscriptions/override',
    input,
  );
  return data;
}
