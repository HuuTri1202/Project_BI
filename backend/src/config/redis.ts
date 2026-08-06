import { Redis } from 'ioredis';
import { env } from './env';

/**
 * Redis dùng cho: cache quyết định phân quyền Casbin + cache metadata đọc từ
 * Strapi. KHÔNG dùng làm hàng đợi cho Cube.js (bản Cube hiện tại không còn cơ
 * chế đó).
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
