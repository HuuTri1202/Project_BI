import { describe, expect, it } from 'vitest';

import {
  buildCreateTable,
  buildIngestColumns,
  chTableName,
  insertColumnList,
} from '../src/services/ingest/buildDdl';
import {
  chTypeFromMysql,
  chTypeFromSemantic,
  quoteIdent,
  toClickHouseDateTime,
} from '../src/services/ingest/typeMap';

/**
 * Test ĐƠN VỊ cho phần thuần của §9 — không cần MySQL, không cần ClickHouse.
 *
 * Đây là nơi mọi luật khó của mục 9 nằm (ánh xạ kiểu, escape định danh, parse
 * ngày), và cũng là phần duy nhất chắc chắn được chạy trong `npm run verify`.
 * Nhánh chạm ClickHouse thật nằm ở `ingest.integration.test.ts` và bị cổng bởi
 * một biến môi trường.
 */

describe('chTypeFromSemantic — nguồn file', () => {
  it('ánh xạ đủ bốn kiểu ngữ nghĩa, tất cả đều Nullable', () => {
    expect(chTypeFromSemantic('text')).toBe('Nullable(String)');
    expect(chTypeFromSemantic('number')).toBe('Nullable(Float64)');
    expect(chTypeFromSemantic('boolean')).toBe('Nullable(UInt8)');
    expect(chTypeFromSemantic('date')).toBe("Nullable(DateTime64(3,'UTC'))");
  });

  it('cột chưa suy được kiểu thì về String, không phải lỗi', () => {
    expect(chTypeFromSemantic(null)).toBe('Nullable(String)');
  });
});

describe('chTypeFromMysql — nguồn connection', () => {
  it('phân biệt tinyint(1) boolean với tinyint số', () => {
    expect(chTypeFromMysql('tinyint(1)')).toBe('Nullable(UInt8)');
    expect(chTypeFromMysql('tinyint(4)')).toBe('Nullable(Int8)');
  });

  it('giữ unsigned — bigint unsigned vào Int64 là TRÀN SỐ ở id lớn', () => {
    expect(chTypeFromMysql('bigint')).toBe('Nullable(Int64)');
    expect(chTypeFromMysql('bigint(20) unsigned')).toBe('Nullable(UInt64)');
    expect(chTypeFromMysql('int unsigned')).toBe('Nullable(UInt32)');
  });

  it('đọc đúng độ chính xác của decimal', () => {
    expect(chTypeFromMysql('decimal(18,4)')).toBe('Nullable(Decimal(18, 4))');
    expect(chTypeFromMysql('decimal(10, 2)')).toBe('Nullable(Decimal(10, 2))');
  });

  it('kẹp p về 38 — MySQL cho tới 65 chữ số, ClickHouse tối đa 38', () => {
    expect(chTypeFromMysql('decimal(65,10)')).toBe('Nullable(Decimal(38, 10))');
  });

  it('decimal TRẦN về String chứ không đoán (p,s) — đoán là làm tròn tiền', () => {
    expect(chTypeFromMysql('decimal')).toBe('Nullable(String)');
  });

  it('DATE là ngày trên lịch nên dùng Date32, không phải DateTime64', () => {
    expect(chTypeFromMysql('date')).toBe('Nullable(Date32)');
    expect(chTypeFromMysql('datetime')).toBe("Nullable(DateTime64(3,'UTC'))");
    expect(chTypeFromMysql('timestamp')).toBe("Nullable(DateTime64(3,'UTC'))");
  });

  it('kiểu chuỗi và enum về String', () => {
    expect(chTypeFromMysql('varchar(255)')).toBe('Nullable(String)');
    expect(chTypeFromMysql("enum('a','b')")).toBe('Nullable(String)');
    expect(chTypeFromMysql('longtext')).toBe('Nullable(String)');
    expect(chTypeFromMysql('json')).toBe('Nullable(String)');
  });

  it('kiểu KHÔNG nhận ra về String, không làm hỏng cả lần nạp', () => {
    expect(chTypeFromMysql('point')).toBe('Nullable(String)');
    expect(chTypeFromMysql('mot_kieu_la_hoac')).toBe('Nullable(String)');
  });
});

describe('quoteIdent', () => {
  it('giữ nguyên tên có dấu và khoảng trắng', () => {
    expect(quoteIdent('Doanh thu')).toBe('`Doanh thu`');
    expect(quoteIdent('Ngày bán')).toBe('`Ngày bán`');
  });

  it('escape bằng BACKSLASH, không nhân đôi backtick', () => {
    // Đã kiểm bằng CREATE TABLE thật trên ClickHouse 25.8 rồi đọc lại
    // system.columns. Nhân đôi backtick (quy ước của MySQL) cho ra lỗi cú pháp.
    expect(quoteIdent('a`b')).toBe('`a\\`b`');
    expect(quoteIdent('c\\d')).toBe('`c\\\\d`');
  });

  it('escape dấu chéo TRƯỚC backtick — ngược lại thì escape chồng lên nhau', () => {
    expect(quoteIdent('x\\`y')).toBe('`x\\\\\\`y`');
  });

  it('một tên độc hại không thoát ra khỏi cặp backtick', () => {
    expect(quoteIdent('x` DROP TABLE t; --')).toBe('`x\\` DROP TABLE t; --`');
  });
});

describe('toClickHouseDateTime', () => {
  it('đọc ISO, giữ nguyên chữ số — không qua new Date() nên không lệch múi giờ', () => {
    expect(toClickHouseDateTime('2026-12-31')).toBe('2026-12-31 00:00:00.000');
    expect(toClickHouseDateTime('2026-12-31T09:15')).toBe('2026-12-31 09:15:00.000');
    expect(toClickHouseDateTime('2026-07-01 16:15:00')).toBe('2026-07-01 16:15:00.000');
  });

  it('đọc ngày kiểu Việt Nam: 31/12/2026 là 31 tháng 12', () => {
    expect(toClickHouseDateTime('31/12/2026')).toBe('2026-12-31 00:00:00.000');
    expect(toClickHouseDateTime('5-3-2026')).toBe('2026-03-05 00:00:00.000');
  });

  it('từ chối ngày không tồn tại — regex một mình không bắt được', () => {
    expect(toClickHouseDateTime('31/02/2026')).toBeNull();
    expect(toClickHouseDateTime('2026-02-30')).toBeNull();
  });

  it('trả null cho chuỗi không phải ngày — cột "date" vẫn có thể lẫn chữ', () => {
    // `inferColumnType` chỉ lấy mẫu 200 dòng đầu, nên dòng 5.000 hoàn toàn có
    // thể là 'chưa xác định'. Nơi gọi ghi một dòng lỗi rồi đi tiếp.
    expect(toClickHouseDateTime('chưa xác định')).toBeNull();
    expect(toClickHouseDateTime('')).toBeNull();
    expect(toClickHouseDateTime('2026')).toBeNull();
  });
});

describe('chTableName', () => {
  it('sinh tên hoàn toàn từ hai số nguyên', () => {
    expect(chTableName(2, 21)).toBe('raw_t2_d21');
  });

  it('từ chối id không phải số nguyên dương — cả lập luận an toàn đứng trên đó', () => {
    expect(() => chTableName(0, 1)).toThrow();
    expect(() => chTableName(1, -3)).toThrow();
    expect(() => chTableName(Number.NaN, 1)).toThrow();
  });
});

describe('buildIngestColumns + buildCreateTable', () => {
  const columns = [
    col({ name: 'Ngay ban', fieldName: 'Ngày bán', ordinal: 1, semanticType: 'date' }),
    col({ name: 'Doanh thu', fieldName: 'Doanh thu', ordinal: 2, semanticType: 'number' }),
    col({ name: 'Bo qua', fieldName: 'Bỏ qua', ordinal: 3, included: false }),
    col({ name: 'Khu vuc', fieldName: 'Khu vực', ordinal: 0, semanticType: 'text' }),
  ];

  it('chỉ lấy cột included, sắp theo ordinal, khoá tra là fieldName', () => {
    const built = buildIngestColumns('file', columns);
    expect(built.map((c) => c.key)).toEqual(['Khu vực', 'Ngày bán', 'Doanh thu']);
  });

  it('dựng DDL với _row_index ở CUỐI và ORDER BY chính nó', () => {
    const sql = buildCreateTable('bi_analytics', 'raw_t2_d21', buildIngestColumns('file', columns));

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS `bi_analytics`.`raw_t2_d21`');
    expect(sql).toContain("`Ngày bán` Nullable(DateTime64(3,'UTC'))");
    expect(sql).toContain('`Doanh thu` Nullable(Float64)');
    expect(sql).not.toContain('Bỏ qua');
    expect(sql).toContain('ENGINE = MergeTree() ORDER BY `_row_index`');
    // Cột hệ thống đứng cuối để DESCRIBE cho người dùng thấy cột của họ trước.
    expect(sql.indexOf('_row_index')).toBeGreaterThan(sql.indexOf('Doanh thu'));
  });

  it('không có cột nào được nhập -> ném lỗi thay vì sinh DDL hỏng', () => {
    expect(() => buildCreateTable('bi_analytics', 'raw_t1_d1', [])).toThrow();
  });

  it('danh sách cột của INSERT đã bọc sẵn — client KHÔNG escape hộ', () => {
    const list = insertColumnList(buildIngestColumns('file', columns));
    expect(list).toEqual(['`Khu vực`', '`Ngày bán`', '`Doanh thu`', '`_row_index`']);
  });

  it('nguồn connection đọc kiểu từ dataType chứ không phải semanticType', () => {
    const built = buildIngestColumns('connection', [
      col({ name: 'so_luong', fieldName: null, ordinal: 0, dataType: 'bigint unsigned' }),
    ]);
    expect(built[0]?.key).toBe('so_luong');
    expect(built[0]?.chType).toBe('Nullable(UInt64)');
  });
});

function col(input: {
  name: string;
  fieldName?: string | null;
  ordinal: number;
  dataType?: string;
  semanticType?: 'text' | 'number' | 'date' | 'boolean' | null;
  included?: boolean;
}): {
  name: string;
  fieldName: string | null;
  ordinal: number;
  dataType: string;
  semanticType: 'text' | 'number' | 'date' | 'boolean' | null;
  fieldRole: null;
  isNullable: boolean;
  included: boolean;
} {
  return {
    name: input.name,
    fieldName: input.fieldName ?? null,
    ordinal: input.ordinal,
    dataType: input.dataType ?? 'text',
    semanticType: input.semanticType ?? null,
    fieldRole: null,
    isNullable: true,
    included: input.included ?? true,
  };
}
