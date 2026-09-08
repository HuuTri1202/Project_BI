/**
 * Khoá cache của §11.
 *
 * Lồng nhau để `invalidateQueries` ở mức cha cuốn theo con — cùng luật với
 * `tenantKeys`.
 *
 * ⚠️ `orderStatus` nằm NGOÀI nhánh `orders`, và đó là chủ ý.
 *
 * Nhánh `orders` bị invalidate mỗi lần tạo hay huỷ đơn. Nếu khoá thăm dò nằm
 * trong đó thì mỗi thao tác nhỏ sẽ khởi động lại vòng hỏi-lại cho những đơn
 * người dùng không hề mở — và tệ hơn, nó reset bộ đếm `refetchInterval` của
 * đúng màn hình đang chờ, khiến đơn vừa được trả tiền mất thêm ba giây mới hiện
 * ra. Tách nhánh thì hai việc không đụng nhau.
 *
 * KHÔNG gắn `tenantId` vào khoá: token chỉ mở một tổ chức, và `queryClient`
 * được `clear()` khi đổi tổ chức. KHÔNG gắn `workspaceId`: gói dịch vụ thuộc
 * TỔ CHỨC, không thuộc workspace.
 */
export const billingKeys = {
  all: ['billing'] as const,

  /** Bảng giá — gần như không đổi, nhưng vẫn theo khoá để dọn được khi cần. */
  plans: () => [...billingKeys.all, 'plans'] as const,
  paymentMethods: () => [...billingKeys.all, 'payment-methods'] as const,

  /** Gói hiện tại + mức sử dụng. Đổi sau mỗi lần thanh toán thành công. */
  summary: () => [...billingKeys.all, 'summary'] as const,
  subscriptions: () => [...billingKeys.all, 'subscriptions'] as const,

  orders: () => [...billingKeys.all, 'orders'] as const,
  orderList: (query: unknown) => [...billingKeys.orders(), 'list', query] as const,
  order: (code: string) => [...billingKeys.orders(), 'detail', code] as const,

  /** Nhánh RIÊNG — xem docblock ở trên. */
  orderStatus: (code: string) => ['billing-order-status', code] as const,
};
