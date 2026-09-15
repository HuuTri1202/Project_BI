import type { TenantPlanDto } from '@bi/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as api from '../src/features/billing/api';
import { PlanBadge } from '../src/features/billing/PlanBadge';
import { CreateReportMenu } from '../src/features/tenant/CreateReportMenu';

/**
 * Gói của tổ chức trên giao diện — mọi thành viên thấy, và nút tạo báo cáo nói
 * trước khi đã hết lượt.
 *
 * `usePermissions` được giả lập thẳng: thứ đang kiểm là HAI nhánh của một cờ
 * (`manageBilling`), không phải cách bảng quyền được dựng — việc đó đã có bộ test
 * riêng.
 */

const quyen = vi.hoisted(() => ({ manageBilling: false }));

vi.mock('../src/auth/usePermissions', () => ({
  usePermissions: () => quyen,
}));

// Wizard nạp file đọc workspace đang mở; ở đây nó chỉ là cái hộp thoại đang
// ĐÓNG của nhánh "file", không phải thứ được kiểm.
vi.mock('../src/features/datasets/wizard/UploadWizard', () => ({
  UploadWizard: () => null,
}));

vi.mock('../src/features/billing/api', async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  fetchTenantPlan: vi.fn(),
}));

function goi(
  reports: { used: number; limit: number | null },
  overrides: Partial<TenantPlanDto> = {},
): TenantPlanDto {
  return {
    planCode: 'free',
    planName: 'Miễn phí',
    isPaid: false,
    periodEnd: null,
    usage: {
      workspaces: { used: 1, limit: 1 },
      reports,
      members: { used: 1, limit: 3 },
      storageBytes: { used: 0, limit: 104_857_600 },
    },
    ...overrides,
  };
}

function ve(ui: React.ReactElement): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.clearAllMocks();
  quyen.manageBilling = false;
});

describe('huy hiệu gói trên sidebar', () => {
  it('viewer của tổ chức trả phí THẤY gói — dưới dạng nhãn, không phải link', async () => {
    // Bản trước ẩn hẳn huy hiệu với người không quản lý thanh toán: gói Doanh
    // nghiệp quản trị viên mua trông như chỉ của riêng họ.
    vi.mocked(api.fetchTenantPlan).mockResolvedValue(
      goi(
        { used: 0, limit: null },
        { planCode: 'business', planName: 'Doanh nghiệp', isPaid: true },
      ),
    );
    ve(<PlanBadge />);

    const nhan = await screen.findByText('Doanh nghiệp');
    expect(nhan.tagName).toBe('SPAN');
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('quản trị viên bấm được huy hiệu để tới trang thanh toán', async () => {
    quyen.manageBilling = true;
    vi.mocked(api.fetchTenantPlan).mockResolvedValue(goi({ used: 0, limit: 3 }));
    ve(<PlanBadge />);

    const link = await screen.findByRole('link', { name: 'Miễn phí' });
    expect(link.getAttribute('href')).toBe('/billing');
  });
});

describe('nút Tạo báo cáo khi đã hết lượt', () => {
  it('còn chỗ thì mở hai lối tạo như thường', async () => {
    vi.mocked(api.fetchTenantPlan).mockResolvedValue(goi({ used: 2, limit: 3 }));
    ve(<CreateReportMenu />);
    await vi.waitFor(() => expect(api.fetchTenantPlan).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Tạo báo cáo' }));
    expect(await screen.findAllByRole('menuitem')).toHaveLength(2);
    expect(screen.queryByText('Đã hết lượt tạo báo cáo')).toBeNull();
  });

  it('đủ 3/3 thì nói ngay tại nút, không mời vào trình dựng', async () => {
    vi.mocked(api.fetchTenantPlan).mockResolvedValue(goi({ used: 3, limit: 3 }));
    ve(<CreateReportMenu />);
    await screen.findByRole('button', { name: 'Tạo báo cáo' });
    await vi.waitFor(() => expect(api.fetchTenantPlan).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Tạo báo cáo' }));
    const bao = await screen.findByRole('status');
    expect(bao.textContent).toContain('Đã hết lượt tạo báo cáo');
    expect(bao.textContent).toContain('Gói Miễn phí cho tối đa 3 báo cáo, tổ chức đang có 3.');
    expect(screen.queryAllByRole('menuitem')).toHaveLength(0);
    // Creator không mua được gói: không link, mà là lời nhắn đi nhờ quản trị viên.
    expect(screen.queryByRole('link', { name: 'Xem các gói' })).toBeNull();
    expect(bao.textContent).toContain('hãy nhờ họ nâng cấp');
  });

  it('quản trị viên có lối đi thẳng tới bảng gói', async () => {
    quyen.manageBilling = true;
    vi.mocked(api.fetchTenantPlan).mockResolvedValue(goi({ used: 3, limit: 3 }));
    ve(<CreateReportMenu datamodelId={9} />);
    await vi.waitFor(() => expect(api.fetchTenantPlan).toHaveBeenCalled());
    await screen.findByRole('button', { name: 'Tạo báo cáo' });

    // Nút trong trang mô hình vốn đi thẳng tới trình dựng — hết lượt thì dừng lại.
    await vi.waitFor(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Tạo báo cáo' }));
      expect(screen.getByRole('status')).toBeTruthy();
    });
    expect(screen.getByRole('link', { name: 'Xem các gói' }).getAttribute('href')).toBe(
      '/billing/plans',
    );
  });

  it('gói không giới hạn thì không bao giờ báo hết lượt', async () => {
    vi.mocked(api.fetchTenantPlan).mockResolvedValue(
      goi(
        { used: 500, limit: null },
        { planCode: 'business', planName: 'Doanh nghiệp', isPaid: true },
      ),
    );
    ve(<CreateReportMenu />);
    await vi.waitFor(() => expect(api.fetchTenantPlan).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Tạo báo cáo' }));
    expect(await screen.findAllByRole('menuitem')).toHaveLength(2);
  });
});
