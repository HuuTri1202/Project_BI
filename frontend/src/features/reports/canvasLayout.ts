import { CANVAS_COLUMNS, CANVAS_ROW_HEIGHT } from '@bi/shared';

/**
 * Phép tính bố cục của khung — §10.10.
 *
 * File RIÊNG, không nằm cạnh `CanvasGrid`: quy tắc `react-refresh` yêu cầu một
 * module chỉ xuất component thì mới thay nóng được. Trộn hàm thuần vào đó làm
 * cả file mất hot-reload, và trong một trình dựng kéo thả thì mất hot-reload
 * nghĩa là mỗi lần sửa một dòng CSS là dựng lại cả khung từ đầu.
 */

/**
 * Khoảng hở giữa hai ô lưới, tính bằng pixel bố cục.
 *
 * Ở đây chứ không ở `CanvasGrid`: ba nơi phải dùng ĐÚNG con số này — chính cái
 * lưới, phép tính bước kéo (`gridPitch`), và công thức đặt chú thích tự do
 * (`annotationStyle`). Hai bản chép tay lệch nhau thì chú thích trôi dần khỏi
 * chỗ người dựng đặt nó, mỗi cột một chút.
 */
export const CANVAS_GAP = 12;

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

/**
 * Chỗ đứng của một CHÚ THÍCH — §10.24.
 *
 * ═══ Vì sao chú thích không phải là một ô lưới ══════════════════════════════
 *
 * Toạ độ của nó là số THỰC (xem `annotation.ts` bên `@bi/shared`), mà CSS Grid
 * chỉ đặt được phần tử vào đường kẻ nguyên. Nên chú thích rời khỏi luồng lưới
 * và tự định vị tuyệt đối — `CanvasGrid` khai `position: relative` để nó có
 * gốc toạ độ.
 *
 * Công thức phải cho ra ĐÚNG chỗ mà lưới sẽ đặt, để một chú thích toạ độ nguyên
 * không nhúc nhích một pixel nào so với trước §10.24:
 *
 *   bước cột = (100% - gap × 11) / 12 + gap
 *   trái     = bước cột × x            (x = 0 -> 0)
 *   rộng     = bước cột × w - gap      (w = 12 -> đúng 100%)
 *
 * Chiều dọc đơn giản hơn vì hàng cao cố định: bước hàng = CANVAS_ROW_HEIGHT + gap.
 */
export function annotationStyle(box: {
  x: number;
  y: number;
  w: number;
  h: number;
}): React.CSSProperties {
  // Bề rộng MỘT cột, viết bằng `calc` để nó còn co theo khung chứa — thay bằng
  // một con số pixel đo lúc render là chú thích đứng yên khi cửa sổ đổi cỡ.
  const cot = `((100% - ${CANVAS_GAP * (CANVAS_COLUMNS - 1)}px) / ${CANVAS_COLUMNS})`;
  const buocHang = CANVAS_ROW_HEIGHT + CANVAS_GAP;

  return {
    position: 'absolute',
    left: `calc(${cot} * ${box.x} + ${CANVAS_GAP * box.x}px)`,
    width: `calc(${cot} * ${box.w} + ${CANVAS_GAP * (box.w - 1)}px)`,
    top: `${box.y * buocHang}px`,
    height: `${box.h * buocHang - CANVAS_GAP}px`,
  };
}

/**
 * Số hàng khung đang chiếm — để chừa chỗ cuộn vừa đủ, không dư một màn hình.
 *
 * `Math.ceil` vì chú thích mang toạ độ thực: một mũi tên kết thúc ở hàng 8.3
 * cần đủ 9 hàng, không phải 8 — thiếu nửa hàng cuối là mất nửa cái mũi tên.
 */
export function rowsNeeded(boxes: readonly { y: number; h: number }[], floor = 8): number {
  return Math.ceil(boxes.reduce((max, box) => Math.max(max, box.y + box.h), floor));
}
