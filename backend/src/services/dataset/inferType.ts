import type { SemanticType, FieldRole } from '@bi/shared';

/**
 * Đoán kiểu dữ liệu của một cột từ nội dung của nó.
 *
 * ─── Nguyên tắc: nghi ngờ thì trả `text` ────────────────────────────────────
 *
 * Đoán sai theo hướng `text` chỉ làm cột đó không cộng được, và người dùng sửa
 * lại ở bước 2 trong mười giây. Đoán sai theo hướng `number` thì dữ liệu bị BIẾN
 * ĐỔI: `'0123'` thành `123`, và mã bưu chính, mã sản phẩm, số điện thoại mất số
 * 0 đầu vĩnh viễn — không ai phát hiện cho tới khi đối chiếu với hệ thống khác.
 *
 * Vì thế mọi luật dưới đây đều nghiêng về phía an toàn, và bước 2 của wizard
 * luôn cho người dùng sửa tay kiểu của từng cột. Sửa tay là CÁCH XỬ LÝ chính
 * thức, không phải cách chữa cháy cho một thuật toán đoán tồi.
 */

/** Chuỗi rỗng và mấy cách viết "không có giá trị" hay gặp trong file thật. */
const BLANKS = new Set(['', '-', 'n/a', 'na', 'null', 'nil', '#n/a']);

export function isBlank(raw: string): boolean {
  return BLANKS.has(raw.trim().toLowerCase());
}

/**
 * Số.
 *
 * KHÔNG chấp nhận số 0 đứng đầu (`0123`, `007`): đó gần như luôn là mã định danh
 * chứ không phải lượng. `0` và `0.5` thì vẫn là số.
 *
 * Chấp nhận dấu phân cách hàng nghìn kiểu Việt Nam (`1.234.567`) và kiểu Anh Mỹ
 * (`1,234,567`), nhưng CHỈ khi các nhóm đúng ba chữ số — nếu không thì `1.5` sẽ
 * bị hiểu thành "1 nghìn 5". Cũng chấp nhận `%` và khoảng trắng ở hai đầu.
 */
const PLAIN_NUMBER = /^-?\d+(?:[.,]\d+)?$/;
const GROUPED_VN = /^-?\d{1,3}(?:\.\d{3})+(?:,\d+)?$/;
const GROUPED_EN = /^-?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/;

export function looksLikeNumber(raw: string): boolean {
  const s = raw.trim().replace(/\s/g, '').replace(/%$/, '');
  if (s === '') return false;

  // Số 0 đứng đầu -> mã định danh, không phải số. `0`, `0.5`, `-0.5` vẫn qua.
  const digits = s.replace(/^-/, '');
  if (digits.length > 1 && digits.startsWith('0') && !digits.startsWith('0.') && !digits.startsWith('0,')) {
    return false;
  }

  return PLAIN_NUMBER.test(s) || GROUPED_VN.test(s) || GROUPED_EN.test(s);
}

/**
 * Chuyển chuỗi thành số, hiểu cả hai quy ước phân cách.
 *
 * Trả `null` khi không phải số — nơi gọi quyết định làm gì, thay vì nhận `NaN`
 * rồi lặng lẽ đưa nó vào phép cộng và cho ra `NaN` ở tận biểu đồ.
 */
export function parseNumber(raw: string): number | null {
  const s = raw.trim().replace(/\s/g, '').replace(/%$/, '');
  if (s === '') return null;

  let normalized: string;
  if (GROUPED_VN.test(s)) {
    normalized = s.replace(/\./g, '').replace(',', '.');
  } else if (GROUPED_EN.test(s)) {
    normalized = s.replace(/,/g, '');
  } else {
    // `1,5` kiểu Việt Nam: dấu phẩy là dấu thập phân khi chỉ có một dấu và
    // không phải nhóm ba chữ số.
    normalized = s.replace(',', '.');
  }

  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

/**
 * Ngày.
 *
 * Chỉ nhận ba dạng rõ ràng. Cố ý KHÔNG đưa chuỗi vào `new Date()` để thử: hàm
 * đó nhận cả `'Kinh doanh'` ở một số môi trường, và nhận `'2024'` thành ngày
 * 1/1/2024 — biến một cột năm thành cột ngày.
 *
 * `DD/MM/YYYY` được hiểu theo quy ước Việt Nam. `03/04/2024` là 3 tháng 4, không
 * phải 4 tháng 3. Không có cách nào đoán đúng cả hai quy ước từ một chuỗi, nên
 * chọn quy ước của người dùng và ghi rõ ở đây.
 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?$/;
const VN_DATE = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/;

export function looksLikeDate(raw: string): boolean {
  const s = raw.trim();
  if (ISO_DATE.test(s)) return true;

  const m = VN_DATE.exec(s);
  if (!m) return false;
  const day = Number(m[1]);
  const month = Number(m[2]);
  return day >= 1 && day <= 31 && month >= 1 && month <= 12;
}

/**
 * Boolean.
 *
 * CHỈ nhận chữ, không nhận `0`/`1`. Một cột toàn 0 và 1 hầu như luôn là số
 * lượng, cờ đếm được, hoặc mã — và biến nó thành boolean là làm mất khả năng
 * cộng nó lại.
 */
const TRUTHY = new Set(['true', 'false', 'yes', 'no', 'có', 'không', 'x']);

export function looksLikeBoolean(raw: string): boolean {
  return TRUTHY.has(raw.trim().toLowerCase());
}

/**
 * Đoán kiểu cho cả một cột từ các giá trị mẫu.
 *
 * Bỏ qua ô trống, rồi đòi **mọi** ô còn lại cùng khớp một kiểu. Không dùng
 * "đa số thắng": một cột 99 số và 1 chữ mà bị gọi là số thì đúng ô chữ đó biến
 * mất khỏi biểu đồ — và đó luôn là ô đáng chú ý nhất (dòng "Tổng cộng", ô ghi
 * "chưa có số liệu").
 *
 * Cột rỗng hoàn toàn -> `text`. Không có gì để đoán, và `text` không làm hỏng gì.
 */
export function inferColumnType(values: readonly string[]): SemanticType {
  const filled = values.filter((v) => !isBlank(v));
  if (filled.length === 0) return 'text';

  if (filled.every(looksLikeBoolean)) return 'boolean';
  if (filled.every(looksLikeNumber)) return 'number';
  if (filled.every(looksLikeDate)) return 'date';
  return 'text';
}

/**
 * Vai trò mặc định của cột trong biểu đồ.
 *
 * Chỉ số mới đo được; mọi thứ khác dùng để nhóm. Người dùng đổi được ở bước 2 —
 * một cột năm sinh là số nhưng dùng để nhóm mới có nghĩa.
 */
export function defaultFieldRole(dataType: SemanticType): FieldRole {
  return dataType === 'number' ? 'measure' : 'dimension';
}

/**
 * Tên field mặc định, suy từ tên cột trong file.
 *
 * `SL_BAN` -> `SL BAN`, `doanh_thu` -> `Doanh thu`. Chỉ làm sạch mức tối thiểu:
 * đổi gạch dưới thành khoảng trắng và viết hoa chữ đầu. Cố "dịch" tên cột thông
 * minh hơn thế sẽ sai theo những cách khó đoán, mà người dùng có ô nhập để sửa
 * ngay bên cạnh.
 *
 * Cột không có tiêu đề -> `Cột 1`, `Cột 2`. Để trống thì bước 2 hiện một hàng ô
 * nhập không nhãn và không ai biết cột nào là cột nào.
 */
export function defaultFieldName(sourceName: string, columnIndex: number): string {
  const cleaned = sourceName.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (cleaned === '') return `Cột ${columnIndex + 1}`;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}
