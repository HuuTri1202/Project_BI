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

/**
 * `Element.prototype.scrollTo` — jsdom không cài đặt, và gọi nó thì NÉM LỖI.
 *
 * Cùng loại lỗ hổng với `ResizeObserver` và `<dialog>` ở trên: một API có thật
 * trong mọi trình duyệt, jsdom bỏ trống. Khung hỏi đáp cuộn xuống tin mới nhất
 * sau mỗi câu trả lời, nên thiếu bản vá này thì cả component nổ ngay lần render
 * thứ hai — và thông báo lỗi nói về `scrollTo`, không nói gì về jsdom.
 *
 * Vá ở ĐÂY chứ không `if` trong component: việc cuộn là hành vi thật của sản
 * phẩm, không phải thứ cần né vì môi trường test thiếu đồ.
 *
 * ⚠️ Hỏi `globalThis.Element?` chứ không gọi thẳng `Element`: file này chạy cho
 * CẢ những bộ test khai `@vitest-environment node` (axisLabels, xuatMotO…), và ở
 * đó không có `Element` nào — gọi thẳng là năm file chết ngay lúc nạp, với một
 * thông báo chẳng liên quan gì tới chúng. Cùng khuôn với bản vá `<dialog>` dưới.
 */
const elementProto = globalThis.Element?.prototype;
if (elementProto !== undefined && typeof elementProto.scrollTo !== 'function') {
  elementProto.scrollTo = function scrollTo(): void {
    // Không làm gì: jsdom không có bố cục nên không có gì để cuộn.
  };
}

// jsdom giữ nguyên DOM giữa các test trong cùng một file; không dọn thì test sau
// tìm thấy hai element trùng nhãn và `getByLabelText` ném lỗi "found multiple".
afterEach(() => {
  cleanup();
});
