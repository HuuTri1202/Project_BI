/**
 * Quy ước số và ngày tiếng Việt cho MỌI biểu đồ — §10, và vá A5.
 *
 * ⚠️ Lỗi đã đo trên hệ thống đang chạy: trên cùng một trang báo cáo, trục biểu
 * đồ ghi `16,000,000` còn khung hỏi đáp ngay cạnh ghi `15.980.000`. Người đọc
 * phải tự đoán dấu phẩy ở bên trái nghĩa là gì — và với người Việt, `16,000`
 * đọc ra là mười sáu phẩy không.
 *
 * Toàn bộ phần còn lại của ứng dụng đã dùng `toLocaleString('vi-VN')` từ đầu.
 * Chỉ Vega là ngoại lệ, vì nó KHÔNG đi qua `Intl`: nó dùng d3-format với locale
 * riêng, mà mặc định của d3 là en-US. Nên đây là chỗ duy nhất phải nói, và nói
 * một lần — `VegaChart` là cửa duy nhất mọi biểu đồ đi qua.
 *
 * Hai hằng dưới đây là định nghĩa locale của d3-format và d3-time-format, đúng
 * hình dạng mà `vegaEmbed` nhận ở hai tuỳ chọn `formatLocale` /
 * `timeFormatLocale`.
 *
 * ─── Vì sao đóng cứng tiếng Việt, không cho cấu hình theo tổ chức ───────────
 *
 * Đó là mong muốn D8 trong báo cáo QA, và nó vẫn đúng — nhưng một bảng cấu hình
 * cho một giá trị mà mọi tổ chức trong hệ thống đều chọn giống nhau là phần
 * mềm phải bảo trì mà không ai dùng. Khi nào có tổ chức đầu tiên cần khác, thay
 * hai hằng này bằng một tham số của `VegaChart` là đủ: nơi dùng đã chỉ có một.
 */

/** d3-format: dấu thập phân là phẩy, phân nhóm nghìn là chấm. */
export const DINH_DANG_SO_VIET = {
  decimal: ',',
  thousands: '.',
  grouping: [3],
  currency: ['', ' ₫'],
  // d3-format v2 mặc định dùng dấu trừ Unicode (U+2212). Nó rộng hơn và không
  // chọn được bằng bàn phím khi người dùng tìm trong ảnh xuất ra.
  minus: '-',
} as const;

/** d3-time-format: `dd/mm/yyyy`, và tên tháng/thứ bằng tiếng Việt. */
export const DINH_DANG_NGAY_VIET = {
  dateTime: '%A, %d %B %Y %X',
  date: '%d/%m/%Y',
  time: '%H:%M:%S',
  periods: ['SA', 'CH'],
  days: ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'],
  shortDays: ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'],
  months: [
    'Tháng 1',
    'Tháng 2',
    'Tháng 3',
    'Tháng 4',
    'Tháng 5',
    'Tháng 6',
    'Tháng 7',
    'Tháng 8',
    'Tháng 9',
    'Tháng 10',
    'Tháng 11',
    'Tháng 12',
  ],
  shortMonths: [
    'Th1',
    'Th2',
    'Th3',
    'Th4',
    'Th5',
    'Th6',
    'Th7',
    'Th8',
    'Th9',
    'Th10',
    'Th11',
    'Th12',
  ],
} as const;
