import { defineConfig } from 'vitest/config';

import baseConfig from './vitest.config';

/**
 * Test TÍCH HỢP — cần MySQL + Redis đang chạy.
 *
 * Chạy trên database RIÊNG `bi_platform_test` để một test hỏng không bao giờ để
 * lại rác trong dữ liệu dev. Database đó phải được migrate trước:
 *   $env:MYSQL_DATABASE='bi_platform_test'; npm --workspace backend run migrate
 *
 * CỐ Ý không dùng `mergeConfig`: nó NỐI các mảng lại với nhau, nên `exclude` của
 * config gốc (vốn loại trừ đúng những file này) vẫn còn nguyên và suite chạy ra
 * 0 test tích hợp mà vẫn báo xanh — kiểu hỏng tệ nhất. Ở đây ghi đè tường minh.
 *
 * `fileParallelism: false`: các test này cùng TRUNCATE chung một bộ bảng, chạy
 * song song thì chúng xoá dữ liệu của nhau.
 */
const base = baseConfig.test ?? {};

export default defineConfig({
  test: {
    ...base,
    include: ['tests/**/*.integration.test.ts'],
    exclude: ['node_modules/**', 'dist/**'],
    env: { ...base.env, INTEGRATION_DB: '1' },
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
