import { render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import VerifyEmailPage from '../src/pages/VerifyEmailPage';

/**
 * Trang xác minh email — §1.10.
 *
 * ═══ Ca thứ nhất là ca quan trọng nhất, và nó canh một lỗi THẬT ═════════════
 *
 * Vé xác minh là dùng-một-lần: lần gọi thứ hai luôn trả 410 "đã dùng rồi". Mà
 * React StrictMode chạy effect hai lần theo thiết kế (setup → cleanup → setup,
 * cùng một instance). Nghĩa là nếu trang này không tự chặn, thì ở bản dev MỌI
 * NGƯỜI XÁC MINH THÀNH CÔNG đều nhìn thấy một màn hình báo lỗi — và lỗi đó chỉ
 * xuất hiện ở dev, nơi không ai nghĩ là mình đang gặp bug thật.
 *
 * Bản đầu của trang này dùng một cờ `conHieuLuc` trong thân effect. Cờ đó KHÔNG
 * đủ: nó chỉ bỏ qua KẾT QUẢ của lần gọi thứ nhất, trong khi lần gọi thứ hai vẫn
 * được phát ra và vẫn đốt vé. Ca này đỏ với bản đó, xanh với `useRef`.
 *
 * ⚠️ Phải render trong `<StrictMode>` để tái hiện. Bỏ nó đi thì effect chỉ chạy
 * một lần và bài test xanh với cả bản hỏng.
 */
const goi = vi.hoisted(() => ({
  xacMinh: vi.fn<(token: string) => Promise<void>>(() => Promise.resolve()),
}));

vi.mock('../src/features/auth/api', () => ({
  xacMinhEmail: goi.xacMinh,
  guiLaiThuXacMinh: () => Promise.resolve(''),
}));

function mo(url: string): void {
  render(
    <StrictMode>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/xac-minh-email" element={<VerifyEmailPage />} />
          <Route path="/login" element={<p>TRANG DANG NHAP</p>} />
        </Routes>
      </MemoryRouter>
    </StrictMode>,
  );
}

describe('VerifyEmailPage', () => {
  afterEach(() => {
    goi.xacMinh.mockClear();
  });

  it('StrictMode chạy effect hai lần → vẫn chỉ gọi API ĐÚNG MỘT lần', () => {
    mo('/xac-minh-email?token=ve-hop-le');

    expect(goi.xacMinh).toHaveBeenCalledTimes(1);
    expect(goi.xacMinh).toHaveBeenCalledWith('ve-hop-le');
  });

  it('xác minh xong → hiện lời mời đăng nhập', async () => {
    mo('/xac-minh-email?token=ve-hop-le');

    /*
     * Tìm theo CHỮ, không theo `role="status"`.
     *
     * `FullPageLoader` cũng mang `role="status"` (cố ý — để trình đọc màn hình
     * biết đang chờ), nên `findByRole('status')` khớp ngay với màn hình chờ và
     * trả về trước khi state kịp đổi. Bản đầu của bài này đỏ đúng vì vậy, với
     * thông báo "nhận được: Đang xác minh email…" — một thông báo may mà nói rõ.
     */
    expect(await screen.findByText(/Email đã được xác minh/)).toBeInTheDocument();
    // Và nút đi tiếp phải có mặt: báo xác minh xong mà không chỉ đường đi đâu
    // thì người dùng mắc ở một màn hình không có việc gì làm.
    expect(screen.getByRole('link', { name: 'Đăng nhập' })).toBeInTheDocument();
  });

  it('thiếu vé trên URL → báo lỗi và KHÔNG gọi API', async () => {
    mo('/xac-minh-email');

    expect(await screen.findByRole('alert')).toHaveTextContent('thiếu mã xác minh');
    expect(goi.xacMinh).not.toHaveBeenCalled();
  });
});
