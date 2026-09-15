import { LATE_PAYMENT_WINDOW_HOURS, type OrderDetailDto, type OrderStatus } from '@bi/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as api from '../src/features/billing/api';
import { orderStatusPollMs } from '../src/features/billing/hooks';
import { OrderDetailPage } from '../src/pages/tenant/billing/CheckoutPage';

/**
 * Tiền về SAU khi mã QR hết hạn — §11.2.
 *
 * ═══ Chuyện đã xảy ra ═══════════════════════════════════════════════════════
 *
 * Khách quét mã, chuyển 2.000đ. Tiền được ghi nhận khi đơn đã `expired` —
 * backend cố ý nhận tiền về muộn, gói bật đúng. Nhưng màn thanh toán đã NGỪNG
 * HỎI server từ lúc hết hạn, và đứng mãi ở câu "đơn đã đóng, hãy tạo đơn mới":
 * không bao giờ thấy "Thanh toán thành công", và được mời chuyển tiền lần hai.
 */

vi.mock('../src/features/billing/api', async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  fetchOrder: vi.fn(),
  fetchOrderStatus: vi.fn(),
}));

const HOUR = 3_600_000;

function donHetHan(expiresAt: string): OrderDetailDto {
  return {
    id: 3,
    orderCode: 'BI50BTJSV3K6',
    status: 'expired',
    amountVnd: 2000,
    planCode: 'business',
    planName: 'Doanh nghiệp',
    planDurationDays: 30,
    paymentMethodName: 'Chuyển khoản ngân hàng',
    provider: 'bank_transfer',
    expiresAt,
    paidAt: null,
    createdAt: new Date(Date.parse(expiresAt) - 15 * 60_000).toISOString(),
    qrPayload: '000201010212',
    staticQrUrl: null,
    bankBin: '970436',
    bankAccountNo: '1234567890',
    bankAccountName: 'CONG TY BI',
    instructions: null,
    note: null,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('bao lâu thì hỏi lại trạng thái đơn', () => {
  const now = Date.parse('2026-09-15T04:14:00.000Z');
  const dto = (status: OrderStatus, expiresAt: string): api.OrderStatusDto => ({
    orderCode: 'BI50BTJSV3K6',
    status,
    paidAt: null,
    expiresAt,
  });

  it('đơn đang chờ: 2 giây, như trước', () => {
    expect(orderStatusPollMs(dto('pending', '2026-09-15T04:20:00.000Z'), now)).toBe(2_000);
    expect(orderStatusPollMs(dto('awaiting_confirmation', '2026-09-15T04:00:00.000Z'), now)).toBe(
      2_000,
    );
  });

  it('đơn HẾT HẠN nhưng còn trong cửa sổ tiền về muộn: VẪN hỏi — đây là chỗ bản cũ dừng', () => {
    // Hết hạn 4 phút trước — đúng như đơn thật.
    expect(orderStatusPollMs(dto('expired', '2026-09-15T04:10:12.767Z'), now)).toBe(5_000);
  });

  it('có HẠN: quá cửa sổ thì thôi, đơn đã xong thì thôi', () => {
    const quaCuaSo = new Date(now - LATE_PAYMENT_WINDOW_HOURS * HOUR - 1).toISOString();
    expect(orderStatusPollMs(dto('expired', quaCuaSo), now)).toBe(false);
    expect(orderStatusPollMs(dto('paid', '2026-09-15T04:10:12.767Z'), now)).toBe(false);
    expect(orderStatusPollMs(dto('cancelled', '2026-09-15T04:10:12.767Z'), now)).toBe(false);
    expect(orderStatusPollMs(undefined, now)).toBe(false);
  });
});

describe('màn thanh toán của một đơn đã hết hạn', () => {
  function mo(): void {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/billing/orders/BI50BTJSV3K6']}>
          <Routes>
            <Route path="/billing/orders/:code" element={<OrderDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it('bảo người ĐÃ chuyển đừng chuyển lại, rồi TỰ sang "thành công" khi tiền về muộn', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const expiresAt = new Date(Date.now() - 4 * 60_000).toISOString();
    let trangThai: OrderStatus = 'expired';

    vi.mocked(api.fetchOrder).mockResolvedValue(donHetHan(expiresAt));
    vi.mocked(api.fetchOrderStatus).mockImplementation(() =>
      Promise.resolve({
        orderCode: 'BI50BTJSV3K6',
        status: trangThai,
        paidAt: null,
        expiresAt,
      }),
    );

    mo();

    expect(await screen.findByText(/đã hết hạn/)).toBeTruthy();
    expect(screen.getByText(/Đừng chuyển lại/)).toBeTruthy();
    // Câu cũ của nhánh "đã đóng" không được xuất hiện cho đơn này.
    expect(screen.queryByText(/Đơn đã quá hạn thanh toán/)).toBeNull();

    // Con quét sao kê ghi nhận khoản tiền về muộn.
    trangThai = 'paid';
    await act(() => vi.advanceTimersByTimeAsync(5_000));

    expect(await screen.findByText('Thanh toán thành công')).toBeTruthy();
  });

  it('quá cửa sổ tiền về muộn: đơn đã đóng thật, nói như cũ', async () => {
    const expiresAt = new Date(Date.now() - (LATE_PAYMENT_WINDOW_HOURS + 1) * HOUR).toISOString();
    vi.mocked(api.fetchOrder).mockResolvedValue(donHetHan(expiresAt));
    vi.mocked(api.fetchOrderStatus).mockResolvedValue({
      orderCode: 'BI50BTJSV3K6',
      status: 'expired',
      paidAt: null,
      expiresAt,
    });

    mo();

    expect(await screen.findByText(/Đơn đã quá hạn thanh toán/)).toBeTruthy();
    expect(screen.queryByText(/Đừng chuyển lại/)).toBeNull();
  });
});
