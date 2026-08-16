import type { ColumnRole, CubeType } from '@bi/shared';

import { ROW_INDEX_COLUMN } from '../ingest/buildDdl';

/**
 * Phân loại cột ClickHouse thành ngữ nghĩa của mô hình — §10.2, TOÀN BỘ hàm thuần.
 *
 * Không import database, không import client, không đọc `env` — đúng khuôn
 * `services/ingest/typeMap.ts`, và vì cùng một lý do: đây là nơi mọi luật khó
 * nằm, và cũng là nơi duy nhất của §10 test được đầy đủ mà không cần một
 * container nào đang chạy.
 *
 * ─── Vì sao phải BÓC `Nullable(...)` trước khi so khớp ──────────────────────
 *
 * §9 khai MỌI cột là `Nullable`, kể cả cột nguồn NOT NULL, để một ô không ép
 * được kiểu không giết cả lô INSERT (xem `typeMap.ts`). Nên chuỗi thật sự đọc
 * được từ `system.columns` là `Nullable(Float64)`, không phải `Float64`.
 *
 * Viết `type.startsWith('Float')` sẽ TRƯỢT HẾT, và trượt trong im lặng: mọi cột
 * số bị xếp thành chiều, không cột nào cộng được, và không có lỗi nào ở đâu cả.
 * Đây là lỗi một dòng với triệu chứng rất khó lần ngược.
 *
 * `LowCardinality(...)` cũng phải bóc — driver §8 sinh nó cho cột chuỗi lặp
 * nhiều, và nó bọc được lồng nhau với `Nullable`.
 */

/**
 * Bóc mọi lớp bọc để lấy kiểu GỐC.
 *
 * Lồng nhau tới hai lớp là chuyện thường: `Nullable(LowCardinality(String))`.
 * Lặp cho tới khi không bóc được nữa thay vì bóc đúng một lần.
 */
const WRAPPERS = ['Nullable', 'LowCardinality'] as const;

export function unwrapChType(chType: string): string {
  let current = chType.trim();

  for (let guard = 0; guard < 4; guard += 1) {
    const wrapper = WRAPPERS.find((w) => current.startsWith(`${w}(`) && current.endsWith(')'));
    if (wrapper === undefined) return current;
    current = current.slice(wrapper.length + 1, -1).trim();
  }

  return current;
}

/**
 * Kiểu theo cách CUBE hiểu.
 *
 * ⚠️ TRỰC GIAO với vai trò (`ColumnRole`). Một cột `Float64` chứa mã sản phẩm có
 * thể mang `role: 'dimension'` mà `cubeType: 'number'` — "dùng để nhóm" và
 * "chứa chữ số" là hai câu khác nhau, và trộn chúng lại là lỗi sẽ xảy ra trong
 * vòng một tuần nếu không giữ hai tên tách bạch.
 */
export function cubeTypeOf(chType: string): CubeType {
  const base = unwrapChType(chType);

  // Ngày trước số: `Date32` bắt đầu bằng `Date`, và `DateTime64(3,'UTC')` cũng
  // vậy — nhưng cả hai đều KHÔNG được rơi vào nhánh số dù có chữ số trong tên.
  if (base.startsWith('Date')) return 'time';
  if (base === 'Bool' || base === 'Boolean') return 'boolean';
  if (/^(UInt|Int|Float|Decimal)/.test(base)) return 'number';

  // String, FixedString, UUID, Enum8/16, IPv4/6, Array, Tuple, Map… đều về
  // `string`. Cube không có kiểu cho những thứ phức tạp, và trả `string` thì
  // người dùng vẫn nhóm được theo nó thay vì cột biến mất khỏi mô hình.
  return 'string';
}

/**
 * Vai trò MẶC ĐỊNH của cột trong mô hình — §10.2.
 *
 * Luật của đề bài: `UInt/Int/Float → Measure`, `String/Date → Dimension`.
 *
 * ─── `_row_index` phải là `hidden`, không phải `measure` ────────────────────
 *
 * §9 thêm cột hệ thống `_row_index UInt64` vào cuối MỌI bảng `raw_*`. Nó khớp
 * luật "số → thước đo" một cách hoàn hảo, và nếu không chặn ở đây thì bộ chọn
 * của người dùng sẽ có một mục "tổng chỉ số dòng" — một con số không có nghĩa
 * gì với ai.
 *
 * `hidden` chứ không phải loại bỏ hẳn: cột này VẪN đi vào file cube làm khoá
 * chính, vì Cube cần khoá chính để JOIN `one_to_many` đếm đúng. Bỏ hẳn thì mỗi
 * dòng bên "một" nối tới N dòng bên "nhiều" sẽ được cộng N lần, và tổng lớn hơn
 * sự thật mà không có lỗi nào.
 *
 * ─── Hai chỗ đoán sai đã biết, và cách xử lý ────────────────────────────────
 *
 *   - Cột boolean của §7 nạp thành `UInt8`, nên bị xếp vào thước đo.
 *   - Cột mã sản phẩm toàn chữ số cũng vậy.
 *
 * Cả hai đều sửa được ở tab Schemas, và việc sửa tay là CÁCH XỬ LÝ chính thức
 * chứ không phải cách chữa cháy cho một thuật toán đoán tồi — cùng lập luận đã
 * ghi ở `inferType.ts` của §7.
 */
export function defaultRoleOf(columnName: string, chType: string): ColumnRole {
  if (columnName === ROW_INDEX_COLUMN) return 'hidden';
  return cubeTypeOf(chType) === 'number' ? 'measure' : 'dimension';
}

/**
 * Cột này có phải cột hệ thống không.
 *
 * Tách thành hàm riêng thay vì so chuỗi rải rác: có ba nơi cần câu trả lời (bộ
 * phân loại, bộ sinh schema, bộ chọn của Explorer) và ba nơi so chuỗi tay là ba
 * cơ hội để lệch nhau.
 */
export function isSystemColumn(columnName: string): boolean {
  return columnName === ROW_INDEX_COLUMN;
}
