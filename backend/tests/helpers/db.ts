import { mysqlPool } from '../../src/config/mysql';
import { redis } from '../../src/config/redis';
import { memoryStorage } from '../../src/storage/memoryStorage';

/**
 * Dọn sạch database test trước mỗi ca.
 *
 * Tắt kiểm tra khoá ngoại để không phải xoá đúng thứ tự phụ thuộc — CHỈ làm
 * được vì đây là database dùng riêng cho test (`bi_platform_test`), không bao
 * giờ chạy trên dữ liệu thật.
 */
export async function resetDatabase(): Promise<void> {
  await mysqlPool.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const table of [
    'reports',
    'dataset_rows',
    'dataset_columns',
    'datasets',
    'projects',
    'workspaces',
    'memberships',
    'users',
    'tenants',
  ]) {
    await mysqlPool.query(`TRUNCATE TABLE ${table}`);
  }
  await mysqlPool.query('SET FOREIGN_KEY_CHECKS = 1');

  // File "đã tải lên" của ca trước sống trong một Map ngoài database, nên
  // TRUNCATE không chạm tới. Không dọn thì một ca vẫn phân tích được file của ca
  // trước dù bản ghi dataset đã biến mất — và ca đó sẽ xanh vì lý do sai.
  memoryStorage.reset();

  // Hai loại khoá Redis sống lâu hơn một ca test và cả hai đều gây đỏ vì lý do
  // sai:
  //
  //   ratelimit:*        bộ đếm có TTL tính bằng phút. Suite này tạo tài khoản
  //                      hàng chục lần từ cùng một IP nên tự đâm vào giới hạn
  //                      của chính nó, và mọi ca sau nhận 429.
  //
  //   dataset:analyze:*  cache kết quả phân tích file, khoá theo `datasetId`.
  //                      TRUNCATE đặt lại AUTO_INCREMENT về 1, nên dataset số 1
  //                      của ca này TRÙNG khoá với dataset số 1 của ca trước —
  //                      và ca này sẽ thấy schema của một file nó chưa từng tải
  //                      lên. Kiểu đỏ tệ nhất: nó có thể XANH nhầm.
  const keys = await redis.keys('ratelimit:*');
  const analyzeKeys = await redis.keys('dataset:analyze:*');
  const all = [...keys, ...analyzeKeys];
  if (all.length > 0) await redis.del(...all);
}
