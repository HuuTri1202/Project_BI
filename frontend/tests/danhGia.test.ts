import type { DataModelDto, DatasetDto, ReportDataDto } from '@bi/shared';
import { describe, expect, it } from 'vitest';

import { duKienDanhSachMoHinh, duKienKhoDuLieu } from '../src/features/chat/duKienTrang';
import type { Nguon } from '../src/features/chat/nguCanh';
import { traLoiHeThong, traLoiTrang } from '../src/features/chat/traLoi';

/**
 * BỘ ĐÁNH GIÁ — khung hỏi đáp trả lời đúng bao nhiêu phần trăm câu hỏi thật.
 *
 * ═══ Vì sao bộ này KHÁC mọi bộ test còn lại ════════════════════════════════
 *
 * `traLoi.test.ts` canh từng hàm: mỗi ca một hành vi, đỏ là có lỗi. Bộ này
 * không canh hàm nào — nó ĐO. Nó chạy một danh sách câu hỏi người dùng gõ thật
 * qua đúng chuỗi thật của khung rồi đếm. Vài ca ở đây ĐANG TRƯỢT, và đó là
 * điểm: một ca trượt ở đây là một khoảng trống đã được ghi lại, không phải một
 * lỗi mới.
 *
 * ═══ Ba kết cục, không phải hai ════════════════════════════════════════════
 *
 * Đây là phần quan trọng nhất của cách đo.
 *
 *   ĐÚNG      trả lời, và con số/cái tên trong đó đúng.
 *   CHƯA HIỂU trả `null`. Trượt, nhưng TRUNG THỰC — người dùng biết ngay là
 *             phải hỏi lại cách khác, và không ai bị dẫn đi sai.
 *   SAI       trả lời, mà con số hoặc cái tên sai. Đây là kết cục DUY NHẤT
 *             nguy hiểm: một con số có thật, định dạng đẹp, trả lời cho một
 *             câu hỏi khác — không có dấu hiệu nào để nhận ra.
 *
 * Gộp "chưa hiểu" vào "sai" thành một con số "độ chính xác" là xoá mất đúng
 * cái phân biệt mà cả thiết kế này dựng lên để giữ. Nên bộ này in ra cả ba.
 *
 * ═══ Luật RÃNH RĂNG: hai con số chỉ được đi một chiều ══════════════════════
 *
 * Cuối file có hai `expect` kẹp lấy ĐÚNG ≥ ngưỡng và SAI ≤ ngưỡng. Mỗi lần
 * nâng cấp khung thì sửa hai ngưỡng đó lên — và không bao giờ sửa xuống. Nhờ
 * vậy một thay đổi "cải thiện câu A" mà lặng lẽ làm hỏng câu B sẽ đỏ ngay.
 *
 * ═══ Xem bảng điểm ═════════════════════════════════════════════════════════
 *
 *     npm --workspace frontend run danh-gia
 *
 * `npm test` thường KHÔNG in nó ra: vitest chỉ hiện `console.log` của một ca
 * khi ca đó đỏ. Mà bộ này cố ý xanh ngay cả lúc có câu trượt — nó đo chứ không
 * canh — nên bảng điểm cần một lệnh riêng mở `--reporter=verbose`.
 *
 * ⚠️ So theo CHUỖI CON, không so cả câu. Lớp viết lại và mọi lần sửa câu chữ
 * sẽ đổi cách đọc liên tục; thứ phải đúng là con số và cái tên. So cả câu là
 * năm mươi ca đỏ mỗi lần ai đó sửa một dấu phẩy.
 */

// ─── Ngữ cảnh thử: dựng từ CHÍNH các hàm chuyển đổi mà trang thật dùng ───────

function bangMotChieu(): ReportDataDto {
  return {
    rows: [
      { label: 'Acco', value: 4 },
      { label: 'Boston', value: 9 },
      { label: 'Staples', value: 10 },
      { label: 'Xerox', value: 7 },
      { label: 'Avery', value: 5 },
    ],
    dimensionLabel: 'Product Name',
    measureLabel: 'Quantity',
    grouped: false,
  };
}
// Tổng 35 · cao nhất Staples 10 · thấp nhất Acco 4 · 5 nhóm · trung bình 7

function bangHaiChieu(): ReportDataDto {
  return {
    rows: [
      { label: 'Jonathan', value: 9, series: 'Boston' },
      { label: 'Jonathan', value: 4, series: 'Staples' },
      { label: 'Laura', value: 4, series: 'Acco' },
      { label: 'Laura', value: 6, series: 'Staples' },
    ],
    dimensionLabel: 'Customer Name',
    measureLabel: 'Quantity',
    seriesLabel: 'Product Name',
    grouped: false,
  };
}
// Gộp theo Product Name: Boston 9 · Staples 10 · Acco 4
// Gộp theo Customer Name: Jonathan 13 · Laura 10

const MO_HINH: DataModelDto[] = [
  {
    id: 1,
    name: 'Global-Superstore',
    datasetCount: 5,
    measureCount: 3,
    relationshipCount: 4,
    reportCount: 7,
  },
  {
    id: 2,
    name: 'Bán hàng',
    datasetCount: 3,
    measureCount: 1,
    relationshipCount: 0,
    reportCount: 2,
  },
  {
    id: 3,
    name: 'Kho vận',
    datasetCount: 2,
    measureCount: 0,
    relationshipCount: 1,
    reportCount: 0,
  },
].map(
  (m) =>
    ({
      ...m,
      workspaceId: 1,
      description: null,
      creatorName: 'Thái',
      updatedAt: '2026-03-01T00:00:00.000Z',
    }) as unknown as DataModelDto,
);
// Nhiều bảng nhất: Global-Superstore 5 · dùng nhiều nhất: Global-Superstore 7
// Chưa nối đủ: Bán hàng (0 quan hệ cho 3 bảng)

const BO_DU_LIEU: DatasetDto[] = [
  {
    id: 1,
    name: 'Orders',
    source: 'file',
    rowCount: 51290,
    columnCount: 24,
    truncated: false,
    datamodelCount: 2,
    fileSizeBytes: 8_400_000,
    originalFilename: 'global-superstore.xlsx',
    sheetName: 'Orders',
  },
  {
    id: 2,
    name: 'Returns',
    source: 'file',
    rowCount: 1173,
    columnCount: 3,
    truncated: true,
    datamodelCount: 1,
    fileSizeBytes: 42_000,
    originalFilename: 'returns.csv',
    sheetName: null,
  },
].map(
  (d) =>
    ({
      ...d,
      status: 'ready',
      loadStatus: 'loaded',
      loadedRowCount: d.rowCount,
      sourceSchema: null,
      sourceTable: null,
      connectionName: null,
    }) as unknown as DatasetDto,
);
// Orders 51.290 dòng / 24 cột · Returns 1.173 dòng (ĐÃ CẮT) / 3 cột

/** Danh sách xuyên hệ thống, đúng hình dạng `useNguCanhHeThong` dựng ra. */
const HE_THONG: Nguon[] = [
  {
    ten: 'Tổng quan toàn tổ chức',
    duKien: [
      { nhan: 'Số bộ dữ liệu trong toàn bộ tổ chức', gia: '12' },
      { nhan: 'Số mô hình dữ liệu trong toàn bộ tổ chức', gia: '3' },
    ],
  },
  ...duKienKhoDuLieu(BO_DU_LIEU),
  ...duKienDanhSachMoHinh(MO_HINH, 3).slice(1),
];

interface NguCanhThu {
  ten: string;
  nguon: Nguon[];
  /** Chip đang chọn. */
  chon: number;
  /** Có danh sách xuyên hệ thống hay không — viewer bị 403 thì không có. */
  heThong: Nguon[];
}

const TRANG = {
  bieuDo1: {
    ten: 'Báo cáo — biểu đồ một chiều',
    nguon: [{ ten: 'Quantity theo Product Name', duKien: [], bang: bangMotChieu() }],
    chon: 0,
    heThong: HE_THONG,
  },
  bieuDo2: {
    ten: 'Báo cáo — biểu đồ hai chiều',
    nguon: [{ ten: 'Quantity theo Customer Name', duKien: [], bang: bangHaiChieu() }],
    chon: 0,
    heThong: HE_THONG,
  },
  dsMoHinh: {
    ten: 'Mô hình dữ liệu (danh sách)',
    nguon: duKienDanhSachMoHinh(MO_HINH, 3),
    chon: 0,
    heThong: HE_THONG,
  },
  khoDuLieu: {
    ten: 'Kho dữ liệu (danh sách)',
    nguon: duKienKhoDuLieu(BO_DU_LIEU),
    chon: 0,
    heThong: HE_THONG,
  },
  // Một trang KHÔNG dính gì tới dữ liệu — để đo nhóm câu hỏi xuyên hệ thống.
  hoSo: {
    ten: 'Hồ sơ cá nhân',
    nguon: [{ ten: 'Hồ sơ của tôi', duKien: [{ nhan: 'Email của tôi', gia: 'a@b.vn' }] }],
    chon: 0,
    heThong: HE_THONG,
  },
} satisfies Record<string, NguCanhThu>;

/** ĐÚNG đường mà khung đi: trang trước, hệ thống sau. Xem `HoiDapPanel.hoi`. */
function traLoiThat(t: NguCanhThu, hoi: string): string | null {
  const chon = t.nguon[t.chon];
  if (chon === undefined) return null;
  const kq = traLoiTrang(t.nguon, chon, hoi) ?? traLoiHeThong(t.heThong, hoi);
  return kq === null ? null : kq.cau;
}

// ─── Danh sách câu hỏi ───────────────────────────────────────────────────────

/** `'chua-hieu'` = ca này ĐÁNG RA phải từ chối trả lời. */
type MongDoi = string[] | 'chua-hieu';

interface Ca {
  trang: keyof typeof TRANG;
  hoi: string;
  can: MongDoi;
  /** Chuỗi KHÔNG được xuất hiện — bắt câu đúng số mà sai trường. */
  khong?: string[];
  /** Ghi chú: ca này có gì đáng chú ý. */
  vi?: string;
}

const CA: Ca[] = [
  // ─── Biểu đồ một chiều: nhóm tính toán ────────────────────────────────────
  { trang: 'bieuDo1', hoi: 'sản phẩm nào có số lượng cao nhất', can: ['Staples', '10'] },
  { trang: 'bieuDo1', hoi: 'product name nào có quantity cao nhất', can: ['Staples', '10'] },
  { trang: 'bieuDo1', hoi: 'cái nào bán được nhiều nhất', can: ['Staples', '10'] },
  { trang: 'bieuDo1', hoi: 'sản phẩm nào ít nhất', can: ['Acco', '4'] },
  { trang: 'bieuDo1', hoi: 'thấp nhất là cái nào', can: ['Acco', '4'] },
  { trang: 'bieuDo1', hoi: 'tổng số lượng là bao nhiêu', can: ['35'] },
  { trang: 'bieuDo1', hoi: 'tổng quantity', can: ['35'] },
  { trang: 'bieuDo1', hoi: 'trung bình mỗi sản phẩm bao nhiêu', can: ['7'] },
  { trang: 'bieuDo1', hoi: 'có bao nhiêu sản phẩm', can: ['5'] },
  { trang: 'bieuDo1', hoi: 'có mấy product name', can: ['5'] },
  { trang: 'bieuDo1', hoi: 'top 3 sản phẩm', can: ['Staples', 'Boston', 'Xerox'] },
  { trang: 'bieuDo1', hoi: 'xếp hạng sản phẩm theo số lượng', can: ['Staples', 'Boston'] },
  { trang: 'bieuDo1', hoi: 'Boston bao nhiêu', can: ['Boston', '9'] },
  { trang: 'bieuDo1', hoi: 'số lượng của Xerox là mấy', can: ['Xerox', '7'] },
  { trang: 'bieuDo1', hoi: 'Boston chiếm bao nhiêu %', can: ['Boston', '25,7 %'] },
  { trang: 'bieuDo1', hoi: 'Boston so với Acco', can: ['Boston', 'Acco', '9', '4'] },
  { trang: 'bieuDo1', hoi: 'đang tăng hay giảm', can: ['Acco', 'Avery'] },

  // ─── Biểu đồ một chiều: nhóm LIỆT KÊ (lời than của người dùng) ────────────
  {
    trang: 'bieuDo1',
    hoi: 'có những sản phẩm nào trên biểu đồ',
    can: ['Staples', 'Acco', 'Boston', 'Xerox', 'Avery'],
    vi: 'Câu người dùng gõ thật, trong ảnh chụp màn hình',
  },
  { trang: 'bieuDo1', hoi: 'liệt kê các sản phẩm', can: ['Staples', 'Acco'] },
  { trang: 'bieuDo1', hoi: 'kể tên các product name', can: ['Staples', 'Acco'] },
  { trang: 'bieuDo1', hoi: 'danh sách sản phẩm', can: ['Staples', 'Acco'] },
  {
    trang: 'bieuDo1',
    hoi: 'liệt kê sản phẩm có số lượng 4',
    can: ['Acco', '1'],
    khong: ['Staples'],
    vi: 'Lọc BẰNG. Trả về cả danh sách là bỏ qua điều kiện người dùng vừa nói',
  },
  {
    trang: 'bieuDo1',
    hoi: 'sản phẩm nào có số lượng trên 6',
    can: ['Boston', 'Staples', 'Xerox'],
    khong: ['Acco'],
  },
  { trang: 'bieuDo1', hoi: 'sản phẩm nào có số lượng dưới 5', can: ['Acco'], khong: ['Boston'] },
  { trang: 'bieuDo1', hoi: 'sản phẩm nào có số lượng từ 9 trở lên', can: ['Boston', 'Staples'] },
  {
    trang: 'bieuDo1',
    hoi: 'liệt kê sản phẩm trên biểu đồ có số lượng 9',
    can: ['Boston', '1'],
    khong: ['Staples'],
    vi: '"trên biểu đồ" KHÔNG phải toán tử lớn hơn',
  },
  { trang: 'bieuDo1', hoi: 'có sản phẩm nào số lượng 99 không', can: ['Không'] },

  // ─── Biểu đồ hai chiều: phải gộp theo ĐÚNG chiều được hỏi ─────────────────
  {
    trang: 'bieuDo2',
    hoi: 'product name nào có quantity cao nhất',
    can: ['Staples', '10'],
    khong: ['Jonathan'],
    vi: 'Phải GỘP theo Product Name. Trả về một CẶP là đúng số, sai câu hỏi',
  },
  {
    trang: 'bieuDo2',
    hoi: 'customer name nào có quantity cao nhất',
    can: ['Jonathan', '13'],
    vi: 'Cùng bảng, chiều khác, câu trả lời khác hẳn',
  },
  { trang: 'bieuDo2', hoi: 'có bao nhiêu customer name', can: ['2'] },
  { trang: 'bieuDo2', hoi: 'tổng quantity', can: ['23'] },
  { trang: 'bieuDo2', hoi: 'liệt kê product name', can: ['Boston', 'Staples', 'Acco'] },

  // ─── Trang danh sách mô hình: so GIỮA các mục ─────────────────────────────
  { trang: 'dsMoHinh', hoi: 'mô hình nào nhiều bảng nhất', can: ['Global-Superstore', '5'] },
  { trang: 'dsMoHinh', hoi: 'mô hình nào được dùng nhiều nhất', can: ['Global-Superstore', '7'] },
  { trang: 'dsMoHinh', hoi: 'datamodel nào nhiều thước đo nhất', can: ['Global-Superstore', '3'] },
  { trang: 'dsMoHinh', hoi: 'mô hình nào ít quan hệ nhất', can: ['Bán hàng'] },
  { trang: 'dsMoHinh', hoi: 'mô hình nào chưa nối quan hệ', can: ['Bán hàng'] },
  { trang: 'dsMoHinh', hoi: 'có bao nhiêu mô hình dữ liệu', can: ['3'] },
  { trang: 'dsMoHinh', hoi: 'mô hình Kho vận có mấy bảng', can: ['2'] },
  { trang: 'dsMoHinh', hoi: 'Bán hàng đã nối đủ quan hệ chưa', can: ['chưa nối đủ'] },

  // ─── Trang Kho dữ liệu ────────────────────────────────────────────────────
  { trang: 'khoDuLieu', hoi: 'Orders có bao nhiêu dòng', can: ['51.290'] },
  { trang: 'khoDuLieu', hoi: 'Orders có mấy cột', can: ['24'] },
  { trang: 'khoDuLieu', hoi: 'bộ dữ liệu nào nhiều dòng nhất', can: ['Orders', '51.290'] },
  {
    trang: 'khoDuLieu',
    hoi: 'Returns có bao nhiêu dòng',
    can: ['1.173', 'bị cắt'],
    vi: 'truncated: con số một mình NÓI DỐI, phải mang điều kiện',
  },
  {
    trang: 'khoDuLieu',
    hoi: 'Orders tạo từ file nào',
    can: ['global-superstore.xlsx'],
    vi: 'Người dùng gõ "file", nhãn ghi "tệp". Khoảng cách từ vựng — bước (5b)',
  },
  {
    trang: 'khoDuLieu',
    hoi: 'cột Sales kiểu dữ liệu gì',
    can: 'chua-hieu',
    vi: 'Trang danh sách chỉ có columnCount. Phải nói chưa biết, không được đoán',
  },

  // ─── Xuyên hệ thống: hỏi từ một trang không dính gì tới dữ liệu ───────────
  { trang: 'hoSo', hoi: 'có bao nhiêu bộ dữ liệu', can: ['12'] },
  { trang: 'hoSo', hoi: 'có bao nhiêu mô hình dữ liệu', can: ['3'] },
  { trang: 'hoSo', hoi: 'mô hình nào nhiều bảng nhất', can: ['Global-Superstore'] },
  { trang: 'hoSo', hoi: 'bộ dữ liệu nào nhiều dòng nhất', can: ['Orders'] },
  { trang: 'hoSo', hoi: 'Orders có bao nhiêu dòng', can: ['51.290'] },

  // ─── Phải TỪ CHỐI: những câu không có số liệu nào trả lời được ────────────
  { trang: 'bieuDo1', hoi: 'hôm nay trời thế nào', can: 'chua-hieu' },
  { trang: 'bieuDo1', hoi: 'ai là người tạo báo cáo này', can: 'chua-hieu' },
  {
    trang: 'khoDuLieu',
    hoi: 'Orders được tạo ngày nào',
    can: 'chua-hieu',
    vi: 'DatasetDto KHÔNG có createdAt — một trong ba điều khung không được hứa',
  },
  {
    trang: 'bieuDo1',
    hoi: 'doanh thu tháng 3 của Miền Bắc',
    can: 'chua-hieu',
    vi: 'Cần một truy vấn MỚI. Đây là trần của thiết kế hiện tại — bước (4)',
  },
];

// ─── Chạy và đếm ─────────────────────────────────────────────────────────────

type KetCuc = 'dung' | 'chuaHieu' | 'sai';

function xu(ca: Ca): { ketCuc: KetCuc; cau: string | null } {
  const cau = traLoiThat(TRANG[ca.trang], ca.hoi);

  if (cau === null) return { ketCuc: ca.can === 'chua-hieu' ? 'dung' : 'chuaHieu', cau };
  // Trả lời một câu đáng ra phải từ chối là SAI, không phải "chưa hiểu".
  if (ca.can === 'chua-hieu') return { ketCuc: 'sai', cau };

  const duCan = ca.can.every((s) => cau.includes(s));
  const coCamKy = (ca.khong ?? []).some((s) => cau.includes(s));
  return { ketCuc: duCan && !coCamKy ? 'dung' : 'sai', cau };
}

describe('Bộ đánh giá khung hỏi đáp', () => {
  const ketQua = CA.map((ca) => ({ ca, ...xu(ca) }));
  const dem = (k: KetCuc): number => ketQua.filter((r) => r.ketCuc === k).length;

  it('in ra bảng điểm', () => {
    const dong = (k: KetCuc, ten: string): string =>
      `  ${ten.padEnd(10)} ${String(dem(k)).padStart(3)}/${String(CA.length)}  ${((dem(k) / CA.length) * 100).toFixed(1)}%`;

    const loi = ketQua
      .filter((r) => r.ketCuc !== 'dung')
      .map(
        (r) =>
          `  [${r.ketCuc === 'sai' ? 'SAI ' : 'CHƯA'}] ${TRANG[r.ca.trang].ten} · "${r.ca.hoi}"\n` +
          `         mong đợi: ${r.ca.can === 'chua-hieu' ? 'từ chối trả lời' : r.ca.can.join(' + ')}\n` +
          `         nhận về : ${r.cau ?? '(chưa hiểu)'}` +
          (r.ca.vi === undefined ? '' : `\n         ghi chú  : ${r.ca.vi}`),
      );

    console.log(
      [
        '',
        `── Bảng điểm trên ${String(CA.length)} câu hỏi ─────────────────────────`,
        '',
        dong('dung', 'ĐÚNG'),
        dong('chuaHieu', 'CHƯA HIỂU'),
        dong('sai', 'SAI'),
        '',
        ...(loi.length === 0 ? ['  (không có ca nào trượt)'] : ['── Ca trượt ──', '', ...loi]),
        '',
      ].join('\n'),
    );

    expect(CA.length).toBeGreaterThan(40);
  });

  /*
   * ⚠️ RÃNH RĂNG. Hai ngưỡng này chỉ được sửa LÊN.
   *
   * Nâng cấp khung thì cập nhật chúng; thấy chúng bị sửa xuống trong một diff
   * nghĩa là thay đổi đó đang đánh đổi câu này lấy câu kia mà không nói ra.
   */
  it('số câu ĐÚNG không được tụt', () => {
    expect(dem('dung')).toBeGreaterThanOrEqual(48);
  });

  it('số câu SAI không được tăng', () => {
    expect(dem('sai')).toBeLessThanOrEqual(2);
  });
});
