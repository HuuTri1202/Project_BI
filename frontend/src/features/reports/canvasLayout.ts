/**
 * Phép tính bố cục của khung — §10.10.
 *
 * File RIÊNG, không nằm cạnh `CanvasGrid`: quy tắc `react-refresh` yêu cầu một
 * module chỉ xuất component thì mới thay nóng được. Trộn hàm thuần vào đó làm
 * cả file mất hot-reload, và trong một trình dựng kéo thả thì mất hot-reload
 * nghĩa là mỗi lần sửa một dòng CSS là dựng lại cả khung từ đầu.
 */

/** Chỗ đứng của một ô, dịch từ đơn vị lưới sang CSS. */
export function cellStyle(box: {
  x: number;
  y: number;
  w: number;
  h: number;
}): React.CSSProperties {
  return {
    // Grid đếm đường kẻ từ 1, còn dữ liệu đếm ô từ 0.
    gridColumn: `${box.x + 1} / span ${box.w}`,
    gridRow: `${box.y + 1} / span ${box.h}`,
    // Bắt buộc, cùng lý do với `minmax(0, 1fr)` trong `CanvasGrid`: thiếu nó thì
    // nội dung rộng làm ô phình ra thay vì cuộn bên trong.
    minWidth: 0,
    minHeight: 0,
  };
}

/** Số hàng khung đang chiếm — để chừa chỗ cuộn vừa đủ, không dư một màn hình. */
export function rowsNeeded(boxes: readonly { y: number; h: number }[], floor = 8): number {
  return boxes.reduce((max, box) => Math.max(max, box.y + box.h), floor);
}
