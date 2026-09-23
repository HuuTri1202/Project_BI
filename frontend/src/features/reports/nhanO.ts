import type { ReportDataDto } from '@bi/shared';

/**
 * Tiêu đề TỰ SINH của một ô biểu đồ chưa được đặt tên.
 *
 * Một hàm, một câu — vì câu này hiện ở BỐN chỗ và bốn chỗ đó phải giống hệt
 * nhau: trên đầu ô ở trang xem (`CanvasView`), trong hộp chọn trước khi xuất
 * (`chonO`), làm tên sheet Excel (`excelBaoCao`), và trên dải tiêu đề ảnh. Lệch
 * một chữ là người dùng nhìn hộp chọn rồi không biết nó đang nói tới ô nào trên
 * màn hình — đúng lỗi đã đo được lần đầu: thẻ ghi "Doanh thu v3 theo Nhóm
 * hàng", hộp chọn ghi "Biểu đồ 3".
 *
 * Nhãn đọc được chỉ có trong SỐ LIỆU chứ không có trong cấu hình (cấu hình chỉ
 * mang ID), nên chỗ nào chưa có số liệu thì chưa gọi được hàm này.
 */
export function tieuDeTuSoLieu(data: ReportDataDto): string {
  return `${data.measureLabel} theo ${data.dimensionLabel}`;
}
