import { defineConfig } from 'vitest/config';

import { integrationTestOptions } from './vitest.integration.options';

/**
 * Test TÍCH HỢP — cần MySQL + Redis đang chạy.
 *
 * Chạy trên database RIÊNG `bi_platform_test` để một test hỏng không bao giờ để
 * lại rác trong dữ liệu dev. Database đó phải được migrate trước:
 *   $env:MYSQL_DATABASE='bi_platform_test'; npm --workspace backend run migrate
 *
 * Bản này BỎ QUA nhánh chạm ClickHouse thật. Chạy đầy đủ bằng
 * `vitest.integration.ch.config.ts` — xem cảnh báo ngay dưới.
 */

/**
 * Nói to lên rằng lần chạy này bỏ qua nhánh chạm ClickHouse thật.
 *
 * ─── Vì sao câu này tồn tại ─────────────────────────────────────────────────
 *
 * Nhánh ClickHouse của `ingest.integration.test.ts` nằm sau cờ
 * `INGEST_CH_TESTS`, và trong một thời gian dài không lệnh nào đặt cờ đó. Hệ
 * quả: 14 bài không bao giờ chạy, và hai trong số đó đã khẳng định NGƯỢC LẠI
 * thiết kế hiện tại suốt nhiều tháng mà không ai biết. Một bài test không chạy
 * thì không khác gì không tồn tại — chỉ tệ hơn ở chỗ nó tạo cảm giác đã được
 * phủ.
 *
 * ─── Vì sao ở ĐÂY chứ không ở trong file test ───────────────────────────────
 *
 * vitest chặn `console` của file test và chỉ nhả ra khi bài đó đỏ. Một
 * `console.warn` đặt trong file test sẽ không bao giờ tới mắt ai — đúng cái
 * bệnh nó sinh ra để chữa. File config chạy trong tiến trình chính nên nói
 * được.
 *
 * ─── Vì sao KHÔNG tự dò ClickHouse rồi lặng lẽ bỏ qua ───────────────────────
 *
 * Vì khi đó một lần chạy thiếu phần quan trọng nhất vẫn hiện màu xanh, và đó là
 * kiểu hỏng tệ hơn. Vấn đề chưa bao giờ nằm ở chỗ cổng tường minh, mà ở chỗ nó
 * im lặng.
 */
console.warn(
  '\n\x1b[33m⚠  BỎ QUA nhánh chạm ClickHouse thật\x1b[0m — nạp, nạp lại, hoán đổi\n' +
    '   nguyên tử, janitor dọn bảng mồ côi. Lần chạy này KHÔNG kiểm phần\n' +
    '   quan trọng nhất của §9.\n' +
    '   Chạy đầy đủ:  npm --workspace backend run test:integration:ch\n',
);

export default defineConfig({ test: integrationTestOptions });
