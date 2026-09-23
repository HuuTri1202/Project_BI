import type { ReportDto, ReportPageDto, ReportVisualDto } from '@bi/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { datasetKeys } from '../src/features/datasets/keys';
import {
  chonHet,
  khoaO,
  oTrenManHinh,
  oTrongTam,
  tenO,
  tenTrenManHinh,
  themNhanThat,
} from '../src/features/reports/export/chonO';
import * as chup from '../src/features/reports/export/chupBaoCao';
import * as excel from '../src/features/reports/export/excelBaoCao';
import { XuatBaoCao } from '../src/features/reports/export/XuatBaoCao';

/**
 * "Xuất những biểu đồ nào?" — §10.23.
 *
 * ═══ Ca này canh gì ═════════════════════════════════════════════════════════
 *
 * Một hộp chọn hỏng KHÔNG báo lỗi. Nó giao một tệp, và tệp đó trông hoàn toàn
 * bình thường — chỉ là chứa nhầm biểu đồ. Bốn chỗ hỏng như vậy được canh ở đây:
 *
 *   1. Chọn hết mà vẫn đi đường "ghép từng ô": người dùng không đụng vào hộp
 *      lại nhận một tệp khác hẳn tệp họ vẫn nhận — mất bố cục, mất chú thích.
 *   2. Bỏ tích một ô mà ảnh vẫn đủ ô, hoặc thiếu nhầm ô khác.
 *   3. Ảnh rút gọn không nói ra là nó rút gọn — người nhận đối chiếu với báo
 *      cáo rồi kết luận là xuất thiếu.
 *   4. Hỏi sai phạm vi: PNG chụp trang đang xem, nên hỏi cả 12 ô của 4 trang là
 *      hứa một đằng làm một nẻo.
 */

vi.mock('../src/features/reports/export/chupBaoCao', async (importOriginal) => ({
  ...(await importOriginal<typeof chup>()),
  chupCacVung: vi.fn(),
  canvasSangPng: vi.fn(),
  canvasSangTrangPdf: vi.fn(),
  taiXuong: vi.fn(),
}));

vi.mock('../src/features/reports/export/excelBaoCao', async (importOriginal) => ({
  ...(await importOriginal<typeof excel>()),
  xuatExcel: vi.fn(() => Promise.resolve(new Blob(['xlsx']))),
}));

vi.mock('../src/features/datasets/api', () => ({
  fetchReportCanvasData: vi.fn(() => new Promise(() => {})),
  fetchReportData: vi.fn(() => new Promise(() => {})),
  fetchReportVisualData: vi.fn(() => new Promise(() => {})),
}));

const CFG = { dimensionId: 1, measureId: 2, limit: 20, seriesDimensionId: null };

const o = (id: string, title: string | null): ReportVisualDto =>
  ({ id, chartType: 'table', config: CFG, title, x: 0, y: 0, w: 6, h: 4 }) as ReportVisualDto;

const trang = (id: string, name: string, visuals: ReportVisualDto[]): ReportPageDto =>
  ({ id, name, visuals, annotations: [] }) as ReportPageDto;

const baoCao = (pages: ReportPageDto[]): ReportDto =>
  ({
    id: 41,
    name: 'Doanh thu quý IV',
    source: 'datamodel',
    datamodelId: 3,
    chartType: 'table',
    canvas: { pages },
  }) as unknown as ReportDto;

const BA_O = trang('p1', 'Tổng quan', [
  o('o1', 'Doanh thu theo nhóm'),
  o('o2', 'Số lượng theo tháng'),
  o('o3', null),
]);

const CANVAS_GIA = { width: 10, height: 10 } as HTMLCanvasElement;

/**
 * Vùng đang xem mang đúng những thẻ `data-visual-id` mà `CanvasView` dựng ra.
 *
 * Đây là điểm nối giữa hai file, và là chỗ dễ đứt nhất: đổi tên thuộc tính ở
 * `CanvasView` thì việc chụp lặng lẽ không tìm thấy ô nào.
 */
function ve(
  report: ReportDto,
  activePageId: string | null,
  /** Số liệu đã có sẵn trong cache, như sau khi `ReportViewer` vừa nạp trang. */
  cache?: { pageId: string | null; visuals: { visualId: string; measureLabel: string }[] },
  /** Chữ đang in trên đầu từng ô — `CanvasView` gắn nó vào `data-visual-ten`. */
  tenTren: Record<string, string> = {},
): { oTren: (id: string) => HTMLElement } {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (cache !== undefined) {
    client.setQueryData(datasetKeys.reportCanvasData(report.id, cache.pageId), {
      visuals: cache.visuals.map((v) => ({
        visualId: v.visualId,
        data: {
          rows: [{ label: 'a', value: 1 }],
          dimensionLabel: 'Nhóm hàng',
          measureLabel: v.measureLabel,
          grouped: false,
        },
      })),
    });
  }
  const pages = report.canvas?.pages ?? [];
  const page = pages.find((p) => p.id === activePageId) ?? pages[0];

  function Trang(): React.ReactElement {
    const ref = useRef<HTMLDivElement>(null);
    return (
      <>
        <XuatBaoCao report={report} activePageId={activePageId} vungRef={ref} />
        <div ref={ref} data-testid="vung">
          {(page?.visuals ?? []).map((v) => (
            <div
              key={v.id}
              data-visual-id={v.id}
              {...(tenTren[v.id] === undefined ? {} : { 'data-visual-ten': tenTren[v.id] })}
              data-testid={`o-${v.id}`}
            >
              ô {v.id}
            </div>
          ))}
        </div>
      </>
    );
  }

  render(
    <QueryClientProvider client={client}>
      <Trang />
    </QueryClientProvider>,
  );
  return { oTren: (id) => screen.getByTestId(`o-${id}`) };
}

function moMenu(nhan: RegExp): void {
  fireEvent.click(screen.getByRole('button', { name: /^Xuất$/ }));
  fireEvent.click(screen.getByRole('menuitem', { name: nhan }));
}

/** Hộp chọn đang mở, để `within` khỏi bắt nhầm nút "Xuất" trên thanh công cụ. */
const hop = (): HTMLElement => screen.getByRole('dialog');

afterEach(() => {
  vi.clearAllMocks();
});

describe('phạm vi câu hỏi', () => {
  it('PNG hỏi ô của TRANG ĐANG XEM; Excel hỏi cả báo cáo', () => {
    const r = baoCao([BA_O, trang('p2', 'Chi tiết', [o('o4', 'Bảng chi tiết')])]);

    expect(oTrongTam(r, 'png', 'p1').map((x) => x.visualId)).toEqual(['o1', 'o2', 'o3']);
    expect(oTrongTam(r, 'pdf', 'p2').map((x) => x.visualId)).toEqual(['o4']);
    expect(oTrongTam(r, 'excel', 'p1').map((x) => x.visualId)).toEqual(['o1', 'o2', 'o3', 'o4']);
    expect(oTrongTam(r, 'pdf-tat-ca', 'p1')).toHaveLength(4);
  });

  it('tên trang chỉ hiện khi danh sách trải qua nhiều trang', () => {
    const r = baoCao([BA_O, trang('p2', 'Chi tiết', [o('o4', 'Bảng chi tiết')])]);

    // PNG luôn nằm gọn trong một trang — nhắc tên trang ở đó là chữ thừa.
    expect(oTrongTam(r, 'png', 'p1').map((x) => x.tenTrang)).toEqual([null, null, null]);
    expect(oTrongTam(r, 'excel', 'p1').map((x) => x.tenTrang)).toEqual([
      'Tổng quan',
      'Tổng quan',
      'Tổng quan',
      'Chi tiết',
    ]);
  });

  it('báo cáo một biểu đồ (không có khung) thì không có gì để hỏi', () => {
    const r = { ...baoCao([]), canvas: null } as ReportDto;
    expect(oTrongTam(r, 'excel', null)).toEqual([]);
  });

  it('ô chưa đặt tên được gọi bằng thứ tự và loại biểu đồ', () => {
    expect(tenO(o('x', null), 3)).toBe('Biểu đồ 3 · Bảng số liệu');
    expect(tenO(o('x', '  '), 1)).toBe('Biểu đồ 1 · Bảng số liệu');
    expect(tenO(o('x', 'Tên riêng'), 1)).toBe('Tên riêng');
  });

  it('khoá chọn ghép mã trang với mã ô — hai trang trùng mã ô không lẫn nhau', () => {
    expect(khoaO('p1', 'o1')).toBe('p1:o1');
    expect(khoaO('p2', 'o1')).not.toBe(khoaO('p1', 'o1'));
  });
});

describe('oTrenManHinh', () => {
  it('trả về ĐÚNG thứ tự yêu cầu, không phải thứ tự trong DOM', () => {
    const goc = document.createElement('div');
    goc.innerHTML = '<div data-visual-id="a"></div><div data-visual-id="b"></div>';
    document.body.append(goc);

    const els = oTrenManHinh(goc, ['b', 'a']);
    expect(els.map((e) => e.getAttribute('data-visual-id'))).toEqual(['b', 'a']);
    goc.remove();
  });

  it('bỏ qua mã không có trên màn hình thay vì trả về chỗ trống', () => {
    const goc = document.createElement('div');
    goc.innerHTML = '<div data-visual-id="a"></div>';
    expect(oTrenManHinh(goc, ['a', 'khong-co'])).toHaveLength(1);
  });
});

describe('hộp chọn', () => {
  it('chỉ MỘT biểu đồ trong tầm: không hỏi, xuất thẳng', async () => {
    vi.mocked(chup.chupCacVung).mockResolvedValue({ canvas: CANVAS_GIA, rongCss: 1, caoCss: 1 });
    vi.mocked(chup.canvasSangPng).mockResolvedValue(new Blob(['png']));
    ve(baoCao([trang('p1', 'Tổng quan', [o('o1', 'Một mình')])]), null);

    moMenu(/Ảnh PNG/);

    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(chup.chupCacVung).toHaveBeenCalled());
  });

  it('nhiều biểu đồ: hỏi, và tích sẵn TẤT CẢ', () => {
    ve(baoCao([BA_O]), null);
    moMenu(/Ảnh PNG/);

    const oTich = within(hop()).getAllByRole('checkbox');
    // 3 ô + một ô "Chọn tất cả".
    expect(oTich).toHaveLength(4);
    expect(oTich.every((c) => (c as HTMLInputElement).checked)).toBe(true);
    expect(within(hop()).getByText('Doanh thu theo nhóm')).toBeInTheDocument();
    expect(within(hop()).getByText('Biểu đồ 3 · Bảng số liệu')).toBeInTheDocument();
    expect(
      within(hop()).getByRole('button', { name: 'Xuất tất cả 3 biểu đồ' }),
    ).toBeInTheDocument();
  });

  it('chọn hết -> chụp CẢ KHUNG, y như trước khi có tính năng này', async () => {
    vi.mocked(chup.chupCacVung).mockResolvedValue({ canvas: CANVAS_GIA, rongCss: 1, caoCss: 1 });
    vi.mocked(chup.canvasSangPng).mockResolvedValue(new Blob(['png']));
    ve(baoCao([BA_O]), null);

    moMenu(/Ảnh PNG/);
    fireEvent.click(within(hop()).getByRole('button', { name: /Xuất tất cả/ }));

    await waitFor(() => expect(chup.chupCacVung).toHaveBeenCalled());
    const [vungs, thongTin] = vi.mocked(chup.chupCacVung).mock.calls[0] ?? [];
    expect(vungs).toEqual([screen.getByTestId('vung')]);
    // Không nói "3/3 biểu đồ": tệp này LÀ cả báo cáo, không có gì để cảnh báo.
    expect(thongTin?.phu).toMatch(/^Xuất lúc /);
  });

  it('bỏ tích một ô -> chụp đúng các ô còn lại, đúng thứ tự trong trang', async () => {
    vi.mocked(chup.chupCacVung).mockResolvedValue({ canvas: CANVAS_GIA, rongCss: 1, caoCss: 1 });
    vi.mocked(chup.canvasSangPng).mockResolvedValue(new Blob(['png']));
    const { oTren } = ve(baoCao([BA_O]), null);

    moMenu(/Ảnh PNG/);
    fireEvent.click(within(hop()).getByRole('checkbox', { name: 'Số lượng theo tháng' }));
    fireEvent.click(within(hop()).getByRole('button', { name: 'Xuất 2 biểu đồ' }));

    await waitFor(() => expect(chup.chupCacVung).toHaveBeenCalled());
    const [vungs, thongTin] = vi.mocked(chup.chupCacVung).mock.calls[0] ?? [];
    expect(vungs).toEqual([oTren('o1'), oTren('o3')]);
    // Ảnh rút gọn phải TỰ NÓI ra, nếu không người nhận đọc nó như một báo cáo
    // thiếu biểu đồ.
    expect(thongTin?.phu).toContain('2/3 biểu đồ');
  });

  it('bỏ hết dấu tích thì không xuất được', () => {
    ve(baoCao([BA_O]), null);
    moMenu(/Ảnh PNG/);

    fireEvent.click(within(hop()).getByRole('checkbox', { name: /Chọn tất cả/ }));

    expect(
      within(hop())
        .getAllByRole('checkbox')
        .some((c) => (c as HTMLInputElement).checked),
    ).toBe(false);
    expect(within(hop()).getByRole('button', { name: /^Xuất 0 biểu đồ$/ })).toBeDisabled();
  });

  it('Huỷ thì không xuất gì', () => {
    ve(baoCao([BA_O]), null);
    moMenu(/Ảnh PNG/);
    fireEvent.click(within(hop()).getByRole('button', { name: 'Huỷ' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(chup.chupCacVung).not.toHaveBeenCalled();
  });

  it('Excel: chỉ những ô đã chọn đi vào tệp', async () => {
    const r = baoCao([BA_O, trang('p2', 'Chi tiết', [o('o4', 'Bảng chi tiết')])]);
    ve(r, null);

    moMenu(/Bảng tính Excel/);
    fireEvent.click(within(hop()).getByRole('checkbox', { name: 'Doanh thu theo nhóm' }));
    fireEvent.click(within(hop()).getByRole('checkbox', { name: 'Biểu đồ 3 · Bảng số liệu' }));
    fireEvent.click(within(hop()).getByRole('button', { name: 'Xuất 2 biểu đồ' }));

    await waitFor(() => expect(excel.xuatExcel).toHaveBeenCalled());
    const [arg] = vi.mocked(excel.xuatExcel).mock.calls[0] ?? [];
    expect([...(arg?.chon ?? [])].sort()).toEqual(['p1:o2', 'p2:o4']);
  });
});

describe('tên ô lấy nhãn thật khi đã có số liệu', () => {
  it('themNhanThat chỉ thay tên TẠM, không đụng tên người dùng đặt', () => {
    const ds = oTrongTam(baoCao([BA_O]), 'png', null);
    const sau = themNhanThat(ds, (_p, v) => (v === 'o3' ? 'Doanh thu v3 theo Nhóm hàng' : null));

    expect(sau.map((x) => x.ten)).toEqual([
      'Doanh thu theo nhóm',
      'Số lượng theo tháng',
      'Doanh thu v3 theo Nhóm hàng',
    ]);
  });

  it('nhãn thật KHÔNG đè lên tên người dùng đã đặt', () => {
    const ds = oTrongTam(baoCao([BA_O]), 'png', null);
    const sau = themNhanThat(ds, () => 'Nhãn từ số liệu');
    expect(sau[0]?.ten).toBe('Doanh thu theo nhóm');
    expect(sau[2]?.ten).toBe('Nhãn từ số liệu');
  });

  it('tenTrenManHinh đọc đúng chữ đang in trên đầu ô', () => {
    const goc = document.createElement('div');
    goc.innerHTML =
      '<div data-visual-id="a" data-visual-ten="Doanh thu theo Nhóm"></div>' +
      '<div data-visual-id="b"></div>' +
      '<div data-visual-id="c" data-visual-ten="   "></div>';

    expect(tenTrenManHinh(goc, 'a')).toBe('Doanh thu theo Nhóm');
    // Ô chưa có gì để gọi tên: trả `null` để nơi gọi giữ tên tạm, chứ không
    // giao một chuỗi rỗng rồi hộp chọn hiện một dòng trống.
    expect(tenTrenManHinh(goc, 'b')).toBeNull();
    expect(tenTrenManHinh(goc, 'c')).toBeNull();
    expect(tenTrenManHinh(goc, 'khong-co')).toBeNull();
  });

  it('MÀN HÌNH thắng cache — cái tên người dùng đang đọc là cái tên đúng', () => {
    // Cache có thể trượt khoá, chưa về, hay rỗng vì ô đang lỗi. Màn hình thì
    // không: chữ trên đầu ô chính là thứ người dùng đối chiếu khi bỏ tích.
    ve(
      baoCao([BA_O]),
      null,
      { pageId: null, visuals: [{ visualId: 'o3', measureLabel: 'Nhãn cũ trong cache' }] },
      { o3: 'Doanh thu v3 theo Nhóm hàng' },
    );
    moMenu(/Ảnh PNG/);

    expect(within(hop()).getByText('Doanh thu v3 theo Nhóm hàng')).toBeInTheDocument();
    expect(within(hop()).queryByText(/Nhãn cũ trong cache/)).toBeNull();
  });

  it('ô ở trang KHÁC không có trên màn hình thì lấy từ cache', () => {
    // Lỗi đo được trên Chromium: thẻ ghi "Doanh thu v3 theo Nhóm hàng" còn hộp
    // chọn ghi "Biểu đồ 3 · Bảng số liệu" — hai cái tên cho cùng một ô.
    ve(baoCao([BA_O]), null, {
      pageId: null,
      visuals: [{ visualId: 'o3', measureLabel: 'Doanh thu v3' }],
    });
    moMenu(/Ảnh PNG/);

    expect(within(hop()).getByText('Doanh thu v3 theo Nhóm hàng')).toBeInTheDocument();
    expect(within(hop()).queryByText('Biểu đồ 3 · Bảng số liệu')).toBeNull();
  });
});

describe('chonHet', () => {
  it('đúng chỉ khi mọi ô trong tầm đều có trong tập đã chọn', () => {
    const ds = oTrongTam(baoCao([BA_O]), 'png', null);
    expect(chonHet(ds, new Set(ds.map((x) => x.khoa)))).toBe(true);
    expect(chonHet(ds, new Set(['p1:o1', 'p1:o2']))).toBe(false);
    // Tập chọn mang cả ô ngoài tầm vẫn là "đã chọn hết trong tầm".
    expect(chonHet(ds, new Set([...ds.map((x) => x.khoa), 'p9:khac']))).toBe(true);
  });
});
