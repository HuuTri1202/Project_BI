import mysql from 'mysql2/promise';
import { env } from './env';

/**
 * Pool kết nối MySQL dùng chung toàn ứng dụng.
 *
 * MySQL ở đây là OLTP / metadata vận hành của Express (ingest job, casbin_rule,
 * audit log) — KHÔNG phải nơi chứa dữ liệu phân tích (đó là ClickHouse) và cũng
 * không phải nơi Express ghi metadata BI (đó là Strapi).
 */
export const mysqlPool = mysql.createPool({
  host: env.MYSQL_HOST,
  port: env.MYSQL_PORT,
  user: env.MYSQL_USER,
  password: env.MYSQL_PASSWORD,
  database: env.MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  // 'Z' = UTC. Mọi timestamp trong hệ thống đều là UTC, chỉ đổi múi giờ ở tầng
  // hiển thị. Trộn timezone ở tầng dữ liệu sinh bug lệch ngày rất khó tìm.
  timezone: 'Z',
});

/** Ping thật để dùng cho readiness probe. Ném lỗi nếu không kết nối được. */
export async function pingMysql(): Promise<void> {
  await mysqlPool.query('SELECT 1');
}

export async function closeMysql(): Promise<void> {
  await mysqlPool.end();
}
