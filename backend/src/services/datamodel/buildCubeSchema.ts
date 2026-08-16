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
 * Mọi chuỗi tới từ người dùng đều đi qua `JSON.stringify`, kể cả `title` — đó
 * cũng là chuỗi họ gõ vào.
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

/** Chuỗi JS chứa một định danh ClickHouse đã bọc. Hai lớp, xem docblock. */
function sqlIdent(name: string): string {
  return js(quoteIdent(name));
}

/**
 * Định danh ClickHouse để nhúng vào TEMPLATE LITERAL, không phải chuỗi thường.
 *
 * Chỉ `joins` cần thứ này, vì `${CUBE}` là cú pháp thật của Cube nên đoạn `sql`
 * của join BẮT BUỘC là template literal — không thay bằng `JSON.stringify` được.
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
    `      sql: ${sqlIdent(column.columnName)},`,
    `      type: ${js(column.cubeType)},`,
    `    },`,
  ].join('\n');
}

function measureBlock(measure: SchemaMeasure): string {
  const name = measureNameFor(measure.id);
  const lines = [`    ${name}: {`, `      title: ${js(measure.name)},`];

  // `count` là đếm DÒNG — không có cột nào để đo, và khai `sql` cho nó sẽ biến
  // phép đếm thành `count(cột)`, tức là bỏ qua dòng có ô trống. Hai con số khác
  // nhau, và người dùng chọn "Đếm dòng" thì họ muốn con số thứ nhất.
  if (measure.agg !== 'count' && measure.columnName !== null) {
    lines.push(`      sql: ${sqlIdent(measure.columnName)},`);
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
    `      sql: ${sqlIdent(ROW_INDEX_COLUMN)},`,
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
