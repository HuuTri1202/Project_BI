/**
 * Quy ước phân cách số mà NGƯỜI DÙNG tự chốt cho từng cột — mong muốn D2.
 *
 * File RIÊNG, không nằm trong `StepChooseData` hay `UploadWizard`: quy tắc
 * `react-refresh` chỉ thay nóng được một module khi module đó chỉ xuất
 * component. Trộn hai hàm thuần này vào đó làm cả wizard mất hot-reload — cùng
 * lý do `canvasLayout.ts` tách khỏi `CanvasGrid`.
 */

/**
 * Khoá của một cột: tên sheet + ordinal.
 *
 * Phải có TÊN SHEET vì mỗi sheet được tích sẽ thành một bộ dữ liệu riêng với
 * bảng cột riêng — `ordinal` một mình thì một ô tích ở sheet này đổi cách đọc
 * của sheet kia.
 */
export function khoaQuyUoc(sheet: string, ordinal: number): string {
  return sheet + ':' + String(ordinal);
}

/**
 * Tập khoá đang tích → payload của `commit`.
 *
 * Lọc theo những sheet ĐƯỢC TÍCH: người dùng có thể mở xem một sheet, tích một
 * ô ở đó, rồi bỏ tích chính sheet ấy. Gửi kèm thì backend nhận một quy ước cho
 * một bộ dữ liệu không được tạo ra.
 *
 * `lastIndexOf` chứ không `split(':')`: tên sheet hoàn toàn có thể chứa dấu hai
 * chấm ("Q1:2026" là một tên sheet hợp lệ trong Excel).
 */
export function quyUocDaChon(
  quyUocVn: ReadonlySet<string>,
  sheets: readonly string[],
): { sheet: string; ordinal: number; format: 'vn' }[] {
  return [...quyUocVn]
    .map((khoa) => {
      const i = khoa.lastIndexOf(':');
      return {
        sheet: khoa.slice(0, i),
        ordinal: Number(khoa.slice(i + 1)),
        format: 'vn' as const,
      };
    })
    .filter((q) => sheets.includes(q.sheet));
}

/**
 * Những cột nên TÍCH SẴN "dấu chấm là phân cách nghìn" — §B3.
 *
 * Backend gắn cờ `goiYVn` cho cột mà MỌI ô mơ hồ đều tròn nghìn (`.000`). Một
 * cột thập phân thật có phần lẻ biến thiên (`.765`, `.155`, `.402`), nên cột
 * tròn nghìn toàn bộ gần như chắc chắn là cột tiền viết theo lối Việt.
 *
 * Vì sao TÍCH SẴN chứ không đổi thẳng cách đọc ở backend: hai cột có thể cùng
 * hình dạng mà khác nghĩa — `29.000` (hai mươi chín nghìn) và `288.765` (hai
 * trăm tám tám phẩy bảy sáu lăm) đều là "ô mơ hồ". Tín hiệu `.000` đủ mạnh để
 * đặt sẵn câu trả lời, không đủ mạnh để trả lời thay. Người dùng vẫn nhìn thấy
 * cả hai cách đọc trong cùng một câu cảnh báo rồi bấm.
 */
export function quyUocGoiY(
  sheets: readonly {
    name: string;
    canhBao: readonly { columnIndex: number; loai: string; goiYVn?: boolean }[];
  }[],
): Set<string> {
  const ra = new Set<string>();
  for (const s of sheets) {
    for (const c of s.canhBao) {
      if (c.loai === 'so-mo-ho' && c.goiYVn === true) ra.add(khoaQuyUoc(s.name, c.columnIndex));
    }
  }
  return ra;
}
