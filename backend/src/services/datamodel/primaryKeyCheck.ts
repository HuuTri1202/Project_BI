import type { PrimaryKeyWarningDto } from '@bi/shared';

import { env } from '../../config/env';
import { warehouse } from '../../config/clickhouse';
import { quoteIdent } from '../ingest/typeMap';
import { chTableName } from '../ingest/buildDdl';

/**
 * Cột được chọn làm khoá chính có THẬT SỰ là khoá không — §10.3.
 *
 * ─── Vì sao phải hỏi kho thay vì tin người dùng ─────────────────────────────
 *
 * Đặt khoá chính là một tuyên bố về DỮ LIỆU, không phải một tuỳ chọn hiển thị:
 * nó nói "mỗi giá trị ở cột này ứng với đúng một dòng". Nếu tuyên bố đó sai —
 * cột `Order ID` của bảng `Orders` thật ra lặp lại vì mỗi đơn có nhiều dòng
 * hàng — thì mọi phép nối vào nó sẽ NHÂN BẢN dòng bên kia, và mọi phép tổng sau
 * đó lớn hơn sự thật.
 *
 * Cube không phát hiện được, ClickHouse không phàn nàn, biểu đồ chỉ hiện một
 * con số sai trông rất hợp lý. Đây cùng một họ với cảnh báo khoá trùng khi lưu
 * quan hệ (`relationships.ts`), và nó xuất hiện SỚM HƠN một bước.
 *
 * ─── Cảnh báo, KHÔNG chặn ───────────────────────────────────────────────────
 *
 * Cùng lý lẽ với cảnh báo ở tab Quan hệ: có những mô hình hợp lệ mà cột khoá
 * vẫn trùng (bảng cầu nối, bảng lịch sử). Chặn cứng sẽ khoá người dùng khỏi
 * những ca đúng; im lặng thì để họ tin vào một con số sai. Nói ra là đường ở
 * giữa, và nó là đường duy nhất còn lại.
 */
export async function checkPrimaryKey(
  tenantId: number,
  datasetId: number,
  columnName: string,
): Promise<PrimaryKeyWarningDto> {
  const table = chTableName(tenantId, datasetId);

  /*
   * MỘT câu cho cả ba con số.
   *
   * `uniqExact` chứ không `uniq`: `uniq` là ước lượng HyperLogLog và nó sai lệch
   * vài phần nghìn — đủ để một cột khoá hoàn hảo bị báo là trùng, hoặc ngược
   * lại. Ở đây ta đang trả lời một câu hỏi đúng/sai, nên phải đếm thật.
   *
   * ⚠️ Tên cột KHÔNG tham số hoá được (ClickHouse chỉ nhận `{x:Identifier}` cho
   * một số vị trí, và không phải trong `uniqExact`), nên nó đi qua `quoteIdent`
   * — cùng hàm mà `buildDdl` dùng, escape bằng dấu chéo ngược theo luật
   * ClickHouse. Tên bảng thì sinh từ hai số nguyên của hệ thống, không có ký tự
   * nào của người dùng.
   */
  const ident = quoteIdent(columnName);
  const rs = await warehouse.query({
    query:
      `SELECT count() AS total, uniqExact(${ident}) AS distinct_values, ` +
      `countIf(${ident} IS NULL) AS null_values ` +
      'FROM {db:Identifier}.{tbl:Identifier}',
    query_params: { db: env.CLICKHOUSE_DATABASE, tbl: table },
    format: 'JSONEachRow',
  });

  const rows = await rs.json<{ total: string; distinct_values: string; null_values: string }>();
  const row = rows[0];
  if (row === undefined) {
    return { columnName, duplicateValues: false, distinctValues: 0, nullValues: 0, rowCount: 0 };
  }

  const total = Number(row.total);
  const distinct = Number(row.distinct_values);
  const nulls = Number(row.null_values);

  return {
    columnName,
    // So `uniqExact` với số dòng KHÔNG NULL: `uniqExact` bỏ qua NULL, nên đem
    // nó so thẳng với `count()` sẽ báo trùng cho mọi cột chỉ vì có ô trống —
    // một cảnh báo sai làm người dùng học cách bỏ qua mọi cảnh báo.
    duplicateValues: distinct < total - nulls,
    distinctValues: distinct,
    nullValues: nulls,
    rowCount: total,
  };
}
