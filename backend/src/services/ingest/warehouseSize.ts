import { warehouse } from '../../config/clickhouse';
import { env } from '../../config/env';
import { mysqlPool } from '../../config/mysql';
import * as datasetsRepo from '../../repositories/datasets';

/**
 * Đo chỗ một bộ dữ liệu thật sự chiếm trong kho — §11.2.
 *
 * ═══ Vì sao hạn mức không đo FILE nữa ══════════════════════════════════════
 *
 * Migration 38 ghi lại con số đo được trên máy dev; tóm tắt: bộ dữ liệu nguồn
 * `connection` không có file nào nên tiêu đúng 0 byte hạn mức dù đồng bộ bao
 * nhiêu dòng cũng được, còn file thì bị tính cả phần sẽ được nén đi (519 MB file
 * nằm vừa trong 43 MB kho). Hạn mức của gói nói về chỗ dữ liệu CHIẾM, nên nó
 * phải đo đúng chỗ đó.
 *
 * ═══ `total_bytes` là byte TRÊN ĐĨA, và đó là con số đúng ══════════════════
 *
 * Với `MergeTree` — engine duy nhất §9 tạo ra — `system.tables.total_bytes` là
 * tổng dung lượng các part đang hoạt động, tức đúng thứ chiếm đĩa. Không dùng
 * `data_uncompressed_bytes`: nó là kích thước dữ liệu SAU khi bung nén, một con
 * số không tương ứng với bất kỳ tài nguyên nào phải trả tiền.
 *
 * Hệ quả cần biết: kho nén tốt (đo được 2–5 lần trên dữ liệu thật), nên cùng
 * một con số hạn mức giờ chứa được nhiều dữ liệu thô hơn trước. Đó là hệ quả
 * đúng của việc tính theo chỗ chiếm thật, không phải sai sót — muốn siết lại thì
 * sửa con số trong bảng giá, đừng sửa cách đo.
 *
 * ═══ Bảng của bộ dữ liệu ĐÃ XOÁ MỀM không được tính ════════════════════════
 *
 * Xoá mềm một bộ dữ liệu KHÔNG drop bảng (`dropTables.ts` giải thích vì sao:
 * khôi phục chỉ là gỡ `deleted_at` ra). Nên trên đĩa, bảng ấy vẫn nằm đó.
 *
 * Vẫn không tính, vì lối thoát khỏi hạn mức phải THẬT: thông báo bảo "xoá bớt bộ
 * dữ liệu cũ" mà xoá xong con số không nhúc nhích là một cái bẫy kín — người
 * dùng xoá hết dữ liệu của mình rồi vẫn không tạo được gì, và không có gì trên
 * màn hình giải thích tại sao. Đổi lại, đĩa giữ nhiều hơn phần đang tính; đó là
 * cái giá của xoá mềm hoàn tác được, đã ghi ở `dropTables.ts`.
 */

/** Không đo được thì coi như chưa có gì — dùng chung cho mọi nhánh đọc. */
const KHONG_CO = 0;

/**
 * Số byte bảng `name` đang chiếm. `0` nếu bảng chưa tồn tại.
 *
 * Ném ra ngoài nếu KHÔNG HỎI ĐƯỢC ClickHouse. Nơi gọi duy nhất là `loadDataset`,
 * và ở đó nuốt lỗi là sai: không đo được nghĩa là không cưỡng chế được hạn mức,
 * và cho dữ liệu vào kho trong lúc không biết nó to bằng nào là đúng thứ hạn mức
 * sinh ra để ngăn. Vả lại câu này chạy trên chính server vừa nhận xong hàng chục
 * nghìn dòng — nó hỏng thì lần nạp cũng đã hỏng rồi.
 */
export async function doDungLuongBang(name: string): Promise<number> {
  const rs = await warehouse.query({
    query: `SELECT total_bytes AS b FROM system.tables
             WHERE database = {db:String} AND name = {name:String}`,
    query_params: { db: env.CLICKHOUSE_DATABASE, name },
    format: 'JSONEachRow',
  });
  const rows = await rs.json<{ b: string | number | null }>();
  return Number(rows[0]?.b ?? KHONG_CO);
}

/**
 * Tên bảng do §9 sinh ra. Giống hệt `RAW_TABLE_RE` ở `dropTables.ts` nhưng KHÔNG
 * nhận đuôi `__new`: bảng tạm là dữ liệu đang chảy dở của một lần nạp chưa xong,
 * cộng nó vào là tính đôi đúng bộ dữ liệu đang được nạp lại.
 */
const BANG_KHO_RE = /^raw_t\d+_d(\d+)$/;

/**
 * Đồng bộ lại `datasets.warehouse_bytes` cho toàn hệ thống. Trả về số dòng đổi.
 *
 * Janitor gọi mỗi giờ, và nó làm hai việc bằng cùng một lượt:
 *
 *   1. BACKFILL. Migration 38 để mọi dòng đang có ở 0; lượt quét đầu tiên sau
 *      khi khởi động lại điền đúng số cho chúng. Không phải viết backfill trong
 *      migration — mà cũng không viết được, vì MySQL không hỏi được ClickHouse.
 *   2. Trôi do MERGE. ClickHouse gộp part ở nền, và bảng nhỏ dần sau khi nạp
 *      xong. Trôi luôn theo chiều có lợi cho người dùng, nên nó không cấp bách —
 *      mỗi giờ một lần là đủ.
 *
 * Quét theo BẢNG rồi mới tra ngược ra dataset, không phải ngược lại: kho là nơi
 * biết sự thật về đĩa, và một lượt `system.tables` rẻ hơn hẳn N câu hỏi lẻ.
 */
export async function dongBoDungLuongKho(): Promise<number> {
  const rs = await warehouse.query({
    query: `SELECT name, total_bytes AS b FROM system.tables WHERE database = {db:String}`,
    query_params: { db: env.CLICKHOUSE_DATABASE },
    format: 'JSONEachRow',
  });
  const rows = await rs.json<{ name: string; b: string | number | null }>();

  const theoDataset = new Map<number, number>();
  for (const { name, b } of rows) {
    const m = BANG_KHO_RE.exec(name);
    if (!m) continue;
    theoDataset.set(Number(m[1]), Number(b ?? KHONG_CO));
  }

  return datasetsRepo.capNhatDungLuongKho(mysqlPool, theoDataset);
}
