import type { ColumnRole, CubeType, MeasureAgg } from '@bi/shared';

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
 * ─── Chỗ đoán sai còn lại, và cách xử lý ────────────────────────────────────
 *
 * Cột mã sản phẩm toàn chữ số mà tên không kết thúc bằng một từ định danh —
 * `Mã hàng` chẳng hạn, từ cuối là `hàng` — vẫn lọt vào thước đo.
 *
 * Sửa được ở tab Schemas, và việc sửa tay là CÁCH XỬ LÝ chính thức chứ không
 * phải cách chữa cháy cho một thuật toán đoán tồi — cùng lập luận đã ghi ở
 * `inferType.ts` của §7. Điều đó chỉ đúng chừng nào tỉ lệ đoán sai còn NHỎ;
 * lúc quá nửa số thước đo phải sửa tay thì nó không còn là mặc định nữa mà là
 * một danh sách việc, và đó chính là lý do có hai luật `UInt8` và nhóm thứ tự
 * ở trên.
 */
export function defaultRoleOf(columnName: string, chType: string): ColumnRole {
  if (columnName === ROW_INDEX_COLUMN) return 'hidden';
  if (cubeTypeOf(chType) !== 'number') return 'dimension';

  // `UInt8` -> chiều, không phải thước đo.
  //
  // Trong hệ này `UInt8` chỉ ra đời từ hai chỗ (xem `typeMap.ts`): `tinyint(1)`
  // — quy ước boolean của MySQL — và `tinyint unsigned`, một mã nhỏ 0…255.
  // Cộng cả hai đều vô nghĩa, chỉ vô nghĩa theo hai kiểu khác nhau.
  //
  // Đây không phải suy đoán. Đo trên tổ chức 4 trước bản này: `is_active`,
  // `has_options`, `is_best_seller`, `Returned` đều được gieo thành `sum` và
  // nằm lẫn trong bộ chọn cạnh `Doanh thu` — bảy trên mười bốn thước đo cột
  // sinh tự động là một phép cộng không trả lời câu hỏi nào.
  //
  // Chọn `dimension` chứ không phải `hidden`: "đơn đã trả hàng hay chưa" là một
  // tiêu chí NHÓM rất hay dùng. Ai thật sự muốn cộng thì đổi lại ở tab Schemas
  // — `cubeType` vẫn là `number` nên ô chọn phép gộp vẫn mời đủ sum/avg.
  if (unwrapChType(chType) === 'UInt8') return 'dimension';

  // Số nhưng là ĐỊNH DANH -> chiều, không phải thước đo. Xem `looksLikeIdentifier`.
  return looksLikeIdentifier(columnName) ? 'dimension' : 'measure';
}

/**
 * Từ cuối của tên cột nói rằng đây là một ĐỊNH DANH, không phải một lượng.
 *
 * ─── Vì sao cần, và bằng chứng ─────────────────────────────────────────────
 *
 * Luật "số → thước đo" đúng với `Sales`, `Profit`, `Quantity`. Nó sai với
 * `Row ID` và `Postal Code`, và sai theo kiểu tệ nhất: `sum(Row ID)` trên
 * `Global-Superstore` cho ra ~1,3 tỉ — một con số vô nghĩa nhưng trông y hệt
 * tiền, nằm ngay cạnh `sum(Sales)` trong cùng một danh sách chọn.
 *
 * ─── Vì sao xét TỪ CUỐI chứ không phải cả tên ──────────────────────────────
 *
 * `contains('code')` sẽ nuốt luôn những cột hợp lệ như `Discount Code Value`
 * hay `Số lượng mã hoá`. Từ cuối là nơi tiếng Anh lẫn tiếng Việt đều đặt danh
 * từ chính của cụm: `Postal Code`, `Customer ID`, `Mã hàng` thì từ cuối là
 * `hàng`… — nên với tiếng Việt luật này bắt được ít hơn, và đó là đánh đổi
 * đúng chiều: bỏ sót thì người dùng sửa một lần ở tab Schemas, bắt nhầm thì
 * một thước đo hợp lệ biến mất mà không ai để ý.
 *
 * Danh sách cố ý NGẮN. Mỗi từ thêm vào là một khả năng bắt nhầm.
 */
const IDENTIFIER_WORDS = new Set([
  'id', 'ids', 'code', 'key', 'no', 'num', 'zip', 'zipcode',
  // Nhóm THỨ TỰ, thêm sau khi thấy `sort_order` bị gieo thành `sum` trên dữ
  // liệu thật. Một số thứ tự cộng lại không ra gì cả — cùng loại vô nghĩa với
  // `sum(Row ID)` đã nói ở trên, chỉ khác cái tên.
  //
  // `order` là từ cân nhắc lâu nhất vì tiếng Anh dùng nó cho cả ĐƠN HÀNG. Nhưng
  // ngay cả khi cột tên đúng là "Order" thì `sum(Order)` cũng chưa bao giờ là
  // thứ ai muốn — số đơn thì đếm dòng, giá trị đơn thì nằm ở cột khác. Dạng số
  // nhiều `orders` KHÔNG có trong danh sách, nên `Total Orders` vẫn là thước đo.
  'order', 'ordinal', 'position', 'index', 'seq', 'stt',
]);

export function looksLikeIdentifier(columnName: string): boolean {
  const last = columnName.trim().toLowerCase().split(/[\s_\-.]+/).filter(Boolean).pop();
  return last !== undefined && IDENTIFIER_WORDS.has(last);
}

/**
 * Phép gộp MẶC ĐỊNH cho một cột số.
 *
 * Danh sách dưới đây trả lời đúng một câu: cột nào mà TRUNG BÌNH có nghĩa còn
 * TỔNG thì không. Mọi cột khác về `sum`.
 *
 * ─── Hai nhóm, hai lý do khác nhau ─────────────────────────────────────────
 *
 * **Tỉ lệ.** `Discount` của `Global-Superstore` nhận giá trị 0…0,85, và cộng
 * 51.290 giá trị đó lại cho ra một con số không trả lời câu hỏi nào.
 *
 * **Đơn giá.** Thêm sau khi thấy cột `price` của bảng sản phẩm bị gieo thành
 * `sum` trên dữ liệu thật. Cộng đơn giá của cả danh mục hàng ra một số vừa lớn
 * vừa vô nghĩa — nó phụ thuộc vào việc danh mục có bao nhiêu mặt hàng chứ không
 * phải hàng đắt hay rẻ. Thứ người ta muốn là giá trung bình.
 *
 * ⚠️ Chỉ bắt từ ĐƠN GIÁ, không bắt `amount` / `total` / `thành tiền`. Đó là
 * ranh giới quan trọng nhất của luật này: `total_amount` PHẢI là `sum`, và một
 * danh sách rộng tay hơn sẽ biến doanh thu thành doanh thu trung bình mỗi dòng
 * — sai theo kiểu vẫn nằm trong khoảng hợp lý, tức là không ai phát hiện.
 *
 * Cũng là ĐOÁN, và cũng sửa được ở tab Schemas — nhưng đoán đúng ngay từ đầu
 * tiết kiệm cho người dùng đúng cái lần họ chưa biết là mình cần sửa.
 */
const AVG_WORDS = new Set([
  // Tỉ lệ
  'discount', 'rate', 'ratio', 'percent', 'percentage', 'pct', 'margin', 'lệ', 'suất',
  // Đơn giá
  'price', 'giá', 'unitprice',
]);

export function defaultAggOf(columnName: string): MeasureAgg {
  const last = columnName.trim().toLowerCase().split(/[\s_\-.]+/).filter(Boolean).pop();
  return last !== undefined && AVG_WORDS.has(last) ? 'avg' : 'sum';
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
