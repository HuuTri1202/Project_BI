import { warehouse } from '../../config/clickhouse';
import { env } from '../../config/env';
import { mysqlPool } from '../../config/mysql';
import * as datasetsRepo from '../../repositories/datasets';
import { chTableName, qualified } from './buildDdl';

/**
 * Dọn bảng trong kho phân tích khi bộ dữ liệu không còn sống (§9).
 *
 * ─── Vì sao XOÁ BẢNG là an toàn, dù `datasets` chỉ xoá MỀM ──────────────────
 *
 * Nghe thì mâu thuẫn: xoá mềm là để hoàn tác được, mà `DROP TABLE` thì không.
 * Nhưng bảng `raw_*` là **dẫn xuất**, không phải bản gốc — mọi thứ cần để dựng
 * lại nó đều sống sót qua lần xoá mềm:
 *
 *   nguồn `connection` → CSDL khách hàng còn nguyên, `dataset_columns` còn nguyên
 *   nguồn `file`       → `dataset_rows` và file trong MinIO đều KHÔNG bị xoá theo
 *
 * Nên cái mất đi khi drop là thời gian nạp lại, không phải dữ liệu. Và với nguồn
 * `connection`, người dùng thậm chí không thấy khoảng trống: đồng bộ lại hồi sinh
 * đúng id cũ (nhánh `deleted_at = NULL` của `datasets.upsert`), rồi nạp tự động
 * đổ đầy lại ngay.
 *
 * ─── Vì sao cần CẢ hai lớp: xoá ngay VÀ quét định kỳ ────────────────────────
 *
 * Xoá ngay là đường nhanh, xử lý đúng trường hợp thường gặp. Nhưng nó không thể
 * kín, và ba lỗ dưới đây đều có thật:
 *
 *   1. ClickHouse tắt đúng lúc người dùng bấm xoá. Lệnh xoá vẫn phải thành công —
 *      bắt người dùng chờ kho phân tích sống lại mới xoá được một dòng trong
 *      MySQL là buộc hai thứ độc lập vào nhau.
 *   2. Xoá KẾT NỐI làm mọi bộ dữ liệu của nó khuất khỏi giao diện, nhưng
 *      `datasets.deleted_at` vẫn NULL (xem điều kiện `c.deleted_at IS NULL`
 *      trong `datasets.where`). Đường xoá dataset không hề chạy qua.
 *   3. Người dùng xoá GIỮA LÚC đang nạp. Lần nạp đó chạy tiếp và tạo lại đúng
 *      cái bảng ta vừa drop, ở bước `CREATE` trước `EXCHANGE TABLES`.
 *
 * Nên janitor không đọc `ch_table` mà **suy tên từ chính hai số nguyên** rồi đối
 * chiếu với danh sách còn sống. Nhờ vậy nó dọn được cả bảng mà MySQL đã quên mất
 * là mình từng có.
 */

/**
 * Tên bảng do §9 sinh ra, và CHỈ những tên đó.
 *
 * Neo hai đầu `^…$` là phần quan trọng nhất của cả file này: `bi_analytics` còn
 * chứa `spike_orders` của spike F1.7 và sẽ chứa các view staging/marts do dbt
 * dựng ở §10. Một janitor chạy nền mà nới lỏng regex này thành `raw_` là đủ để
 * xoá thứ nó không hiểu.
 */
const RAW_TABLE_RE = /^raw_t(\d+)_d(\d+)(?:__new)?$/;

/**
 * Xoá bảng của một bộ dữ liệu — cả bảng đang phục vụ lẫn bảng tạm.
 *
 * KHÔNG BAO GIỜ ném. Nơi gọi là đường xoá dataset, và ở đó dòng MySQL đã bị xoá
 * mềm xong rồi: ném ra lúc này sẽ trả về lỗi cho một thao tác đã thành công, và
 * người dùng bấm lại thì nhận 404. Dọn không được thì janitor lo.
 *
 * `SYNC` vì `bi_analytics` dùng engine `Atomic` — thiếu nó thì đĩa chỉ được trả
 * sau `database_atomic_delay_before_drop_table_sec` (mặc định 480 giây), tức là
 * "đã xoá" mà `du` vẫn không đổi trong tám phút.
 */
export async function dropDatasetTables(tenantId: number, datasetId: number): Promise<void> {
  const db = env.CLICKHOUSE_DATABASE;
  const target = chTableName(tenantId, datasetId);

  for (const table of [target, `${target}__new`]) {
    try {
      await warehouse.command({ query: `DROP TABLE IF EXISTS ${qualified(db, table)} SYNC` });
    } catch (err) {
      console.error(`[ingest] không xoá được bảng ${table} trong kho:`, err);
    }
  }
}

/**
 * Quét toàn kho, xoá bảng không còn bộ dữ liệu sống nào nhận.
 *
 * Trả về số bảng đã xoá. Ném ra ngoài nếu KHÔNG LIỆT KÊ ĐƯỢC — nơi gọi ghi log
 * rồi thử lại giờ sau. Còn lỗi của từng lệnh `DROP` lẻ thì nuốt tại chỗ: một
 * bảng đang bị khoá không được phép chặn 20 bảng còn lại.
 *
 * ⚠️ Thứ tự đọc là CỐ Ý: lấy danh sách còn sống TRƯỚC, liệt kê bảng SAU. Ngược
 * lại thì một bộ dữ liệu tạo ra giữa hai lần đọc sẽ có bảng nằm trong danh sách
 * quét nhưng id chưa kịp vào danh sách sống — và janitor xoá mất bảng vừa nạp
 * xong. Đọc theo thứ tự này thì trường hợp xấu nhất chỉ là bỏ sót một bảng tới
 * lượt quét sau.
 */
export async function sweepOrphanTables(): Promise<number> {
  const liveIds = await datasetsRepo.listLiveIds(mysqlPool);
  const db = env.CLICKHOUSE_DATABASE;

  const rs = await warehouse.query({
    query: 'SELECT name FROM system.tables WHERE database = {db:String}',
    query_params: { db },
    format: 'JSONEachRow',
  });
  const tables = await rs.json<{ name: string }>();

  let dropped = 0;
  for (const { name } of tables) {
    const m = RAW_TABLE_RE.exec(name);
    if (!m) continue;

    const datasetId = Number(m[2]);
    if (liveIds.has(datasetId)) continue;

    try {
      await warehouse.command({ query: `DROP TABLE IF EXISTS ${qualified(db, name)} SYNC` });
      dropped += 1;
      console.log(`[ingest] janitor: đã xoá bảng mồ côi ${name}`);
    } catch (err) {
      console.error(`[ingest] janitor: không xoá được ${name}:`, err);
    }
  }
  return dropped;
}
