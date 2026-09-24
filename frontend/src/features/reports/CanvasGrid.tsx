import { CANVAS_COLUMNS, CANVAS_ROW_HEIGHT } from '@bi/shared';

import { CANVAS_GAP } from './canvasLayout';

/**
 * Lưới của khung — §10.10. Dùng CHUNG giữa trình dựng và trang xem.
 *
 * ═══ Vì sao một file, không phải hai ════════════════════════════════════════
 *
 * Trình dựng và trang xem phải đặt các ô vào ĐÚNG cùng một chỗ. Hai bản cài đặt
 * riêng là hẹn trước ngày "dựng xong trông một kiểu, mở ra trông một kiểu khác"
 * — mà lệch bố cục thì không có lỗi nào báo, người dùng chỉ thấy nó xấu đi.
 *
 * ═══ CSS Grid chứ không phải position: absolute ═════════════════════════════
 *
 * Bề rộng một cột KHÔNG cố định: `repeat(12, minmax(0, 1fr))` để lưới co theo
 * khung chứa. Nhờ vậy cùng một bố cục đọc được trên màn 27 inch lẫn laptop 13
 * inch mà không phải tính lại gì.
 *
 * `minmax(0, 1fr)` chứ không `1fr`: mặc định của grid là `min-width: auto`, tức
 * là một ô sẽ TỪ CHỐI hẹp hơn nội dung bên trong. Một bảng số liệu rộng trong
 * một ô 3 cột sẽ tự bung cả lưới ra và đẩy mọi ô khác lệch chỗ. `minmax(0, …)`
 * là thứ cho phép ô hẹp lại và để nội dung tự cuộn.
 *
 * Các ô ĐƯỢC PHÉP đè lên nhau (xem `ReportCanvasDto`), và grid xử lý chuyện đó
 * sẵn — hai ô cùng vùng thì xếp chồng theo thứ tự trong DOM.
 *
 * ═══ `position: relative` là gốc toạ độ của CHÚ THÍCH — §10.24 ══════════════
 *
 * Chú thích mang toạ độ thực nên không đặt vào đường kẻ lưới được; nó tự định
 * vị tuyệt đối bên trong lưới này (xem `annotationStyle`). `relative` không dời
 * lưới đi đâu và không tạo tầng xếp chồng mới (`z-index: auto`), nên ba tầng vẽ
 * của `CANVAS_LAYER_Z` vẫn nguyên.
 */

export function CanvasGrid({
  /** Số hàng tối thiểu — để khung trống vẫn có chiều cao mà thả ô vào. */
  minRows,
  children,
  className,
}: {
  minRows: number;
  children: React.ReactNode;
  className?: string | undefined;
}): React.ReactElement {
  return (
    <div
      className={className}
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${CANVAS_COLUMNS}, minmax(0, 1fr))`,
        gridAutoRows: `${CANVAS_ROW_HEIGHT}px`,
        gap: `${CANVAS_GAP}px`,
        position: 'relative',
        /*
         * Chiều cao của `minRows` hàng CÓ KHOẢNG HỞ, không phải chỉ tổng chiều
         * cao hàng.
         *
         * Trước §10.24 chú thích là ô lưới nên chính nó kéo dài lưới ra. Giờ nó
         * định vị tuyệt đối và không tạo hàng nào, nên sàn này là thứ duy nhất
         * chừa chỗ cho một mũi tên nằm dưới ô biểu đồ thấp nhất. Thiếu khoảng hở
         * thì mỗi hàng hụt 12px, và tới hàng thứ mười là hụt hơn hai hàng.
         */
        minHeight: `${minRows * (CANVAS_ROW_HEIGHT + CANVAS_GAP) - CANVAS_GAP}px`,
      }}
    >
      {children}
    </div>
  );
}
