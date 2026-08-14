import {
  REPORT_ERROR_CODES,
  type DatasetColumnDto,
  type DatasetDto,
  type ReportConfigDto,
  type ReportDataDto,
} from '@bi/shared';

import { warehouse } from '../../config/clickhouse';
import { env } from '../../config/env';
import { chTableName, qualified } from '../ingest/buildDdl';
import { quoteIdent } from '../ingest/typeMap';
import { HttpError } from '../../utils/httpError';

/**
 * Tổng hợp dữ liệu biểu đồ bằng ClickHouse (§7.6, viết lại ở §9).
 *
 * ─── Đây là lời hứa của §9 được trả ─────────────────────────────────────────
 *
 * Bản cũ (`aggregate.ts`) gom nhóm bằng TypeScript trong bộ nhớ, và lý do ghi
 * trong chính file đó KHÔNG phải "MySQL chậm" mà là AN TOÀN: dữ liệu nằm trong
 * cột JSON nên `GROUP BY` bằng SQL sẽ phải nội suy tên field do người dùng đặt
 * vào `data->>'$.<tên>'` — đúng hình dạng của một lỗ hổng SQL injection. Nhóm
 * trong TypeScript thì tên field chỉ là khoá của một Map, không bao giờ là mã.
 *
 * Cái giá là phải đọc HẾT dòng lên RAM, và chính nó đẻ ra trần 50.000 dòng.
 *
 * §9 gỡ được nút đó vì mỗi bộ dữ liệu giờ có bảng `raw_*` với CỘT THẬT: tên cột
 * được cố định và escape ngay lúc `CREATE TABLE`, nên `GROUP BY` trở lại thành
 * SQL bình thường. Hai lớp chặn, không phải một:
 *
 *   1. `dimension`/`measure` phải KHỚP một cột trong `dataset_columns`. Chuỗi đi
 *      vào SQL lấy từ database của ta, không phải từ body request.
 *   2. `quoteIdent` bọc nó, theo đúng luật escape backslash của ClickHouse.
 *
 * ─── Hai khác biệt so với bản cũ, ghi ra chứ không giấu ─────────────────────
 *
 *   - Nhãn của chiều là NGÀY sẽ ở dạng `2026-12-31 00:00:00.000` thay vì chuỗi
 *     thô người dùng gõ (`31/12/2026`). Đó là hệ quả của việc cột giờ là
 *     `DateTime64` thật chứ không còn là văn bản — và nó nhất quán giữa mọi bộ
 *     dữ liệu, thay vì phụ thuộc vào cách từng file được gõ.
 *   - Đo trên một cột VĂN BẢN chứa số định dạng Việt Nam (`1.234,56`) giờ bị bỏ
 *     qua, vì ClickHouse dùng `toFloat64OrNull` chứ không phải `parseNumber`.
 *     Cột được §7 nhận là `number` thì đã chuẩn hoá từ lúc nạp nên không ảnh
 *     hưởng; chỉ chạm tới cột mà `inferColumnType` đã kết luận là văn bản.
 */

/** Làm tròn 4 chữ số thập phân — cùng lý do với bản cũ: cắt rác dấu phẩy động. */
const SCALE = 4;

const OTHER_LABEL = 'Khác';
const EMPTY_LABEL = '(trống)';

export async function aggregateInWarehouse(
  tenantId: number,
  dataset: DatasetDto,
  columns: readonly DatasetColumnDto[],
  config: ReportConfigDto,
): Promise<ReportDataDto> {
  if (dataset.loadStatus !== 'loaded') {
    throw new HttpError(
      409,
      REPORT_ERROR_CODES.DATASET_NOT_LOADED,
      'Bộ dữ liệu chưa được nạp vào kho phân tích nên chưa vẽ được biểu đồ.',
    );
  }

  const dimensionCol = requireColumn(columns, config.dimension, 'chiều');
  const measureCol = config.measure === null ? null : requireColumn(columns, config.measure, 'số đo');

  const table = qualified(env.CLICKHOUSE_DATABASE, chTableName(tenantId, dataset.id));

  // `ifNull(...,'')` TRƯỚC `trim`: `toString` của một ô NULL trong ClickHouse trả
  // về NULL chứ không phải chuỗi "NULL", và mọi phép so sánh sau đó sẽ trượt —
  // nhóm rỗng biến mất khỏi biểu đồ thay vì hiện thành "(trống)". Ô trống là thứ
  // người xem CẦN thấy, không phải thứ nên giấu.
  const label = `trimBoth(ifNull(toString(${quoteIdent(keyOf(dimensionCol))}), ''))`;
  const inner =
    `SELECT if(${label} = '', {empty:String}, ${label}) AS label, ` +
    `round(${aggregateExpr(config, measureCol)}, ${SCALE}) AS value ` +
    `FROM ${table} GROUP BY label`;

  const limit = Math.max(1, config.limit);
  const params = { empty: EMPTY_LABEL, n: limit };

  const [top, totals] = await Promise.all([
    query<{ label: string; value: number }>(
      `SELECT label, value FROM (${inner}) ORDER BY value DESC, label ASC LIMIT {n:UInt32}`,
      params,
    ),
    // Truy vấn thứ hai chỉ để biết CÓ BAO NHIÊU nhóm và tổng của tất cả. Không
    // gộp vào câu trên được: câu trên đã `LIMIT`, mà "Khác" cần phần nằm ngoài
    // giới hạn đó. Đọc cả danh sách nhóm về Node rồi tự cộng thì lại quay về
    // đúng cái nút thắt vừa gỡ — một chiều có một triệu giá trị phân biệt sẽ kéo
    // một triệu dòng qua mạng.
    query<{ groups: string; total: number }>(
      `SELECT count() AS groups, sum(value) AS total FROM (${inner})`,
      params,
    ),
  ]);

  const groups = Number(totals[0]?.groups ?? 0);
  const grouped = groups > limit;

  const rows = top.map((r) => ({ label: r.label, value: Number(r.value) }));

  // Chỉ gộp "Khác" khi phép tính CỘNG ĐƯỢC. Trung bình của các trung bình không
  // phải trung bình, và "Khác" của min/max thì vô nghĩa — ở những phép đó ta cắt
  // bớt và nói rõ bằng cờ `grouped`. Giữ nguyên luật của bản cũ.
  if (grouped && isAdditive(config.aggregate)) {
    const shown = rows.reduce((acc, r) => acc + r.value, 0);
    rows.push({ label: OTHER_LABEL, value: round(Number(totals[0]?.total ?? 0) - shown) });
  }

  return {
    rows,
    dimensionLabel: keyOf(dimensionCol),
    measureLabel: measureLabel(config, measureCol),
    grouped,
  };
}

/**
 * Cột phải TỒN TẠI trong `dataset_columns` — đây là lớp chặn thứ nhất.
 *
 * Không phải kiểm tra hình thức: giá trị trả về là thứ duy nhất được phép đi vào
 * câu SQL. Bỏ bước này thì `config.dimension` — một chuỗi trong body request —
 * đi thẳng vào `GROUP BY`.
 *
 * 400 chứ không 500: cấu hình báo cáo trỏ tới một cột đã bị đổi tên hoặc bỏ chọn
 * là chuyện xảy ra thật khi bộ dữ liệu được đồng bộ lại.
 */
function requireColumn(
  columns: readonly DatasetColumnDto[],
  key: string,
  role: string,
): DatasetColumnDto {
  const found = columns.find((c) => c.included && keyOf(c) === key);
  if (!found) {
    throw new HttpError(
      400,
      REPORT_ERROR_CODES.REPORT_NOT_CONFIGURED,
      `Cột ${role} "${key}" không còn trong bộ dữ liệu. Hãy dựng lại biểu đồ.`,
    );
  }
  return found;
}

/** Cùng khoá mà `buildIngestColumns` dùng để đặt tên cột ClickHouse. */
function keyOf(column: DatasetColumnDto): string {
  return column.fieldName ?? column.name;
}

/**
 * `count()` đếm DÒNG, không đếm giá trị đọc được.
 *
 * Bản cũ đẩy `1` vào giỏ cho mỗi dòng khi phép tính là `count`, kể cả khi ô số
 * đo trống — nên `count` là "bao nhiêu bản ghi", không phải "bao nhiêu ô có
 * giá trị". Giữ đúng như vậy, nếu không mọi biểu đồ đếm sẽ đổi số sau bản này.
 *
 * Các phép còn lại dùng `toFloat64OrNull`: ô không đọc được thành số bị BỎ QUA
 * khỏi phép tính chứ không tính là 0 — tính là 0 sẽ kéo trung bình xuống theo số
 * ô trống, và một cột thiếu nửa dữ liệu sẽ hiện trung bình bằng một nửa giá trị
 * thật. `sum`/`avg` của ClickHouse bỏ qua NULL đúng như vậy.
 */
function aggregateExpr(config: ReportConfigDto, measureCol: DatasetColumnDto | null): string {
  if (config.aggregate === 'count' || measureCol === null) return 'count()';

  const value = `toFloat64OrNull(toString(${quoteIdent(keyOf(measureCol))}))`;
  switch (config.aggregate) {
    case 'sum':
      return `sum(${value})`;
    case 'avg':
      return `avg(${value})`;
    case 'min':
      return `min(${value})`;
    case 'max':
      return `max(${value})`;
  }
}

function isAdditive(aggregateType: ReportConfigDto['aggregate']): boolean {
  return aggregateType === 'sum' || aggregateType === 'count';
}

/** Chép NGUYÊN luật của bản cũ: đổi chữ ở đây là đổi nhãn trục của mọi biểu đồ đang có. */
function measureLabel(config: ReportConfigDto, measureCol: DatasetColumnDto | null): string {
  if (config.aggregate === 'count') return 'Số dòng';
  const name = measureCol === null ? (config.measure ?? '') : keyOf(measureCol);
  const verb: Record<ReportConfigDto['aggregate'], string> = {
    sum: 'Tổng',
    avg: 'Trung bình',
    count: 'Số dòng',
    min: 'Nhỏ nhất',
    max: 'Lớn nhất',
  };
  return `${verb[config.aggregate]} ${name}`.trim();
}

function round(n: number): number {
  return Math.round(n * 10 ** SCALE) / 10 ** SCALE;
}

async function query<T>(sql: string, params: Record<string, unknown>): Promise<T[]> {
  const rs = await warehouse.query({ query: sql, query_params: params, format: 'JSONEachRow' });
  return rs.json<T>();
}
