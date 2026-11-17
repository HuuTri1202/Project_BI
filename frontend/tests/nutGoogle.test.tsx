import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NutGoogle } from '../src/features/auth/NutGoogle';

/**
 * Nút đăng nhập Google — §1.9.
 *
 * ═══ Ca này canh gì ════════════════════════════════════════════════════════
 *
 * Tính năng này TUỲ CHỌN: không khai `VITE_GOOGLE_CLIENT_ID` thì nút phải biến
 * mất hẳn khỏi giao diện, không để lại một nút bấm vào là báo lỗi. Người tự
 * dựng dự án mà chưa xin client ID vẫn phải thấy một trang đăng nhập hoàn
 * chỉnh — cùng luật mà khung hỏi đáp áp cho lớp mô hình ngôn ngữ.
 *
 * ⚠️ Ca thứ hai quan trọng hơn ca thứ nhất: nó khẳng định rằng khi tắt, thành
 * phần này KHÔNG chạm tới mạng. Thiếu nó thì một bản sửa "cứ tải thư viện cho
 * sẵn" vẫn xanh, trong khi mọi người mở trang đăng nhập đều lẳng lặng gọi ra
 * một tên miền của Google.
 */
describe('NutGoogle', () => {
  /*
   * ⚠️ PHẢI tự đặt biến môi trường, KHÔNG được dựa vào `.env` của máy đang chạy.
   *
   * Bản đầu của hai ca dưới đây không `stubEnv` gì cả — chúng xanh vì lúc viết,
   * `frontend/.env` chưa có `VITE_GOOGLE_CLIENT_ID`. Nghĩa là chúng khẳng định
   * "chưa cấu hình thì không hiện gì" bằng cách NHỜ máy của người chạy tình cờ
   * chưa cấu hình.
   *
   * Và chúng đỏ ngay khi ai đó cấu hình tính năng này — tức đỏ đúng với người
   * đang dùng nó, vì một lý do chẳng liên quan gì tới code. Vite nạp `.env` cho
   * cả lần chạy test, nên `import.meta.env` trong test là `.env` của máy đó.
   *
   * `stubEnv(…, undefined)` xoá hẳn khoá khỏi `import.meta.env`, đúng trạng thái
   * "chưa khai" mà hai ca này muốn nói tới — khác với chuỗi rỗng ở ca thứ ba.
   */
  beforeEach(() => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    document.head.querySelectorAll('script[src*="gsi/client"]').forEach((el) => {
      el.remove();
    });
  });

  it('chưa cấu hình client ID → không hiện gì cả', () => {
    const { container } = render(<NutGoogle onCredential={() => Promise.resolve()} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('chưa cấu hình thì KHÔNG tải thư viện của Google', () => {
    render(<NutGoogle onCredential={() => Promise.resolve()} />);

    expect(document.head.querySelector('script[src*="gsi/client"]')).toBeNull();
  });

  it('client ID rỗng cũng tính là chưa cấu hình', () => {
    // `.env` để trống một biến là chuyện rất hay gặp, và chuỗi rỗng không phải
    // `undefined` — không xử lý riêng thì GSI nhận `client_id: ''` rồi hỏng
    // bằng một lỗi chỉ hiện trong console.
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '');

    const { container } = render(<NutGoogle onCredential={() => Promise.resolve()} />);

    expect(container).toBeEmptyDOMElement();
    expect(document.head.querySelector('script[src*="gsi/client"]')).toBeNull();
  });
});
