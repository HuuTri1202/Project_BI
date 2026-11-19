import type { NumberFormat, SemanticType } from '@bi/shared';

import { khoaNhom } from './chatLuong';
import { parseNumber } from './inferType';

/**
 * Một ô CHUỖI thô trong file → giá trị đúng kiểu.
 *
 * ─── Vì sao file này tồn tại, thay vì để hàm nằm trong `commit.ts` ──────────
 *
 * Trước đây chỉ có MỘT nơi đọc file: `commit` chuyển mọi dòng thành document JSON
 * rồi ghi vào `dataset_rows`, và §9 nạp lại từ đó. Giờ §9 đọc THẲNG file, nên có
 * hai đường cùng biến một ô chuỗi thành một giá trị — và hai bản sao của luật
 * này lệch nhau là một lỗi không ai nhìn thấy.
 *
 * Nó suýt xảy ra thật, không phải giả định. `convert()` bên §9 đòi số ở dạng
 * thuần (`/^-?\d*\.?\d+/`), còn `parseNumber` ở đây hiểu `1.234,56` kiểu Việt
 * Nam, `1,234.56` kiểu Anh, dấu `%` và khoảng trắng. Chừng nào §9 còn đọc
 * `dataset_rows` thì khác biệt đó bị che, vì số đã được chuẩn hoá từ lúc nhập.
 * Đọc thẳng file mà không dùng chung hàm này thì mọi cột tiền định dạng theo
 * kiểu Việt Nam sẽ thành `NULL` kèm một dòng "Không đọc được thành số" — hồi quy
 * im lặng đúng ở dữ liệu của người dùng Việt.
 */

/**
 * Quy ước của CỘT, do §7 suy ra lúc chốt sheet và LƯU lại trên `dataset_columns`.
 *
 * Gom thành một object chứ không thêm tham số vị trí thứ tư: hai trường này đều
 * nullable, và `normalizeCell(x, 'text', null, map)` thì không ai đọc ra được
 * `null` kia là gì.
 */
export interface QuyUocCot {
  /** `null` = không đủ bằng chứng, và khi đó mỗi ô đọc đúng như luật cũ. */
  numberFormat?: NumberFormat | null | undefined;
  /** `null` = không gộp cách viết nào. Xem `chatLuong.banDoGop`. */
  valueMap?: Record<string, string> | null | undefined;
}

export function normalizeCell(
  raw: string,
  semanticType: SemanticType,
  quyUoc: QuyUocCot = {},
): unknown {
  const trimmed = raw.trim();
  // Ô trống lưu thành `null` chứ không phải chuỗi rỗng: `null` phân biệt được với
  // "giá trị là chuỗi rỗng", và cả `aggregate` lẫn ClickHouse đều bỏ qua nó đúng
  // cách.
  if (trimmed === '') return null;

  switch (semanticType) {
    case 'number':
      return parseNumber(trimmed, quyUoc.numberFormat ?? null);
    case 'boolean':
      return ['true', 'yes', 'có', 'x'].includes(trimmed.toLowerCase());
    case 'date':
      return trimmed;
    case 'text':
      return gopCachViet(trimmed, quyUoc.valueMap ?? null);
  }
}

/**
 * Đưa một ô chữ về cách viết ĐẠI DIỆN của nhóm nó thuộc về — vá A2.
 *
 * Ô không nằm trong nhóm nào thì giữ nguyên TỪNG KÝ TỰ, kể cả khoảng trắng kép:
 * bản đồ chỉ nói về những nhóm đã thật sự có hai cách viết trong tệp, và sửa
 * những ô khác là biến đổi dữ liệu mà người dùng không hề đồng ý.
 *
 * ⚠️ Khoá tra là `khoaNhom(ô)`, không phải chính ô đó. Nhờ vậy một cách viết
 * KHÔNG có trong mẫu 200 dòng (`MIỀN NAM` xuất hiện lần đầu ở dòng 5.000) vẫn
 * gộp đúng, miễn là nhóm của nó đã được thấy.
 */
function gopCachViet(trimmed: string, map: Record<string, string> | null): string {
  if (map === null) return trimmed;
  return map[khoaNhom(trimmed)] ?? trimmed;
}
