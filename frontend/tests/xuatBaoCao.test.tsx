import type { ReportCanvasDataDto, ReportDto, ReportPageDto } from '@bi/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as datasetsApi from '../src/features/datasets/api';
import * as chup from '../src/features/reports/export/chupBaoCao';
import { XuatBaoCao } from '../src/features/reports/export/XuatBaoCao';

/**
 * Nút "Xuất" — chụp ĐÚNG thứ gì, cho trang nào, và tải về tên gì.
 *
 * Việc chụp thật (`modern-screenshot`, `canvas`) được giả lập: jsdom không vẽ
 * được gì, và phần đó đã được kiểm trên Chromium. Thứ kiểm ở đây là quyết định
 * của component: trang đang xem chụp từ màn hình, các trang khác dựng ngoài màn
 * hình bằng đúng số liệu của trang đó, và lỗi thì nói ra thay vì tải về một tệp
 * thiếu trang.
 */

vi.mock('../src/features/reports/export/chupBaoCao', async (importOriginal) => ({
  ...(await importOriginal<typeof chup>()),
  chupVung: vi.fn(),
  canvasSangPng: vi.fn(),
  canvasSangTrangPdf: vi.fn(),
  taiXuong: vi.fn(),
}));

vi.mock('../src/features/datasets/api', () => ({
  fetchReportCanvasData: vi.fn(),
  fetchReportData: vi.fn(() => new Promise(() => {})),
  fetchReportVisualData: vi.fn(() => new Promise(() => {})),
}));

const CFG = { dimensionId: 1, measureId: 2, limit: 20, seriesDimensionId: null };

/** Ô loại BẢNG: vẽ bằng HTML, không đụng Vega (jsdom không có canvas). */
function trang(id: string, name: string, tieuDeO: string): ReportPageDto {
  return {
    id,
    name,
    visuals: [
      { id: `o-${id}`, chartType: 'table', config: CFG, title: tieuDeO, x: 0, y: 0, w: 12, h: 4 },
    ],
    annotations: [],
  } as ReportPageDto;
}

function baoCao(pages: ReportPageDto[] | null): ReportDto {
  return {
    id: 41,
    name: 'Doanh thu: quý IV',
    source: 'datamodel',
    datamodelId: 3,
    chartType: 'table',
    canvas: pages === null ? null : { pages },
  } as unknown as ReportDto;
}

const BA_TRANG = [
  trang('p1', 'Tổng quan', 'Ô của trang một'),
  trang('p2', 'Chi tiết', 'Ô của trang hai'),
  trang('p3', 'Theo tháng', 'Ô của trang ba'),
];

function soLieu(pageId: string | null): ReportCanvasDataDto {
  const id = pageId ?? 'p1';
  return {
    visuals: [
      {
        visualId: `o-${id}`,
        data: {
          rows: [{ label: `nhóm ${id}`, value: 1 }],
          dimensionLabel: 'Nhóm',
          measureLabel: 'Số',
          grouped: false,
        },
      },
    ],
  };
}

const CANVAS_GIA = { width: 10, height: 10 } as HTMLCanvasElement;

function ve(report: ReportDto, activePageId: string | null): { vungDangXem: () => HTMLElement } {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  function Trang(): React.ReactElement {
    const ref = useRef<HTMLDivElement>(null);
    return (
      <>
        <XuatBaoCao report={report} activePageId={activePageId} vungRef={ref} />
        <div ref={ref} data-testid="vung-dang-xem">
          báo cáo trên màn hình
        </div>
      </>
    );
  }

  render(
    <QueryClientProvider client={client}>
      <Trang />
    </QueryClientProvider>,
  );
  return { vungDangXem: () => screen.getByTestId('vung-dang-xem') };
}

function chonMuc(nhan: RegExp): void {
  fireEvent.click(screen.getByRole('button', { name: /Xuất/ }));
  fireEvent.click(screen.getByRole('menuitem', { name: nhan }));
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('menu Xuất', () => {
  it('báo cáo một trang: ba mục — PNG, PDF, Excel', () => {
    ve(baoCao([BA_TRANG[0] as ReportPageDto]), null);
    fireEvent.click(screen.getByRole('button', { name: /Xuất/ }));

    const muc = screen.getAllByRole('menuitem').map((m) => m.textContent);
    expect(muc).toEqual([
      'Ảnh PNGToàn bộ báo cáo',
      'Tệp PDFToàn bộ báo cáo',
      'Bảng tính ExcelSố liệu đang vẽ trên biểu đồ',
    ]);
  });

  it('báo cáo nhiều trang: thêm mục PDF cho tất cả các trang', () => {
    ve(baoCao(BA_TRANG), 'p2');
    fireEvent.click(screen.getByRole('button', { name: /Xuất/ }));

    const muc = screen.getAllByRole('menuitem').map((m) => m.textContent);
    expect(muc).toHaveLength(4);
    expect(muc[0]).toContain('Trang đang xem');
    expect(muc[2]).toContain('mỗi biểu đồ một sheet');
    expect(muc[3]).toContain('tất cả 3 trang');
  });
});

describe('xuất trang đang xem', () => {
  it('PNG chụp CHÍNH vùng trên màn hình, tên tệp mang tên trang', async () => {
    vi.mocked(chup.chupVung).mockResolvedValue({ canvas: CANVAS_GIA, rongCss: 1, caoCss: 1 });
    const blob = new Blob(['png']);
    vi.mocked(chup.canvasSangPng).mockResolvedValue(blob);
    const { vungDangXem } = ve(baoCao(BA_TRANG), 'p2');

    chonMuc(/Ảnh PNG/);

    await waitFor(() =>
      expect(chup.taiXuong).toHaveBeenCalledWith(blob, 'Doanh thu quý IV - Chi tiết.png'),
    );
    expect(chup.chupVung).toHaveBeenCalledTimes(1);
    const [vung, thongTin] = vi.mocked(chup.chupVung).mock.calls[0] ?? [];
    expect(vung).toBe(vungDangXem());
    expect(thongTin?.tieuDe).toBe('Doanh thu: quý IV');
    expect(thongTin?.phu).toMatch(/^Trang: Chi tiết · Xuất lúc /);
    // Không dựng trang nào ngoài màn hình cho việc này.
    expect(datasetsApi.fetchReportCanvasData).not.toHaveBeenCalled();
  });

  it('báo cáo một biểu đồ (không có khung): không nói "Trang:", tên tệp không có tên trang', async () => {
    vi.mocked(chup.chupVung).mockResolvedValue({ canvas: CANVAS_GIA, rongCss: 100, caoCss: 50 });
    vi.mocked(chup.canvasSangTrangPdf).mockResolvedValue({
      rongPt: 75,
      caoPt: 37.5,
      anh: { rong: 1, cao: 1, duLieu: new Uint8Array([120, 156, 99, 0, 0, 0, 1, 0, 1]) },
    });
    ve(baoCao(null), null);

    chonMuc(/Tệp PDF/);

    await waitFor(() => expect(chup.taiXuong).toHaveBeenCalled());
    const [blob, ten] = vi.mocked(chup.taiXuong).mock.calls[0] ?? [];
    expect(ten).toBe('Doanh thu quý IV.pdf');
    expect(blob?.type).toBe('application/pdf');
    expect(vi.mocked(chup.chupVung).mock.calls[0]?.[1].phu).toMatch(/^Xuất lúc /);
  });
});

describe('PDF tất cả các trang', () => {
  it('trang đang xem chụp từ màn hình, trang khác dựng ngoài màn hình bằng ĐÚNG số liệu của nó', async () => {
    vi.mocked(datasetsApi.fetchReportCanvasData).mockImplementation((_id, pageId) =>
      Promise.resolve(soLieu(pageId)),
    );
    const daChup: { trangSo: number; laManHinh: boolean; noiDung: string }[] = [];
    const { vungDangXem } = ve(baoCao(BA_TRANG), 'p2');

    vi.mocked(chup.chupVung).mockImplementation(async (vung) => {
      const laManHinh = vung === vungDangXem();
      // Trang ngoài màn hình được chụp khi số liệu CỦA NÓ đã về — đợi đúng thứ
      // `choVeXong` thật sẽ đợi, rồi mới đọc nội dung. Trang đang xem ở đây là
      // một thẻ div giả, không có số liệu nào để đợi.
      if (!laManHinh) {
        await waitFor(() => expect(vung.querySelector('[data-dang-tai]')).toBeNull());
        await waitFor(() => expect(vung.textContent).toMatch(/nhóm p\d/));
      }
      daChup.push({ trangSo: daChup.length + 1, laManHinh, noiDung: vung.textContent ?? '' });
      return { canvas: CANVAS_GIA, rongCss: 100, caoCss: 50 };
    });
    vi.mocked(chup.canvasSangTrangPdf).mockImplementation(async () => ({
      rongPt: 75,
      caoPt: 37.5,
      anh: { rong: 1, cao: 1, duLieu: new Uint8Array([120, 156, 99, 0, 0, 0, 1, 0, 1]) },
    }));

    chonMuc(/tất cả 3 trang/);

    await waitFor(() => expect(chup.taiXuong).toHaveBeenCalled(), { timeout: 5_000 });

    expect(daChup.map((c) => c.laManHinh)).toEqual([false, true, false]);
    expect(daChup[0]?.noiDung).toContain('Ô của trang một');
    expect(daChup[0]?.noiDung).toContain('nhóm p1');
    expect(daChup[2]?.noiDung).toContain('Ô của trang ba');
    expect(daChup[2]?.noiDung).toContain('nhóm p3');

    // Trang đầu hỏi bằng `null` — cùng khoá cache với `ReportViewer`.
    const hoi = vi.mocked(datasetsApi.fetchReportCanvasData).mock.calls.map((c) => c[1]);
    expect(hoi).toEqual([null, 'p3']);

    const [blob, ten] = vi.mocked(chup.taiXuong).mock.calls[0] ?? [];
    expect(ten).toBe('Doanh thu quý IV.pdf');
    const s = new TextDecoder('latin1').decode(await blob?.arrayBuffer());
    expect(s).toContain('/Count 3');

    // Khung ngoài màn hình được gỡ, nút trở về như cũ.
    await waitFor(() => expect(document.body.textContent).not.toContain('Ô của trang ba'));
    expect(screen.getByRole('button', { name: /^Xuất$/ })).toBeEnabled();
  });

  it('một trang lỗi thì báo lỗi, KHÔNG tải về tệp thiếu trang', async () => {
    vi.mocked(chup.chupVung).mockRejectedValue(
      new chup.LoiXuat('Trang "Chi tiết": Kho phân tích tạm thời không trả lời.'),
    );
    ve(baoCao(BA_TRANG), 'p2');

    chonMuc(/tất cả 3 trang/);

    const bao = await screen.findByRole('alert');
    expect(bao.textContent).toContain('Chưa xuất được báo cáo');
    expect(bao.textContent).toContain('Kho phân tích tạm thời không trả lời.');
    expect(chup.taiXuong).not.toHaveBeenCalled();
  });

  it('lỗi ngoài dự kiến: câu chung cho người dùng, chi tiết vào console cho người sửa', async () => {
    const loi = new TypeError('drawImage failed');
    vi.mocked(chup.chupVung).mockRejectedValue(loi);
    const console_ = vi.spyOn(console, 'error').mockImplementation(() => {});
    ve(baoCao(BA_TRANG), 'p1');

    chonMuc(/Ảnh PNG/);

    const bao = await screen.findByRole('alert');
    expect(bao.textContent).toContain('Không xuất được báo cáo');
    expect(bao.textContent).not.toContain('drawImage');
    expect(console_).toHaveBeenCalledWith(loi);
    console_.mockRestore();
  });
});
