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

/**
 * jsdom có thẻ `<dialog>` nhưng KHÔNG có `showModal()`.
 *
 * `components/ui/Modal` dựng trên thẻ gốc của trình duyệt, đúng như chú thích
 * trong đó giải thích. jsdom mới cài phần DOM chứ chưa cài lớp phủ và bẫy tiêu
 * điểm, nên `showModal` vắng mặt và mọi test render một hộp thoại ném
 * "showModal is not a function" — lại là lỗi của MÔI TRƯỜNG.
 *
 * Bản giả này chỉ bật/tắt thuộc tính `open` và phát sự kiện `close` — đủ cho
 * thứ test hỏi: hộp thoại có mở không, có nội dung gì, bấm Huỷ có đóng không.
 * Nó KHÔNG giả bẫy tiêu điểm hay `inert`; những thứ đó là việc của trình duyệt
 * và được kiểm trên Chromium.
 */
const dialogProto = globalThis.HTMLDialogElement?.prototype;
if (dialogProto !== undefined && typeof dialogProto.showModal !== 'function') {
  dialogProto.showModal = function showModal(this: HTMLDialogElement): void {
    this.open = true;
  };
  dialogProto.close = function close(this: HTMLDialogElement): void {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
}

// jsdom giữ nguyên DOM giữa các test trong cùng một file; không dọn thì test sau
// tìm thấy hai element trùng nhãn và `getByLabelText` ném lỗi "found multiple".
afterEach(() => {
  cleanup();
});
