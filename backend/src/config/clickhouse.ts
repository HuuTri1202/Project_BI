import { createClient, type ClickHouseClient } from '@clickhouse/client';
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

export async function closeClickhouse(): Promise<void> {
  await warehouse.close();
}
