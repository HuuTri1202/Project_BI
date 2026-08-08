import { mysqlPool } from '../../src/config/mysql';
import { redis } from '../../src/config/redis';

/**
 * Dọn sạch database test trước mỗi ca.
 *
 * Tắt kiểm tra khoá ngoại để không phải xoá đúng thứ tự phụ thuộc — CHỈ làm
 * được vì đây là database dùng riêng cho test (`bi_platform_test`), không bao
 * giờ chạy trên dữ liệu thật.
 */
export async function resetDatabase(): Promise<void> {
  await mysqlPool.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const table of ['projects', 'workspaces', 'memberships', 'users', 'tenants']) {
    await mysqlPool.query(`TRUNCATE TABLE ${table}`);
  }
  await mysqlPool.query('SET FOREIGN_KEY_CHECKS = 1');

  // Bộ đếm rate limit sống trong Redis với TTL tính bằng phút, KHÔNG tự mất khi
  // test kết thúc. Không xoá thì suite này (tạo tài khoản hàng chục lần từ cùng
  // một IP) tự đâm vào giới hạn của chính nó và mọi ca sau đều nhận 429 — một
  // kiểu đỏ hoàn toàn không liên quan tới thứ đang được kiểm.
  const keys = await redis.keys('ratelimit:*');
  if (keys.length > 0) await redis.del(...keys);
}
