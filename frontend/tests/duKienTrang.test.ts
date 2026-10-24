import type {
  ConnectionDto,
  ExplorerResultDto,
  FolderDto,
  OrderDetailDto,
  PlanDto,
} from '@bi/shared';
import { describe, expect, it } from 'vitest';

import {
  duKienKhamPha,
  nguonTrinhDung,
  duKienMotDonHang,
  duKienMotKetNoi,
  duKienMuaGoi,
  duKienThanhVien,
  tongTheoThuMuc,
} from '../src/features/chat/duKienTrang';

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

/**
 * Con số đi kèm nhãn tuyệt đối phải LÀ con số tuyệt đối — §7.9, §10.25.
 *
 * ─── Lỗi đo được ───────────────────────────────────────────────────────────
 *
 * Trang Kho dữ liệu và trang Báo cáo MẶC ĐỊNH lọc theo thư mục Chung
 * (`DEFAULTS.folder`), nên `total` của danh sách chỉ là số mục chưa xếp thư
 * mục. Khai nó dưới nhãn "Số bộ dữ liệu trong workspace này" là sai ngay khi
 * người dùng vừa mở trang, không cần ai bấm gì — và sai bằng một con số có
 * thật, loại không ai bắt được bằng mắt.
 *
 * Mấy trang còn lại không có cột thư mục để cộng lại, nên ở đó con số giữ
 * nguyên và mang theo vế điều kiện.
 */
describe('phạm vi của con số tổng', () => {
  const thuMuc = (itemCount: number, id: number): FolderDto =>
    ({
      id,
      workspaceId: 1,
      name: `TM${String(id)}`,
      itemCount,
      createdAt: '',
      updatedAt: '',
    }) as FolderDto;

  it('tổng workspace = Chung + từng thư mục', () => {
    // "Chung" KHÔNG phải một thư mục và không nằm trong `items` — cộng thẳng
    // `items` là thiếu đúng phần thường lớn nhất.
    expect(tongTheoThuMuc(4, [thuMuc(5, 2), thuMuc(1, 3)])).toBe(10);
  });

  it('chưa có thư mục nào thì tổng chính là Chung', () => {
    expect(tongTheoThuMuc(7, [])).toBe(7);
  });

  it('danh sách KHÔNG lọc thì con số tổng đi một mình', () => {
    const d = duKienThanhVien([], 12).at(0)?.duKien.at(0);
    expect(d?.gia).toBe('12');
    expect(d?.luuY).toBeUndefined();
  });

  it('danh sách ĐANG lọc thì con số tổng mang vế điều kiện', () => {
    const d = duKienThanhVien([], 3, true).at(0)?.duKien.at(0);
    expect(d?.nhan).toBe('Số thành viên của tổ chức');
    expect(d?.gia).toBe('3');
    expect(d?.luuY).toContain('ĐANG LỌC');
  });
});

/**
 * Kết quả tab Khám phá — bảng số người dùng vừa bấm Chạy.
 *
 * ⚠️ Cả hai ca dưới đều canh chỗ mà một con số CÓ THẬT đọc ra thành kết luận
 * sai, chứ không canh chỗ tính nhầm:
 *
 *   - `truncated` mà không nói ra: "tổng doanh thu" tính trên phần bị cắt rồi
 *     đọc thành tổng của cả mô hình, sai cả nghìn lần bằng một con số thật.
 *   - Tên cột lấy `label` trơn: thước đo gieo sẵn trùng tên với cột nó gộp,
 *     nên "Total amount" vừa là tiền MỘT đơn vừa là tổng tiền cả nhóm.
 */
describe('duKienKhamPha', () => {
  const kq = (part: Partial<ExplorerResultDto> = {}): ExplorerResultDto => ({
    columns: [
      { id: 1, label: 'Khu vực', kind: 'dimension' },
      { id: 2, label: 'Total amount', kind: 'measure', mota: 'Tổng của Total amount' },
    ],
    rows: [
      ['Miền Bắc', 300],
      ['Miền Nam', 500],
    ],
    truncated: false,
    ...part,
  });

  it('chưa chạy gì, hoặc chạy ra 0 dòng, thì không có nguồn nào', () => {
    expect(duKienKhamPha(null)).toEqual([]);
    expect(duKienKhamPha(kq({ rows: [] }))).toEqual([]);
  });

  it('tên cột lấy từ `mota` khi có', () => {
    expect(duKienKhamPha(kq())[0]?.bangTho?.cot).toEqual(['Khu vực', 'Tổng của Total amount']);
  });

  it('kết quả bị cắt thì `luuY` phải NÓI RA là đã cắt', () => {
    const cat = duKienKhamPha(kq({ truncated: true }))[0]?.bangTho?.luuY ?? '';
    const du = duKienKhamPha(kq())[0]?.bangTho?.luuY ?? '';

    expect(cat).toContain('CẮT');
    expect(cat).toContain('chưa lấy hết');
    expect(du).not.toContain('CẮT');
  });

  it('khai cả số dòng và số cột để hỏi tra cứu được', () => {
    const d = duKienKhamPha(kq())[0]?.duKien ?? [];

    expect(d).toContainEqual({ nhan: 'Số dòng của kết quả Khám phá', gia: '2' });
    expect(d).toContainEqual({ nhan: 'Số cột của kết quả Khám phá', gia: '2' });
  });
});

/**
 * Nguồn của trình dựng — ô đang chọn phải MANG THEO dữ kiện của nó.
 *
 * ─── Lỗ hổng đo được ────────────────────────────────────────────────────────
 *
 * Ô đang chọn khai `duKien: []`, nên khung SỬA được số nhóm và chiều tách màu
 * mà hỏi ngược "ô này đang lấy mấy nhóm" thì chịu. Ghi được mà không đọc được.
 *
 * Bộ này canh phần NỐI, thứ mà `goiYBieuDo.test.ts` không với tới: bộ kia kiểm
 * `duKienODangChon` dựng đúng dữ kiện, nhưng một bản vá bỏ chúng ra khỏi mảng
 * nguồn vẫn để nó xanh y nguyên.
 */
describe('nguonTrinhDung', () => {
  const bang = {
    rows: [{ label: 'Miền Bắc', value: 300 }],
    dimensionLabel: 'Khu vực',
    measureLabel: 'Doanh thu',
    grouped: false,
  };
  const duKienO = [{ nhan: 'Số nhóm mỗi trang của ô X', gia: '20' }];

  /*
   * ⚠️ Thứ tự là một CHỐT, không phải thẩm mỹ. Backend chỉ lấy 60 nhãn đầu, mà
   * `duKienMoHinh` của một mô hình nhiều bảng đẩy ra hàng trăm nhãn — xếp ô
   * đang chọn xuống sau là nó bị cắt sạch trước khi mô hình kịp nhìn thấy.
   */
  it('ô đang chọn mang theo dữ kiện của nó, và đứng TRƯỚC cấu trúc mô hình', () => {
    const moHinh = {
      id: 1,
      name: 'Bán hàng',
      datasets: [],
      measures: [],
      relationships: [],
      creatorName: null,
    } as unknown as Parameters<typeof nguonTrinhDung>[3];
    const ds = nguonTrinhDung('Ô X', bang, duKienO, moHinh);

    expect(ds[0]?.ten).toBe('Ô X');
    expect(ds[0]?.duKien).toEqual(duKienO);
    expect(ds.length).toBeGreaterThan(1);
    expect(ds[1]?.ten).toBe('Mô hình Bán hàng');
  });

  it('chưa chọn ô nào thì không có nguồn ô', () => {
    expect(nguonTrinhDung(null, bang, duKienO, undefined)).toEqual([]);
    expect(nguonTrinhDung('Ô X', undefined, duKienO, undefined)).toEqual([]);
  });
});
