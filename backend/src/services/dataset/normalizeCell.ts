import type { SemanticType } from '@bi/shared';

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
export function normalizeCell(raw: string, semanticType: SemanticType): unknown {
  const trimmed = raw.trim();
  // Ô trống lưu thành `null` chứ không phải chuỗi rỗng: `null` phân biệt được với
  // "giá trị là chuỗi rỗng", và cả `aggregate` lẫn ClickHouse đều bỏ qua nó đúng
  // cách.
  if (trimmed === '') return null;

  switch (semanticType) {
    case 'number':
      return parseNumber(trimmed);
    case 'boolean':
      return ['true', 'yes', 'có', 'x'].includes(trimmed.toLowerCase());
    case 'date':
    case 'text':
      return trimmed;
  }
}
