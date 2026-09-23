// @vitest-environment node
import type { ReportCanvasDataDto, ReportDataDto, ReportDto, ReportPageDto } from '@bi/shared';
import ExcelJS from 'exceljs';
import { describe, expect, it, vi } from 'vitest';

import { bangTu, dungSheets, xuatExcel } from '../src/features/reports/export/excelBaoCao';

/**
 * Xuất số liệu báo cáo ra Excel.
 *
 * ═══ Ca này canh gì ═════════════════════════════════════════════════════════
 *
 * Người ta xin tệp Excel là để TÍNH TIẾP, nên ba điều phải đúng và cả ba đều dễ
 * hỏng âm thầm:
 *
 *   1. Con số trong tệp phải là SỐ, và phải bằng con số trên màn hình. Phần trăm
 *      là chỗ bẫy: hệ thống lưu phân số (0,283) còn màn hình hiện "28,3 %".
 *   2. Bảng phải bắt đầu ở ô A1. Chèn hai dòng tiêu đề trang trí lên đầu là làm
 *      hỏng PivotTable — và không bài test nào phát hiện nếu chỉ đếm số sheet.
 *   3. Ô hỏng không được biến thành một tab trắng.
 *
 * Ca cuối cùng đóng gói thật rồi ĐỌC NGƯỢC bằng `exceljs`, để cả chuỗi từ số
 * liệu tới tệp được kiểm một lần bằng một bộ đọc độc lập.
 */

function soLieu(p: Partial<ReportDataDto> = {}): ReportDataDto {
  return {
    rows: [
      { label: 'Furniture', value: 742000 },
      { label: 'Technology', value: 836154 },
    ],
    dimensionLabel: 'Category',
    measureLabel: 'Sales',
    grouped: false,
    ...p,
  };
}

const trang = (id: string, ten: string, visuals: { id: string; title?: string }[]): ReportPageDto =>
  ({
    id,
    name: ten,
    annotations: [],
    visuals: visuals.map((v) => ({
      id: v.id,
      chartType: 'bar',
      config: { dimensionId: 1, measureId: 2, limit: 20 },
      x: 0,
      y: 0,
      w: 6,
      h: 4,
      ...(v.title === undefined ? {} : { title: v.title }),
    })),
  }) as ReportPageDto;

const baoCao = (pages: ReportPageDto[] | null): ReportDto =>
  ({
    id: 7,
    name: 'Báo cáo bán hàng',
    canvas: pages === null ? null : { pages },
    chartType: pages === null ? 'bar' : null,
  }) as ReportDto;

const canvasData = (
  visuals: { visualId: string; data?: ReportDataDto | null; error?: string }[],
): ReportCanvasDataDto =>
  ({
    visuals: visuals.map((v) => ({
      visualId: v.visualId,
      data: v.data ?? null,
      ...(v.error === undefined ? {} : { error: v.error }),
    })),
  }) as ReportCanvasDataDto;

describe('bangTu — một biểu đồ thành một bảng phẳng', () => {
  it('hai cột khi không có nhóm màu', () => {
    expect(bangTu(soLieu())).toEqual({
      cot: ['Category', 'Sales'],
      dong: [
        ['Furniture', 742000],
        ['Technology', 836154],
      ],
    });
  });

  it('ba cột khi có nhóm màu, đúng thứ tự bảng đang hiện dưới biểu đồ', () => {
    const b = bangTu(
      soLieu({
        seriesLabel: 'Region',
        rows: [
          { label: 'Furniture', value: 10, series: 'Bắc' },
          { label: 'Furniture', value: 20, series: 'Nam' },
        ],
      }),
    );
    expect(b.cot).toEqual(['Category', 'Region', 'Sales']);
    expect(b.dong).toEqual([
      ['Furniture', 'Bắc', 10],
      ['Furniture', 'Nam', 20],
    ]);
  });

  it('phần trăm: nhân 100 và nói rõ đơn vị, để khớp con số trên màn hình', () => {
    const b = bangTu(
      soLieu({ format: 'percent', rows: [{ label: 'A', value: 0.283 }], measureLabel: 'Tỷ lệ' }),
    );
    expect(b.cot[1]).toBe('Tỷ lệ (%)');
    expect(b.dong[0]?.[1]).toBeCloseTo(28.3, 10);
  });

  it('nhãn rỗng vẫn có tên cột dùng được', () => {
    const b = bangTu(soLieu({ dimensionLabel: '', measureLabel: '' }));
    expect(b.cot).toEqual(['Nhóm', 'Giá trị']);
  });
});

describe('dungSheets', () => {
  it('ô hỏng KHÔNG thành sheet trắng — nó được ghi vào sheet Thông tin', () => {
    const sheets = dungSheets('BC', [
      { ten: 'Tốt', data: soLieu() },
      { ten: 'Hỏng', data: null, loi: 'Kho phân tích không trả lời.' },
      { ten: 'Rỗng', data: soLieu({ rows: [] }) },
    ]);

    expect(sheets.map((s) => s.ten)).toEqual(['Tốt', 'Thông tin']);
    const tt = sheets[1]!;
    expect(tt.dong).toContainEqual(['Hỏng', 'Kho phân tích không trả lời.']);
    expect(tt.dong).toContainEqual(['Rỗng', 'Không có số liệu']);
    expect(tt.dong).toContainEqual(['Tốt', '2 dòng']);
  });

  it('sheet dữ liệu bắt đầu ngay ở hàng tiêu đề — không có dòng trang trí', () => {
    const sheets = dungSheets('BC', [{ ten: 'X', data: soLieu() }]);
    // Hàng đầu là TÊN CỘT, không phải tên báo cáo. Nếu đổi thành tên báo cáo thì
    // PivotTable và "Định dạng dưới dạng bảng" của Excel đều đọc sai.
    expect(sheets[0]!.cot).toEqual(['Category', 'Sales']);
    expect(sheets[0]!.dong[0]).toEqual(['Furniture', 742000]);
  });

  it('luôn có sheet Thông tin nói tệp từ đâu ra', () => {
    const sheets = dungSheets('Báo cáo quý 3', [{ ten: 'X', data: soLieu() }]);
    const tt = sheets.at(-1)!;
    expect(tt.ten).toBe('Thông tin');
    expect(tt.dong).toContainEqual(['Báo cáo', 'Báo cáo quý 3']);
  });
});

describe('xuatExcel', () => {
  it('báo cáo một biểu đồ: hỏi đúng một lần, không đụng canvas', async () => {
    const layCanvas = vi.fn();
    const layDon = vi.fn().mockResolvedValue(soLieu());

    const blob = await xuatExcel({ report: baoCao(null), layCanvas, layDon });

    expect(layDon).toHaveBeenCalledTimes(1);
    expect(layCanvas).not.toHaveBeenCalled();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('nhiều trang: hỏi từng trang, trang ĐẦU dùng khoá null', async () => {
    const pages = [
      trang('p1', 'Tổng quan', [{ id: 'v1' }]),
      trang('p2', 'Chi tiết', [{ id: 'v2' }]),
    ];
    const layCanvas = vi
      .fn()
      .mockResolvedValueOnce(canvasData([{ visualId: 'v1', data: soLieu() }]))
      .mockResolvedValueOnce(canvasData([{ visualId: 'v2', data: soLieu() }]));

    await xuatExcel({ report: baoCao(pages), layCanvas, layDon: vi.fn() });

    expect(layCanvas.mock.calls.map((c) => c[0])).toEqual([null, 'p2']);
  });

  it('mỗi biểu đồ một sheet, tên lấy tiêu đề người dùng đặt', async () => {
    const pages = [trang('p1', 'T1', [{ id: 'v1', title: 'Doanh thu' }, { id: 'v2' }])];
    const layCanvas = vi.fn().mockResolvedValue(
      canvasData([
        { visualId: 'v1', data: soLieu() },
        { visualId: 'v2', data: soLieu({ measureLabel: 'Số lượng', dimensionLabel: 'Vùng' }) },
      ]),
    );

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(
      await (await xuatExcel({ report: baoCao(pages), layCanvas, layDon: vi.fn() })).arrayBuffer(),
    );

    // Một trang -> KHÔNG gắn tên trang vào đầu; ô không đặt tiêu đề thì lấy câu
    // tự sinh, đúng câu `CanvasView` in trên đầu ô.
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      'Doanh thu',
      'Số lượng theo Vùng',
      'Thông tin',
    ]);
  });

  it('nhiều trang thì tên sheet mang theo tên trang', async () => {
    const pages = [
      trang('p1', 'Quý 1', [{ id: 'v1', title: 'Doanh thu' }]),
      trang('p2', 'Quý 2', [{ id: 'v2', title: 'Doanh thu' }]),
    ];
    const layCanvas = vi
      .fn()
      .mockResolvedValueOnce(canvasData([{ visualId: 'v1', data: soLieu() }]))
      .mockResolvedValueOnce(canvasData([{ visualId: 'v2', data: soLieu() }]));

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(
      await (await xuatExcel({ report: baoCao(pages), layCanvas, layDon: vi.fn() })).arrayBuffer(),
    );

    // Hai ô cùng tên ở hai trang khác nhau phải phân biệt được, nếu không người
    // nhận mở ra thấy hai tab "Doanh thu" và "Doanh thu (2)" mà không biết tab
    // nào của quý nào.
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      'Quý 1 · Doanh thu',
      'Quý 2 · Doanh thu',
      'Thông tin',
    ]);
  });

  it('đầu-cuối: tệp mở được và số đọc ra đúng bằng số đưa vào', async () => {
    const pages = [trang('p1', 'T1', [{ id: 'v1', title: 'Doanh thu theo nhóm' }])];
    const layCanvas = vi.fn().mockResolvedValue(
      canvasData([
        {
          visualId: 'v1',
          data: soLieu({
            rows: [
              { label: 'Bàn ghế', value: 742000.5 },
              { label: 'Công nghệ', value: 836154 },
            ],
          }),
        },
      ]),
    );

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(
      await (await xuatExcel({ report: baoCao(pages), layCanvas, layDon: vi.fn() })).arrayBuffer(),
    );

    const ws = wb.getWorksheet('Doanh thu theo nhóm')!;
    expect(ws.getCell('A1').value).toBe('Category');
    expect(ws.getCell('B1').value).toBe('Sales');
    expect(ws.getCell('A2').value).toBe('Bàn ghế');
    expect(ws.getCell('B2').value).toBe(742000.5);
    expect(typeof ws.getCell('B2').value).toBe('number');
    expect(ws.getCell('A3').value).toBe('Công nghệ');
    expect(ws.getCell('B3').value).toBe(836154);
  });

  it('báo tiến độ theo từng trang để nút không đứng im', async () => {
    const pages = [trang('p1', 'A', [{ id: 'v1' }]), trang('p2', 'B', [{ id: 'v2' }])];
    const noi: string[] = [];
    await xuatExcel({
      report: baoCao(pages),
      layCanvas: vi.fn().mockResolvedValue(canvasData([{ visualId: 'v1', data: soLieu() }])),
      layDon: vi.fn(),
      tienDo: (s) => noi.push(s),
    });
    expect(noi).toEqual(['Đang lấy số liệu trang 1/2…', 'Đang lấy số liệu trang 2/2…']);
  });
});
