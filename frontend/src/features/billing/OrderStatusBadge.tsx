import { ORDER_STATUS_LABELS, type OrderStatus } from '@bi/shared';

import { Badge } from '../../components/ui/Badge';

/**
 * Nhãn trạng thái đơn — §11.
 *
 * File riêng thay vì để trong trang: nó dùng ở cả bảng đơn hàng lẫn màn chi
 * tiết, và một component xuất chung file với một trang sẽ làm hỏng hot reload
 * (eslint `react-refresh/only-export-components` cảnh báo đúng chuyện đó).
 *
 * ⚠️ LUÔN có chữ, không bao giờ chỉ có màu — cùng luật đã ghi trong docblock
 * của `Badge`. Người phân biệt màu kém, người in ra giấy đen trắng, và người
 * dùng chế độ tương phản cao đều phải đọc được trạng thái.
 *
 * Nhãn tiếng Việt lấy từ `@bi/shared`, cùng nguồn với backend — hai bản chép
 * tay sẽ lệch nhau ngay lần thêm trạng thái đầu tiên.
 */

const TONES: Record<OrderStatus, 'neutral' | 'brand' | 'success' | 'warning' | 'danger'> = {
  /** Đang chờ tiền — việc chưa xong, nhưng chưa hỏng. */
  pending: 'warning',
  /** Khách đã báo chuyển, đang chờ người vận hành đối chiếu. */
  awaiting_confirmation: 'brand',
  paid: 'success',
  /** Cổng thanh toán TỪ CHỐI. Khác `cancelled`, và màu phải nói ra điều đó. */
  failed: 'danger',
  expired: 'neutral',
  refunded: 'neutral',
  /** Khách tự đổi ý — không phải lỗi của ai, nên không tô đỏ. */
  cancelled: 'neutral',
};

export function OrderStatusBadge({ status }: { status: OrderStatus }): React.ReactElement {
  return <Badge tone={TONES[status]}>{ORDER_STATUS_LABELS[status]}</Badge>;
}
