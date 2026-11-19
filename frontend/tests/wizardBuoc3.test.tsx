import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { StepProgress } from '../src/features/datasets/wizard/StepProgress';

/**
 * Bước 3 của wizard — vá C2.
 *
 * ⚠️ Lỗi đã đo khi dùng hệ thống như người thật: màn này báo "Dữ liệu đã được
 * nhập vào hệ thống" trong khi danh sách NGAY SAU ĐÓ ghi "Đang chờ". Hai màn
 * hình nói hai chuyện khác nhau về cùng một thứ, và người dùng không có cách
 * nào biết màn nào đúng.
 *
 * Lúc màn này hiện, `commit` vừa xong nhưng việc nạp vào kho phân tích chỉ mới
 * được XẾP HÀNG — `queueAutoLoad` chạy sau transaction và vòng lặp nạp là tiến
 * trình nền. Cách sửa không phải là giữ người dùng trong hộp thoại cho tới khi
 * nạp xong (50.000 dòng mất nhiều phút), mà là nói thật, và nói trước cái nhãn
 * họ sắp nhìn thấy.
 */
function dung(): void {
  render(
    <StepProgress
      progress={{ dataset: 'done', total: 1 }}
      error={null}
      onOpenDatasets={vi.fn()}
      onRetry={vi.fn()}
    />,
  );
}

describe('màn xong việc nói ĐÚNG việc đã xong', () => {
  it('KHÔNG hứa rằng dữ liệu đã nạp xong', () => {
    dung();
    expect(screen.queryByText(/Dữ liệu đã được nhập vào hệ thống/)).toBeNull();
  });

  it('nói trước cái nhãn người dùng sắp thấy trong danh sách', () => {
    dung();
    const than = document.body.textContent ?? '';
    expect(than).toContain('Đang chờ');
    expect(than).toContain('chạy nền');
  });

  it('vẫn khẳng định việc THẬT SỰ đã xong: bộ dữ liệu đã có', () => {
    dung();
    expect(screen.getByText('Đã tạo bộ dữ liệu thành công!')).toBeTruthy();
    expect(document.body.textContent).toContain('Kho dữ liệu');
  });
});
