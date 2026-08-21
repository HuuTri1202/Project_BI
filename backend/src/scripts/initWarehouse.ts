import { checkWarehouse, closeClickhouse, createWarehouseDatabase } from '../config/clickhouse';
import { env } from '../config/env';

/**
 * Tạo database của kho phân tích nếu nó chưa có.
 *
 * ═══ Vì sao việc này cần một script riêng ═══════════════════════════════════
 *
 * Container ClickHouse tạo database từ biến `CLICKHOUSE_DB` CHỈ ở lần khởi tạo
 * volume ĐẦU TIÊN. Volume đã tồn tại thì biến đó không làm gì cả. Nên có đúng
 * một tình huống rất dễ rơi vào mà không có đường ra:
 *
 *   docker compose down -v      xoá volume -> mất sạch database và bảng
 *   docker compose up           volume mới, nhưng lần khởi tạo này KHÔNG
 *                               chắc chạy lại phần tạo database
 *   tải file lên                `/ping` trả "Ok." nên mọi lớp kiểm đều xanh
 *   nạp vào kho                 `Database bi_analytics does not exist.`
 *
 * Chuyện này đã xảy ra thật: 10 lần nạp liên tiếp hỏng cùng một câu, `rows_read
 * = 0`. Không có script này thì cách sửa duy nhất là gõ tay một câu SQL vào
 * container — thứ chỉ người đã đọc mã nguồn mới nghĩ ra.
 *
 * ⚠️ Script này KHÔNG dựng lại bảng và KHÔNG lấy lại dữ liệu. Bảng `raw_*` chỉ
 * ra đời khi nạp, nên sau khi chạy xong vẫn phải nạp lại từng bộ dữ liệu. Nói
 * thẳng ra ở phần in kết quả, vì "xong" mà không kèm câu đó sẽ được đọc thành
 * "dữ liệu đã về".
 */

async function main(): Promise<boolean> {
  const db = env.CLICKHOUSE_DATABASE;

  const before = await checkWarehouse();
  if (before === 'unreachable') {
    console.error(
      '[warehouse] không nối được tới ClickHouse. Hãy chạy "npm run infra:up" trước.',
    );
    return false;
  }

  // Chạy lại KHÔNG làm gì thêm, đúng khuôn `migrate`: một lệnh sửa lỗi mà chạy
  // hai lần lại hỏng là một lệnh không ai dám chạy.
  if (before === 'ok') {
    console.log(`[warehouse] database "${db}" đã có sẵn, không phải làm gì.`);
    return true;
  }

  await createWarehouseDatabase();

  console.log(`[warehouse] đã tạo database "${db}".`);
  console.log(
    '[warehouse] ⚠️ Bảng dữ liệu KHÔNG được dựng lại — hãy vào Kho dữ liệu và nạp lại ' +
      'từng bộ dữ liệu.',
  );
  return true;
}

main()
  .then(async (ok) => {
    await closeClickhouse();
    process.exit(ok ? 0 : 1);
  })
  .catch(async (err: unknown) => {
    console.error('[warehouse] thất bại:', err);
    await closeClickhouse();
    process.exit(1);
  });
