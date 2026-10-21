import {
  CHART_TYPE_LABELS,
  type AdminUserDto,
  type BillingCycle,
  type BillingSummaryDto,
  type ConnectionDto,
  type DataModelDetailDto,
  type DataModelDto,
  type DatasetDetailDto,
  type DatasetDto,
  type DatasetPreviewDto,
  type FolderDto,
  type HomeDataDto,
  type OrderDto,
  type PaymentMethodDto,
  type PlanDto,
  type PlatformOverviewDto,
  type PlatformTenantDto,
  type PlatformUserDto,
  type PlatformWorkspaceDto,
  type ReportDto,
  type WarehouseSchemaDto,
} from '@bi/shared';

import { dinhDangDungLuong, dinhDangHanMuc, dinhDangNgay, dinhDangTien } from '../billing/format';
import type { DuKien, Nguon } from './nguCanh';

/**
 * Chuyển DTO của từng trang thành dữ kiện hỏi được.
 *
 * ═══ Vì sao gộp ba hàm vào một file ════════════════════════════════════════
 *
 * Chúng là ba phép ánh xạ THUẦN từ DTO sang `Nguon[]` — không state, không
 * hook, không gọi gì. Để cùng chỗ thì chúng test được bằng một file test không
 * cần DOM, và người sửa thấy ngay ba trang đang hứa những gì để mà giữ cho
 * chúng nói cùng một kiểu. Thêm trang mới = thêm một hàm ở đây.
 *
 * ═══ Luật chung: con số nào có ĐIỀU KIỆN thì mang `luuY` ═══════════════════
 *
 * Mỗi lần một hàm ở đây in ra một con số mà con số đó chưa phải toàn bộ sự
 * thật, nó PHẢI nói ra điều kiện. Màn hình còn có chỗ hiện cảnh báo bên cạnh;
 * một câu trả lời thì chỉ có chính nó.
 */

/** Trạng thái nạp kho, đọc thành câu người dùng hiểu. */
function docTrangThaiNap(ds: DatasetDto): string {
  switch (ds.loadStatus) {
    case 'loaded':
      return `đã nạp vào kho phân tích (${ds.loadedRowCount.toLocaleString('vi-VN')} dòng)`;
    case 'queued':
      return 'đang chờ nạp vào kho phân tích';
    case 'running':
      return 'đang nạp vào kho phân tích';
    case 'failed':
      return 'nạp vào kho phân tích thất bại';
    default:
      return 'chưa nạp vào kho phân tích';
  }
}

/** Một câu nói bộ dữ liệu này từ đâu ra. */
function docNguon(ds: DatasetDto): string {
  if (ds.source === 'file') {
    const ten = ds.originalFilename ?? 'một tệp đã tải lên';
    return ds.sheetName === null ? ten : `${ten}, sheet "${ds.sheetName}"`;
  }
  const bang = [ds.sourceSchema, ds.sourceTable].filter((x) => x !== null).join('.');
  return ds.connectionName === null ? bang : `bảng ${bang} qua kết nối "${ds.connectionName}"`;
}

/** Dữ kiện chung cho cả trang danh sách và trang chi tiết của một bộ dữ liệu. */
function duKienChung(ds: DatasetDto): DuKien[] {
  const d: DuKien[] = [
    {
      nhan: `Số dòng của ${ds.name}`,
      gia: ds.rowCount.toLocaleString('vi-VN'),
      /*
       * ⚠️ `truncated` bật nghĩa là tệp đã bị cắt khi tải lên, và `rowCount` chỉ
       * là số dòng ĐÃ ĐỌC. Doc comment của chính DTO nói thẳng rằng con số đó
       * một mình "nói dối". Bỏ `luuY` ở đây là nói dối to hơn màn hình, vì màn
       * hình còn hiện một cảnh báo ngay cạnh con số.
       */
      ...(ds.truncated ? { luuY: 'tệp đã bị cắt khi tải lên nên đây chưa phải toàn bộ' } : {}),
    },
    { nhan: `Số cột của ${ds.name}`, gia: String(ds.columnCount) },
    { nhan: `Nguồn gốc của ${ds.name}`, gia: docNguon(ds) },
    { nhan: `Trạng thái của ${ds.name}`, gia: docTrangThaiNap(ds) },
    { nhan: `Số mô hình dữ liệu dùng ${ds.name}`, gia: String(ds.datamodelCount) },
  ];

  if (ds.source === 'file') {
    d.push({ nhan: `Dung lượng tệp của ${ds.name}`, gia: dinhDangDungLuong(ds.fileSizeBytes) });
    if (ds.originalFilename !== null) {
      d.push({ nhan: `Tên tệp gốc của ${ds.name}`, gia: ds.originalFilename });
    }
  }
  return d;
}

/* ═══ BẢN TÓM TẮT của một danh sách — dùng chung cho TRANG vÀ cho TOÀN TỔ CHỨC ══
 *
 * Hai hàm dưới đây trả về `DuKien[]` chứ không trả về `Nguon`, và đó là cả
 * lý do chúng tồn tại: CÙNG một phép đếm phải xuất hiện ở hai chỗ — trên trang
 * danh sách (`duKienKhoDuLieu`) và trong bản tóm tắt xuyên hệ thống
 * (`useNguCanhHeThong`) — vì người dùng hỏi câu đó từ BẤT KỲ trang nào. Chép tay
 * hai bản là chúng lệch nhau ở lần sửa đầu tiên, và khi đó cùng một câu hỏi cho
 * hai con số khác nhau tùy người dùng đang đứng ở đâu.
 *
 * `pham` là vế phạm vi dán vào cuối nhãn. Nó là tham số chứ không viết cứng vì
 * đúng một phép đếm ấy mang hai phạm vi khác hẳn nhau, và một nhãn nói sai phạm
 * vi thì mọi câu trả lời dựng từ nó cũng nói sai — cùng lý do `soSanhNguon` nhận
 * `pham`.
 */

/** Tên dễ đọc của một đuôi tệp. Người dùng gõ "excel", không gõ "xlsx". */
const TEN_DUOI = new Map<string, string>([
  ['xlsx', 'Excel'],
  ['xlsm', 'Excel'],
  ['xls', 'Excel'],
  ['csv', 'CSV'],
  ['tsv', 'TSV'],
  ['json', 'JSON'],
  ['parquet', 'Parquet'],
]);

function loaiTep(ten: string): string {
  const duoi = ten.toLowerCase().split('.').pop() ?? '';
  return TEN_DUOI.get(duoi) ?? duoi.toUpperCase();
}

/**
 * Vế điều kiện cho mọi con số ĐẾM TRÊN DANH SÁCH ĐANG CÓ TRONG TAY.
 *
 * ⚠️ Mọi danh sách đều phân trang. Trang Kho dữ liệu thật hiện 20 trên 24 bộ,
 * nên "số tệp Excel" đếm ở đây là số tệp của 20 bộ ĐÃ TẢI, không phải của cả
 * kho. Không nói ra thì nó đọc thành "toàn bộ", và đó là một con số có thật trả
 * lời cho một câu hỏi khác — cùng lý do `luuYCat` và `truncated` tồn tại.
 */
function luuYChuaDu(hien: number, tong: number): string | undefined {
  return tong > hien
    ? `đếm trên ${hien.toLocaleString('vi-VN')} mục đang hiện, không phải toàn bộ ${tong.toLocaleString('vi-VN')}`
    : undefined;
}

/**
 * Vế điều kiện khi danh sách ĐANG BỊ LỌC — xem `dangLoc` bên `useListQueryState`.
 *
 * ⚠️ Khác `luuYChuaDu`, và hai cái này không thay nhau được. `luuYChuaDu` nói về
 * phần ĐÃ TẢI của một tập hợp đã xác định ("20 trên 24"); cái này nói rằng chính
 * tập hợp ấy đã bị thu hẹp, nên `tong` không còn là toàn bộ. Gõ "an" vào ô tìm
 * thành viên rồi hỏi "tổ chức có bao nhiêu thành viên" là nhận một con số có
 * thật trả lời cho một câu hỏi khác — và `luuYChuaDu` im lặng ở đó, vì `tong`
 * khớp đúng số dòng đang hiện.
 */
function luuYLoc(loc: boolean): string | undefined {
  return loc ? 'đếm trên phần ĐANG LỌC, không phải toàn bộ' : undefined;
}

/** Dán hai vế điều kiện lại — bỏ vế nào không có. */
function gopLuuY(...phan: (string | undefined)[]): string | undefined {
  const co = phan.filter((x): x is string => x !== undefined && x !== '');
  return co.length === 0 ? undefined : co.join('; ');
}

/**
 * Bản tóm tắt của một danh sách bộ dữ liệu.
 *
 * Đếm TỆP chứ không đếm BỘ, và đó là phần quan trọng nhất ở đây: một tệp Excel
 * bốn sheet sinh ra BỐN bộ dữ liệu trỏ vào cùng một tệp. Đếm dòng trong bảng rồi
 * gọi đó là "số file excel" là một con số có thật trả lời cho một câu hỏi khác —
 * nên số bộ đi theo trong `luuY`, không đi vào chỗ của con số chính.
 */
export function tomTatBoDuLieu(ds: DatasetDto[], tong: number, pham: string): DuKien[] {
  const theoLoai = new Map<string, { tep: Set<string>; bo: number }>();
  for (const d of ds) {
    if (d.source !== 'file' || d.originalFilename === null) continue;
    const loai = loaiTep(d.originalFilename);
    const g = theoLoai.get(loai) ?? { tep: new Set<string>(), bo: 0 };
    g.tep.add(d.originalFilename);
    g.bo += 1;
    theoLoai.set(loai, g);
  }

  const chuaDu = luuYChuaDu(ds.length, tong);

  return [
    ...dk(`Số bộ dữ liệu ${pham}`, tong),
    ...dk('Tên các bộ dữ liệu đang hiện', ds.map((d) => d.name).join('; ')),
    /*
     * ⚠️ Nhãn cố ý KHÔNG chứa cụm "bộ dữ liệu". Cụm đó đã là của nhãn đầu
     * tiên; dùng lại là hai nhãn hoà điểm trong `traCuu` cho câu "có bao nhiêu bộ
     * dữ liệu", và hoà thì khung bỏ cả hai — hỏng câu đơn giản nhất của cả trang
     * để thêm được một câu. Cùng luật đã ghi ở `duKienDanhSachMoHinh`.
     */
    ...[...theoLoai].flatMap(([loai, g]) =>
      dk(
        `Số tệp ${loai} ${pham}`,
        g.tep.size,
        gopLuuY(
          `${g.bo.toLocaleString('vi-VN')} bộ dữ liệu dựng từ chúng — một tệp nhiều sheet sinh ra nhiều bộ`,
          chuaDu,
        ),
      ),
    ),
  ];
}

/**
 * Trang Kho dữ liệu — bản tóm tắt trước, rồi mỗi bộ dữ liệu là một nguồn.
 *
 * ⚠️ Nguồn TÓM TẮT phải đứng ĐẦU — cùng quy ước mọi danh sách khác đang dùng,
 * và `traLoiHeThong` đọc nó theo đúng vị trí đó. Trước đây danh sách này là danh
 * sách DUY NHẤT không có bản tóm tắt, nên câu "có bao nhiêu bộ dữ liệu" hỏi ngay
 * trên trang Kho dữ liệu lại không có chỗ nào trả lời được.
 */
export function duKienKhoDuLieu(ds: DatasetDto[], tong = ds.length): Nguon[] {
  return [
    { ten: 'Danh sách bộ dữ liệu', duKien: tomTatBoDuLieu(ds, tong, 'trong workspace này') },
    ...ds.map((d) => ({ ten: d.name, duKien: duKienChung(d) })),
  ];
}

/**
 * Trang chi tiết một bộ dữ liệu — có thêm KIỂU của từng cột.
 *
 * Đây là thứ trang danh sách không có: ở đó chỉ có `columnCount`. Nên câu "cột
 * X kiểu gì" chỉ trả lời được ở trang này, và ở trang danh sách khung sẽ nói
 * "chưa hiểu" thay vì đoán — xem luật hai-dữ-kiện-bằng-điểm trong `traLoi`.
 */
export function duKienChiTietDataset(
  ds: DatasetDetailDto,
  xemTruoc?: DatasetPreviewDto,
  kho?: WarehouseSchemaDto,
): Nguon[] {
  const d = duKienChung(ds);

  for (const c of ds.columns) {
    // Kiểu NGUỒN và kiểu NGỮ NGHĨA là hai chuyện: `varchar(255)` là cái
    // ClickHouse/MySQL lưu, còn `text`/`number`/`date` là cách hệ thống hiểu nó.
    // Người hỏi "cột này kiểu gì" thường cần cả hai.
    const kieu = c.semanticType === null ? c.dataType : `${c.dataType} (${c.semanticType})`;
    d.push({ nhan: `Kiểu dữ liệu của cột ${c.name}`, gia: kieu });
  }

  if (ds.file !== null) {
    d.push({
      nhan: `Tệp của ${ds.name} nằm ở đâu`,
      gia: `bucket ${ds.file.bucket}, khoá ${ds.file.key}`,
      // Một tệp Excel 4 sheet sinh ra 4 bộ dữ liệu trỏ vào CÙNG một object.
      // Không nói ra thì người đọc tưởng xoá khoá đó là xoá đúng bộ này.
      luuY: 'nhiều bộ dữ liệu có thể dùng chung một tệp (mỗi sheet một bộ)',
    });
  }

  /*
   * KHO PHÂN TÍCH — đúng cái đang hiện ở tab "Cấu trúc".
   *
   * Khác `ds.columns` ở trên: đó là kiểu của NGUỒN (tệp Excel, bảng MySQL), còn đây
   * là kiểu của chính bảng trong ClickHouse — thứ mọi truy vấn thật sự chạy trên.
   * Hai thứ lệch nhau là chuyện bình thường, và chính chỗ lệch là thứ người dùng
   * mở tab ấy ra để xem.
   */
  if (kho !== undefined) {
    d.push(...dk(`Bảng của ${ds.name} nằm đâu trong kho phân tích`, kho.table));
    for (const c of kho.columns) {
      d.push(...dk(`Kiểu ở kho phân tích của cột ${c.name}`, c.type));
    }
  }

  /*
   * BẢNG DỮ LIỆU THẬT — đúng cái đang hiện ở tab "Dữ liệu".
   *
   * Đây là chỗ duy nhất trong cả khung mà người dùng hỏi được về NỘI DUNG dữ
   * liệu của họ mà không cần dựng mô hình trước. Tải lên một tệp rồi hỏi "sản
   * phẩm nào số lượng cao nhất" là ra ngay, không phải qua §10.
   *
   * ⚠️ `luuY` BẮT BUỘC và luôn có. Bảng này là MẪU — doc của `DatasetPreviewDto`
   * nói thẳng là nó không có tổng số dòng, vì `COUNT(*)` trên bảng vài chục triệu
   * dòng là một lần quét toàn bảng. "Tổng doanh thu" tính trên 50 dòng đầu mà
   * đọc thành tổng của cả bộ là sai cả nghìn lần, bằng một con số có thật.
   */
  const bangTho =
    xemTruoc === undefined || xemTruoc.rows.length === 0
      ? undefined
      : {
          cot: xemTruoc.columns,
          dong: xemTruoc.rows,
          luuY: `tính trên ${xemTruoc.rows.length.toLocaleString('vi-VN')} dòng xem trước đang hiện ở tab "Dữ liệu", không phải toàn bộ bộ dữ liệu`,
        };

  return [{ ten: ds.name, duKien: d, ...(bangTho === undefined ? {} : { bangTho }) }];
}

/**
 * Trang Mô hình dữ liệu — mỗi BẢNG trong mô hình là một nguồn, cộng một nguồn
 * cho chính mô hình.
 *
 * Câu "mô hình này dựng từ tệp nào" trả lời được nhờ `source`/`originalFilename`
 * vừa thêm vào `DataModelDatasetDto`. Trước đó DTO chỉ có `datasetName` —
 * tên người dùng đặt, không dính gì tới tệp.
 */
export function duKienMoHinh(m: DataModelDetailDto): Nguon[] {
  const tenBang = (i: number): string => {
    const ds = m.datasets[i];
    return ds === undefined ? '' : (ds.displayName ?? ds.datasetName);
  };

  const chung: DuKien[] = [
    { nhan: `Số bảng trong mô hình ${m.name}`, gia: String(m.datasets.length) },
    { nhan: `Số thước đo của mô hình ${m.name}`, gia: String(m.measures.length) },
    { nhan: `Số quan hệ của mô hình ${m.name}`, gia: String(m.relationships.length) },
    {
      nhan: `Mô hình ${m.name} dựng từ tệp nào`,
      gia:
        m.datasets
          .map((ds) =>
            ds.source === 'file'
              ? (ds.originalFilename ?? ds.datasetName)
              : `${[ds.sourceSchema, ds.sourceTable].filter((x) => x !== null).join('.')}${
                  ds.connectionName === null ? '' : ` (kết nối "${ds.connectionName}")`
                }`,
          )
          .join('; ') || 'mô hình này chưa có bảng nào',
    },
    {
      nhan: `Các bảng trong mô hình ${m.name}`,
      gia: m.datasets.map((_, i) => tenBang(i)).join('; ') || 'chưa có bảng nào',
    },
    { nhan: `Người tạo mô hình ${m.name}`, gia: m.creatorName ?? 'không rõ' },
  ];

  if (m.measures.length > 0) {
    chung.push({
      nhan: `Danh sách thước đo của mô hình ${m.name}`,
      gia: m.measures.map((me) => `${me.name} (${me.agg})`).join('; '),
    });
  }

  const bang: Nguon[] = m.datasets.map((ds) => {
    const ten = ds.displayName ?? ds.datasetName;
    const d: DuKien[] = [
      {
        nhan: `Bảng ${ten} dựng từ đâu`,
        gia:
          ds.source === 'file'
            ? `tệp ${ds.originalFilename ?? ds.datasetName}`
            : `bảng ${[ds.sourceSchema, ds.sourceTable].filter((x) => x !== null).join('.')}${
                ds.connectionName === null ? '' : ` qua kết nối "${ds.connectionName}"`
              }`,
      },
      { nhan: `Số cột của bảng ${ten}`, gia: String(ds.columns.length) },
      { nhan: `Bảng ${ten} nằm ở đâu trong kho phân tích`, gia: ds.chTable },
      {
        nhan: `Bộ dữ liệu gốc của bảng ${ten}`,
        gia: ds.datasetName,
        ...(ds.displayName === null
          ? {}
          : { luuY: `trong mô hình này nó được đổi tên thành "${ds.displayName}"` }),
      },
    ];

    for (const c of ds.columns) {
      const nhanCot = c.alias ?? c.columnName;
      d.push({
        nhan: `Kiểu dữ liệu của cột ${nhanCot} trong bảng ${ten}`,
        gia: `${c.chType} — dùng làm ${c.role === 'measure' ? 'thước đo' : 'chiều'}`,
        // `typeChanged` = kiểu bên ClickHouse đã đổi từ lúc mô hình được dựng.
        // Số liệu vẫn chạy, nhưng con số có thể không còn nghĩa như cũ.
        ...(c.typeChanged ? { luuY: 'kiểu ở kho phân tích đã đổi từ khi mô hình được dựng' } : {}),
      });
    }

    return { ten, duKien: d };
  });

  return [{ ten: `Mô hình ${m.name}`, duKien: chung }, ...bang];
}

/* ═══ Phần 2: các trang còn lại của khu người dùng ═══════════════════════════
 *
 * Mỗi hàm dưới đây là một phép ánh xạ thuần từ DTO trang đã tải sang `Nguon[]`.
 * Chúng ngắn vì `dk` lo hai việc lặp lại nhiều nhất: định dạng số theo `vi-VN`,
 * và BỎ HẲN dữ kiện không có giá trị.
 *
 * Chuyện thứ hai quan trọng hơn vẻ ngoài. Một dữ kiện `gia: ''` vẫn tham gia
 * chấm điểm trong `traLoi`, nên nó cạnh tranh với dữ kiện thật và có thể thắng
 * — rồi trả lời bằng một ô trống. Thà không có nó.
 */

/** Một dữ kiện, hoặc KHÔNG dữ kiện nào nếu giá trị trống. Dùng với `flatMap`. */
function dk(nhan: string, gia: string | number | null | undefined, luuY?: string): DuKien[] {
  if (gia === null || gia === undefined || gia === '') return [];
  const doc = typeof gia === 'number' ? gia.toLocaleString('vi-VN') : gia;
  return [{ nhan, gia: doc, ...(luuY === undefined ? {} : { luuY }) }];
}

/** Trang chủ — workspace đang mở và hai con số của nó. */
export function duKienTrangChu(home: HomeDataDto): Nguon[] {
  const w = home.workspace.name;
  return [
    {
      ten: `Workspace ${w}`,
      duKien: [
        ...dk(`Số báo cáo trong ${w}`, home.stats.reports),
        ...dk(`Số thành viên của ${w}`, home.stats.members),
        ...dk(`Báo cáo mở gần đây trong ${w}`, home.reports.map((r) => r.name).join('; ')),
      ],
    },
    /*
     * Mỗi thẻ báo cáo trên màn hình thành một nguồn, dùng lại NGUYÊN hàm của
     * trang danh sách báo cáo.
     *
     * Trước đây trang chủ chỉ khai ba con số, nên mọi câu hỏi về mấy cái thẻ
     * đang hiện rành rành đều nhận về "không có mục nào trả lời được". Dùng
     * chung hàm thay vì viết lại nghĩa là mỗi dữ kiện thêm vào sau này có mặt ở
     * cả hai trang, và hai trang không bao giờ trả lời khác nhau về cùng một
     * báo cáo.
     *
     * `.slice(1)` bỏ bản tóm tắt của hàm kia: nhãn của nó nói "trong workspace
     * này", mà bản tóm tắt của trang chủ ở trên đã gọi đích danh tên workspace.
     * Giữ cả hai là hai bản tóm tắt cùng nói một chuyện bằng hai cách.
     */
    ...duKienDanhSachBaoCao(home.reports, home.stats.reports).slice(1),
  ];
}

/** Danh sách báo cáo. */
export function duKienDanhSachBaoCao(reports: ReportDto[], tong: number): Nguon[] {
  const mot = (r: ReportDto): DuKien[] => [
    /*
     * Loại biểu đồ — thứ MẮT THƯỜNG đọc được ngay trên thẻ báo cáo.
     *
     * Thiếu nó là câu "liệt kê các báo cáo biểu đồ cột" nhận về "không có mục
     * nào trả lời được", trong khi màn hình đang hiện đúng cái nhãn đó trên
     * từng thẻ. Khung nói không biết một thứ người dùng đang nhìn thẳng vào là
     * kiểu hỏng khó tha nhất — nó làm người ta thôi tin cả những câu nó trả lời
     * đúng.
     *
     * `CHART_TYPE_LABELS` là cùng cái bảng mà thẻ báo cáo dùng, nên hai chỗ đọc
     * ra cùng một chữ. Chép tay "Biểu đồ cột" ở đây là hẹn ngày hai bên lệch.
     */
    ...dk(
      `Loại biểu đồ của báo cáo ${r.name}`,
      r.chartType === null ? null : CHART_TYPE_LABELS[r.chartType],
    ),
    ...dk(
      `Báo cáo ${r.name} dựng trên gì`,
      r.source === 'datamodel' ? `mô hình dữ liệu ${r.sourceName}` : `bộ dữ liệu ${r.sourceName}`,
    ),
    ...dk(
      `Báo cáo ${r.name} có mấy biểu đồ`,
      r.canvas?.pages.flatMap((p) => p.visuals).length ?? 1,
    ),
    ...dk(`Báo cáo ${r.name} có mấy trang`, r.canvas?.pages.length ?? 1),
    ...dk(`Thư mục của báo cáo ${r.name}`, r.folderName ?? 'Chung'),
    ...dk(`Người tạo báo cáo ${r.name}`, r.creatorName),
    ...dk(`Báo cáo ${r.name} sửa lần cuối lúc nào`, dinhDangNgay(r.updatedAt)),
  ];

  return [
    {
      ten: 'Danh sách báo cáo',
      duKien: [
        ...dk('Số báo cáo trong workspace này', tong),
        ...dk('Tên các báo cáo đang hiện', reports.map((r) => r.name).join('; ')),
      ],
    },
    ...reports.map((r) => ({ ten: r.name, duKien: mot(r) })),
  ];
}

/**
 * Mô hình này chưa nối đủ quan hệ chưa?
 *
 * CÙNG cận dưới mà cột "Quan hệ" trên màn hình đang dùng để treo thẻ "chưa nối
 * đủ": N bảng cần ÍT NHẤT N−1 quan hệ. Một hàm chứ không phải hai phép so chép
 * tay, vì màn hình và câu trả lời lệch nhau một cận là người dùng thấy thẻ cảnh
 * báo rồi nghe khung nói không có gì.
 */
function chuaNoiDu(m: DataModelDto): boolean {
  return m.relationshipCount < m.datasetCount - 1;
}

/** Bản tóm tắt của một danh sách mô hình — xem khối ở `tomTatBoDuLieu`. */
export function tomTatMoHinh(
  models: DataModelDto[],
  tong: number,
  pham: string,
  loc = false,
): DuKien[] {
  const thieu = models.filter(chuaNoiDu);
  return [
    ...dk(`Số mô hình dữ liệu ${pham}`, tong, luuYLoc(loc)),
    ...dk('Tên các mô hình đang hiện', models.map((m) => m.name).join('; ')),
    /*
     * Câu "bao nhiêu mô hình chưa nối quan hệ" có HAI đường tới đích, và đó là chủ
     * ý: `soSanhNguon` đếm bằng cách so cột giữa các mục (chạy trước), còn nhãn này
     * là lưới hứng cho lúc người dùng đứng ở một trang KHÁC và hỏi xuyên hệ
     * thống — ở đó chỉ bản tóm tắt này được xét.
     */
    ...dk(
      'Số mô hình chưa nối đủ quan hệ',
      thieu.length,
      gopLuuY(
        thieu.length === 0 ? undefined : `gồm ${thieu.map((m) => m.name).join('; ')}`,
        luuYChuaDu(models.length, tong),
      ),
    ),
  ];
}

/**
 * THƯ MỤC — dùng chung cho cả Kho dữ liệu lẫn Báo cáo (§7.9 và §10.25).
 *
 * Một hàm cho hai tab, đúng như `FolderDto` là một DTO cho hai tab. Cột thư mục
 * nằm ngay bên trái bảng ở cả hai trang, mà trước đó không trang nào khai nó —
 * nhìn thấy mà hỏi không được.
 *
 * ═══ Mỗi thư mục một NGUỒN, không phải một dữ kiện phẳng ═══════════════
 *
 * Bản đầu khai phẳng — "Số mục trong thư mục Chung" nằm chung nguồn với "Số thư
 * mục đang có" — và hai nhãn đó luôn hoà điểm, vì cả hai cùng chứa "thư" và
 * "mục" còn chữ phân biệt chúng là TÊN thư mục. Hoà thì khung bỏ cả hai.
 *
 * Thành nguồn thì `nguonTheoTen` lo chuyện đó: gõ "thư mục Chung" ra là đã nói rõ
 * hỏi thư mục nào, không cần phép chấm điểm đoán hộ. Và `soSanhNguon` được "thư
 * mục nào nhiều mục nhất" miễn phí — cùng lợi ích mà mọi danh sách khác đang có.
 *
 * ⚠️ Nhãn dùng chữ "mục", KHÔNG dùng tên loại ("bộ dữ liệu" hay "báo cáo") —
 * cùng lý do `itemCount` của chính DTO tránh tên loại, và còn vì "Số bộ dữ liệu
 * trong thư mục Chung" sẽ hoà điểm với "Số bộ dữ liệu trong workspace này".
 */
export function duKienThuMuc(thuMuc: FolderDto[]): Nguon[] {
  return thuMuc.map((t) => ({
    ten: `Thư mục ${t.name}`,
    duKien: dk(`Số mục trong Thư mục ${t.name}`, t.itemCount),
  }));
}

/**
 * Tổng số mục THẬT của workspace, dựng từ chính cột thư mục đang hiện.
 *
 * ═══ Vì sao `total` của danh sách KHÔNG dùng được ═══════════════════════════
 *
 * Hai trang danh sách có cột thư mục đều MẶC ĐỊNH lọc theo Chung
 * (`DEFAULTS.folder`), nên `total` mà API trả về chỉ là số mục CHƯA xếp thư
 * mục. Khai con số ấy dưới nhãn "… trong workspace này" là một con số có thật
 * trả lời cho một câu hỏi khác — và nó sai ngay khi người dùng vừa mở trang,
 * không cần ai bấm gì.
 *
 * ⚠️ "Chung" đi riêng vì nó KHÔNG phải một thư mục: backend cố ý không trả nó
 * trong `items` (xem route `/report-folders`), nên cộng thẳng `items` là thiếu
 * đúng phần lớn nhất.
 *
 * Không thêm một request nào: `GET /dataset-folders` đã về cùng lúc với danh
 * sách, và cột bên trái đang hiện đúng mấy con số này.
 */
export function tongTheoThuMuc(chungCount: number, thuMuc: FolderDto[]): number {
  return thuMuc.reduce((t, m) => t + m.itemCount, chungCount);
}

/** Hai con số về CẢ cột thư mục — nối vào bản tóm tắt của danh sách. */
export function tomTatThuMuc(thuMuc: FolderDto[]): DuKien[] {
  if (thuMuc.length === 0) return [];
  return [
    ...dk('Số thư mục của workspace này', thuMuc.length),
    ...dk('Tên các thư mục', thuMuc.map((t) => t.name).join('; ')),
  ];
}

/** Danh sách mô hình dữ liệu. */
export function duKienDanhSachMoHinh(models: DataModelDto[], tong: number, loc = false): Nguon[] {
  return [
    {
      ten: 'Danh sách mô hình dữ liệu',
      duKien: tomTatMoHinh(models, tong, 'trong workspace này', loc),
    },
    ...models.map((m) => ({
      ten: m.name,
      // Mang theo id: câu hỏi gọi tên mô hình này thì khung hỏi được thẳng trên nó,
      // dù người dùng đang đứng ở trang khác — xem `Nguon.moHinhId`.
      moHinhId: m.id,
      duKien: [
        ...dk(`Số bảng trong mô hình ${m.name}`, m.datasetCount),
        ...dk(`Số thước đo của mô hình ${m.name}`, m.measureCount),
        ...dk(`Số quan hệ của mô hình ${m.name}`, m.relationshipCount),
        ...dk(`Số báo cáo đang dùng mô hình ${m.name}`, m.reportCount),
        /*
         * Cùng cận dưới mà cột "Quan hệ" trên màn hình đang dùng để treo thẻ
         * "chưa nối đủ": N bảng cần ÍT NHẤT N-1 quan hệ. Người đọc thấy thẻ
         * cảnh báo rồi hỏi lại thì phải được nghe cùng một câu với màn hình.
         *
         * ⚠️ Nhãn cố ý KHÔNG chứa chữ "bảng" hay "quan hệ". Hai chữ đó đã là
         * của "Số bảng trong mô hình" và "Số quan hệ của mô hình"; dùng lại là
         * ba cột cùng điểm nhau trong `chonThuocTinh`, và câu hỏi hoà điểm thì
         * khung trả lời "chưa hiểu" — hỏng cả ba câu thay vì thêm được một.
         */
        ...dk(
          `Mô hình ${m.name} đã nối đủ chưa`,
          chuaNoiDu(m)
            ? `chưa nối đủ — ${String(m.relationshipCount)} quan hệ cho ${String(m.datasetCount)} bảng, cần ít nhất ${String(m.datasetCount - 1)}`
            : 'đã nối đủ',
        ),
        ...dk(`Mô tả của mô hình ${m.name}`, m.description),
        ...dk(`Người tạo mô hình ${m.name}`, m.creatorName),
        ...dk(`Mô hình ${m.name} sửa lần cuối lúc nào`, dinhDangNgay(m.updatedAt)),
      ],
    })),
  ];
}

/** Danh sách kết nối cơ sở dữ liệu. */
export function duKienKetNoi(conns: ConnectionDto[]): Nguon[] {
  return [
    {
      ten: 'Danh sách kết nối',
      duKien: [
        ...dk('Số kết nối đang có', conns.length),
        ...dk('Tên các kết nối', conns.map((c) => c.name).join('; ')),
      ],
    },
    ...conns.map((c) => ({
      ten: c.name,
      duKien: [
        ...dk(`Kết nối ${c.name} thuộc loại gì`, c.kind),
        ...dk(`Máy chủ của kết nối ${c.name}`, `${c.host}:${String(c.port)}`),
        ...dk(`Database của kết nối ${c.name}`, c.databaseName),
        ...dk(`Kết nối ${c.name} có bật SSL không`, c.useSsl ? 'có' : 'không'),
        ...dk(`Số bộ dữ liệu lấy từ kết nối ${c.name}`, c.datasetCount),
        ...dk(
          `Lần kiểm tra kết nối ${c.name} gần nhất`,
          c.lastTestedAt === null ? 'chưa kiểm tra lần nào' : dinhDangNgay(c.lastTestedAt),
          // Kiểm tra thành công lần cuối KHÔNG có nghĩa bây giờ còn nối được.
          c.lastTestError === null ? undefined : `lần đó lỗi: ${c.lastTestError}`,
        ),
        /*
         * ⚠️ CỐ Ý không khai `username`, và tuyệt đối không khai mật khẩu.
         *
         * Tên đăng nhập vào CSDL khách hàng là THÔNG TIN ĐĂNG NHẬP, không phải
         * một số liệu để hỏi đáp. Nó cũng là thứ sẽ bị gửi lên mô hình ngôn ngữ
         * nếu nằm trong câu trả lời — xem `services/chat/dienDat.ts`.
         */
      ],
    })),
  ];
}

/** Danh sách thành viên tổ chức. */
export function duKienThanhVien(members: AdminUserDto[], tong: number, loc = false): Nguon[] {
  const vaiTro = (r: AdminUserDto['role']): string =>
    r === 'admin' ? 'quản trị viên' : r === 'creator' ? 'người tạo' : 'người xem';

  return [
    {
      ten: 'Danh sách thành viên',
      duKien: [
        ...dk('Số thành viên của tổ chức', tong, luuYLoc(loc)),
        ...dk(
          'Số quản trị viên',
          members.filter((m) => m.role === 'admin' && m.removedAt === null).length,
        ),
        ...dk('Tên các thành viên đang hiện', members.map((m) => m.fullName).join('; ')),
      ],
    },
    ...members.map((m) => ({
      ten: m.fullName,
      duKien: [
        ...dk(`Vai trò của ${m.fullName}`, vaiTro(m.role)),
        ...dk(`Email của ${m.fullName}`, m.email),
        ...dk(`Chức danh của ${m.fullName}`, m.jobTitle),
        ...dk(`${m.fullName} vào tổ chức lúc nào`, dinhDangNgay(m.joinedAt)),
        ...dk(
          `Lần đăng nhập gần nhất của ${m.fullName}`,
          m.lastLoginAt === null ? 'chưa đăng nhập lần nào' : dinhDangNgay(m.lastLoginAt),
        ),
        ...dk(
          `${m.fullName} còn hoạt động không`,
          m.removedAt !== null
            ? 'đã bị gỡ khỏi tổ chức'
            : !m.memberActive || !m.userActive
              ? 'đang bị tạm dừng'
              : 'đang hoạt động',
        ),
      ],
    })),
  ];
}

/**
 * Danh sách workspace.
 *
 * Con số này là phạm vi CỦA NGƯỜI ĐANG ĐĂNG NHẬP, không phải của cả tổ chức —
 * từ migration 40 hai thứ đó khác nhau, nên nhãn phải nói rõ.
 */
export function duKienWorkspace(ws: { id: number; name: string }[]): Nguon[] {
  return [
    {
      ten: 'Danh sách workspace',
      duKien: [
        ...dk('Số workspace bạn vào được', ws.length),
        ...dk('Tên các workspace bạn vào được', ws.map((w) => w.name).join('; ')),
      ],
    },
  ];
}

/** Thông tin tổ chức. */
export function duKienToChuc(t: { name: string; slug: string }): Nguon[] {
  return [
    {
      ten: `Tổ chức ${t.name}`,
      duKien: [...dk('Tên tổ chức', t.name), ...dk('Định danh (slug) của tổ chức', t.slug)],
    },
  ];
}

/** Trang Thanh toán — gói đang dùng, hạn mức và mức đã dùng. */
export function duKienThanhToan(s: BillingSummaryDto): Nguon[] {
  const muc = (ten: string, u: { used: number; limit: number | null }, byte = false): DuKien[] =>
    dk(
      `Đã dùng bao nhiêu ${ten}`,
      `${byte ? dinhDangDungLuong(u.used) : u.used.toLocaleString('vi-VN')} / ${dinhDangHanMuc(u.limit, byte)}`,
    );

  return [
    {
      ten: `Gói ${s.plan.name}`,
      duKien: [
        ...dk('Tổ chức đang dùng gói nào', s.plan.name),
        ...dk('Giá gói đang dùng', dinhDangTien(s.plan.priceVnd)),
        ...dk('Chu kỳ gói đang dùng', `${String(s.plan.durationDays)} ngày`),
        ...muc('workspace', s.usage.workspaces),
        ...muc('báo cáo', s.usage.reports),
        ...muc('thành viên', s.usage.members),
        ...muc('dung lượng', s.usage.storageBytes, true),
        ...dk(
          'Gói hiện tại hết hạn lúc nào',
          s.subscription === null
            ? 'gói Free không có ngày hết hạn'
            : dinhDangNgay(s.subscription.periodEnd),
        ),
        ...dk(
          'Trạng thái gói đang dùng',
          s.subscription === null ? 'chưa mua gói nào (đang ở Free)' : s.subscription.status,
        ),
      ],
    },
  ];
}

/** Bảng giá. */
export function duKienBangGia(plans: PlanDto[]): Nguon[] {
  return [
    {
      ten: 'Bảng giá',
      duKien: [
        ...dk('Có mấy gói đang bán', plans.length),
        ...dk('Tên các gói đang bán', plans.map((p) => p.name).join('; ')),
      ],
    },
    ...plans.map((p) => ({
      ten: p.name,
      duKien: [
        ...dk(`Giá gói ${p.name}`, dinhDangTien(p.priceVnd)),
        ...dk(`Chu kỳ gói ${p.name}`, `${String(p.durationDays)} ngày`),
        ...dk(`Gói ${p.name} cho mấy workspace`, dinhDangHanMuc(p.maxWorkspaces)),
        ...dk(`Gói ${p.name} cho mấy báo cáo`, dinhDangHanMuc(p.maxReports)),
        ...dk(`Gói ${p.name} cho mấy thành viên`, dinhDangHanMuc(p.maxMembers)),
        ...dk(`Gói ${p.name} cho bao nhiêu dung lượng`, dinhDangHanMuc(p.maxStorageBytes, true)),
        ...dk(`Mô tả gói ${p.name}`, p.description),
      ],
    })),
  ];
}

/** Danh sách đơn hàng. */
export function duKienDonHang(orders: OrderDto[], tong: number, loc = false): Nguon[] {
  return [
    {
      ten: 'Danh sách đơn hàng',
      duKien: [
        ...dk('Số đơn hàng của tổ chức', tong, luuYLoc(loc)),
        ...dk('Số đơn đang chờ thanh toán', orders.filter((o) => o.status === 'pending').length),
        ...dk('Mã các đơn đang hiện', orders.map((o) => o.orderCode).join('; ')),
      ],
    },
    ...orders.map((o) => ({
      ten: `Đơn ${o.orderCode}`,
      duKien: [
        ...dk(`Đơn ${o.orderCode} mua gói nào`, o.planName),
        ...dk(`Số tiền đơn ${o.orderCode}`, dinhDangTien(o.amountVnd)),
        ...dk(`Trạng thái đơn ${o.orderCode}`, o.status),
        ...dk(`Phương thức thanh toán đơn ${o.orderCode}`, o.paymentMethodName),
        ...dk(`Đơn ${o.orderCode} tạo lúc nào`, dinhDangNgay(o.createdAt)),
        ...dk(
          `Đơn ${o.orderCode} đã thanh toán chưa`,
          o.paidAt === null ? 'chưa thanh toán' : `đã thanh toán ${dinhDangNgay(o.paidAt)}`,
        ),
      ],
    })),
  ];
}

/* ═══ Ba trang chỉ nói về MỘT thứ ════════════════════════════════════════════
 *
 * Ba hàm dưới đây mượn lại đúng ba hàm danh sách ở trên rồi cắt bỏ phần tóm
 * tắt. Một màn chỉ có một kết nối mà vẫn khai "Số kết nối đang có: 1" thì câu
 * đó không trả lời cho ai cả, và nó còn cạnh tranh điểm với dữ kiện thật.
 *
 * Mượn lại, chứ không chép: dữ kiện của một kết nối phải giống hệt nhau dù
 * người dùng đang đứng ở trang danh sách hay trang sửa. Hai bản sao sẽ lệch
 * nhau ngay lần đầu có người thêm một trường.
 */

/** Trang sửa một kết nối. `null` khi đang TẠO MỚI — chưa có gì để hỏi. */
export function duKienMotKetNoi(conn: ConnectionDto | null): Nguon[] {
  return conn === null ? [] : duKienKetNoi([conn]).slice(1);
}

/** Màn mua gói: gói đang mua, kèm chu kỳ người dùng vừa chọn trên bảng giá. */
export function duKienMuaGoi(plan: PlanDto | undefined, cycle: BillingCycle): Nguon[] {
  if (plan === undefined) return [];
  const [goi] = duKienBangGia([plan]).slice(1);
  if (goi === undefined) return [];
  return [
    {
      ...goi,
      duKien: [
        ...goi.duKien,
        // Chu kỳ KHÔNG nằm trong `PlanDto` — nó là lựa chọn người dùng vừa bấm,
        // và nó quyết định số tiền sắp trả. Thiếu nó thì khung đọc giá tháng
        // cho một đơn đang mua theo năm.
        ...dk('Đang mua theo chu kỳ nào', cycle === 'yearly' ? 'theo năm' : 'theo tháng'),
      ],
    },
  ];
}

/**
 * Trang một đơn hàng — màn chờ tiền về.
 *
 * ⚠️ Mượn `duKienDonHang`, và đó là CHỖ CHẶN: `OrderDetailDto` còn mang
 * `bankAccountNo`, `bankBin`, `bankAccountName` và `qrPayload` (chuỗi EMVCo có
 * sẵn số tài khoản bên trong). `duKienDonHang` chỉ đọc các trường của `OrderDto`
 * nên bốn thứ đó không có đường nào đi vào câu trả lời — xem cùng lý do đã ghi ở
 * `duKienPhuongThucThanhToan`.
 */
export function duKienMotDonHang(order: OrderDto | undefined): Nguon[] {
  return order === undefined ? [] : duKienDonHang([order], 1).slice(1);
}

/* ═══ Phần 3: console vận hành hệ thống (/admin) ════════════════════════════
 *
 * Khu này chỉ superadmin vào được (`AdminRoute`), và nó NHÌN XUYÊN mọi tổ chức
 * — ngược hẳn với khu người dùng, nơi cách ly tổ chức là toàn bộ vấn đề.
 *
 * Vẫn cùng một luật: khung chỉ đọc thứ trang đã tải, nên phạm vi câu trả lời
 * trùng khít phạm vi mà `AdminRoute` đã cho phép. Không có đường nào để một
 * người không vào được console lại hỏi ra số liệu của console.
 */

/** Trang tổng quan hệ thống. */
export function duKienTongQuanHeThong(o: PlatformOverviewDto): Nguon[] {
  return [
    {
      ten: 'Tổng quan hệ thống',
      duKien: [
        ...dk('Số tổ chức đang hoạt động', o.activeTenants),
        ...dk('Số tổ chức đang bị khoá', o.lockedTenants),
        ...dk('Tổng số người dùng', o.totalUsers),
        ...dk('Số người dùng đang bị khoá', o.lockedUsers),
        ...dk('Tổng số workspace toàn hệ thống', o.totalWorkspaces),
        ...dk('Biểu đồ tăng trưởng đang xem mấy ngày', `${String(o.rangeDays)} ngày`),
      ],
    },
  ];
}

/** Danh sách tổ chức trong console. */
export function duKienDanhSachToChuc(ts: PlatformTenantDto[], tong: number, loc = false): Nguon[] {
  return [
    {
      ten: 'Danh sách tổ chức',
      duKien: [
        ...dk('Số tổ chức toàn hệ thống', tong, luuYLoc(loc)),
        ...dk('Số không gian cá nhân đang hiện', ts.filter((t) => t.isPersonal).length),
        ...dk('Tên các tổ chức đang hiện', ts.map((t) => t.name).join('; ')),
      ],
    },
    ...ts.map((t) => ({
      ten: t.name,
      duKien: [
        ...dk(`Số người dùng của tổ chức ${t.name}`, t.userCount),
        ...dk(`Số workspace của tổ chức ${t.name}`, t.workspaceCount),
        ...dk(`Tổ chức ${t.name} còn hoạt động không`, t.isActive ? 'đang hoạt động' : 'đã khoá'),
        ...dk(
          `Tổ chức ${t.name} có phải không gian cá nhân không`,
          t.isPersonal ? 'đúng, đây là không gian cá nhân' : 'không, đây là tổ chức thật',
        ),
        ...dk(`Tổ chức ${t.name} tạo lúc nào`, dinhDangNgay(t.createdAt)),
      ],
    })),
  ];
}

/** Danh sách người dùng trong console. */
export function duKienDanhSachNguoiDung(us: PlatformUserDto[], tong: number, loc = false): Nguon[] {
  return [
    {
      ten: 'Danh sách người dùng',
      duKien: [
        ...dk('Số người dùng toàn hệ thống', tong, luuYLoc(loc)),
        ...dk('Số superadmin đang hiện', us.filter((u) => u.platformRole === 'superadmin').length),
        ...dk('Tên các người dùng đang hiện', us.map((u) => u.fullName).join('; ')),
      ],
    },
    ...us.map((u) => ({
      ten: u.fullName,
      duKien: [
        ...dk(`Email của ${u.fullName}`, u.email),
        ...dk(`Chức danh của ${u.fullName}`, u.jobTitle),
        ...dk(
          `Vai trò nền tảng của ${u.fullName}`,
          u.platformRole === 'superadmin' ? 'superadmin' : 'người dùng thường',
        ),
        ...dk(`${u.fullName} thuộc mấy tổ chức`, u.tenants.length),
        ...dk(`${u.fullName} thuộc những tổ chức nào`, u.tenants.map((t) => t.name).join('; ')),
        ...dk(`Tài khoản ${u.fullName} còn mở không`, u.isActive ? 'đang mở' : 'đã khoá'),
        ...dk(
          `Lần đăng nhập gần nhất của ${u.fullName}`,
          u.lastLoginAt === null ? 'chưa đăng nhập lần nào' : dinhDangNgay(u.lastLoginAt),
        ),
      ],
    })),
  ];
}

/** Danh sách workspace trong console — xuyên mọi tổ chức. */
export function duKienWorkspaceHeThong(
  ws: PlatformWorkspaceDto[],
  tong: number,
  loc = false,
): Nguon[] {
  return [
    {
      ten: 'Danh sách workspace toàn hệ thống',
      duKien: [
        ...dk('Số workspace toàn hệ thống', tong, luuYLoc(loc)),
        ...dk('Tên các workspace đang hiện', ws.map((w) => w.name).join('; ')),
      ],
    },
    ...ws.map((w) => ({
      ten: `${w.name} (${w.tenantName})`,
      duKien: [
        ...dk(`Workspace ${w.name} thuộc tổ chức nào`, w.tenantName),
        ...dk(`Số báo cáo trong workspace ${w.name}`, w.reportCount),
        ...dk(`Workspace ${w.name} còn hoạt động không`, w.isActive ? 'đang hoạt động' : 'đã khoá'),
        ...dk(`Mô tả workspace ${w.name}`, w.description),
        ...dk(`Workspace ${w.name} tạo lúc nào`, dinhDangNgay(w.createdAt)),
      ],
    })),
  ];
}

/** Phương thức thanh toán trong console. */
export function duKienPhuongThucThanhToan(ms: PaymentMethodDto[]): Nguon[] {
  return [
    {
      ten: 'Phương thức thanh toán',
      duKien: [
        ...dk('Có mấy phương thức thanh toán', ms.length),
        ...dk('Số phương thức đang bật', ms.filter((m) => m.isActive).length),
        ...dk(
          'Phương thức nào CHƯA cấu hình xong',
          ms
            .filter((m) => !m.isConfigured)
            .map((m) => m.name)
            .join('; ') || 'tất cả đã cấu hình xong',
        ),
      ],
    },
    ...ms.map((m) => ({
      ten: m.name,
      duKien: [
        ...dk(`Phương thức ${m.name} đang bật hay tắt`, m.isActive ? 'đang bật' : 'đang tắt'),
        ...dk(
          `Phương thức ${m.name} đã cấu hình xong chưa`,
          m.isConfigured ? 'đã đủ thông tin' : 'còn thiếu thông tin ngân hàng',
        ),
        ...dk(`Nhà cung cấp của ${m.name}`, m.provider),
        /*
         * ⚠️ CỐ Ý không khai `bankAccountNo`, `bankBin`, `bankAccountName`.
         *
         * Số tài khoản nhận tiền là dữ liệu vận hành thật. Khai nó ở đây là mở
         * đường cho nó đi lên mô hình ngôn ngữ của một hãng thứ ba trong một
         * câu trả lời — xem `services/chat/dienDat.ts`. `isConfigured` trả lời
         * được câu hỏi người vận hành thật sự hỏi ("đã điền xong chưa") mà
         * không phải phơi con số ra.
         */
      ],
    })),
  ];
}

/**
 * Hồ sơ của chính người đang đăng nhập.
 *
 * ⚠️ Chỉ những gì CHÍNH HỌ thấy trên màn hình hồ sơ. Không có gì về người khác,
 * và không có gì về mật khẩu.
 */
export function duKienHoSo(u: {
  fullName: string;
  email: string;
  jobTitle?: string | null;
}): Nguon[] {
  return [
    {
      ten: `Hồ sơ ${u.fullName}`,
      duKien: [
        ...dk('Tên của tôi', u.fullName),
        ...dk('Email của tôi', u.email),
        ...dk('Chức danh của tôi', u.jobTitle),
      ],
    },
  ];
}
