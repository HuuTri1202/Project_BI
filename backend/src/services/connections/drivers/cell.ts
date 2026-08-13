import type { PreviewCell } from './types';

/**
 * Ép một giá trị bất kỳ từ CSDL nguồn về dạng gửi được qua JSON.
 *
 * Hai driver dùng chung hàm này, và đó là chủ đích: nếu mỗi bên tự chuyển đổi
 * thì cùng một cột `datetime` sẽ hiện khác nhau tuỳ CSDL, mà người dùng thì
 * không có lý do gì để biết sự khác biệt đó tồn tại.
 *
 * ─── Vì sao KHÔNG trả thẳng giá trị gốc ─────────────────────────────────────
 *
 * `JSON.stringify` không xử lý được vài thứ mà CSDL trả về hằng ngày:
 *
 *   - `BigInt` làm nó NÉM LỖI, không phải trả về null. Một cột `BIGINT` vượt
 *     `Number.MAX_SAFE_INTEGER` sẽ làm hỏng cả response.
 *   - `Buffer` thành `{"type":"Buffer","data":[137,80,...]}` — một cột ảnh biến
 *     thành vài trăm nghìn con số đi qua mạng.
 *   - `Date` thành chuỗi ISO kèm 'Z', tức là đổi múi giờ so với thứ đang nằm
 *     trong CSDL.
 */

/**
 * Độ dài tối đa của một ô.
 *
 * Không có ngưỡng này thì một cột `TEXT` chứa bài viết dài nhân 100 dòng là vài
 * megabyte kéo qua mạng cho một bảng xem trước mà mỗi ô chỉ hiện được vài chục
 * ký tự đầu. Cắt ở backend chứ không ở giao diện: cắt ở giao diện thì dữ liệu
 * vẫn đã đi hết quãng đường đắt nhất rồi.
 */
const MAX_CELL_CHARS = 300;

export function toCell(value: unknown): PreviewCell {
  if (value === null || value === undefined) return null;

  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') return clip(value);

  if (value instanceof Date) {
    // Không `toISOString()`: nó quy về UTC, nên một mốc lưu trong CSDL là
    // 13:17 sẽ hiện thành 06:17 và người dùng tưởng dữ liệu sai.
    return Number.isNaN(value.getTime()) ? null : clip(value.toLocaleString('sv-SE'));
  }

  // Buffer và mọi TypedArray: nói ra KÍCH THƯỚC thay vì đổ byte. Người xem trước
  // dữ liệu cần biết "ô này có nội dung nhị phân", không cần chính nội dung đó.
  if (ArrayBuffer.isView(value)) return `⟨nhị phân, ${value.byteLength} byte⟩`;

  // Cột JSON, mảng, hoặc kiểu riêng của ClickHouse (Tuple, Map, Array…).
  try {
    return clip(JSON.stringify(value) ?? String(value));
  } catch {
    return clip(String(value));
  }
}

function clip(text: string): string {
  return text.length > MAX_CELL_CHARS ? `${text.slice(0, MAX_CELL_CHARS)}…` : text;
}
