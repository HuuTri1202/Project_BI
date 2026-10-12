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
  | 'xu_huong';

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
 * Bỏ dấu + hạ chữ thường, để "Cao Nhất" và "cao nhat" khớp như nhau.
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
    .replace(/\s+/g, ' ')
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
