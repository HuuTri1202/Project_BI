import { describe, expect, it } from 'vitest';

import {
  buildCubeSchema,
  type SchemaColumn,
  type SchemaCube,
} from '../src/services/datamodel/buildCubeSchema';
import {
  cubeTypeOf,
  defaultRoleOf,
  isSystemColumn,
  unwrapChType,
} from '../src/services/datamodel/classifyColumn';
import {
  cubeFileNameFor,
  cubeNameFor,
  dimensionNameFor,
  measureNameFor,
} from '../src/services/datamodel/cubeName';

/**
 * Test đơn vị của tầng ngữ nghĩa (§10) — KHÔNG cần container nào đang chạy.
 *
 * Cả ba module dưới đây là hàm thuần, đúng khuôn `ingestTypeMap.test.ts`. Đó là
 * chủ ý: mọi luật khó của §10 nằm ở đây, nên chúng phải kiểm được mà không phụ
 * thuộc vào MySQL, ClickHouse hay Cube.
 */

describe('§10.2 bóc lớp bọc kiểu ClickHouse', () => {
  // §9 khai MỌI cột là Nullable, nên đây không phải trường hợp hiếm — nó là
  // trường hợp DUY NHẤT xảy ra trong thực tế.
  it('bóc Nullable', () => {
    expect(unwrapChType('Nullable(Float64)')).toBe('Float64');
    expect(unwrapChType("Nullable(DateTime64(3,'UTC'))")).toBe("DateTime64(3,'UTC')");
    expect(unwrapChType('Nullable(Decimal(18, 2))')).toBe('Decimal(18, 2)');
  });

  it('bóc LowCardinality, kể cả khi lồng trong Nullable', () => {
    expect(unwrapChType('LowCardinality(String)')).toBe('String');
    expect(unwrapChType('Nullable(LowCardinality(String))')).toBe('String');
  });

  it('kiểu trần thì giữ nguyên', () => {
    expect(unwrapChType('UInt64')).toBe('UInt64');
    expect(unwrapChType('String')).toBe('String');
  });
});

describe('§10.2 ánh xạ kiểu ClickHouse sang kiểu Cube', () => {
  it('mọi kiểu số đều là number, KỂ CẢ khi bọc Nullable', () => {
    // Đây là ca giữ cho lỗi một dòng không quay lại: so khớp trên chuỗi thô
    // bằng `startsWith('Float')` sẽ trượt hết vì thực tế luôn có `Nullable(`.
    for (const type of [
      'Nullable(UInt8)',
      'Nullable(Int64)',
      'Nullable(Float32)',
      'Nullable(Float64)',
      'Nullable(Decimal(18, 2))',
      'UInt64',
    ]) {
      expect(cubeTypeOf(type), type).toBe('number');
    }
  });

  it('ngày ra time chứ không ra number, dù tên kiểu có chữ số', () => {
    expect(cubeTypeOf('Nullable(Date32)')).toBe('time');
    expect(cubeTypeOf("Nullable(DateTime64(3,'UTC'))")).toBe('time');
    // `Date32` bắt đầu bằng `Date` — nếu thứ tự nhánh sai, `32` không đủ để đẩy
    // nó sang number, nhưng một bản viết ẩu dùng regex số sẽ bắt trúng.
    expect(cubeTypeOf('Date32')).toBe('time');
  });

  it('chuỗi và mọi thứ chưa biết đều ra string', () => {
    expect(cubeTypeOf('Nullable(String)')).toBe('string');
    expect(cubeTypeOf('Nullable(LowCardinality(String))')).toBe('string');
    expect(cubeTypeOf('UUID')).toBe('string');
    // Kiểu phức tạp KHÔNG được làm cột biến mất — nhóm theo nó vẫn hơn không có.
    expect(cubeTypeOf('Array(String)')).toBe('string');
  });
});

describe('§10.2 vai trò mặc định', () => {
  it('số thành thước đo, chữ và ngày thành chiều', () => {
    expect(defaultRoleOf('doanh_thu', 'Nullable(Float64)')).toBe('measure');
    expect(defaultRoleOf('khu_vuc', 'Nullable(String)')).toBe('dimension');
    expect(defaultRoleOf('ngay_dat', "Nullable(DateTime64(3,'UTC'))")).toBe('dimension');
  });

  it('_row_index là hidden, KHÔNG phải thước đo', () => {
    // Cột hệ thống §9 là UInt64, nên nó khớp luật "số → thước đo" một cách hoàn
    // hảo. Không chặn ở đây thì bộ chọn có một mục "tổng chỉ số dòng".
    expect(defaultRoleOf('_row_index', 'UInt64')).toBe('hidden');
    expect(isSystemColumn('_row_index')).toBe(true);
    expect(isSystemColumn('row_index')).toBe(false);
  });
});

describe('§10 định danh cube sinh từ số nguyên', () => {
  it('mang cả id mô hình lẫn id bộ dữ liệu', () => {
    // Chỉ lấy datasetId thì hai mô hình cùng dùng một bộ dữ liệu sẽ khai trùng
    // tên cube và cái sau đè cái trước.
    expect(cubeNameFor(12, 77)).toBe('dm12_ds77');
    expect(cubeNameFor(13, 77)).not.toBe(cubeNameFor(12, 77));
    expect(cubeFileNameFor(12)).toBe('dm12.js');
    expect(dimensionNameFor(341)).toBe('d341');
    expect(measureNameFor(58)).toBe('m58');
  });

  it('từ chối id không phải số nguyên dương', () => {
    // Cả lập luận an toàn đứng trên giả định "đây là số". Kiểm lại biến giả
    // định thành bảo đảm.
    expect(() => cubeNameFor(0, 1)).toThrow();
    expect(() => cubeNameFor(1, -3)).toThrow();
    expect(() => dimensionNameFor(1.5)).toThrow();
    expect(() => measureNameFor(Number.NaN)).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

function column(over: Partial<SchemaColumn> = {}): SchemaColumn {
  return {
    id: 1,
    columnName: 'khu_vuc',
    label: 'Khu vực',
    role: 'dimension',
    cubeType: 'string',
    ...over,
  };
}

function cube(over: Partial<SchemaCube> = {}): SchemaCube {
  return {
    dataModelId: 12,
    datasetId: 77,
    label: 'Đơn hàng',
    sqlTable: 'bi_analytics.raw_t1_d77',
    columns: [column()],
    measures: [{ id: 58, name: 'Tổng tiền', agg: 'sum', columnName: 'doanh_thu' }],
    joins: [],
    ...over,
  };
}

function build(over: Partial<SchemaCube> = {}): string {
  return buildCubeSchema({
    dataModelId: 12,
    dataModelName: 'Doanh thu 2026',
    tenantId: 1,
    cubes: [cube(over)],
    generatedAt: '2026-08-16T10:22:31.004Z',
  });
}

/**
 * File sinh ra có phải JavaScript hợp lệ không.
 *
 * `new Function` phân tích cú pháp mà KHÔNG chạy thân hàm — nên nếu có mã bị
 * chèn vào, ta phát hiện được nó phá vỡ cú pháp, còn nếu nó là mã hợp lệ thì
 * cũng không có gì bị thực thi trong lúc test.
 */
function parses(source: string): boolean {
  try {
    new Function('cube', source);
    return true;
  } catch {
    return false;
  }
}

describe('§10 bộ sinh cube schema — chống chèn mã', () => {
  it('file bình thường là JavaScript hợp lệ', () => {
    const out = build();
    expect(parses(out)).toBe(true);
    expect(out).toContain('cube(`dm12_ds77`');
    expect(out).toContain('sql_table: "bi_analytics.raw_t1_d77"');
  });

  // ĐÂY LÀ CA QUAN TRỌNG NHẤT CỦA CẢ MỤC 10.
  //
  // Tên cột do người dùng đặt trong Excel. File cube là mã JS mà Cube chạy. Nếu
  // tên cột đi thẳng vào một template literal thì một file .xlsx là một đường đi
  // tới thực thi mã trong container Cube.
  it('tên cột chứa backtick KHÔNG phá được template literal', () => {
    const evil = 'a`, x: process.exit(), y: `';
    const out = build({ columns: [column({ columnName: evil, label: evil })] });

    expect(parses(out), 'file sinh ra phải còn là JS hợp lệ').toBe(true);
    // Không có `process.exit` nào thoát ra thành mã thật.
    expect(out).not.toMatch(/^\s*x: process\.exit\(\)/m);
  });

  it('chịu được mọi ký tự hiểm trong tên cột và tên hiển thị', () => {
    for (const evil of [
      'a`b',
      'a"b',
      'a\\b',
      'a*/b',
      '${process.env}',
      "'; DROP TABLE users; --",
      'Doanh thu (đồng) 🇻🇳',
      'dòng\nmới',
    ]) {
      const out = build({
        columns: [column({ columnName: evil, label: evil })],
        measures: [{ id: 58, name: evil, agg: 'sum', columnName: evil }],
        label: evil,
      });
      expect(parses(out), `tên cột: ${JSON.stringify(evil)}`).toBe(true);
    }
  });

  it('xuống dòng trong tên không thoát khỏi chú thích', () => {
    // Một chú thích `//` cũng chèn được mã: xuống dòng kết thúc chú thích và
    // phần còn lại thành mã thật.
    const out = build({
      columns: [column({ columnName: 'ten\nprocess.exit()', label: 'x' })],
    });
    expect(parses(out)).toBe(true);
  });
});

describe('§10 bộ sinh cube schema — nội dung', () => {
  it('luôn có khoá chính ẩn _row_index', () => {
    // Không có nó, JOIN một-nhiều cộng trùng và tổng lớn hơn sự thật mà không
    // có lỗi nào. Spike F1.7 không bắt được vì bảng của nó có sẵn order_id.
    const out = build();
    expect(out).toContain('row_index: {');
    expect(out).toContain('primary_key: true');
    expect(out).toContain('public: false');
  });

  it('cột hidden KHÔNG đi vào file', () => {
    const out = build({
      columns: [
        column({ id: 1, columnName: 'khu_vuc' }),
        column({ id: 2, columnName: 'ghi_chu', role: 'hidden' }),
      ],
    });
    expect(out).toContain('d1: {');
    expect(out).not.toContain('d2: {');
  });

  it('thước đo count KHÔNG khai sql — đếm dòng chứ không đếm ô có giá trị', () => {
    const out = build({
      measures: [{ id: 60, name: 'Số đơn', agg: 'count', columnName: null }],
    });
    expect(out).toContain('m60: {');
    expect(out).toContain('type: "count"');
    // `count(cột)` bỏ qua dòng có ô trống — một con số khác hẳn.
    const block = out.slice(out.indexOf('m60: {'));
    expect(block.slice(0, block.indexOf('},'))).not.toContain('sql:');
  });

  it('join khai đúng một phía, dùng cú pháp ${CUBE} của Cube', () => {
    const out = build({
      joins: [
        {
          targetCube: 'dm12_ds78',
          relationship: 'many_to_one',
          ownColumn: 'khach_hang_id',
          targetColumn: 'id',
        },
      ],
    });
    expect(parses(out)).toBe(true);
    expect(out).toContain('dm12_ds78: {');
    expect(out).toContain('relationship: "many_to_one"');
    expect(out).toContain('${CUBE}.\\`khach_hang_id\\` = ${dm12_ds78}.\\`id\\`');
  });

  // Nhánh `join` là chỗ DUY NHẤT bắt buộc phải là template literal (vì `${CUBE}`
  // là cú pháp thật của Cube), nên nó không dùng được `JSON.stringify` như mọi
  // chỗ khác — và nó đã sai đúng như vậy ở bản đầu: `quoteIdent` bọc bằng
  // backtick, mà backtick kết thúc template literal.
  it('tên cột khoá nối chứa backtick KHÔNG phá được template literal', () => {
    const evil = 'id`, sql: `1=1';
    const out = build({
      joins: [
        {
          targetCube: 'dm12_ds78',
          relationship: 'many_to_one',
          ownColumn: evil,
          targetColumn: evil,
        },
      ],
    });
    expect(parses(out), 'file sinh ra phải còn là JS hợp lệ').toBe(true);
  });

  it('tên cột khoá nối chứa ${ KHÔNG thành phép nội suy', () => {
    // `${...}` trong template literal là MÃ được chạy, không phải văn bản.
    const out = build({
      joins: [
        {
          targetCube: 'dm12_ds78',
          relationship: 'many_to_one',
          ownColumn: '${process.env.CUBEJS_API_SECRET}',
          targetColumn: 'id',
        },
      ],
    });
    expect(parses(out)).toBe(true);
    expect(out).toContain('\\${process.env');
  });
});
