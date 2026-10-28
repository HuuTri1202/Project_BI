import {
  CHART_TYPE_LABELS,
  DATASET_SOURCE_LABELS,
  REPORT_SOURCE_LABELS,
  type AdminUserDto,
  type BillingCycle,
  type BillingSummaryDto,
  type ConnectionDto,
  type DataModelDetailDto,
  type DataModelDto,
  type DatasetDetailDto,
  type DatasetDto,
  type DatasetPreviewDto,
  type ExplorerResultDto,
  type ReportDataDto,
  type FolderDto,
  type HomeDataDto,
  type OrderDto,
  ORDER_STATUS_LABELS,
  type PaymentMethodDto,
  type PlanDto,
  type PlatformOverviewDto,
  type PlatformTenantDto,
  type PlatformUserDto,
  type PlatformWorkspaceDto,
  RELATIONSHIP_KIND_LABELS,
  type ReportDto,
  type WarehouseSchemaDto,
} from '@bi/shared';

import { dinhDangDungLuong, dinhDangHanMuc, dinhDangNgay, dinhDangTien } from '../billing/format';
import type { BangTho, DuKien, Nguon } from './nguCanh';

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

function docNguon(ds: DatasetDto): string {
  if (ds.source === 'file') {
    const ten = ds.originalFilename ?? 'một tệp đã tải lên';
    return ds.sheetName === null ? ten : `${ten}, sheet "${ds.sheetName}"`;
  }
  const bang = [ds.sourceSchema, ds.sourceTable].filter((x) => x !== null).join('.');
  return ds.connectionName === null ? bang : `bảng ${bang} qua kết nối "${ds.connectionName}"`;
}

/*
 * Mốc cập nhật gần nhất của một bộ dữ liệu, dạng ISO — hoặc `null`.
 *
 * `loadedAt` đứng TRƯỚC `syncedAt`: nạp vào kho phân tích là việc xảy ra sau
 * đồng bộ, nên nó mới là lần cuối con số trên màn hình đổi. Bộ từ tệp không có
 * `syncedAt`, bộ chưa nạp không có `loadedAt`, nên phải lấy cái nào đang có.
 *
 * Trả về nguyên chuỗi ISO chứ không định dạng sẵn: ISO 8601 so sánh bằng chuỗi
 * ra đúng thứ tự thời gian, nên chỗ nào cần XẾP HẠNG thì dùng thẳng được.
 */
function mocCapNhat(ds: DatasetDto): string | null {
  /*
   * `?? null` ở cuối KHÔNG thừa dù kiểu khai là `string | null`.
   *
   * Kiểu khai là một GIẢ ĐỊNH về mạng, không phải bảo đảm: frontend và backend
   * triển khai độc lập, nên một bản frontend mới nói chuyện với bản backend cũ
   * là chuyện bình thường và khi đó trường này VẮNG MẶT. Thiếu dòng này thì
   * `undefined !== null` lọt qua chốt bên dưới và khung in ra "Invalid Date" —
   * một dữ kiện hỏng, đứng cạnh sáu dữ kiện đúng.
   */
  return ds.loadedAt ?? ds.syncedAt ?? null;
}

/*
 * In ngày theo ĐÚNG cách `DatasetsPage` đang in nó.
 *
 * Khung nói "25/10/2026" còn bảng ngay cạnh nói "2026-10-25" là bắt người đọc
 * tự dịch giữa hai bản của cùng một mốc — cùng lý do `formatValue` được dùng
 * lại thay vì viết phép chia thứ hai.
 */
function docNgay(iso: string): string {
  return new Date(iso).toLocaleDateString('vi-VN');
}

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
    /*
     * ⚠️ `truncated` PHẢI là một DỰ KIỆN riêng, không chỉ là `luuY` ở trên.
     *
     * `luuY` là chú thích đi KÈM một câu trả lời khác — nó chỉ tối nơi khi người
     * ta đã hỏi về số dòng. Còn "có bộ nào bị cắt dữ liệu không" hỏi về CHÍNH
     * cái cờ ấy, và không lớp nào trả lời được một thứ chưa được khai.
     *
     * ĐO ĐƯỢC: cả câu danh sách lẩn câu gọi tên ("bộ Orders có bị cắt không")
     * đều bế tắc, trong khi màn hình ngay cạnh đó đang hiện một nhãn "đã cắt
     * bớt". Một câu hỏi CÓ/KHÔNG không cần ý định mới nào — các lớp sẵn có trả
     * lời được hết, miễn là dự kiện tồn tại.
     *
     * ⚠️ GIÁ TRỊ là chữ MÔ TẢ, KHÔNG phải "có"/"không" như dự kiện SSL.
     *
     * `locNguon` — lớp duy nhất trả lời được câu hỏi trên CẢ danh sách — nhận ra
     * cột qua GIÁ TRỊ của nó nằm trong câu hỏi, và nó bỏ mọi giá trị ngắn hơn
     * năm ký tự vì "có"/"không" có trong gần như mọi câu hỏi. Nên một cờ khai
     * thành "có"/"không" trả lời được câu GỊI TÊN mà không bao giờ trả lời được
     * câu DANH SÁCH. Chữ mô tả thì được cả hai.
     *
     * "bị cắt" chứ không phải "đã cắt bớt" như nhãn trên màn hình: `locNguon` đòi
     * giá trị nằm nguyên cụm trong câu hỏi, và "bị cắt" nằm trong CẢ hai cách gõ
     * tự nhiên ("bị cắt dữ liệu", "bị cắt bớt"), còn "đã cắt bớt" thì không nằm
     * trong cách nào. Đây là ngoại lệ CÓ Ý của luật "lấy chữ trên màn hình".
     */
    {
      nhan: `${ds.name} bị cắt bớt hay đầy đủ`,
      gia: ds.truncated ? 'bị cắt' : 'đầy đủ',
    },
    { nhan: `Nguồn gốc của ${ds.name}`, gia: docNguon(ds) },
    { nhan: `Trạng thái của ${ds.name}`, gia: docTrangThaiNap(ds) },
    { nhan: `Số mô hình dữ liệu dùng ${ds.name}`, gia: String(ds.datamodelCount) },
  ];

  /*
   * NGÀY CẬP NHẬT — thiếu nó là một câu SAI, không phải một câu thiếu.
   *
   * Trước bản này khung khai bảy dữ kiện cho mỗi bộ và KHÔNG cái nào nói về
   * thời gian. Hỏi "bộ nào cập nhật gần đây nhất" thì phép so từ khoá trượt,
   * rơi xuống lớp chọn-nhãn, và mô hình buộc phải chọn một trong bảy nhãn
   * đang có. Đo được trên máy thật: nó chọn "Số mô hình dữ liệu dùng …" và
   * trả về "là 1" — một con số THẬT cho một câu hỏi KHÁC.
   *
   * Đó đúng là kết cục SAI mà cả khung dựng lên để chặn, và chặn nó không
   * phải bằng cách dạy mô hình từ chối — mà bằng cách để câu hỏi có một đáp
   * án thật để khớp vào.
   */
  const moc = mocCapNhat(ds);
  if (moc !== null) {
    d.push({
      nhan: `Cập nhật lần cuối của ${ds.name}`,
      gia: docNgay(moc),
      // Nói rõ mốc này là mốc GÌ khi nó không phải lần nạp: "cập nhật" của một
      // bộ chưa nạp nghĩa là đồng bộ cấu trúc, số liệu thì chưa vào kho.
      ...(ds.loadedAt === null
        ? { luuY: 'đây là lần đồng bộ từ CSDL nguồn; bộ này chưa nạp vào kho phân tích' }
        : {}),
    });
  }

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

function luuYChuaDu(hien: number, tong: number): string | undefined {
  return tong > hien
    ? `đếm trên ${hien.toLocaleString('vi-VN')} mục đang hiện, không phải toàn bộ ${tong.toLocaleString('vi-VN')}`
    : undefined;
}

function luuYLoc(loc: boolean): string | undefined {
  return loc ? 'đếm trên phần ĐANG LỌC, không phải toàn bộ' : undefined;
}

/* ═══ BẢNG THÔ của một trang danh sách ═══════════════════════════════════════
 *
 * ─── Lỗ mà nó bịt, và vì sao nó bịt được cả bốn lỗ một lúc ─────────────────
 *
 * Trang danh sách khai mỗi mục thành một `Nguon` riêng, nên `soSanhNguon` so
 * được GIỮA các mục: "mô hình nào nhiều bảng nhất" chạy từ lâu. Nhưng nó chỉ
 * làm được chừng ấy. Đo được trên 12 ý định × 3 loại nguồn:
 *
 *   biểu đồ (`bang`)      12/12
 *   bảng thô (`bangTho`)  12/12
 *   danh sách mục          6/12   ← thiếu TỔNG, TRUNG BÌNH, XẾP HẠNG, LỌC
 *
 * Và bằng chứng trực tiếp rằng `bangTho` là thứ còn thiếu, không phải một phép
 * tính nào:
 *
 *   "xếp hạng bộ dữ liệu theo số dòng"   ĐÚNG       (Kho dữ liệu CÓ khai bảng)
 *   "xếp hạng mô hình theo số bảng"      chưa hiểu  (trang mô hình KHÔNG khai)
 *
 * Nên mỗi trang khai thêm chính cái bảng nó đang in ra màn hình là được cả
 * bốn ý định kia miễn phí, qua đúng bộ máy `bangTuBangTho` đã có test.
 *
 * ─── Ba luật của một bảng khai ở đây ───────────────────────────────────────
 *
 * ⚠️ 1. Ô SỐ phải là SỐ THÔ. `oThanhSo` đọc bằng `Number()`, nên một chuỗi
 * vi-VN như "51.290" ra 51,29 — sai hơn ba nghìn lần, và sai im lặng. Không
 * bao giờ cho `dinhDangTien`/`dinhDangHanMuc`/`toLocaleString` vào đây.
 *
 * ⚠️ 2. TÊN CỘT lấy đúng chữ đang in trên tiêu đề bảng, vì `cotGoiTen` khớp
 * tên cột như một TỪ NGUYÊN trong câu hỏi. Đặt "Số bảng" thì "mô hình nào
 * nhiều bảng nhất" trượt — trong câu chỉ có " bang ", không có " so bang ".
 *
 * ⚠️ 3. Nhưng KHÔNG đặt tên cột trùng với thứ một DỮ KIỆN đã trả lời. Cột
 * "Số mô hình dùng" của Kho dữ liệu cố ý không gọn lại thành "Mô hình": gọn
 * lại thì "có bao nhiêu mô hình" khớp vào cột ấy rồi đếm số giá trị KHÁC NHAU
 * của một cột đếm — một con số có thật, trả lời câu hỏi khác, và nó chặn luôn
 * đường sang dữ kiện xuyên hệ thống vốn trả lời đúng câu đó.
 */
function bangDanhSach(
  cot: string[],
  dong: (string | number | boolean | null)[][],
  tong: number,
  don: string,
): BangTho | undefined {
  if (dong.length === 0) return undefined;
  const so = (x: number): string => x.toLocaleString('vi-VN');
  return {
    cot,
    dong,
    /*
     * `luuY` BẮT BUỘC nói ra phạm vi. Trang danh sách nào cũng phân trang, và
     * vài trang còn mặc định lọc; "mục nào cao nhất" tính trên 20 trong 24 là
     * một con số có thật cho một câu hỏi về cả danh sách.
     */
    luuY:
      tong > dong.length
        ? `chỉ gồm ${so(dong.length)} ${don} đang hiện trên trang này, không phải toàn bộ ${so(tong)}`
        : `gồm cả ${so(dong.length)} ${don} trong phạm vi đang xem`,
  };
}

function gopLuuY(...phan: (string | undefined)[]): string | undefined {
  const co = phan.filter((x): x is string => x !== undefined && x !== '');
  return co.length === 0 ? undefined : co.join('; ');
}

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

  /*
   * "Cái nào mới nhất" — CODE tính, không ai xếp hạng hộ.
   *
   * Xếp hạng theo cột ngày là thứ `tinhBang` KHÔNG làm được: `cotDoDuoc` chỉ
   * nhận cột mà mọi ô đều đọc ra số, nên một cột ngày luôn bị loại. Dạy nó
   * hiểu ngày thì mở luôn cửa cho "tổng của cột ngày" — một con số có thật,
   * hoàn toàn vô nghĩa, tức đúng loại SAI đang phải chặn.
   *
   * Nên phép so nằm ở đây, trên chuỗi ISO (so chuỗi ra đúng thứ tự thời gian),
   * và kết quả thành MỘT dữ kiện đọc sẵn. Mô hình chỉ còn việc chọn nhãn.
   */
  const moiNhat = ds.reduce<DatasetDto | null>((tot, d) => {
    const a = mocCapNhat(d);
    if (a === null) return tot;
    const b = tot === null ? null : mocCapNhat(tot);
    return b === null || a > b ? d : tot;
  }, null);
  const mocMoiNhat = moiNhat === null ? null : mocCapNhat(moiNhat);

  return [
    ...dk(`Số bộ dữ liệu ${pham}`, tong),
    ...dk('Tên các bộ dữ liệu đang hiện', ds.map((d) => d.name).join('; ')),
    ...(moiNhat === null || mocMoiNhat === null
      ? []
      : dk('Bộ dữ liệu cập nhật gần đây nhất', `${moiNhat.name} (${docNgay(mocMoiNhat)})`, chuaDu)),
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

/*
 * CHÍNH BẢNG đang hiện trên màn hình, dưới dạng bảng thô.
 *
 * ─── Lỗ mà nó bịt ──────────────────────────────────────────────────────────
 *
 * Trước bản này trang chỉ khai dữ kiện dạng nhãn→giá trị, nên mọi câu LỌC
 * THEO NGƯỠNG đều bế tắc: "bộ nào có hơn 50.000 dòng" không có bảng nào để
 * lọc, dù con số đang nằm ngay trên màn hình. `docDieuKien` (các phép `>`,
 * `<`, `>=`) chỉ chạy bên trong `tinhBang`, mà `tinhBang` cần một bảng.
 *
 * Khai bảng này là nối trang vào đúng bộ máy ĐÃ CÓ và đã có test — không
 * viết thêm phép tính nào.
 *
 * ⚠️ Ô số phải là SỐ THÔ, không phải chuỗi đã định dạng. `oThanhSo` đọc bằng
 * `Number()`, nên "51.290" kiểu vi-VN sẽ ra 51,29 — sai hơn ba nghìn lần, và
 * sai im lặng.
 */
function bangKhoDuLieu(ds: DatasetDto[], tong: number): BangTho | undefined {
  if (ds.length === 0) return undefined;
  return {
    /*
     * Tên cột lấy ĐÚNG tiêu đề đang in trên bảng: Tên · Nguồn · Cột · Dòng.
     *
     * Không phải cho đẹp. `cotGoiTen` khớp tên cột như một TỪ NGUYÊN trong câu
     * hỏi, nên đặt là "Số dòng" thì câu "bộ nào có hơn 50.000 dòng" trượt —
     * trong câu chỉ có " dong ", không có " so dong ". Người dùng gõ lại đúng
     * chữ họ đọc được trên màn hình, nên cột phải mang chính chữ đó.
     */
    cot: ['Tên', 'Thư mục', 'Nguồn', 'Cột', 'Dòng', 'Số mô hình dùng', 'Cập nhật lần cuối'],
    dong: ds.map((d) => {
      const moc = mocCapNhat(d);
      return [
        d.name,
        d.folderName ?? 'Chung',
        docNguon(d),
        d.columnCount,
        d.rowCount,
        d.datamodelCount,
        moc === null ? null : docNgay(moc),
      ];
    }),
    /*
     * `luuY` BẮT BUỘC nói ra phạm vi, và đây là chỗ nó quan trọng nhất của cả
     * tệp: trang phân trang 20 mục một lần và mặc định lọc theo một thư mục.
     * "Bộ nào nhiều dòng nhất" tính trên 20 trong 24 là một con số có thật
     * cho một câu hỏi về cả kho — đúng loại sai mà `truncated` của §7 đã phải
     * chặn một lần rồi.
     */
    luuY:
      tong > ds.length
        ? `chỉ gồm ${ds.length.toLocaleString('vi-VN')} bộ đang hiện trên trang này, không phải toàn bộ ${tong.toLocaleString('vi-VN')} bộ của workspace`
        : `gồm cả ${ds.length.toLocaleString('vi-VN')} bộ trong phạm vi đang xem`,
  };
}

export function duKienKhoDuLieu(ds: DatasetDto[], tong = ds.length): Nguon[] {
  const bangTho = bangKhoDuLieu(ds, tong);
  return [
    {
      ten: 'Danh sách bộ dữ liệu',
      duKien: tomTatBoDuLieu(ds, tong, 'trong workspace này'),
      ...(bangTho === undefined ? {} : { bangTho }),
    },
    ...ds.map((d) => ({ ten: d.name, duKien: duKienChung(d) })),
  ];
}

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

export function nguonTrinhDung(
  tenO: string | null,
  bang: ReportDataDto | undefined,
  duKienO: DuKien[],
  moHinh: DataModelDetailDto | undefined,
): Nguon[] {
  return [
    ...(bang === undefined || tenO === null ? [] : [{ ten: tenO, duKien: duKienO, bang }]),
    ...(moHinh === undefined ? [] : duKienMoHinh(moHinh)),
  ];
}

export function duKienKhamPha(kq: ExplorerResultDto | null): Nguon[] {
  if (kq === null || kq.rows.length === 0) return [];

  const soDong = kq.rows.length.toLocaleString('vi-VN');
  return [
    {
      ten: 'Kết quả Khám phá',
      duKien: [
        { nhan: 'Số dòng của kết quả Khám phá', gia: soDong },
        { nhan: 'Số cột của kết quả Khám phá', gia: String(kq.columns.length) },
      ],
      bangTho: {
        /*
         * Dùng `mota` khi có ("Tổng của Total amount"), không dùng `label` trơn.
         * Doc của `ExplorerResultDto.columns` đã ghi vì sao: thước đo gieo sẵn
         * TRÙNG TÊN với cột nó gộp, nên "Total amount" vừa có nghĩa là tiền của
         * MỘT đơn vừa có nghĩa là tổng tiền cả nhóm. Khung lặp lại cái tên trơn
         * là lặp lại đúng chỗ nhập nhằng mà bảng trên màn hình đã gỡ ra.
         */
        cot: kq.columns.map((c) => c.mota ?? c.label),
        dong: kq.rows,
        luuY: kq.truncated
          ? `tính trên ${soDong} dòng ĐÃ BỊ CẮT của kết quả Khám phá — truy vấn chạm trần, còn dữ liệu chưa lấy hết`
          : `tính trên ${soDong} dòng kết quả Khám phá đang hiện`,
      },
    },
  ];
}

export function duKienMoHinh(m: DataModelDetailDto, bangTruoc?: number | null): Nguon[] {
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

  /*
   * ═══ Từng QUAN HỆ một, không chỉ đếm ═════════════════════════════════════
   *
   * Tab Quan hệ VẼ RA các mối nối trên màn hình — bảng nào với bảng nào, qua
   * cột nào, kiểu một-nhiều hay nhiều-một. Mà khung chỉ biết đúng CON SỐ
   * `Số quan hệ`, nên "Orders nối Customers qua cột nào" rơi xuống "chưa
   * hiểu" trong lúc câu trả lời đang nằm trước mắt người hỏi.
   *
   * ⚠️ Nói ra cả KIỂU quan hệ, không chỉ hai cái tên cột. Kiểu nối là thứ
   * quyết định một phép SUM có bị nhân bản hay không — doc của
   * `RelationshipWarningDto` gọi nó là nguồn của câu "số bị sai" đầu tiên mà
   * người dùng gặp. Một câu trả lời bỏ nó đi thì đúng chữ mà thiếu đúng phần
   * giải thích được con số.
   */
  for (const r of m.relationships) {
    chung.push({
      nhan: `Quan hệ giữa bảng ${r.left.datasetName} và bảng ${r.right.datasetName}`,
      gia:
        `${r.left.datasetName}.${r.left.columnName} nối ${r.right.datasetName}.${r.right.columnName}` +
        ` — ${RELATIONSHIP_KIND_LABELS[r.kind]}`,
    });
  }

  if (m.relationships.length > 0) {
    chung.push({
      nhan: `Danh sách quan hệ của mô hình ${m.name}`,
      gia: m.relationships.map((r) => `${r.left.datasetName} ↔ ${r.right.datasetName}`).join('; '),
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

  const tomTat: Nguon = { ten: `Mô hình ${m.name}`, duKien: chung };
  const i = bangTruoc == null ? -1 : m.datasets.findIndex((ds) => ds.id === bangTruoc);
  const mo = i < 0 ? undefined : bang[i];

  // Bảng đang mở đứng TRƯỚC cả bản tóm tắt. Id lạ (bảng vừa bị xoá ở tab khác)
  // thì rơi về thứ tự cũ, không ném.
  return mo === undefined ? [tomTat, ...bang] : [mo, tomTat, ...bang.filter((_, j) => j !== i)];
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

function dk(nhan: string, gia: string | number | null | undefined, luuY?: string): DuKien[] {
  if (gia === null || gia === undefined || gia === '') return [];
  const doc = typeof gia === 'number' ? gia.toLocaleString('vi-VN') : gia;
  return [{ nhan, gia: doc, ...(luuY === undefined ? {} : { luuY }) }];
}

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

  /*
   * Tiêu đề thật trên `ReportsPage`: Tên · Biểu đồ · Nguồn · Người tạo · Cập
   * nhật lần cuối.
   *
   * ⚠️ HAI chỗ lệch khỏi tiêu đề, cả hai đều có lý do đo được:
   *
   *   Cột LOẠI biểu đồ tên là "Loại", không phải "Biểu đồ". Vì cột ĐẾM ô cần
   *   đúng hai chữ "Biểu đồ" — "báo cáo nào nhiều biểu đồ nhất" là câu người
   *   ta hỏi, và `cotGoiTen` khớp tên cột như một từ nguyên nên chỉ một trong
   *   hai cột được mang cái tên ấy. Cột đếm cần nó hơn: lọc và xếp hạng chỉ
   *   chạy trên cột số, còn lọc theo LOẠI thì `cotQuaGiaTri` tìm bằng chính
   *   giá trị ("biểu đồ cột") nên không cần tên cột khớp.
   *
   *   "Số báo cáo" KHÔNG thành một cột. Mỗi dòng đã là một báo cáo, nên cột
   *   ấy vô nghĩa — và nó sẽ cướp câu "có bao nhiêu báo cáo" của dữ kiện tóm
   *   tắt ngay bên trên.
   */
  const bangTho = bangDanhSach(
    ['Tên', 'Loại', 'Nguồn', 'Thư mục', 'Người tạo', 'Biểu đồ', 'Trang', 'Cập nhật lần cuối'],
    reports.map((r) => [
      r.name,
      r.chartType === null ? null : CHART_TYPE_LABELS[r.chartType],
      r.sourceName,
      r.folderName ?? 'Chung',
      r.creatorName,
      r.canvas?.pages.flatMap((p) => p.visuals).length ?? 1,
      r.canvas?.pages.length ?? 1,
      dinhDangNgay(r.updatedAt),
    ]),
    tong,
    'báo cáo',
  );

  return [
    {
      ten: 'Danh sách báo cáo',
      duKien: [
        ...dk('Số báo cáo trong workspace này', tong),
        ...dk('Tên các báo cáo đang hiện', reports.map((r) => r.name).join('; ')),
      ],
      ...(bangTho === undefined ? {} : { bangTho }),
    },
    ...reports.map((r) => ({ ten: r.name, duKien: mot(r) })),
  ];
}

function chuaNoiDu(m: DataModelDto): boolean {
  return m.relationshipCount < m.datasetCount - 1;
}

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

export function duKienNguonBaoCao(r: ReportDto): DuKien[] {
  return [
    ...dk(
      `Nguồn số liệu của báo cáo ${r.name}`,
      `${REPORT_SOURCE_LABELS[r.source]} ${r.sourceName}`,
      /*
       * ⚠️ Vế này không phải trang trí — nó sửa một câu ĐÚNG mà đọc ra nghĩa KHÁC.
       *
       * Lỗi đo được: báo cáo tên "doanh thu theo name", trên khung có hai ô
       * "doanh thu theo Name" và "Sale price theo Name". Người dùng chọn ô thứ
       * hai, hỏi "lấy từ đâu ra đó", nhận về "Nguồn số liệu của báo cáo doanh
       * thu theo name là …". Đúng từng chữ, nhưng tên báo cáo trùng gần hệt tên
       * ô BÊN CẠNH, nên nó đọc thành "khung đang trả lời về biểu đồ khác" — và
       * người đọc không có dấu hiệu nào để biết là không phải.
       *
       * Gốc rễ không nằm ở cái tên trùng: đây là dữ kiện DUY NHẤT gắn vào mọi
       * nguồn, nên là dữ kiện duy nhất mà chủ ngữ không phải con chip đang
       * chọn. Một câu đổi chủ ngữ giữa chừng thì phải tự nói ra là nó đổi.
       *
       * Đặt ở `luuY`, KHÔNG nhét vào `nhan`: `traCuu` chấm điểm bằng số TỪ
       * trùng giữa nhãn và câu hỏi, nên mỗi chữ thêm vào nhãn là một đường khớp
       * nhầm mới. `luuY` đứng ngoài phép chấm, và lời nhắc của lớp diễn đạt đã
       * buộc mô hình giữ lại vế điều kiện.
       */
      'Mọi biểu đồ trong báo cáo này đều lấy số từ đó.',
    ),
    /*
     * Chỉ báo cáo dựng trên BỘ DỮ LIỆU mới có dòng này. Báo cáo dựng trên mô
     * hình thì `datasetSource` là `null` — mô hình gộp nhiều bảng, mỗi bảng một
     * nguồn, nên một câu "từ file" cho cả mô hình là một câu nói sai. Ai cần
     * biết tới mức đó thì mở trang mô hình, nơi `duKienMoHinh` khai từng bảng.
     */
    ...dk(
      `Nguồn của bộ dữ liệu ${r.sourceName}`,
      r.datasetSource === null ? null : DATASET_SOURCE_LABELS[r.datasetSource],
    ),
  ];
}

export function duKienThuMuc(thuMuc: FolderDto[]): Nguon[] {
  return thuMuc.map((t) => ({
    ten: `Thư mục ${t.name}`,
    duKien: dk(`Số mục trong Thư mục ${t.name}`, t.itemCount),
  }));
}

export function tongTheoThuMuc(chungCount: number, thuMuc: FolderDto[]): number {
  return thuMuc.reduce((t, m) => t + m.itemCount, chungCount);
}

export function tomTatThuMuc(thuMuc: FolderDto[]): DuKien[] {
  if (thuMuc.length === 0) return [];
  return [
    ...dk('Số thư mục của workspace này', thuMuc.length),
    ...dk('Tên các thư mục', thuMuc.map((t) => t.name).join('; ')),
  ];
}

export function duKienDanhSachMoHinh(models: DataModelDto[], tong: number, loc = false): Nguon[] {
  /*
   * Tiêu đề thật trên `DataModelsPage`: Tên · Bảng · Thước đo · Quan hệ ·
   * Báo cáo · Người tạo · Cập nhật lần cuối.
   *
   * ⚠️ "Báo cáo" cố ý ĐỂ NGUYÊN chứ không đổi thành "Số báo cáo dùng", khác
   * cách cột "Số mô hình dùng" của Kho dữ liệu phải làm. Lý do là trang này
   * KHÔNG có dữ kiện nào đếm báo cáo, nên không có đáp án nào để nó cướp —
   * còn "mô hình nào nhiều báo cáo nhất" thì chỉ khớp được khi cột tên đúng
   * hai chữ ấy. Có ca canh trong bộ đánh giá cho cả hai chiều.
   */
  const bangTho = bangDanhSach(
    ['Tên', 'Bảng', 'Thước đo', 'Quan hệ', 'Báo cáo', 'Người tạo', 'Cập nhật lần cuối'],
    models.map((m) => [
      m.name,
      m.datasetCount,
      m.measureCount,
      m.relationshipCount,
      m.reportCount,
      m.creatorName,
      dinhDangNgay(m.updatedAt),
    ]),
    tong,
    'mô hình',
  );
  return [
    {
      ten: 'Danh sách mô hình dữ liệu',
      duKien: tomTatMoHinh(models, tong, 'trong workspace này', loc),
      ...(bangTho === undefined ? {} : { bangTho }),
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

export function duKienKetNoi(conns: ConnectionDto[]): Nguon[] {
  /*
   * ⚠️ Cột đếm tên là "Bộ dữ liệu", không phải "Tập dữ liệu" như tiêu đề đang
   * in trên `ConnectionsPage`. Luật "lấy đúng chữ trên màn hình" nhường ở đây
   * vì chính màn hình đang lệch với cả phần còn lại của sản phẩm: mục sidebar
   * là "Kho dữ liệu", mọi dữ kiện nói "bộ dữ liệu", và người dùng gõ lại chữ
   * họ gặp nhiều nhất. Một tiêu đề lẻ không đủ để đổi từ vựng của cả hệ thống.
   */
  const bangTho = bangDanhSach(
    ['Tên', 'Loại', 'Máy chủ', 'Database', 'Bộ dữ liệu', 'Kiểm tra gần nhất'],
    conns.map((c) => [
      c.name,
      c.kind,
      `${c.host}:${String(c.port)}`,
      c.databaseName,
      c.datasetCount,
      c.lastTestedAt === null ? 'chưa kiểm tra lần nào' : dinhDangNgay(c.lastTestedAt),
    ]),
    conns.length,
    'kết nối',
  );
  return [
    {
      ten: 'Danh sách kết nối',
      duKien: [
        ...dk('Số kết nối đang có', conns.length),
        ...dk('Tên các kết nối', conns.map((c) => c.name).join('; ')),
      ],
      ...(bangTho === undefined ? {} : { bangTho }),
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

export function duKienToChuc(t: { name: string; slug: string }): Nguon[] {
  return [
    {
      ten: `Tổ chức ${t.name}`,
      duKien: [...dk('Tên tổ chức', t.name), ...dk('Định danh (slug) của tổ chức', t.slug)],
    },
  ];
}

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

const BYTE_MOT_GB = 1024 ** 3;

export function duKienBangGia(plans: PlanDto[]): Nguon[] {
  /*
   * ⚠️ SỐ THÔ, không phải `dinhDangTien`/`dinhDangHanMuc` — hai hàm đó trả về
   * chuỗi vi-VN ("1.990.000 ₫", "Không giới hạn"), và `oThanhSo` đọc chúng
   * thành 1,99 hoặc `null`. Cả cột mất quyền tính toán vì một dấu chấm.
   *
   * `null` của hạn mức nghĩa là KHÔNG GIỚI HẠN, và để nguyên `null` là đúng:
   * `cotDoDuoc` bỏ qua ô rỗng, nên gói không giới hạn không bị đọc thành gói
   * hạn mức 0 — tức không bao giờ thành "gói ít báo cáo nhất".
   *
   * Dung lượng đổi sang GB vì đó là con số đang in trên màn hình; để nguyên
   * byte là câu trả lời đọc ra "53.687.091.200" cho một dòng ghi "50 GB".
   */
  const bangTho = bangDanhSach(
    ['Tên', 'Giá', 'Chu kỳ', 'Workspace', 'Báo cáo', 'Thành viên', 'Dung lượng'],
    plans.map((p) => [
      p.name,
      p.priceVnd,
      p.durationDays,
      p.maxWorkspaces,
      p.maxReports,
      p.maxMembers,
      p.maxStorageBytes === null ? null : Math.round(p.maxStorageBytes / BYTE_MOT_GB),
    ]),
    plans.length,
    'gói',
  );
  return [
    {
      ten: 'Bảng giá',
      duKien: [
        ...dk('Có mấy gói đang bán', plans.length),
        ...dk('Tên các gói đang bán', plans.map((p) => p.name).join('; ')),
      ],
      ...(bangTho === undefined ? {} : { bangTho }),
    },
    ...plans.map((p) => ({
      ten: p.name,
      duKien: [
        ...dk(`Giá gói ${p.name}`, dinhDangTien(p.priceVnd)),
        ...dk(`Chu kỳ gói ${p.name}`, `${String(p.durationDays)} ngày`),
        /*
         * ⚠️ CỤM DANH TỪ, không phải câu hỏi — luật đã ghi ở `duKienNguonBaoCao`,
         * và đây là chỗ vi phạm nó đắt nhất.
         *
         * LỖI ĐO ĐƯỢC: nhãn cũ là "Gói Pro cho bao nhiêu dung lượng", nên câu
         * "giá gói Pro bao nhiêu" trùng với nó BỐN chữ (gói, pro, bao, nhiêu)
         * trong khi nhãn đúng "Giá gói Pro" chỉ trùng ba. Người dùng hỏi giá,
         * nhận về dung lượng — một con số có thật, của một câu hỏi khác.
         *
         * Chữ để hỏi nằm trong nhãn thì nó cạnh tranh bằng chính chữ để hỏi,
         * chứ không bằng nghĩa. Và `TU_HOI` không gỡ được: "bao" cũng là "báo".
         */
        ...dk(`Hạn mức workspace của gói ${p.name}`, dinhDangHanMuc(p.maxWorkspaces)),
        ...dk(`Hạn mức báo cáo của gói ${p.name}`, dinhDangHanMuc(p.maxReports)),
        ...dk(`Hạn mức thành viên của gói ${p.name}`, dinhDangHanMuc(p.maxMembers)),
        ...dk(`Hạn mức dung lượng của gói ${p.name}`, dinhDangHanMuc(p.maxStorageBytes, true)),
        ...dk(`Mô tả gói ${p.name}`, p.description),
      ],
    })),
  ];
}

export function duKienDonHang(orders: OrderDto[], tong: number, loc = false): Nguon[] {
  // Tiêu đề thật trên `OrdersPage`: Mã đơn · Gói · Số tiền · Trạng thái · Tạo lúc.
  const bangTho = bangDanhSach(
    ['Mã đơn', 'Gói', 'Số tiền', 'Trạng thái', 'Tạo lúc'],
    orders.map((o) => [
      o.orderCode,
      o.planName,
      o.amountVnd,
      ORDER_STATUS_LABELS[o.status],
      dinhDangNgay(o.createdAt),
    ]),
    tong,
    'đơn',
  );
  return [
    {
      ten: 'Danh sách đơn hàng',
      duKien: [
        ...dk('Số đơn hàng của tổ chức', tong, luuYLoc(loc)),
        ...dk('Số đơn đang chờ thanh toán', orders.filter((o) => o.status === 'pending').length),
        ...dk('Mã các đơn đang hiện', orders.map((o) => o.orderCode).join('; ')),
      ],
      ...(bangTho === undefined ? {} : { bangTho }),
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

export function duKienMotKetNoi(conn: ConnectionDto | null): Nguon[] {
  return conn === null ? [] : duKienKetNoi([conn]).slice(1);
}

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

export function duKienDanhSachToChuc(ts: PlatformTenantDto[], tong: number, loc = false): Nguon[] {
  // Tiêu đề thật: Tên công ty · Trạng thái · Người dùng · Workspace · Ngày tạo.
  const bangTho = bangDanhSach(
    ['Tên công ty', 'Người dùng', 'Workspace', 'Trạng thái', 'Ngày tạo'],
    ts.map((t) => [
      t.name,
      t.userCount,
      t.workspaceCount,
      t.isActive ? 'đang hoạt động' : 'đã khoá',
      dinhDangNgay(t.createdAt),
    ]),
    tong,
    'tổ chức',
  );
  return [
    {
      ten: 'Danh sách tổ chức',
      duKien: [
        ...dk('Số tổ chức toàn hệ thống', tong, luuYLoc(loc)),
        ...dk('Số không gian cá nhân đang hiện', ts.filter((t) => t.isPersonal).length),
        ...dk('Tên các tổ chức đang hiện', ts.map((t) => t.name).join('; ')),
      ],
      ...(bangTho === undefined ? {} : { bangTho }),
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

export function duKienDanhSachNguoiDung(us: PlatformUserDto[], tong: number, loc = false): Nguon[] {
  /*
   * Tiêu đề thật: Họ và tên · Email · Tổ chức · Gói dịch vụ · Trạng thái ·
   * Đăng nhập gần nhất.
   *
   * Cột "Tổ chức" ở đây là một SỐ ĐẾM (người này thuộc mấy tổ chức), đúng như
   * màn hình đang in, nên "người dùng nào thuộc nhiều tổ chức nhất" chạy được.
   */
  const bangTho = bangDanhSach(
    ['Họ và tên', 'Email', 'Chức danh', 'Vai trò', 'Tổ chức', 'Trạng thái', 'Đăng nhập gần nhất'],
    us.map((u) => [
      u.fullName,
      u.email,
      u.jobTitle,
      u.platformRole === 'superadmin' ? 'superadmin' : 'người dùng thường',
      u.tenants.length,
      u.isActive ? 'đang mở' : 'đã khoá',
      u.lastLoginAt === null ? 'chưa đăng nhập lần nào' : dinhDangNgay(u.lastLoginAt),
    ]),
    tong,
    'người dùng',
  );
  return [
    {
      ten: 'Danh sách người dùng',
      duKien: [
        ...dk('Số người dùng toàn hệ thống', tong, luuYLoc(loc)),
        ...dk('Số superadmin đang hiện', us.filter((u) => u.platformRole === 'superadmin').length),
        ...dk('Tên các người dùng đang hiện', us.map((u) => u.fullName).join('; ')),
      ],
      ...(bangTho === undefined ? {} : { bangTho }),
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

export function duKienWorkspaceHeThong(
  ws: PlatformWorkspaceDto[],
  tong: number,
  loc = false,
): Nguon[] {
  // Tiêu đề thật: Tổ chức · Workspace · Trạng thái · Báo cáo.
  const bangTho = bangDanhSach(
    ['Workspace', 'Tổ chức', 'Báo cáo', 'Trạng thái', 'Ngày tạo'],
    ws.map((w) => [
      w.name,
      w.tenantName,
      w.reportCount,
      w.isActive ? 'đang hoạt động' : 'đã khoá',
      dinhDangNgay(w.createdAt),
    ]),
    tong,
    'workspace',
  );
  return [
    {
      ten: 'Danh sách workspace toàn hệ thống',
      duKien: [
        ...dk('Số workspace toàn hệ thống', tong, luuYLoc(loc)),
        ...dk('Tên các workspace đang hiện', ws.map((w) => w.name).join('; ')),
      ],
      ...(bangTho === undefined ? {} : { bangTho }),
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
