import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

/**
 * jsdom KHÔNG có `ResizeObserver`.
 *
 * `ReportChart` ở chế độ vừa-khung (§10.13) dựng một cái để theo dõi ô của
 * mình, và thiếu nó thì mọi test render một ô của khung ném `ResizeObserver is
 * not defined` — một lỗi của MÔI TRƯỜNG, không phải của code.
 *
 * Bản giả này không bao giờ gọi callback, và đó là đúng: jsdom không tính bố
 * cục nên mọi phép đo ở đây đều ra 0. Component đã có nhánh cho chiều cao 0
 * (rơi về số mặc định), nên test đo được hành vi thật của nhánh đó.
 */
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

// jsdom giữ nguyên DOM giữa các test trong cùng một file; không dọn thì test sau
// tìm thấy hai element trùng nhãn và `getByLabelText` ném lỗi "found multiple".
afterEach(() => {
  cleanup();
});
