import type { PoolConnection } from 'mysql2/promise';

import { mysqlPool } from '../config/mysql';

/**
 * Chạy `fn` trong một transaction, luôn trả connection về pool.
 *
 * `finally { conn.release() }` KHÔNG phải tuỳ chọn: pool giới hạn 10 connection,
 * nên chỉ cần rò một connection ở mỗi nhánh lỗi là sau 10 lần đăng ký thất bại
 * toàn bộ API đứng im, không log gì cả.
 *
 * Quy tắc đi kèm, áp dụng cho mọi hàm repository: NHẬN connection làm tham số
 * đầu tiên. Nếu repository tự gọi `mysqlPool.query(...)`, nó lấy một connection
 * KHÁC, nên câu lệnh đó chạy ngoài BEGIN/COMMIT của caller — ROLLBACK sẽ âm
 * thầm để lại dữ liệu mồ côi, và chuyện đó chỉ lộ ra ở nhánh lỗi mà không ai
 * test. Truyền connection làm cho sai lầm đó không viết ra được.
 */
export async function withTransaction<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await mysqlPool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
