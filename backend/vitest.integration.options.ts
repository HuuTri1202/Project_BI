import type { InlineConfig } from 'vitest/node';

import baseConfig from './vitest.config';

/**
 * Tuỳ chọn dùng chung cho hai config test tích hợp — bản thường và bản có bật
 * nhánh ClickHouse.
 *
 * ⚠️ Module này CỐ Ý không có tác dụng phụ: không in gì, không đặt biến môi
 * trường. Đó là lý do nó tồn tại như một file riêng thay vì nằm luôn trong
 * `vitest.integration.config.ts`.
 *
 * Config bản thường in một cảnh báo khi nhánh ClickHouse bị bỏ qua. Nếu bản CH
 * `import` thẳng file đó để dùng lại tuỳ chọn, câu cảnh báo sẽ chạy theo — và
 * lần chạy ĐẦY ĐỦ lại in ra đúng câu nói rằng mình đang bỏ sót. Một cảnh báo
 * sai còn tệ hơn không có cảnh báo, vì nó dạy người ta bỏ qua cảnh báo.
 *
 * CỐ Ý không dùng `mergeConfig`: nó NỐI các mảng lại, nên `exclude` của config
 * gốc (vốn loại trừ đúng những file này) vẫn còn nguyên và suite chạy ra 0 test
 * tích hợp mà vẫn báo xanh — kiểu hỏng tệ nhất. Ở đây ghi đè tường minh.
 */
const base = baseConfig.test ?? {};

export const integrationTestOptions: InlineConfig = {
  ...base,
  include: ['tests/**/*.integration.test.ts'],
  exclude: ['node_modules/**', 'dist/**'],
  env: { ...base.env, INTEGRATION_DB: '1' },
  /** Các test này cùng TRUNCATE chung một bộ bảng; chạy song song thì xoá dữ liệu của nhau. */
  fileParallelism: false,
  testTimeout: 20_000,
};
