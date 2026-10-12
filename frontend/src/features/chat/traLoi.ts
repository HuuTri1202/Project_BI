import type { ReportDataDto } from '@bi/shared';

import { formatValue } from '../reports/nhanO';
import type { DuKien, Nguon } from './nguCanh';

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
    .trim();
}

/** Từ khoá của từng ý định, thử theo THỨ TỰ này. */
const TU_KHOA: { y: YDinh; tu: string[] }[] = [
  // `ti_trong` và `so_sanh` đứng trước `cao_nhat`: "A chiếm bao nhiêu % so với
  // cao nhất" chứa cả hai, và ý chính là cái cụ thể hơn.
  { y: 'ti_trong', tu: ['chiem bao nhieu', 'ti trong', 'ti le', 'phan tram', 'bao nhieu %'] },
  { y: 'so_sanh', tu: ['so voi', 'so sanh', 'hon hay', 'cao hon', 'thap hon', 'chenh'] },
  { y: 'top_n', tu: ['top ', 'cao nhat la nhung', 'xep hang'] },
  { y: 'cao_nhat', tu: ['cao nhat', 'lon nhat', 'nhieu nhat', 'dat nhat', 'dinh cao', 'max'] },
  { y: 'thap_nhat', tu: ['thap nhat', 'nho nhat', 'it nhat', 're nhat', 'min'] },
  { y: 'trung_binh', tu: ['trung binh', 'binh quan'] },
  { y: 'tong', tu: ['tong', 'cong lai', 'tat ca la bao nhieu'] },
  { y: 'dem', tu: ['bao nhieu nhom', 'co may', 'so luong nhom', 'may nhom', 'bao nhieu muc'] },
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
 * Câu hỏi này đang hỏi gì? `null` = không nhận ra.
 *
 * Không có `gia_tri` trong bảng từ khoá: nó không có từ khoá riêng nào cả
 * ("Miền Bắc bao nhiêu"), nên nó được thử ở `tinhBang` bằng cách tìm xem câu
 * hỏi có nhắc tên nhóm nào không. Đặt một từ khoá kiểu "bao nhieu" vào đây sẽ
 * nuốt luôn mọi câu hỏi khác.
 */
export function docYDinh(cauHoi: string): YDinh | null {
  const q = chuanHoa(cauHoi);
  for (const { y, tu } of TU_KHOA) {
    if (tu.some((t) => q.includes(t))) return y;
  }
  return null;
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

function ghep(cau: string, luuY: string | null): string {
  return luuY === null ? cau : `${cau} — ${luuY}`;
}

/** Nhóm câu hỏi TÍNH TOÁN, chỉ dùng được khi nguồn có `bang`. */
function tinhBang(bang: ReportDataDto, cauHoi: string, y: YDinh | null): TraLoi | null {
  const { rows, measureLabel, dimensionLabel } = bang;
  if (rows.length === 0) return { cau: 'Biểu đồ này hiện không có dòng nào để tính.', so: [] };

  const doc = (v: number): string => formatValue(v, bang.format);
  const cat = luuYCat(bang);
  const tong = rows.reduce((s, r) => s + r.value, 0);

  switch (y) {
    case 'cao_nhat':
    case 'thap_nhat': {
      const lon = y === 'cao_nhat';
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
      const soNhom = new Set(rows.map((r) => r.label)).size;
      return {
        cau: ghep(`Có ${String(soNhom)} ${dimensionLabel} trên biểu đồ này.`, cat),
        so: [String(soNhom)],
      };
    }

    case 'top_n': {
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
      const gia = doc(dong.value);
      return { cau: `${measureLabel} của ${tenDong(dong)} là ${gia}.`, so: [gia] };
    }
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
  const tuHoi = new Set(
    chuanHoa(cauHoi)
      .split(' ')
      .filter((t) => t.length > 1),
  );
  if (tuHoi.size === 0) return null;

  const diem = duKien.map((d) => ({
    d,
    diem: chuanHoa(d.nhan)
      .split(' ')
      .filter((t) => tuHoi.has(t)).length,
  }));
  diem.sort((a, b) => b.diem - a.diem);

  const nhat = diem[0];
  const nhi = diem[1];
  if (nhat === undefined || nhat.diem < 2) return null;
  if (nhi !== undefined && nhi.diem === nhat.diem) return null;

  return {
    cau: ghep(`${nhat.d.nhan}: ${nhat.d.gia}.`, nhat.d.luuY ?? null),
    so: [nhat.d.gia],
  };
}

/**
 * Trả lời một câu hỏi về MỘT nguồn. `null` = chưa hiểu.
 *
 * Thử tính toán trước rồi mới tra cứu: câu "tổng doanh thu bao nhiêu" trên một
 * biểu đồ cũng trùng vài từ với dữ kiện "Tổng số dòng", và một con số về số
 * dòng trả lời cho câu hỏi về doanh thu là đúng kiểu sai không ai phát hiện.
 */
export function traLoi(nguon: Nguon, cauHoi: string): TraLoi | null {
  if (chuanHoa(cauHoi) === '') return null;

  const y = docYDinh(cauHoi);
  if (nguon.bang !== undefined) {
    const tinh = tinhBang(nguon.bang, cauHoi, y);
    if (tinh !== null) return tinh;
  }
  return traCuu(nguon.duKien, cauHoi);
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

function tuNoiDung(s: string): Set<string> {
  return new Set(
    chuanHoa(s)
      .split(' ')
      .filter((t) => t.length > 1 && !TU_DEM.has(t)),
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
}

/**
 * Thuộc tính mà câu hỏi đang nhắc tới, trong số các cột so được của trang.
 *
 * Một thuộc tính chỉ được tính là "so được" khi có mặt ở TỪ HAI mục. Điều kiện
 * đó cũng là thứ loại nguồn tóm tắt ra khỏi danh sách mục: ở trang chi tiết mô
 * hình, nhãn "Mô hình X dựng từ tệp nào" nhắc đúng tên nguồn tóm tắt nên trông
 * như một thuộc tính, nhưng không bảng nào khác có nó.
 */
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
  const muc: Muc[] = [...chiSo]
    .sort((a, b) => a - b)
    .flatMap((i) => {
      const n = tatCa[i];
      return n === undefined ? [] : [{ i, ten: n.ten }];
    });
  return { cot, muc };
}

/**
 * Cột mà câu hỏi đang nhắc tới. `null` = không nhận ra, hoặc hoà.
 */
function chonThuocTinh(tatCa: Nguon[], cauHoi: string): ThuocTinh | null {
  const { cot: soDuoc, muc } = gomThuocTinh(tatCa);
  if (muc.length < 2) return null;

  const tuHoi = tuNoiDung(cauHoi);
  const diem = soDuoc
    .map((g) => ({ g, diem: [...tuNoiDung(g.nhan)].filter((t) => tuHoi.has(t)).length }))
    .sort((a, b) => b.diem - a.diem);

  const [nhat, nhi] = diem;
  if (nhat === undefined || nhat.diem === 0) return null;
  // Hoà nghĩa là câu hỏi chưa đủ rõ để biết nó hỏi cột nào. Chọn bừa một cột
  // sẽ cho ra một tên mục có thật, trả lời cho một câu hỏi khác.
  if (nhi !== undefined && nhi.diem === nhat.diem) return null;
  return { ...nhat.g, muc };
}

/**
 * Ý định so sánh khi tính từ chen vào GIỮA — "nhiều cột nhất", "ít bảng nhất".
 *
 * Hai thứ `docYDinh` không làm được, và cả hai đều vì nó so từ khoá liền nhau:
 *
 *   - Trượt "ít báo cáo nhất", vì từ khoá của nó là "it nhat".
 *   - Tệ hơn: "ít báo cáo nhất" CHỨA chuỗi "cao nhat" (của chữ "báo cáo"), nên
 *     nó không trượt mà trả về `cao_nhat` — ngược hẳn câu hỏi.
 *
 * Vì vậy ở nhánh so giữa các mục, hàm này được hỏi TRƯỚC `docYDinh`. Chỉ ở đây
 * thôi: chữ "nào" đã chắc chắn có mặt rồi nên một chữ "nhất" là đủ để kết luận,
 * còn ngoài kia thì không — "chiếm bao nhiêu % so với cao nhất" cũng có "nhất".
 */
function sieuNhat(q: string): YDinh | null {
  if (!/(^| )nhat($| )/.test(q)) return null;
  return /(^| )(it|thap|nho|re|hiem|cu)( |$)/.test(q) ? 'thap_nhat' : 'cao_nhat';
}

/**
 * Trả lời câu hỏi "mục NÀO …" bằng cách so mọi mục đang hiện. `null` = chưa hiểu.
 *
 * Ba cửa phải qua hết: đúng ý định so sánh, câu hỏi có chữ "nào", và đúng MỘT
 * thuộc tính khớp. Chặt như vậy vì hàm này chạy TRƯỚC `traLoi` — một lần nhận
 * nhầm ở đây là cướp mất câu trả lời đúng của nguồn đang chọn.
 */
export function soSanhNguon(tatCa: Nguon[], cauHoi: string): TraLoi | null {
  const q = chuanHoa(cauHoi);
  if (!q.split(' ').includes('nao')) return null;
  const y = sieuNhat(q) ?? docYDinh(cauHoi);
  if (y !== 'cao_nhat' && y !== 'thap_nhat' && y !== 'chua_co') return null;

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
  const tren = `so trên ${soMuc} mục đang hiện trên trang này`;

  if (y === 'chua_co') {
    const thieu = tt.muc.filter((m) => laTrong(tt.gia.get(m.i)));
    if (thieu.length === 0) {
      return {
        cau: `Không mục nào — cả ${soMuc} mục đang hiện trên trang này đều có "${tt.nhan}".`,
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

/** "A, B và C" — không phải "A và B và C". */
function noiTen(ten: string[]): string {
  const cuoi = ten[ten.length - 1] ?? '';
  return ten.length < 2 ? cuoi : `${ten.slice(0, -1).join(', ')} và ${cuoi}`;
}

/**
 * Câu mẫu cho nhóm câu hỏi so sánh, sinh từ chính các cột so được của trang.
 *
 * Người dùng không đoán được là hỏi được kiểu này; viết cứng vài câu thì lại
 * gợi ý sai trên trang không có cột nào so được. Lấy thẳng tên cột ra là cách
 * duy nhất mà gợi ý luôn đúng với trang đang mở.
 */
export function goiYSoSanh(tatCa: Nguon[]): string[] {
  const { cot, muc } = gomThuocTinh(tatCa);
  if (muc.length < 2) return [];
  // Chỉ gợi ý cột SO ĐƯỢC bằng phép so số. Gợi ý "cao nhất" trên một cột toàn
  // chữ là dạy người dùng hỏi một câu chắc chắn nhận về "tôi chưa hiểu".
  return cot
    .filter((g) => [...g.gia.values()].filter((d) => soVi(d.gia) !== null).length >= 2)
    .slice(0, 2)
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
  return (
    soSanhNguon(tatCa, cauHoi) ??
    (goiTen === null ? null : traLoi(goiTen, cauHoi)) ??
    traLoi(chon, cauHoi)
  );
}
