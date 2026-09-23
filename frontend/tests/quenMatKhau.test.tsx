import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ForgotPasswordPage from '../src/pages/ForgotPasswordPage';
import ResetPasswordPage from '../src/pages/ResetPasswordPage';

/**
 * Hai màn hình của luồng quên mật khẩu.
 *
 * ═══ Ca này canh gì ═════════════════════════════════════════════════════════
 *
 * Backend cố ý trả CÙNG một câu cho email có thật và email không tồn tại, để
 * endpoint xin liên kết không thành máy dò xem ai có tài khoản. Lời hứa đó rất
 * dễ bị giao diện phá mà không ai nhận ra: chỉ cần một ngày nào đó ai đó thấy
 * câu "Nếu email này có tài khoản…" mơ hồ quá và sửa thành "Đã gửi thư tới
 * {email}" cho thân thiện — thế là frontend khẳng định hộ backend đúng cái điều
 * backend vừa cẩn thận không nói.
 *
 * Nên bài đầu tiên khoá lại: màn hình hiện ĐÚNG câu backend trả về, và KHÔNG
 * nhắc lại địa chỉ email.
 *
 * Phần còn lại canh trang đặt mật khẩu: vé hỏng thì không dựng form (người dùng
 * không gõ mật khẩu vào một liên kết chết), và vé tốt thì gửi đúng thứ cần gửi.
 */

const api = vi.hoisted(() => ({
  xinLienKetDatLai: vi.fn(),
  kiemLienKetDatLai: vi.fn(),
  datLaiMatKhau: vi.fn(),
}));

vi.mock('../src/features/auth/api', () => api);

const CAU_CUA_BACKEND =
  'Nếu email này có tài khoản, chúng tôi vừa gửi hướng dẫn đặt lại mật khẩu. Kiểm tra cả hộp thư rác.';

beforeEach(() => {
  vi.clearAllMocks();
});

function moTrangXin(): void {
  render(
    <MemoryRouter>
      <ForgotPasswordPage />
    </MemoryRouter>,
  );
}

/** Trang đặt lại + một trang /login giả để bắt được lần điều hướng cuối. */
function moTrangDat(token: string): void {
  render(
    <MemoryRouter initialEntries={[`/dat-lai-mat-khau?token=${encodeURIComponent(token)}`]}>
      <Routes>
        <Route path="/dat-lai-mat-khau" element={<ResetPasswordPage />} />
        <Route path="/login" element={<p>TRANG ĐĂNG NHẬP</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Trang xin liên kết đặt lại', () => {
  it('hiện đúng câu của backend, và KHÔNG nhắc lại email vừa nhập', async () => {
    api.xinLienKetDatLai.mockResolvedValue(CAU_CUA_BACKEND);
    moTrangXin();

    await userEvent.type(screen.getByLabelText('Email'), 'ai-do@congty.test');
    await userEvent.click(screen.getByRole('button', { name: 'Gửi liên kết đặt lại' }));

    const bang = await screen.findByRole('status');
    expect(bang).toHaveTextContent(CAU_CUA_BACKEND);
    // Đây là phần quan trọng: nhắc lại địa chỉ là xác nhận nó có tồn tại.
    expect(bang.textContent).not.toContain('ai-do@congty.test');
  });

  it('email sai định dạng thì chặn tại chỗ, không gọi API', async () => {
    moTrangXin();

    await userEvent.type(screen.getByLabelText('Email'), 'khong-phai-email');
    await userEvent.click(screen.getByRole('button', { name: 'Gửi liên kết đặt lại' }));

    expect(api.xinLienKetDatLai).not.toHaveBeenCalled();
  });

  it('cắt khoảng trắng trước khi gửi', async () => {
    api.xinLienKetDatLai.mockResolvedValue(CAU_CUA_BACKEND);
    moTrangXin();

    await userEvent.type(screen.getByLabelText('Email'), '  ai-do@congty.test  ');
    await userEvent.click(screen.getByRole('button', { name: 'Gửi liên kết đặt lại' }));

    await waitFor(() => expect(api.xinLienKetDatLai).toHaveBeenCalledWith('ai-do@congty.test'));
  });

  it('bấm "Gửi lại" đưa form quay lại để sửa email gõ nhầm', async () => {
    api.xinLienKetDatLai.mockResolvedValue(CAU_CUA_BACKEND);
    moTrangXin();

    await userEvent.type(screen.getByLabelText('Email'), 'ai-do@congty.test');
    await userEvent.click(screen.getByRole('button', { name: 'Gửi liên kết đặt lại' }));
    await screen.findByRole('status');

    await userEvent.click(screen.getByRole('button', { name: 'Gửi lại' }));
    expect(screen.getByRole('button', { name: 'Gửi liên kết đặt lại' })).toBeInTheDocument();
  });
});

describe('Trang đặt mật khẩu mới', () => {
  it('vé hỏng: KHÔNG dựng form, và chỉ đường đi tiếp', async () => {
    api.kiemLienKetDatLai.mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 410,
        data: { error: 'ResetTokenExpired', message: 'Liên kết đã hết hạn.' },
      },
    });
    moTrangDat('ve-het-han');

    expect(await screen.findByRole('alert')).toHaveTextContent('Liên kết đã hết hạn.');
    expect(screen.queryByLabelText('Mật khẩu mới')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Xin liên kết mới' })).toBeInTheDocument();
  });

  it('URL thiếu token: báo ngay, KHÔNG gọi API', async () => {
    render(
      <MemoryRouter initialEntries={['/dat-lai-mat-khau']}>
        <Routes>
          <Route path="/dat-lai-mat-khau" element={<ResetPasswordPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('thiếu mã đặt lại mật khẩu');
    expect(api.kiemLienKetDatLai).not.toHaveBeenCalled();
  });

  it('vé tốt: kiểm trước khi dựng form, rồi gửi đúng vé và mật khẩu', async () => {
    api.kiemLienKetDatLai.mockResolvedValue(undefined);
    api.datLaiMatKhau.mockResolvedValue(undefined);
    moTrangDat('ve-tot-123');

    await waitFor(() => expect(api.kiemLienKetDatLai).toHaveBeenCalledWith('ve-tot-123'));

    await userEvent.type(await screen.findByLabelText('Mật khẩu mới'), 'MatkhauMoi123');
    await userEvent.type(screen.getByLabelText('Nhập lại mật khẩu mới'), 'MatkhauMoi123');
    await userEvent.click(screen.getByRole('button', { name: 'Đặt mật khẩu mới' }));

    await waitFor(() =>
      expect(api.datLaiMatKhau).toHaveBeenCalledWith('ve-tot-123', 'MatkhauMoi123'),
    );
    // Xong thì về trang đăng nhập — CỐ Ý không tự đăng nhập.
    expect(await screen.findByText('TRANG ĐĂNG NHẬP')).toBeInTheDocument();
  });

  it('nhập lại lệch: chặn tại chỗ, không gửi lên server', async () => {
    api.kiemLienKetDatLai.mockResolvedValue(undefined);
    moTrangDat('ve-tot-123');

    await userEvent.type(await screen.findByLabelText('Mật khẩu mới'), 'MatkhauMoi123');
    await userEvent.type(screen.getByLabelText('Nhập lại mật khẩu mới'), 'LechHoanToan789');
    await userEvent.click(screen.getByRole('button', { name: 'Đặt mật khẩu mới' }));

    expect(screen.getByText('Mật khẩu nhập lại không khớp')).toBeInTheDocument();
    expect(api.datLaiMatKhau).not.toHaveBeenCalled();
  });

  it('mật khẩu mới quá yếu: chặn tại chỗ, không gửi lên server', async () => {
    api.kiemLienKetDatLai.mockResolvedValue(undefined);
    moTrangDat('ve-tot-123');

    await userEvent.type(await screen.findByLabelText('Mật khẩu mới'), 'abc');
    await userEvent.type(screen.getByLabelText('Nhập lại mật khẩu mới'), 'abc');
    await userEvent.click(screen.getByRole('button', { name: 'Đặt mật khẩu mới' }));

    expect(api.datLaiMatKhau).not.toHaveBeenCalled();
  });

  it('vé chết đúng lúc bấm nút: hiện lỗi của server, không im lặng', async () => {
    api.kiemLienKetDatLai.mockResolvedValue(undefined);
    api.datLaiMatKhau.mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 410,
        data: { error: 'ResetTokenUsed', message: 'Liên kết này đã được dùng rồi.' },
      },
    });
    moTrangDat('ve-tot-123');

    await userEvent.type(await screen.findByLabelText('Mật khẩu mới'), 'MatkhauMoi123');
    await userEvent.type(screen.getByLabelText('Nhập lại mật khẩu mới'), 'MatkhauMoi123');
    await userEvent.click(screen.getByRole('button', { name: 'Đặt mật khẩu mới' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('đã được dùng rồi');
    expect(screen.queryByText('TRANG ĐĂNG NHẬP')).not.toBeInTheDocument();
  });
});
