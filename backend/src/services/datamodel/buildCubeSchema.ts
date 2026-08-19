import type { CubeType, RelationshipKind } from '@bi/shared';

import { quoteIdent } from '../ingest/typeMap';
import { ROW_INDEX_COLUMN } from '../ingest/buildDdl';
import {
  cubeNameFor,
  dimensionNameFor,
  measureNameFor,
  PRIMARY_KEY_DIMENSION,
} from './cubeName';

/**
 * Dựng nội dung file cube schema — §10, HÀM THUẦN.
 *
 * Không đọc database, không chạm đĩa, không gọi mạng. Vào là một mô tả mô hình,
 * ra là một chuỗi. Nhờ vậy nó test được đầy đủ mà không cần Cube, ClickHouse hay
 * MySQL đang chạy — và phần khó nhất của §10 nằm ở đúng file này.
 *
 * ═══ CẠM BẪY LỚN NHẤT CỦA CẢ MỤC 10 ═══════════════════════════════════════
 *
 * Thứ hàm này sinh ra là MÃ JAVASCRIPT mà Cube `require()` rồi CHẠY. Cú pháp
 * của Cube dùng template literal:
 *
 *     total: { sql: `amount`, type: `sum` }
 *
 * Nếu nội suy thẳng tên cột vào đó, một cột tên
 *
 *     a`, x: process.exit(), y: `
 *
 * sẽ đóng template literal sớm và chèn mã tuỳ ý vào một file sắp được thực thi.
 * Tên cột do người dùng đặt trong file Excel, nên đây là đường đi hoàn chỉnh từ
 * một file `.xlsx` tới thực thi mã trong container Cube.
 *
 * ─── Hai lớp escape, phải làm CẢ HAI ────────────────────────────────────────
 *
 *     sql: ${JSON.stringify(quoteIdent(name))}
 *          └─ tầng JS: sinh một string literal hợp lệ, escape mọi ký tự
 *                      └─ tầng SQL: bọc định danh theo luật của ClickHouse
 *
 * Chúng giải hai bài toán KHÁC NHAU và không thay thế cho nhau:
 *
 *   - `quoteIdent` (xem `typeMap.ts`) bọc cho ClickHouse, escape bằng DẤU CHÉO
 *     NGƯỢC chứ không nhân đôi backtick như MySQL. Thiếu nó thì một tên cột có
 *     khoảng trắng hoặc dấu tiếng Việt làm hỏng câu SQL.
 *   - `JSON.stringify` sinh string literal JS. Thiếu nó thì backtick mà
 *     `quoteIdent` vừa thêm vào sẽ KẾT THÚC template literal — nghĩa là lớp bảo
 *     vệ SQL lại chính là thứ mở cửa cho lớp JS.
 *
 * ⚠️ TUYỆT ĐỐI KHÔNG viết `` sql: `${quoteIdent(name)}` ``. Nó trông có vẻ đúng
 * và nó chạy được với mọi tên cột bình thường — chỉ hỏng với đúng những tên
 * hiếm, tức là hỏng ở máy khách hàng chứ không ở máy ta.
 *
 * ═══ VÌ SAO MỌI CỘT PHẢI MANG `${CUBE}.` ═════════════════════════════════════
 *
 * Bản trước phát ra định danh TRẦN: `sql: "\`Diem trung binh\`"`. Chạy đúng với
 * mọi truy vấn một bảng, nên nó sống sót qua toàn bộ test lẫn kiểm tay.
 *
 * Nó hỏng ở chỗ khác: khi truy vấn chạm HAI bảng, Cube dựng một truy vấn con
 * gom khoá để tránh nhân bản dòng, và trong đó định danh trần trở nên mơ hồ —
 * `_row_index` có mặt trong MỌI bảng `raw_*`. ClickHouse không báo lỗi, nó chọn
 * bảng đầu tiên. Câu lệnh Cube sinh ra trên dữ liệu thật:
 *
 *     SELECT DISTINCT `Ho ten`, `_row_index`        -- của bảng nào?
 *     FROM raw_t4_d70 LEFT JOIN raw_t4_d74 ON ...   -- cả hai đều có cột này
 *
 * rồi nối tiếp `keys._row_index = raw_t4_d74._row_index` — tức là ghép học sinh
 * thứ k với dòng điểm thứ k. Nối theo SỐ THỨ TỰ DÒNG. Kết quả là một bảng điểm
 * trung bình trông hoàn toàn hợp lý và sai hoàn toàn.
 *
 * `${CUBE}` là cú pháp thật của Cube nên đoạn `sql` BẮT BUỘC là template
 * literal. Điều đó kéo cạm bẫy ở trên vào mọi chiều và mọi thước đo, không chỉ
 * `joins` như trước — nên chúng đi qua `sqlIdentInTemplate`, và các bài test
 * "tên cột chứa backtick / ${" là thứ giữ cho nó không tái diễn.
 *
 * ─── Chuỗi nào đi đường nào ─────────────────────────────────────────────────
 *
 *   `title`, `type`, `sql_table`…   -> `js()`         (string literal JS)
 *   `sql` có nhắc tên cột           -> template literal + `sqlIdentInTemplate`
 *
 * Không có đường thứ ba. `js()` không dùng được ở nhóm sau vì `${CUBE}` bên
 * trong một string literal chỉ là bảy ký tự văn bản, không phải phép nội suy.
 */

export interface SchemaColumn {
  id: number;
  columnName: string;
  /** Tên hiển thị đã giải sẵn (`alias ?? columnName`). */
  label: string;
  role: 'dimension' | 'measure' | 'hidden';
  cubeType: CubeType;
}

export interface SchemaMeasure {
  id: number;
  name: string;
  agg: 'sum' | 'avg' | 'count' | 'min' | 'max';
  /** `null` khi và chỉ khi `agg === 'count'`. */
  columnName: string | null;
  /**
   * Thước đo TÍNH TOÁN — ghép hai thước đo khác của CÙNG cube.
   *
   * `null` = thước đo thường (gộp một cột). Hai vế là id, không phải chuỗi —
   * xem ghi chú ở migration 13 về việc không nhận công thức dạng văn bản.
   */
  formula: { op: 'add' | 'sub' | 'mul' | 'div'; leftId: number; rightId: number } | null;
}

export interface SchemaJoin {
  /** Tên cube phía bên kia. */
  targetCube: string;
  relationship: RelationshipKind;
  ownColumn: string;
  targetColumn: string;
}

export interface SchemaCube {
  dataModelId: number;
  datasetId: number;
  /** Tên hiển thị của bảng. */
  label: string;
  /** `bi_analytics.raw_t1_d77` — đã dựng sẵn bởi `qualified(...)`. */
  sqlTable: string;
  columns: SchemaColumn[];
  measures: SchemaMeasure[];
  joins: SchemaJoin[];
}

export interface BuildSchemaInput {
  dataModelId: number;
  dataModelName: string;
  tenantId: number;
  cubes: SchemaCube[];
  /** Truyền vào chứ không gọi `new Date()`: hàm phải thuần để test được. */
  generatedAt: string;
}

/** Chuỗi JS an toàn. Dùng cho MỌI giá trị, không có ngoại lệ. */
function js(value: string): string {
  return JSON.stringify(value);
}

/**
 * Định danh ClickHouse để nhúng vào TEMPLATE LITERAL, không phải chuỗi thường.
 *
 * Mọi đoạn `sql` nhắc tới một cột đều cần thứ này — chiều, thước đo, khoá chính
 * lẫn `joins` — vì tất cả đều phải mang `${CUBE}.`, mà `${CUBE}` là cú pháp thật
 * của Cube nên đoạn `sql` BẮT BUỘC là template literal, không thay bằng
 * `JSON.stringify` được.
 *
 * Và đó chính là chỗ cạm bẫy ở đầu file cắn lần thứ hai: `quoteIdent` bọc định
 * danh bằng BACKTICK, mà backtick lại là ký tự kết thúc template literal. Nhúng
 * thẳng vào là lớp bảo vệ SQL tự tay mở cửa cho lớp JS — đúng lỗi mà một bài
 * test trong `datamodelSchema.test.ts` tồn tại để bắt.
 *
 * Thứ tự thay thế QUAN TRỌNG: dấu chéo ngược trước, nếu không thì dấu chéo ta
 * vừa thêm vào sẽ bị escape lần nữa. Cùng bẫy với `quoteIdent` trong `typeMap.ts`.
 */
function sqlIdentInTemplate(name: string): string {
  return quoteIdent(name)
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${');
}

/**
 * Một cột, ĐÃ gắn cube sở hữu nó — ra `${CUBE}.` kèm định danh đã bọc.
 *
 * Trả về CẢ hai dấu backtick bao ngoài, nên nơi gọi viết thẳng
 * `sql: ${cubeColumn(name)},` mà không tự ghép chuỗi. Ghép tay là chỗ dễ bỏ
 * sót đúng một lớp escape, và lớp bị sót sẽ không lộ ra với tên cột bình
 * thường — chỉ lộ ở máy khách hàng.
 *
 * Vì sao bắt buộc có `${CUBE}.`: xem docblock đầu file. Định danh trần trở
 * nên mơ hồ trong truy vấn nhiều bảng, và ClickHouse lặng lẽ chọn bảng đầu.
 */
function cubeColumn(name: string): string {
  return '`${CUBE}.' + sqlIdentInTemplate(name) + '`';
}

/**
 * Chú thích an toàn.
 *
 * Một chú thích `//` cũng chèn được mã: tên cột chứa xuống dòng sẽ kết thúc chú
 * thích và phần còn lại thành mã thật. Thay mọi ký tự xuống dòng và cắt ngắn.
 */
function comment(text: string): string {
  return text.replace(/[\r\n]+/g, ' ').slice(0, 120);
}

function dimensionBlock(column: SchemaColumn): string {
  const name = dimensionNameFor(column.id);
  return [
    `    // ${comment(column.columnName)}`,
    `    ${name}: {`,
    `      title: ${js(column.label)},`,
    `      sql: ${cubeColumn(column.columnName)},`,
    `      type: ${js(column.cubeType)},`,
    `    },`,
  ].join('\n');
}

/**
 * Toán tử SQL cho từng phép. Bảng tra CỐ ĐỊNH, không ghép chuỗi từ đầu vào.
 *
 * Đây là chỗ duy nhất một "phép" biến thành ký tự trong câu lệnh, và nó chỉ
 * nhận được bốn giá trị của `MeasureOp` — kiểu chặn ở biên dịch, bảng tra chặn
 * lúc chạy.
 */
const OP_SQL: Record<'add' | 'sub' | 'mul' | 'div', string> = {
  add: '+',
  sub: '-',
  mul: '*',
  div: '/',
};

function measureBlock(measure: SchemaMeasure): string {
  const name = measureNameFor(measure.id);
  const lines = [`    ${name}: {`, `      title: ${js(measure.name)},`];

  if (measure.formula !== null) {
    const left = measureNameFor(measure.formula.leftId);
    const right = measureNameFor(measure.formula.rightId);
    const op = OP_SQL[measure.formula.op];

    /*
     * Chia thì bọc mẫu số trong `nullIf(x, 0)`.
     *
     * ClickHouse KHÔNG ném lỗi khi chia cho 0 — `1/0` cho `inf`, `0/0` cho
     * `nan`, và cả hai đi qua JSON rồi hiện ra ô kết quả dưới dạng `Infinity`
     * hoặc `NaN`. `nullIf` biến mẫu số 0 thành NULL, và NULL lan ra cả biểu
     * thức, nên ô đó hiện dấu gạch — thứ người đọc hiểu ngay là "không tính
     * được", chứ không phải một từ tiếng Anh lạ giữa bảng số liệu.
     */
    const denominator = measure.formula.op === 'div' ? `nullIf(\${${right}}, 0)` : `\${${right}}`;
    lines.push(
      `      sql: \`\${${left}} ${op} ${denominator}\`,`,
      // `number` chứ không phải một phép gộp: hai vế ĐÃ gộp rồi, nên Cube chỉ
      // còn việc tính biểu thức trên kết quả gộp. Khai `sum` ở đây sẽ thành
      // gộp hai lần.
      `      type: "number",`,
      `    },`,
    );
    return lines.join('\n');
  }

  // `count` là đếm DÒNG — không có cột nào để đo, và khai `sql` cho nó sẽ biến
  // phép đếm thành `count(cột)`, tức là bỏ qua dòng có ô trống. Hai con số khác
  // nhau, và người dùng chọn "Số dòng" thì họ muốn con số thứ nhất. Trên chính
  // bảng Orders trong máy: 51.290 dòng, nhưng `count(Postal Code)` ra 9.994.
  //
  // ⚠️ Cube KHÔNG sinh `count(*)` cho `type: "count"` — nó nở ra
  // `count(<primary_key>)`, ở đây là `count(\`_row_index\`)`. Con số vẫn đúng,
  // nhưng CHỈ VÌ `_row_index` khai `UInt64` chứ không phải `Nullable(UInt64)`
  // (xem `buildDdl`). Nếu khoá chính ẩn có ngày nào thành nullable thì mọi phép
  // đếm âm thầm hụt đi đúng số dòng thiếu khoá — không lỗi, không cảnh báo.
  if (measure.agg !== 'count' && measure.columnName !== null) {
    lines.push(`      sql: ${cubeColumn(measure.columnName)},`);
  }

  lines.push(`      type: ${js(measure.agg)},`, `    },`);
  return lines.join('\n');
}

/**
 * Khoá chính ẩn.
 *
 * Cube ĐÒI một chiều `primary_key` ở phía được nối tới để đếm đúng qua JOIN.
 * Bảng `raw_*` không có khoá tự nhiên nào — nó có thể đến từ một view — nên
 * `_row_index` mà §9 cố ý thêm vào chính là thứ đóng vai đó.
 *
 * Không có nó, một dòng bên "một" nối tới N dòng bên "nhiều" bị cộng N lần, và
 * tổng lớn hơn sự thật MÀ KHÔNG CÓ LỖI NÀO. Spike F1.7 không phát hiện được
 * chuyện này vì bảng của nó đã có sẵn `order_id` và không JOIN với ai.
 *
 * `public: false` giữ nó khỏi mọi bộ chọn của người dùng.
 */
function primaryKeyBlock(): string {
  return [
    `    // Khoá chính hệ thống (§9). Cube cần nó để JOIN đếm đúng; ẩn khỏi bộ chọn.`,
    `    ${PRIMARY_KEY_DIMENSION}: {`,
    `      sql: ${cubeColumn(ROW_INDEX_COLUMN)},`,
    `      type: ${js('number')},`,
    `      primary_key: true,`,
    `      public: false,`,
    `    },`,
  ].join('\n');
}

/**
 * `joins` của một cube.
 *
 * Khai ở MỘT phía duy nhất. Đồ thị join của Cube là có hướng và nó tự đi ngược
 * được; khai cả hai chiều tạo ra hai đường nối giữa cùng hai bảng, và Cube từ
 * chối với "multiple join paths" — một thông báo xuất hiện lúc TRUY VẤN, cách
 * xa chỗ người dùng đã tạo ra sai sót.
 */
function joinsBlock(joins: readonly SchemaJoin[]): string {
  if (joins.length === 0) return '';

  const entries = joins.map((join) =>
    [
      `    ${join.targetCube}: {`,
      `      relationship: ${js(join.relationship)},`,
      // `${CUBE}` và tên cube đích là CÚ PHÁP CỦA CUBE, không phải chuỗi — nên
      // đoạn này bắt buộc là template literal. Tên cột phải đi qua
      // `sqlIdentInTemplate`, KHÔNG phải `quoteIdent` trần: backtick mà
      // `quoteIdent` thêm vào sẽ kết thúc template literal sớm.
      '      sql: `${CUBE}.' +
        sqlIdentInTemplate(join.ownColumn) +
        ' = ${' +
        join.targetCube +
        '}.' +
        sqlIdentInTemplate(join.targetColumn) +
        '`,',
      `    },`,
    ].join('\n'),
  );

  return ['  joins: {', entries.join('\n'), '  },', ''].join('\n');
}

function cubeBlock(cube: SchemaCube): string {
  const name = cubeNameFor(cube.dataModelId, cube.datasetId);

  // Cột `hidden` KHÔNG đi vào file: người dùng đã nói họ không muốn nó, và giữ
  // lại chỉ để ẩn đi là mời một truy vấn thủ công tìm ra nó.
  const dimensions = cube.columns.filter((c) => c.role === 'dimension');

  const body = [
    `cube(\`${name}\`, {`,
    `  title: ${js(cube.label)},`,
    `  sql_table: ${js(cube.sqlTable)},`,
    '',
    joinsBlock(cube.joins),
    '  dimensions: {',
    [primaryKeyBlock(), ...dimensions.map(dimensionBlock)].join('\n'),
    '  },',
    '',
    '  measures: {',
    cube.measures.map(measureBlock).join('\n'),
    '  },',
    '});',
  ];

  return body.filter((line) => line !== '').join('\n');
}

export function buildCubeSchema(input: BuildSchemaInput): string {
  const header = [
    '// SINH TỰ ĐỘNG bởi Express (§10, ADR-08). ĐỪNG SỬA TAY —',
    '// mọi thay đổi sẽ bị ghi đè ở lần lưu mô hình tiếp theo.',
    `// mô hình #${input.dataModelId} ${comment(input.dataModelName)}`,
    `// tổ chức ${input.tenantId} · sinh lúc ${input.generatedAt}`,
    '',
  ].join('\n');

  return `${header}${input.cubes.map(cubeBlock).join('\n\n')}\n`;
}
