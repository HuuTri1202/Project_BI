import { chieuSoSanh, tuDoSoSanh, type ReportDataDto } from '@bi/shared';

import { formatValue } from '../reports/nhanO';
import type { BangTho, DuKien, Nguon } from './nguCanh';

export type YDinh =
  | 'cao_nhat'
  | 'thap_nhat'
  | 'tong'
  | 'trung_binh'
  | 'dem'
  | 'top_n'
  | 'gia_tri'
  | 'so_sanh'
  | 'ti_trong'
  | 'xu_huong'
  | 'loc'
  | 'chua_co';

export interface TraLoi {
  cau: string;
  rong?: true;
  /**
   * Câu trả lời CHUNG CHUNG: đúng về chính nó, nhưng không có bằng chứng nào
   * rằng nó đúng về CÂU HỎI. Một dữ kiện được gọi đích danh phải đi trước nó.
   */
  chung?: true;
  so: string[];
}

export function chuanHoa(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}%]+/gu, ' ')
    .trim()
    .split(' ')
    .map((t) => DONG_NGHIA.get(t) ?? t)
    .join(' ');
}

const DONG_NGHIA = new Map<string, string>([
  ['file', 'tep'],
  ['row', 'dong'],
  ['rows', 'dong'],
  ['record', 'dong'],
  ['records', 'dong'],
  ['column', 'cot'],
  ['columns', 'cot'],
  ['field', 'cot'],
  ['fields', 'cot'],
  ['table', 'bang'],
  ['tables', 'bang'],
  ['dataset', 'bo du lieu'],
  ['datasets', 'bo du lieu'],
  ['datamodel', 'mo hinh'],
  ['datamodels', 'mo hinh'],
  ['model', 'mo hinh'],
  ['models', 'mo hinh'],
  ['relationship', 'quan he'],
  ['relationships', 'quan he'],
  ['relation', 'quan he'],
  ['measure', 'thuoc do'],
  ['measures', 'thuoc do'],
  ['metric', 'thuoc do'],
  ['metrics', 'thuoc do'],
  ['report', 'bao cao'],
  ['reports', 'bao cao'],
  // Nói vòng về dung lượng — "cái này nặng bao nhiêu" là ví dụ mà `llm:kiem`
  // dùng để thử lớp mô hình, đúng vì phép so từ khoá không bao giờ bắt được nó.
  ['nang', 'dung luong'],
  ['nhe', 'dung luong'],
  ['size', 'dung luong'],
  /*
   * TỪ HỎI tiếng Anh. Bảng này đã dịch DANH TỪ từ lâu (`dataset`, `table`,
   * `report`) nhưng không dịch từ hỏi, nên "how many datasets are there" nhận ra
   * đúng "bộ dữ liệu" mà không biết là đang được hỏi ĐẾM. Thiếu đúng một nửa.
   *
   * ĐO ĐƯỢC: 4 trên 40 câu của bộ đo lạ là tiếng Anh, và cả bốn đều bế tắc ở
   * lớp ngoại tuyến. Lớp mô hình lo được cả bốn (đo được trong `llmDaGhi.json`)
   * — nhưng nó chỉ có khi có khoá và có mạng, còn bảng này thì luôn có.
   *
   * ⚠️ Chỉ những chữ không trùng với một tiếng Việt nào sau khi bỏ dấu. "all"
   * không có ở đây vì nó chẳng thêm được gì, còn "count" thì vừa là từ hỏi vừa
   * là tên cột trong rất nhiều bảng của khách.
   */
  ['highest', 'cao nhat'],
  ['largest', 'cao nhat'],
  ['lowest', 'thap nhat'],
  ['smallest', 'thap nhat'],
  ['total', 'tong'],
  ['sum', 'tong'],
  ['average', 'trung binh'],
  ['many', 'may'],
  ['list', 'liet ke'],
  /*
   * Màn hình ghi "Database", người Việt gõ "cơ sở dữ liệu" — và không một chữ
   * nào của hai cách nói ấy trùng nhau.
   *
   * ĐO ĐƯỢC: "kết nối MySQL bán hàng dùng máy chủ nào, cổng nào, CƠ SỞ DỮ LIỆU
   * nào" nhận về "Số BỘ DỮ LIỆU lấy từ kết nối …: 2" cho vế thứ ba — vì nhãn
   * đúng không trùng chữ nào, còn nhãn sai thì trùng "dữ liệu".
   *
   * ⚠️ Dịch theo chiều NÀY (Anh → Việt), ngược với mọi dòng ở trên, vì ở đây
   * chính NHÃN mới là tiếng Anh. Nhãn cũng đi qua `chuanHoa`, nên một dòng lo
   * được cả hai phía.
   */
  ['database', 'co so du lieu'],
]);

const TU_KHOA: { y: YDinh; tu: string[] }[] = [
  // `ti_trong` và `so_sanh` đứng trước `cao_nhat`: "A chiếm bao nhiêu % so với
  // cao nhất" chứa cả hai, và ý chính là cái cụ thể hơn.
  { y: 'ti_trong', tu: ['chiem bao nhieu', 'ti trong', 'ti le', 'phan tram', 'bao nhieu %'] },
  { y: 'so_sanh', tu: ['so voi', 'so sanh', 'hon hay', 'cao hon', 'thap hon', 'chenh'] },
  { y: 'top_n', tu: ['top ', 'cao nhat la nhung', 'xep hang'] },
  /*
   * "đứng đầu" và "dẫn đầu" ĐO ĐƯỢC là trượt ở CẢ HAI lớp.
   *
   * Lớp ngoại tuyến thiếu chúng trong bảng này; lớp mô hình thì từ chối chọn
   * nhãn — ba lượt gọi, trượt cả ba, đo được trong `llmDaGhi.json`. Nên không
   * có lớp nào đỡ cho lớp nào, và đây là chỗ duy nhất sửa được.
   *
   * Đây là bảng TỪ KHOÁ: thêm một cách nói vào đúng chỗ nó sinh ra để nhận,
   * không phải một ngoại lệ vá vào logic.
   */
  {
    y: 'cao_nhat',
    tu: [
      'cao nhat',
      'lon nhat',
      'nhieu nhat',
      'dat nhat',
      'dinh cao',
      'dung dau',
      'dan dau',
      'max',
    ],
  },
  { y: 'thap_nhat', tu: ['thap nhat', 'nho nhat', 'it nhat', 're nhat', 'min'] },
  /*
   * `loc` đứng SAU các từ so sánh: "liệt kê sản phẩm có số lượng cao nhất" là
   * câu hỏi về cái cao nhất, không phải một phép lọc. Executor của nó tự trả
   * `null` khi câu hỏi không có con số nào, nên nhận nhầm ở đây không nuốt mất
   * câu trả lời — nó rơi xuống nhánh tra cứu như trước.
   */
  {
    y: 'loc',
    tu: [
      'liet ke',
      'gom nhung',
      'nhung nao',
      'nao co',
      'co gia tri',
      // "co nhung san pham nao tren bieu do" — cau hay duoc hoi nhat ve mot
      // bieu do, va khong cum nao o tren khop no: giua "nhung" va "nao" con
      // chen ten chieu.
      'co nhung',
      'danh sach',
      'ten cac',
      'nhung gi',
    ],
  },
  { y: 'trung_binh', tu: ['trung binh', 'binh quan'] },
  { y: 'tong', tu: ['tong', 'cong lai', 'cong het', 'tat ca la bao nhieu'] },
  /*
   * `co bao nhieu` là cách đếm tự nhiên nhất trong tiếng Việt, và trước đây
   * bảng này bỏ sót nó: mọi cụm đều đòi chữ "nhóm" hay "mục" — tức chỉ nhận ra
   * người đã nói theo từ vựng của hệ thống. "Có bao nhiêu sản phẩm" trượt sạch.
   *
   * Phải là `co bao nhieu`, KHÔNG phải `bao nhieu` trần. Chữ "có" là chỗ phân
   * biệt: "có bao nhiêu sản phẩm" hỏi số lượng, còn "Boston bao nhiêu" hỏi giá
   * trị của một nhóm. Một cụm `bao nhieu` trần sẽ nuốt luôn câu thứ hai.
   */
  {
    y: 'dem',
    tu: [
      'bao nhieu nhom',
      'co may',
      'so luong nhom',
      'may nhom',
      'bao nhieu muc',
      'co bao nhieu',
      // "chứa bao nhiêu biểu đồ" — cách đếm tự nhiên mà bảng này bỏ sót. Nó cần
      // đúng chữ "chứa" chứ không phải "chưa" — xem `CANH_DAU`.
      'chua bao nhieu',
      /*
       * `may` TRẦN, khác hẳn `bao nhieu` trần ở trên — và khác vì tiếng Việt.
       *
       * "mấy" gần như luôn đứng TRƯỚC danh từ được đếm: "thuộc mấy tổ chức",
       * "vào được mấy workspace". Không có lối dùng nào tương đương với "Boston
       * bao nhiêu" — tức là không có câu hỏi GIÁ TRỊ nào bị nó nuốt.
       *
       * LỖI ĐO ĐƯỢC: "Phạm Quốc Bảo thuộc mấy tổ chức" hoà điểm với nhãn
       * "… thuộc những tổ chức nào" rồi bị bỏ cả hai, trong khi nhánh `dem` đã
       * biết cách chọn: nó chỉ chấm trên dữ kiện có giá trị LÀ SỐ.
       */
      'may',
    ],
  },
  { y: 'xu_huong', tu: ['xu huong', 'tang hay giam', 'tang khong', 'giam khong', 'dang tang'] },
  /*
   * `chua_co` đứng CUỐI, sau mọi từ khoá so sánh. "mô hình nào chưa có quan hệ
   * nhiều nhất" là một câu hỏi về cái nhiều nhất, không phải về cái còn thiếu;
   * đặt `chua_co` lên trước sẽ nuốt nó.
   *
   * Nó chỉ có tác dụng ở nhánh so giữa các mục (`soSanhNguon`). Ở `tinhBang` nó
   * rơi vào `default` y như `null`, nên một lần nhận nhầm ở đây không đổi gì.
   */
  { y: 'chua_co', tu: ['chua ', 'khong co', 'bang 0'] },
];

/**
 * Chuẩn hoá NHẸ — về chữ thường, dấu câu thành khoảng trắng, GIỮ dấu tiếng Việt.
 *
 * Cùng khuôn với `tachTu` của `@bi/shared/soSanh`, và cùng lý do tồn tại.
 */
export function chuanHoaCoDau(raw: string): string {
  return raw
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}%]+/gu, ' ')
    .trim();
}

/** Câu này có dấu tiếng Việt không — `đ` không tách khi NFD nên phải hỏi riêng. */
function coDauTiengViet(s: string): boolean {
  return /[̀-ͯ]/.test(s.normalize('NFD')) || /đ/.test(s.toLowerCase());
}

/*
 * ═══ CHỮ MÀ PHÉP BỎ DẤU GỘP HAI NGHĨA KHÁC HẴN NHAU ═════════════════
 *
 * Bảng `TU_KHOA` so trên chữ ĐÃ BỎ DẤU, và đó là chủ ý: người dùng gõ thiếu
 * dấu thì vẫn phải hiểu. Nhưng với hai chữ dưới đây thì bỏ dấu không phải là
 * "dễ dãi hơn" — nó đổi HẴN ý định của câu:
 *
 *   "báo cáo này CHỨA bao nhiêu biểu đồ"  → đọc thành ý định CHƯA CÓ
 *   "MÁY CHỦ của kết nối là gì"            → đọc thành ý định ĐẾM (mấy)
 *
 * Cả hai ĐO ĐƯỢC. Ca đầu là ảnh chụp từ buổi thử; ca sau chưa ai thấy, nó
 * rơi ra khi đi tìm đồng bọn của ca đầu.
 *
 * Luật: nếu người dùng CÓ gõ dấu thì tôn trọng dấu họ gõ. Câu không dấu thì
 * không có gì để canh, và nó giữ nguyên nếp cũ.
 */
const CANH_DAU = new Map<string, string>([
  ['chua ', 'chưa'],
  ['chua bao nhieu', 'chứa'],
  ['may', 'mấy'],
  ['co may', 'mấy'],
  ['may nhom', 'mấy'],
]);

/**
 * Cụm từ khoá này có được dùng cho câu hỏi này không.
 *
 * Khoá theo TỪNG CỤM, không theo từng chữ: cùng chữ "chua" mà `chua_co` cần
 * "chưa" còn `dem` cần "chứa". Một bảng khoá theo chữ sẽ chỉ đúng được một trong
 * hai, và cái còn lại trượt im lặng.
 */
function hopDau(cauHoi: string, tu: string): boolean {
  const can = CANH_DAU.get(tu);
  if (can === undefined) return true;
  const tho = ` ${chuanHoaCoDau(cauHoi)} `;
  return !coDauTiengViet(tho) || tho.includes(` ${can} `);
}

const CO_NHAT = /(^| )nhat( |$)/;

/** Số đứng RIÊNG thành một chữ — "3 cái" có, "q4" không. */
const CO_SO_RIENG = /(^| )\d+( |$)/;

/*
 * ═══ HÌNH DẠNG ĐÁP ÁN PHẢI KHỚP TỪ ĐỂ HỎI ══════════════════════════════════
 *
 * Phép chấm nhãn chỉ đếm CHỮ TRÙNG. Nó không một lần nào hỏi câu hiển nhiên
 * nhất: "thứ dữ kiện này mang lại có trả lời được từ để hỏi kia không?"
 *
 * BỐN ca SAI đo được, cùng một gốc — câu hỏi đòi một CÁI TÊN, nhận về một PHÉP
 * ĐẾM:
 *
 *   "ai xoá bộ dữ liệu Returns"             → "Số mô hình dữ liệu dùng …: 1"
 *   "quan hệ nối bảng nào với bảng nào"     → "Số mô hình chưa nối đủ …: 1"
 *   "cột Doanh thu của bộ Orders kiểu gì"   → "Số cột của Orders: 24"
 *   "trong thư mục Bán hàng, bảng nào ít cột nhất" → "Số mục trong …: 5"
 *
 * Cả bốn đều là một con số THẬT, định dạng đẹp, cho một câu hỏi khác hẳn — kết
 * cục duy nhất nguy hiểm. `ai` đòi một người; `kiểu gì` đòi một tên kiểu; `bảng
 * nào … với bảng nào` đòi hai tên bảng. Không câu nào đòi một con số.
 *
 * ⚠️ Đây là chốt ĐỐI XỨNG với cờ `uuTienSo`, thứ đã có từ lâu cho chiều ngược
 * lại: câu ĐẾM chỉ nhận dữ kiện là số. Chiều này chưa ai dựng, nên nửa còn lại
 * của cùng một luật bỏ trống suốt.
 *
 * ⚠️ "có … không/chưa" phải được trừ ra, và nó bắt buộc. "mô hình Kho vận có
 * thước đo NÀO chưa" cũng mang chữ "nào", nhưng ở đó "nào" không đòi tên — đó
 * là câu CÓ/KHÔNG, và "Số thước đo: 0" đúng là đáp án. Đo được: không trừ ra
 * thì chốt này ăn luôn ca ấy.
 */
const CUM_DOI_TEN = ['kieu gi', 'loai gi', 'dang gi'];

/**
 * Thứ câu hỏi đòi — `'ten'` khi nó hỏi "… NÀO", `'rieng'` khi nó hỏi một thứ mà
 * một phép đếm KHÔNG BAO GIỜ trả lời được ("ai", "kiểu gì").
 *
 * ⚠️ Hai mức, và phải là hai. `traLoiTrang` có một nhánh cho câu GỌI ĐÍCH DANH
 * một mục, và ở đó chữ "nào" đã được chính câu hỏi trả lời:
 *
 *   "chỉ tính các bộ từ file products, bộ NÀO nhiều dòng nhất"
 *      → "Số dòng của Products: 10.292"            ĐÚNG
 *
 * Nhưng "ai" và "kiểu gì" thì gọi tên mục cũng không cứu được, vì chúng đòi một
 * thứ KHÁC với mục đã gọi tên:
 *
 *   "ai xoá bộ dữ liệu Returns"              → "Số mô hình dùng Returns: 1"
 *   "cột Doanh thu của bộ Orders kiểu gì"    → "Số cột của Orders: 24"
 *
 * Gộp hai mức thành một thì cờ `daGoiTen` mở cửa cho cả hai ca ấy — đo được,
 * chúng quay lại ngay lượt chạy sau.
 */
function doiTen(cauHoi: string): 'ten' | 'rieng' | null {
  const q = ` ${chuanHoa(cauHoi)} `;
  const tu = q.trim().split(' ');
  // Có chữ ĐẾM thì một con số đúng là thứ đang được hỏi.
  if (
    q.includes(' bao nhieu ') ||
    q.includes(' trung binh ') ||
    ['may', 'so', 'tong'].some((t) => tu.includes(t))
  )
    return null;
  if (tu.includes('ai') || CUM_DOI_TEN.some((c) => q.includes(` ${c} `))) return 'rieng';
  // Câu CÓ/KHÔNG: "nào" ở đây không đòi tên — xem khối chú thích trên.
  if (tu.includes('co') && (tu.includes('khong') || tu.includes('chua'))) return null;
  return tu.includes('nao') ? 'ten' : null;
}

export function docYDinh(cauHoi: string): YDinh | null {
  const q = chuanHoa(cauHoi);
  /*
   * Cụm so sánh NGƯỢC — luật đọc dùng chung với backend, xem `@bi/shared`
   * (`soSanh.ts`). Trước đây chỗ này quét cả câu bằng một danh sách sáu chữ
   * riêng, và nó trả về CAO NHẤT cho "miền nào bán kém nhất".
   *
   * ⚠️ Truyền `cauHoi` THÔ, không truyền `q`. `chieuSoSanh` cố ý đọc trên chữ
   * CÒN DẤU: bỏ dấu thì "ít báo CÁO nhất" có `cao` và đọc ngược hẳn chiều.
   */
  /*
   * ═══ "N … NHẤT" là TOP N, đứng trước cả luật chiều ════════════════
   *
   * Bảng `TU_KHOA` chỉ nhận ra top N qua chữ "top" hay "xếp hạng". Người dùng
   * thật thì đếm bằng số: "3 cái bán kém nhất", "3 sản phẩm bán chạy nhất".
   * Cả hai trước đây nhận về ĐÚNG MỘT mục — một cái tên thật, một con số thật,
   * cho một câu hỏi xin BA cái. ĐO ĐƯỢC, và "top 3 thấp nhất" cũng vậy dù nó
   * có đủ cả chữ "top": luật chiều ở ngay dưới chạy TRƯỚC bảng từ khoá và
   * nuốt mất nó.
   *
   * ⚠️ Con số phải đứng RIÊNG thành một chữ. "mô hình Q4 nào nhiều bảng nhất"
   * cũng có chữ số và có chữ "nhất", nhưng "q4" là MỘT chữ — đó là tên, không
   * phải số lượng. Đòi số đứng riêng là đủ tách hai ca ấy mà không cần luật nào
   * riêng cho chúng.
   */
  if (CO_NHAT.test(q) && CO_SO_RIENG.test(q)) return 'top_n';

  if (chieuSoSanh(cauHoi) === 'thap') return 'thap_nhat';
  for (const { y, tu } of TU_KHOA) {
    if (tu.some((t) => q.includes(t) && hopDau(cauHoi, t))) return y;
  }
  if (CO_NHAT.test(q)) return 'cao_nhat';

  /*
   * Lưới hứng cuối: có chữ "nào" đứng riêng VÀ có một con số trong câu.
   *
   * Đó là khuôn của một câu lọc nói bằng lời thường — "có sản phẩm nào số
   * lượng 99 không", "mục nào bằng 4". Bảng `TU_KHOA` so chuỗi liền nhau nên
   * nó trượt hết: giữa "có" và "nào" còn chen tên chiều, và "… nào … không" bị
   * xé làm hai đầu câu.
   *
   * Đứng SAU mọi luật khác, kể cả lưới `nhất`: "mô hình Q4 nào nhiều bảng
   * nhất" cũng có chữ số, mà nó là câu hỏi về cái nhiều nhất. Và `tinhBang` tự
   * trả `null` khi không đọc ra điều kiện, nên nhận nhầm ở đây không nuốt mất
   * câu trả lời nào.
   */
  return /(^| )nao( |$)/.test(q) && /\d/.test(q) ? 'loc' : null;
}

function luuYCat(bang: ReportDataDto): string | null {
  const con = bang.grouped || bang.paging?.hasMore === true;
  if (!con) return null;
  return `tính trên ${String(bang.rows.length)} nhóm đang hiện trên biểu đồ, không phải toàn bộ dữ liệu`;
}

function tenDong(row: ReportDataDto['rows'][number]): string {
  /*
   * ⚠️ Khi `seriesLabel` có mặt, MỘT nhãn xuất hiện nhiều lần — mỗi chuỗi một
   * dòng. Đó chính là lý do `ReportDataTable` phải khoá theo chỉ số thay vì
   * theo nhãn. Trả về mỗi `label` ở đây thì câu "cao nhất là Miền Bắc" không
   * nói được Miền Bắc CỦA NHÓM NÀO — và có khi nhóm đó mới là tin đáng chú ý.
   */
  return row.series === undefined ? row.label : `${row.label} (${row.series})`;
}

function chieuHoi(bang: ReportDataDto, cauHoi: string): 'label' | 'series' | null {
  if (bang.seriesLabel === undefined) return null;
  const q = chuanHoa(cauHoi);

  const viTri = (ten: string, lay: (r: ReportDataDto['rows'][number]) => string): number => {
    const a = viTriGoiTen(q, chuanHoa(ten));
    const b = viTriQuaGiaTri(bang, q, lay);
    return a < 0 ? b : b < 0 ? a : Math.min(a, b);
  };

  const vTruc = viTri(bang.dimensionLabel, (r) => r.label);
  const vChuoi = viTri(bang.seriesLabel ?? '', (r) => r.series ?? '');

  /*
   * ⚠️ Gọi tên ĐẦY ĐỦ cả hai chiều, hai tên rời nhau, và không có chữ "nào"
   * nào trỏ vào một trong hai — thì câu hỏi THẬT SỰ lẫn lộn.
   *
   * "Customer name với product name cái nào cao nhất" nêu hai chiều ngang
   * hàng nhau; chọn cái đứng trước chỉ vì nó đứng trước là chọn bừa. Trả
   * `null` để rơi về câu trả lời gọi đủ cả hai tên, thay vì đưa ra một con số
   * gộp mà không ai biết đã gộp theo gì.
   *
   * Cửa này hẹp có chủ ý: nó đòi cả hai tên ĐẦY ĐỦ có mặt. "Miền nào có nhóm
   * hàng cao nhất" không rơi vào đây — ở đó chỉ "nhóm hàng" là tên chiều, còn
   * "miền" là một chữ trong giá trị, và chính nó đứng trước chữ "nào".
   */
  const tenTruc = chuanHoa(bang.dimensionLabel);
  const tenChuoi = chuanHoa(bang.seriesLabel ?? '');
  const caHaiTen = viTriGoiTen(q, tenTruc) >= 0 && viTriGoiTen(q, tenChuoi) >= 0;
  const long = tenTruc !== tenChuoi && (tenChuoi.includes(tenTruc) || tenTruc.includes(tenChuoi));
  const coChuNao =
    viTriQuaGiaTri(bang, q, (r) => r.label) >= 0 ||
    viTriQuaGiaTri(bang, q, (r) => r.series ?? '') >= 0 ||
    new RegExp(`(^| )(${tenTruc}|${tenChuoi}) nao( |$)`).test(q);
  if (caHaiTen && !long && !coChuNao) return null;

  if (vTruc < 0 && vChuoi < 0) return null;
  if (vChuoi < 0) return 'label';
  if (vTruc < 0) return 'series';

  /*
   * Hai chiều cùng được gọi tên ở CÙNG vị trí nghĩa là một tên nằm lọt trong
   * tên kia ở đúng chỗ đó, và không có gì tách được chúng. Trả `null` để rơi về
   * câu trả lời gọi đủ cả hai tên, thay vì chọn bừa rồi đưa ra một con số gộp
   * mà không ai biết đã gộp theo gì.
   */
  return vTruc === vChuoi ? null : vTruc < vChuoi ? 'label' : 'series';
}

function viTriGoiTen(q: string, ten: string): number {
  return ten === '' ? -1 : ` ${q} `.indexOf(` ${ten} `);
}

function viTriQuaGiaTri(
  bang: ReportDataDto,
  q: string,
  lay: (r: ReportDataDto['rows'][number]) => string,
): number {
  const gia = bang.rows.map((r) => chuanHoa(lay(r))).filter((g) => g !== '');
  if (gia.length === 0) return -1;

  for (const m of ` ${q} `.matchAll(/ ([^ ]+) nao(?= )/g)) {
    const chu = m[1] ?? '';
    if (chu.length < 2) continue;
    if (gia.every((g) => g.split(' ').includes(chu))) return m.index;
  }
  return -1;
}

function gopTheo(
  rows: ReportDataDto['rows'],
  chieu: 'label' | 'series',
): { ten: string; value: number }[] {
  const tong = new Map<string, number>();
  for (const r of rows) {
    const k = chieu === 'series' ? (r.series ?? '') : r.label;
    tong.set(k, (tong.get(k) ?? 0) + r.value);
  }
  return [...tong.entries()].map(([ten, value]) => ({ ten, value }));
}

const DAU_LUU_Y = ' — ';

function ghep(cau: string, luuY: string | null): string {
  return luuY === null ? cau : `${cau}${DAU_LUU_Y}${luuY}`;
}

/**
 * Nối nhiều vế thành MỘT câu trả lời: dữ kiện trước, ĐIỀU KIỆN dồn về cuối.
 *
 * ⚠️ Vì sao không nối thẳng bằng dấu cách.
 *
 * `ghep` dán điều kiện vào cuối câu bằng ` — `, và một câu điều kiện thường kết
 * thúc giữa mệnh đề ("… nên đây chưa phải toàn bộ"). Nối thẳng vế sau vào đó
 * thì vế sau bị đọc như phần còn lại của câu điều kiện:
 *
 *   "Số dòng của Returns: 1.173. — tệp đã bị cắt nên đây chưa phải toàn bộ
 *    Nguồn gốc của Returns: returns.csv."
 *
 * Đọc ra thành "chưa phải toàn bộ NGUỒN GỐC" — vô nghĩa, và nó bẻ nghĩa của
 * đúng cái cảnh báo quan trọng nhất trong câu. ĐO ĐƯỢC trên bộ câu hỏi lạ.
 *
 * Gộp trùng cũng là việc của hàm này: hai vế cùng một nguồn thì mang CÙNG một
 * điều kiện, và nói nó hai lần không thêm thông tin nào.
 */
function noiVe(phan: string[]): string {
  const cau: string[] = [];
  const luu: string[] = [];
  for (const p of phan) {
    const i = p.indexOf(DAU_LUU_Y);
    if (i < 0) {
      cau.push(p);
      continue;
    }
    cau.push(p.slice(0, i));
    luu.push(p.slice(i + DAU_LUU_Y.length));
  }
  const rieng = [...new Set(luu)];
  return cau.join(' ') + (rieng.length === 0 ? '' : `${DAU_LUU_Y}${rieng.join('; ')}`);
}

function tinhBang(
  bang: ReportDataDto,
  cauHoi: string,
  y: YDinh | null,
  chieuEp?: 'label' | 'series' | null,
  boiCanh?: { chu: string; luuY: string },
): TraLoi | null {
  const { rows, measureLabel, dimensionLabel } = bang;
  const chu = boiCanh?.chu ?? 'biểu đồ này';
  if (rows.length === 0)
    return {
      cau: `${chu[0]?.toUpperCase() ?? ''}${chu.slice(1)} hiện không có dòng nào để tính.`,
      so: [],
    };

  const doc = (v: number): string => formatValue(v, bang.format);
  const cat = boiCanh?.luuY ?? luuYCat(bang);
  const tong = rows.reduce((s, r) => s + r.value, 0);

  /*
   * ═══ GÕ TÊN HAI MỤC RA LÀ MỘT CÂU SO SÁNH ═════════════════════════
   *
   * Luật này đã được ghi ở `traLoiTrang` cho danh sách mục; ở đây là cùng luật,
   * áp cho các DÒNG của một bảng. Bảng từ khoá nhận ra "so với" và "so sánh",
   * nhưng người dùng thật còn nói nhiều kiểu khác — và mỗi kiểu trước đây đều
   * nhận về giá trị của MỘT mục, là câu đúng cho một câu hỏi khác:
   *
   *   "Xerox với Avery cái nào hơn"  → Quantity của Xerox là 7.
   *   "Staples gấp mấy lần Acco"      → Quantity của Staples là 10.
   *
   * Ca thứ hai cho thấy vì sao không nên chữa bằng cách thêm từ khoá: chữ "mấy"
   * của nó đã khớp ý định ĐẾM rồi, nên một cụm "gấp mấy lần" thêm vào bảng
   * cũng phải đứng đúng chỗ mới thắng — và cách nói thứ ba sẽ lại trượt.
   * Bằng chứng thật nằm ở chỗ khác: câu hỏi GỌI ĐÍCH DANH hai dòng của bảng.
   *
   * ⚠️ Chỉ đè mấy ý định hỏi về MỘT mục hoặc chưa đọc ra ý định nào. Câu
   * `tong`, `trung_binh`, `loc`, `top_n`, `ti_trong`, `xu_huong` hỏi về cả bảng
   * hoặc về một tỉ lệ, và chúng vẫn đúng khi câu có nhắc tên mấy dòng.
   */
  const yThat =
    (y === null || y === 'dem' || y === 'gia_tri' || y === 'cao_nhat' || y === 'thap_nhat') &&
    timHaiDong(rows, cauHoi) !== null
      ? 'so_sanh'
      : y;

  switch (yThat) {
    case 'cao_nhat':
    case 'thap_nhat': {
      const lon = yThat === 'cao_nhat';

      const chieu = chieuEp === undefined ? chieuHoi(bang, cauHoi) : chieuEp;
      if (chieu !== null) {
        const nhom = gopTheo(rows, chieu);
        const dinh = nhom.reduce((a, b) =>
          lon ? (b.value > a.value ? b : a) : b.value < a.value ? b : a,
        );
        const gia = doc(dinh.value);
        const tenChieu = chieu === 'series' ? (bang.seriesLabel ?? '') : dimensionLabel;
        return {
          cau: ghep(
            `${tenChieu} ${lon ? 'cao nhất' : 'thấp nhất'} là ${dinh.ten}, với tổng ${measureLabel} ${gia} trên ${String(nhom.length)} ${tenChieu}.`,
            cat,
          ),
          so: [gia],
        };
      }

      const dong = rows.reduce((a, b) =>
        lon ? (b.value > a.value ? b : a) : b.value < a.value ? b : a,
      );
      const gia = doc(dong.value);
      return {
        cau: ghep(
          `${lon ? 'Cao nhất' : 'Thấp nhất'} là ${tenDong(dong)}, với ${measureLabel} ${gia}.`,
          cat,
        ),
        so: [gia],
      };
    }

    case 'tong': {
      const gia = doc(tong);
      return { cau: ghep(`Tổng ${measureLabel} là ${gia}.`, cat), so: [gia] };
    }

    case 'trung_binh': {
      const gia = doc(tong / rows.length);
      return {
        cau: ghep(`${measureLabel} trung bình là ${gia} trên ${String(rows.length)} dòng.`, cat),
        so: [gia],
      };
    }

    case 'dem': {
      /*
       * "Boston có bao nhiêu" GỌI TÊN một nhóm, nên nó hỏi GIÁ TRỊ của nhóm đó,
       * không hỏi số lượng nhóm. Cùng luật nhường-cho-tên đã dùng ở `traLoiTrang`:
       * gõ tên ra là đã nói rõ mình hỏi cái nào.
       */
      const goiTen = timDong(rows, cauHoi);
      if (goiTen !== null) {
        const gia = doc(goiTen.value);
        return { cau: `${measureLabel} của ${tenDong(goiTen)} là ${gia}.`, so: [gia] };
      }

      /*
       * ⚠️ CHUNG CHUNG — phép đếm này KHÔNG đọc câu hỏi.
       *
       * Nó đếm số nhóm của chính bảng này, bất kể người ta hỏi đếm CÁI GÌ. Đứng
       * ở một ô biểu đồ hỏi "có bao nhiêu thành viên", "có bao nhiêu kết nối",
       * "tôi vào được mấy workspace" đều nhận về ĐÚNG MỘT câu: "Có 5 Product Name
       * trên biểu đồ này". NĂM ca SAI đo được, cùng một giây.
       *
       * Không thể chừa bằng cách đòi câu hỏi phải gọi tên chiều: chiều ở đây tên
       * là "Product Name" còn người ta gõ "sản phẩm" — không trùng chữ nào, mà đó
       * lại là câu phải trả lời được. Nên đánh dấu thay vì chặn: một dự kiện
       * được GỌI ĐÍCH DANH ở lớp xuyên hệ thống thắng nó, còn không ai trả lời
       * được thì nó vẫn là câu đúng — xem `traLoiKhung`.
       */
      const soNhom = new Set(rows.map((r) => r.label)).size;
      return {
        cau: ghep(`Có ${String(soNhom)} ${dimensionLabel} trên ${chu}.`, cat),
        chung: true,
        so: [String(soNhom)],
      };
    }

    case 'top_n': {
      /*
       * ⚠️ TOP N CÓ HAI CHIỀU. Bản cũ luôn sắp giảm dần và luôn viết "cao nhất",
       * nên "3 cái bán kém nhất" — nếu tới được đây — sẽ trả về ba cái bán
       * CHẠY nhất, kèm ba con số thật. Luật đọc chiều dùng chung với backend.
       */
      const xuong = chieuSoSanh(cauHoi) === 'thap';
      const xep = <T extends { value: number }>(ds: T[]): T[] =>
        [...ds].sort((a, b) => (xuong ? a.value - b.value : b.value - a.value));
      const nhan = xuong ? 'thấp nhất' : 'cao nhất';

      const chieu = chieuEp === undefined ? chieuHoi(bang, cauHoi) : chieuEp;
      if (chieu !== null) {
        const nhom = xep(gopTheo(rows, chieu));
        const n = Math.min(docSo(cauHoi) ?? 5, nhom.length);
        const dau = nhom.slice(0, n);
        const tenChieu = chieu === 'series' ? (bang.seriesLabel ?? '') : dimensionLabel;
        return {
          cau: ghep(
            `${String(n)} ${tenChieu} ${nhan}: ${dau
              .map((g, i) => `${String(i + 1)}. ${g.ten} ${doc(g.value)}`)
              .join('; ')}.`,
            cat,
          ),
          so: dau.map((g) => doc(g.value)),
        };
      }

      const n = Math.min(docSo(cauHoi) ?? 5, rows.length);
      const dau = xep(rows).slice(0, n);
      const so = dau.map((r) => doc(r.value));
      return {
        cau: ghep(
          `${String(n)} ${dimensionLabel} ${nhan}: ${dau
            .map((r, i) => `${String(i + 1)}. ${tenDong(r)} ${doc(r.value)}`)
            .join('; ')}.`,
          cat,
        ),
        so,
      };
    }

    case 'ti_trong': {
      /*
       * ═══ MỘT NHÓM CỦA CỘT CHỒNG LÀ NHIỀU DÒNG ═══════════════════════════
       *
       * Luật này đã được ghi và canh ở nhánh đáy (phép GIÁ TRỊ): trên biểu đồ
       * cột chồng, một nhãn trục trải ra nhiều dòng — mỗi chuỗi một dòng — nên
       * trả về một dòng là đọc ra con số của MỘT Ô cho một câu hỏi về CẢ CỘT.
       *
       * Nhánh TỈ TRỌNG không được dạy cùng luật ấy, và đó là một ca SAI đo được
       * — tệ hơn cả nhánh giá trị, vì nó sai CẢ TỬ LẪN MẪU:
       *
       *   "Miền Trung chiếm bao nhiêu phần trăm"
       *      → "Miền Trung (Thời trang) chiếm 11,1 %"     (đúng: 310/855 = 36,3 %)
       *
       * Một phần trăm hợp lý, định dạng đẹp, cho một câu hỏi khác. Và người đọc
       * không có cách nào biết: 11,1 % cũng là một tỉ lệ có thật trên biểu đồ.
       *
       * ⚠️ Xét CHUỖI khi nhãn trục trượt — đối xứng với nhánh đáy, và cùng lý
       * do: trên biểu đồ "Số lượng theo Khu vực" tách màu theo "Nhóm hàng",
       * "Gia dụng" là một mảng màu người dùng đang chỉ vào.
       */
      const dong = timDong(rows, cauHoi);
      const chuoi = dong === null ? timChuoi(rows, cauHoi) : null;
      if (dong === null && chuoi === null) return null;

      const cungNhom =
        dong === null
          ? rows.filter((r) => (r.series ?? '') === chuoi)
          : rows.filter((r) => r.label === dong.label);
      const phan = cungNhom.reduce((t, r) => t + r.value, 0);
      // Gộp thật thì gọi tên NHÓM, không gọi tên một ô của nó.
      const tenNhom =
        dong === null ? (chuoi ?? '') : cungNhom.length > 1 ? dong.label : tenDong(dong);

      // `tong` ở đây là tổng của những dòng ĐANG HIỆN. Khi số liệu đã bị cắt,
      // tỉ trọng tính ra lớn hơn tỉ trọng thật — nên `cat` là bắt buộc.
      const pt = `${((phan / tong) * 100).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} %`;
      return {
        cau: ghep(
          `${tenNhom} chiếm ${pt} tổng ${measureLabel}` +
            // Chỉ nói "cộng qua N …" khi phép cộng THẬT SỰ nhập nhiều dòng —
            // cùng luật đã ghi ở nhánh đáy.
            (cungNhom.length > 1
              ? `, cộng qua ${String(cungNhom.length)} ${dong === null ? dimensionLabel : (bang.seriesLabel ?? dimensionLabel)}.`
              : '.'),
          cat,
        ),
        so: [pt],
      };
    }

    case 'so_sanh': {
      const hai = timHaiDong(rows, cauHoi);
      if (hai === null) return null;
      const [a, b] = hai;
      const chenh = doc(Math.abs(a.value - b.value));
      const lon = a.value >= b.value ? a : b;
      const nho = a.value >= b.value ? b : a;
      return {
        cau: `${tenDong(lon)} (${doc(lon.value)}) cao hơn ${tenDong(nho)} (${doc(nho.value)}) ${chenh} ${measureLabel}.`,
        so: [doc(lon.value), doc(nho.value), chenh],
      };
    }

    case 'loc': {
      /*
       * Khong co con so nao trong cau thi day la cau LIET KE HET, khong phai
       * mot phep loc thieu nguong.
       *
       * "co nhung san pham nao tren bieu do" la cau hoi tu nhien nhat ve mot
       * bieu do, va truoc day no nhan ve "toi chua hieu" ngay canh mot bieu do
       * dang hien dung danh sach do. Nguoc lai, doan ra mot nguong nguoi dung
       * chua noi la kieu sai te nhat — ket qua van la mot danh sach trong hoan
       * toan hop ly.
       */
      const dk = docDieuKien(cauHoi);

      const chieu = chieuEp === undefined ? chieuHoi(bang, cauHoi) : chieuEp;
      const nhom =
        chieu === null
          ? rows.map((r) => ({ ten: tenDong(r), value: r.value }))
          : gopTheo(rows, chieu);
      /*
       * Khong gop thi moi muc la mot DONG cua bieu do, khong phai mot gia tri
       * cua chieu nao ca. Goi no bang ten chieu la noi sai: "2 Customer Name"
       * trong khi danh sach liet ke ra hai CAP (khach, san pham).
       *
       * TRU khi bieu do chi co MOT chieu. `chieuHoi` tra `null` ngay tu dau cho
       * ca do, nhung khi do moi dong dung la mot gia tri cua chieu — nen goi ten
       * chieu ra moi la cau dung, va "7 muc tren bieu do" moi la cau mo ho.
       */
      const tenChieu =
        chieu === 'series'
          ? (bang.seriesLabel ?? dimensionLabel)
          : chieu === 'label' || bang.seriesLabel === undefined
            ? dimensionLabel
            : 'mục trên biểu đồ';

      /*
       * Tran 20 ten: dai hon the thi cau tra loi thanh mot cai bang do ma khong
       * ai doc — va o do con so dem duoc con ich hon danh sach.
       */
      const inTen = (ds: { ten: string; value: number }[]): string => {
        const hien = ds.slice(0, 20);
        const con = ds.length - hien.length;
        return `${hien.map((g) => `${g.ten} (${doc(g.value)})`).join('; ')}${
          con > 0 ? `; … và ${String(con)} mục nữa` : ''
        }`;
      };

      if (dk === null) {
        return {
          cau: ghep(`${String(nhom.length)} ${tenChieu} trên ${chu}: ${inTen(nhom)}.`, cat),
          so: [String(nhom.length)],
        };
      }

      const hop = nhom.filter((g) => dung(g.value, dk.toanTu, dk.nguong));
      const dieu = `${measureLabel} ${CHU_TOAN_TU[dk.toanTu]} ${doc(dk.nguong)}`;

      if (hop.length === 0) {
        return { cau: ghep(`Không ${tenChieu} nào có ${dieu}.`, cat), so: [doc(dk.nguong)] };
      }
      return {
        cau: ghep(`${String(hop.length)} ${tenChieu} có ${dieu}: ${inTen(hop)}.`, cat),
        so: [String(hop.length)],
      };
    }

    case 'xu_huong': {
      const dau = rows[0];
      const cuoi = rows[rows.length - 1];
      if (dau === undefined || cuoi === undefined || rows.length < 2) {
        return { cau: 'Chỉ có một nhóm nên chưa nói được xu hướng.', so: [] };
      }
      const huong = cuoi.value > dau.value ? 'tăng' : cuoi.value < dau.value ? 'giảm' : 'đi ngang';
      /*
       * Cố ý nói ra rằng đây chỉ là so hai đầu, không phải một phép hồi quy.
       * "Tăng" rút ra từ hai điểm có thể ngược hẳn với hình dạng ở giữa, và
       * người đọc cần biết câu này dựa trên cái gì.
       */
      return {
        cau: `So dòng đầu (${tenDong(dau)}: ${doc(dau.value)}) với dòng cuối (${tenDong(cuoi)}: ${doc(cuoi.value)}) thì ${measureLabel} ${huong}. Đây là so hai đầu, không phải xu hướng của cả chuỗi.`,
        so: [doc(dau.value), doc(cuoi.value)],
      };
    }

    default: {
      // Không có ý định nào khớp: thử xem câu hỏi có nhắc tên một nhóm không —
      // "Miền Bắc bao nhiêu" không chứa từ khoá nào cả.
      const dong = timDong(rows, cauHoi);
      if (dong === null) {
        /*
         * ⚠️ Nhãn trục trượt rồi thì thử tên CHUỖI — nhánh đối xứng với khối
         * ngay bên dưới, và nó lấp một lỗ đo được: trên biểu đồ cột chồng
         * "Số lượng theo Khu vực" tách màu theo "Nhóm hàng", câu "Gia dụng bao
         * nhiêu" không khớp nhãn trục nào nên rơi thẳng xuống "chưa hiểu" —
         * trong khi "Gia dụng" đang là một mảng màu người dùng đang chỉ vào.
         *
         * Nhãn trục xét TRƯỚC, có chủ ý: đó là hành vi đã có, và một câu gọi
         * tên cả hai bên thì cái trên trục X là cái người ta nhìn thấy trước.
         */
        const chuoi = timChuoi(rows, cauHoi);
        if (chuoi === null) return null;

        const cungChuoi = rows.filter((r) => (r.series ?? '') === chuoi);
        const tongChuoi = cungChuoi.reduce((t, r) => t + r.value, 0);
        const giaChuoi = doc(tongChuoi);
        return {
          cau: ghep(
            `${measureLabel} của ${chuoi} là ${giaChuoi}` +
              // Chỉ nói "cộng qua N …" khi phép cộng THẬT SỰ nhập nhiều dòng.
              // Một chuỗi chỉ có một dòng mà vẫn nói "cộng qua 1 Khu vực" là
              // thêm một vế không mang thông tin nào.
              (cungChuoi.length > 1
                ? `, cộng qua ${String(cungChuoi.length)} ${dimensionLabel}.`
                : '.'),
            cat,
          ),
          so: [giaChuoi],
        };
      }

      /*
       * ⚠️ Biểu đồ HAI chiều thì một nhãn trục có nhiều dòng, mỗi chuỗi một
       * dòng. Trả về đúng dòng đầu tìm thấy là đưa ra con số của MỘT Ô trong
       * cột chồng cho một câu hỏi về cả cột — "Số lượng của Miền Nam là 93"
       * trong khi Miền Nam là 290. Đúng số, sai thứ được hỏi, và không có dấu
       * hiệu nào vì 93 cũng là một con số có thật trên biểu đồ.
       */
      const cungNhan = rows.filter((r) => r.label === dong.label);
      if (bang.seriesLabel !== undefined && cungNhan.length > 1) {
        const tongNhom = cungNhan.reduce((t, r) => t + r.value, 0);
        const giaNhom = doc(tongNhom);
        return {
          cau: ghep(
            `${measureLabel} của ${dong.label} là ${giaNhom}, cộng qua ${String(cungNhan.length)} ${bang.seriesLabel}.`,
            cat,
          ),
          so: [giaNhom],
        };
      }

      const gia = doc(dong.value);
      return { cau: `${measureLabel} của ${tenDong(dong)} là ${gia}.`, so: [gia] };
    }
  }
}

export type ToanTu = '=' | '>' | '<' | '>=' | '<=';

/*
 * Ngưỡng đọc từ câu GỐC, không đọc từ bản đã chuẩn hoá.
 *
 * `chuanHoa` biến mọi dấu câu thành khoảng trắng, nên "50.000" thành "50 000"
 * và `docSo` lấy về 50 — nhỏ hơn một nghìn lần, im lặng, và kết quả lọc vẫn là
 * một danh sách trông hợp lý. Dấu chấm phần nghìn là cách viết số chuẩn của
 * tiếng Việt, nên nó phải được đọc như một con số chứ không phải hai.
 *
 * `(?!\d)` sau nhóm nghìn là bắt buộc: thiếu nó thì "top 5 năm 2024" khớp
 * thành "5 202".
 */
function docNguong(raw: string): number | null {
  const m = /\d{1,3}(?:[.\s]\d{3})+(?!\d)|\d+/.exec(raw);
  if (m === null) return null;
  const n = Number(m[0].replace(/[.\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function docDieuKien(cauHoi: string): { toanTu: ToanTu; nguong: number } | null {
  const q = chuanHoa(cauHoi);
  const nguong = docNguong(cauHoi);
  if (nguong === null) return null;

  /*
   * Từ DÀI trước: "lớn hơn hoặc bằng" chứa "lớn hơn".
   *
   * ⚠️ `tren` và `duoi` phải ĐỨNG NGAY TRƯỚC một chữ số. Hai từ đó có hai
   * nghĩa trong tiếng Việt, và nghĩa còn lại gặp liên tục ở đây: "liệt kê sản
   * phẩm trên biểu đồ có số lượng 4" là một câu LỌC BẰNG 4, nhưng chữ "trên"
   * của "trên biểu đồ" biến nó thành "lớn hơn 4" — một danh sách khác, không
   * có mục nào sai, không có gì báo. Mấy toán tử nhiều từ thì không mơ hồ nên
   * không cần kẹp.
   */
  const bang: [RegExp, ToanTu][] = [
    [/(lon hon hoac bang|khong nho hon|tro len|it nhat la)/, '>='],
    [/(nho hon hoac bang|khong lon hon|tro xuong|toi da la|nhieu nhat la)/, '<='],
    [/(lon hon|cao hon|nhieu hon|vuot qua|tren \d)/, '>'],
    [/(nho hon|thap hon|it hon|duoi \d)/, '<'],
    /*
     * "hơn" TRẦN, và nó phải đứng CUỐI bảng.
     *
     * "có hơn 50.000 dòng" là cách nói thường gặp nhất của một câu lọc, mà
     * không khớp dòng nào ở trên nên nó rơi về `=` — tức lọc đúng 50.000,
     * gần như luôn ra rỗng, và khung nói "không có gì" bằng giọng chắc chắn.
     *
     * Đứng cuối vì "ít hơn" và "nhỏ hơn" cũng chứa "hơn": hai dòng trên phải
     * được hỏi trước, nếu không mọi câu lọc NHỎ HƠN đều lật thành LỚN HƠN.
     */
    [/hon \d/, '>'],
  ];
  for (const [re, op] of bang) {
    if (re.test(q)) return { toanTu: op, nguong };
  }
  return { toanTu: '=', nguong };
}

const CHU_TOAN_TU: Record<ToanTu, string> = {
  '=': 'bằng',
  '>': 'lớn hơn',
  '<': 'nhỏ hơn',
  '>=': 'từ … trở lên',
  '<=': 'từ … trở xuống',
};

function dung(gia: number, toanTu: ToanTu, nguong: number): boolean {
  switch (toanTu) {
    case '>':
      return gia > nguong;
    case '<':
      return gia < nguong;
    case '>=':
      return gia >= nguong;
    case '<=':
      return gia <= nguong;
    default:
      return gia === nguong;
  }
}

function docSo(cauHoi: string): number | null {
  const m = /\d+/.exec(cauHoi);
  return m === null ? null : Number(m[0]);
}

function timDong(
  rows: ReportDataDto['rows'],
  cauHoi: string,
): ReportDataDto['rows'][number] | null {
  const q = chuanHoa(cauHoi);
  /*
   * Nhãn DÀI NHẤT trước. "Miền Bắc" và "Miền Bắc Trung Bộ" cùng nằm trong câu
   * hỏi về cái thứ hai; lấy cái ngắn là trả lời về một nhóm khác, bằng một con
   * số có thật — nên không có gì báo là đã nhầm.
   */
  const theoDoDai = [...rows].sort((a, b) => tenDong(b).length - tenDong(a).length);
  return theoDoDai.find((r) => r.label !== '' && q.includes(chuanHoa(r.label))) ?? null;
}

function timChuoi(rows: ReportDataDto['rows'], cauHoi: string): string | null {
  const q = chuanHoa(cauHoi);
  const ten = [...new Set(rows.map((r) => r.series ?? '').filter((x) => x !== ''))].sort(
    (a, b) => b.length - a.length,
  );
  return ten.find((x) => q.includes(chuanHoa(x))) ?? null;
}

function timHaiDong(
  rows: ReportDataDto['rows'],
  cauHoi: string,
): [ReportDataDto['rows'][number], ReportDataDto['rows'][number]] | null {
  const q = chuanHoa(cauHoi);
  const thay = [...rows]
    .sort((a, b) => tenDong(b).length - tenDong(a).length)
    .filter((r) => r.label !== '' && q.includes(chuanHoa(r.label)));

  /*
   * ⚠️ HAI NHÃN KHÁC NHAU, không phải hai DÒNG bất kỳ.
   *
   * Trên biểu đồ CỘT CHỒNG, một nhóm trải ra thành nhiều dòng — (Miền Nam, Gia
   * dụng) và (Miền Nam, Thời trang). Câu "Miền Nam là bao nhiêu" gọi tên MỘT
   * nhóm, nhưng khớp HAI dòng, nên bản cũ đem hai MẢNH của cùng một nhóm ra so
   * với nhau: "Miền Nam (Gia dụng) cao hơn Miền Nam (Thời trang)" — hai con số
   * thật cho một câu hỏi xin TỔNG của nhóm đó.
   *
   * Lỗi này nằm sẵn trong hàm từ trước nhưng không ai tới được: `so_sanh` chỉ
   * mở bằng từ khoá ("so với", "so sánh"), mà ai gõ "so với" thì đã gõ hai tên.
   * Luật "gõ tên hai mục ra là câu so sánh" ở `tinhBang` mở rộng cửa vào, và bộ
   * đánh giá đỏ ngay ở hai ca cột chồng.
   */
  const daCo = new Set<string>();
  const rieng = thay.filter((r) => {
    const k = chuanHoa(r.label);
    if (daCo.has(k)) return false;
    daCo.add(k);
    return true;
  });

  const [a, b] = rieng;
  return a !== undefined && b !== undefined ? [a, b] : null;
}

const HU_TU = new Set(['cua', 'co']);

/**
 * @param uuTienSo chỉ dữ kiện có giá trị LÀ SỐ được làm vế CHÍNH của câu trả lời.
 *   Vế GHÉP thì vẫn tìm trên cả danh sách — xem khối chú thích ở nhánh `dem`.
 * @param phuToiThieu tỉ lệ chữ của NHÃN thắng phải có mặt trong câu hỏi.
 *   Mặc định 0 — trùng hai chữ là đủ, như cũ. Xem `traLoiHeThong` về chỗ duy
 *   nhất đòi cao hơn, và vì sao.
 */
function traCuu(
  duKien: DuKien[],
  cauHoi: string,
  nenChung: DuKien[] = duKien,
  uuTienSo = false,
  phuToiThieu = 0,
  daGoiTen = false,
): TraLoi | null {
  const noiDung = (s: string): string[] =>
    chuanHoa(s)
      .split(' ')
      .filter((t) => t.length > 1 && !TU_HOI.has(t));

  /*
   * ⚠️ "bao nhiêu" bỏ nguyên CỤM, không bỏ từng chữ.
   *
   * `TU_HOI` không chứa được `bao`: `chuanHoa('báo')` cũng ra `bao`, nên bỏ nó
   * là xé đôi chữ "báo cáo" ở mọi nhãn. Nhưng cả CỤM "bao nhieu" thì chỉ có
   * một nghĩa — nó là chữ để hỏi, không bao giờ là tên dữ liệu.
   *
   * LỖI ĐO ĐƯỢC: "giá gói Pro bao nhiêu" hoà điểm với nhãn "Hạn mức báo cáo
   * của gói Pro", vì chữ "bao" của "bao nhiêu" khớp với "báo" của "báo cáo".
   * Người dùng hỏi giá, khung đưa ra hạn mức.
   */

  /*
   * ═══ GIỮ LẠI DẤU NGƯỜI DÙNG ĐÃ GÕ ════════════════════════════
   *
   * Phép chấm điểm nhãn so trên chữ ĐÃ BỎ DẤU, và đó là chủ ý: gõ "doanh thu"
   * thiếu dấu thì vẫn phải tìm ra nhãn "Doanh thu". Nhưng khi người dùng CÓ gõ
   * dấu thì bỏ dấu là TỰ TẠO RA từ giả, và mỗi từ giả là một nhãn sai thắng:
   *
   *   "mô hình ĐÓ gồm bao nhiêu bảng"  → khớp nhãn "Loại biểu ĐỒ của báo cáo"
   *
   * Cả hai đều ra `do`. ĐO ĐƯỢC trên máy thật: câu hỏi số BẢNG của một mô hình
   * nhận về LOẠI BIỂU ĐỒ của báo cáo — chỉ vì chữ "đó".
   *
   * Luật: một chữ người dùng gõ CÓ DẤU chỉ khớp đúng chữ ấy trên nhãn. Chữ gõ
   * KHÔNG dấu thì khớp rộng như cũ. Cùng luật mà `soSanh.ts` đã dựng cho phép
   * đọc chiều, nay đưa sang phép chấm nhãn — nơi nó còn ăn nhiều ca hơn.
   *
   * `''` nghĩa là KHÔNG RÀNG BUỘC: hoặc người dùng gõ không dấu, hoặc chữ đó
   * đã qua bảng đồng nghĩa ("highest" → "cao nhat") nên không còn dấu để canh.
   */
  const tuTho = chuanHoaCoDau(cauHoi).split(' ');
  const hoiDau = new Map<string, Set<string>>();
  for (const [i, w] of tuTho.entries()) {
    // "bao nhiêu" bỏ nguyên CỤM — lý do ở khối trên.
    const sau = tuTho[i + 1];
    const truoc = tuTho[i - 1];
    if (chuanHoa(w) === 'bao' && sau !== undefined && chuanHoa(sau) === 'nhieu') continue;
    if (chuanHoa(w) === 'nhieu' && truoc !== undefined && chuanHoa(truoc) === 'bao') continue;

    const mong = chuanHoa(w);
    const nhieuChu = mong.includes(' ');
    for (const t of mong.split(' ')) {
      if (t.length <= 1 || TU_HOI.has(t) || HU_TU.has(t)) continue;
      const dang = hoiDau.get(t) ?? new Set<string>();
      dang.add(nhieuChu || !coDauTiengViet(w) ? '' : w);
      hoiDau.set(t, dang);
    }
  }

  const tuHoi = new Set(hoiDau.keys());
  if (tuHoi.size === 0) return null;

  /*
   * HAI MỨC, và phải là hai — đã thử một mức và bộ đánh giá đỏ ngay.
   *
   * Bản đầu coi lệch dấu là KHÔNG KHỚP, và nó làm mất một câu đang đúng:
   *
   *   hỏi "báo cáo X DÙNG mô hình nào"   — nhãn "Báo cáo X DỰNG trên gì"
   *
   * "dùng" và "dựng" cũng chụm vào nhau sau khi bỏ dấu, nhưng ở đây chúng GẦN
   * NGHĨA — khác hẳn "đó" với "đồ". Một luật chỉ biết nói có/không thì phải
   * chọn mất một trong hai ca.
   *
   * Nên tách: lệch dấu vẫn ĐẾM ĐIỂM (nó là bằng chứng yếu, không phải không
   * có bằng chứng), nhưng KHÔNG được làm CHỮ RIÊNG mở thêm một vế trả lời.
   * Một vế trả lời thêm vào vì chữ "đó" khớp chữ "đồ" thì cả vế đó là bịa.
   */

  /** ĐÒI ĐÚNG DẤU người dùng đã gõ. */
  const hopChuChat = (w: string): boolean => {
    const dang = hoiDau.get(chuanHoa(w));
    if (dang === undefined) return false;
    const coDau = chuanHoaCoDau(w);
    return [...dang].some((d) => d === '' || d === coDau);
  };

  /*
   * ⚠️ CHỮ HAI KÝ TỰ thì DẤU LÀ GẦN HẾT NGHĨA, nên chúng chấm theo mức CHẶT.
   *
   * "đó" và "đồ" — hai chữ không liên quan gì — cùng ra `do`. "bộ" và "bỏ", "số"
   * và "so", "là" và "lạ" cũng vậy. Còn từ BA ký tự trở lên thì hai chữ trùng
   * nhau sau khi bỏ dấu thường là cùng gốc và gần nghĩa — "dùng" với "dựng" — nên
   * chặn chúng là mất một câu đang đúng.
   *
   * ĐO ĐƯỢC Ở CẢ HAI CHIỀU: siết hết thì câu "báo cáo X DÙNG mô hình nào" mất
   * đáp án; nới hết thì câu hỏi số BẢNG của một mô hình hoà điểm với nhãn
   * "Loại biểu ĐỒ" — chỉ vì chữ "ĐÓ" — rồi bỏ cả hai.
   */
  const hopChu = (w: string): boolean =>
    chuanHoa(w).length <= 2 ? hopChuChat(w) : hoiDau.has(chuanHoa(w));

  /*
   * ⚠️ KHÔNG khử trùng phía nhãn, dù phía câu hỏi đã là một `Set`.
   *
   * Trông như một sơ suất, và đã thử sửa. Bỏ `new Set` vào đây đổi MỘT ca lấy
   * MỘT ca: "có bao nhiêu bộ dữ liệu" hỏi xuyên hệ thống mất đáp án, vì nhãn
   * "Số BỘ dữ liệu trong toàn BỘ tổ chức" đang thắng "Số mô hình dữ liệu trong
   * toàn bộ tổ chức" nhờ đúng chữ "bộ" đếm hai lần. Khử trùng thì hai nhãn
   * hoà điểm và khung bỏ cả hai.
   *
   * Đếm lặp là một bằng chứng yếu, nhưng nó là bằng chứng: nhãn nói chữ ấy
   * nhiều lần hơn thì nó nói về chữ ấy nhiều hơn. Giữ nguyên, và ghi lại để lần
   * sau không ai "sửa" nó thêm một lần nữa.
   */
  /*
   * ⚠️ Đếm lặp theo chữ GỐC, không theo chữ đã bỏ dấu.
   *
   * Khối trên giữ phép đếm lặp vì "nhãn nói chữ ấy nhiều lần hơn thì nó nói về
   * chữ ấy nhiều hơn" — đúng với "Số BỘ dữ liệu trong toàn BỘ tổ chức", nơi
   * cùng MỘT chữ xuất hiện hai lần.
   *
   * Nhưng "Thư mục của báo cáo Doanh thu 2026" có "Thư" và "thu" — HAI chữ
   * khác nhau, chỉ trùng nhau SAU khi bỏ dấu. Đếm chúng là hai lần là đọc một
   * sự trùng ngẫu nhiên của phép bỏ dấu thành một bằng chứng về ngữ nghĩa.
   *
   * LỖI ĐO ĐƯỢC: "ai tạo báo cáo Doanh thu 2026" hoà điểm 6-6 giữa "Người tạo
   * báo cáo …" và "Thư mục của báo cáo …", rồi luật "phải hơn hẳn ứng viên
   * nhì" bỏ cả hai — một câu hỏi đơn giản nhất có thể, mất đáp án.
   *
   * Nên số lần một chữ được tính = số lần xuất hiện của CÁCH VIẾT nhiều nhất.
   * "bộ" hai lần vẫn là hai; "Thư" + "thu" là một.
   */
  /*
   * ═══ PHỦ QUYẾT: trùng toàn chữ CHUNG thì không phải một câu trả lời ══════
   *
   * Nhãn của một mục đều mang tên mục ấy: "… kết nối MySQL bán hàng" có trong
   * cả sáu nhãn. Nên hai chữ "kết nối" một mình đã đủ vượt ngưỡng 2, và câu
   * hỏi nào nhắc "kết nối" cũng nhận về một dữ kiện nào đó, bất kể hỏi gì.
   *
   * HAI CA SAI đo được, cùng gốc này:
   *
   *   "có bao nhiêu kết nối đang có"             -> "Số bộ dữ liệu lấy từ…: 2"
   *   "số tài khoản nhận tiền của … SePay là gì" -> "Nhà cung cấp của …: sepay"
   *
   * Ca thứ hai đáng sợ hơn: nó hỏi một thứ bản khai CỐ Ý không chứa, rồi nhận
   * về một câu rất tự tin về chuyện khác.
   *
   * ⚠️ PHỦ QUYẾT, không phải TRỪ ĐIỂM. Đã thử trừ chữ chung ra khỏi điểm: nó
   * kéo "Số dòng của Orders" xuống còn 1 điểm cho câu "Orders có bao nhiêu
   * dòng" — dưới ngưỡng 2 — và mất 11 câu đang đúng. Ngưỡng và phép chấm gắn
   * với nhau; chỉ cái CHỐT cuối là tách ra được.
   *
   * Chữ chung không mang tin phân biệt: nó chỉ nói "đúng mục này", mà việc ấy
   * `nguonTheoTen` đã làm xong. Người thắng phải trùng ít nhất MỘT chữ ở phần
   * còn lại của nhãn.
   *
   * ⚠️ Chỉ áp khi mục có TỪ HAI nhãn. Một nhãn duy nhất thì mọi chữ đều
   * "chung", và phủ quyết hết là mục đó không bao giờ trả lời được.
   */
  /*
   * ⚠️ Từ BA nhãn trở lên mới xét "chữ chung".
   *
   * Hai nhãn chỉ khác nhau một chữ ("Số workspace bạn vào được" / "Tên các
   * workspace bạn vào được") thì gần như mọi chữ đều "chung", và phủ quyết sẽ
   * bỏ luôn câu trả lời đúng. Với hai mục, "chung" chưa nói được điều gì.
   */
  const chung = new Set<string>(nenChung.length < 3 ? [] : noiDung(nenChung[0]?.nhan ?? ''));
  for (const d of nenChung.slice(1)) {
    const co = new Set(noiDung(d.nhan));
    for (const t of [...chung]) if (!co.has(t)) chung.delete(t);
  }

  /*
   * ═══ MỘT CỤM LIỀN MẠCH LÀ BẰNG CHỨNG MẠNH HƠN MẤY CHỮ RỜI ════════════════
   *
   * Phép đếm ở trên chấm từng chữ, không biết gì về THỨ TỰ. Nên hai nhãn nói
   * hai chuyện khác hẳn vẫn hoà nhau chỉ vì chúng dùng chung mấy chữ lẻ:
   *
   *   hỏi  "… CƠ SỞ DỮ LIỆU nào"
   *   nhãn "CƠ SỞ DỮ LIỆU của kết nối …"      ← liền mạch 3 chữ
   *   nhãn "Số BỘ DỮ LIỆU lấy từ kết nối …"   ← rời: "dữ liệu" + "số"
   *
   * Cả hai trùng đúng tám chữ, nên chúng HOÀ và cả hai bị bỏ — người hỏi mất vế
   * thứ ba mà không có dấu hiệu nào. Mà một cụm người ta gõ ra nguyên văn thì
   * nói nhiều hơn hẳn mấy chữ ấy rải rác khắp một nhãn khác.
   *
   * ⚠️ BỎ CHỮ CHUNG ra trước khi đo cụm. Tên mục có trong MỌI nhãn ("… của kết
   * nối MySQL bán hàng"), và câu hỏi cũng gõ nó ra nguyên cụm — nên không bỏ thì
   * mọi ứng viên cùng được thưởng đúng một cụm dài, và phép thưởng thành vô
   * nghĩa đúng ở chỗ nó cần phân biệt.
   *
   * Thưởng `dài - 1`: một chữ đơn lẻ không phải một cụm, nên nó thưởng 0.
   */
  const tuCauHoi = chuanHoa(cauHoi).split(' ');

  const cumLienMach = (nhan: string): number => {
    const b = chuanHoa(nhan)
      .split(' ')
      .filter((t) => !chung.has(t));
    let dai = 0;
    for (const [i] of b.entries()) {
      for (const [j] of tuCauHoi.entries()) {
        let k = 0;
        while (
          b[i + k] !== undefined &&
          b[i + k] === tuCauHoi[j + k] &&
          (b[i + k]?.length ?? 0) > 1
        )
          k += 1;
        if (k > dai) dai = k;
      }
    }
    return Math.max(0, dai - 1);
  };

  const demLap = (nhan: string): number => {
    const theoGoc = new Map<string, Map<string, number>>();
    for (const w of nhan.toLowerCase().split(/\s+/)) {
      const t = chuanHoa(w);
      if (t.length <= 1 || TU_HOI.has(t) || !hopChu(w)) continue;
      const cach = theoGoc.get(t) ?? new Map<string, number>();
      cach.set(w, (cach.get(w) ?? 0) + 1);
      theoGoc.set(t, cach);
    }
    let tong = 0;
    for (const cach of theoGoc.values()) tong += Math.max(...cach.values());
    return tong + cumLienMach(nhan);
  };

  /*
   * ═══ MỘT CÂU HỊI CÓ THỂ HỊI NHIỀU THỨ ═════════════════════════════
   *
   * Bản cũ lấy `diem[0]` rồi trả về ĐÚNG MỘT dữ kiện, luôn luôn. Người dùng
   * thật không hỏi như vậy — năm ảnh chụp màn hình từ buổi thử trên máy thật,
   * cả năm đều là câu ghép và cả năm đều mất một nửa:
   *
   *   "... có bao nhiêu bảng VÀ bao nhiêu thước đo"   → chỉ thước đo
   *   "... bao nhiêu dòng, bao nhiêu cột VÀ cập nhật lúc nào" → chỉ ngày cập nhật
   *   "... chứa bao nhiêu biểu đồ VÀ được tạo bởi ai"      → chỉ số biểu đồ
   *
   * Vế bị bỏ không theo quy luật trước/sau nào cả — nhãn nào trùng NHIỀU CHỮ
   * hơn thì thắng, nên "thước đo" (hai chữ) đè "bảng" (một chữ). Người hỏi
   * không có cách nào biết mình vừa mất nửa câu.
   *
   * ═══ Phân biệt "hỏi HAI thứ" với "không rõ hỏi thứ nào" ═══════════════
   *
   * Hai thứ này cùng hiện ra là "nhiều nhãn cùng điểm cao", và luật cũ xử cả
   * hai bằng một cách: hoà điểm thì bỏ cả hai. Đúng với vế sau, sai với vế trước.
   *
   * Chỗ khác nhau: một dữ kiện được HỊI THÊM thì khớp một chữ TRONG CÂU HỊI mà
   * cái thắng KHÔNG khớp — chữ "bảng" có mặt vì người ta gõ nó ra. Còn hai
   * nhãn hoà vì nhập nhằng thì cùng trung trên ĐÚNG MỘT bộ chữ, không nhãn nào
   * có chữ riêng — "có bao nhiêu mô hình" trùng cả hai nhãn tóm tắt bằng đúng
   * hai chữ "mô hình". Nhập nhằng vẫn bỏ cả hai như cũ.
   *
   * ⚠️ Mỗi Ô trong câu hỏi chỉ nhận MỘT dữ kiện. Hai nhãn cùng giành một chữ
   * riêng mà bằng điểm thì chính ô ấy là nhập nhằng, và nó bị bỏ — cùng luật,
   * áp riêng cho từng ô, thay vì bỏ cả câu vì một vế không rõ.
   */
  const khopTu = (nhan: string): Set<string> => {
    const r = new Set<string>();
    for (const w of nhan.toLowerCase().split(/\s+/)) {
      const t = chuanHoa(w);
      if (t.length > 1 && !TU_HOI.has(t) && hopChuChat(w)) r.add(t);
    }
    return r;
  };

  const diem = duKien.map((d) => ({ d, diem: demLap(d.nhan), khop: khopTu(d.nhan) }));
  diem.sort((a, b) => b.diem - a.diem);

  const hopLe = uuTienSo ? diem.filter((x) => soVi(x.d.gia) !== null) : diem;
  const nhat = hopLe[0];
  if (nhat === undefined || nhat.diem < 2) return null;

  /*
   * Câu đòi một CÁI TÊN không được trả lời bằng một phép đếm — xem `doiTen`.
   *
   * ⚠️ TRỪ khi câu đã GỌI ĐÍCH DANH một mục, và ngoại lệ đó bắt buộc. Ở đó chữ
   * "nào" đã được chính câu hỏi trả lời rồi, nên phần còn lại hỏi một con số:
   *
   *   "chỉ tính các bộ từ file products, bộ NÀO nhiều dòng nhất"
   *      → "Số dòng của Products: 10.292"        ĐÚNG, và chốt này từng ăn nó
   *
   * `traLoiTrang` chỉ đi vào nhánh gọi tên khi câu nhắc ĐÚNG MỘT mục, nên cờ
   * này không mở cửa cho câu so sánh hai mục.
   */
  const doi = doiTen(cauHoi);
  const laSo = soVi(nhat.d.gia) !== null;
  if (laSo && doi !== null && !(daGoiTen && doi === 'ten')) return null;

  /*
   * ═══ NHÃN THẮNG PHẢI NHẮC THỨ ĐANG ĐƯỢC ĐEM SO ═════════════════════════
   *
   * Cụm so sánh nói ra nó so CÁI GÌ, và chốt này đòi nhãn thắng nhắc tới đúng
   * cái đó. Thiếu nó thì mấy chữ của cụm PHẠM VI đủ để một nhãn chẳng liên quan
   * về đích:
   *
   *   "trong thư mục Bán hàng, bảng nào ít CỘT nhất"
   *      → "Số MỤC trong Thư mục Bán hàng: 5"           (ĐO ĐƯỢC)
   *
   * Câu này đi qua nhánh GỌI ĐÍCH DANH — nó nhắc đúng tên một mục có thật
   * ("Thư mục Bán hàng") — nên cờ `daGoiTen` ở trên để nó đi tiếp. Mà mục được
   * gọi tên là một THƯ MỤC còn thứ được hỏi là một BẢNG: tên mục ở đây là
   * phạm vi, không phải chủ thể. Lọc theo phạm vi là tính năng chưa có, nên
   * câu đúng là "chưa hiểu".
   *
   * Chỉ áp cho đáp án LÀ SỐ: cụm so sánh hỏi một phép so, và một dữ kiện chữ
   * ("Bộ dữ liệu cập nhật gần đây nhất") là một đáp án đã tính xong chứ không
   * phải một con số bị đem so lầm.
   */
  const doSo = tuDoSoSanh(cauHoi);
  if (laSo && doSo !== null && !nhat.khop.has(chuanHoa(doSo))) return null;

  const theoO = new Map<string, typeof diem>();
  for (const c of diem) {
    if (c === nhat) continue;
    const riengC = [...c.khop].filter((t) => !nhat.khop.has(t));
    const o = riengC[0];
    if (c.diem < 2 || o === undefined) continue;
    theoO.set(o, [...(theoO.get(o) ?? []), c]);
  }
  /*
   * ⚠️ `uuTienSo` ÁP CHO CẢ VẾ GHÉP, không chỉ vế chính — nhưng có đường lùi.
   *
   * Ô "mấy bảng" trong câu đếm đòi một CON SỐ. Bỏ cờ ở đây thì trên trang chi
   * tiết mô hình, nhãn "Quan hệ giữa bảng Orders và bảng Customers" chiếm mất ô
   * ấy — nó nói chữ "bảng" HAI lần nên điểm cao hơn "Số bảng trong mô hình".
   * ĐO ĐƯỢC: "mô hình này có mấy bảng và mấy quan hệ" mất vế số bảng, đổi lấy
   * một câu mô tả quan hệ không ai hỏi.
   *
   * Đường lùi là bắt buộc: ô "ai tạo" và ô "cập nhật lúc nào" KHÔNG có ứng
   * viên số nào, và chính là hai ô mà cả bản vá này sinh ra để cứu. Nên: có ứng
   * viên số thì chỉ xét ứng viên số; không có thì xét cả ô.
   */
  const them = [...theoO.values()]
    .map((ds) => {
      const so = ds.filter((x) => soVi(x.d.gia) !== null);
      return uuTienSo && so.length > 0 ? so : ds;
    })
    .filter((ds) => ds.length === 1 || (ds[0]?.diem ?? 0) > (ds[1]?.diem ?? 0))
    .flatMap((ds) => (ds[0] === undefined ? [] : [ds[0]]));

  const nhi = hopLe[1];
  if (them.length === 0 && nhi !== undefined && nhi.diem === nhat.diem) return null;

  const rieng = noiDung(nhat.d.nhan).filter((t) => tuHoi.has(t) && !chung.has(t));
  if (chung.size > 0 && rieng.length === 0) return null;

  /*
   * ═══ PHỦ QUYẾT: nhãn nói một CHIỀU, câu hỏi hỏi chiều NGƯỢC LẠI ══════════
   *
   * Một dữ kiện có thể tự mang sẵn một phép so sánh trong tên nó — "Bộ dữ liệu
   * cập nhật GẦN ĐÂY NHẤT" là một đáp án đã tính xong, không phải một thuộc
   * tính trung tính. Phép chấm điểm không đọc được chỗ đó: nó chỉ đếm chữ
   * trùng, và "cập nhật" trùng là đủ để nhãn ấy về đích.
   *
   * LỖI ĐO ĐƯỢC: "bộ nào cập nhật SỚM NHẤT" nhận về "Bộ dữ liệu cập nhật gần
   * đây nhất: Products" — tức bộ MỚI nhất cho một câu hỏi về bộ CŨ nhất. Một
   * cái tên có thật, một ngày có thật, đáp án lộn ngược. Cùng hạng với lỗi mà
   * `chieuSoSanh` sinh ra để chặn, chỉ khác là nó đi qua nhánh tra cứu.
   *
   * ⚠️ Chốt này KHÔNG làm câu đó trả lời được: cột ngày không so được bằng số
   * (`soVi` không đọc nổi "20/01/2026"), nên `soSanhNguon` cũng không xếp theo
   * nó. Nó đổi một câu SAI thành một câu CHƯA HIỂU — và đó đúng là chiều mà cả
   * khung này đổi. Muốn trả lời được thì phải cho cột ngày so được, việc khác.
   */
  const chieuHoi = chieuSoSanh(cauHoi);
  const chieuNhan = chieuSoSanh(nhat.d.nhan);
  if (chieuHoi !== null && chieuNhan !== null && chieuHoi !== chieuNhan) return null;

  if (phuToiThieu > 0) {
    const chu = new Set(noiDung(nhat.d.nhan));
    if (chu.size > 0 && nhat.khop.size / chu.size < phuToiThieu) return null;
  }

  if (them.length === 0) return traLoiTheoDuKien(nhat.d);

  /*
   * Trả lời theo thứ tự NGƯỜI TA HỊI, không theo thứ tự điểm. Hỏi "bao nhiêu
   * dòng, bao nhiêu cột rồi cập nhật lúc nào" mà đáp "cập nhật … dòng … cột" thì
   * người đọc phải tự ghép lại từng vế. Mốc sắp là chữ RIÊNG đầu tiên của mỗi
   * dữ kiện — chữ chung (tên mục) có trong mọi nhãn nên không sắp được theo nó.
   */
  /*
   * ⚠️ SẮP THEO THỨ TỰ HỎI TRƯỚC, CẮT SAU — không được làm ngược.
   *
   * Bản đầu cắt theo ĐIỂM rồi mới sắp, nên vế bị bỏ là vế điểm thấp nhất
   * chứ không phải vế hỏi sau cùng. ĐO ĐƯỢC trên máy thật:
   *
   *   "… bao nhiêu dòng, bao nhiêu CỘT và trạng thái nạp DỮ LIỆU …"
   *
   * Vế "cột" trùng đúng một chữ nên điểm thấp; nhãn "Số mô hình DỮ LIỆU dùng
   * Orders" trùng hai chữ của cụm "nạp dữ liệu" nên điểm cao hơn — và nó đẩy vế
   * người ta thực sự hỏi ra khỏi câu trả lời. Sắp theo chỗ người ta gõ ra thì
   * cái bị cắt là cái hỏi sau cùng, đúng như người đọc chờ đợi.
   */
  const tatCaChon = [nhat, ...them];
  const chungChon = new Set(
    [...(tatCaChon[0]?.khop ?? [])].filter((t) => tatCaChon.every((c) => c.khop.has(t))),
  );
  const thuTu = [...tuHoi];
  const viTri = (c: (typeof tatCaChon)[number]): number => {
    const i = [...c.khop].filter((t) => !chungChon.has(t)).map((t) => thuTu.indexOf(t));
    return i.length === 0 ? thuTu.length : Math.min(...i);
  };
  const chon = [...tatCaChon].sort((a, b) => viTri(a) - viTri(b)).slice(0, 3);

  const phan = chon.map((c) => traLoiTheoDuKien(c.d));
  return { cau: noiVe(phan.map((x) => x.cau)), so: phan.flatMap((x) => x.so) };
}

export function traLoiBangThoEp(
  bt: BangTho,
  cauHoi: string,
  epCot?: { nhan: number | null; do: number | null },
): TraLoi | null {
  const kq = bangTuBangTho(bt, cauHoi, epCot);
  if (kq === null) return null;

  const y = docYDinh(cauHoi);

  /*
   * ═══ MỘT NHÓM THÌ KHÔNG CÓ GÌ ĐỂ SO ════════════════════════════
   *
   * ĐO ĐƯỢC trên máy thật: "Trong thư mục Chung của Kho dữ liệu, bảng nào có số
   * lượng cột ít nhất?" — câu hỏi nhắc tên một thư mục, nên phép gộp chọn cột
   * THƯ MỤC làm nhãn, gộp bốn bộ dữ liệu thành ĐÚNG MỘT nhóm, rồi trả về "Thư
   * mục thấp nhất là Chung, với tổng Cột 41 trên 1 Thư mục". So một thứ với
   * chính nó: luôn đúng, luôn vô nghĩa — và nó đứng chắn đúng chỗ đáng ra phải so
   * giữa các BẢNG.
   *
   * ⚠️ ĐẶT Ở ĐÂY, không đặt trong `tinhBang`. Ở đó danh sách đã gộp xong nên
   * không còn phân biệt được "bảng vốn chỉ có một dòng" với "gộp bóp nhiều
   * dòng thành một". Đã thử đặt ở đó và nó làm đỏ bảy ca của luồng "hỏi lại
   * khi mơ hồ", nơi hai biểu đồ mỗi cái MỘT dòng chính là thứ tạo ra sự mơ hồ.
   */
  const soSanh = y === 'cao_nhat' || y === 'thap_nhat' || y === 'top_n';
  if (soSanh && kq.bang.rows.length < 2 && bt.dong.length >= 2) return null;

  /*
   * ═══ Ý định ĐẾM đòi câu hỏi phải GỌI TÊN cột nhãn ════════════════════════
   *
   * `bangTuBangTho` đã có một chốt gần giống ngay trên — nhưng nó chỉ bắt
   * trường hợp câu hỏi không gọi tên cột NÀO cả. Trường hợp này khác: câu hỏi
   * gọi tên một cột ĐO ĐƯỢC, nên `iDo` có giá trị và chốt kia không chạy, rồi
   * cột nhãn bị lấy bừa là cột chữ đầu tiên.
   *
   * LỖI ĐO ĐƯỢC: trang Mô hình dữ liệu khai bảng có cột "Báo cáo" (số báo cáo
   * đang dùng mỗi mô hình). Câu "có bao nhiêu báo cáo" khớp đúng cột ấy, rồi
   * `tinhBang` đếm số NHÓM của cột nhãn và trả về "Có 3 Tên trên bảng này" —
   * ba mô hình, cho một câu hỏi về số báo cáo. Nó còn chặn luôn đường sang dữ
   * kiện xuyên hệ thống vốn trả lời đúng (7 báo cáo trong workspace).
   *
   * "Có bao nhiêu X" luôn đếm X, nên X phải là cột nhãn. Gọi tên một cột đếm
   * rồi đi đếm nhóm của cột khác là trả lời một câu hỏi khác — và ở đây từ chối
   * là đúng, vì bảng không biết câu hỏi đang nói về phạm vi nào.
   *
   * ⚠️ `cotQuaGiaTri` cũng tính là "có gọi tên": "Boston có bao nhiêu" không
   * nhắc tên cột nào mà nhắc một GIÁ TRỊ của nó, và câu đó vẫn phải trả lời
   * được.
   */
  if (y === 'dem' && !kq.coNhan) return null;

  return tinhBang(kq.bang, cauHoi, y, 'label', {
    chu: 'bảng này',
    luuY: [kq.gop, bt.luuY].filter((x) => x !== null).join('; '),
  });
}

/* ═══ BẢNG THÔ: để CÂU HỎI chọn lấy hai cột ══════════════════════════
 *
 * Một bảng dữ liệu thật có hai mươi cột và không cột nào được đề cử sẵn. Thay
 * vì khai mỗi cặp (cột chữ × cột số) thành một nguồn — hai mươi cột là cả trăm
 * chip — bảng ở nguyên một nguồn, và chính câu hỏi chỉ ra hai cột nó muốn.
 *
 * Nhờ vậy toàn bộ `tinhBang` — cao nhất, tổng, trung bình, top N, tỉ trọng, đếm,
 * lọc — dùng được nguyên cho dữ liệu người dùng vừa tải lên, không viết thêm một
 * phép tính nào. Và mọi câu trả lời của `tinhBang` đều gọi tên `dimensionLabel` và
 * `measureLabel`, nên chọn trệch cột là người đọc thấy ngay — đúng tính chất mà
 * `hieuLa` bên lớp điền form phải dựng lại bằng tay.
 */

function oThanhSo(v: string | number | boolean | null): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const chu = v.trim();
  if (chu === '') return null;
  const n = Number(chu);
  return Number.isFinite(n) ? n : null;
}

export function cotDoDuoc(bt: BangTho): number[] {
  return bt.cot.flatMap((_, i) => {
    let co = 0;
    for (const d of bt.dong) {
      const o = d[i];
      if (o === null || o === undefined || o === '') continue;
      if (oThanhSo(o) === null) return [];
      co += 1;
    }
    return co > 0 ? [i] : [];
  });
}

/*
 * Câu hỏi có nhắc tới một GIÁ TRỊ nào đang nằm trên bảng không.
 *
 * Dùng đúng một chỗ: quyết định xem một câu nhắc thứ lạ có được nhánh bảng
 * thô trả lời hay không. "Staples" không nằm trong dữ kiện đã khai nên
 * `nhacThuLa` gọi nó là lạ, nhưng nó là một Ô TRÊN BẢNG — chặn câu đó là mất
 * đúng nhóm câu hỏi mà bảng sinh ra để trả lời. Còn "Invoices" thì không có ở
 * đâu cả, và câu hỏi về nó phải bị từ chối chứ không nhận về số dòng của bảng.
 *
 * Cận BA ký tự: ngắn hơn thì một ô như "EU" hay "US" khớp vào giữa một chữ
 * khác và mở lại đúng cửa vừa đóng.
 */
function bangNhacToi(bt: BangTho | undefined, cauHoi: string): boolean {
  if (bt === undefined) return false;
  const q = ` ${chuanHoa(cauHoi)} `;
  for (const dong of bt.dong) {
    for (const o of dong) {
      if (typeof o !== 'string') continue;
      const v = chuanHoa(o);
      if (v.length >= 3 && q.includes(` ${v} `)) return true;
    }
  }
  return false;
}

function cotGoiTen(bt: BangTho, chiSo: number[], q: string): number | null {
  // Cùng luật đã ghi ở `timDong`: "Sales" và "Sales Amount" cùng nằm trong câu
  // hỏi về cái thứ hai; lấy cái ngắn là đo nhầm cột bằng một con số có thật.
  const ung = chiSo
    .map((i) => ({ i, ten: chuanHoa(bt.cot[i] ?? '') }))
    .filter((x) => x.ten !== '' && q.includes(` ${x.ten} `))
    .sort((a, b) => b.ten.length - a.ten.length);
  return ung[0]?.i ?? null;
}

function cotQuaGiaTri(bt: BangTho, chiSo: number[], q: string): number | null {
  let tot: { i: number; dai: number } | null = null;
  for (const i of chiSo) {
    for (const d of bt.dong) {
      const v = d[i];
      if (typeof v !== 'string') continue;
      const c = chuanHoa(v);
      if (c.length < 4 || !q.includes(` ${c} `)) continue;
      if (tot === null || c.length > tot.dai) tot = { i, dai: c.length };
    }
  }
  return tot?.i ?? null;
}

export function bangTuBangTho(
  bt: BangTho,
  cauHoi: string,
  epCot?: { nhan: number | null; do: number | null },
): { bang: ReportDataDto; gop: string | null; coNhan: boolean } | null {
  if (bt.dong.length === 0) return null;
  const q = ` ${chuanHoa(cauHoi)} `;

  const doDuoc = cotDoDuoc(bt);
  const conLai = bt.cot.flatMap((_, i) => (doDuoc.includes(i) ? [] : [i]));
  const hopLe = (i: number | null | undefined, trong: number[]): number | null =>
    i !== null && i !== undefined && trong.includes(i) ? i : null;

  // TÊN cột trước, rồi mới tới một GIÁ TRỊ của nó — xem `cotQuaGiaTri`.
  const nhanGoiTen =
    hopLe(epCot?.nhan, conLai) ?? cotGoiTen(bt, conLai, q) ?? cotQuaGiaTri(bt, conLai, q);
  const iDo =
    hopLe(epCot?.do, doDuoc) ??
    cotGoiTen(bt, doDuoc, q) ??
    (doDuoc.length === 1 ? (doDuoc[0] ?? null) : null);

  /*
   * Không nói ĐO gì, nhưng có gọi tên một cột — thì đếm DÒNG, đúng như `COUNT(*)`.
   *
   * "Có bao nhiêu sản phẩm" không nhắc Số lượng hay Doanh thu, và đúng là nó không
   * cần: câu hỏi đó đếm sản phẩm chứ không đo gì cả. Đòi cho được một cột đo là
   * bỏ mất cả nhóm câu hỏi đơn giản nhất về một bảng.
   *
   * ⚠️ Đòi cột nhãn phải ĐƯỢC GỌI TÊN, không nhận cột chữ đầu tiên. Thiếu cửa
   * đó thì mọi câu hỏi vạ vật đều ra một con số — "giá cổ phiếu hôm nay bao nhiêu"
   * cũng thành "có 5 Mã đơn trên bảng này".
   */
  const demDong = iDo === null && nhanGoiTen !== null;
  if (iDo === null && !demDong) return null;

  const iNhan = nhanGoiTen ?? conLai[0] ?? null;

  const tho = bt.dong.flatMap((d) => {
    const v = iDo === null ? 1 : oThanhSo(d[iDo] ?? null);
    if (v === null) return [];
    const o = iNhan === null ? null : (d[iNhan] ?? null);
    return [{ label: o === null ? '(trống)' : String(o), value: v }];
  });
  if (tho.length === 0) return null;

  /*
   * GỘP SẴN theo cột nhãn, không để `tinhBang` tự quyết.
   *
   * ⚠️ Chỗ này từng SAI, và sai im lặng. `chieuHoi` trả `null` khi bảng không có
   * `seriesLabel` — đúng với một biểu đồ một chiều, nơi mỗi nhãn đã là một nhóm
   * do Cube gộp sẵn. Bảng thô thì ngược hẳn: nó là từng DÒNG giao dịch, một sản
   * phẩm nằm rải trên năm dòng. Không gộp thì "sản phẩm nào bán nhiều nhất" trả về
   * dòng đơn lẻ lớn nhất — một con số có thật, của một câu hỏi khác.
   *
   * Gộp cũng làm `ti_trong` và `gia_tri` đúng theo: cả hai tìm MỘT dòng theo nhãn,
   * và với nhãn lặp thì chúng lấy nhầm dòng đầu tiên thay vì cả nhóm.
   *
   * Bảng vốn mỗi nhãn một dòng (danh mục sản phẩm chẳng hạn) thì phép gộp không
   * đổi gì — nên nó hoặc đúng, hoặc vô hại, không có trường hợp thứ ba.
   */
  const theo = new Map<string, number>();
  for (const r of tho) theo.set(r.label, (theo.get(r.label) ?? 0) + r.value);
  const rows = [...theo].map(([label, value]) => ({ label, value }));

  const tenNhan = iNhan === null ? 'dòng' : (bt.cot[iNhan] ?? 'dòng');
  return {
    bang: {
      rows,
      dimensionLabel: tenNhan,
      measureLabel: iDo === null ? 'số dòng' : (bt.cot[iDo] ?? ''),
      // `false`: vế điều kiện đi qua `boiCanh.luuY` của `tinhBang` chứ không qua
      // `luuYCat` — bảng này là mẫu vì BẢN CHẤT, không vì một cờ nào bật lên.
      grouped: false,
    },
    // Chỉ nói ra khi phép gộp THẬT SỰ nhập mấy dòng lại. Bảng mỗi nhãn một dòng
    // mà vẫn nói "đã cộng theo …" là thêm một vế không mang thông tin nào.
    gop: rows.length < tho.length ? `đã cộng theo ${tenNhan}` : null,
    /*
     * Câu hỏi có GỌI TÊN cột nhãn không, hay cột nhãn là cột chữ đầu tiên lấy
     * cho đủ. Nơi gọi cần biết để chặn ý định ĐẾM — xem `traLoiBangThoEp`.
     */
    coNhan: nhanGoiTen !== null,
  };
}

/* ═══ MỘT CÂU, HAI PHÉP TÍNH ════════════════════════════════════════════════
 *
 * Phép tra cứu dữ kiện đã biết chia vế từ lâu — "bao nhiêu dòng, bao nhiêu cột
 * và ai tạo" trả đủ ba vế. Phép TÍNH thì không: `tinhBang` đọc MỘT ý định rồi
 * trả MỘT đáp án, nên câu ghép mất một nửa mà không có dấu hiệu nào:
 *
 *   "sản phẩm nào cao nhất và sản phẩm nào thấp nhất" → chỉ Staples
 *   "thấp nhất là cái nào, còn cao nhất là cái nào"   → chỉ Acco
 *   "tổng doanh thu và doanh thu trung bình"          → chỉ 118, mất 590
 *
 * Cùng họ với năm ảnh chụp màn hình đã sinh ra máy chia vế của `traCuu` — bản
 * vá đó chữa nhánh TRA CỨU và để nhánh TÍNH nguyên vẹn. Đây là nửa còn lại.
 *
 * ⚠️ Chia theo TỪ NỐI, không chia theo vị trí từ khoá. Thử đọc "mọi ý định có
 * trong câu" thì vướng ngay chỗ `chuanHoa` nở một chữ thành nhiều chữ
 * (`dataset` → `bo du lieu`), nên không còn ánh xạ 1:1 về vị trí để sắp thứ tự.
 * Từ nối thì đọc được từ chính câu thô, và nó là cách người ta thật sự viết câu
 * ghép.
 */

/**
 * Ý định được phép ghép hai vế.
 *
 * ⚠️ CỐ Ý thiếu `dem`, `loc`, `so_sanh`, `xu_huong`. `so_sanh` phải thiếu: "Boston
 * so với Acco, cái nào hơn" vốn là MỘT phép tính trên hai mục, và chia nó ra là
 * biến một câu đúng thành hai nửa vô nghĩa. `dem` thiếu vì nhánh đếm có thứ tự
 * ưu tiên riêng với dữ kiện đã khai (xem khối chú thích trong `traLoi`).
 */
const Y_GHEP_VE: YDinh[] = ['cao_nhat', 'thap_nhat', 'tong', 'trung_binh', 'top_n', 'ti_trong'];

/*
 * ⚠️ Chỉ mấy từ nối CÒN DẤU, cộng dấu phẩy và dấu chấm phẩy.
 *
 * "con" và "thi" không dấu bị bỏ ra: chúng là chữ thật trong tiếng Việt và
 * trong tên dữ liệu của khách, nên chia câu theo chúng là xé câu ở chỗ không
 * phải mối nối. "va" thì giữ — không có chữ "va" nào khác đáng kể.
 */
const TU_NOI_VE = /\s*(?:,|;| và | va | còn | rồi )\s*/;

function tachVe(cauHoi: string): string[] {
  return cauHoi
    .split(TU_NOI_VE)
    .map((v) => v.trim())
    .filter((v) => v !== '');
}

function tinhHaiVe(cauHoi: string, tinhVe: (hoi: string) => TraLoi | null): TraLoi | null {
  const ve = tachVe(cauHoi);
  if (ve.length < 2) return null;

  const co = ve.flatMap((v) => {
    const y = docYDinh(v);
    return y !== null && Y_GHEP_VE.includes(y) ? [{ v, y }] : [];
  });
  // Hai vế phải đọc ra HAI ý định KHÁC nhau. Cùng một ý định thì đây là một câu
  // một phép tính có dấu phẩy, và trả lời nó hai lần là lặp lại chính mình.
  if (co.length < 2 || new Set(co.map((x) => x.y)).size < 2) return null;

  const phan = co.slice(0, 2).map((x) => tinhVe(x.v));
  const [a, b] = phan;
  if (a === undefined || a === null || b === undefined || b === null) return null;
  return { cau: noiVe([a.cau, b.cau]), so: [...a.so, ...b.so] };
}

export function traLoi(
  nguon: Nguon,
  cauHoi: string,
  biet?: Set<string>,
  phuToiThieu = 0,
  /** Câu hỏi đã gọi đích danh mục này — xem chốt `doiTen` trong `traCuu`. */
  daGoiTen = false,
): TraLoi | null {
  if (chuanHoa(cauHoi) === '') return null;

  const y = docYDinh(cauHoi);

  /** Một vế: biểu đồ trước, bảng thô sau — đúng thứ tự vốn có của hàm này. */
  const tinhVe = (hoi: string): TraLoi | null =>
    (nguon.bang === undefined ? null : tinhBang(nguon.bang, hoi, docYDinh(hoi))) ??
    (nguon.bangTho === undefined ? null : traLoiBangThoEp(nguon.bangTho, hoi));

  // Câu GHÉP xét trước câu đơn: với "cao nhất và thấp nhất" thì lượt đơn KHÔNG
  // trượt — nó trả về nửa câu, nên không có cách nào để nó nhường chỗ.
  const haiVe = tinhHaiVe(cauHoi, tinhVe);
  if (haiVe !== null) return haiVe;

  if (nguon.bang !== undefined) {
    const tinh = tinhBang(nguon.bang, cauHoi, y);
    if (tinh !== null) return tinh;
  }

  /*
   * Câu ĐẾM muốn một CON SỐ, nên chỉ chấm điểm trên những dữ kiện là số.
   *
   * Lỗi đo được: "có bao nhiêu báo cáo" trên trang chủ. Nhãn "Số báo cáo trong
   * HR" và nhãn "Báo cáo mở gần đây trong HR" trùng nhau đúng hai chữ "báo
   * cáo", nên chúng HOÀ điểm và luật "phải hơn hẳn ứng viên nhì" bỏ cả hai —
   * đúng luật, mà câu hỏi thì đơn giản nhất có thể.
   *
   * Lọc theo giá trị chứ không theo nhãn: "Báo cáo mở gần đây" có giá trị là
   * một chuỗi tên, còn "Số báo cáo" có giá trị là một con số. Đó là thứ phân
   * biệt chúng, và nó đọc được từ chính dữ liệu.
   */
  const tuBangTho = (): TraLoi | null =>
    nguon.bangTho === undefined ? null : traLoiBangThoEp(nguon.bangTho, cauHoi);

  /*
   * BẢNG THÔ đứng ĐÚNG CHỖ của `nguon.bang` ở trên, và vì đúng lý do đó.
   *
   * Lý do đã ghi ở khối trên: một câu hỏi mang ý định TÍNH TOÁN không bao giờ
   * được trả lời bằng một dữ kiện tra cứu, dù dữ kiện ấy trùng mấy từ.
   *
   * LỖI ĐO ĐƯỢC, giống hệt lỗi của nhánh biểu đồ: "tổng doanh thu là bao nhiêu"
   * trên trang chi tiết một bộ dữ liệu được trả lời bằng "Kiểu dữ liệu của cột
   * Doanh thu: decimal(18,2)" — hai chữ "doanh", "thu" đủ cho nhãn đó về đích,
   * trong khi bảng ngay dưới cộng ra 590.
   *
   * ⚠️ TRỪ ý định ĐẾM, và ngoại lệ đó bắt buộc: "Orders có bao nhiêu dòng" phải
   * ra `rowCount` của cả bộ (51.290), không phải số dòng của bảng xem trước (5).
   * Sai cả nghìn lần, bằng một con số có thật, không dấu hiệu nào trên màn hình.
   * Nên ở nhánh đếm, dữ kiện ĐÃ KHAI là số được hỏi trước.
   */
  // Câu nhắc một thứ không tồn tại thì BỎ hẳn nhánh so nhãn — xem `nhacThuLa`.
  const laLa = biet !== undefined && nhacThuLa(cauHoi, biet);

  /*
   * ⚠️ Lọc "chỉ dữ kiện là số" là một CỜ, không phải một phép xén danh sách.
   *
   * Bản cũ cắt `nguon.duKien` xuống còn mấy dữ kiện số rồi mới đưa cho `traCuu`.
   * Với một câu hỏi MỘT Ý thì không khác gì; với câu GHÉP thì nó vứt luôn vế
   * kia trước khi có ai kịp đọc:
   *
   *   "… chứa bao nhiêu biểu đồ và được TẠO BỞI AI"      → "Người tạo …" là chữ
   *   "… bao nhiêu dòng, bao nhiêu cột và CẬP NHẬT LÚC NÀO" → ngày tháng là chữ
   *
   * Cả hai đều là ảnh chụp từ buổi thử trên máy thật. Đưa cờ xuống `traCuu` thì
   * vế chính vẫn phải là số — giữ nguyên lý do đã ghi ở khối trên — còn vế ghép
   * thì tìm trên cả danh sách, và nó vẫn phải trả lời cho một chữ RIÊNG trong câu
   * hỏi. Nhờ chốt chữ riêng ấy mà "có bao nhiêu báo cáo" vẫn KHÔNG kèm thêm
   * "Báo cáo mở gần đây trong HR": nhãn ấy không khớp chữ nào mà nhãn thắng
   * chưa khớp — đúng ca đã làm khối trên ra đời.
   */
  if (y === 'dem' && !laLa) {
    const kq = traCuu(nguon.duKien, cauHoi, nguon.duKien, true, phuToiThieu, daGoiTen);
    if (kq !== null) return kq;
  }

  /*
   * Thực thể LẠ chặn luôn nhánh bảng thô — tiền đề cũ đã hết đúng.
   *
   * Chốt `nhacThuLa` trước đây cố ý chỉ chặn nhánh tra cứu, với lý do ghi rõ:
   * "`bangTho` đã đòi một bằng chứng cụ thể (một cột so được, một giá trị
   * khớp)". Tiền đề đó đúng chừng nào bảng thô còn là bảng SỐ LIỆU, nơi tên
   * cột là tên trường của khách hàng.
   *
   * Nó hết đúng từ lúc trang Kho dữ liệu khai chính danh sách của nó thành
   * bảng: cột ở đó tên là "Tên", "Cột", "Dòng" — những chữ có mặt trong gần
   * như mọi câu hỏi. Đo được: "bộ dữ liệu Invoices có bao nhiêu dòng" (không
   * có bộ nào tên Invoices) khớp cột "Dòng" rồi trả về "Có 4 Tên trên bảng
   * này" — một con số thật cho một thứ không tồn tại.
   */
  const tuBang = laLa && !bangNhacToi(nguon.bangTho, cauHoi) ? null : tuBangTho();
  if (tuBang !== null) return tuBang;

  return laLa ? null : traCuu(nguon.duKien, cauHoi, nguon.duKien, false, phuToiThieu, daGoiTen);
}

/* ═══ So GIỮA các mục của một danh sách ═════════════════════════════════════
 *
 * `traLoi` ở trên trả lời về MỘT nguồn. Nhưng câu hay được hỏi nhất trên một
 * trang danh sách lại là câu hỏi về cả danh sách: "mô hình nào được dùng nhiều
 * nhất", "mô hình nào chưa nối quan hệ", "kết nối nào nhiều bộ dữ liệu nhất".
 * Chọn một chip rồi hỏi câu đó thì không bao giờ ra, vì câu trả lời nằm ở việc
 * so chip này với mọi chip còn lại.
 *
 * ═══ Vì sao KHÔNG viết riêng cho từng trang ════════════════════════════════
 *
 * Mọi hàm trong `duKienTrang.ts` đã sinh ra cùng một hình dạng: mỗi mục là một
 * `Nguon`, và nhãn dữ kiện của nó LUÔN nhắc tên mục đó ("Số quan hệ của mô hình
 * Global-Superstore"). Bỏ tên mục ra khỏi nhãn thì còn lại tên THUỘC TÍNH, và
 * thuộc tính nào xuất hiện ở từ hai mục trở lên là một cột so được.
 *
 * Nhờ vậy chỗ này không biết gì về mô hình dữ liệu, kết nối hay tổ chức — và
 * mỗi hàm thêm vào `duKienTrang.ts` sau này được tính năng này miễn phí, không
 * phải sửa gì ở đây.
 */

/*
 * Từ không mang nội dung — không được tính điểm ở `chamCot` và `goiYGan`.
 *
 * ⚠️ `trong` và `cua` nằm đây vì chúng là GIỚI TỪ: mọi nhãn dùng chúng đều dùng
 * như chất keo ngữ pháp ("Số cột CỦA Orders", "Số mục TRONG Bán hàng"), nên
 * chúng không phân biệt được hai nhãn nào với nhau. Một từ không phân biệt được
 * gì thì cho nó điểm là tạo ra nhiễu.
 *
 * LỖI ĐO ĐƯỢC, và nó cần đúng chữ `trong` này: "TRONG các bộ dữ liệu hiện có
 * thì bộ nào nhiều cột nhất" — chữ "trong" của phần mở đầu lịch sự khớp nhãn
 * "Số mục trong" và HOÀ 1–1 với chữ "cột" khớp nhãn "Số cột của". Luật hoà bỏ
 * cả hai, lượt chấm thứ hai (không bỏ cụm chỉ loại) để "dữ liệu" của cùng phần
 * mở đầu ấy thắng với 2 điểm, và câu trả lời là "Số mô hình dữ liệu dùng: 2"
 * thay vì "Số cột: 24". Đúng tên bộ, sai con số. Bỏ phần mở đầu đi thì câu y
 * hệt trả lời đúng.
 */
const TU_DEM = new Set([
  'nao',
  'la',
  'cua',
  'trong',
  'co',
  'duoc',
  'bi',
  'va',
  'thi',
  'ma',
  'hay',
  'mot',
  'cac',
  'nhung',
  'nay',
  'do',
  'nhat',
  'nhieu',
  'it',
  'lon',
  'nho',
  'max',
  'min',
  'chua',
  'khong',
  'may',
  'dang',
]);

const CUM_LOAI = ['mo hinh du lieu', 'bo du lieu', 'mo hinh', 'du lieu'];

const TU_HOI = new Set(['nao', 'gi', 'chua', 'may']);

/*
 * ⚠️ KHÔNG có `bao` và `nhieu` trong danh sách trên, dù "bao nhiêu" là từ để
 * hỏi điển hình nhất. Vì `chuanHoa('báo')` cũng ra `bao`: bỏ nó đi là xé đôi
 * chữ "báo cáo", và mọi nhãn về báo cáo mất một nửa điểm của chúng.
 *
 * Cũng không có `khong`: "không có quan hệ" dùng nó để phủ định, không để hỏi.
 */

function boCumLoai(q: string): string {
  let con = q;
  for (const c of CUM_LOAI) con = con.split(c).join(' ');
  return con;
}

function tuNoiDung(s: string, boLoai = true): Set<string> {
  const q = chuanHoa(s);
  return new Set(
    (boLoai ? boCumLoai(q) : q).split(' ').filter((t) => t.length > 1 && !TU_DEM.has(t)),
  );
}

/* ═══ THỰC THỂ LẠ: câu hỏi gọi tên một thứ KHÔNG TỒN TẠI ══════════════
 *
 * Hai ca SAI còn lại của bộ đánh giá cùng MỘT gốc, và gốc đó không nằm ở phép
 * chấm điểm:
 *
 *   "số báo cáo của sale"       -> "Số báo cáo trong HR: 7."
 *   "cột Sales kiểu dữ liệu gì" -> "Số mô hình dữ liệu dùng Orders: 2."
 *
 * Cả hai câu đều gọi đích danh một thứ ("sale", "cột Sales") mà khung KHÔNG có,
 * rồi mấy chữ chung chung còn lại đủ kéo một nhãn khác về đích. Bốn lần sửa trước
 * đây đều đi theo hướng SIẾT CHẤM ĐIỂM (luật hoà, tỉ lệ phủ câu, độ hiếm của
 * từ, bỏ cụm chỉ loại) và cả bốn đều đổi hai ca này lấy một ca đếm khác — vì
 * chúng đang chừa một triệu chứng ở sai chỗ.
 *
 * Cửa này khác hẳn: nó không hỏi "nhãn nào hợp nhất" mà hỏi "câu hỏi có nhắc
 * thứ gì khung chưa từng thấy không". Một chữ không có trong BẤT KỲ tên nguồn,
 * nhãn hay giá trị nào của cả trang lẫn cả tổ chức thì nó đang nói về một thứ
 * không tồn tại, và mọi câu trả lời cho nó đều là câu trả lời cho câu hỏi khác.
 *
 * ⚠️ Chỉ chặn nhánh TRA CỨU. `tinhBang`, `bangTho` và `soSanhNguon` đều đã đòi
 * một bằng chứng cụ thể (một cột so được, một giá trị khớp), nên chúng không có
 * kiểu hỏng này — thêm một cửa nữa vào đó chỉ làm mất câu trả lời đúng.
 */

const TU_BO_QUA = new Set<string>([
  ...TU_DEM,
  ...TU_HOI,
  ...TU_KHOA.flatMap((k) => k.tu).flatMap((t) => t.trim().split(' ')),
  /*
   * Từ chức năng TỪ BỐN KÝ TỰ trở lên — ngắn hơn thì cận độ dài bên dưới đã
   * lo, không cần kể ra. Giữ danh sách ở đúng mấy từ thật sự cần là cách nó
   * không lớn dần thành một bảng đồng nghĩa.
   */
  /*
   * Từ CHỨC NĂNG tiếng Anh — cùng vai với "trên"/"dưới" ở dưới, chỉ khác
   * ngôn ngữ. `nhacThuLa` coi mọi chữ từ bốn ký tự mà khung chưa từng thấy là tên
   * một thực thể không tồn tại, rồi bỏ hẳn câu trả lời.
   *
   * ĐO ĐƯỢC: "how many datasets are there" đã đọc đúng ý ĐẾM và đúng chữ "bộ
   * dữ liệu" sau khi qua bảng đồng nghĩa, rồi vẫn bế tắc — vì chữ "there".
   *
   * ⚠️ Chỉ chữ KHÔNG trùng một tiếng Việt nào sau khi bỏ dấu. "the" không có
   * ở đây (nó là "thể" bỏ dấu, và ba ký tự thì cận độ dài đã lo).
   */
  'there',
  'which',
  'what',
  'have',
  'does',
  'about',
  'tren',
  // `duoi` đi CẶP với `tren`: cả hai là nửa của một toán tử lọc ("trên 5000",
  // "dưới 5000"), và bỏ sót một nửa là nửa đó bị coi là tên lạ rồi mất đáp án.
  // ĐO ĐƯỢC: "trên 5000 dòng" chạy, "dưới 5000 dòng" bế tắc.
  'duoi',
  'trong',
  'theo',
  'cung',
  'giua',
  'truoc',
  'minh',
  // Động từ nói về việc HỎI, không nói về dữ liệu: "kiểm tra xem…", "giúp tôi…".
  'kiem',
  'giup',
  'muon',
]);

function tuDaBiet(tatCa: Nguon[]): Set<string> {
  const biet = new Set<string>();
  const nap = (chu: string): void => {
    for (const t of chuanHoa(chu).split(' ')) if (t !== '') biet.add(t);
  };
  for (const n of tatCa) {
    nap(n.ten);
    for (const d of n.duKien) {
      nap(d.nhan);
      nap(d.gia);
    }
    for (const c of n.bangTho?.cot ?? []) nap(c);
    for (const r of n.bang?.rows ?? []) {
      nap(r.label);
      if (r.series !== undefined) nap(r.series);
    }
    if (n.bang !== undefined) {
      nap(n.bang.dimensionLabel);
      nap(n.bang.measureLabel);
      nap(n.bang.seriesLabel ?? '');
    }
  }
  return biet;
}

function nhacThuLa(cauHoi: string, biet: Set<string>): boolean {
  return (
    chuanHoa(cauHoi)
      .split(' ')
      /*
       * ⚠️ CẬN BỐN KÝ TỰ. Tiếng Việt tách theo âm tiết, và gần như mọi từ chức
       * năng đều một âm tiết ngắn ("đã", "nó", "tra", "xem", "cho"). Kể hết chúng ra
       * là nuôi một danh sách dài mãi — và mỗi từ bỏ sót là một câu hỏi bình thường
       * bị từ chối oạn. LỖI ĐO ĐƯỢC: "kiểm TRA xem NÓ có bao nhiêu file excel"
       * mất câu trả lời vì đúng hai chữ "tra" và "nó".
       *
       * Cận độ dài làm việc đó mà không cần danh sách, và nó không nới lỏng cửa:
       * hai ca SAI đều gọi tên thực thể bằng từ dài ("sale", "sales"). Một tên riêng
       * ba ký tự lọt qua được — đánh đổi đã biết, và nó nghiêng về phía trả lời
       * được nhiều câu hơn thay vì từ chối nhiều câu hơn.
       */
      /*
       * ⚠️ Một chuỗi TOÀN SỐ là một con số, không phải tên một thực thể.
       *
       * LỖI ĐO ĐƯỢC, và nó im lặng: "bộ nào có hơn 5000 dòng" mất đáp án, vì
       * "5000" đúng 4 ký tự nên cận trên coi nó là tên một thứ không tồn tại
       * rồi bỏ cả câu trả lời. Còn "hơn 50.000 dòng" thì chạy — chỉ vì
       * `chuanHoa` xé dấu chấm thành khoảng trắng và để lại "50" với "000",
       * cả hai đều dưới cận.
       *
       * Nên MỌI câu lọc theo ngưỡng gõ số liền đều bế tắc: "trên 1000",
       * "hơn 2500", "dưới 9999" — đúng cách gõ tự nhiên hơn hẳn "50.000".
       *
       * Bỏ qua số KHÔNG nới cửa: hai ca SAI mà chốt này sinh ra để chặn đều
       * gọi tên thực thể bằng CHỮ ("sale", "sales"). Và số trong câu hỏi đã có
       * `docDieuKien` và `docSo` lo — chúng đọc nó như một ngưỡng, đúng việc.
       */
      .some((t) => t.length >= 4 && !/^\d+$/.test(t) && !TU_BO_QUA.has(t) && !biet.has(t))
  );
}

function boTenMuc(nhan: string, ten: string): string | null {
  // Console đặt tên workspace là "Tên (Tổ chức)" trong khi nhãn chỉ nhắc "Tên".
  for (const ung of [ten, ten.replace(/\s*\(.*\)\s*$/, '')]) {
    if (ung === '' || !nhan.includes(ung)) continue;
    // Bỏ tên mục ở cuối nhãn để lại một GIỚI TỪ lủng lẳng — "Trạng thái nạp vào
    // kho CỦA" — và tên cột ấy được in ra nguyên văn cho người dùng đọc.
    const con = nhan
      .replace(ung, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/ (của|trong|cho|từ|lấy từ)$/u, '');
    if (con !== '') return con;
  }
  return null;
}

function soVi(gia: string): number | null {
  const m = /^(-?\d[\d.]*)(?:,(\d+))?(?:\s*\D+)?$/.exec(gia.trim());
  if (m === null) return null;
  const nguyen = m[1] ?? '';
  return Number(`${nguyen.replace(/\./g, '')}.${m[2] ?? '0'}`);
}

function laTrong(d: DuKien | undefined): boolean {
  // `undefined` = `dk` đã bỏ hẳn dữ kiện vì giá trị rỗng. Đó chính là "chưa có".
  if (d === undefined) return true;
  const v = chuanHoa(d.gia);
  return v === '0' || v.startsWith('chua') || v.startsWith('khong');
}

interface Muc {
  i: number;
  ten: string;
}

interface Cot {
  nhan: string;
  gia: Map<number, DuKien>;
}

interface ThuocTinh extends Cot {
  muc: Muc[];
  cot: Cot[];
}

export function nhanDuyNhat(nguon: Nguon[]): string[] {
  const tong = new Map<string, number>();
  for (const n of nguon) tong.set(n.ten, (tong.get(n.ten) ?? 0) + 1);

  const dem = new Map<string, number>();
  return nguon.map((n) => {
    if ((tong.get(n.ten) ?? 0) < 2) return n.ten;
    const i = (dem.get(n.ten) ?? 0) + 1;
    dem.set(n.ten, i);
    return `${n.ten} (${String(i)})`;
  });
}

function gomThuocTinh(tatCa: Nguon[]): { cot: Cot[]; muc: Muc[] } {
  const nhom = new Map<string, Cot>();
  for (const [i, n] of tatCa.entries()) {
    for (const d of n.duKien) {
      const goc = boTenMuc(d.nhan, n.ten);
      if (goc === null) continue;
      const khoa = chuanHoa(goc);
      const g = nhom.get(khoa) ?? { nhan: goc, gia: new Map<number, DuKien>() };
      g.gia.set(i, d);
      nhom.set(khoa, g);
    }
  }

  const cot = [...nhom.values()].filter((g) => g.gia.size >= 2);
  const chiSo = new Set(cot.flatMap((g) => [...g.gia.keys()]));
  // Tên ĐÁNH SỐ, giống hệt chip — xem `nhanDuyNhat`.
  const nhan = nhanDuyNhat(tatCa);
  const muc: Muc[] = [...chiSo]
    .sort((a, b) => a - b)
    .flatMap((i) => {
      const ten = nhan[i];
      return ten === undefined ? [] : [{ i, ten }];
    });
  return { cot, muc };
}

function chamCot(soDuoc: Cot[], cauHoi: string, boLoai: boolean): Cot | null {
  // Bỏ ĐỐI XỨNG ở cả hai phía — bỏ một phía là tự tạo ra lệch điểm mới.
  const tuHoi = tuNoiDung(cauHoi, boLoai);
  const diem = soDuoc
    .map((g) => ({ g, diem: [...tuNoiDung(g.nhan, boLoai)].filter((t) => tuHoi.has(t)).length }))
    .sort((a, b) => b.diem - a.diem);

  const [nhat, nhi] = diem;
  if (nhat === undefined || nhat.diem === 0) return null;
  // Hoà nghĩa là câu hỏi chưa đủ rõ để biết nó hỏi cột nào. Chọn bừa một cột
  // sẽ cho ra một tên mục có thật, trả lời cho một câu hỏi khác.
  if (nhi !== undefined && nhi.diem === nhat.diem) return null;
  return nhat.g;
}

/** Mấy chữ của `CUM_LOAI`, tách lẻ — xem `coChuRieng`. */
const TU_LOAI = new Set(CUM_LOAI.flatMap((c) => c.split(' ')));

/**
 * Đường lùi phải trùng ít nhất MỘT chữ KHÔNG chỉ loại.
 *
 * ⚠️ Chỗ hở lớn nhất của hàm chấm cột, và nó đo được.
 *
 * Lượt chấm thứ hai bỏ `boCumLoai`, nên "bộ", "dữ liệu", "mô hình" lại được
 * tính điểm — mà đó đúng là mấy chữ KHÔNG phân biệt được cột nào với cột nào,
 * vì chúng có trong gần hết tên cột. Câu nào không khớp cột nào ở lượt một đều
 * rơi vào đây rồi khớp bừa một cột bằng đúng mấy chữ chỉ loại ấy:
 *
 *   "bộ nào chưa nạp vào kho"  → cột "Số BỘ DỮ LIỆU lấy từ kết nối"
 *                              → "1 mục chưa có: Postgres kho"
 *
 * Người ta hỏi bộ dữ liệu nào chưa nạp; khung đọc tên một KẾT NỐI. Hai chữ
 * "nạp" và "kho" — hai chữ duy nhất mang nội dung — không khớp gì cả.
 *
 * ⚠️ KHÔNG khoá hẳn đường lùi, dù đó là bản vá đầu tiên tui thử: bộ đánh giá đỏ
 * ngay một ca. "bao nhiêu BỘ DỮ LIỆU chưa có mô hình DÙNG" cần đúng đường lùi
 * này — ở lượt một, cột "Số mô hình dữ liệu dùng" và cột "Dung lượng" HOÀ nhau
 * ở đúng một chữ "dùng"/"dung", nên cả hai bị bỏ. Đường lùi gỡ hoà được vì nó
 * thấy thêm "mô hình dữ liệu".
 *
 * Nên chốt không hỏi "có được dùng đường lùi không" mà hỏi "cột thắng có trùng
 * chữ nào THẬT SỰ phân biệt không": ca ratchet trùng cả "dùng", ca SAI chỉ trùng
 * mỗi "bộ".
 *
 * ⚠️ Chốt này gánh LUÔN cả một ca thứ hai, và đó là lý do nó được giữ lại thay
 * cho một danh sách từ:
 *
 *   "bộ dữ liệu nào CŨ nhất" → "Thấp nhất là People — Số mô hình dùng: 0"
 *
 * "cũ nhất" so THỜI GIAN, mà hàm này chỉ so được số — `soVi` không đọc nổi
 * "20/01/2026". Bản vá đầu tiên tui thử là một danh sách từ chỉ thời gian; nó
 * chạy, nhưng phép đột biến cho thấy nó THỪA — chữ "cũ" không khớp cột nào, nên
 * ca ấy rơi vào đúng đường lùi này và chốt ở đây đã chặn. Một chốt nói về CHẤT
 * LƯỢNG BẰNG CHỨNG che được cả những câu chưa ai nghĩ tới; một danh sách từ chỉ
 * che đúng mấy chữ có trong danh sách.
 */
function coChuRieng(g: Cot | null, cauHoi: string): Cot | null {
  if (g === null) return null;
  const tuHoi = tuNoiDung(cauHoi, false);
  const khop = [...tuNoiDung(g.nhan, false)].filter((t) => tuHoi.has(t));
  return khop.some((t) => !TU_LOAI.has(t)) ? g : null;
}

function chonThuocTinh(tatCa: Nguon[], cauHoi: string): ThuocTinh | null {
  const { cot: soDuoc, muc } = gomThuocTinh(tatCa);
  if (muc.length < 2) return null;

  const g = chamCot(soDuoc, cauHoi, true) ?? coChuRieng(chamCot(soDuoc, cauHoi, false), cauHoi);
  return g === null ? null : { ...g, muc, cot: soDuoc };
}

export function soSanhNguon(
  tatCa: Nguon[],
  cauHoi: string,
  pham = 'đang hiện trên trang này',
): TraLoi | null {
  const q = chuanHoa(cauHoi);
  const y = docYDinh(cauHoi);
  if (y !== 'cao_nhat' && y !== 'thap_nhat' && y !== 'chua_co') return null;

  /*
   * Hai cách hỏi cùng MỘT phép tính — "mục NÀO …" và "BAO NHIÊU mục …".
   *
   * Cửa "nào" là cửa duy nhất từ đầu, và nó bỏ sót hẳn một nửa số câu: người
   * dùng hỏi "bao nhiêu datamodel chưa kết nối quan hệ" thì họ muốn đúng con số
   * mà nhánh `chua_co` ngay dưới đã đếm xong, chỉ khác mỗi chữ để hỏi.
   *
   * LỖI ĐO ĐƯỢC, dựng từ ảnh chụp màn hình: câu ấy trượt hết mọi nhánh rồi
   * rơi xuống `traCuu`, và ở đó nhãn "Tên các mô hình đang hiện" thắng 3-2 nhờ
   * ba chữ "mô", "hình", "các" — nên câu trả lời là danh sách TÊN của cả ba mô
   * hình, một danh sách có thật cho một câu hỏi khác.
   *
   * ⚠️ Chỉ mở cho `chua_co`. "Bao nhiêu mô hình nhiều bảng nhất" không phải một
   * câu hỏi — đỉnh thì chỉ có một — nên hai ý định kia giữ nguyên cửa cũ.
   */
  const tu = q.split(' ');
  const demDuoc = y === 'chua_co' && (q.includes('bao nhieu') || tu.includes('may'));
  if (!tu.includes('nao') && !demDuoc) return null;

  const tt = chonThuocTinh(tatCa, cauHoi);
  if (tt === null) return null;

  /*
   * Luôn nói ra là so trên bao nhiêu mục — không có ngoại lệ.
   *
   * Danh sách nào cũng phân trang, nên "cao nhất" ở đây là cao nhất CỦA TRANG
   * ĐANG MỞ. Bỏ vế này đi thì câu trả lời đọc thành "cao nhất toàn workspace",
   * và nó sai mà không có dấu hiệu nào — đúng kiểu sai mà `luuYCat` tồn tại để
   * chặn ở nhánh biểu đồ.
   */
  const soMuc = String(tt.muc.length);
  const tren = `so trên ${soMuc} mục ${pham}`;

  if (y === 'chua_co') {
    /*
     * CHỈ ĐẾM MỤC CÙNG LOẠI — mục có chung ít nhất một cột với những mục ĐÃ
     * khai thuộc tính này.
     *
     * `laTrong(undefined)` coi "không khai thuộc tính" là "chưa có", và điều đó ĐÚNG
     * với một danh sách đồng nhất: mô hình nào cũng khai "Số quan hệ", nên cái
     * không khai là cái bằng 0. Nhưng danh sách ở đây KHÔNG còn đồng nhất: trang
     * Kho dữ liệu có thêm nguồn THƯ MỤC, và danh sách xuyên hệ thống trộn cả bộ dữ
     * liệu, mô hình, kết nối lẫn báo cáo.
     *
     * LỖI ĐO ĐƯỢC: "bao nhiêu bộ dữ liệu chưa có mô hình dùng" trả về "4 mục:
     * People, Thư mục Chung, Thư mục Bán hàng, Thư mục Thử nghiệm" — ba thư mục
     * đúng là không có mô hình nào dùng, và câu đó vô nghĩa.
     *
     * ⚠️ Lỗi này CÓ SẴN trước khi thêm thư mục — danh sách xuyên hệ thống đã trộn
     * bốn loại từ lâu. Thư mục chỉ là thứ phơi nó ra.
     */
    const cotCua = (i: number): string[] =>
      tt.cot.filter((g) => g.gia.has(i)).map((g) => chuanHoa(g.nhan));
    const ho = new Set([...tt.gia.keys()].flatMap(cotCua));
    const cungHo = (i: number): boolean => cotCua(i).some((c) => ho.has(c));

    const thieu = tt.muc.filter((m) => cungHo(m.i) && laTrong(tt.gia.get(m.i)));
    if (thieu.length === 0) {
      /*
       * ⚠️ "Không mục nào chưa có X" chỉ là một câu trả lời khi X ĐẾM ĐƯỢC.
       *
       * Nhánh này đọc "chưa có" là DỮ KIỆN VẮNG hoặc BẰNG 0 — đúng với "Số quan
       * hệ", nơi 0 nghĩa là chưa nối. Với một cột CHỮ mô tả trạng thái thì mọi
       * mục đều có một giá trị nào đó, nên câu trả lời luôn là "không mục nào" —
       * và nó đọc ra như một lời khẳng định về chuyện người ta vừa hỏi.
       *
       * ĐO ĐƯỢC: "bộ nào chưa nạp vào kho" → "Không mục nào — cả 6 mục đều có
       * Trạng thái nạp vào kho". Sáu bộ đều CÓ một trạng thái, nhưng câu hỏi là
       * trạng thái ấy NÓI GÌ — và lọc theo giá trị là tính năng chưa có.
       */
      if (![...tt.gia.values()].some((d) => soVi(d.gia) !== null)) return null;
      return {
        cau: `Không mục nào — cả ${soMuc} mục ${pham} đều có "${tt.nhan}".`,
        so: [soMuc],
        rong: true,
      };
    }
    return {
      cau: `${String(thieu.length)} mục chưa có "${tt.nhan}": ${thieu.map((m) => m.ten).join(', ')} — ${tren}.`,
      so: [String(thieu.length)],
    };
  }

  const coSo = tt.muc.flatMap((m) => {
    const d = tt.gia.get(m.i);
    const v = d === undefined ? null : soVi(d.gia);
    return v === null || d === undefined ? [] : [{ ten: m.ten, v, gia: d.gia }];
  });
  // Dưới hai mục có số thì không có gì để so — ví dụ hỏi "cao nhất" về một cột
  // toàn chữ. Thà nói chưa hiểu còn hơn sắp chữ theo bảng chữ cái rồi gọi đó là
  // cao nhất.
  if (coSo.length < 2) return null;

  const lon = y === 'cao_nhat';
  const dinh = coSo.reduce((a, b) => (lon ? (b.v > a.v ? b : a) : b.v < a.v ? b : a));
  // Bằng điểm thì gọi tên hết. Nêu một cái là ngầm bảo những cái kia thấp hơn.
  const cung = coSo.filter((x) => x.v === dinh.v);
  return {
    cau:
      cung.length === coSo.length
        ? // Mọi mục bằng nhau thì không có cái nào "cao nhất" cả. Đọc tên cả
          // danh sách ra rồi gọi đó là đỉnh là câu trả lời vô nghĩa dài nhất.
          `Cả ${String(coSo.length)} mục đều bằng nhau ở "${tt.nhan}": ${dinh.gia} — ${tren}.`
        : `${lon ? 'Cao nhất' : 'Thấp nhất'} là ${noiTen(cung.map((x) => x.ten))} — "${tt.nhan}": ${dinh.gia} — ${tren}.`,
    so: [dinh.gia],
  };
}

function locNguon(
  tatCa: Nguon[],
  cauHoi: string,
  pham = 'đang hiện trên trang này',
): TraLoi | null {
  const { cot, muc } = gomThuocTinh(tatCa);
  if (muc.length < 2) return null;

  /*
   * ⚠️ MỘT PHÉP LỌC KHÔNG BAO GIỜ TRẢ LỜI ĐƯỢC CÂU HỊI TỈ LỆ.
   *
   * Hàm này trả về "N mục có X là v" — một câu `loc`. `ti_trong` và `so_sanh`
   * hỏi một CON SỐ tính trên cả danh sách, nên không dạng nào của câu trả lời
   * ở đây là đáp án của chúng. Trước bản này hàm không có cổng ý định nào:
   * hễ một giá trị của cột nằm trong câu hỏi là nó trả lời.
   *
   * BỐN ca SAI ĐO ĐƯỢC, cùng một gốc, trên trang Kết nối — nơi TÊN mục chứa
   * đúng GIÁ TRỊ của một dữ kiện:
   *
   *   "MySQL bán hàng chiếm bao nhiêu % bộ dữ liệu"
   *      → 1 mục có "Kết nối thuộc loại gì" là mysql: MySQL bán hàng
   *   "MySQL bán hàng so với Postgres kho về số bộ dữ liệu"
   *      → 1 mục có "Kết nối thuộc loại gì" là postgres: Postgres kho
   *
   * Cả hai ĐÚNG cho câu "kết nối nào là mysql", mà không ai hỏi. Chủ ý câu thứ
   * hai: nó gọi tên HAI mục, nên chốt "nhường cho tên" ở `traLoiTrang` không che
   * — cố ý, vì một câu gọi tên hai mục là câu SO SÁNH.
   *
   * ⚠️ ĐẶT Ở ĐÂY, không đặt ở nơi gọi. `nguonMoHo` cũng gọi hàm này để đo độ
   * nhập nhằng, và một lợt khớp không được phép trả lời thì cũng không được
   * phép tính là một nghĩa thứ hai. Một cổng, hai nơi gọi.
   */
  const y = docYDinh(cauHoi);
  if (y === 'ti_trong' || y === 'so_sanh') return null;

  const q = ` ${chuanHoa(cauHoi)} `;

  /*
   * Cột được nhận ra qua GIÁ TRỊ khớp, KHÔNG qua tên cột.
   *
   * Bản đầu dùng `chonThuocTinh` và nó hoà: "Loại biểu đồ của báo cáo" và "Báo
   * cáo có mấy biểu đồ" cùng trùng ba chữ với "liệt kê các báo cáo biểu đồ
   * cột" — vì chữ phân biệt chúng là "cột", mà "cột" chỉ có trong GIÁ TRỊ.
   *
   * Giá trị khớp vừa là bằng chứng nhận ra cột, vừa là điều kiện lọc. Một cột
   * mà không giá trị nào của nó được gõ ra thì không có gì để lọc theo.
   */
  /*
   * ⚠️ TÊN TỆP khớp ĐƯỢC CẢ KHI THIẾU ĐUÔI.
   *
   * Không ai gõ đuôi tệp ra khi hỏi: "những bộ nào lấy từ file Global-Superstore",
   * chứ không phải "… từ file global-superstore.xlsx". Mà phép khớp ở đây đòi
   * giá trị nằm NGUYÊN CỤM trong câu hỏi, nên cả nhóm câu "lọc theo tệp nguồn"
   * bế tắc — đo được, và đó là câu người dùng hỏi thật trong ảnh chụp
   * màn hình của buổi thử.
   *
   * ⚠️ CHỈ bỏ đuôi, không nới phép khớp. Vẫn phải trùng nguyên cụm, vẫn phải
   * từ năm ký tự. Cho khớp một PHẦN giá trị bất kỳ là mở đúng cái cửa mà cả
   * khối chú thích trên nói là nguy hiểm — ở đây chỉ có đuôi tệp là thứ người
   * ta có lý do để không gõ.
   */
  const boDuoi = (v: string): string => v.replace(/\.(xlsx|xlsm|xls|csv|tsv|json)$/i, '');

  const ungVien = cot.flatMap((g) =>
    [...new Set([...g.gia.values()].map((d) => d.gia))]
      .filter((v) =>
        [v, boDuoi(v)].some((ung) => {
          const c = chuanHoa(ung);
          return c.length >= 5 && q.includes(` ${c} `);
        }),
      )
      .map((v) => ({ g, v })),
  );

  // Giá trị DÀI NHẤT thắng, cùng luật đã ghi ở `timDong`: "Biểu đồ cột" và
  // "Biểu đồ cột chồng" cùng nằm trong câu hỏi về cái thứ hai.
  ungVien.sort((a, b) => b.v.length - a.v.length);
  const chon = ungVien[0];
  if (chon === undefined) return null;

  const { g: tt, v: gia } = chon;
  const hop = muc.filter((m) => tt.gia.get(m.i)?.gia === gia);
  if (hop.length === 0) return null;

  const hien = hop.slice(0, 20);
  const con = hop.length - hien.length;
  return {
    cau:
      `${String(hop.length)} mục có "${tt.nhan}" là ${gia}: ` +
      `${hien.map((m) => m.ten).join(', ')}` +
      `${con > 0 ? `, … và ${String(con)} mục nữa` : ''} — ` +
      `so trên ${String(muc.length)} mục ${pham}.`,
    so: [String(hop.length)],
  };
}

function noiTen(ten: string[]): string {
  const cuoi = ten[ten.length - 1] ?? '';
  return ten.length < 2 ? cuoi : `${ten.slice(0, -1).join(', ')} và ${cuoi}`;
}

export function duKienPhang(tatCa: Nguon[], chon: Nguon): DuKien[] {
  const theoNhan = new Map<string, DuKien>();
  for (const n of [chon, ...tatCa.filter((x) => x !== chon)]) {
    for (const d of n.duKien) {
      if (!theoNhan.has(d.nhan)) theoNhan.set(d.nhan, d);
    }
  }
  return [...theoNhan.values()];
}

export function traLoiTheoDuKien(d: DuKien): TraLoi {
  return { cau: ghep(`${d.nhan}: ${d.gia}.`, d.luuY ?? null), so: [d.gia] };
}

export function goiYGan(tatCa: Nguon[], chon: Nguon, cauHoi: string): string[] {
  const tuHoi = tuNoiDung(cauHoi);
  if (tuHoi.size === 0) return [];

  const diem = luaChonTrang(tatCa, chon, cauHoi)
    .map((lc) => ({ lc, diem: [...tuNoiDung(lc.nhan)].filter((t) => tuHoi.has(t)).length }))
    .filter((x) => x.diem > 0)
    .sort((a, b) => b.diem - a.diem);

  return diem.slice(0, 3).map((x) => `${x.lc.nhan}?`);
}

export function goiYSoSanh(tatCa: Nguon[], tran = 2): string[] {
  const { cot, muc } = gomThuocTinh(tatCa);
  if (muc.length < 2) return [];
  // Chỉ gợi ý cột SO ĐƯỢC bằng phép so số. Gợi ý "cao nhất" trên một cột toàn
  // chữ là dạy người dùng hỏi một câu chắc chắn nhận về "tôi chưa hiểu".
  return cot
    .filter((g) => [...g.gia.values()].filter((d) => soVi(d.gia) !== null).length >= 2)
    .slice(0, tran)
    .map((g) => `Mục nào có "${g.nhan}" cao nhất?`);
}

function nguonTheoTen(tatCa: Nguon[], cauHoi: string): Nguon | null {
  const q = chuanHoa(cauHoi);
  /*
   * ⚠️ Thử CẢ tên đã bỏ phần trong ngoặc ở cuối.
   *
   * Console đặt tên workspace là "Phân tích (Công ty ABC)" để hai workspace
   * trùng tên ở hai tổ chức còn phân biệt được. Người dùng thì gõ "workspace
   * Phân tích thuộc tổ chức nào" — không ai gõ lại cái ngoặc.
   *
   * LỖI ĐO ĐƯỢC: cả hai câu về workspace trong console đều trượt, trong khi
   * đáp án nằm ngay trong nguồn mang đúng cái tên ấy. `boTenMuc` đã phải xử lý
   * đúng cái ngoặc này cho phía NHÃN; thiếu nó ở phía TÊN NGUỒN là để nửa
   * đường.
   */
  return (
    [...tatCa].sort((a, b) => b.ten.length - a.ten.length).find((n) => khopTen(n.ten, q)) ?? null
  );
}

function khopTen(ten: string, q: string): boolean {
  return [ten, ten.replace(/\s*\(.*\)\s*$/, '')].some((ung) => {
    const c = chuanHoa(ung);
    return c !== '' && q.includes(c);
  });
}

function soMucGoiTen(tatCa: Nguon[], cauHoi: string): number {
  const q = chuanHoa(cauHoi);
  const ten = [
    ...new Set(
      tatCa
        .filter((n) => khopTen(n.ten, q))
        .map((n) => chuanHoa(n.ten.replace(/\s*\(.*\)\s*$/, ''))),
    ),
  ];
  return ten.filter((t) => !ten.some((k) => k !== t && k.includes(t))).length;
}

export function traLoiTrang(tatCa: Nguon[], chon: Nguon, cauHoi: string): TraLoi | null {
  const goiTen = nguonTheoTen(tatCa, cauHoi);
  // Dựng MỘT lần cho cả danh sách — xem `tuDaBiet` và `nhacThuLa`.
  const biet = tuDaBiet(tatCa);

  /*
   * ═══ Gọi tên một mục ra là ĐÓNG cửa mọi lớp so-cả-danh-sách ══════════════
   *
   * HAI ca SAI đo được trên trang Kết nối, cùng một gốc:
   *
   *   "kết nối MySQL bán hàng kiểm tra lần cuối lúc nào"
   *   "tài khoản đăng nhập của kết nối MySQL bán hàng là gì"
   *
   * Cả hai nhận về `1 mục có "Kết nối thuộc loại gì" là mysql: MySQL bán hàng`
   * — một câu trả lời ĐÚNG cho câu hỏi "kết nối nào là mysql", mà không ai hỏi.
   * Chữ "mysql" vừa là GIÁ TRỊ của một dữ kiện, vừa nằm trong TÊN của mục; nên
   * `soSanhNguon` nhận ra nó và chặn mất ngay ở cửa đầu tiên.
   *
   * Thứ tự cũ đã ghi đúng luật "nhường cho tên" nhưng chỉ áp cho `locNguon`.
   * `soSanhNguon` đứng trước cả nó, nên luật ấy không tới nơi.
   *
   * Và nhường thôi chưa đủ: ca thứ hai cho thấy mục được gọi tên có thể KHÔNG
   * có đáp án (ở đây là cố ý — thông tin đăng nhập không được khai). Rơi tiếp
   * xuống mấy lớp dưới thì nó lại trả về danh sách. Người dùng gõ tên một mục
   * ra là đã nói rõ họ hỏi mục nào; không có đáp án thì câu đúng là "chưa
   * hiểu", không phải một câu đúng về một câu hỏi khác.
   *
   * ⚠️ Chỉ khi câu gọi tên ĐÚNG MỘT mục. Gọi tên hai mục là một câu SO SÁNH —
   * "bảng nào nhiều lỗi nhất, Đơn hàng hay Khách hàng" — và trả lời nó bằng
   * dữ kiện của mục đầu tiên là đúng cái lỗi `soSanhNguon` sinh ra để chặn.
   * Câu về cả danh sách không gọi tên ai ("mô hình nào chưa nối quan hệ") thì
   * `goiTen` là `null`, và hai lớp dưới vẫn chạy nguyên.
   */
  /*
   * ⚠️ KHÔNG truyền `biet` xuống nhánh này — cố ý, và nó sửa một ca trượt.
   *
   * `nhacThuLa` coi mọi chữ TỪ BỐN KÝ TỰ mà khung chưa từng thấy là tên một
   * thực thể không tồn tại, rồi bỏ hẳn phép so nhãn. Luật ấy đúng cho câu
   * KHÔNG gọi tên ai ("số báo cáo của sale"), nhưng ở đây câu hỏi vừa gọi
   * đúng tên một mục có thật trên trang — nên mấy chữ còn lại là chữ bổ nghĩa,
   * không phải một cái tên.
   *
   * LỖI ĐO ĐƯỢC: "Lê Minh đăng nhập lần cuối lúc nào" bị từ chối vì đúng chữ
   * "cuối" chưa từng xuất hiện trong nhãn nào của trang. Vá bằng cách nhét
   * "cuoi" vào `TU_BO_QUA` là nuôi đúng cái danh sách mà khối chú thích ở đó
   * đã cảnh báo; chốt này gỡ cả lớp ca ấy một lần.
   */
  /*
   * ⚠️ TRỪ hai ý định vốn hỏi về CẢ DANH SÁCH, dù câu có gọi tên một mục.
   *
   * "Bán hàng chiếm bao nhiêu % số bảng" gọi tên đúng một mục, nên chốt này
   * đưa nó cho `traLoi` của riêng mục ấy — mà một mục đứng một mình không có
   * mẫu số nào để chia, nên nó trả về "Số bảng trong mô hình Bán hàng: 3".
   * Một con số có thật, cho một câu hỏi về TỈ LỆ. Đo được.
   *
   * `ti_trong` và `so_sanh` theo định nghĩa cần nhiều hơn một mục. Nhường cho
   * tên là đúng với câu TRA CỨU — lý do đã ghi ở khối trên — nhưng với hai ý
   * định này thì cái tên nói "lấy mục nào làm tử số", không nói "chỉ đọc mục
   * này". Bỏ qua chốt ở đây là để chúng xuống tới bảng thô của bản tóm tắt,
   * nơi `tinhBang` tính tỉ lệ trên cả danh sách.
   */
  const yCauHoi = docYDinh(cauHoi);
  const caDanhSach = yCauHoi === 'ti_trong' || yCauHoi === 'so_sanh';
  if (!caDanhSach && goiTen !== null && soMucGoiTen(tatCa, cauHoi) === 1) {
    return traLoi(goiTen, cauHoi, undefined, 0, true);
  }

  // Xem `TraLoi.rong`: câu "không mục nào" xuống cuối hàng, không bị bỏ.
  const soSanh = soSanhNguon(tatCa, cauHoi);
  return (
    (soSanh?.rong === true ? null : soSanh) ??
    /*
     * `locNguon` nhận ra cột qua một GIÁ TRỊ nằm trong câu hỏi — cùng cơ chế,
     * và cùng rủi ro, với `soSanhNguon`. Chốt `goiTen` ở trên đã che cả hai:
     * tới được đây nghĩa là câu hỏi không gọi tên mục nào.
     */
    locNguon(tatCa, cauHoi) ??
    traLoi(chon, cauHoi, biet) ??
    soSanh
  );
}

export function nguonMoHo(tatCa: Nguon[], cauHoi: string): number[] | null {
  if (soSanhNguon(tatCa, cauHoi) !== null) return null;
  if (nguonTheoTen(tatCa, cauHoi) !== null) return null;
  if (locNguon(tatCa, cauHoi) !== null) return null;

  const biet = tuDaBiet(tatCa);
  const dap = tatCa.map((n) => traLoi(n, cauHoi, biet));
  const duoc = dap.flatMap((d, i) => (d === null ? [] : [i]));

  /*
   * MỘT phép đếm lo cả ba việc, nên không có ba câu `if` nào để lệch nhau: ít
   * hơn hai câu trả lời KHÁC NHAU thì không có gì để người dùng chọn — dù vì
   * trang chỉ có một nguồn, vì chỉ một nguồn trả lời được, hay vì mọi nguồn
   * cùng nói một câu.
   */
  return new Set(duoc.map((i) => dap[i]?.cau)).size < 2 ? null : duoc;
}

/* ═══ Danh sách LỰA CHỌN: mọi thứ trang này trả lời được ════════════════════
 *
 * ═══ Vì sao gom tra cứu và tính toán vào MỘT danh sách ═════════════════════
 *
 * Lớp hiểu câu hỏi (`services/chat/hieuY.ts`) cho mô hình đúng một việc: chọn
 * một mục trong danh sách đánh số. Danh sách đó trước đây chỉ có dữ kiện tra
 * cứu, nên mô hình không bao giờ chọn được một PHÉP TÍNH — và "liệt kê sản
 * phẩm có số lượng là 4" nhận về "tôi chưa hiểu" ngay cạnh một biểu đồ có sẵn
 * câu trả lời.
 *
 * Gom cả hai vào một danh sách giữ nguyên cơ chế: vẫn một chỉ số, vẫn một luật
 * kiểm, không thêm JSON nào để phân tích, không thêm chỗ nào để bịa. Mô hình
 * chỉ chọn được thứ chỗ này đã dựng sẵn và đã biết cách chạy.
 *
 * ═══ Mỗi lựa chọn tự biết cách chạy chính nó ═══════════════════════════════
 *
 * `chay()` là một closure đóng gói sẵn nguồn, ý định và chiều cần gộp. Nhờ vậy
 * nơi gọi chỉ cần `luaChon[i].chay()` — không có bảng tra "chỉ số này ứng với
 * phép nào" để lệch với danh sách nhãn đã gửi đi.
 *
 * ═══ Cùng danh sách này dùng cho GỢI Ý ═════════════════════════════════════
 *
 * Bong bóng "chưa hiểu" gợi ý mấy mục gần nhất, và màn chào gợi ý mấy mục đầu.
 * Dùng chung một nguồn nghĩa là bấm một gợi ý thì chắc chắn có câu trả lời —
 * nhãn gợi ý chính là nhãn mà phép so từ khoá sẽ khớp lại.
 */

export interface LuaChon {
  nhan: string;
  chay: () => TraLoi | null;
}

function phepCuaBieuDo(nguon: Nguon, cauHoi: string): LuaChon[] {
  const bang = nguon.bang;
  if (bang === undefined) return [];

  const { dimensionLabel: truc, measureLabel: thuoc, seriesLabel: chuoi } = bang;
  const ds: LuaChon[] = [];

  const them = (nhan: string, y: YDinh, chieu: 'label' | 'series' | null): void => {
    ds.push({ nhan, chay: () => tinhBang(bang, cauHoi, y, chieu) });
  };

  // Hai chiều thì mỗi chiều là một câu hỏi khác hẳn — xem `chieuHoi`.
  const chieu: ['label' | 'series', string][] =
    chuoi === undefined
      ? [['label', truc]]
      : [
          ['label', truc],
          ['series', chuoi],
        ];

  for (const [c, ten] of chieu) {
    them(`${ten} nào có ${thuoc} cao nhất`, 'cao_nhat', c);
    them(`${ten} nào có ${thuoc} thấp nhất`, 'thap_nhat', c);
    them(`Xếp hạng ${ten} theo ${thuoc}`, 'top_n', c);
    them(`Liệt kê ${ten} theo ${thuoc} (lọc theo con số trong câu hỏi)`, 'loc', c);
    /*
     * Cùng ý định `loc`, nhưng ÉP câu hỏi rỗng — `docDieuKien('')` không tìm
     * thấy con số nào nên nhánh đó liệt kê hết. Nhãn nói "tất cả", và một nhãn
     * nói "tất cả" mà lại lọc theo một con số lạc trong câu hỏi thì nó nói sai
     * chính việc nó vừa làm.
     */
    ds.push({ nhan: `Liệt kê tất cả ${ten}`, chay: () => tinhBang(bang, '', 'loc', c) });
    them(`Có bao nhiêu ${ten}`, 'dem', c);
  }

  them(`Tổng ${thuoc}`, 'tong', null);
  them(`${thuoc} trung bình`, 'trung_binh', null);
  them(`${thuoc} đang tăng hay giảm`, 'xu_huong', null);

  return ds;
}

function phepCuaBangTho(nguon: Nguon): LuaChon[] {
  const bt = nguon.bangTho;
  if (bt === undefined || bt.dong.length === 0) return [];

  const doDuoc = cotDoDuoc(bt);
  const chu = bt.cot.flatMap((_, i) => (doDuoc.includes(i) ? [] : [i]));

  const hoi = (nhan: string): LuaChon => ({
    nhan,
    chay: () => traLoi({ ...nguon, duKien: [] }, nhan),
  });

  /*
   * CẮT NGẮN có chủ ý. Một bảng hai mươi cột sinh ra hàng trăm câu, và một danh
   * sách gợi ý dài hơn màn hình thì không còn là gợi ý nữa.
   */
  const ten = (i: number): string => bt.cot[i] ?? '';
  const nhan = chu.slice(0, 2);
  const do_ = doDuoc.slice(0, 2);

  return [
    ...do_.flatMap((d) => [
      ...nhan.map((n) => hoi(`${ten(n)} nào có ${ten(d)} cao nhất`)),
      hoi(`Tổng ${ten(d)}`),
    ]),
    ...nhan.map((n) => hoi(`Có bao nhiêu ${ten(n)}`)),
  ];
}

export function luaChonTrang(tatCa: Nguon[], chon: Nguon, cauHoi: string): LuaChon[] {
  const ds: LuaChon[] = [];
  const daCo = new Set<string>();

  for (const n of [chon, ...tatCa.filter((x) => x !== chon)]) {
    for (const lc of [...phepCuaBieuDo(n, cauHoi), ...phepCuaBangTho(n)]) {
      if (daCo.has(lc.nhan)) continue;
      daCo.add(lc.nhan);
      ds.push(lc);
    }
    for (const d of n.duKien) {
      if (daCo.has(d.nhan)) continue;
      daCo.add(d.nhan);
      ds.push({ nhan: d.nhan, chay: () => traLoiTheoDuKien(d) });
    }
  }
  return ds;
}

function tuNhacDuLieu(tatCa: Nguon[], cauHoi: string): boolean {
  const q = ` ${chuanHoa(cauHoi)} `;
  const co = (ten: string): boolean => {
    const c = chuanHoa(ten);
    return c !== '' && q.includes(` ${c} `);
  };

  return tatCa.some((n) => {
    if (co(n.ten)) return true;
    if (n.duKien.some((d) => co(d.gia))) return true;
    const b = n.bang;
    if (b === undefined) return false;
    return (
      co(b.dimensionLabel) ||
      co(b.measureLabel) ||
      co(b.seriesLabel ?? '') ||
      b.rows.some((r) => co(r.label) || co(r.series ?? ''))
    );
  });
}

/*
 * Câu hỏi NGUYÊN NHÂN và DỰ BÁO — khung không trả lời được, và phải nói thế.
 *
 * Khung đọc số liệu đang hiện trên trang. Nó không suy ra nguyên nhân và không
 * ngoại suy, nên mọi câu "vì sao / dự báo" đều ngoài tầm. Vấn đề là chúng
 * KHÔNG tự bế tắc: câu hỏi gọi tên một nhóm thì phép tra giá trị vẫn về đích.
 *
 *   "vì sao Acco bán ít"  →  "Quantity của Acco là 4."       (ĐO ĐƯỢC)
 *
 * Con số đúng, nhưng nó được đặt vào chỗ của một lời GIẢI THÍCH — người đọc hỏi
 * tại sao và nhận về một dữ kiện, rất dễ đọc thành "đó là lý do". Nói chưa hiểu
 * thì người ta hỏi lại được; đưa một con số thì không ai biết là đã trượt.
 *
 * ⚠️ Đặt ở CỬA của cả khung, không đặt trong từng nhánh. Năm lớp đều có đường
 * riêng tới một con số, và chốt này đúng với cả năm.
 */
const CUM_NGUYEN_NHAN = [
  'vi sao',
  'tai sao',
  'ly do',
  'nguyen nhan',
  'do dau',
  'du bao',
  'du doan',
];

export function traLoiKhung(
  tatCa: Nguon[],
  chon: Nguon,
  heThong: Nguon[],
  cauHoi: string,
  cauTruoc: string | null,
): TraLoi | null {
  const qKhung = ` ${chuanHoa(cauHoi)} `;
  if (CUM_NGUYEN_NHAN.some((c) => qKhung.includes(` ${c} `))) return null;

  /*
   * Một dữ kiện được GỌI ĐÍCH DANH thắng một phép đếm CHUNG CHUNG.
   *
   * Trật tự "trang trước, hệ thống sau" đúng với mọi câu trả lời có bằng
   * chứng — người ta đang nhìn trang này thì trang này ưu tiên. Nhưng câu đánh
   * dấu `chung` thì không có bằng chứng nào: nó đếm nhóm của chính bảng đang
   * xem mà không đọc câu hỏi. Để nó thắng là "có bao nhiêu thành viên" nhận
   * về số cột của biểu đồ.
   *
   * ⚠️ VẪN giữ làm đáp án cuối khi lớp xuyên hệ thống chiịu: "có bao nhiêu
   * sản phẩm" không khớp dự kiện hệ thống nào, và lúc đó số nhóm của biểu đồ
   * đúng là thứ người ta hỏi.
   */
  const motLuot = (hoi: string): TraLoi | null => {
    const tren = traLoiTrang(tatCa, chon, hoi);
    if (tren !== null && tren.chung !== true) return tren;
    return traLoiHeThong(heThong, hoi) ?? tren;
  };

  const mot = motLuot(cauHoi);
  if (cauTruoc === null) return mot;

  /*
   * Câu nối tiếp mà TỰ NÓ nhắc tới một thứ của dữ liệu thì tự nó đủ nghĩa.
   *
   * "Của Miền Nam là bao nhiêu" mở đầu bằng chữ nối tiếp, nhưng nó có chủ ngữ
   * riêng — nối lượt cũ vào là để lượt cũ bẻ lái một câu hỏi vốn đã rõ.
   *
   * "Vậy thấp nhất thì sao" thì ngược lại: nó không nhắc tới một chiều nào,
   * một giá trị nào, một mục nào. Nó TỰ NÓ trả lời được (bằng một ô trong cột
   * chồng), và đó mới là chỗ nguy: câu trả lời đúng số, mà nó bỏ qua hẳn ngữ
   * cảnh người dùng vừa dựng ra ở lượt trước.
   */
  /*
   * ⚠️ Chốt này KHÔNG có ca nào trong 126 câu phân biệt được — đã thử bằng đột
   * biến, gỡ nó ra thì bảng điểm không nhúc nhích. Giữ lại có chủ ý, vì nó nói
   * một luật KHÁC với chốt bên dưới, chỉ là hôm nay hai luật đồng ý với nhau:
   * ở đây là "câu tự đủ nghĩa thì trả lời bằng chính nó", còn dưới kia là "mấy
   * chữ mới phải đổi được câu trả lời". Một câu tự đủ nghĩa mà nối vào lại ra
   * đáp án khác sẽ trượt khỏi chốt dưới mà lọt qua chốt này — và khi đó bỏ
   * chốt này đi là để lượt trước bẻ lái một câu hỏi vốn đã rõ ràng.
   *
   * Nó cũng rẻ hơn hẳn: thoát sớm, không phải chạy thêm hai lượt tính.
   */
  if (mot !== null && tuNhacDuLieu(tatCa, cauHoi)) return mot;

  /*
   * Câu MỚI đứng TRƯỚC câu cũ.
   *
   * Luật chọn chiều lấy thứ được gọi tên SỚM NHẤT, nên đặt câu mới lên đầu là
   * cho nó quyền ưu tiên mà không cần thêm một tham số nào. Đặt câu cũ trước
   * thì "ở miền nào" hỏi tiếp sau "nhóm hàng nào cao nhất" vẫn trả lời về nhóm
   * hàng — đúng cái lỗi mà bộ nhớ sinh ra để sửa.
   */
  const noi = `${cauHoi} ${cauTruoc}`;
  const kq = motLuot(noi);
  // Nối vào cũng không ra gì thì rơi về câu trả lời không bộ nhớ.
  if (kq === null) return mot;

  /*
   * ═══ CHỐT: lượt mới phải ĐỔI ĐƯỢC câu trả lời ════════════════════════════
   *
   * Đây là thứ thay cho danh sách chữ mở đầu cũ ("còn", "vậy", "thế", "ở"…).
   *
   * Cái danh sách ấy hỏng theo hai chiều cùng lúc, và chiều thứ hai mới đắt:
   *
   *   - Bỏ sót. "nhóm hàng thì sao" y hệt "còn nhóm hàng thì sao", chỉ thiếu
   *     một chữ, và nó rơi thẳng xuống "chưa hiểu".
   *   - SAI. "thấp nhất thì sao" không có chữ mở đầu nên bộ nhớ không chạy,
   *     câu đó TỰ NÓ trả lời được bằng một Ô trong cột chồng, và khung đáp
   *     "Miền Bắc (Thời trang), 75" cho một câu hỏi về TỔNG của miền — 255.
   *     Một con số có thật, trả lời một câu khác. Đo được ở `danhGia.test.ts`.
   *
   * Phép thử mới không hỏi câu này MỞ ĐẦU bằng chữ gì, nó hỏi mấy chữ mới có
   * LÀM GÌ không: nối vào mà ra đúng câu trả lời của lượt trước thì lượt mới
   * chẳng đóng góp gì, và ta đang chuẩn bị đọc lại câu cũ cho một câu hỏi
   * chẳng liên quan. Đó đúng là đường mà "hôm nay trời thế nào" đi.
   *
   * Nó cũng là phép thử ĐÚNG VIỆC: thứ ta cần biết không phải "câu này có
   * dáng một lượt hỏi tiếp không" — thứ ta cần biết là "nối vào có sinh ra
   * một câu trả lời MỚI không". Hỏi thẳng cái cần biết thì không có danh sách
   * nào để bỏ sót.
   *
   * `cu === null` thì không có gì để so, và khi đó câu trả lời kia chỉ có thể
   * do hai vế GHÉP LẠI mà ra — nhận.
   */
  const cu = traLoiTrang(tatCa, chon, cauTruoc) ?? traLoiHeThong(heThong, cauTruoc);
  return cu?.cau === kq.cau ? mot : kq;
}

/* ═══ Trả lời XUYÊN HỆ THỐNG ════════════════════════════════════════════════
 *
 * Mọi thứ ở trên trả lời bằng dữ liệu của TRANG ĐANG MỞ. Nhưng câu hỏi tự
 * nhiên thì không quan tâm người hỏi đang đứng ở trang nào: "mô hình nào được
 * dùng nhiều nhất" hỏi từ giữa một báo cáo vẫn là một câu hỏi hợp lý, và bắt
 * người dùng đi tìm đúng trang trước khi được trả lời là bắt họ làm việc của
 * khung.
 *
 * ═══ Vì sao là một danh sách RIÊNG, không trộn vào `nguon` ═════════════════
 *
 * Vì câu trả lời phải nói ra nó đọc ở đâu. Trộn hai danh sách lại thì một con
 * số của workspace khác đọc ra y hệt một con số đang hiện trên màn hình — và
 * người dùng không còn cách nào kiểm lại, vì thứ để đối chiếu không ở trước
 * mắt. Nên: TRANG trước, HỆ THỐNG sau, và mọi câu trả lời từ danh sách này
 * luôn nói ra phạm vi của nó.
 *
 * Cùng lý do đó, chip chọn nguồn không có mục nào của hệ thống: chip trả lời
 * câu "cái này là cái nào trên màn hình", mà mấy nguồn này không ở trên màn
 * hình.
 *
 * ⚠️ QUY ƯỚC: nguồn ĐẦU TIÊN là bản tóm tắt (đếm tổng), các nguồn sau là từng
 * mục. Cùng quy ước mà `duKienTrang.ts` đã dùng cho mọi trang danh sách.
 */

const PHAM_HE_THONG = 'trong toàn bộ tổ chức';
const TRA_O_DAU = 'tra trên toàn bộ tổ chức, không phải trên trang đang mở';

function noiPham(kq: TraLoi): TraLoi {
  return { cau: ghep(kq.cau, TRA_O_DAU), so: kq.so };
}

export function moHinhTheoTen(tatCa: Nguon[], cauHoi: string): number | null {
  const q = chuanHoa(cauHoi);
  const hop = tatCa.filter(
    (n) => n.moHinhId !== undefined && n.ten !== '' && q.includes(chuanHoa(n.ten)),
  );
  if (hop.length === 0) return null;

  const dai = Math.max(...hop.map((n) => chuanHoa(n.ten).length));
  const nhat = hop.filter((n) => chuanHoa(n.ten).length === dai);
  const id = nhat[0]?.moHinhId ?? null;
  // Cùng một mô hình lặp lại trong danh sách thì không phải là nhập nhằng.
  return nhat.every((n) => n.moHinhId === id) ? id : null;
}

export function traLoiHeThong(heThong: Nguon[], cauHoi: string): TraLoi | null {
  const dau = heThong[0];
  if (dau === undefined) return null;

  const soSanh = soSanhNguon(heThong, cauHoi, PHAM_HE_THONG);
  if (soSanh !== null) return soSanh;

  const goiTen = nguonTheoTen(heThong, cauHoi);

  /*
   * Câu ĐẾM hỏi về CẢ DANH SÁCH, nên bản tóm tắt được xét một mình trước.
   *
   * Trên danh sách phẳng nó không bao giờ thắng được: nhãn "Số mô hình dữ liệu
   * trong toàn bộ tổ chức" và nhãn "Số mô hình dữ liệu dùng Orders" trùng nhau
   * tới BỐN từ, nên chúng hoà điểm và luật "phải hơn hẳn ứng viên nhì" bỏ cả
   * hai — đúng luật, nhưng câu hỏi đơn giản nhất của cả tính năng lại không
   * trả lời được.
   *
   * ⚠️ Chỉ khi câu hỏi KHÔNG gọi tên mục nào. "Mô hình Kho vận có mấy bảng"
   * cũng là ý định `dem`, nhưng nó hỏi về một mục — và bản tóm tắt vẫn khớp
   * được hai chữ "mô hình" của nó, nên bỏ cửa này là trả lời bằng tổng số mô
   * hình cho một câu hỏi về số BẢNG của một mô hình. Cùng luật nhường-cho-tên
   * mà `traLoiTrang` và nhánh `dem` của `tinhBang` đang dùng.
   */
  /*
   * `traLoi` chứ không phải `traCuu`: `traLoi` lọc trước về dữ kiện LÀ SỐ cho ý
   * định đếm. Thiếu phép lọc đó thì "có bao nhiêu báo cáo" hoà điểm giữa "Số
   * báo cáo trong HR" và "Báo cáo mở gần đây trong HR".
   *
   * ═══ BẢN TÓM TẮT TRẢ LỜI MỌI Ý ĐỊNH, không chỉ câu ĐẾM ══════════════
   *
   * Bản cũ chỉ mở cửa này cho `dem` và `chua_co`, nên mọi câu TRA CỨU xuyên
   * hệ thống đều bế tắc — "tổ chức đang dùng gói nào", "tên các workspace
   * tôi vào được" không đếm gì cả, nên chúng không có cửa nào. Không phải vì
   * thiếu dữ kiện: dữ kiện nằm sẵn trong bản tóm tắt, chỉ là không ai hỏi tới.
   *
   * Chốt `goiTen === null` mới là thứ giữ an toàn, và nó không đổi: câu gọi tên
   * một mục thì bản tóm tắt không được giành. Câu không gọi tên ai mà trùng từ
   * hai chữ với một nhãn tóm tắt thì đúng là đang hỏi về cả tổ chức.
   */
  /*
   * ⚠️ CÂU TRA CỨU xuyên hệ thống ĐÒI BẰNG CHỨNG MẠNH HƠN câu trên trang.
   *
   * Trên trang đang mở, trùng hai chữ là đủ — người ta nhìn thấy dữ liệu nên
   * họ gõ tắt được. Ở đây thì ngược: dữ kiện nằm ở trang KHÁC, người hỏi
   * không nhìn thấy nó, nên họ phải gọi nó ra tương đối đầy đủ.
   *
   * LỖI ĐO ĐƯỢC, do chính bản mở cửa này gây ra: "làm sao để xoá một bộ dữ
   * liệu" — một câu HƯỚNG DẪN, đáng ra phải từ chối — trùng ba chữ "bộ dữ
   * liệu" với nhãn "Số bộ dữ liệu trong toàn bộ tổ chức" rồi nhận về "12".
   * Ba chữ trên tám của nhãn — chưa tới một nửa. Còn "tổ chức đang dùng gói
   * nào" trùng đủ năm trên năm.
   *
   * ⚠️ KHÔNG áp cho câu ĐẾM. "có bao nhiêu thành viên" chỉ phủ hai trên năm
   * chữ của "Số thành viên của HR", và nó là câu đúng. Cửa đếm vốn đã mở từ
   * trước và không sinh ra ca SAI nào — chỉ cửa tra cứu mới cần siết.
   */
  const yHoi = docYDinh(cauHoi);
  const biet = tuDaBiet(heThong);
  if (goiTen === null) {
    const demDuoc = yHoi === 'dem' || yHoi === 'chua_co';
    const tom = traLoi(dau, cauHoi, biet, demDuoc ? 0 : 0.5);
    if (tom !== null) return noiPham(tom);
  }

  // Chỉ còn cửa "gọi thẳng tên mục" — xem khối chú thích trên.
  const kq = goiTen === null ? null : traLoi(goiTen, cauHoi, biet, 0, true);
  return kq === null ? null : noiPham(kq);
}

export function luaChonHeThong(heThong: Nguon[]): LuaChon[] {
  const tomTat = heThong[0];
  if (tomTat === undefined) return [];
  return [
    ...tomTat.duKien.map((d) => ({
      nhan: d.nhan,
      chay: (): TraLoi => noiPham(traLoiTheoDuKien(d)),
    })),
    ...goiYSoSanh(heThong, 8).map((nhan) => ({
      // Nhãn mang phạm vi, `chay` thì không: `soSanhNguon` chấm điểm câu hỏi
      // theo tên cột, và thêm chữ vào câu hỏi là thêm nhiễu vào phép chấm đó.
      nhan: `${nhan} (toàn bộ tổ chức)`,
      chay: (): TraLoi | null => traLoiHeThong(heThong, nhan),
    })),
  ];
}
