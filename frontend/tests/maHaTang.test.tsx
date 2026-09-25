import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MaHaTang } from '../src/components/ui/MaHaTang';

/**
 * Nhãn mã hạ tầng — tên bảng ClickHouse và khoá đối tượng MinIO.
 *
 * ═══ Bộ này canh gì ═══════════════════════════════════════════════════════
 *
 * Nhãn này tồn tại để người ta DÁN được mã vào một chỗ khác: ô tìm kiếm của
 * MinIO, hoặc một câu SQL chạy thẳng vào kho. Nên hai điều phải đúng:
 *
 *   1. Chép ĐỦ chuỗi, kể cả khi trên màn hình nó bị cắt bớt cho vừa chỗ. Cắt ở
 *      lớp trình bày mà chép theo chuỗi đã cắt là cách tệ nhất để hỏng: người
 *      dùng dán vào MinIO, không thấy gì, và kết luận hệ thống mất tệp.
 *   2. Không ném ra ngoài khi trình duyệt từ chối clipboard. Quyền đó bị chặn
 *      trên HTTP thường và khi người dùng tự chặn — một Promise chưa bắt ở đây
 *      sẽ hiện ra console như một sự cố của hệ thống.
 */

const KHOA_MINIO = 't4/w1/9f8a2c1e-4d3b-4a77-9f01-446655440000.xlsx';

function ganClipboard(impl: () => Promise<void>): { writeText: ReturnType<typeof vi.fn> } {
  const writeText = vi.fn(impl);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
    writable: true,
  });
  return { writeText };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Nhãn mã hạ tầng', () => {
  it('chép ĐỦ chuỗi rồi báo "đã chép"', async () => {
    const { writeText } = ganClipboard(() => Promise.resolve());

    render(<MaHaTang ma={KHOA_MINIO} giaiThich="Tệp gốc trên MinIO, bucket bi-datasets" />);

    const nut = screen.getByRole('button');
    fireEvent.click(nut);

    // Chuỗi ĐẦY ĐỦ, không phải thứ đang hiện sau khi `truncate` cắt.
    expect(writeText).toHaveBeenCalledWith(KHOA_MINIO);
    await waitFor(() => {
      expect(screen.getByText('đã chép')).toBeTruthy();
    });
  });

  it('clipboard bị từ chối thì im lặng, không báo "đã chép"', async () => {
    ganClipboard(() => Promise.reject(new Error('NotAllowedError')));

    render(<MaHaTang ma="raw_t4_d197" giaiThich="Bảng trong kho phân tích ClickHouse" />);
    fireEvent.click(screen.getByRole('button'));

    // Chờ đủ một vòng microtask để nhánh `catch` chạy xong rồi mới khẳng định.
    await waitFor(() => {
      expect(screen.queryByText('đã chép')).toBeNull();
    });
    // Mã vẫn còn đó để bôi đen bằng chuột — chép hỏng không được làm mất nó.
    expect(screen.getByText('raw_t4_d197')).toBeTruthy();
  });

  it('câu giải thích đi vào cả `title` lẫn nhãn đọc màn hình, KÈM mã', () => {
    ganClipboard(() => Promise.resolve());
    const giaiThich = 'Tệp gốc trên MinIO, bucket bi-datasets';

    render(<MaHaTang ma={KHOA_MINIO} giaiThich={giaiThich} />);

    const nut = screen.getByRole('button');
    // `title` là cách duy nhất đọc được chuỗi đầy đủ khi nó bị cắt trên màn hình.
    expect(nut.getAttribute('title')).toContain(giaiThich);
    // Nhãn đọc màn hình phải mang CẢ mã: một cái nút chỉ đọc lên "Tệp gốc trên
    // MinIO" thì người dùng bàn phím không biết mình sắp chép cái gì.
    expect(nut.getAttribute('aria-label')).toContain(KHOA_MINIO);
  });
});
