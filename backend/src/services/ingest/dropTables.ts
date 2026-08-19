import { warehouse } from '../../config/clickhouse';
import { env } from '../../config/env';
import { mysqlPool } from '../../config/mysql';
import * as datasetsRepo from '../../repositories/datasets';
import { qualified } from './buildDdl';

/**
 * Dọn bảng trong kho khi MySQL KHÔNG CÒN dòng nào nhận nó (§9).
 *
 * ─── Phạm vi đã HẸP LẠI, và đó là chủ ý ────────────────────────────────────
 *
 * Bản trước có hai lớp: xoá ngay lúc người dùng bấm xoá dataset, cộng một lượt
 * quét mỗi giờ. Lớp thứ nhất đã bị bỏ — xoá dataset nay là thao tác thuần
 * MySQL, bảng `raw_*` giữ nguyên để khôi phục chỉ là gỡ `deleted_at` ra (xem
 * `deleteDataset`).
 *
 * Nên "mồ côi" ở đây mang nghĩa hẹp và đúng nghĩa đen: bảng mà `datasets` không
 * còn DÒNG NÀO trỏ tới, kể cả dòng đã xoá mềm. Thực tế chỉ xảy ra khi dòng bị
 * xoá cứng theo dây chuyền — ví dụ một tổ chức bị xoá cứng — và khi đó không ai
 * còn đường nào để đọc bảng ấy nữa.
 *
 * ⚠️ Hệ quả phải biết: bảng của một bộ dữ liệu ĐÃ XOÁ MỀM sẽ nằm lại vĩnh viễn.
 * Xoá rồi tải lại cùng một file mười lần để lại mười bản đầy đủ trong kho, vì
 * tải file luôn sinh id mới. Đây là cái giá đã cân nhắc của việc xoá mềm thật
 * sự hoàn tác được, không phải một chỗ bị bỏ quên.
 *
 * Janitor không đọc `ch_table` mà **suy tên từ chính hai số nguyên**, nên nó dọn
 * được cả bảng mà MySQL đã quên mất là mình từng có.
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
 * Quét toàn kho, xoá bảng không còn dòng `datasets` nào nhận.
 *
 * Trả về số bảng đã xoá. Ném ra ngoài nếu KHÔNG LIỆT KÊ ĐƯỢC — nơi gọi ghi log
 * rồi thử lại giờ sau. Còn lỗi của từng lệnh `DROP` lẻ thì nuốt tại chỗ: một
 * bảng đang bị khoá không được phép chặn 20 bảng còn lại.
 *
 * ⚠️ Thứ tự đọc là CỐ Ý: lấy danh sách id TRƯỚC, liệt kê bảng SAU. Ngược lại thì
 * một bộ dữ liệu tạo ra giữa hai lần đọc sẽ có bảng nằm trong danh sách quét
 * nhưng id chưa kịp vào danh sách — và janitor xoá mất bảng vừa nạp xong. Đọc theo thứ tự này thì trường hợp xấu nhất chỉ là bỏ sót một bảng tới
 * lượt quét sau.
 */
export async function sweepOrphanTables(): Promise<number> {
  const knownIds = await datasetsRepo.listKnownIds(mysqlPool);
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
    if (knownIds.has(datasetId)) continue;

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
