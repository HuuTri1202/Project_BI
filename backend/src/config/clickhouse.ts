import { createClient, type ClickHouseClient } from '@clickhouse/client';
import { quoteIdent } from '../services/ingest/typeMap';
import { env } from './env';

/**
 * Kết nối tới KHO PHÂN TÍCH CỦA CHÍNH TA (§9).
 *
 * ⚠️ ĐỪNG NHẦM với `services/connections/drivers/clickhouse.ts`. Hai file dùng
 * chung một thư viện nhưng nói chuyện với hai thứ đối lập nhau về mọi mặt an
 * toàn:
 *
 *   drivers/clickhouse.ts   CSDL của KHÁCH HÀNG. CHỈ ĐỌC. Host do người dùng gõ
 *                           lên form, nên phải ghim IP đã qua `guardHost` để
 *                           chống SSRF, và client sống đúng một thao tác rồi
 *                           đóng (`keepAlive: false`) — đó là socket ta mở trên
 *                           máy người khác.
 *   config/clickhouse.ts    Kho của TA. CÓ GHI (CREATE TABLE + INSERT). Địa chỉ
 *                           nằm trong `.env` do người vận hành đặt. Một client
 *                           singleton sống suốt đời tiến trình, keep-alive bật.
 *
 * Dùng nhầm chiều nào cũng hỏng theo cách khó tìm: lấy driver kia để ghi thì mỗi
 * lô INSERT phải bắt tay TCP lại từ đầu (một lần nạp là hàng chục lô); lấy cái
 * này để đọc CSDL khách hàng thì mất sạch lớp chống SSRF.
 */
export const warehouse: ClickHouseClient = createClient({
  // Luôn HTTP thô, không TLS: ClickHouse chạy trong mạng Docker nội bộ cùng
  // Express. Đây cũng là lý do TUYỆT ĐỐI không được publish cổng 8123 ra
  // Internet — không có gì bảo vệ nó ngoài việc nó không tới được từ ngoài.
  url: `http://${env.CLICKHOUSE_HOST}:${env.CLICKHOUSE_PORT}`,
  database: env.CLICKHOUSE_DATABASE,
  username: env.CLICKHOUSE_USER,
  password: env.CLICKHOUSE_PASSWORD,

  // 5 phút thay cho mặc định 30 giây. Đây là trần phía CLIENT cho MỘT lô INSERT
  // — không phải cho cả lần nạp, vốn có thể kéo dài nhiều phút qua nhiều lô.
  request_timeout: 300_000,

  clickhouse_settings: {
    // `users.d/limits.xml` đặt `max_execution_time = 60` cho profile mặc định
    // nhưng KHÔNG khoá nó trong <constraints>, nên client được phép nâng. 60
    // giây đủ cho truy vấn đọc của người dùng, không đủ cho một câu INSERT lớn
    // trên máy dev đang chạy đồng thời MySQL, Redis, MinIO và Vite.
    max_execution_time: 300,

    // Bắt ClickHouse nhỏ giọt header tiến độ trong lúc câu lệnh còn chạy.
    //
    // Không có nó, một câu INSERT chậm là một kết nối HTTP im lặng hoàn toàn
    // cho tới lúc xong — và mọi thứ đứng giữa (proxy, load balancer, cả stack
    // TCP của máy) đều có quyền coi đó là kết nối chết mà cắt. Triệu chứng là
    // `socket hang up` xuất hiện ngẫu nhiên chỉ với dataset lớn.
    //
    // Chính `@clickhouse/client` cảnh báo lúc khởi động khi `request_timeout`
    // vượt xa mặc định mà thiếu cặp cài đặt này.
    send_progress_in_http_headers: 1,
    http_headers_progress_interval_ms: '50000',
  },
});

/**
 * Ping thật, dùng khi nhận một job nạp.
 *
 * ─── Vì sao kiểm TRƯỚC khi chạy, không đợi lỗi tự nổ ────────────────────────
 *
 * Bài học từ vụ MinIO: khi một hạ tầng phía sau không chạy, thứ người dùng nhìn
 * thấy là "Có lỗi không xác định. Vui lòng thử lại." — một câu không dẫn tới bất
 * kỳ hành động nào. Nguyên nhân thật (`docker compose` chưa bật service) cách
 * triệu chứng vài tầng và không có gì trong log nối được hai đầu.
 *
 * Ping trước thì lỗi được đặt tên ngay tại chỗ biết rõ nhất chuyện gì đang xảy
 * ra, và câu trả về nói thẳng lệnh phải chạy.
 */
export async function pingClickhouse(): Promise<void> {
  const result = await warehouse.ping();
  if (!result.success) throw result.error;
}

/**
 * Client PHỤ, ghim vào `system` — chỉ để trả lời "database kho đã có chưa".
 *
 * ─── Vì sao KHÔNG hỏi bằng `warehouse` ở trên ───────────────────────────────
 *
 * `warehouse` ghim `database: bi_analytics`, và ClickHouse từ chối MỌI câu lệnh
 * gửi kèm một database không tồn tại — kể cả câu chỉ đọc `system.databases`.
 * Đo trực tiếp: `POST /?database=khong_ton_tai` với `SELECT name FROM
 * system.databases` trả về 404. Nên hỏi bằng chính client đó thì câu trả lời
 * duy nhất nhận được là một lỗi, và ta lại phải đoán nghĩa của lỗi.
 *
 * `system` thì luôn tồn tại, kể cả trên một volume vừa khởi tạo. Ghim vào đó
 * cho ra một câu trả lời DỨT KHOÁT (`0` hoặc `1`) thay vì phải đọc mã lỗi hay
 * so khớp chuỗi thông báo — hai thứ đổi theo phiên bản ClickHouse.
 */
const systemWarehouse: ClickHouseClient = createClient({
  url: `http://${env.CLICKHOUSE_HOST}:${env.CLICKHOUSE_PORT}`,
  database: 'system',
  username: env.CLICKHOUSE_USER,
  password: env.CLICKHOUSE_PASSWORD,
});

export type WarehouseStatus =
  /** Nối được và database kho có mặt. */
  | 'ok'
  /** Không nối được tới máy chủ ClickHouse. */
  | 'unreachable'
  /** Máy chủ sống, nhưng database kho không tồn tại. */
  | 'missing-database';

/**
 * Kho phân tích đã SẴN SÀNG chưa — máy chủ VÀ database.
 *
 * ─── Vì sao `pingClickhouse()` một mình là chưa đủ ──────────────────────────
 *
 * `/ping` của ClickHouse trả "Ok." dựa trên máy chủ, KHÔNG dựa trên database
 * nào cả — đo trực tiếp: ping vẫn "Ok." trong lúc `bi_analytics` không tồn tại.
 * Nên lớp kiểm cũ xanh, request trả 201 "đã xếp hàng", rồi job nền chết với
 * `Database bi_analytics does not exist.` ở một chỗ người dùng phải tự đi tìm.
 *
 * Đó đúng là tình huống mà docblock của `pingClickhouse` nói nó được viết ra để
 * chặn — chỉ là sâu hơn một tầng. Chuyện này đã xảy ra thật: 10 lần nạp liên
 * tiếp hỏng cùng một câu, `rows_read = 0`, sau khi volume ClickHouse bị xoá.
 */
export async function checkWarehouse(): Promise<WarehouseStatus> {
  try {
    const ping = await systemWarehouse.ping();
    if (!ping.success) return 'unreachable';

    const rs = await systemWarehouse.query({
      // Tham số hoá chứ không ghép chuỗi. `CLICKHOUSE_DATABASE` đến từ `.env`
      // của người vận hành nên rủi ro thấp, nhưng đây vẫn là một tên đi vào câu
      // lệnh — và ngoại lệ cho "chỗ này an toàn" là cách luật đó mục dần.
      query: 'SELECT count() AS co FROM system.databases WHERE name = {db:String}',
      query_params: { db: env.CLICKHOUSE_DATABASE },
      format: 'JSONEachRow',
    });
    const rows = await rs.json<{ co: string }>();
    return Number(rows[0]?.co ?? 0) > 0 ? 'ok' : 'missing-database';
  } catch {
    // Ném ở đây nghĩa là không hỏi được máy chủ. Không phân biệt thêm: mọi
    // nhánh còn lại đều dẫn tới cùng một việc phải làm.
    return 'unreachable';
  }
}

/**
 * Tạo database của kho nếu chưa có — xem `scripts/initWarehouse.ts`.
 *
 * Chạy qua `systemWarehouse` chứ KHÔNG qua `warehouse`: client kia ghim vào
 * đúng cái database đang thiếu, nên mọi câu lệnh gửi qua nó — kể cả câu tạo ra
 * chính nó — đều bị ClickHouse từ chối trước khi đọc tới nội dung.
 *
 * `quoteIdent` chứ không nội suy trần: tên đến từ `.env`, và ngoại lệ cho "chỗ
 * này an toàn" là cách luật bọc định danh mục dần.
 */
export async function createWarehouseDatabase(): Promise<void> {
  await systemWarehouse.command({
    query: `CREATE DATABASE IF NOT EXISTS ${quoteIdent(env.CLICKHOUSE_DATABASE)}`,
  });
}

export async function closeClickhouse(): Promise<void> {
  await Promise.all([warehouse.close(), systemWarehouse.close()]);
}
