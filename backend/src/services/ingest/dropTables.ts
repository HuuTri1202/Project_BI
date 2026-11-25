import { warehouse } from '../../config/clickhouse';
import { env } from '../../config/env';
import { mysqlPool } from '../../config/mysql';
import * as datasetsRepo from '../../repositories/datasets';
import { storage } from '../../storage';
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
 * Neo hai đầu `^…$` là phần quan trọng nhất của cả file này. `bi_analytics` là
 * một database dùng chung: ngoài bảng do §9 nạp, nó còn giữ những bảng người
 * khác tạo bằng tay để thử nghiệm (máy dev cũ vẫn còn `spike_orders` từ tuần
 * đầu), và sau này có thể có cả bảng tổng hợp do một tầng khác dựng. Một janitor
 * chạy nền mà nới regex này thành tiền tố `raw_` là đủ để xoá thứ nó không hiểu.
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

/**
 * Khoá do `khoaLuuTru()` sinh ra, và CHỈ những khoá đó.
 *
 *     t4/w5/bao-cao-quy-4__ffb0134f-f6e7-4e56-94dc-3badf6d6e532.xlsx
 *     t1/w7/834071bd-5938-42e2-a24d-c06b013e0eda.xlsx      ← dạng CŨ, không slug
 *
 * Phần slug để TUỲ CHỌN vì khoá đời đầu chưa có nó, và 7 trong 26 khoá trên máy
 * dev vẫn mang dạng ấy. Bắt buộc có slug thì janitor im lặng bỏ qua đúng những
 * tệp cũ nhất — không xoá nhầm gì, nhưng rò thì vẫn nguyên ở chỗ lâu đời nhất.
 *
 * Neo hai đầu `^…$` ở đây quan trọng y như ở `RAW_TABLE_RE`, và vì cùng một lý
 * do: bucket là chỗ dùng chung. Ảnh QR tĩnh của §11 nằm cùng bucket nhưng khoá
 * khác hình dạng, và một ngày nào đó sẽ có thứ khác nữa. Janitor chỉ được đụng
 * vào thứ nó tự sinh ra và hiểu trọn vẹn.
 */
const DATASET_KEY_RE =
  /^t\d+\/w\d+\/(?:[a-z0-9-]+__)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:csv|xlsx)$/;

/**
 * Dọn TỆP trong kho đối tượng khi MySQL không còn dòng nào nhận — cặp song sinh
 * của `sweepOrphanTables`.
 *
 * ─── Vì sao đường GHI không tự xoá, mà để janitor làm ──────────────────────
 *
 * Ba chỗ sinh ra tệp mồ côi, và cả ba đều cố ý không xoá tại chỗ:
 *
 *   - `doiTepNguon` (thay tệp nguồn): lần nạp mới có thể hỏng, và lúc đó tệp cũ
 *     là thứ duy nhất dựng lại được. Xoá ngay là vứt bản lùi.
 *   - `sweepStalePendingUploads`: tải lên rồi bỏ dở quá 24 giờ.
 *   - Xoá CỨNG một dòng `datasets` theo dây chuyền, ví dụ xoá hẳn một tổ chức.
 *
 * Không có janitor thì cả ba rò vĩnh viễn. Đo được 25/11/2026 trên máy dev:
 * **81 tệp mồ côi, 224 MiB trên tổng 259 MiB** — 86% kho đối tượng là tệp không
 * còn ai trỏ tới. Đó không phải rác của riêng bộ kiểm thử: mỗi người dùng thay
 * tệp nguồn hằng tháng đều để lại một bản đầy đủ mỗi lần.
 *
 * ─── Thứ tự đọc, và vì sao nó NGƯỢC với `sweepOrphanTables` ────────────────
 *
 * Ở bảng, danh sách id đọc TRƯỚC. Ở tệp thì ngược lại: liệt kê object TRƯỚC,
 * đọc khoá SAU. Vì vòng đời ngược nhau — bảng `raw_*` sinh ra SAU khi đã có
 * dòng `datasets`, còn object thì có TRƯỚC. Đọc khoá trước rồi mới liệt kê thì
 * một tệp được chốt vào MySQL giữa hai lần đọc sẽ nằm trong danh sách object mà
 * vắng trong tập khoá, và janitor xoá mất nó. Đọc theo thứ tự này thì trường
 * hợp xấu nhất chỉ là bỏ sót một tệp tới lượt quét sau.
 *
 * ─── `olderThanHours` là chốt an toàn QUAN TRỌNG NHẤT ─────────────────────
 *
 * Trình duyệt PUT thẳng lên S3 rồi MỚI gọi `/commit` để ghi `s3_key` vào MySQL.
 * Giữa hai việc đó có một khoảng — người dùng chọn sheet, đặt tên, khai quy ước
 * số — mà tệp đã nằm trong kho còn MySQL chưa biết gì về nó. Một janitor không
 * nhìn tuổi sẽ xoá đúng tệp người ta vừa tải lên, ngay giữa lúc họ điền form.
 *
 * Tham số chứ không phải hằng số trong file này, đúng như
 * `sweepStalePendingUploads(db, olderThanHours)`: nơi gọi giữ con số, nên hai
 * ngưỡng nằm cạnh nhau và không trôi xa nhau được.
 *
 * ⚠️ Phép so này bắc qua HAI ĐỒNG HỒ: `lastModified` do kho đối tượng đóng dấu,
 * `Date.now()` là của tiến trình Node. Đo được trên máy dev 25/11/2026: đồng hồ
 * container MinIO chạy nhanh hơn máy chủ **450 ms**, nên một tệp vừa ghi xong
 * có thể mang mốc thời gian ở TƯƠNG LAI so với Node. Ở 24 giờ thì lệch đó không
 * nghĩa lý gì — nhưng đừng hạ ngưỡng này xuống hàng phút: khi khoảng cách hai
 * đồng hồ cùng cỡ với ngưỡng, janitor bỏ sót hay không trở thành chuyện may rủi.
 *
 * Trả về số tệp đã xoá. Ném ra ngoài nếu KHÔNG LIỆT KÊ ĐƯỢC; lỗi của từng lệnh
 * xoá lẻ thì nuốt tại chỗ, cùng lý lẽ với hàm trên.
 */
export async function sweepOrphanFiles(olderThanHours: number): Promise<number> {
  const objects = await storage.listObjects();
  const knownKeys = await datasetsRepo.listKnownS3Keys(mysqlPool);
  const hanTuoi = Date.now() - olderThanHours * 3_600_000;

  let deleted = 0;
  for (const { key, lastModified } of objects) {
    if (!DATASET_KEY_RE.test(key)) continue;
    if (knownKeys.has(key)) continue;
    if (lastModified.getTime() > hanTuoi) continue;

    try {
      await storage.deleteObject(key);
      deleted += 1;
      console.log(`[ingest] janitor: đã xoá tệp mồ côi ${key}`);
    } catch (err) {
      console.error(`[ingest] janitor: không xoá được tệp ${key}:`, err);
    }
  }
  return deleted;
}
