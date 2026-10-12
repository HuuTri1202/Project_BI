import type { ConnectionDto, OrderDetailDto, PlanDto } from '@bi/shared';
import { describe, expect, it } from 'vitest';

import { duKienMotDonHang, duKienMotKetNoi, duKienMuaGoi } from '../src/features/chat/duKienTrang';

/**
 * Ba trang chỉ nói về MỘT thứ: sửa kết nối, mua gói, xem một đơn hàng.
 *
 * ═══ Bộ này canh gì ════════════════════════════════════════════════════════
 *
 * Trang nào khai dữ kiện thì dữ kiện đó đi lên mô hình ngôn ngữ của một hãng
 * thứ ba trong câu trả lời — xem `services/chat/dienDat.ts` bên backend. Nên ở
 * đây có đúng hai thứ đáng canh, và thứ hai quan trọng hơn hẳn:
 *
 *   1. Trang một thứ thì không khai phần tóm tắt của danh sách.
 *   2. Trang đơn hàng KHÔNG được khai số tài khoản nhận tiền, dù `OrderDetailDto`
 *      đang cầm sẵn nó.
 */

function ketNoi(part: Partial<ConnectionDto> = {}): ConnectionDto {
  return {
    id: 1,
    name: 'Kho MySQL nội bộ',
    kind: 'mysql',
    host: 'db.local',
    port: 3306,
    databaseName: 'erp',
    username: 'bi_reader',
    useSsl: false,
    visibility: 'shared',
    datasetCount: 4,
    createdAt: '2026-01-02T03:04:05.000Z',
    ...part,
  };
}

function goi(part: Partial<PlanDto> = {}): PlanDto {
  return {
    id: 1,
    code: 'pro',
    name: 'Pro',
    description: null,
    priceVnd: 299000,
    durationDays: 30,
    maxWorkspaces: 5,
    maxReports: 50,
    maxMembers: 10,
    maxStorageBytes: 1024 * 1024 * 1024,
    isActive: true,
    ...part,
  };
}

function don(part: Partial<OrderDetailDto> = {}): OrderDetailDto {
  return {
    id: 1,
    orderCode: 'OI-2026-0001',
    planName: 'Pro',
    amountVnd: 299000,
    status: 'pending',
    paymentMethodName: 'VietQR',
    paidAt: null,
    createdAt: '2026-01-02T03:04:05.000Z',
    qrPayload: '00020101021238570010A000000727012700069704220113VQRQADSBV12340208QRIBFTTA',
    staticQrUrl: null,
    bankBin: '970422',
    bankAccountNo: '0123456789',
    bankAccountName: 'CONG TY OPEN INSIGHT',
    instructions: null,
    note: null,
    ...part,
  };
}

describe('Trang chỉ nói về một thứ', () => {
  it('trang sửa kết nối khai đúng kết nối đó, không khai phần tóm tắt danh sách', () => {
    const n = duKienMotKetNoi(ketNoi());

    expect(n).toHaveLength(1);
    expect(n[0]?.ten).toBe('Kho MySQL nội bộ');
    // "Số kết nối đang có: 1" không trả lời cho ai cả, và nó còn tranh điểm
    // với dữ kiện thật trong `traLoi`.
    expect(n[0]?.duKien.some((d) => d.nhan.includes('Số kết nối đang có'))).toBe(false);
  });

  it('đang TẠO MỚI kết nối thì không khai gì', () => {
    // Form trống chưa nói được điều gì về dữ liệu. Khung tự ẩn.
    expect(duKienMotKetNoi(null)).toEqual([]);
  });

  /*
   * Chu kỳ KHÔNG nằm trong `PlanDto` — nó là nút người dùng vừa bấm trên bảng
   * giá, và nó quyết định số tiền sắp trả. Thiếu nó thì khung đọc giá tháng cho
   * một đơn đang mua theo năm.
   */
  it('màn mua gói nói ra chu kỳ người dùng vừa chọn', () => {
    const nam = duKienMuaGoi(goi(), 'yearly');
    const thang = duKienMuaGoi(goi(), 'monthly');

    expect(nam[0]?.duKien.find((d) => d.nhan === 'Đang mua theo chu kỳ nào')?.gia).toBe('theo năm');
    expect(thang[0]?.duKien.find((d) => d.nhan === 'Đang mua theo chu kỳ nào')?.gia).toBe(
      'theo tháng',
    );
  });

  it('chưa tải được gói thì không khai gì', () => {
    expect(duKienMuaGoi(undefined, 'monthly')).toEqual([]);
  });

  it('trang đơn hàng khai mã đơn, số tiền và trạng thái', () => {
    const n = duKienMotDonHang(don());

    expect(n).toHaveLength(1);
    expect(n[0]?.ten).toBe('Đơn OI-2026-0001');
    const gia = n[0]?.duKien.map((d) => d.gia).join(' | ') ?? '';
    expect(gia).toContain('299.000');
    expect(gia).toContain('chưa thanh toán');
  });

  /*
   * ⚠️ Ca quan trọng nhất của file này.
   *
   * `OrderDetailDto` cầm sẵn số tài khoản nhận tiền, mã ngân hàng, tên chủ tài
   * khoản, và cả chuỗi EMVCo của mã QR — chuỗi đó có SỐ TÀI KHOẢN NẰM BÊN
   * TRONG. Khai bất cứ cái nào trong bốn thứ đó là mở đường cho nó đi lên mô
   * hình ngôn ngữ của một hãng thứ ba trong một câu trả lời.
   */
  it('KHÔNG khai số tài khoản nhận tiền, dù DTO đang cầm sẵn', () => {
    const n = duKienMotDonHang(don());
    const tat = JSON.stringify(n);

    expect(tat).not.toContain('0123456789');
    expect(tat).not.toContain('970422');
    expect(tat).not.toContain('CONG TY OPEN INSIGHT');
    expect(tat).not.toContain('VQRQADSBV1234');
  });

  it('chưa tải được đơn thì không khai gì', () => {
    expect(duKienMotDonHang(undefined)).toEqual([]);
  });
});
