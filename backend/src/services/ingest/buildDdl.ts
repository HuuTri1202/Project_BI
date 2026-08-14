import type { DatasetColumnDto, DatasetSource, SemanticType } from '@bi/shared';
import { chTypeFromMysql, chTypeFromSemantic, quoteIdent } from './typeMap';

/**
 * Sinh câu `CREATE TABLE` cho một bộ dữ liệu (§9.3) — hàm thuần, như `typeMap`.
 *
 * ─── Quy ước tên bảng, và vì sao nó là chuyện AN TOÀN chứ không phải thẩm mỹ ─
 *
 *     bi_analytics.raw_t{tenantId}_d{datasetId}          bảng đang phục vụ
 *     bi_analytics.raw_t{tenantId}_d{datasetId}__new     bảng tạm khi nạp lại
 *
 * Tên sinh HOÀN TOÀN từ hai số nguyên do hệ thống cấp. Không một ký tự nào do
 * người dùng đặt lọt vào câu DDL. Lý do — bốn cái, thường người ta chỉ nghĩ tới
 * cái đầu:
 *
 *   1. Định danh KHÔNG tham số hoá được trong `CREATE TABLE`. ClickHouse có
 *      `{x:Identifier}` cho truy vấn, nhưng phần khai cột thì bắt buộc nối
 *      chuỗi — đúng tình huống mà `drivers/mysql.ts` đã viết cả một đoạn cảnh
 *      báo. Một dataset tên ``x` DROP TABLE …`` là đủ.
 *   2. Đổi tên là MẤT BẢNG. `datasets.name` sửa được ở §8.9. Tên bảng suy từ nó
 *      thì sau khi đổi tên, bảng cũ thành mồ côi và không code nào tìm lại được.
 *      `tenant_id`/`dataset_id` là AUTO_INCREMENT — bất biến, không API nào sửa.
 *   3. Va chạm. Hai bộ dữ liệu cùng tên "Doanh thu" ở hai workspace là chuyện
 *      thường; cặp số nguyên thì không bao giờ đụng.
 *   4. Ký tự. Tên sheet Excel thật có dấu tiếng Việt, khoảng trắng, emoji.
 *      Slugify là một hàm CÓ THỂ SAI; hai số nguyên thì không.
 *
 * Đổi lại: `raw_t2_d21` không đọc được bằng mắt. Chấp nhận — tra một dòng trong
 * `datasets` là ra, còn một lỗ hổng DDL thì không tra lại được.
 *
 * Tiền tố `raw_` khớp `infrastructure/dbt/dbt_project.yml`, nơi các view staging
 * được dựng trên `raw_*`.
 */

/** Cột hệ thống, thêm vào cuối mọi bảng. Xem ghi chú ở `buildCreateTable`. */
export const ROW_INDEX_COLUMN = '_row_index';

export function chTableName(tenantId: number, datasetId: number): string {
  assertPositiveInt(tenantId, 'tenantId');
  assertPositiveInt(datasetId, 'datasetId');
  return `raw_t${tenantId}_d${datasetId}`;
}

/**
 * Chặn ngay tại nguồn nếu id không phải số nguyên dương.
 *
 * Cả lập luận an toàn ở trên đứng trên đúng một giả định: hai tham số này là SỐ.
 * Kiểm lại ở đây là rẻ, và nó biến một giả định thành một bảo đảm — kể cả khi có
 * người sau này gọi hàm với một giá trị đọc từ chỗ khác.
 */
function assertPositiveInt(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} phải là số nguyên dương, nhận được: ${String(value)}`);
  }
}

/** Tên bảng đầy đủ, đã bọc định danh, sẵn sàng ghép vào SQL. */
export function qualified(database: string, table: string): string {
  return `${quoteIdent(database)}.${quoteIdent(table)}`;
}

/**
 * Những cột thật sự được nạp: chỉ `included`, sắp theo `ordinal`.
 *
 * Khoá dùng để tra giá trị là `fieldName ?? name` — GIỐNG HỆT khoá mà
 * `commit.ts:buildRows` dùng khi ghi document JSON, và giống `previewDataset`.
 * Ba chỗ này phải nói cùng một ngôn ngữ; lệch một chỗ là nạp lên một bảng toàn
 * `NULL` mà không có lỗi nào.
 */
export interface IngestColumn {
  /** Khoá tra trong document JSON (nguồn `file`) / tên cột nguồn (nguồn `connection`). */
  key: string;
  /** Tên cột trong ClickHouse. Giữ NGUYÊN tên người dùng thấy, đã bọc khi vào SQL. */
  name: string;
  /** Kiểu ClickHouse đầy đủ, ví dụ `Nullable(DateTime64(3,'UTC'))`. */
  chType: string;
  /**
   * Vị trí cột trong FILE gốc — chỉ có nghĩa với nguồn `file`.
   *
   * Khác `key`: `key` là tên hiển thị (`field_name`), thứ đã được làm sạch và có
   * thể được đánh số thêm khi trùng. Đọc thẳng file thì không có tên nào để tra —
   * chỉ có vị trí cột. Giữ cả hai vì hai đường đọc dùng hai thứ khác nhau.
   */
  sourceOrdinal: number;
  /** Kiểu suy ra ở §7. `null` với nguồn `connection`. */
  semanticType: SemanticType | null;
  /** Cần parse lại chuỗi thành mốc thời gian trước khi gửi đi. */
  isDateTime: boolean;
  isNumber: boolean;
  isBoolean: boolean;
}

export function buildIngestColumns(
  source: DatasetSource,
  columns: readonly DatasetColumnDto[],
): IngestColumn[] {
  return columns
    .filter((c) => c.included)
    .slice()
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((c) => {
      const key = c.fieldName ?? c.name;
      const chType =
        source === 'file' ? chTypeFromSemantic(c.semanticType) : chTypeFromMysql(c.dataType);
      return {
        key,
        name: key,
        chType,
        sourceOrdinal: c.ordinal,
        semanticType: c.semanticType,
        isDateTime: chType.includes('DateTime64'),
        isNumber: /Float|Int|Decimal/.test(chType),
        isBoolean: source === 'file' && c.semanticType === 'boolean',
      };
    });
}

/**
 * `CREATE TABLE … ENGINE = MergeTree() ORDER BY _row_index`.
 *
 * ─── Vì sao có `_row_index`, và vì sao nó làm khoá sắp xếp ──────────────────
 *
 * `MergeTree` bắt buộc phải có `ORDER BY`. Một bộ dữ liệu tuỳ ý thì KHÔNG có
 * khoá tự nhiên nào — nó có thể là một view không khoá chính. `ORDER BY tuple()`
 * (nghĩa là "không sắp xếp") cũng hợp lệ, nhưng bỏ mất một thứ đáng giá: khả
 * năng đối chiếu một dòng trong kho với đúng dòng nguồn khi đi tìm lỗi ở §9.8.
 *
 * Chi phí gần bằng không vì dữ liệu được ghi theo đúng thứ tự tăng dần của
 * `_row_index` — ClickHouse không phải sắp xếp lại gì cả.
 *
 * Cột hệ thống đứng CUỐI để `DESCRIBE TABLE` cho người dùng thấy cột của họ
 * trước.
 *
 * CỐ Ý không `PARTITION BY`: với vài chục nghìn dòng, phân mảnh theo tháng sinh
 * ra hàng chục part tí hon và chậm hơn hẳn không phân mảnh. Việc chọn khoá sắp
 * xếp và phân mảnh THẬT thuộc về marts của dbt, nơi người ta đã biết truy vấn
 * nào sẽ chạy — đó chính là lý do `dbt_project.yml` tách `staging` khỏi `marts`.
 */
export function buildCreateTable(
  database: string,
  table: string,
  columns: readonly IngestColumn[],
): string {
  if (columns.length === 0) {
    throw new Error('Bộ dữ liệu không có cột nào được chọn nhập, không dựng được bảng.');
  }

  const defs = columns.map((c) => `  ${quoteIdent(c.name)} ${c.chType}`);
  defs.push(`  ${quoteIdent(ROW_INDEX_COLUMN)} UInt64`);

  return (
    `CREATE TABLE IF NOT EXISTS ${qualified(database, table)} (\n` +
    `${defs.join(',\n')}\n` +
    `) ENGINE = MergeTree() ORDER BY ${quoteIdent(ROW_INDEX_COLUMN)}`
  );
}

/**
 * Danh sách cột cho câu INSERT, ĐÃ BỌC định danh.
 *
 * ⚠️ `@clickhouse/client` ghép mảng `columns` vào SQL bằng `.join(', ')` và
 * KHÔNG escape gì cả (đã đọc `dist/common/client.js`). Nên việc bọc là của ta,
 * và quên nó thì tên cột do người dùng đặt trong Excel đi thẳng vào câu lệnh.
 */
export function insertColumnList(columns: readonly IngestColumn[]): string[] {
  return [...columns.map((c) => quoteIdent(c.name)), quoteIdent(ROW_INDEX_COLUMN)];
}
