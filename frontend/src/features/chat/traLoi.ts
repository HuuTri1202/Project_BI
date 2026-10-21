import type { ReportDataDto } from '@bi/shared';

import { formatValue } from '../reports/nhanO';
import type { BangTho, DuKien, Nguon } from './nguCanh';

/**
 * Lõi trả lời — hàm thuần, không React, không mạng.
 *
 * ═══ Luật bất di bất dịch: con số do ĐÂY tính ══════════════════════════════
 *
 * Mọi con số trong câu trả lời là kết quả một phép tính trên `bang.rows`, hoặc
 * một dữ kiện trang đã khai. Không có đường nào để một con số xuất hiện mà
 * không đi qua chỗ này — nên nó KHÔNG BỊA ĐƯỢC, không phải vì ta cẩn thận, mà
 * vì không có chỗ để bịa.
 *
 * Lớp LLM (nếu được bật) chỉ nhận `cau` và `so` rồi viết lại thành câu mượt
 * hơn, và bị đối chiếu: con số nào trong `so` mà biến mất khỏi câu nó viết thì
 * câu đó bị bỏ. Xem endpoint `POST /v1/chat/dien-dat`.
 *
 * ═══ Thà nói "chưa hiểu" còn hơn đoán ══════════════════════════════════════
 *
 * `traLoi` trả `null` khi không khớp gì. Khung hỏi đáp khi đó hiện vài câu mẫu
 * CỦA TRANG ĐANG MỞ. Đoán một ý định gần gần sẽ cho ra một con số có thật, trả
 * lời một câu hỏi khác — kiểu sai tệ nhất, vì nó không có dấu hiệu nào.
 */

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
  /**
   * Những con số ĐÃ định dạng mà câu trả lời đứng trên.
   *
   * Là chuỗi chứ không phải số, cố ý: luật đối chiếu ở backend chỉ cần kiểm
   * "chuỗi này còn nằm trong câu LLM viết ra hay không". Một phép so chuỗi thì
   * không có chỗ nào để lệch, còn rút số ra khỏi câu tiếng Việt thì có — dấu
   * chấm hàng nghìn và dấu phẩy thập phân của `vi-VN` ngược với mặc định của
   * `parseFloat`.
   */
  so: string[];
}

/**
 * Bỏ dấu + hạ chữ thường + bỏ dấu câu, để "Cao Nhất" và "cao nhat" khớp như nhau.
 *
 * Dấu câu phải thành KHOẢNG TRẮNG chứ không phải bị xoá đi. Người dùng gõ "mô
 * hình nào nhiều nhất, Kho hay Bán hàng" thì dấu phẩy dính vào chữ trước nó và
 * "nhat," không còn là từ "nhat" nữa — mọi phép so từ khoá và mọi phép chấm
 * điểm theo từ đều trượt, mà câu hỏi thì hoàn toàn bình thường. Giữ `%` lại vì
 * nó là một từ khoá thật ("chiếm bao nhiêu %").
 *
 * ⚠️ `đ`/`Đ` phải thay TAY. Hai ký tự đó là ký tự Latin riêng (U+0111/U+0110),
 * không phải "d + dấu", nên `NFD` không tách được gì và bước lọc dấu bỏ sót
 * chúng. Bỏ qua chuyện này là mọi câu chứa chữ "đ" — "đâu", "lớn nhất là mấy
 * đồng", "đếm" — khớp sai. Cùng cái bẫy đã ghi ở `services/dataset/storageKey.ts`
 * bên backend.
 */
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

/**
 * Từ người dùng gõ → từ hệ thống viết trên nhãn.
 *
 * ═══ Vì sao bảng này CHÍNH ĐÁNG, mà một bảng đồng nghĩa nói chung thì không ═
 *
 * Mọi nhãn ở nhánh tra cứu do CHÍNH chỗ này viết ra — "Số dòng của X", "Dung
 * lượng tệp của X", "Số quan hệ của mô hình X". Nên bảng dưới đây không đoán gì
 * về dữ liệu của khách: nó chỉ nối từ người ta hay gõ về đúng chữ mà ta đã
 * chọn. Hai phía đều của ta, nên không có chỗ nào để sai.
 *
 * Trường của NGƯỜI DÙNG (`Total amount`, `Product Name`) thì ngược lại — ta
 * không biết họ gọi chúng là gì, và đoán thì chắc chắn sai. Khoảng cách đó phải
 * do chính họ khai, bằng ô mô tả trường.
 *
 * ═══ Vì sao đặt trong `chuanHoa`, không phải ở từng phép so ════════════════
 *
 * `chuanHoa` chạy trên CẢ HAI phía — câu hỏi và nhãn. Gộp ở đây nghĩa là hai
 * phía gặp nhau ở giữa, và mọi phép so trong file này (`docYDinh`, `chieuHoi`,
 * `timDong`, `traCuu`, `tuNoiDung`, `nguonTheoTen`) được ăn theo miễn phí. Gộp
 * ở từng phép so là sáu bản sao, và bản thứ sáu sẽ bị quên.
 *
 * ⚠️ `chuanHoa` chỉ dùng để SO, không bao giờ để in ra. Nhãn hiện trên màn hình
 * luôn là `d.nhan` nguyên văn, nên bảng này không đổi một chữ nào người đọc thấy.
 *
 * ⚠️ So theo TỪ trọn vẹn, không theo chuỗi con: "profile" không được thành
 * "protep", và "dong" trong "dòng" không được đụng tới.
 */
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
]);

/** Từ khoá của từng ý định, thử theo THỨ TỰ này. */
const TU_KHOA: { y: YDinh; tu: string[] }[] = [
  // `ti_trong` và `so_sanh` đứng trước `cao_nhat`: "A chiếm bao nhiêu % so với
  // cao nhất" chứa cả hai, và ý chính là cái cụ thể hơn.
  { y: 'ti_trong', tu: ['chiem bao nhieu', 'ti trong', 'ti le', 'phan tram', 'bao nhieu %'] },
  { y: 'so_sanh', tu: ['so voi', 'so sanh', 'hon hay', 'cao hon', 'thap hon', 'chenh'] },
  { y: 'top_n', tu: ['top ', 'cao nhat la nhung', 'xep hang'] },
  { y: 'cao_nhat', tu: ['cao nhat', 'lon nhat', 'nhieu nhat', 'dat nhat', 'dinh cao', 'max'] },
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
  { y: 'tong', tu: ['tong', 'cong lai', 'tat ca la bao nhieu'] },
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
    tu: ['bao nhieu nhom', 'co may', 'so luong nhom', 'may nhom', 'bao nhieu muc', 'co bao nhieu'],
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

/** Chữ "nhất" đứng riêng thành một từ — "cao nhất", "ít báo cáo nhất". */
const CO_NHAT = /(^| )nhat( |$)/;

/** Những từ lật chiều so sánh: có chúng thì "nhất" là nhỏ nhất, không phải lớn nhất. */
const TU_NGUOC = /(^| )(it|thap|nho|re|cu|som)( |$)/;

/**
 * Câu hỏi này đang hỏi gì? `null` = không nhận ra.
 *
 * Không có `gia_tri` trong bảng từ khoá: nó không có từ khoá riêng nào cả
 * ("Miền Bắc bao nhiêu"), nên nó được thử ở `tinhBang` bằng cách tìm xem câu
 * hỏi có nhắc tên nhóm nào không. Đặt một từ khoá kiểu "bao nhieu" vào đây sẽ
 * nuốt luôn mọi câu hỏi khác.
 *
 * ═══ Hai luật kẹp hai đầu bảng từ khoá ═════════════════════════════════════
 *
 * Bảng `TU_KHOA` so chuỗi LIỀN NHAU, nên tiếng Việt chen danh từ vào giữa tính
 * từ là nó trượt: "ít báo cáo nhất" không chứa "it nhat". Riêng ca đó còn tệ
 * hơn trượt — "báo **cáo nhất**" CHỨA đúng chuỗi "cao nhat", nên câu hỏi về cái
 * ít nhất được trả lời bằng cái nhiều nhất, ngược hẳn, bằng một con số có thật.
 *
 * Nên:
 *
 *   - Luật lật chiều chạy TRƯỚC bảng, vì nó đang sửa một câu trả lời SAI.
 *   - Luật "có `nhất` thì là cao nhất" chạy SAU bảng, chỉ như một lưới hứng.
 *     Đặt nó trước là nó nuốt `ti_trong` ("chiếm bao nhiêu % so với cao nhất")
 *     và `top_n` — hai thứ mà thứ tự trong bảng đã cố ý xếp lên trên `cao_nhat`.
 */
export function docYDinh(cauHoi: string): YDinh | null {
  const q = chuanHoa(cauHoi);
  if (CO_NHAT.test(q) && TU_NGUOC.test(q)) return 'thap_nhat';
  for (const { y, tu } of TU_KHOA) {
    if (tu.some((t) => q.includes(t))) return y;
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

/**
 * Số liệu đang hiện có phải TOÀN BỘ không — và nếu không thì nói ra.
 *
 * `grouped` nghĩa là biểu đồ đã cắt bớt nhóm; `paging.hasMore` nghĩa là còn
 * trang nhóm nữa chưa lấy. Trong cả hai trường hợp, `tong`/`trung_binh`/
 * `ti_trong` tính trên `rows` KHÔNG phải con số của cả tập dữ liệu.
 *
 * Cùng lý do tồn tại với `TruncationNote` của `ReportChart`: không nói ra thì
 * "tổng 5 vùng lớn nhất trong 13" đọc thành "tổng toàn bộ", và mọi kết luận rút
 * ra từ đó đều sai mà không có dấu hiệu nào.
 */
function luuYCat(bang: ReportDataDto): string | null {
  const con = bang.grouped || bang.paging?.hasMore === true;
  if (!con) return null;
  return `tính trên ${String(bang.rows.length)} nhóm đang hiện trên biểu đồ, không phải toàn bộ dữ liệu`;
}

/** Tên một dòng: có chiều thứ hai thì phải gọi cả hai, vì nhãn trùng nhau. */
function tenDong(row: ReportDataDto['rows'][number]): string {
  /*
   * ⚠️ Khi `seriesLabel` có mặt, MỘT nhãn xuất hiện nhiều lần — mỗi chuỗi một
   * dòng. Đó chính là lý do `ReportDataTable` phải khoá theo chỉ số thay vì
   * theo nhãn. Trả về mỗi `label` ở đây thì câu "cao nhất là Miền Bắc" không
   * nói được Miền Bắc CỦA NHÓM NÀO — và có khi nhóm đó mới là tin đáng chú ý.
   */
  return row.series === undefined ? row.label : `${row.label} (${row.series})`;
}

/**
 * Câu hỏi đang hỏi về CHIỀU NÀO của một biểu đồ hai chiều? `null` = không nói rõ.
 *
 * ═══ Vì sao phải hỏi câu này ═══════════════════════════════════════════════
 *
 * Biểu đồ "Quantity theo Customer Name, tách màu theo Product Name" có mỗi dòng
 * là một CẶP (khách, sản phẩm). Hỏi "Product Name nào Quantity cao nhất" mà trả
 * lời bằng dòng lớn nhất thì ra một cặp — "Jonathan Doherty (Boston Pencil
 * Sharpener): 13" — đúng số, sai câu hỏi. Sản phẩm bán nhiều nhất là sản phẩm
 * có TỔNG lớn nhất, cộng qua mọi khách đang hiện.
 *
 * Chỉ gộp khi câu hỏi GỌI TÊN một chiều. Không gọi tên thì giữ nguyên cách cũ —
 * dòng lớn nhất, gọi đủ cả hai tên — vì khi đó không có cách nào biết người hỏi
 * muốn gộp hay không, và một con số gộp im lặng thì không ai nhận ra.
 */
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

/** Vị trí chiều được gọi THẲNG TÊN trong câu, hoặc -1. So theo từ trọn vẹn. */
function viTriGoiTen(q: string, ten: string): number {
  return ten === '' ? -1 : ` ${q} `.indexOf(` ${ten} `);
}

/**
 * Vị trí chiều được gọi qua một GIÁ TRỊ của nó, đứng ngay trước chữ "nào".
 *
 * "Miền" không phải tên chiều nào cả — tên chiều là "Khu vực" — nhưng nó có
 * mặt trong MỌI giá trị của chiều đó ("Miền Bắc", "Miền Nam", "Miền Trung").
 * Đó chính là cách người ta gọi tên một chiều khi không nhìn vào nhãn trục, và
 * nó đọc được từ chính dữ liệu nên không cần một bảng đồng nghĩa nào.
 *
 * Đòi chữ đó có ở MỌI giá trị, không phải một vài: lỏng hơn thế thì một chữ
 * tình cờ trùng một giá trị sẽ đổi hẳn chiều của câu trả lời — và một con số
 * gộp nhầm chiều vẫn là một con số có thật.
 */
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

/** Cộng các dòng lại theo một chiều. */
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

function ghep(cau: string, luuY: string | null): string {
  return luuY === null ? cau : `${cau} — ${luuY}`;
}

/** Nhóm câu hỏi TÍNH TOÁN, chỉ dùng được khi nguồn có `bang`. */
function tinhBang(
  bang: ReportDataDto,
  cauHoi: string,
  y: YDinh | null,
  /** `undefined` = tu doc tu cau hoi; `null` = ep KHONG gop. */
  chieuEp?: 'label' | 'series' | null,
  /**
   * Khi số liệu KHÔNG đến từ một biểu đồ — xem `BangTho`.
   *
   * Hai thứ phải đổi theo: danh từ trong câu trả lời ("trên bảng này" chứ không
   * phải "trên biểu đồ này"), và vế điều kiện — `luuYCat` đọc `grouped`/`paging`
   * của một biểu đồ, mà một bảng xem trước thì không có hai thứ đó — nó là mẫu
   * vì BẢN CHẤT, không phải vì một cờ nào bật lên.
   */
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

  switch (y) {
    case 'cao_nhat':
    case 'thap_nhat': {
      const lon = y === 'cao_nhat';

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

      const soNhom = new Set(rows.map((r) => r.label)).size;
      return {
        cau: ghep(`Có ${String(soNhom)} ${dimensionLabel} trên ${chu}.`, cat),
        so: [String(soNhom)],
      };
    }

    case 'top_n': {
      const chieu = chieuEp === undefined ? chieuHoi(bang, cauHoi) : chieuEp;
      if (chieu !== null) {
        const nhom = gopTheo(rows, chieu).sort((a, b) => b.value - a.value);
        const n = Math.min(docSo(cauHoi) ?? 5, nhom.length);
        const dau = nhom.slice(0, n);
        const tenChieu = chieu === 'series' ? (bang.seriesLabel ?? '') : dimensionLabel;
        return {
          cau: ghep(
            `${String(n)} ${tenChieu} cao nhất: ${dau
              .map((g, i) => `${String(i + 1)}. ${g.ten} ${doc(g.value)}`)
              .join('; ')}.`,
            cat,
          ),
          so: dau.map((g) => doc(g.value)),
        };
      }

      const n = Math.min(docSo(cauHoi) ?? 5, rows.length);
      const dau = [...rows].sort((a, b) => b.value - a.value).slice(0, n);
      const so = dau.map((r) => doc(r.value));
      return {
        cau: ghep(
          `${String(n)} ${dimensionLabel} cao nhất: ${dau
            .map((r, i) => `${String(i + 1)}. ${tenDong(r)} ${doc(r.value)}`)
            .join('; ')}.`,
          cat,
        ),
        so,
      };
    }

    case 'ti_trong': {
      const dong = timDong(rows, cauHoi);
      if (dong === null) return null;
      // `tong` ở đây là tổng của những dòng ĐANG HIỆN. Khi số liệu đã bị cắt,
      // tỉ trọng tính ra lớn hơn tỉ trọng thật — nên `cat` là bắt buộc.
      const pt = `${((dong.value / tong) * 100).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} %`;
      return {
        cau: ghep(`${tenDong(dong)} chiếm ${pt} tổng ${measureLabel}.`, cat),
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
      if (dong === null) return null;

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

/**
 * Điều kiện lọc đọc được từ câu hỏi: toán tử + ngưỡng. `null` = không có số nào.
 *
 * Ngưỡng lấy từ CHÍNH câu người dùng gõ, không phải từ một mô hình nào — nên
 * con số trong câu trả lời luôn là con số họ vừa nói ra.
 */
export function docDieuKien(cauHoi: string): { toanTu: ToanTu; nguong: number } | null {
  const q = chuanHoa(cauHoi);
  const nguong = docSo(q);
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

/** Số đầu tiên trong câu hỏi — cho "top 3". */
function docSo(cauHoi: string): number | null {
  const m = /\d+/.exec(cauHoi);
  return m === null ? null : Number(m[0]);
}

/** Dòng mà câu hỏi đang nhắc tới, tìm theo nhãn. */
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

function timHaiDong(
  rows: ReportDataDto['rows'],
  cauHoi: string,
): [ReportDataDto['rows'][number], ReportDataDto['rows'][number]] | null {
  const q = chuanHoa(cauHoi);
  const thay = [...rows]
    .sort((a, b) => tenDong(b).length - tenDong(a).length)
    .filter((r) => r.label !== '' && q.includes(chuanHoa(r.label)));
  const [a, b] = thay;
  return a !== undefined && b !== undefined ? [a, b] : null;
}

/**
 * Nhóm câu hỏi TRA CỨU: so câu hỏi với nhãn của từng dữ kiện.
 *
 * Chấm theo số TỪ trùng nhau, không theo `includes`: nhãn là "Số dòng của Đơn
 * hàng Q4" còn câu hỏi là "đơn hàng q4 có mấy dòng" — không chuỗi nào chứa
 * chuỗi nào, nhưng bốn từ trùng.
 *
 * Ngưỡng 2 từ, và phải hơn hẳn ứng viên nhì. Một dữ kiện trùng đúng một từ
 * ("của") là trùng ngẫu nhiên, còn hai ứng viên bằng điểm nghĩa là câu hỏi chưa
 * đủ rõ — cả hai đều phải ra `null` để khung nói "chưa hiểu" thay vì chọn bừa.
 */
function traCuu(duKien: DuKien[], cauHoi: string): TraLoi | null {
  const noiDung = (s: string): string[] =>
    chuanHoa(s)
      .split(' ')
      .filter((t) => t.length > 1 && !TU_HOI.has(t));

  const tuHoi = new Set(noiDung(cauHoi));
  if (tuHoi.size === 0) return null;

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
  const diem = duKien.map((d) => ({
    d,
    diem: noiDung(d.nhan).filter((t) => tuHoi.has(t)).length,
  }));
  diem.sort((a, b) => b.diem - a.diem);

  const nhat = diem[0];
  const nhi = diem[1];
  if (nhat === undefined || nhat.diem < 2) return null;
  if (nhi !== undefined && nhi.diem === nhat.diem) return null;

  return traLoiTheoDuKien(nhat.d);
}

/**
 * Trả lời một câu hỏi về MỘT nguồn. `null` = chưa hiểu.
 *
 * Thử tính toán trước rồi mới tra cứu: câu "tổng doanh thu bao nhiêu" trên một
 * biểu đồ cũng trùng vài từ với dữ kiện "Tổng số dòng", và một con số về số
 * dòng trả lời cho câu hỏi về doanh thu là đúng kiểu sai không ai phát hiện.
 */
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

/**
 * Một ô thành số. `null` = không phải số.
 *
 * ⚠️ Dùng `Number`, KHÔNG dùng `soVi`. Hai hàm đọc hai thứ khác hẳn nhau: `soVi`
 * đọc chuỗi ĐÃ ĐỊNH DẠNG theo `vi-VN` (dấu `.` là hàng nghìn), còn ô ở đây đến
 * THẬNG từ CSDL nên dấu `.` là dấu thập phân. Dùng nhầm là "12.5" thành 125.
 *
 * `boolean` cố ý KHÔNG phải số: cộng một cột true/false ra một con số hợp lệ mà
 * không ai hỏi.
 */
function oThanhSo(v: string | number | boolean | null): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const chu = v.trim();
  if (chu === '') return null;
  const n = Number(chu);
  return Number.isFinite(n) ? n : null;
}

/** Chỉ số những cột ĐO ĐƯỢC: mọi ô có giá trị đều đọc ra số, và có ít nhất một ô. */
function cotDoDuoc(bt: BangTho): number[] {
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

/** Cột mà câu hỏi gọi tên, trong một nhóm cột. Tên DÀI NHẤT thắng. */
function cotGoiTen(bt: BangTho, chiSo: number[], q: string): number | null {
  // Cùng luật đã ghi ở `timDong`: "Sales" và "Sales Amount" cùng nằm trong câu
  // hỏi về cái thứ hai; lấy cái ngắn là đo nhầm cột bằng một con số có thật.
  const ung = chiSo
    .map((i) => ({ i, ten: chuanHoa(bt.cot[i] ?? '') }))
    .filter((x) => x.ten !== '' && q.includes(` ${x.ten} `))
    .sort((a, b) => b.ten.length - a.ten.length);
  return ung[0]?.i ?? null;
}

/**
 * Cột nhận ra qua một GIÁ TRỊ của nó có mặt trong câu hỏi. Giá trị DÀI NHẤT thắng.
 *
 * ═══ Vì sao cần cả cửa này ══════════════════════════════════════
 *
 * Người dùng gọi tên thứ họ thấy trên bảng, không gọi tên cột: "doanh thu của
 * Staples là bao nhiêu" nhắc cột đo bằng TÊN, nhưng nhắc cột nhãn bằng một
 * GIÁ TRỊ. Thiếu cửa này thì cột nhãn rơi về cột chữ đầu tiên ("Mã đơn"), và
 * `timDong` không tìm thấy "staples" trong một cột mã đơn — câu hỏi mất câu trả
 * lời, rồi bị một nhãn tra cứu trùng từ nhặt mất.
 *
 * Cùng luật đã ghi ở `locNguon` và `viTriQuaGiaTri`: một cột được nhận ra qua
 * chính giá trị của nó, đọc từ dữ liệu chứ không từ một bảng đồng nghĩa nào.
 *
 * ⚠️ Đòi TỪ BỐN ký tự và khớp trọn cụm. Một giá trị hai ký tự ("HN", "A1") có
 * mặt trong nửa số câu hỏi tiếng Việt, và khi đó cột nhãn được chọn bằng một sự
 * trùng ngẫu nhiên.
 */
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

/**
 * Dựng một `ReportDataDto` từ bảng thô, theo câu hỏi. `null` = chưa đủ rõ.
 *
 * CỘT ĐO là cửa bắt buộc: không đo gì thì không tính được gì. Câu hỏi phải gọi
 * tên nó, TRỪ khi cả bảng chỉ có đúng một cột đo được — lúc đó không có gì để
 * chọn nhầm.
 *
 * CỘT NHÃN thì lỏng hơn, và được phép: câu trả lời luôn in ra tên cột nhãn
 * ("Sản phẩm cao nhất là …"), nên chọn cột chữ đầu tiên khi không ai gọi tên là
 * một phỏng đoán NÓI RA, không phải một phỏng đoán giấu đi.
 */
export function bangTuBangTho(
  bt: BangTho,
  cauHoi: string,
): { bang: ReportDataDto; gop: string | null } | null {
  if (bt.dong.length === 0) return null;
  const q = ` ${chuanHoa(cauHoi)} `;

  const doDuoc = cotDoDuoc(bt);
  const conLai = bt.cot.flatMap((_, i) => (doDuoc.includes(i) ? [] : [i]));
  // TÊN cột trước, rồi mới tới một GIÁ TRỊ của nó — xem `cotQuaGiaTri`.
  const nhanGoiTen = cotGoiTen(bt, conLai, q) ?? cotQuaGiaTri(bt, conLai, q);
  const iDo = cotGoiTen(bt, doDuoc, q) ?? (doDuoc.length === 1 ? (doDuoc[0] ?? null) : null);

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
  };
}

export function traLoi(
  nguon: Nguon,
  cauHoi: string,
  /**
   * Mọi chữ khung đã thấy — xem `tuDaBiet`. Vắng mặt = không kiểm thực thể lạ.
   *
   * Tuỳ chọn vì chỉ chỗ nào CẦM CẢ DANH SÁCH mới dựng được tập này: một nguồn
   * đơn lẻ không biết mấy nguồn kia có gì, nên tự nó chấm thì mọi tên mục khác
   * đều thành "thực thể lạ".
   */
  biet?: Set<string>,
): TraLoi | null {
  if (chuanHoa(cauHoi) === '') return null;

  const y = docYDinh(cauHoi);
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
  /** Tính trên bảng dữ liệu thô của nguồn này, nếu nó có. */
  const tuBangTho = (): TraLoi | null => {
    const bt = nguon.bangTho === undefined ? null : bangTuBangTho(nguon.bangTho, cauHoi);
    if (bt === null || nguon.bangTho === undefined) return null;
    return tinhBang(bt.bang, cauHoi, y, 'label', {
      chu: 'bảng này',
      luuY: [bt.gop, nguon.bangTho.luuY].filter((x) => x !== null).join('; '),
    });
  };

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

  if (y === 'dem' && !laLa) {
    const soDuoc = nguon.duKien.filter((d) => soVi(d.gia) !== null);
    const kq = soDuoc.length === 0 ? null : traCuu(soDuoc, cauHoi);
    if (kq !== null) return kq;
  }

  const tuBang = tuBangTho();
  if (tuBang !== null) return tuBang;

  return laLa ? null : traCuu(nguon.duKien, cauHoi);
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

/**
 * Từ KHÔNG nói gì về thuộc tính đang được hỏi.
 *
 * Phải bỏ trước khi chấm điểm. Giữ lại thì "nào" và "nhất" có mặt ở cả câu hỏi
 * lẫn nhiều nhãn, mọi thuộc tính được cộng cùng một điểm, và cuộc chấm luôn hoà
 * — tức là luôn trả về `null`.
 */
const TU_DEM = new Set([
  'nao',
  'la',
  'cua',
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

/**
 * Những CỤM chỉ LOẠI mục, không chỉ thuộc tính nào.
 *
 * ═══ Lỗi đo được, và vì sao nó không trông như lỗi ═════════════════════════
 *
 * Câu "bộ dữ liệu nào nhiều dòng nhất" trên trang Kho dữ liệu được trả lời
 * bằng "Cao nhất là Orders — Số mô hình DỮ LIỆU dùng: 2". Hai chữ "dữ liệu"
 * của "bộ dữ liệu" trùng vào nhãn "Số mô hình dữ liệu dùng" và thắng 2-1 cột
 * "Số dòng của" — nên câu trả lời là một con số CÓ THẬT, của một thuộc tính
 * khác, không một dấu hiệu nào.
 *
 * Gốc của chuyện đó: trên một trang danh sách, MỌI mục đều cùng một loại. Nên
 * mấy chữ gọi tên cái loại ấy không phân biệt được cột nào với cột nào — chúng
 * là nhiễu, đúng nghĩa như "nào" và "nhất" trong `TU_DEM`.
 *
 * ⚠️ Bỏ ở CẢ HAI phía, câu hỏi lẫn nhãn. Bỏ một phía là tự tạo ra lệch điểm
 * mới. Và cụm DÀI phải đứng trước cụm ngắn, nếu không "mô hình dữ liệu" bị
 * "mô hình" xé làm hai và còn lại một chữ "dữ liệu" lơ lửng.
 */
const CUM_LOAI = ['mo hinh du lieu', 'bo du lieu', 'mo hinh', 'du lieu'];

/**
 * Từ chỉ dùng để HỎI, không nói gì về nội dung.
 *
 * Nhãn của ta cũng được viết theo giọng câu hỏi — "Báo cáo X dựng trên GÌ",
 * "Mô hình X đã nối đủ CHƯA", "Báo cáo X sửa lần cuối lúc NÀO". Nên mấy chữ
 * này có mặt ở cả hai phía và chỉ làm nhiễu phép chấm điểm.
 *
 * Lỗi đo được: "báo cáo Số lượng theo Khu vực dùng mô hình NÀO" hoà điểm giữa
 * nhãn "… dựng trên gì" và nhãn "… sửa lần cuối lúc NÀO", đúng vì chữ "nào"
 * cho nhãn thứ hai thêm một điểm miễn phí. Hoà thì `traCuu` bỏ cả hai, nên câu
 * hỏi mất câu trả lời vì một chữ không mang nội dung nào.
 *
 * Bỏ ĐỐI XỨNG ở cả câu hỏi lẫn nhãn — bỏ một phía là tự tạo ra lệch điểm mới.
 */
const TU_HOI = new Set(['nao', 'gi', 'chua', 'may']);

/*
 * ⚠️ KHÔNG có `bao` và `nhieu` trong danh sách trên, dù "bao nhiêu" là từ để
 * hỏi điển hình nhất. Vì `chuanHoa('báo')` cũng ra `bao`: bỏ nó đi là xé đôi
 * chữ "báo cáo", và mọi nhãn về báo cáo mất một nửa điểm của chúng.
 *
 * Cũng không có `khong`: "không có quan hệ" dùng nó để phủ định, không để hỏi.
 */

/** Bỏ các cụm chỉ loại khỏi một chuỗi ĐÃ chuẩn hoá. */
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

/**
 * Từ KHÔNG bao giờ được coi là một thực thể.
 *
 * Ba phần đầu SINH RA từ chính mấy bảng đã có, không chép tay: thêm một từ khoá
 * ý định mới là nó tự được miễn ở đây, không ai phải nhớ sửa hai chỗ.
 *
 * Phần cuối là TỪ CHỨC NĂNG tiếng Việt — lớp từ ĐÓNG nhất có thể, và đó là
 * điều phân biệt nó với một bảng đồng nghĩa nói chung: nó không bao giờ dài ra
 * theo dữ liệu của khách hàng. Một từ lọt vào đây chỉ có nghĩa "đừng coi nó là
 * tên riêng", không đổi một điểm nào của phép chấm.
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
  'tren',
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

/** Mọi chữ khung ĐÃ THẤY: tên nguồn, nhãn dữ kiện, và giá trị. */
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

/**
 * Câu hỏi có nhắc tên một thứ KHÔNG TỒN TẠI không?
 *
 * `true` nghĩa là đừng trả lời bằng phép so nhãn. Không phải "chưa hiểu câu này"
 * mà là "câu này hỏi về một thứ tôi không có" — và hai thứ đó dẫn tới cùng một
 * hành động: từ chối, kèm gợi ý.
 */
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
      .some((t) => t.length >= 4 && !TU_BO_QUA.has(t) && !biet.has(t))
  );
}

/**
 * Nhãn sau khi bỏ tên mục, hoặc `null` nếu nhãn không nhắc tên mục đó.
 *
 * So CÓ phân biệt hoa thường, trên chuỗi gốc: nhãn được dựng bằng chính biến
 * tên mục trong `duKienTrang.ts` nên nó trùng từng ký tự. So lỏng hơn (bỏ dấu,
 * hạ chữ) sẽ làm nguồn tóm tắt "Mô hình X" nuốt luôn mọi nhãn "… mô hình X …"
 * và tự biến mình thành một mục ngang hàng với các bảng bên trong nó.
 */
function boTenMuc(nhan: string, ten: string): string | null {
  // Console đặt tên workspace là "Tên (Tổ chức)" trong khi nhãn chỉ nhắc "Tên".
  for (const ung of [ten, ten.replace(/\s*\(.*\)\s*$/, '')]) {
    if (ung === '' || !nhan.includes(ung)) continue;
    const con = nhan.replace(ung, ' ').replace(/\s+/g, ' ').trim();
    if (con !== '') return con;
  }
  return null;
}

/**
 * Đọc một giá trị đã định dạng `vi-VN` về số. `null` = không phải số.
 *
 * ⚠️ `parseFloat` KHÔNG dùng được: `vi-VN` lấy `.` làm dấu hàng nghìn, nên
 * "1.234" bị đọc thành 1,234 — sai 1000 lần mà vẫn ra một con số trông hợp lệ.
 *
 * Phần đuôi `\D+` cho qua đơn vị dính sau số ("28,3 %", "12 tháng") nhưng chặn
 * ngày tháng ("12/10/2026"), vì sau "12" còn chữ số nữa. Cố ý: so hai ngày bằng
 * phép so số thì "1/12" lớn hơn "30/11".
 */
function soVi(gia: string): number | null {
  const m = /^(-?\d[\d.]*)(?:,(\d+))?(?:\s*\D+)?$/.exec(gia.trim());
  if (m === null) return null;
  const nguyen = m[1] ?? '';
  return Number(`${nguyen.replace(/\./g, '')}.${m[2] ?? '0'}`);
}

/** Mục này coi như CHƯA CÓ thuộc tính đang hỏi. */
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
  /** Nhãn đã bỏ tên mục, giữ nguyên chữ hoa thường để in ra. */
  nhan: string;
  /** Giá trị theo CHỈ SỐ nguồn — tên mục trùng nhau được (hay gặp). */
  gia: Map<number, DuKien>;
}

interface ThuocTinh extends Cot {
  /** Mọi mục so được trên trang này, kể cả mục không có thuộc tính đang hỏi. */
  muc: Muc[];
  /** Mọi cột so được — để biết mục nào CÙNG LOẠI với cột đang hỏi. */
  cot: Cot[];
}

/**
 * Thuộc tính mà câu hỏi đang nhắc tới, trong số các cột so được của trang.
 *
 * Một thuộc tính chỉ được tính là "so được" khi có mặt ở TỪ HAI mục. Điều kiện
 * đó cũng là thứ loại nguồn tóm tắt ra khỏi danh sách mục: ở trang chi tiết mô
 * hình, nhãn "Mô hình X dựng từ tệp nào" nhắc đúng tên nguồn tóm tắt nên trông
 * như một thuộc tính, nhưng không bảng nào khác có nó.
 */
/**
 * Tên hiện ra cho từng nguồn, có đánh số khi trùng nhau.
 *
 * Tên nguồn KHÔNG duy nhất: ba mô hình dữ liệu cùng tên "Global-Superstore"
 * trong một workspace là chuyện có thật. Ba chip giống nhau từng chữ thì người
 * dùng không biết mình đang bấm cái nào — và tệ hơn, câu "cao nhất là
 * Global-Superstore" cũng không chỉ ra được là cái nào.
 *
 * Vì vậy chip VÀ câu trả lời dùng chung đúng hàm này. Hai chỗ gọi cùng một mục
 * bằng hai cái tên khác nhau là lỗi đã được ghi lại ở `features/reports/nhanO.ts`.
 *
 * ⚠️ Chỉ đổi tên HIỆN RA. `nguon.ten` giữ nguyên, vì `nguonTheoTen` dò nó trong
 * câu hỏi — người dùng gõ "Global-Superstore", không ai gõ "Global-Superstore (1)".
 */
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

/** Một lượt chấm. `null` = không cột nào khớp, hoặc hai cột bằng điểm. */
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

/**
 * Cột mà câu hỏi đang nhắc tới. `null` = không nhận ra, hoặc hoà.
 *
 * ═══ Hai lượt chấm, và lượt thứ hai chỉ chạy khi lượt đầu HOÀ ═════════
 *
 * `CUM_LOAI` bỏ mấy cụm chỉ LOẠI mục, và lí lẽ của nó là: trên một trang danh
 * sách, mọi mục cùng một loại nên tên loại không phân biệt được cột nào với
 * cột nào. Lí lẽ đó ĐÚNG với một trang, và SAI với danh sách xuyên hệ thống
 * — ở đó bộ dữ liệu, mô hình, kết nối và báo cáo nằm chung một rổ.
 *
 * LỖI ĐO ĐƯỢC: "kết nối nào nhiều bộ dữ liệu nhất". Bỏ cụm "bộ dữ liệu" là
 * câu hỏi chỉ còn hai chữ "kết nối", mà NĂM cột của một kết nối đều chứa hai
 * chữ ấy — hoà năm đường, và câu hỏi mất câu trả lời vì đúng mấy chữ mang
 * nội dung đã bị bỏ đi.
 *
 * Thứ tự này giữ được cả hai: lượt đầu vẫn bỏ cụm loại, nên "bộ dữ liệu nào
 * nhiều dòng nhất" không bị nhãn "Số mô hình DỮ LIỆU dùng" cướp mất (lỗi đã
 * ghi ở `CUM_LOAI`). Lượt hai chỉ chạy khi lượt đầu đã hoà — tức là khi khung
 * đã sắp nói "chưa hiểu" — nên nó chỉ thêm câu trả lời, không đổi câu nào.
 */
function chonThuocTinh(tatCa: Nguon[], cauHoi: string): ThuocTinh | null {
  const { cot: soDuoc, muc } = gomThuocTinh(tatCa);
  if (muc.length < 2) return null;

  const g = chamCot(soDuoc, cauHoi, true) ?? chamCot(soDuoc, cauHoi, false);
  return g === null ? null : { ...g, muc, cot: soDuoc };
}

/**
 * Trả lời câu hỏi "mục NÀO …" bằng cách so mọi mục đang hiện. `null` = chưa hiểu.
 *
 * Ba cửa phải qua hết: đúng ý định so sánh, câu hỏi có chữ "nào", và đúng MỘT
 * thuộc tính khớp. Chặt như vậy vì hàm này chạy TRƯỚC `traLoi` — một lần nhận
 * nhầm ở đây là cướp mất câu trả lời đúng của nguồn đang chọn.
 */
export function soSanhNguon(
  tatCa: Nguon[],
  cauHoi: string,
  /**
   * Phạm vi của phép so, nối vào sau "so trên N mục …".
   *
   * Tham số vì cùng hàm này giờ chạy trên HAI danh sách: nguồn của trang đang
   * mở, và danh sách xuyên hệ thống (xem `traLoiHeThong`). Viết cứng "trên
   * trang này" thì câu trả lời về cả tổ chức nói sai chỗ nó đọc được — đúng
   * kiểu sai mà cả vế này tồn tại để chặn.
   */
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
      return {
        cau: `Không mục nào — cả ${soMuc} mục ${pham} đều có "${tt.nhan}".`,
        so: [soMuc],
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

/**
 * LỌC danh sách theo một thuộc tính CHỮ — "liệt kê các báo cáo biểu đồ cột".
 *
 * ═══ Vì sao `soSanhNguon` không làm được việc này ══════════════════════════
 *
 * `soSanhNguon` trả lời "mục nào CAO NHẤT" — nó so số. Câu hỏi ở đây khác hẳn:
 * "những mục nào CÓ GIÁ TRỊ BẰNG cái này", trên một cột toàn chữ. Trang chủ
 * hiện năm thẻ báo cáo kèm nhãn "Biểu đồ cột" ngay trên mặt thẻ, mà khung thì
 * nói "không có mục nào trả lời được" — lỗi người dùng gặp thật.
 *
 * ═══ Hai cửa, và cả hai đều chặt ═══════════════════════════════════════════
 *
 *   1. Câu hỏi phải gọi tên đúng MỘT cột so được (`chonThuocTinh`, hoà thì bỏ).
 *   2. Câu hỏi phải chứa NGUYÊN VĂN một giá trị của chính cột đó.
 *
 * Cửa (2) là thứ giữ hàm này khỏi đoán: nó không tự nghĩ ra điều kiện, nó chỉ
 * nhận ra một giá trị người dùng vừa gõ ra. Không thấy giá trị nào thì trả
 * `null` và nhường cho các nhánh sau.
 *
 * ⚠️ Giá trị phải dài TỪ NĂM ký tự và khớp theo cụm từ trọn vẹn. Một giá trị
 * ngắn như tên người "dang" sẽ trùng với chữ "đang" trong "báo cáo nào đang
 * chạy", và khi đó khung liệt kê báo cáo theo người tạo cho một câu hỏi về
 * trạng thái — một danh sách có thật, trả lời một câu hỏi khác.
 */
export function locNguon(
  tatCa: Nguon[],
  cauHoi: string,
  pham = 'đang hiện trên trang này',
): TraLoi | null {
  const { cot, muc } = gomThuocTinh(tatCa);
  if (muc.length < 2) return null;

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
  const ungVien = cot.flatMap((g) =>
    [...new Set([...g.gia.values()].map((d) => d.gia))]
      .filter((v) => {
        const c = chuanHoa(v);
        return c.length >= 5 && q.includes(` ${c} `);
      })
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

/** "A, B và C" — không phải "A và B và C". */
function noiTen(ten: string[]): string {
  const cuoi = ten[ten.length - 1] ?? '';
  return ten.length < 2 ? cuoi : `${ten.slice(0, -1).join(', ')} và ${cuoi}`;
}

/**
 * Mọi dữ kiện của trang, phẳng thành một danh sách — để mô hình CHỌN một cái.
 *
 * ═══ Vì sao danh sách này tồn tại ══════════════════════════════════════════
 *
 * `traCuu` so câu hỏi với nhãn bằng cách đếm từ trùng: chính xác, miễn phí, và
 * mù trước cách nói khác. "Cái này nặng bao nhiêu" không trùng từ nào với
 * "Dung lượng của Đơn hàng Q4" dù hai câu nói về đúng một thứ. Người dùng gõ
 * như họ nghĩ, không gõ theo nhãn trên màn hình.
 *
 * Khi đó khung gửi DANH SÁCH NÀY — chỉ nhãn, không có giá trị nào — cho mô hình
 * và hỏi "nhãn số mấy". Mô hình chỉ chọn được; câu trả lời vẫn do
 * `traLoiTheoDuKien` dựng từ chính `DuKien` đó. Xem `services/chat/hieuY.ts`.
 *
 * Nguồn ĐANG CHỌN xếp trước, và nhãn trùng thì giữ cái đầu: trang chi tiết một
 * mô hình nhiều bảng sinh ra hàng trăm dữ kiện, mà backend chỉ lấy 60 nhãn đầu.
 * Thứ tự này quyết định 60 nhãn đó là của thứ người dùng đang nhìn.
 */
export function duKienPhang(tatCa: Nguon[], chon: Nguon): DuKien[] {
  const theoNhan = new Map<string, DuKien>();
  for (const n of [chon, ...tatCa.filter((x) => x !== chon)]) {
    for (const d of n.duKien) {
      if (!theoNhan.has(d.nhan)) theoNhan.set(d.nhan, d);
    }
  }
  return [...theoNhan.values()];
}

/**
 * Dựng câu trả lời từ MỘT dữ kiện.
 *
 * Dùng chung cho nhánh so từ khoá và nhánh mô hình chọn nhãn, và đó là chỗ
 * then chốt: dù ai chọn ra dữ kiện này, câu chữ và con số vẫn do đây dựng —
 * kể cả `luuY`, điều kiện của con số. Mô hình không đổi được một ký tự nào.
 */
export function traLoiTheoDuKien(d: DuKien): TraLoi {
  return { cau: ghep(`${d.nhan}: ${d.gia}.`, d.luuY ?? null), so: [d.gia] };
}

/**
 * Mấy dữ kiện GẦN câu hỏi nhất — để khung gợi ý thay vì bế tắc ở "tôi chưa hiểu".
 *
 * ═══ Vì sao "chưa hiểu" phải kèm đường đi tiếp ═════════════════════════════
 *
 * `traLoi` cố ý trả `null` thay vì đoán, và đó là quyết định đúng. Nhưng một
 * câu "tôi chưa hiểu" trơ trọi thì người dùng không biết mình gõ sai ở đâu —
 * họ thử thêm một câu nữa, cũng chưa hiểu, rồi đóng khung lại và không mở nữa.
 * Thứ chặn đứng chuyện đó không phải một lời xin lỗi dài hơn, mà là mấy câu
 * BẤM ĐƯỢC, lấy từ chính dữ kiện trang đang giữ.
 *
 * Ngưỡng ở đây là MỘT từ trùng, lỏng hơn ngưỡng hai từ của `traCuu`. Chủ ý:
 * đây là gợi ý để bấm, không phải câu trả lời. Đoán gần gần rồi khẳng định là
 * sai; đoán gần gần rồi mời người dùng chọn là đúng việc của nó.
 *
 * Dữ kiện của nguồn ĐANG CHỌN được xét trước, nên khi điểm bằng nhau thì gợi ý
 * nói về thứ người dùng đang xem.
 */
export function goiYGan(tatCa: Nguon[], chon: Nguon, cauHoi: string): string[] {
  const tuHoi = tuNoiDung(cauHoi);
  if (tuHoi.size === 0) return [];

  const diem = luaChonTrang(tatCa, chon, cauHoi)
    .map((lc) => ({ lc, diem: [...tuNoiDung(lc.nhan)].filter((t) => tuHoi.has(t)).length }))
    .filter((x) => x.diem > 0)
    .sort((a, b) => b.diem - a.diem);

  return diem.slice(0, 3).map((x) => `${x.lc.nhan}?`);
}

/**
 * Câu mẫu cho nhóm câu hỏi so sánh, sinh từ chính các cột so được của trang.
 *
 * Người dùng không đoán được là hỏi được kiểu này; viết cứng vài câu thì lại
 * gợi ý sai trên trang không có cột nào so được. Lấy thẳng tên cột ra là cách
 * duy nhất mà gợi ý luôn đúng với trang đang mở.
 */
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

/**
 * Nguồn mà câu hỏi GỌI THẲNG TÊN, hay `null` nếu không gọi tên nguồn nào.
 *
 * Tên DÀI NHẤT trước, cùng lý do đã ghi ở `timDong`: "Kho" nằm trong mọi câu
 * hỏi về "Kho tổng", nên lấy cái ngắn là trả lời về một mục khác bằng một con
 * số có thật.
 */
function nguonTheoTen(tatCa: Nguon[], cauHoi: string): Nguon | null {
  const q = chuanHoa(cauHoi);
  return (
    [...tatCa]
      .sort((a, b) => b.ten.length - a.ten.length)
      .find((n) => n.ten !== '' && q.includes(chuanHoa(n.ten))) ?? null
  );
}

/**
 * Cửa vào DUY NHẤT của khung hỏi đáp. Ba nguồn câu trả lời, theo đúng thứ tự này.
 *
 * ═══ 1. Câu hỏi về CẢ DANH SÁCH đi trước ═══════════════════════════════════
 *
 * Hỏi "mô hình nào chưa nối quan hệ" khi đang chọn chip của một mô hình cụ thể
 * thì `traLoi` tìm thấy ngay "Số quan hệ của mô hình Global-Superstore: 3" và
 * trả lời bằng con số đó — một câu đúng về một mô hình, cho một câu hỏi về cả
 * danh sách.
 *
 * ═══ 2. Rồi tới mục mà câu hỏi GỌI TÊN, chứ không phải chip đang chọn ══════
 *
 * Chip mặc định là bản tóm tắt cả trang, nên "số quan hệ của mô hình qr order"
 * được chấm trên dữ kiện của bản tóm tắt và thắng bằng "Số mô hình dữ liệu
 * trong workspace này" — đúng ba từ trùng, một con số có thật, nói về một thứ
 * hoàn toàn khác. Người dùng gõ tên mục ra là đã nói rõ họ hỏi mục nào; bắt họ
 * bấm chip trước mới được trả lời đúng là một cái bẫy im lặng.
 *
 * ═══ 3. Cuối cùng mới là chip đang chọn ════════════════════════════════════
 *
 * Vẫn cần, cho những câu không gọi tên gì: "có bao nhiêu dòng", "cột này kiểu
 * gì" — chip chính là thứ nói "cái này" là cái nào.
 */
export function traLoiTrang(tatCa: Nguon[], chon: Nguon, cauHoi: string): TraLoi | null {
  const goiTen = nguonTheoTen(tatCa, cauHoi);
  // Dựng MỘT lần cho cả danh sách — xem `tuDaBiet` và `nhacThuLa`.
  const biet = tuDaBiet(tatCa);
  return (
    soSanhNguon(tatCa, cauHoi) ??
    (goiTen === null ? null : traLoi(goiTen, cauHoi, biet)) ??
    /*
     * `locNguon` đứng SAU mục được gọi tên, khác `soSanhNguon`.
     *
     * Vì nó nhận ra cột qua một giá trị nằm trong câu hỏi, mà một câu hỏi về
     * MỘT mục cũng chứa giá trị đó: "Bán hàng đã nối đủ quan hệ chưa" chứa
     * nguyên văn giá trị "đã nối đủ". Để nó lên trước thì câu hỏi về một mô
     * hình cụ thể bị trả lời bằng danh sách mọi mô hình đã nối đủ.
     *
     * Người dùng gõ tên mục ra là đã nói rõ họ hỏi mục nào — cùng luật nhường
     * -cho-tên đã dùng ở nhánh `dem` của `tinhBang` và ở `traLoiHeThong`.
     */
    locNguon(tatCa, cauHoi) ??
    traLoi(chon, cauHoi, biet)
  );
}

/**
 * Mấy nguồn CÙNG trả lời được một câu KHÔNG gọi tên ai — `null` = không mơ hồ.
 *
 * ═══ Lỗi nó sinh ra để chặn ═══════════════════════════════════════════════
 *
 * Trên một khung hai biểu đồ, "cao nhất là gì" trả lời được từ CẢ HAI. Bước
 * cuối của `traLoiTrang` rơi về chip đang chọn, mà chip mặc định là ô số 0 —
 * một lựa chọn người dùng chưa bao giờ làm. Họ nhận một con số có thật, của
 * đúng một biểu đồ trên màn hình, và không có gì nói đó là biểu đồ nào.
 *
 * Đây KHÔNG phải một câu trả lời sai để sửa bằng cách đoán giỏi hơn: hai biểu
 * đồ đều trả lời được thì không có đáp án đúng để mà đoán. Thứ còn thiếu là một
 * câu hỏi ngược.
 *
 * ═══ Ba cửa thoát, và cả ba đều là "câu này đã tự rõ rồi" ════════════════
 *
 * Câu về CẢ danh sách (`soSanhNguon`), câu GỌI TÊN một nguồn, câu nhận ra nguồn
 * qua một GIÁ TRỊ (`locNguon`). Ba thứ này đã tự nói chúng hỏi cái gì, và thứ
 * tự ở đây CỐ Ý khớp thứ tự của `traLoiTrang`: lớp nào trả lời trước thì lớp
 * này phải nhường trước, nếu không hỏi lại sẽ cắt ngang một câu trả lời đúng.
 *
 * ⚠️ Chưa dựng được ca nào chạm tới hai cửa `soSanhNguon` và `locNguon`: chúng
 * cần một câu hỏi vừa gọi tên một cột so được, vừa được từng biểu đồ trả lời
 * riêng — hai hình dạng câu hỏi hiện loại trừ nhau. Giữ vì chúng là MỘT bản
 * sao của thứ tự ngay trên, không phải vì một ca đỏ.
 *
 * ⚠️ KHÔNG nhận chip đang chọn làm tham số. Bản đầu có, và đòi chính chip phải
 * trả lời được, với lý do "chip không trả lời được thì chưa có câu trả lời im
 * lặng nào để chặn" — sai: lúc đó lớp mô hình chọn nhãn sẽ chọn giúp một nhãn
 * trong CẢ trang, nên người dùng vẫn nhận số của một mục họ chưa chọn, chỉ
 * muộn hơn một nhịp và khó lần ra hơn. Mơ hồ là tính chất của CÂU HỎI và
 * TRANG, không phải của cái chip.
 */
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
  /** Câu mô tả, vừa là thứ gửi cho mô hình chọn, vừa là câu gợi ý bấm được. */
  nhan: string;
  /** Chạy ngay trên máy này. `null` = không ra kết quả (ví dụ lọc thiếu ngưỡng). */
  chay: () => TraLoi | null;
}

/** Các phép tính một biểu đồ trả lời được, sinh từ chính nhãn trục của nó. */
function phepCuaBieuDo(nguon: Nguon, cauHoi: string): LuaChon[] {
  const bang = nguon.bang;
  if (bang === undefined) return [];

  const { dimensionLabel: truc, measureLabel: thuoc, seriesLabel: chuoi } = bang;
  const ds: LuaChon[] = [];

  /** Một phép, đã chốt sẵn chiều cần gộp. */
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

/**
 * Mọi thứ trang này trả lời được, nguồn ĐANG CHỌN xếp trước.
 *
 * Thứ tự quan trọng: backend chỉ lấy 60 nhãn đầu, nên nó phải là nhãn của thứ
 * người dùng đang nhìn.
 */
/**
 * Mấy câu hỏi sẵn cho một nguồn có BẢNG THÔ — để người dùng THẤY là hỏi được.
 *
 * ═══ Nhãn CÍNH LÀ câu hỏi ══════════════════════════════════════════
 *
 * `chay` chạy lại đúng `traLoi` với chính cái nhãn vừa hiện ra, thay vì gọi thẳng
 * `tinhBang` với cột đã chọn sẵn như `phepCuaBieuDo`. Hai cái lợi:
 *
 *   - Không chép lại phép chọn cột. Bảng thô chọn cột TỪ CÂU HỎI, nên bấm một
 *     gợi ý phải đi qua đúng phép chọn đó, không phải một đường tắt song song
 *     rồi trả lời khác với lúc gõ tay.
 *   - Bấm một gợi ý cho ra ĐÚNG câu mà gõ nhãn đó ra cho — kiểm được bằng mắt.
 *
 * `duKien: []` để mấy nhãn tra cứu không cướp mất câu hỏi: gợi ý này nói về BẢNG,
 * và nó phải trả lời bằng bảng dù có một dữ kiện nào trùng từ.
 */
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

/**
 * Câu hỏi có tự nhắc tới một thứ CỦA DỮ LIỆU không — tên chiều, giá trị, tên mục.
 *
 * Dùng để tách "câu nối tiếp tự đủ nghĩa" khỏi "câu nối tiếp rỗng nghĩa". Đọc
 * từ chính dữ liệu trang đang giữ, nên nó đúng với mọi trang mà không cần biết
 * trang đó nói về cái gì.
 */
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

/**
 * Câu này có phải một lượt HỎI TIẾP không.
 *
 * ═══ Vì sao phải có dấu hiệu, không chỉ "câu ngắn thì nối" ════════════════
 *
 * Nối câu trước vào MỌI câu chưa trả lời được là mở đường cho một kiểu sai rất
 * khó thấy: "hôm nay trời thế nào" nối sau "miền nào có nhóm hàng cao nhất"
 * thành một câu CÓ trả lời được, và khung sẽ nói về Miền Trung cho một câu hỏi
 * về thời tiết. Đếm số từ cũng không cứu được — hai câu đó dài bằng nhau.
 *
 * Tiếng Việt đánh dấu lượt hỏi tiếp bằng chính chữ MỞ ĐẦU: "còn…", "vậy…",
 * "thế…", "ở…", "của…". Đó là dấu hiệu thật, và nó nằm đúng chỗ dễ kiểm nhất.
 */
export function laNoiTiep(cauHoi: string): boolean {
  return /^(con|vay|the|o|cua|roi|va|nhung)( |$)/.test(chuanHoa(cauHoi));
}

/**
 * Cửa vào DUY NHẤT của khung — trang, rồi hệ thống, rồi thử lại kèm lượt trước.
 *
 * ═══ Vì sao thử KHÔNG CÓ bộ nhớ trước ═════════════════════════════════════
 *
 * Một câu tự nó đủ nghĩa phải được trả lời bằng chính nó. Nối lượt trước vào
 * mọi câu là để lịch sử bẻ lái một câu hỏi vốn đã rõ ràng — và người dùng
 * không có cách nào biết câu trả lời vừa rồi được tính trên câu hỏi nào.
 *
 * Nên bộ nhớ chỉ là LƯỚI HỨNG: chạy khi và chỉ khi câu mới một mình không ra
 * gì, và nó mang dấu hiệu của một lượt hỏi tiếp.
 *
 * Gom cả bốn bước vào một hàm để khung và bộ đánh giá đi CÙNG một đường. Tách
 * ra thì bộ đánh giá đo một thứ, người dùng gặp một thứ khác.
 */
export function traLoiKhung(
  tatCa: Nguon[],
  chon: Nguon,
  heThong: Nguon[],
  cauHoi: string,
  /** Câu NGƯỜI DÙNG hỏi ở lượt trước, hoặc `null` nếu đây là lượt đầu. */
  cauTruoc: string | null,
): TraLoi | null {
  const mot = traLoiTrang(tatCa, chon, cauHoi) ?? traLoiHeThong(heThong, cauHoi);
  if (cauTruoc === null || !laNoiTiep(cauHoi)) return mot;

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
  // Rơi về câu trả lời không bộ nhớ nếu nối vào cũng không ra gì.
  return traLoiTrang(tatCa, chon, noi) ?? traLoiHeThong(heThong, noi) ?? mot;
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

/** Nối vế "đọc ở đâu" vào một câu trả lời của danh sách hệ thống. */
function noiPham(kq: TraLoi): TraLoi {
  return { cau: ghep(kq.cau, TRA_O_DAU), so: kq.so };
}

/**
 * Mô hình dữ liệu mà câu hỏi GỌI TÊN, trong một danh sách. `null` = không ai gọi.
 *
 * ═══ Vì sao đòi GỌI TÊN, không đoán ═══════════════════════════════
 *
 * Đường hỏi-truy-vấn-mới tự dựng một truy vấn chưa ai thấy bao giờ, và một
 * truy vấn chạy trên SAI mô hình vẫn ra một con số đẹp. Khi trang đang đứng trên
 * một mô hình thì không có gì phải đoán — người dùng đang nhìn nó. Đứng ở chỗ
 * khác thì thứ duy nhất nói được họ muốn mô hình nào là chính câu hỏi.
 *
 * Tên DÀI NHẤT thắng, cùng luật `nguonTheoTen` — "Global-Superstore" và
 * "Global-Superstore 2026" cùng nằm trong câu hỏi về cái thứ hai.
 *
 * ⚠️ Trùng tên thì BỎ. Ba mô hình cùng tên "Global-Superstore" trong một tổ chức
 * là chuyện có thật (xem `nhanDuyNhat`), và chọn một trong ba bằng cách tung đồng
 * xu là đúng kiểu sai mà cả vế này tồn tại để chặn.
 */
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

/**
 * Trả lời bằng danh sách xuyên hệ thống. `null` = chưa hiểu.
 *
 * Ba cửa, cùng thứ tự với `traLoiTrang` và cùng lý do:
 *
 *   1. Câu hỏi so cả danh sách ("mô hình nào nhiều bảng nhất").
 *   2. Câu ĐẾM không gọi tên mục nào — chỉ bản tóm tắt được xét.
 *   3. Mục mà câu hỏi gọi thẳng tên ("bộ dữ liệu Orders có mấy dòng").
 *
 * ═══ Không có cửa thứ tư, và đó là một quyết định ══════════════════
 *
 * Bản đầu còn một cửa cuối: so nhãn trên TOÀN BỘ dữ kiện của mọi mục trong tổ
 * chức. Cửa đó đã bị BỎ, vì nó hỏng dần theo số mục chứ không hỏng ngay:
 *
 *   LỖI ĐO ĐƯỢC — ngay khi danh sách xuyên hệ thống nhận thêm mấy thẻ báo cáo,
 *   câu "doanh thu tháng 3 của Miền Bắc" hỏi trên MỘT BIỂU ĐỒ được trả lời bằng
 *   "Thư mục của báo cáo doanh thu theo name: Chung" — ba chữ "doanh", "thu",
 *   "của" đủ để một nhãn bất kỳ về một báo cáo bất kỳ về đích.
 *
 * Gốc của nó: luật "hai từ trùng và hơn hẳn ứng viên nhì" của `traCuu` được
 * dựng cho một nguồn vài chục dữ kiện. Đổ vào đó vài nghìn dữ kiện của cả tổ
 * chức thì hai từ trùng thành chuyện ngẫu nhiên, và càng nhiều dữ liệu thì càng
 * hay trùng — tức là hệ thống dùng càng lâu thì trả lời càng bậy.
 *
 * Bỏ nó không mất câu nào: bộ đánh giá giữ nguyên số ca "chưa hiểu" sau khi
 * bỏ. Ba cửa còn lại đều đòi một BẰNG CHỨNG rằng câu hỏi đang nói về cái gì —
 * một cột so được, một ý định đếm, hay nguyên tên một mục.
 *
 * Nhánh (1) KHÔNG nối thêm vế "đọc ở đâu": `soSanhNguon` đã tự nói ra phạm vi
 * trong vế "so trên N mục …", và hai vế cùng nói một điều chỉ làm câu dài ra.
 */
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
   * `chua_co` đi cùng `dem`: "bao nhiêu mô hình chưa nối đủ quan hệ" cũng là một
   * câu hỏi về CẢ DANH SÁCH muốn một con số, chỉ khác là nó còn kèm điều kiện.
   * `soSanhNguon` ở trên đếm được nó khi một cột thắng rõ; khi hai cột hoà điểm
   * thì bản tóm tắt là lưới hứng — và nó chỉ có ở đây.
   *
   * Dùng `traLoi` chứ không dùng thẳng `traCuu`: `traLoi` lọc trước về những dữ
   * kiện LÀ SỐ cho ý định đếm. Thiếu phép lọc đó thì "có bao nhiêu báo cáo" hoà
   * điểm giữa "Số báo cáo trong HR" và "Báo cáo mở gần đây trong HR" — đúng cái
   * hoà mà nhánh `dem` của `traLoi` được viết ra để gỡ.
   */
  const yHoi = docYDinh(cauHoi);
  const biet = tuDaBiet(heThong);
  if (goiTen === null && (yHoi === 'dem' || yHoi === 'chua_co')) {
    const tom = traLoi(dau, cauHoi, biet);
    if (tom !== null) return noiPham(tom);
  }

  // Chỉ còn cửa "gọi thẳng tên mục" — xem khối chú thích trên.
  const kq = goiTen === null ? null : traLoi(goiTen, cauHoi, biet);
  return kq === null ? null : noiPham(kq);
}

/**
 * Những câu xuyên hệ thống mà mô hình được phép chọn.
 *
 * Cố ý KHÔNG đưa dữ kiện của từng mục vào: một trăm bộ dữ liệu × sáu dữ kiện là
 * sáu trăm nhãn, mà backend chỉ nhận 60 — chúng sẽ đẩy sạch nhãn của trang
 * người dùng đang nhìn ra khỏi danh sách. Nên ở đây chỉ có bản tóm tắt và mấy
 * câu SO CẢ DANH SÁCH, tức là đúng những câu mà không trang nào trả lời được.
 *
 * Dữ kiện của từng mục vẫn tới được, qua `nguonTheoTen` ở bước 2 của
 * `traLoiHeThong` — người dùng gõ tên mục ra là đã nói rõ họ hỏi mục nào.
 */
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
