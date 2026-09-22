import { Redis } from 'ioredis';
import { env } from './env';

/**
 * Redis dùng cho ĐÚNG ba việc, và chỉ ba việc đó:
 *
 *   1. Đếm nhịp chống dò mật khẩu — `middleware/rateLimit.ts`. Phải nằm ngoài
 *      tiến trình vì nếu đếm trong RAM thì khởi động lại backend là bộ đếm về
 *      không, tức kẻ dò chỉ cần đợi một lần deploy.
 *   2. Cache kết quả phân tích tệp vừa tải lên — `services/dataset/analyze.ts`.
 *   3. Ping cho `/health/ready` — `api/health.ts`.
 *
 * ⚠️ KHÔNG dùng để cache quyết định phân quyền, dù README từng nói vậy.
 * `authz/enforcer.ts` giữ policy trong bộ nhớ tiến trình và tự giải thích vì sao
 * (phần đứng yên nằm trong RAM, phần biến động đọc tươi từ MySQL mỗi request).
 * Nó không import file này. Cũng không có "metadata Strapi" để cache: hệ thống
 * không có Strapi.
 *
 * KHÔNG dùng làm hàng đợi cho Cube.js (bản Cube hiện tại không còn cơ chế đó).
 */
export const redis = new Redis({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD,
  // Redis chết -> lệnh fail ngay thay vì xếp hàng chờ vô hạn. Nhờ vậy
  // /health/ready trả 503 tức thì thay vì treo cho tới khi request timeout.
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
  retryStrategy: (times) => Math.min(times * 200, 2000),
});

// ioredis phát sự kiện 'error'; không bắt thì Node coi là uncaught và giết process.
redis.on('error', (err: Error) => {
  console.error('[redis]', err.message);
});

/** Ping thật để dùng cho readiness probe. Ném lỗi nếu không kết nối được. */
export async function pingRedis(): Promise<void> {
  const reply = await redis.ping();
  if (reply !== 'PONG') {
    throw new Error(`Redis trả về '${reply}' thay vì PONG`);
  }
}

export async function closeRedis(): Promise<void> {
  await redis.quit();
}
