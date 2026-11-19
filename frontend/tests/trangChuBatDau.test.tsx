import type { HomeDataDto } from '@bi/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

/**
 * Trang chủ lần đầu — vá C1.
 *
 * ⚠️ Đo khi dùng hệ thống như người thật: trang chủ dành chỗ đẹp nhất cho hai
 * thẻ "Báo cáo: 0" và "Thành viên: 1", rồi ~50% màn hình còn lại để trắng. Hai
 * con số đó đúng, nhưng không trả lời câu duy nhất người vừa lập tổ chức đang
 * hỏi: giờ làm gì?
 *
 * Bộ này canh CẢ HAI chiều, vì sửa lệch một chiều là đổi một lỗi lấy một lỗi
 * khác: tổ chức mới thấy đường đi, còn tổ chức đã có báo cáo thì thấy lại thẻ
 * số — ở đó lời hướng dẫn mới là thứ chiếm chỗ vô ích.
 */

const HOME = (reports: number, datasets: number, datamodels: number): HomeDataDto => ({
  workspace: { id: 1, name: 'Mặc định' },
  reports: [],
  stats: { reports, members: 1, datasets, datamodels },
});

let duLieu: HomeDataDto | undefined;

vi.mock('../src/features/tenant/hooks', () => ({
  useHome: () => ({ data: duLieu, isPending: duLieu === undefined, isError: false, error: null }),
}));

vi.mock('../src/auth/useAuth', () => ({ useAuth: () => ({ user: { fullName: 'Chị Hà' } }) }));
vi.mock('../src/auth/usePermissions', () => ({
  usePermissions: () => ({ editContent: true, adminConsole: false }),
}));
vi.mock('../src/workspace/useWorkspace', () => ({
  useWorkspace: () => ({ current: { id: 1, name: 'Mặc định' }, isLoading: false }),
}));
vi.mock('../src/features/tenant/CreateReportMenu', () => ({
  CreateReportMenu: () => null,
}));

const HomePage = (await import('../src/pages/HomePage')).default;

function dung(data: HomeDataDto | undefined): void {
  duLieu = data;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('tổ chức chưa có báo cáo nào', () => {
  it('hiện ba bước thay vì hai thẻ số 0', () => {
    dung(HOME(0, 0, 0));

    expect(screen.getByText('Bắt đầu từ đây')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Tải dữ liệu lên/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Khai mô hình dữ liệu/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Dựng báo cáo đầu tiên/ })).toBeTruthy();
    // Thẻ số nhường chỗ: chúng nói đúng nhưng không nói điều người dùng cần.
    expect(screen.queryByText('Báo cáo trong workspace')).toBeNull();
  });

  it('bước đã làm xong được đánh dấu, và nói con số thật', () => {
    // Dấu đã-xong đọc từ số đếm THẬT, không từ một cờ "đã xem hướng dẫn": người
    // dùng có thể đã tải dữ liệu lên hôm trước, và bảo họ làm lại bước đó thì
    // tệ hơn là không có hướng dẫn.
    dung(HOME(0, 3, 0));

    const buoc1 = screen.getByRole('link', { name: /Tải dữ liệu lên/ });
    expect(buoc1.textContent).toContain('Đã có 3 bộ dữ liệu');
    expect(buoc1.textContent).toContain('(đã xong)');

    const buoc2 = screen.getByRole('link', { name: /Khai mô hình dữ liệu/ });
    expect(buoc2.textContent).not.toContain('(đã xong)');
  });
});

describe('tổ chức đã có báo cáo', () => {
  it('thẻ số quay lại, lời hướng dẫn biến mất', () => {
    dung(HOME(12, 5, 2));

    expect(screen.getByText('Báo cáo trong workspace')).toBeTruthy();
    expect(screen.queryByText('Bắt đầu từ đây')).toBeNull();
  });
});

describe('trong lúc còn đang tải', () => {
  it('KHÔNG nháy lời hướng dẫn ra rồi thay bằng thẻ số', () => {
    // Đoán `reports === 0` khi chưa có dữ liệu sẽ dựng lời hướng dẫn rồi thay
    // ngay — đúng kiểu nhấp nháy mà hai dấu gạch ngang ở `StatCard` vốn sinh ra
    // để tránh.
    dung(undefined);

    expect(screen.queryByText('Bắt đầu từ đây')).toBeNull();
    expect(screen.getByText('Báo cáo trong workspace')).toBeTruthy();
  });
});
