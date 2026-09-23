import type { ReportCanvasDataDto, ReportDataDto, ReportDto } from '@bi/shared';

import { taoXlsx, type OTinh, type Sheet } from './xlsx';

/**
 * Số liệu của báo cáo -> các sheet Excel.
 *
 * ═══ Xuất SỐ LIỆU, không xuất ảnh ═══════════════════════════════════════════
 *
 * PNG và PDF chụp lại thứ người dùng đang nhìn. Excel thì ngược lại: người ta
 * xin tệp Excel là để TÍNH TIẾP — cộng, lọc, dựng pivot. Nên mỗi sheet là một
 * bảng phẳng bắt đầu ngay ở ô A1, không có dòng tiêu đề trang trí phía trên:
 * thêm hai dòng tên báo cáo vào đầu sheet là làm hỏng mọi thao tác "Định dạng
 * dưới dạng bảng" và "Chèn PivotTable" của Excel, vốn giả định hàng 1 là tên
 * cột.
 *
 * Phần xuất xứ (tên báo cáo, thời điểm xuất) nằm ở một sheet RIÊNG cuối tệp, để
 * tệp vẫn tự nói được nó từ đâu ra mà không chen vào dữ liệu.
 *
 * ═══ Mỗi biểu đồ một sheet ══════════════════════════════════════════════════
 *
 * Báo cáo nhiều ô thì gộp hết vào một sheet là sai: các ô có chiều khác nhau,
 * thước đo khác nhau, số dòng khác nhau. Chúng là những bảng khác nhau, và
 * Excel có sẵn khái niệm cho việc đó.
 *
 * ⚠️ Xuất đúng TRANG NHÓM ĐẦU của mỗi biểu đồ — đúng thứ hiện ra khi mở báo cáo.
 * Người dùng đã bấm ‹ › để lật sang nhóm thứ 3 thì tệp Excel vẫn là nhóm thứ 1,
 * vì số trang nhóm là trạng thái riêng của từng ô nằm trong `CanvasView` và
 * không nổi lên tới đây. Muốn nhiều nhóm hơn thì tăng `limit` của biểu đồ.
 */

/** Một bảng số liệu kèm chỗ nó đến từ đâu. */
export interface NguonSheet {
  /** Tên sheet mong muốn — sẽ được `tenSheetHopLe` cắt gọt theo luật Excel. */
  ten: string;
  data: ReportDataDto | null;
  /** Câu lỗi của riêng ô đó, nếu backend không dựng được số liệu. */
  loi?: string | undefined;
}

/**
 * Một `ReportDataDto` -> một bảng phẳng.
 *
 * Cột đúng theo thứ tự bảng "Số liệu" mà người dùng đang thấy dưới biểu đồ
 * (`ReportDataTable`): chiều, rồi chuỗi nếu có, rồi thước đo.
 */
export function bangTu(data: ReportDataDto): { cot: string[]; dong: OTinh[][] } {
  const coChuoi = data.seriesLabel !== undefined;
  // Phần trăm được lưu dưới dạng phân số (0.283) nhưng màn hình hiện "28,3 %".
  // Ghi phân số vào Excel thì con số trong tệp KHÁC con số trên màn hình, và
  // người đối chiếu sẽ tưởng xuất sai. Nhân 100 rồi nói rõ đơn vị ở tên cột.
  const phanTram = data.format === 'percent';

  const cot = [
    data.dimensionLabel || 'Nhóm',
    ...(coChuoi ? [data.seriesLabel ?? ''] : []),
    phanTram ? `${data.measureLabel || 'Giá trị'} (%)` : data.measureLabel || 'Giá trị',
  ];

  const dong = data.rows.map((r): OTinh[] => [
    r.label,
    ...(coChuoi ? [r.series ?? ''] : []),
    phanTram ? r.value * 100 : r.value,
  ]);

  return { cot, dong };
}

const KHONG_CO_SO_LIEU = 'Không có số liệu';

/** Gom các bảng thành sheet, kèm một sheet xuất xứ ở cuối. */
export function dungSheets(tenBaoCao: string, nguon: readonly NguonSheet[]): Sheet[] {
  const sheets: Sheet[] = [];
  const ghiChu: OTinh[][] = [];

  for (const n of nguon) {
    if (n.data === null || n.data.rows.length === 0) {
      // Ô hỏng hoặc rỗng KHÔNG sinh ra một sheet trống — một tab trắng không nói
      // được gì. Nó được ghi vào sheet xuất xứ, nơi có chỗ cho cả câu lỗi.
      ghiChu.push([n.ten, n.loi ?? KHONG_CO_SO_LIEU]);
      continue;
    }
    const { cot, dong } = bangTu(n.data);
    sheets.push({ ten: n.ten, cot, dong });
    ghiChu.push([n.ten, `${dong.length} dòng`]);
  }

  sheets.push({
    ten: 'Thông tin',
    cot: ['Mục', 'Giá trị'],
    dong: [
      ['Báo cáo', tenBaoCao],
      ['Xuất lúc', new Date().toLocaleString('vi-VN')],
      ['Nguồn', 'Open Insight'],
      [null, null],
      ['Bảng', 'Ghi chú'],
      ...ghiChu,
    ],
  });

  return sheets;
}

/**
 * Lấy số liệu của cả báo cáo rồi đóng thành tệp .xlsx.
 *
 * Hai hàm lấy số liệu được TRUYỀN VÀO chứ không gọi thẳng react-query ở đây:
 * nhờ vậy bài test dựng được mọi hình dạng báo cáo mà không phải dựng cả một
 * QueryClientProvider, và module này không biết gì về tầng mạng.
 */
export async function xuatExcel({
  report,
  layCanvas,
  layDon,
  tienDo,
}: {
  report: ReportDto;
  /** `pageId === null` = trang đầu, đúng quy ước của `ReportViewer`. */
  layCanvas: (pageId: string | null) => Promise<ReportCanvasDataDto>;
  layDon: () => Promise<ReportDataDto>;
  tienDo?: ((noi: string) => void) | undefined;
}): Promise<Blob> {
  const pages = report.canvas?.pages ?? [];

  if (pages.length === 0) {
    // Báo cáo một biểu đồ.
    tienDo?.('Đang lấy số liệu…');
    const data = await layDon();
    return taoXlsx(dungSheets(report.name, [{ ten: report.name, data }]));
  }

  const nhieuTrang = pages.length > 1;
  const dauId = pages[0]?.id;
  const nguon: NguonSheet[] = [];

  for (const [i, page] of pages.entries()) {
    tienDo?.(`Đang lấy số liệu trang ${i + 1}/${pages.length}…`);
    const canvas = await layCanvas(page.id === dauId ? null : page.id);
    const theoId = new Map(canvas.visuals.map((v) => [v.visualId, v]));

    for (const v of page.visuals) {
      const o = theoId.get(v.id);
      const data = o?.data ?? null;
      // Tên sheet: tiêu đề người dùng đặt, nếu không thì tiêu đề tự sinh từ
      // chính nhãn của số liệu — cùng câu mà `CanvasView` in trên đầu ô.
      const tuDong = data === null ? 'Biểu đồ' : `${data.measureLabel} theo ${data.dimensionLabel}`;
      const ten = (v.title ?? '').trim() || tuDong;
      nguon.push({
        ten: nhieuTrang ? `${page.name} · ${ten}` : ten,
        data,
        loi: o?.error,
      });
    }
  }

  return taoXlsx(dungSheets(report.name, nguon));
}
