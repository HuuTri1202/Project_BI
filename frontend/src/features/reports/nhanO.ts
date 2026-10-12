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

/**
 * Con số của một thước đo, đọc theo cách thước đo được khai.
 *
 * `'percent'` nhân 100 khi HIỂN THỊ, không đụng tới dữ liệu — cùng lập luận với
 * trục của biểu đồ.
 *
 * ─── Vì sao nó ở đây chứ không nằm trong `ReportChart` ─────────────────────
 *
 * Vì nó có người đọc thứ hai: khung hỏi đáp cũng in ra con số, và phải in ra
 * GIỐNG HỆT. Lệch nhau là bot nói "0.283" trong khi bảng số liệu ngay dưới nói
 * "28,3 %" — hai câu trả lời cho cùng một câu hỏi, trên cùng một màn hình.
 *
 * Và vì chỗ cũ bắt bộ test của lõi hỏi đáp kéo theo cả Vega chỉ để định dạng
 * một con số. File này không import gì ngoài một `type`.
 */
export function formatValue(value: number, format: ReportDataDto['format']): string {
  if (format === 'percent') {
    return `${(value * 100).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} %`;
  }
  return value.toLocaleString('vi-VN');
}
