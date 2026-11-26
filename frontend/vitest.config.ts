import { defineConfig } from 'vitest/config';

/**
 * Config RIÊNG cho vitest, cố ý không dùng lại `vite.config.ts` — tệp đó khai
 * `server.proxy` và `strictPort`, thứ chỉ có nghĩa với dev server thật.
 *
 * ⚠️ `pool: 'vmThreads'` KHÔNG phải sở thích — hai pool mặc định đều chết.
 *
 * Trên Node 24 + vitest 4.1.10, cả `threads` lẫn `forks` ném ngay ở lời gọi
 * `describe()` đầu tiên:
 *
 *   TypeError: Cannot read properties of undefined (reading 'config')
 *
 * Kể cả với một tệp test một dòng, nên không phải lỗi của bài nào. Đã thử cả
 * ba pool: chỉ `vmThreads` gom và chạy được. Bộ đánh giá chỉ gọi hàm thuần nên
 * mấy hạn chế của `vmThreads` (global dùng chung, tốn bộ nhớ hơn) không chạm
 * tới nó. Nâng vitest thì thử bỏ dòng này trước.
 *
 * ⚠️ Ở đây CHỈ có thứ `danhGia` cần: bộ đánh giá gọi `traLoiKhung` và `duKien*`,
 * không dựng component nào, nên không cần jsdom, không cần plugin react, không
 * cần `setupFiles`. Khôi phục thêm bộ test dựng DOM thì mới thêm.
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    pool: 'vmThreads',
  },
});
