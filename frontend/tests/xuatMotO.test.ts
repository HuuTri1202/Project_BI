// @vitest-environment node
import type { ReportDataDto } from '@bi/shared';
import ExcelJS from 'exceljs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as chup from '../src/features/reports/export/chupBaoCao';
import { xuatMotO } from '../src/features/reports/export/xuatMotO';

/**
 * Xuất MỘT ô từ trình dựng — menu "⋮", §10.23.
 *
 * ═══ Ca này canh gì ═════════════════════════════════════════════════════════
 *
 * Tệp một biểu đồ nằm cạnh tệp cả báo cáo trong cùng một thư mục Downloads, và
 * người mở nó vài tuần sau không nhớ nó ra từ đâu. Nên ba điều phải đúng:
 *
 *   1. Tên tệp mang cả tên báo cáo lẫn tên biểu đồ.
 *   2. Tệp Excel nói rõ nó ra từ TRÌNH DỰNG — con số trong đó có thể chưa được
 *      lưu vào báo cáo, và không có cách nào tự biết điều đó khi mở tệp.
 *   3. Ảnh chụp ĐÚNG thẻ của ô, không phải cả khung.
 *
 * `LoiXuat` và `tenTepXuat` để nguyên bản thật: hai thứ đó chính là phần đang
 * được kiểm ở đây.
 */

vi.mock('../src/features/reports/export/chupBaoCao', async (importOriginal) => ({
  ...(await importOriginal<typeof chup>()),
  chupCacVung: vi.fn(),
  canvasSangPng: vi.fn(),
  canvasSangTrangPdf: vi.fn(),
  taiXuong: vi.fn(),
}));

const SO_LIEU: ReportDataDto = {
  rows: [
    { label: 'Bàn ghế', value: 742000.5 },
    { label: 'Công nghệ', value: 836154 },
  ],
  dimensionLabel: 'Nhóm hàng',
  measureLabel: 'Doanh thu',
  grouped: false,
} as ReportDataDto;

const CANVAS_GIA = { width: 10, height: 10 } as HTMLCanvasElement;

/**
 * Thẻ ô giả — `chupOSach` chỉ đụng vào `style` và thuộc tính `style`.
 *
 * Môi trường `node` (exceljs cần stream của Node) nên không có DOM thật. Việc
 * TẮT VÀNH rồi trả nguyên trạng cần một element thật mới kiểm được, nên nó nằm
 * ở `xuatMotOVien.test.ts`; ở đây thẻ giả chỉ cần không làm code ném.
 */
const EL = {
  style: {} as CSSStyleDeclaration,
  getAttribute: () => null,
  setAttribute: () => {},
  removeAttribute: () => {},
} as unknown as HTMLElement;

const daTai = (): [Blob, string] => {
  const c = vi.mocked(chup.taiXuong).mock.calls[0];
  if (c === undefined) throw new Error('chưa tải tệp nào');
  return c as [Blob, string];
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('Excel một biểu đồ', () => {
  it('một sheet số liệu + sheet Thông tin nói rõ tệp ra từ trình dựng', async () => {
    await xuatMotO({
      kieu: 'excel',
      el: EL,
      ten: 'Doanh thu theo nhóm',
      tenBaoCao: 'Báo cáo quý IV',
      data: SO_LIEU,
    });

    const [blob, ten] = daTai();
    expect(ten).toBe('Báo cáo quý IV - Doanh thu theo nhóm.xlsx');

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await blob.arrayBuffer());
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Doanh thu theo nhóm', 'Thông tin']);

    const ws = wb.worksheets[0]!;
    expect(ws.getCell('A1').value).toBe('Nhóm hàng');
    expect(ws.getCell('B2').value).toBe(742000.5);

    const dong: string[] = [];
    wb.getWorksheet('Thông tin')!.eachRow((r) => dong.push(r.values.slice(1).join(' | ')));
    expect(dong.some((d) => d.includes('trình dựng'))).toBe(true);
    expect(dong.some((d) => d.includes('Báo cáo quý IV'))).toBe(true);
  });

  it('báo cáo chưa đặt tên: tên tệp rơi về tên biểu đồ, không thành "- .xlsx"', async () => {
    await xuatMotO({
      kieu: 'excel',
      el: EL,
      ten: 'Doanh thu theo nhóm',
      tenBaoCao: '',
      data: SO_LIEU,
    });

    expect(daTai()[1]).toBe('Doanh thu theo nhóm.xlsx');
  });

  it('chưa có số liệu thì NÉM, không giao một tệp rỗng', async () => {
    await expect(
      xuatMotO({ kieu: 'excel', el: EL, ten: 'X', tenBaoCao: 'BC', data: undefined }),
    ).rejects.toThrow(/chưa vẽ xong/);
    expect(chup.taiXuong).not.toHaveBeenCalled();
  });
});

describe('PNG và PDF một biểu đồ', () => {
  it('chụp ĐÚNG thẻ của ô, và dải tiêu đề nói nó thuộc báo cáo nào', async () => {
    vi.mocked(chup.chupCacVung).mockResolvedValue({
      canvas: CANVAS_GIA,
      rongCss: 100,
      caoCss: 50,
    });
    vi.mocked(chup.canvasSangPng).mockResolvedValue(new Blob(['png']));

    await xuatMotO({
      kieu: 'png',
      el: EL,
      ten: 'Doanh thu theo nhóm',
      tenBaoCao: 'Báo cáo quý IV',
      data: SO_LIEU,
    });

    const [vungs, thongTin] = vi.mocked(chup.chupCacVung).mock.calls[0] ?? [];
    expect(vungs).toEqual([EL]);
    expect(thongTin?.tieuDe).toBe('Báo cáo quý IV');
    expect(thongTin?.phu).toMatch(/^Biểu đồ: Doanh thu theo nhóm · Xuất lúc /);
    expect(daTai()[1]).toBe('Báo cáo quý IV - Doanh thu theo nhóm.png');
  });

  it('PDF: một trang, đúng cỡ ảnh vừa chụp', async () => {
    vi.mocked(chup.chupCacVung).mockResolvedValue({
      canvas: CANVAS_GIA,
      rongCss: 100,
      caoCss: 50,
    });
    vi.mocked(chup.canvasSangTrangPdf).mockResolvedValue({
      rongPt: 75,
      caoPt: 37.5,
      anh: { rong: 1, cao: 1, duLieu: new Uint8Array([120, 156, 99, 0, 0, 0, 1, 0, 1]) },
    });

    await xuatMotO({ kieu: 'pdf', el: EL, ten: 'Biểu đồ', tenBaoCao: 'BC', data: SO_LIEU });

    const [blob, ten] = daTai();
    expect(ten).toBe('BC - Biểu đồ.pdf');
    expect(blob.type).toBe('application/pdf');
    const s = new TextDecoder('latin1').decode(await blob.arrayBuffer());
    expect(s).toContain('/Count 1');
  });

  it('không có thẻ của ô thì NÉM chứ không chụp bừa', async () => {
    await expect(
      xuatMotO({ kieu: 'png', el: null, ten: 'X', tenBaoCao: 'BC', data: SO_LIEU }),
    ).rejects.toThrow(chup.LoiXuat);
    expect(chup.chupCacVung).not.toHaveBeenCalled();
  });
});
