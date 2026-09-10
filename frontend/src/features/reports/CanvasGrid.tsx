import { CANVAS_COLUMNS, CANVAS_ROW_HEIGHT } from '@bi/shared';

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
        gap: '12px',
        minHeight: `${minRows * CANVAS_ROW_HEIGHT}px`,
      }}
    >
      {children}
    </div>
  );
}

