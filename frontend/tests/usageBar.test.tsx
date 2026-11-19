import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { UsageBar } from '../src/features/billing/UsageBar';

/**
 * Thanh mức sử dụng — §11.
 *
 * ⚠️ Lỗi đã đo trên hệ thống đang chạy, và đó là lý do tệp này tồn tại: một tổ
 * chức VỪA LẬP ở gói Miễn phí có đúng 1 workspace trên hạn mức 1, và màn Gói
 * dịch vụ hiện một dòng ĐỎ "Đã vượt hạn mức của gói" ngay ngày đầu. Điều kiện
 * cũ là `percent >= 100`, nên chạm trần và vượt trần nói chung một câu.
 *
 * Chạm trần là trạng thái BÌNH THƯỜNG của gói Miễn phí — nó chính là thứ người
 * dùng mua gói để thoát ra. Vượt trần mới là chuyện bất thường (hạ gói, hoặc
 * dữ liệu có trước khi hạn mức đổi).
 */
describe('UsageBar — chạm trần khác vượt trần', () => {
  it('dưới hạn mức thì không có câu cảnh báo nào', () => {
    render(<UsageBar label="Báo cáo" item={{ used: 1, limit: 3 }} />);
    expect(screen.queryByText(/vượt hạn mức/i)).toBeNull();
    expect(screen.queryByText(/dùng hết hạn mức/i)).toBeNull();
  });

  it('ĐÚNG bằng hạn mức: nói đã dùng hết, KHÔNG nói đã vượt', () => {
    render(<UsageBar label="Workspace" item={{ used: 1, limit: 1 }} />);
    expect(screen.getByText(/Đã dùng hết hạn mức của gói/)).toBeTruthy();
    expect(screen.queryByText(/Đã vượt hạn mức/)).toBeNull();
  });

  it('thật sự vượt thì mới nói vượt', () => {
    render(<UsageBar label="Thành viên" item={{ used: 5, limit: 3 }} />);
    expect(screen.getByText(/Đã vượt hạn mức của gói/)).toBeTruthy();
    expect(screen.queryByText(/dùng hết hạn mức/)).toBeNull();
  });

  it('gói không giới hạn thì không có câu nào, kể cả khi dùng nhiều', () => {
    render(<UsageBar label="Báo cáo" item={{ used: 9999, limit: null }} />);
    expect(screen.queryByText(/hạn mức/i)).toBeNull();
  });
});
