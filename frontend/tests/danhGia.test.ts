import type {
  ConnectionDto,
  DataModelDto,
  DatasetDetailDto,
  DatasetDto,
  DatasetPreviewDto,
  FolderDto,
  ReportDataDto,
  WarehouseSchemaDto,
} from '@bi/shared';
import { describe, expect, it } from 'vitest';

import type { HomeDataDto, ReportDto } from '@bi/shared';

import {
  duKienChiTietDataset,
  duKienDanhSachMoHinh,
  duKienThuMuc,
  tongTheoThuMuc,
  tomTatThuMuc,
  duKienBangGia,
  duKienDanhSachBaoCao,
  duKienDanhSachNguoiDung,
  duKienDanhSachToChuc,
  duKienDonHang,
  duKienHoSo,
  duKienKetNoi,
  duKienMotDonHang,
  duKienMotKetNoi,
  duKienMuaGoi,
  duKienPhuongThucThanhToan,
  duKienTongQuanHeThong,
  duKienWorkspace,
  duKienWorkspaceHeThong,
  duKienMoHinh,
  duKienThanhToan,
  duKienThanhVien,
  duKienToChuc,
  duKienKhoDuLieu,
  duKienTrangChu,
  tomTatBoDuLieu,
  tomTatMoHinh,
} from '../src/features/chat/duKienTrang';
import type { Nguon } from '../src/features/chat/nguCanh';
import { traLoiKhung } from '../src/features/chat/traLoi';

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

/**
 * Cùng số liệu như `bangMotChieu`, nhưng nhãn trục đã được ĐẶT TÊN tiếng Việt.
 *
 * `dimensionLabel` của biểu đồ chính là `alias ?? columnName` của cột (xem
 * `services/datamodel/explorer.ts`). Nên đặt tên hiển thị cho cột `Product
 * Name` thành "Sản phẩm" là khung hỏi đáp hiểu tiếng Việt ngay trên máy, không
 * cần mô hình ngôn ngữ — đó là cả nội dung bước (5b) phía trường của người dùng.
 */
function bangDatTenViet(): ReportDataDto {
  return { ...bangMotChieu(), dimensionLabel: 'Sản phẩm', measureLabel: 'Số lượng' };
}

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

/**
 * Đúng biểu đồ trong ảnh người dùng gửi: cột chồng, Khu vực × Nhóm hàng.
 *
 * Tổng theo Nhóm hàng: Gia dụng 302 · Điện tử 290 · Thời trang 263
 * Tổng theo Khu vực:   Miền Trung 310 · Miền Nam 290 · Miền Bắc 255
 *
 * Hai chiều cố ý cho ra hai câu trả lời KHÁC nhau, nên một câu hỏi bị gộp nhầm
 * chiều sẽ lộ ra ngay chứ không trùng đáp án với chiều kia.
 */
function bangKhuVuc(): ReportDataDto {
  const o = (label: string, series: string, value: number) => ({ label, series, value });
  return {
    rows: [
      o('Miền Bắc', 'Gia dụng', 100),
      o('Miền Bắc', 'Điện tử', 80),
      o('Miền Bắc', 'Thời trang', 75),
      o('Miền Nam', 'Gia dụng', 102),
      o('Miền Nam', 'Điện tử', 95),
      o('Miền Nam', 'Thời trang', 93),
      o('Miền Trung', 'Gia dụng', 100),
      o('Miền Trung', 'Điện tử', 115),
      o('Miền Trung', 'Thời trang', 95),
    ],
    dimensionLabel: 'Khu vực',
    measureLabel: 'Số lượng',
    seriesLabel: 'Nhóm hàng',
    grouped: false,
  };
}

/** Trang chủ, đúng những thẻ báo cáo trong ảnh thứ hai. */
function trangChu(): HomeDataDto {
  const bc = (
    id: number,
    name: string,
    chartType: string,
    sourceName: string,
    creatorName: string,
  ): ReportDto =>
    ({
      id,
      name,
      chartType,
      sourceName,
      creatorName,
      source: 'datamodel',
      datamodelId: id,
      datasetId: null,
      folderName: null,
      canvas: null,
      updatedAt: '2026-09-30T00:00:00.000Z',
    }) as unknown as ReportDto;

  return {
    workspace: { id: 1, name: 'HR' },
    stats: { reports: 7, members: 3 },
    reports: [
      bc(1, 'Quantity theo Customer Name', 'bar', 'Global-Superstore', 'dang'),
      bc(2, 'price theo name', 'bar', 'qr order', 'dang'),
      bc(3, 'Số lượng theo Khu vực', 'bar', 'kiem-thu-ban-hang', 'dang'),
      bc(4, 'Quantity theo Product Name', 'bar', 'Global-Superstore', 'Nguyen'),
      bc(5, 'doanh thu theo name', 'pie', 'doanh thu', 'dang'),
    ],
  } as unknown as HomeDataDto;
}

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
  /*
   * CÙNG một tệp với Orders, khác sheet.
   *
   * Cố ý, và nó là cả nội dung của ca "bao nhiêu file excel": một tệp Excel
   * nhiều sheet sinh ra NHIỀU bộ dữ liệu, nên đếm bộ rồi gọi đó là số tệp là
   * một con số có thật trả lời cho câu hỏi khác. Đúng hình trong ảnh chụp màn
   * hình: 24 dòng trong danh sách mà cột NGUỒN chỉ có vài tệp.
   */
  {
    id: 2,
    name: 'People',
    source: 'file',
    rowCount: 2501,
    columnCount: 8,
    truncated: false,
    datamodelCount: 0,
    fileSizeBytes: 8_400_000,
    originalFilename: 'global-superstore.xlsx',
    sheetName: 'People',
  },
  {
    id: 3,
    name: 'Products',
    source: 'file',
    rowCount: 10292,
    columnCount: 6,
    truncated: false,
    datamodelCount: 1,
    fileSizeBytes: 900_000,
    originalFilename: 'products.xlsx',
    sheetName: 'Sheet1',
  },
  {
    id: 4,
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
// 4 bộ dữ liệu, nhưng chỉ 3 TỆP: 2 Excel (global-superstore.xlsx, products.xlsx) + 1 CSV

/**
 * Đúng bảng đang hiện ở tab "Dữ liệu" của một bộ dữ liệu.
 *
 * Cột tiếng Việt, vì đó là thứ tệp Excel của người dùng thật mang theo.
 *
 * Một SẢN PHẨM nằm trên NHIỀU dòng — đó là cả nội dung của nhóm ca này: không
 * gộp thì "sản phẩm nào bán nhiều nhất" trả về dòng đơn lẻ lớn nhất (Boston 9)
 * thay vì tổng của cả sản phẩm (Staples 11) — một con số có thật, câu hỏi khác.
 *
 * Số lượng theo Sản phẩm: Staples 11 · Boston 10 · Acco 2   (tổng 23)
 * Doanh thu theo Sản phẩm: Boston 340 · Staples 200 · Acco 50 (tổng 590)
 * Doanh thu theo Nhóm hàng: Văn phòng 500 · Công nghệ 90
 */
const XEM_TRUOC: DatasetPreviewDto = {
  columns: ['Mã đơn', 'Sản phẩm', 'Nhóm hàng', 'Số lượng', 'Doanh thu'],
  rows: [
    ['DH-1', 'Staples', 'Văn phòng', 6, 120],
    ['DH-2', 'Boston', 'Văn phòng', 9, 300],
    ['DH-3', 'Staples', 'Văn phòng', 5, 80],
    ['DH-4', 'Acco', 'Công nghệ', 2, 50],
    ['DH-5', 'Boston', 'Công nghệ', 1, 40],
  ],
  limit: 50,
};

/** Cột thư mục bên trái bảng Kho dữ liệu — §7.9. */
const THU_MUC: FolderDto[] = [
  { id: 2, name: 'Bán hàng', itemCount: 5 },
  { id: 3, name: 'Thử nghiệm', itemCount: 1 },
].map((t) => ({ ...t, workspaceId: 1, createdAt: '', updatedAt: '' }) as FolderDto);

/**
 * Số bộ dữ liệu CHƯA xếp thư mục — `chungCount` của `GET /dataset-folders`.
 *
 * ⚠️ "Chung" KHÔNG phải một thư mục. Backend cố ý không trả nó trong `items`
 * (xem route `/report-folders`), nên một fixture nhét nó vào danh sách thư mục
 * là một fixture không bao giờ xảy ra — và nó che mất đúng chỗ lỗi: trang Kho
 * dữ liệu MẶC ĐỊNH lọc theo Chung, nên `total` của danh sách là 4 chứ không
 * phải 10 bộ dữ liệu thật sự có trong workspace.
 */
const CHUNG_COUNT = BO_DU_LIEU.length;

/**
 * Cấu trúc bảng trong kho phân tích — tab "Cấu trúc".
 *
 * Kiểu ở đây CỐ Ý khác kiểu nguồn trong `CHI_TIET`: nguồn nói `decimal(18,2)`, kho
 * nói `Nullable(Float64)`. Hai thứ lệch nhau là chuyện bình thường, và chính chỗ
 * lệch là thứ người dùng mở tab ấy ra để xem — nên một ca trả nhầm sang kiểu
 * nguồn sẽ lộ ra ngay.
 */
const KHO: WarehouseSchemaDto = {
  table: 'ds_1_orders',
  columns: [
    { ordinal: 0, name: 'Mã đơn', type: 'String', nullable: false },
    { ordinal: 1, name: 'Sản phẩm', type: 'String', nullable: false },
    { ordinal: 2, name: 'Doanh thu', type: 'Nullable(Float64)', nullable: true },
  ],
};

const CHI_TIET: DatasetDetailDto = {
  ...(BO_DU_LIEU[0] as DatasetDto),
  columns: [
    { name: 'Mã đơn', dataType: 'varchar(50)', semanticType: 'text' },
    { name: 'Sản phẩm', dataType: 'varchar(255)', semanticType: 'text' },
    { name: 'Nhóm hàng', dataType: 'varchar(100)', semanticType: 'text' },
    { name: 'Số lượng', dataType: 'int', semanticType: 'number' },
    { name: 'Doanh thu', dataType: 'decimal(18,2)', semanticType: 'number' },
  ],
  file: null,
} as unknown as DatasetDetailDto;

const KET_NOI: ConnectionDto[] = [
  {
    id: 1,
    name: 'MySQL bán hàng',
    kind: 'mysql',
    host: 'db.local',
    port: 3306,
    databaseName: 'sales',
    useSsl: false,
    datasetCount: 2,
    lastTestedAt: null,
    lastTestError: null,
  },
  {
    id: 2,
    name: 'Postgres kho',
    kind: 'postgres',
    host: 'pg.local',
    port: 5432,
    databaseName: 'wh',
    useSsl: true,
    datasetCount: 0,
    lastTestedAt: null,
    lastTestError: null,
  },
].map((c) => c as unknown as ConnectionDto);

/**
 * Danh sách xuyên hệ thống, dựng bằng ĐÚNG mấy hàm mà `useNguCanhHeThong` dùng.
 *
 * Chép tay một bản "gần giống" là bộ này đo một khung khác với khung đang chạy
 * thật — và chính những câu "hỏi từ trang bất kỳ" mới là thứ phụ thuộc vào
 * danh sách này được dựng đúng.
 *
 * `tong` cố ý LỚN hơn số mục (12 so với 4): đó là chuyện bình thường của một
 * danh sách phân trang, và nó bắt mọi phép đếm phải mang vế điều kiện.
 */
const HE_THONG: Nguon[] = [
  {
    ten: 'Tổng quan toàn tổ chức',
    duKien: [
      ...tomTatBoDuLieu(BO_DU_LIEU, 12, 'trong toàn bộ tổ chức'),
      ...tomTatMoHinh(MO_HINH, 3, 'trong toàn bộ tổ chức'),
      ...(duKienKetNoi(KET_NOI)[0]?.duKien ?? []),
      ...(duKienTrangChu(trangChu())[0]?.duKien ?? []),
    ],
  },
  ...duKienKhoDuLieu(BO_DU_LIEU, 12).slice(1),
  ...duKienDanhSachMoHinh(MO_HINH, 3).slice(1),
  ...duKienKetNoi(KET_NOI).slice(1),
  ...duKienTrangChu(trangChu()).slice(1),
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
    // Dựng ĐÚNG như `DatasetsPage`: thư mục nối vào bản tóm tắt, không thành chip.
    nguon: ((): Nguon[] => {
      // `BO_DU_LIEU` là 4 bộ của thư mục CHUNG — đúng thứ trang hiện ra khi vừa
      // mở, vì `DEFAULTS.folder` là Chung. Workspace thật có 4 + 5 + 1 = 10.
      const n = duKienKhoDuLieu(BO_DU_LIEU, tongTheoThuMuc(CHUNG_COUNT, THU_MUC));
      const tom = n[0];
      if (tom !== undefined) n[0] = { ...tom, duKien: [...tom.duKien, ...tomTatThuMuc(THU_MUC)] };
      return [...n, ...duKienThuMuc(THU_MUC)];
    })(),
    chon: 0,
    heThong: HE_THONG,
  },
  bieuDoViet: {
    ten: 'Báo cáo — biểu đồ đã đặt tên tiếng Việt',
    nguon: [{ ten: 'Số lượng theo Sản phẩm', duKien: [], bang: bangDatTenViet() }],
    chon: 0,
    heThong: HE_THONG,
  },
  bieuDoKhuVuc: {
    ten: 'Báo cáo — Số lượng theo Khu vực (cột chồng)',
    nguon: [{ ten: 'Số lượng theo Khu vực', duKien: [], bang: bangKhuVuc() }],
    chon: 0,
    heThong: HE_THONG,
  },
  trangChu: {
    ten: 'Trang chủ',
    nguon: duKienTrangChu(trangChu()),
    chon: 0,
    heThong: HE_THONG,
  },
  // Trang chi tiết một bộ dữ liệu, CÓ bảng dữ liệu thật đang hiện.
  chiTietDataset: {
    ten: 'Chi tiết bộ dữ liệu (có bảng dữ liệu)',
    nguon: duKienChiTietDataset(CHI_TIET, XEM_TRUOC, KHO),
    chon: 0,
    heThong: HE_THONG,
  },
  // Một trang KHÔNG dính gì tới dữ liệu — để đo nhóm câu hỏi xuyên hệ thống.
  /*
   * Trang chi tiết một mô hình — để đo nhóm câu về QUAN HỆ giữa các bảng, thứ
   * tab Quan hệ vẽ rõ trên màn hình mà khung từng chỉ biết đếm.
   */
  moHinh: {
    ten: 'Mô hình dữ liệu (có quan hệ)',
    nguon: duKienMoHinh({
      id: 1,
      name: 'Bán hàng',
      datasets: [],
      measures: [],
      creatorName: 'Mai',
      relationships: [
        {
          id: 1,
          kind: 'one_to_many',
          createdAt: '2026-01-01T00:00:00.000Z',
          left: { datasetRef: 1, datasetName: 'Orders', columnId: 1, columnName: 'customer_id' },
          right: { datasetRef: 2, datasetName: 'Customers', columnId: 2, columnName: 'id' },
        },
      ],
    } as unknown as Parameters<typeof duKienMoHinh>[0]),
    chon: 0,
    heThong: HE_THONG,
  },
  hoSo: {
    ten: 'Hồ sơ cá nhân',
    nguon: [{ ten: 'Hồ sơ của tôi', duKien: [{ nhan: 'Email của tôi', gia: 'a@b.vn' }] }],
    chon: 0,
    heThong: HE_THONG,
  },
} satisfies Record<string, NguCanhThu>;

/* ═══ Năm trang CHƯA TỪNG được đo ═══════════════════════════════════════════
 *
 * Bộ này phủ 7 trang; khung thì có builder cho 30. Mười lăm trang còn lại chưa
 * có một ca nào, nên "trang nào cũng trả lời chính xác" ở đó là một lời khẳng
 * định chứ không phải một con số. Năm trang dưới đây là năm trang người dùng
 * mở nhiều nhất trong số ấy.
 */

const BAO_CAO = [
  {
    id: 1,
    name: 'Doanh thu 2026',
    source: 'datamodel',
    sourceName: 'Bán hàng',
    chartType: 'bar',
    canvas: null,
    folderName: null,
    creatorName: 'Mai',
    updatedAt: '2026-03-02T03:00:00.000Z',
  },
  {
    id: 2,
    name: 'Tồn kho',
    source: 'dataset',
    sourceName: 'Kho Q1',
    chartType: 'line',
    canvas: { pages: [{ id: 'p1', name: 'Trang 1', visuals: [{ id: 'v1' }, { id: 'v2' }] }] },
    folderName: 'Vận hành',
    creatorName: 'Hùng',
    updatedAt: '2026-03-05T03:00:00.000Z',
  },
] as unknown as Parameters<typeof duKienDanhSachBaoCao>[0];

const THANH_VIEN = [
  {
    id: 1,
    fullName: 'Trần Thu Hà',
    email: 'ha@congty.vn',
    role: 'admin',
    jobTitle: 'Trưởng phòng dữ liệu',
    joinedAt: '2025-11-01T03:00:00.000Z',
    lastLoginAt: '2026-03-10T03:00:00.000Z',
    removedAt: null,
    memberActive: true,
    userActive: true,
  },
  {
    id: 2,
    fullName: 'Lê Minh',
    email: 'minh@congty.vn',
    role: 'viewer',
    jobTitle: null,
    joinedAt: '2026-01-15T03:00:00.000Z',
    lastLoginAt: null,
    removedAt: null,
    memberActive: false,
    userActive: true,
  },
] as unknown as Parameters<typeof duKienThanhVien>[0];

const THANH_TOAN = {
  plan: { id: 2, name: 'Pro', priceVnd: 2_000_000, durationDays: 30 },
  subscription: { status: 'active', periodEnd: '2026-04-01T03:00:00.000Z' },
  usage: {
    workspaces: { used: 3, limit: 10 },
    reports: { used: 12, limit: 50 },
    members: { used: 4, limit: null },
    storageBytes: { used: 1_048_576, limit: 10_737_418_240 },
  },
} as unknown as Parameters<typeof duKienThanhToan>[0];

const TRANG_THEM = {
  dsBaoCao: {
    ten: 'Báo cáo (danh sách)',
    nguon: duKienDanhSachBaoCao(BAO_CAO, 7),
    chon: 0,
    heThong: HE_THONG,
  },
  thanhVien: {
    ten: 'Thành viên',
    nguon: duKienThanhVien(THANH_VIEN, 2),
    chon: 0,
    heThong: HE_THONG,
  },
  ketNoi: {
    ten: 'Kết nối',
    nguon: duKienKetNoi(KET_NOI),
    chon: 0,
    heThong: HE_THONG,
  },
  thanhToan: {
    ten: 'Thanh toán',
    nguon: duKienThanhToan(THANH_TOAN),
    chon: 0,
    heThong: HE_THONG,
  },
  toChuc: {
    ten: 'Tổ chức',
    nguon: duKienToChuc({ name: 'Công ty ABC', slug: 'cong-ty-abc' }),
    chon: 0,
    heThong: HE_THONG,
  },
} satisfies Record<string, NguCanhThu>;

/* ═══ Mười ba trang CÒN LẠI ═════════════════════════════════════════════════
 *
 * Đợt trước đo 5 trang và lần chạy ĐẦU TIÊN đỏ 2 câu SAI. Không có lý do gì để
 * tin mấy trang chưa đo còn lại sạch hơn, nên đo nốt — kể cả khu /admin, nơi
 * một câu trả lời sai đi tới người vận hành chứ không tới người dùng cuối.
 *
 * ⚠️ Bốn ca ở đây canh BẢO MẬT, không đo chất lượng: số tài khoản nhận tiền,
 * thông tin đăng nhập CSDL, chuỗi QR. Chúng CỐ Ý không nằm trong bản khai, và
 * một câu trả lời ở đó còn đi tiếp lên mô hình ngôn ngữ của hãng thứ ba qua
 * lớp diễn đạt. Ca đỏ ở đây nghĩa là có người vừa khai thêm một thứ không
 * được phép khai.
 */

const GOI = [
  {
    id: 2,
    name: 'Pro',
    priceVnd: 2_000_000,
    durationDays: 30,
    maxWorkspaces: 10,
    maxReports: 50,
    maxMembers: null,
    maxStorageBytes: 10_737_418_240,
    description: 'Gói cho đội nhỏ',
  },
] as unknown as Parameters<typeof duKienBangGia>[0];

const DON = [
  {
    id: 9,
    orderCode: 'DH2026030001',
    planName: 'Pro',
    amountVnd: 2_000_000,
    status: 'pending',
    paymentMethodName: 'Chuyển khoản SePay',
    createdAt: '2026-03-01T03:00:00.000Z',
    paidAt: null,
  },
] as unknown as Parameters<typeof duKienDonHang>[0];

const PHUONG_THUC = [
  { id: 1, name: 'Chuyển khoản SePay', provider: 'sepay', isActive: true, isConfigured: false },
  { id: 2, name: 'Tiền mặt', provider: 'manual', isActive: false, isConfigured: true },
] as unknown as Parameters<typeof duKienPhuongThucThanhToan>[0];

const TONG_QUAN = {
  activeTenants: 12,
  lockedTenants: 2,
  totalUsers: 87,
  lockedUsers: 3,
  totalWorkspaces: 41,
  rangeDays: 30,
} as unknown as Parameters<typeof duKienTongQuanHeThong>[0];

const TO_CHUC_HT = [
  {
    id: 1,
    name: 'Công ty ABC',
    userCount: 14,
    workspaceCount: 3,
    isActive: true,
    isPersonal: false,
    createdAt: '2025-06-01T03:00:00.000Z',
  },
  {
    id: 2,
    name: 'Không gian của Hùng',
    userCount: 1,
    workspaceCount: 1,
    isActive: false,
    isPersonal: true,
    createdAt: '2026-01-02T03:00:00.000Z',
  },
] as unknown as Parameters<typeof duKienDanhSachToChuc>[0];

const NGUOI_DUNG_HT = [
  {
    id: 1,
    fullName: 'Phạm Quốc Bảo',
    email: 'bao@hethong.vn',
    jobTitle: 'Vận hành',
    platformRole: 'superadmin',
    tenants: [
      { id: 1, name: 'Công ty ABC' },
      { id: 2, name: 'Kho tổng' },
    ],
    isActive: true,
    lastLoginAt: '2026-03-09T03:00:00.000Z',
  },
] as unknown as Parameters<typeof duKienDanhSachNguoiDung>[0];

const WS_HT = [
  {
    id: 5,
    name: 'Phân tích',
    tenantName: 'Công ty ABC',
    reportCount: 18,
    isActive: true,
    description: 'Khu báo cáo của phòng phân tích',
    createdAt: '2025-09-01T03:00:00.000Z',
  },
] as unknown as Parameters<typeof duKienWorkspaceHeThong>[0];

const TRANG_NOT = {
  bangGia: { ten: 'Bảng giá', nguon: duKienBangGia(GOI), chon: 0, heThong: HE_THONG },
  donHang: { ten: 'Đơn hàng', nguon: duKienDonHang(DON, 4), chon: 0, heThong: HE_THONG },
  muaGoi: {
    ten: 'Mua gói',
    nguon: duKienMuaGoi(GOI[0], 'yearly'),
    chon: 0,
    heThong: HE_THONG,
  },
  motDonHang: {
    ten: 'Một đơn hàng',
    nguon: duKienMotDonHang(DON[0]),
    chon: 0,
    heThong: HE_THONG,
  },
  motKetNoi: {
    ten: 'Sửa một kết nối',
    nguon: duKienMotKetNoi(KET_NOI[0] ?? null),
    chon: 0,
    heThong: HE_THONG,
  },
  wsCuaToi: {
    ten: 'Workspace của tôi',
    nguon: duKienWorkspace([
      { id: 1, name: 'Phân tích' },
      { id: 2, name: 'Vận hành' },
    ]),
    chon: 0,
    heThong: HE_THONG,
  },
  hoSoThat: {
    ten: 'Hồ sơ (bản khai thật)',
    nguon: duKienHoSo({ fullName: 'Trần Thu Hà', email: 'ha@congty.vn', jobTitle: 'Trưởng phòng' }),
    chon: 0,
    heThong: HE_THONG,
  },
  adminTongQuan: {
    ten: 'Console — Tổng quan',
    nguon: duKienTongQuanHeThong(TONG_QUAN),
    chon: 0,
    heThong: HE_THONG,
  },
  adminToChuc: {
    ten: 'Console — Tổ chức',
    nguon: duKienDanhSachToChuc(TO_CHUC_HT, 14),
    chon: 0,
    heThong: HE_THONG,
  },
  adminNguoiDung: {
    ten: 'Console — Người dùng',
    nguon: duKienDanhSachNguoiDung(NGUOI_DUNG_HT, 87),
    chon: 0,
    heThong: HE_THONG,
  },
  adminWorkspace: {
    ten: 'Console — Workspace',
    nguon: duKienWorkspaceHeThong(WS_HT, 41),
    chon: 0,
    heThong: HE_THONG,
  },
  adminThanhToan: {
    ten: 'Console — Phương thức thanh toán',
    nguon: duKienPhuongThucThanhToan(PHUONG_THUC),
    chon: 0,
    heThong: HE_THONG,
  },
} satisfies Record<string, NguCanhThu>;

/** ĐÚNG đường mà khung đi — cùng một hàm, xem `traLoiKhung`. */
function traLoiThat(
  t: NguCanhThu,
  hoi: string,
  truoc: string | null = null,
  chip?: number,
): string | null {
  const chon = t.nguon[chip ?? t.chon];
  if (chon === undefined) return null;
  const kq = traLoiKhung(t.nguon, chon, t.heThong, hoi, truoc);
  return kq === null ? null : kq.cau;
}

// ─── Danh sách câu hỏi ───────────────────────────────────────────────────────

/** `'chua-hieu'` = ca này ĐÁNG RA phải từ chối trả lời. */
type MongDoi = string[] | 'chua-hieu';

const MOI_TRANG = { ...TRANG, ...TRANG_THEM, ...TRANG_NOT };

interface Ca {
  trang: keyof typeof MOI_TRANG;
  hoi: string;
  can: MongDoi;
  /** Chuỗi KHÔNG được xuất hiện — bắt câu đúng số mà sai trường. */
  khong?: string[];
  /** Ghi chú: ca này có gì đáng chú ý. */
  vi?: string;
  /** Câu người dùng hỏi ở lượt TRƯỚC — để đo nhóm câu hỏi tiếp. */
  truoc?: string;
  /**
   * Chip đang chọn, khi ca này đo một chip CỤ THỂ chứ không phải chip mặc định.
   *
   * ⚠️ Cần vì chip mặc định ĐỔI ĐƯỢC. Thêm nguồn tóm tắt vào Kho dữ liệu đẩy
   * `Orders` từ chip 0 xuống chip 1, và ca "cột Sales kiểu dữ liệu gì" lập tức
   * chuyển xanh — không phải vì lỗi đã được sửa mà vì nó đang đo một chip khác.
   * Ghim chỉ số lại là cách để một ca xanh vì đúng cái lí do tên nó nói.
   */
  chip?: number;
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
  {
    trang: 'bieuDo1',
    hoi: 'Boston có bao nhiêu',
    can: ['Boston', '9'],
    khong: ['Có 5'],
    vi: 'Ý định ĐẾM nhưng gọi tên một nhóm — hỏi GIÁ TRỊ của nhóm, không hỏi số nhóm',
  },
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

  // ─── Cột đã đặt tên tiếng Việt: hiểu được NGAY TRÊN MÁY, không cần mô hình ─
  //
  // Nhóm này đo đường (5b) phía trường của NGƯỜI DÙNG. Ta không đoán được họ
  // gọi `Product Name` là gì, nên họ tự khai — bằng ô "Tên hiển thị" ở tab Cấu
  // trúc, thứ đã có từ trước và vừa được nói ra ở ngay trên bảng đó.
  { trang: 'bieuDoViet', hoi: 'sản phẩm nào có số lượng cao nhất', can: ['Staples', '10'] },
  { trang: 'bieuDoViet', hoi: 'sản phẩm nào ít nhất', can: ['Acco', '4'] },
  { trang: 'bieuDoViet', hoi: 'có những sản phẩm nào', can: ['Staples', 'Acco', 'Avery'] },
  { trang: 'bieuDoViet', hoi: 'có bao nhiêu sản phẩm', can: ['5'] },
  { trang: 'bieuDoViet', hoi: 'tổng số lượng', can: ['35'] },
  { trang: 'bieuDoViet', hoi: 'liệt kê sản phẩm có số lượng 4', can: ['Acco'], khong: ['Staples'] },
  { trang: 'bieuDoViet', hoi: 'top 3 sản phẩm', can: ['Staples', 'Boston', 'Xerox'] },

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

  // ─── Ảnh 1: "<X> nào" nói rõ câu trả lời phải là X ────────────────────────
  //
  // ⚠️ Lỗi người dùng gặp thật: "miền nào có nhóm hàng cao nhất" được trả lời
  // bằng "Nhóm hàng cao nhất là Gia dụng" — đúng số, SAI THỨ ĐƯỢC HỎI. Chữ
  // đứng trước "nào" mới là thứ người ta muốn nghe tên.
  {
    trang: 'bieuDoKhuVuc',
    hoi: 'miền nào có nhóm hàng cao nhất',
    can: ['Miền Trung', '310'],
    khong: ['Gia dụng'],
    vi: 'Ảnh chụp màn hình người dùng gửi',
  },
  {
    trang: 'bieuDoKhuVuc',
    hoi: 'khu vực nào có số lượng cao nhất',
    can: ['Miền Trung', '310'],
    khong: ['Gia dụng'],
  },
  {
    trang: 'bieuDoKhuVuc',
    hoi: 'nhóm hàng nào có số lượng cao nhất',
    can: ['Gia dụng', '302'],
    khong: ['Miền Trung'],
  },
  { trang: 'bieuDoKhuVuc', hoi: 'có những miền nào', can: ['Miền Bắc', 'Miền Nam', 'Miền Trung'] },
  { trang: 'bieuDoKhuVuc', hoi: 'có bao nhiêu miền', can: ['3'] },
  { trang: 'bieuDoKhuVuc', hoi: 'miền nào ít nhất', can: ['Miền Bắc', '255'] },

  // ─── Ảnh 1: hỏi TIẾP, không phải hỏi lại từ đầu ──────────────────────────
  //
  // ⚠️ Lỗi người dùng gặp thật: hỏi "miền nào có nhóm hàng cao nhất" rồi hỏi
  // tiếp "ở miền nào", và khung trả lời "Có 3 khu vực là Miền Bắc, Miền Nam và
  // Miền Trung" — nó quên sạch lượt vừa rồi và trả lời câu mới như một câu độc
  // lập.
  {
    trang: 'bieuDoKhuVuc',
    hoi: 'ở miền nào',
    truoc: 'nhóm hàng nào có số lượng cao nhất',
    can: ['Miền Trung', '310'],
    vi: 'Ảnh chụp màn hình người dùng gửi',
  },
  {
    trang: 'bieuDoKhuVuc',
    hoi: 'còn nhóm hàng thì sao',
    truoc: 'miền nào có số lượng cao nhất',
    can: ['Gia dụng', '302'],
  },
  {
    trang: 'bieuDoKhuVuc',
    hoi: 'vậy thấp nhất thì sao',
    truoc: 'miền nào có số lượng cao nhất',
    can: ['Miền Bắc', '255'],
  },
  /*
   * ⚠️ Ca canh chiều NGƯỢC LẠI của bộ nhớ: nối lượt trước vào MỌI câu chưa trả
   * lời được là mở đường cho một kiểu sai rất khó thấy. Câu này dài đúng bằng
   * câu hỏi tiếp ở trên, nên đếm số từ không cứu được — thứ phân biệt chúng là
   * chữ MỞ ĐẦU.
   */
  {
    trang: 'bieuDoKhuVuc',
    hoi: 'hôm nay trời thế nào',
    truoc: 'miền nào có số lượng cao nhất',
    can: 'chua-hieu',
  },
  /*
   * Và một câu TỰ NÓ ĐỦ NGHĨA phải được trả lời bằng chính nó, không bị lượt
   * trước bẻ lái — dù nó bắt đầu bằng một chữ nối tiếp.
   */
  {
    trang: 'bieuDoKhuVuc',
    hoi: 'của Miền Nam là bao nhiêu',
    truoc: 'nhóm hàng nào có số lượng cao nhất',
    can: ['Miền Nam', '290'],
  },

  /*
   * ─── Hỏi tiếp mà KHÔNG có chữ mở đầu ──────────────────────────────────────
   *
   * Năm ca trên đều mở đầu bằng "ở", "còn", "vậy", "của" — đúng danh sách mà
   * `laNoiTiep` nhận ra. Người ta còn nói kiểu khác: bỏ hẳn chữ nối, gõ thẳng
   * thứ muốn đổi. Bốn ca dưới đo đúng khoảng đó, và ca cuối là ca ĐỐI CHỨNG:
   * nới bộ nhớ ra thì không được nới luôn cho một câu chẳng liên quan.
   */
  {
    trang: 'bieuDoKhuVuc',
    hoi: 'nhóm hàng thì sao',
    truoc: 'miền nào có số lượng cao nhất',
    can: ['Gia dụng', '302'],
    vi: 'Y hệt ca "còn nhóm hàng thì sao" ở trên, chỉ bỏ chữ "còn"',
  },
  {
    trang: 'bieuDoKhuVuc',
    hoi: 'thấp nhất thì sao',
    truoc: 'miền nào có số lượng cao nhất',
    can: ['Miền Bắc', '255'],
    vi: 'Y hệt ca "vậy thấp nhất thì sao" ở trên, chỉ bỏ chữ "vậy"',
  },
  {
    trang: 'bieuDoKhuVuc',
    hoi: 'Miền Nam là bao nhiêu',
    truoc: 'nhóm hàng nào có số lượng cao nhất',
    can: ['Miền Nam', '290'],
    vi: 'Y hệt ca "của Miền Nam là bao nhiêu" ở trên, chỉ bỏ chữ "của"',
  },
  {
    trang: 'bieuDoKhuVuc',
    hoi: 'ăn gì bây giờ',
    truoc: 'miền nào có số lượng cao nhất',
    can: 'chua-hieu',
    vi: 'ĐỐI CHỨNG — câu lạc không chữ mở đầu, nối vào vẫn phải bị từ chối',
  },
  {
    trang: 'bieuDoKhuVuc',
    hoi: 'Gia dụng bao nhiêu',
    truoc: 'miền nào có số lượng cao nhất',
    can: ['Gia dụng', '302'],
    khong: ['Miền Trung'],
    vi: 'Hỏi tổng của một giá trị CHUỖI — cộng qua cả ba Khu vực',
  },

  {
    trang: 'bieuDoKhuVuc',
    hoi: 'Điện tử là bao nhiêu',
    can: ['Điện tử', '290'],
    khong: ['115'],
    vi: 'MỘT Ô của cột chồng là 115; câu hỏi về cả mảng màu thì phải là 290',
  },
  { trang: 'bieuDoKhuVuc', hoi: 'Thời trang bao nhiêu', can: ['Thời trang', '263'] },

  // ─── Quan hệ giữa các bảng: tab Quan hệ vẽ rõ, khung từng chỉ biết đếm ───
  {
    trang: 'moHinh',
    hoi: 'Orders nối với Customers qua cột nào',
    can: ['customer_id', 'id'],
  },
  {
    trang: 'moHinh',
    hoi: 'quan hệ giữa Orders và Customers là gì',
    can: ['Một → nhiều'],
    vi: 'KIỂU nối là thứ quyết định một phép SUM có bị nhân bản hay không',
  },
  { trang: 'moHinh', hoi: 'mô hình này có mấy quan hệ', can: ['1'] },

  // ─── Ảnh 2: trang chủ có các thẻ báo cáo, mắt thường nhìn thấy ────────────
  //
  // ⚠️ Lỗi người dùng gặp thật: màn hình hiện rõ năm thẻ báo cáo kèm nhãn
  // "Biểu đồ cột", mà khung nói "không có mục nào trả lời được câu này".
  {
    trang: 'trangChu',
    hoi: 'hãy liệt kê các báo cáo biểu đồ cột',
    can: ['Quantity theo Customer Name', 'price theo name'],
    khong: ['doanh thu theo name'],
    vi: 'Ảnh chụp màn hình người dùng gửi',
  },
  { trang: 'trangChu', hoi: 'có bao nhiêu báo cáo biểu đồ cột', can: ['4'] },
  { trang: 'trangChu', hoi: 'báo cáo nào là biểu đồ tròn', can: ['doanh thu theo name'] },
  {
    trang: 'trangChu',
    hoi: 'báo cáo Số lượng theo Khu vực dùng mô hình nào',
    can: ['kiem-thu-ban-hang'],
  },
  { trang: 'trangChu', hoi: 'ai tạo báo cáo Quantity theo Product Name', can: ['Nguyen'] },
  { trang: 'trangChu', hoi: 'có bao nhiêu báo cáo', can: ['7'] },
  {
    trang: 'trangChu',
    hoi: 'số báo cáo của sale',
    can: 'chua-hieu',
    vi: 'KHÔNG có workspace nào tên Sales — "sale" không khớp chỗ nào, nên từ chối',
  },

  // ─── Trang danh sách mô hình: so GIỮA các mục ─────────────────────────────
  { trang: 'dsMoHinh', hoi: 'mô hình nào nhiều bảng nhất', can: ['Global-Superstore', '5'] },
  { trang: 'dsMoHinh', hoi: 'mô hình nào được dùng nhiều nhất', can: ['Global-Superstore', '7'] },
  { trang: 'dsMoHinh', hoi: 'datamodel nào nhiều thước đo nhất', can: ['Global-Superstore', '3'] },
  { trang: 'dsMoHinh', hoi: 'mô hình nào ít quan hệ nhất', can: ['Bán hàng'] },
  { trang: 'dsMoHinh', hoi: 'mô hình nào chưa nối quan hệ', can: ['Bán hàng'] },
  { trang: 'dsMoHinh', hoi: 'có bao nhiêu mô hình dữ liệu', can: ['3'] },
  { trang: 'dsMoHinh', hoi: 'mô hình Kho vận có mấy bảng', can: ['2'] },
  { trang: 'dsMoHinh', hoi: 'Bán hàng đã nối đủ quan hệ chưa', can: ['chưa nối đủ'] },

  /*
   * ─── DỰNG TỪ ẢNH CHỤP MÀN HÌNH (đợt 2) ───────────────────────────────
   *
   * Hai câu này cùng một hình dạng: "ĐẾM bao nhiêu mục thoả một điều kiện".
   * Khung cũ không có hình dạng đó: nó trả lời được "mục NÀO chưa có X" nhưng
   * không trả lời được "BAO NHIÊU mục chưa có X" — cùng một phép đếm, khác
   * mỗi chữ để hỏi.
   *
   * Trong ảnh, câu dưới được trả lời bằng "Tên các mô hình đang hiện: …" —
   * một danh sách CÓ THẬT cho một câu hỏi khác, do mô hình chọn bừa một nhãn
   * khi mọi phép so ngoại tuyến đã trượt. Đúng kiểu SAI nguy hiểm nhất.
   */
  {
    trang: 'dsMoHinh',
    hoi: 'bao nhiêu datamodel chưa kết nối khóa chính và các quan hệ',
    can: ['1', 'Bán hàng'],
    khong: ['Kho vận'],
    vi: 'Ảnh chụp màn hình: nhận về "Tên các mô hình đang hiện" — mô hình chọn bừa một nhãn',
  },
  { trang: 'dsMoHinh', hoi: 'có bao nhiêu mô hình chưa nối đủ quan hệ', can: ['1', 'Bán hàng'] },
  /*
   * Đếm trên một cột MÀ KHÔNG AI KHAI SẴN MỘT PHÉP ĐẾM CHO NÓ.
   *
   * Hai ca ngay trên được trả lời bằng dữ kiện "Số mô hình chưa nối đủ quan
   * hệ" — một phép đếm viết tay trong `tomTatMoHinh`. Ca này thì không: không
   * nguồn nào khai "số bộ dữ liệu chưa có mô hình nào dùng", nên nó chỉ ra
   * được kết quả nếu `soSanhNguon` TỰ đếm trên cột đó.
   *
   * ⚠️ Câu cố ý KHÔNG có chữ "nào". Có "nào" thì cửa cũ đã mở, và ca này sẽ
   * xanh dù cửa ĐẾM bị bỏ đi — một ca xanh vì lý do khác với tên nó nói.
   */
  {
    trang: 'khoDuLieu',
    hoi: 'bao nhiêu bộ dữ liệu chưa có mô hình dùng',
    can: ['1', 'People'],
  },

  // ─── Trang Kho dữ liệu ────────────────────────────────────────────────────
  { trang: 'khoDuLieu', hoi: 'Orders có bao nhiêu dòng', can: ['51.290'] },
  { trang: 'khoDuLieu', hoi: 'Orders có mấy cột', can: ['24'] },
  /*
   * ─── THƯ MỤC: cột bên trái bảng, trước đó không trang nào khai ──────────
   */
  { trang: 'khoDuLieu', hoi: 'có bao nhiêu thư mục', can: ['2'] },
  { trang: 'khoDuLieu', hoi: 'thư mục Bán hàng đang có mấy mục', can: ['5'] },
  {
    trang: 'khoDuLieu',
    hoi: 'có bao nhiêu bộ dữ liệu',
    /*
     * ⚠️ 10, KHÔNG phải 4.
     *
     * Trang Kho dữ liệu mặc định lọc theo thư mục Chung (`DEFAULTS.folder`), nên
     * `total` của danh sách chỉ là số bộ CHƯA xếp thư mục. Khai con số ấy dưới
     * nhãn "Số bộ dữ liệu trong workspace này" là một con số có thật trả lời cho
     * một câu hỏi khác — và nó sai ngay khi người dùng vừa mở trang, không cần
     * ai bấm gì.
     *
     * Tổng thật dựng từ chính cột thư mục đang hiện bên trái: Chung + từng thư
     * mục. Không thêm một request nào.
     */
    can: ['10'],
    khong: ['4'],
    vi: 'Kho dữ liệu là danh sách DUY NHẤT không có nguồn tóm tắt — lệch khỏi mọi trang khác',
  },
  {
    trang: 'khoDuLieu',
    hoi: 'liệt kê các bộ dữ liệu đang có',
    can: ['Orders'],
    vi: '"liệt" là từ khoá Ý ĐỊNH, không phải tên một thứ — không được coi là thực thể lạ',
  },
  {
    trang: 'khoDuLieu',
    hoi: 'Orders đang ở trạng thái phân tích nào',
    can: ['đã nạp'],
    vi:
      '"phân", "tích" chỉ có trong GIÁ TRỊ ("đã nạp vào kho phân tích"), không có ' +
      'trong nhãn nào. Không nạp giá trị vào vốn từ thì câu này bị từ chối oan.',
  },
  {
    trang: 'khoDuLieu',
    hoi: 'kiểm tra xem nó có bao nhiêu file excel',
    can: ['Excel', '2'],
    // Một câu liệt kê tên bộ dữ liệu là dấu hiệu nó đã đếm BỘ thay vì đếm TỆP.
    khong: ['Orders'],
    vi: 'Ảnh chụp màn hình: "không có mục nào trả lời được" — trang không khai TỆP nào cả',
  },

  // ─── Người dùng gõ từ của HỌ, không gõ từ trên nhãn ───────────────────────
  //
  // Nhóm này đo khoảng cách từ vựng. Mấy nhãn ở đây do CHÍNH hệ thống viết
  // ("tệp", "dòng", "cột"), mà người dùng thì gõ "file", "row", "column" —
  // hoặc nói vòng ("nặng bao nhiêu" thay cho "dung lượng").
  { trang: 'khoDuLieu', hoi: 'Orders có bao nhiêu record', can: ['51.290'] },
  { trang: 'khoDuLieu', hoi: 'Orders có bao nhiêu row', can: ['51.290'] },
  { trang: 'khoDuLieu', hoi: 'Orders có mấy column', can: ['24'] },
  {
    trang: 'khoDuLieu',
    hoi: 'Orders nặng bao nhiêu',
    // 8.400.000 B / 1024² = 8,01 -> "8 MB". Con số phải khớp `dinhDangDungLuong`
    // từng ký tự, không phải khớp phép chia thập phân trong đầu người viết ca.
    can: ['8 MB'],
  },
  { trang: 'khoDuLieu', hoi: 'dataset nào nhiều dòng nhất', can: ['Orders', '51.290'] },
  { trang: 'dsMoHinh', hoi: 'model nào nhiều table nhất', can: ['Global-Superstore', '5'] },
  { trang: 'dsMoHinh', hoi: 'datamodel nào nhiều relationship nhất', can: ['Global-Superstore'] },
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
    // Chip `Orders`, không phải chip tóm tắt — xem `Ca.chip`.
    chip: 1,
    can: 'chua-hieu',
    vi:
      'TỪNG SAI suốt bốn lần sửa. Trang danh sách chỉ có columnCount nên không có ' +
      'cột Sales nào, nhưng hai chữ "dữ liệu" của "kiểu DỮ LIỆU" trùng vào nhãn ' +
      '"Số mô hình DỮ LIỆU dùng Orders" và thắng 2-1. Giờ từ chối đúng: chữ ' +
      '"sales" không có trong bất kỳ tên nguồn, nhãn hay giá trị nào — xem `nhacThuLa`.',
  },

  /*
   * ─── ĐỌC NỘI DUNG DỮ LIỆU NGƯỜI DÙNG VỪA TẢI LÊN ────────────────
   *
   * Trước nhóm này, khung chỉ trả lời được về THÔNG TIN của bộ dữ liệu (mấy
   * dòng, mấy cột, từ tệp nào). NỘI DUNG bên trong thì phải dựng một mô hình
   * dữ liệu trước đã — trong khi bảng đang hiện ngay trên màn hình.
   *
   * Mọi câu ở đây đều phải mang VẾ ĐIỀU KIỆN: bảng xem trước là một MẪU.
   */
  {
    trang: 'chiTietDataset',
    hoi: 'sản phẩm nào có số lượng cao nhất',
    can: ['Staples', '11', 'xem trước'],
    // Boston 9 là DÒNG đơn lẻ lớn nhất. Nhận về nó nghĩa là phép gộp đã biến mất.
    khong: ['Boston'],
    vi: 'Một sản phẩm nằm trên nhiều dòng — phải cộng lại, không lấy dòng lớn nhất',
  },
  {
    trang: 'chiTietDataset',
    hoi: 'sản phẩm nào doanh thu cao nhất',
    can: ['Boston', '340'],
    khong: ['Staples'],
    vi: 'CÙNG cột nhãn, KHÁC cột đo — đổi đáp án, nên chọn nhầm cột đo sẽ lộ ra',
  },
  {
    trang: 'chiTietDataset',
    hoi: 'nhóm hàng nào doanh thu cao nhất',
    can: ['Văn phòng', '500'],
    vi: 'Câu hỏi đổi CỘT NHÃN sang Nhóm hàng — cùng một bảng, câu hỏi chọn cột',
  },
  { trang: 'chiTietDataset', hoi: 'tổng doanh thu là bao nhiêu', can: ['590', 'xem trước'] },
  { trang: 'chiTietDataset', hoi: 'tổng số lượng là bao nhiêu', can: ['23'] },
  { trang: 'chiTietDataset', hoi: 'top 2 sản phẩm theo doanh thu', can: ['Boston', 'Staples'] },
  { trang: 'chiTietDataset', hoi: 'có bao nhiêu sản phẩm', can: ['3'] },
  /*
   * ─── TAB "CẤU TRÚC": kiểu ở KHO, khác kiểu ở NGUỒN ──────────────────
   */
  {
    trang: 'chiTietDataset',
    hoi: 'bảng của Orders nằm đâu trong kho phân tích',
    can: ['ds_1_orders'],
  },
  {
    trang: 'chiTietDataset',
    hoi: 'cột Doanh thu ở kho phân tích kiểu gì',
    can: ['Nullable(Float64)'],
    // Kiểu NGUỒN của cùng cột đó — nhận về nó là trả lời nhầm tab.
    khong: ['decimal(18,2)'],
  },
  /*
   * Hai ca dưới canh riêng PHÉP GỘP, và chúng cần thiết vì mấy ca "cao nhất" ở
   * trên KHÔNG canh được nó: nhánh đó còn đi qua `gopTheo` của `tinhBang` nữa,
   * nên bỏ phép gộp ở `bangTuBangTho` đi thì chúng vẫn xanh.
   *
   * `ti_trong` và nhánh tra giá trị thì không: cả hai dùng `timDong`, và `timDong`
   * lấy DÒNG ĐẦU TIÊN khớp nhãn. Staples nằm trên hai dòng (120 và 80): không
   * gộp thì câu trả lời là 120 thay vì 200 — một con số có thật trên bảng, cho
   * một câu hỏi khác.
   */
  {
    trang: 'chiTietDataset',
    hoi: 'doanh thu của Staples là bao nhiêu',
    can: ['200'],
    khong: ['120'],
    vi: 'Staples nằm trên HAI dòng — phải cộng, không lấy dòng đầu tiên',
  },
  {
    trang: 'chiTietDataset',
    hoi: 'Staples chiếm bao nhiêu phần trăm doanh thu',
    can: ['33,9'],
    khong: ['20,3'],
    vi: '200/590 chứ không phải 120/590 — cùng gốc với ca trên',
  },
  {
    trang: 'chiTietDataset',
    hoi: 'Orders có bao nhiêu dòng',
    can: ['51.290'],
    /*
     * ⚠️ Ca canh THỨ TỰ. Bảng xem trước có 5 dòng, cả bộ có 51.290. Đảo thứ tự
     * là câu hỏi đơn giản nhất về một bộ dữ liệu được trả lời bằng một con số
     * sai cả nghìn lần — mà vẫn có thật, nên không ai nhận ra.
     */
    khong: ['5 dòng'],
    vi: 'Dữ kiện đã khai phải thắng bảng xem trước ở câu đếm',
  },
  {
    trang: 'chiTietDataset',
    hoi: 'cột Sản phẩm kiểu dữ liệu gì',
    can: ['varchar(255)'],
    vi: 'Trang CHI TIẾT thì trả lời được — khác trang danh sách, nơi chỉ có columnCount',
  },
  {
    trang: 'chiTietDataset',
    hoi: 'giá cổ phiếu hôm nay bao nhiêu',
    can: 'chua-hieu',
    vi: 'Có bảng dữ liệu trong tay KHÔNG được biến khung thành thứ gì cũng trả lời',
  },

  // ─── Xuyên hệ thống: hỏi từ một trang không dính gì tới dữ liệu ───────────
  { trang: 'hoSo', hoi: 'có bao nhiêu bộ dữ liệu', can: ['12'] },
  { trang: 'hoSo', hoi: 'có bao nhiêu mô hình dữ liệu', can: ['3'] },
  { trang: 'hoSo', hoi: 'mô hình nào nhiều bảng nhất', can: ['Global-Superstore'] },
  { trang: 'hoSo', hoi: 'bộ dữ liệu nào nhiều dòng nhất', can: ['Orders'] },
  { trang: 'hoSo', hoi: 'Orders có bao nhiêu dòng', can: ['51.290'] },

  /*
   * ĐỨNG Ở MỘT TRANG CHẲNG LIÊN QUAN GÌ TỚI DỮ LIỆU MÀ HỎI.
   *
   * Đây là nhóm đo lời hứa "dù ở trang nào cũng trả lời được". Trước đây bản
   * tóm tắt xuyên hệ thống chỉ biết đếm hai thứ — bộ dữ liệu và mô hình — nên bốn
   * trong năm câu dưới đây không có chỗ nào trả lời.
   */
  {
    trang: 'hoSo',
    hoi: 'có bao nhiêu file excel',
    can: ['2', 'đếm trên 4 mục'],
    vi: 'CÙNG phép đếm với trang Kho dữ liệu, và phải mang vế điều kiện vì danh sách còn phân trang',
  },
  { trang: 'hoSo', hoi: 'bao nhiêu mô hình chưa nối đủ quan hệ', can: ['1'] },
  { trang: 'hoSo', hoi: 'có bao nhiêu kết nối', can: ['2'] },
  { trang: 'hoSo', hoi: 'có bao nhiêu báo cáo', can: ['7'] },
  { trang: 'hoSo', hoi: 'có bao nhiêu thành viên', can: ['3'] },
  { trang: 'hoSo', hoi: 'kết nối nào nhiều bộ dữ liệu nhất', can: ['MySQL bán hàng', '2'] },
  {
    trang: 'hoSo',
    hoi: 'mô hình Kho vận có mấy bảng',
    can: ['2'],
    khong: ['toàn bộ tổ chức: 3'],
    vi: 'Ý định ĐẾM nhưng hỏi về MỘT mục — không được trả bằng tổng số mô hình',
  },

  // ─── Phải TỪ CHỐI: những câu không có số liệu nào trả lời được ────────────
  /*
   * CÂU HỎI GỌI TÊN MỘT THỨ KHÔNG TỒN TẠI.
   *
   * Đây là kiểu hỏng đã sống qua bốn lần sửa: mấy chữ chung chung ("số", "báo
   * cáo", "dữ liệu") đủ kéo một nhãn khác về đích, trong khi thứ được gọi đích
   * danh thì không có. Một con số có thật, cho một câu hỏi khác.
   */
  {
    trang: 'dsMoHinh',
    hoi: 'mô hình Marketing có mấy bảng',
    can: 'chua-hieu',
    vi: 'KHÔNG có mô hình nào tên Marketing — đừng trả bằng số bảng của mô hình khác',
  },
  {
    trang: 'khoDuLieu',
    hoi: 'bộ dữ liệu Invoices có bao nhiêu dòng',
    can: 'chua-hieu',
    vi: 'KHÔNG có bộ dữ liệu nào tên Invoices — đừng trả bằng số dòng của Orders',
  },
  {
    trang: 'chiTietDataset',
    hoi: 'cột Margin kiểu dữ liệu gì',
    can: 'chua-hieu',
    vi: 'CÓ khai kiểu của từng cột, nhưng không cột nào tên Margin',
  },
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
  // ─── Báo cáo (danh sách) ──────────────────────────────────────────────────
  { trang: 'dsBaoCao', hoi: 'có bao nhiêu báo cáo', can: ['7'] },
  { trang: 'dsBaoCao', hoi: 'báo cáo Doanh thu 2026 dựng trên gì', can: ['Bán hàng'] },
  { trang: 'dsBaoCao', hoi: 'ai tạo báo cáo Doanh thu 2026', can: ['Mai'] },
  { trang: 'dsBaoCao', hoi: 'báo cáo Tồn kho có mấy biểu đồ', can: ['2'] },
  { trang: 'dsBaoCao', hoi: 'thư mục của báo cáo Tồn kho', can: ['Vận hành'] },
  {
    trang: 'dsBaoCao',
    hoi: 'loại biểu đồ của báo cáo Tồn kho',
    can: ['đường'],
    vi: 'đọc từ CHART_TYPE_LABELS, đúng chữ in trên thẻ báo cáo',
  },

  // ─── Thành viên ───────────────────────────────────────────────────────────
  { trang: 'thanhVien', hoi: 'tổ chức có bao nhiêu thành viên', can: ['2'] },
  { trang: 'thanhVien', hoi: 'vai trò của Trần Thu Hà là gì', can: ['quản trị viên'] },
  { trang: 'thanhVien', hoi: 'email của Trần Thu Hà', can: ['ha@congty.vn'] },
  { trang: 'thanhVien', hoi: 'có mấy quản trị viên', can: ['1'] },
  {
    trang: 'thanhVien',
    hoi: 'Lê Minh còn hoạt động không',
    can: ['tạm dừng'],
    vi: 'memberActive=false — thứ nhìn bảng mới thấy',
  },
  {
    trang: 'thanhVien',
    hoi: 'Lê Minh đăng nhập lần cuối lúc nào',
    can: ['chưa đăng nhập lần nào'],
  },

  // ─── Kết nối ──────────────────────────────────────────────────────────────
  { trang: 'ketNoi', hoi: 'có bao nhiêu kết nối', can: ['2'] },
  { trang: 'ketNoi', hoi: 'kết nối MySQL bán hàng thuộc loại gì', can: ['mysql'] },
  { trang: 'ketNoi', hoi: 'database của kết nối MySQL bán hàng', can: ['sales'] },
  { trang: 'ketNoi', hoi: 'kết nối MySQL bán hàng có bật SSL không', can: ['không'] },
  {
    trang: 'ketNoi',
    hoi: 'kết nối MySQL bán hàng kiểm tra lần cuối lúc nào',
    can: ['chưa kiểm tra lần nào'],
  },
  /*
   * ⚠️ CA CANH BẢO MẬT, không phải ca đo chất lượng.
   *
   * Tên đăng nhập và mật khẩu vào CSDL của khách là THÔNG TIN ĐĂNG NHẬP. Khung
   * không khai chúng, và một câu trả lời ở đây còn đi tiếp lên mô hình ngôn ngữ
   * qua lớp diễn đạt. Ca này đỏ nghĩa là có người vừa khai thêm một dữ kiện
   * không được phép khai.
   */
  {
    trang: 'ketNoi',
    hoi: 'tài khoản đăng nhập của kết nối MySQL bán hàng là gì',
    can: 'chua-hieu',
    vi: 'thông tin đăng nhập CỐ Ý không được khai — xem `duKienKetNoi`',
  },

  // ─── Thanh toán ───────────────────────────────────────────────────────────
  { trang: 'thanhToan', hoi: 'tổ chức đang dùng gói nào', can: ['Pro'] },
  { trang: 'thanhToan', hoi: 'giá gói đang dùng', can: ['2.000.000'] },
  { trang: 'thanhToan', hoi: 'đã dùng bao nhiêu báo cáo', can: ['12', '50'] },
  { trang: 'thanhToan', hoi: 'gói hiện tại hết hạn lúc nào', can: ['2026'] },
  {
    trang: 'thanhToan',
    hoi: 'đã dùng bao nhiêu thành viên',
    can: ['4'],
    vi: 'hạn mức null — phải nói "không giới hạn", không in ra chữ null',
  },

  // ─── Tổ chức ──────────────────────────────────────────────────────────────
  { trang: 'toChuc', hoi: 'tên tổ chức là gì', can: ['Công ty ABC'] },
  { trang: 'toChuc', hoi: 'slug của tổ chức', can: ['cong-ty-abc'] },
  // ─── Bảng giá ─────────────────────────────────────────────────────────────
  { trang: 'bangGia', hoi: 'có mấy gói đang bán', can: ['1'] },
  { trang: 'bangGia', hoi: 'giá gói Pro bao nhiêu', can: ['2.000.000'] },
  { trang: 'bangGia', hoi: 'gói Pro cho mấy báo cáo', can: ['50'] },
  {
    trang: 'bangGia',
    hoi: 'gói Pro cho mấy thành viên',
    can: ['Không giới hạn'],
    vi: 'hạn mức null — phải thành chữ, không in ra null',
  },

  // ─── Đơn hàng ─────────────────────────────────────────────────────────────
  { trang: 'donHang', hoi: 'tổ chức có bao nhiêu đơn hàng', can: ['4'] },
  { trang: 'donHang', hoi: 'đơn DH2026030001 mua gói nào', can: ['Pro'] },
  { trang: 'donHang', hoi: 'đơn DH2026030001 đã thanh toán chưa', can: ['chưa thanh toán'] },
  { trang: 'donHang', hoi: 'có mấy đơn đang chờ thanh toán', can: ['1'] },

  // ─── Mua gói ──────────────────────────────────────────────────────────────
  {
    trang: 'muaGoi',
    hoi: 'đang mua theo chu kỳ nào',
    can: ['theo năm'],
    vi: 'chu kỳ KHÔNG nằm trong PlanDto — nó là cú bấm vừa rồi, và nó quyết số tiền',
  },
  { trang: 'muaGoi', hoi: 'giá gói Pro', can: ['2.000.000'] },

  // ─── Một đơn hàng ─────────────────────────────────────────────────────────
  { trang: 'motDonHang', hoi: 'số tiền đơn DH2026030001', can: ['2.000.000'] },
  {
    trang: 'motDonHang',
    hoi: 'số tài khoản ngân hàng để chuyển tiền là gì',
    can: 'chua-hieu',
    vi: 'CANH BẢO MẬT: OrderDetailDto có bankAccountNo/qrPayload, bản khai CỐ Ý không đọc',
  },

  // ─── Sửa một kết nối ──────────────────────────────────────────────────────
  { trang: 'motKetNoi', hoi: 'database của kết nối MySQL bán hàng', can: ['sales'] },
  {
    trang: 'motKetNoi',
    hoi: 'có bao nhiêu kết nối đang có',
    can: ['2', 'toàn bộ tổ chức'],
    vi:
      'Màn một kết nối KHÔNG khai bản tóm tắt — nên câu này rơi xuống lớp XUYÊN ' +
      'HỆ THỐNG, và câu trả lời phải TỰ NÓI RA phạm vi. Kỳ vọng ban đầu của bộ ' +
      'này là "chua-hieu", và nó sai: khung trả lời đúng, kèm đúng vế điều kiện.',
  },

  // ─── Workspace của tôi ────────────────────────────────────────────────────
  {
    trang: 'wsCuaToi',
    hoi: 'tôi vào được mấy workspace',
    can: ['2'],
    vi: 'phạm vi của NGƯỜI ĐANG ĐĂNG NHẬP, không phải của cả tổ chức',
  },

  // ─── Hồ sơ ────────────────────────────────────────────────────────────────
  { trang: 'hoSoThat', hoi: 'email của tôi là gì', can: ['ha@congty.vn'] },
  { trang: 'hoSoThat', hoi: 'chức danh của tôi', can: ['Trưởng phòng'] },
  {
    trang: 'hoSoThat',
    hoi: 'mật khẩu của tôi là gì',
    can: 'chua-hieu',
    vi: 'CANH BẢO MẬT: hồ sơ CỐ Ý không khai gì về mật khẩu',
  },

  // ─── Console: Tổng quan ───────────────────────────────────────────────────
  { trang: 'adminTongQuan', hoi: 'có bao nhiêu tổ chức đang hoạt động', can: ['12'] },
  { trang: 'adminTongQuan', hoi: 'tổng số người dùng', can: ['87'] },
  { trang: 'adminTongQuan', hoi: 'có mấy người dùng đang bị khoá', can: ['3'] },

  // ─── Console: Tổ chức ─────────────────────────────────────────────────────
  { trang: 'adminToChuc', hoi: 'số tổ chức toàn hệ thống', can: ['14'] },
  { trang: 'adminToChuc', hoi: 'tổ chức Công ty ABC có mấy người dùng', can: ['14'] },
  {
    trang: 'adminToChuc',
    hoi: 'tổ chức Công ty ABC còn hoạt động không',
    can: ['đang hoạt động'],
  },

  // ─── Console: Người dùng ──────────────────────────────────────────────────
  { trang: 'adminNguoiDung', hoi: 'số người dùng toàn hệ thống', can: ['87'] },
  { trang: 'adminNguoiDung', hoi: 'email của Phạm Quốc Bảo', can: ['bao@hethong.vn'] },
  { trang: 'adminNguoiDung', hoi: 'Phạm Quốc Bảo thuộc mấy tổ chức', can: ['2'] },
  { trang: 'adminNguoiDung', hoi: 'vai trò nền tảng của Phạm Quốc Bảo', can: ['superadmin'] },

  // ─── Console: Workspace ───────────────────────────────────────────────────
  { trang: 'adminWorkspace', hoi: 'số workspace toàn hệ thống', can: ['41'] },
  { trang: 'adminWorkspace', hoi: 'workspace Phân tích thuộc tổ chức nào', can: ['Công ty ABC'] },
  { trang: 'adminWorkspace', hoi: 'workspace Phân tích có mấy báo cáo', can: ['18'] },

  // ─── Console: Phương thức thanh toán ──────────────────────────────────────
  { trang: 'adminThanhToan', hoi: 'có mấy phương thức thanh toán', can: ['2'] },
  { trang: 'adminThanhToan', hoi: 'có mấy phương thức đang bật', can: ['1'] },
  {
    trang: 'adminThanhToan',
    hoi: 'phương thức nào chưa cấu hình xong',
    can: ['Chuyển khoản SePay'],
  },
  {
    trang: 'adminThanhToan',
    hoi: 'số tài khoản nhận tiền của Chuyển khoản SePay là gì',
    can: 'chua-hieu',
    vi: 'CANH BẢO MẬT: bankAccountNo/bankBin CỐ Ý không khai — xem `duKienPhuongThucThanhToan`',
  },
];

// ─── Chạy và đếm ─────────────────────────────────────────────────────────────

type KetCuc = 'dung' | 'chuaHieu' | 'sai';

function xu(ca: Ca): { ketCuc: KetCuc; cau: string | null } {
  const cau = traLoiThat(MOI_TRANG[ca.trang], ca.hoi, ca.truoc ?? null, ca.chip);

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
          `  [${r.ketCuc === 'sai' ? 'SAI ' : 'CHƯA'}] ${MOI_TRANG[r.ca.trang].ten} · "${r.ca.hoi}"\n` +
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
    expect(dem('dung')).toBeGreaterThanOrEqual(190);
  });

  /*
   * ⚠️ Trần SAI xuống 0, và đây là một chiều KHÔNG được đi ngược lại.
   *
   * Hai ca SAI cuối cùng ("số báo cáo của sale", "cột Sales kiểu dữ liệu gì") cùng
   * một gốc và đã sống qua BỐN lần sửa — cả bốn đều đi theo hướng siết phép
   * chấm điểm, và cả bốn đều đổi chúng lấy một ca đếm khác. Lần thứ năm không
   * đụng vào phép chấm: nó hỏi một câu khác hẳn — "câu hỏi có nhắc thứ gì khung
   * chưa từng thấy không" (`nhacThuLa`). Không đổi ca nào.
   *
   * SAI là kết cục nguy hiểm duy nhất — một con số có thật trả lời cho câu hỏi
   * khác, không dấu hiệu nào. Giờ nó bằng 0, và ngưỡng này giữ cho nó ở đó.
   */
  it('không được có câu SAI nào', () => {
    expect(dem('sai')).toBe(0);
  });
});
