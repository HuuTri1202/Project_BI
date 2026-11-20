/**
 * Nhãn THỜI GIAN cho biểu đồ, bảng và tệp xuất ra.
 *
 * ═══ Vì sao tệp này tồn tại ════════════════════════════════════════════════
 *
 * Kho phân tích trả dấu thời gian ở dạng máy đọc: `2026-08-04T00:00:00.000`
 * (Cube) hoặc `2026-08-04 00:00:00.000` (ClickHouse `toString`). Trước bản này
 * chuỗi đó đi thẳng ra trục ngang của biểu đồ, ra tệp Excel, ra câu trả lời của
 * khung hỏi đáp và ra cả trang chia sẻ công khai — xoay dọc 90°, hai mươi cái
 * một hàng. Một nền tảng tiếng Việt mà trục ngày đọc là
 * `2026-08-04T00:00:00.000`.
 *
 * ═══ KHÔNG dùng `new Date()`, và đây là chỗ dễ "sửa" thành lỗi nhất ════════
 *
 * Cột ngày của kho là `DateTime64(3, 'UTC')`, và phần nạp ghi đúng NGÀY NGHIỆP
 * VỤ vào đó: ô `01/08/2026` thành `2026-08-01T00:00:00.000Z`. Dựng một `Date`
 * rồi đọc `getDate()` là đọc theo giờ MÁY CHỦ — trên máy Việt Nam (UTC+7) thì
 * `2026-08-01T00:00:00Z` ra ngày 1 (vì +7 vẫn trong ngày), nhưng trên một máy
 * chủ ở UTC-5 thì nó ra ngày 31/07. Cùng một dữ liệu, hai cái nhãn khác nhau,
 * tuỳ chỗ cắm máy.
 *
 * Cắt chuỗi thì không có múi giờ nào để sai: thứ hiện ra đúng bằng thứ đã ghi.
 *
 * Giờ CHỈ hiện khi khác 00:00 — cột ngày thuần và cột đã gom theo tháng đều
 * mang đuôi `00:00:00`, in nó ra là hai mươi lần " 00:00" trên một trục.
 */
const DANG = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/;

export function nhanThoiGian(tho: string): string {
  const m = DANG.exec(tho.trim());
  if (m === null) return tho;

  const [, nam, thang, ngay, gio, phut, giay] = m;
  const ngayThang = `${ngay ?? ''}/${thang ?? ''}/${nam ?? ''}`;
  if (gio === undefined) return ngayThang;
  if (gio === '00' && phut === '00' && (giay === undefined || giay === '00')) return ngayThang;
  return `${ngayThang} ${gio}:${phut ?? '00'}`;
}
