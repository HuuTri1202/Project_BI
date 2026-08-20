import { defineConfig } from 'vitest/config';

import { integrationTestOptions } from './vitest.integration.options';

/**
 * Test tích hợp + nhánh CHẠM ClickHouse thật.
 *
 *   npm --workspace backend run test:integration:ch
 *
 * Cần `npm run infra:up` đang chạy. Dùng database riêng `bi_analytics_test`
 * (xem `vitest.config.ts`) để không đụng dữ liệu dev.
 *
 * ─── Vì sao là một file config chứ không phải biến môi trường trước lệnh ────
 *
 * `INGEST_CH_TESTS=1 vitest run ...` chạy được trên bash nhưng KHÔNG chạy trên
 * Windows: npm gọi script qua `cmd.exe`, nơi cú pháp gán biến đứng trước lệnh
 * là một lỗi cú pháp. Máy phát triển chính của dự án chạy Windows, nên một lệnh
 * chỉ đúng ở một nửa số máy thì cũng như không có.
 *
 * Cách còn lại là thêm `cross-env`. Nhưng repo VỐN ĐÃ tiêm biến môi trường cho
 * test bằng trường `env` của vitest — xem `vitest.config.ts` — nên thêm một phụ
 * thuộc mới chỉ để đặt đúng một biến là đi vòng qua thứ đã có sẵn.
 *
 * ─── Vì sao đặt cờ ở CẢ HAI chỗ ─────────────────────────────────────────────
 *
 * `env` của vitest chỉ tới tiến trình chạy test, KHÔNG tới tiến trình đọc
 * config. File test đọc cờ nên cần `env`; còn `process.env` đặt ở đây là để
 * chính tiến trình này biết — hiện chưa ai đọc, nhưng để hai nơi khỏi lệch nhau
 * nếu sau này có thêm một phép kiểm ở tầng config.
 */
process.env['INGEST_CH_TESTS'] = '1';

export default defineConfig({
  test: {
    ...integrationTestOptions,
    env: { ...integrationTestOptions.env, INGEST_CH_TESTS: '1' },
  },
});
