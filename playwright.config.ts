import { defineConfig, devices } from '@playwright/test';

/**
 * Kiểm thử trên TRÌNH DUYỆT THẬT — §Playwright.
 *
 *   npm run e2e           chạy ngầm (headless)
 *   npm run e2e:ui        mở bảng điều khiển để xem từng bước
 *
 * ═══ Nó bù vào chỗ nào, và KHÔNG làm lại chỗ nào ════════════════════════════
 *
 * Frontend đã có 873 ca React Testing Library chạy trên jsdom. ĐỪNG viết lại
 * chúng ở đây: một ca Playwright chậm hơn vài trăm lần và hỏng vì nhiều lý do
 * hơn. Chỗ duy nhất đáng dùng trình duyệt thật là những việc jsdom KHÔNG LÀM
 * ĐƯỢC:
 *
 *   - Vega-Lite vẽ thật (jsdom không có canvas/SVG layout; `chartSpec.test.ts`
 *     chỉ kiểm được *spec*, không kiểm được hình)
 *   - tải tệp qua Uppy lên S3 (cần XHR thật, multipart thật)
 *   - xuất PDF / Excel ra tệp thật
 *   - kéo thả trên canvas (hit-testing thật)
 *   - CHIA CHUNK: `React.lazy` có thật sự tách và tải được qua HTTP hay không
 *
 * ═══ Chạy trên DATABASE DEV, và đó là chủ đích ══════════════════════════════
 *
 * `webServer` dưới đây khởi động chính `npm run dev:api`, nên nó đọc
 * `backend/.env` và dùng database dev. Không trỏ sang `bi_platform_test` được:
 * tiến trình dev đọc `.env` chứ không đọc biến ta truyền vào đây.
 *
 * Hệ quả phải biết: ca nào GHI dữ liệu thì phải tự dọn, đúng như bộ kịch bản ở
 * `docs/kiem-thu/kich-ban/` vẫn làm. Và `workers: 1` — các ca dùng chung một
 * database nên chạy song song là xoá dữ liệu của nhau.
 */
export default defineConfig({
  testDir: './e2e',
  /** Dọn bộ đếm chặn dò mật khẩu — xem ghi chú trong tệp đó. */
  globalSetup: './e2e/global-setup.ts',
  // 30s: phải đủ cho lần biên dịch Cube nguội (đo được 2,7–4,5s) cộng một lần
  // tải trang đầu, nhưng không đủ lâu để một ca treo ngồi im cả phút.
  timeout: 30_000,
  expect: { timeout: 10_000 },

  fullyParallel: false,
  workers: 1,
  // Không `retries` ở máy dev: một ca xanh ở lần thử thứ hai là một ca KHÔNG ổn
  // định, và che nó đi thì lần sau không ai biết.
  retries: 0,
  forbidOnly: true,

  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: 'http://localhost:5173',
    // Vết chỉ lưu khi đỏ: nó nặng vài MB mỗi ca.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    locale: 'vi-VN',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: [
    {
      command: 'npm run dev:api',
      // `/health` chứ không `/api/...`: nó là endpoint DUY NHẤT không đòi token,
      // nên nó trả 200 thay vì 401 và `webServer` biết lúc nào server sẵn sàng.
      url: 'http://127.0.0.1:4000/health',
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: 'npm run dev:web',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
