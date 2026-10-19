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
  const chuoi = chuanHoa(bang.seriesLabel);
  const truc = chuanHoa(bang.dimensionLabel);
  const coChuoi = chuoi !== '' && q.includes(chuoi);
  const coTruc = truc !== '' && q.includes(truc);

  if (coChuoi !== coTruc) return coChuoi ? 'series' : 'label';

  // Không gọi tên chiều nào: giữ cách cũ, trả lời bằng dòng lớn nhất.
  if (!coChuoi) return null;

  /*
   * Gọi tên CẢ HAI. Gần như luôn là vì một tên nằm lọt trong tên kia — chiều
   * "Name" và chuỗi "Product Name" thì câu hỏi nào về cái sau cũng chứa cái
   * trước. Tên DÀI hơn là tên người dùng thật sự gõ; cùng luật đã dùng ở
   * `timDong` và `nguonTheoTen`.
   *
   * Hai tên rời nhau mà cùng được gọi thì câu hỏi thật sự lẫn lộn — trả `null`
   * để rơi về câu trả lời gọi đủ cả hai tên, thay vì chọn bừa một chiều rồi đưa
   * ra một con số gộp mà không ai biết đã gộp theo gì.
   */
  if (chuoi !== truc && chuoi.includes(truc)) return 'series';
  if (chuoi !== truc && truc.includes(chuoi)) return 'label';
  return null;
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
): TraLoi | null {
  const { rows, measureLabel, dimensionLabel } = bang;
  if (rows.length === 0) return { cau: 'Biểu đồ này hiện không có dòng nào để tính.', so: [] };

  const doc = (v: number): string => formatValue(v, bang.format);
  const cat = luuYCat(bang);
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
        cau: ghep(`Có ${String(soNhom)} ${dimensionLabel} trên biểu đồ này.`, cat),
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
          cau: ghep(`${String(nhom.length)} ${tenChieu} trên biểu đồ này: ${inTen(nhom)}.`, cat),
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

  return traLoiTheoDuKien(nhat.d);
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

/** Bỏ các cụm chỉ loại khỏi một chuỗi ĐÃ chuẩn hoá. */
function boCumLoai(q: string): string {
  let con = q;
  for (const c of CUM_LOAI) con = con.split(c).join(' ');
  return con;
}

function tuNoiDung(s: string): Set<string> {
  return new Set(
    boCumLoai(chuanHoa(s))
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
  if (!q.split(' ').includes('nao')) return null;
  const y = docYDinh(cauHoi);
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
  const tren = `so trên ${soMuc} mục ${pham}`;

  if (y === 'chua_co') {
    const thieu = tt.muc.filter((m) => laTrong(tt.gia.get(m.i)));
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
  return (
    soSanhNguon(tatCa, cauHoi) ??
    (goiTen === null ? null : traLoi(goiTen, cauHoi)) ??
    traLoi(chon, cauHoi)
  );
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
export function luaChonTrang(tatCa: Nguon[], chon: Nguon, cauHoi: string): LuaChon[] {
  const ds: LuaChon[] = [];
  const daCo = new Set<string>();

  for (const n of [chon, ...tatCa.filter((x) => x !== chon)]) {
    for (const lc of phepCuaBieuDo(n, cauHoi)) {
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
 * Trả lời bằng danh sách xuyên hệ thống. `null` = chưa hiểu.
 *
 * Ba cửa, cùng thứ tự với `traLoiTrang` và cùng lý do:
 *
 *   1. Câu hỏi so cả danh sách ("mô hình nào nhiều bảng nhất").
 *   2. Mục mà câu hỏi gọi thẳng tên ("bộ dữ liệu Orders có mấy dòng").
 *   3. Cuối cùng mới so nhãn trên TOÀN BỘ dữ kiện — chỗ duy nhất trả lời được
 *      "có bao nhiêu bộ dữ liệu", vì bản tóm tắt không bao giờ được gọi tên.
 *
 * Bước 3 lỏng hơn hai bước trên, nhưng luật "phải hơn hẳn ứng viên nhì" của
 * `traCuu` vẫn giữ: một trăm bộ dữ liệu cùng có nhãn "Số dòng của …" thì câu
 * "số dòng là bao nhiêu" hoà điểm và ra `null`, đúng như nó phải.
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
  if (goiTen === null && docYDinh(cauHoi) === 'dem') {
    const tom = traCuu(dau.duKien, cauHoi);
    if (tom !== null) return noiPham(tom);
  }

  const kq =
    (goiTen === null ? null : traLoi(goiTen, cauHoi)) ?? traCuu(duKienPhang(heThong, dau), cauHoi);
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
