import {
  CHART_SHELF_LABELS,
  CHART_SORT_LABELS,
  CHART_TYPE_HINTS,
  CHART_TYPE_LABELS,
  type ChartSort,
  type ChartType,
  type ExplorerFieldDto,
  type ExplorerFieldsDto,
} from '@bi/shared';

import type { DuKien } from './nguCanh';
import { chuanHoa } from './traLoi';
import type { TraLoi } from './traLoi';

const TU_Y_DINH = [
  'muon xem',
  'muon ve',
  'muon tao',
  'muon dung',
  'muon co',
  'lam sao',
  'lam the nao',
  'cach nao',
  've bieu do',
  'tao bieu do',
  'dung bieu do',
  'bieu do nao',
  'keo gi',
  'keo truong nao',
  'hien thi',
  'cho tui xem',
  'cho toi xem',
  'bieu do',
  'phan tich',
  'so sanh',
  'xu huong',
  'dung cho',
  've giup',
  've cho',
];

const TU_THOI_GIAN = [
  'thang',
  'quy',
  'nam',
  'tuan',
  'thoi gian',
  'xu huong',
  'dien bien',
  'tang truong',
];

export function muonVe(cauHoi: string): boolean {
  const q = chuanHoa(cauHoi);
  return TU_Y_DINH.some((t) => q.includes(t));
}

const TU_THUA = new Set([
  'tui',
  'toi',
  'minh',
  'muon',
  'xem',
  've',
  'tao',
  'dung',
  'co',
  'lam',
  'sao',
  'the',
  'nao',
  'cach',
  'bieu',
  'do',
  'keo',
  'truong',
  'gi',
  'hien',
  'thi',
  'giup',
  'cho',
  'mot',
  'cai',
  'thi',
  'la',
  /*
   * ⚠️ Mấy chữ đệm cuối câu — thêm vào vì `conLai` dưới đây ĐẾM chữ còn lại.
   *
   * "tui muốn xem discount như thế nào": `the` và `nao` đã có trong danh sách,
   * nhưng `nhu` thì chưa — và một chữ sót lại là đủ để `conLai` kết luận người
   * dùng đang nói về một chiều nào đó, rồi chặn phép điền hộ.
   *
   * Danh sách này KHÔNG cần đóng, và đó là lý do nó được phép tồn tại: sót một
   * chữ đệm thì câu hỏi rơi xuống lớp mô hình thay vì được trả lời ngay tại
   * máy. Mất một nhịp, không mất câu trả lời — ngược hẳn với một danh sách mà
   * thiếu một mục là trượt hẳn.
   */
  'nhu',
  'duoc',
  'voi',
  'nhe',
]);

export interface GoiYBieuDo {
  chieu: ExplorerFieldDto;
  thuocDo: ExplorerFieldDto;
  loai: ChartType;
}

function topTruong(ds: ExplorerFieldDto[], ve: Set<string>): ExplorerFieldDto[] {
  const diem = ds.map((f) => ({
    f,
    d: [...new Set(chuanHoa(f.label).split(' '))].filter((t) => ve.has(t)).length,
  }));
  const cao = Math.max(0, ...diem.map((x) => x.d));
  return cao === 0 ? [] : diem.filter((x) => x.d === cao).map((x) => x.f);
}

function chamTruong(ds: ExplorerFieldDto[], ve: Set<string>): ExplorerFieldDto | null {
  const top = topTruong(ds, ve);
  return top.length === 1 ? (top[0] ?? null) : null;
}

function tuNoiDung(ve: string): Set<string> {
  return new Set(ve.split(' ').filter((t) => t !== '' && !TU_THUA.has(t)));
}

function loaiGoiTen(q: string): ChartType | null {
  const trung = (Object.keys(CHART_TYPE_LABELS) as ChartType[]).filter((loai) => {
    const day = chuanHoa(CHART_TYPE_LABELS[loai]);
    // "bieu do tron" -> "tron"; "ban do nhiet" -> "nhiet"; "bang so lieu" -> "so lieu"
    const rut = day.replace(/^(bieu do|ban do|bang) /, '');
    return [day, `bieu do ${rut}`, `dang ${rut}`, `kieu ${rut}`].some((t) => q.includes(t));
  });
  // Gọi tên hai loại thì không loại nào được chọn — cùng luật nhường-khi-hoà
  // với phép chấm điểm trường.
  return trung.length === 1 ? (trung[0] ?? null) : null;
}

function loaiHop(chieu: ExplorerFieldDto, q: string): ChartType {
  const goiTen = loaiGoiTen(q);
  if (goiTen !== null) return goiTen;
  if (chieu.cubeType === 'time') return 'line';
  if (/ti trong|ty trong|co cau|phan tram|ti le|ty le|%/.test(q)) return 'pie';
  return 'bar';
}

export function goiYBieuDo(
  truong: ExplorerFieldsDto | undefined,
  cauHoi: string,
): GoiYBieuDo | null {
  if (truong === undefined) return null;
  const q = chuanHoa(cauHoi);

  const { veDo, veChieu } = veTruong(truong, q);
  const thuocDo = chamTruong(truong.measures, veDo);
  if (thuocDo === null) return null;

  const chieu = chamTruong(truong.dimensions, veChieu) ?? doanChieu(truong, thuocDo, q, veChieu);
  if (chieu === null) return null;

  return { chieu, thuocDo, loai: loaiHop(chieu, q) };
}

function doanChieu(
  truong: ExplorerFieldsDto,
  thuocDo: ExplorerFieldDto,
  q: string,
  veChieu: Set<string>,
): ExplorerFieldDto | null {
  if (TU_THOI_GIAN.some((t) => q.includes(t))) {
    const tg = truong.dimensions.filter((d) => d.cubeType === 'time');
    /*
     * DỪNG HẲN ở đây, không rơi xuống luật (2).
     *
     * Hai chiều thời gian (ngày đặt, ngày giao) thì "theo tháng" không chỉ ra
     * cái nào — và luật (2) sẽ lặng lẽ điền một chiều KHÔNG phải thời gian, tức
     * là bỏ ngoài tai đúng cái người dùng vừa nói. `goiYMoHo` hỏi lại ở đó.
     */
    return tg.length === 1 ? (tg[0] ?? null) : null;
  }
  if (topTruong(truong.dimensions, veChieu).length > 0 || !muonVe(q)) return null;

  /*
   * ⚠️ CHỐT: luật (2) chỉ đúng khi câu THẬT SỰ không nói gì về chiều.
   *
   * Lỗi đo được: "tui muốn xem khu vực có discount như thế nào" trên mô hình
   * Global-Superstore ra "Discount theo Order Date". Thước đo đúng, chiều sai
   * hẳn — và sai vì một lý do khó chịu: người dùng ĐÃ nói ra chiều họ muốn
   * ("khu vực"), chỉ là trường tên "Region" nên phép so từ khoá không bắt
   * được một chữ nào. Luật (2) đọc "không khớp chiều nào" thành "không nói gì
   * về chiều", rồi điền hộ một chiều thời gian vì `diemCap` cộng điểm cho nó.
   *
   * Hai cách đọc đó khác nhau ở đúng chỗ quan trọng nhất. "Không nói gì" thì
   * điền hộ là giúp; "có nói mà ta không hiểu" thì điền hộ là BỎ NGOÀI TAI
   * đúng phần người dùng vừa gõ ra — và vì kết quả hiện lên kèm tên đọc được,
   * họ sẽ tưởng khung đã hiểu rồi hiểu sai.
   *
   * `conLai` phân biệt hai cách đọc ấy: còn chữ nào không giải thích được bằng
   * chính thước đo vừa khớp thì nhường, để câu rơi xuống lớp mô hình — lớp DUY
   * NHẤT có cửa hiểu "khu vực" là "Region". Xem `capChoMoHinh`.
   */
  if (conLai(q, thuocDo).size > 0) return null;

  const xep = truong.dimensions
    .map((c) => ({ c, diem: diemCap(c, thuocDo) }))
    .sort((a, b) => b.diem - a.diem);
  return xep[0]?.c ?? null;
}

export function goiYMoHo(truong: ExplorerFieldsDto | undefined, cauHoi: string): GoiYBieuDo[] {
  if (truong === undefined || goiYBieuDo(truong, cauHoi) !== null) return [];

  const q = chuanHoa(cauHoi);
  const { veDo, veChieu } = veTruong(truong, q);
  const thuocDo = topTruong(truong.measures, veDo);
  let chieu = topTruong(truong.dimensions, veChieu);

  // Nhắc tới thời gian mà mô hình có nhiều hơn một chiều thời gian — ứng viên
  // chính là mấy chiều đó. Xem khối "DỪNG HẲN" trong `doanChieu`.
  if (chieu.length === 0 && TU_THOI_GIAN.some((t) => q.includes(t))) {
    chieu = truong.dimensions.filter((d) => d.cubeType === 'time');
  }

  if (chieu.length === 0 || thuocDo.length === 0) return [];
  if (chieu.length > 1 && thuocDo.length > 1) return [];

  return chieu.flatMap((c) => thuocDo.map((d) => ({ chieu: c, thuocDo: d, loai: loaiHop(c, q) })));
}

function hangVe(q: string): { veDo: Set<string>; veChieu: Set<string> } {
  const cat = q.split(/ theo | tung /);
  return {
    veDo: tuNoiDung(cat[0] ?? q),
    veChieu: tuNoiDung(cat.length > 1 ? (cat[cat.length - 1] ?? '') : q),
  };
}

function veTruong(
  truong: ExplorerFieldsDto,
  q: string,
): { veDo: Set<string>; veChieu: Set<string> } {
  const { veDo, veChieu } = hangVe(q);
  const ca = tuNoiDung(q);
  return {
    veDo: topTruong(truong.measures, veDo).length > 0 ? veDo : ca,
    veChieu: topTruong(truong.dimensions, veChieu).length > 0 ? veChieu : ca,
  };
}

function conLai(q: string, thuocDo: ExplorerFieldDto): Set<string> {
  const cua = new Set(chuanHoa(thuocDo.label).split(' '));
  return new Set([...tuNoiDung(q)].filter((t) => !cua.has(t)));
}

export function cauGoiY(g: GoiYBieuDo): TraLoi {
  const o = CHART_SHELF_LABELS[g.loai];
  const ten = CHART_TYPE_LABELS[g.loai];
  const bang = (f: ExplorerFieldDto): string => `"${f.label}" (bảng ${f.datasetName})`;

  return {
    cau:
      `Kéo ${bang(g.chieu)} vào ô ${o.dimension}, ${bang(g.thuocDo)} vào ô ${o.measure}, ` +
      `rồi chọn ${ten}.\n${ten} — ${CHART_TYPE_HINTS[g.loai]}`,
    so: [g.chieu.label, g.thuocDo.label, ten],
  };
}

function diemCap(chieu: ExplorerFieldDto, thuocDo: ExplorerFieldDto): number {
  // CÙNG BẢNG trước: cặp đó không cần quan hệ nào bắc qua, nên nó luôn vẽ ra
  // được. Cặp bắc qua hai bảng phụ thuộc vào một quan hệ mà danh sách trường
  // không nói gì về nó.
  const cungBang = chieu.datasetName === thuocDo.datasetName ? 2 : 0;
  // Rồi tới THỜI GIAN: "theo tháng" gần như luôn là câu người ta hỏi trước.
  return cungBang + (chieu.cubeType === 'time' ? 1 : 0);
}

export function deXuatBieuDo(
  truong: ExplorerFieldsDto | undefined,
  tran = 5,
  moiThuocDo = 2,
): GoiYBieuDo[] {
  if (truong === undefined) return [];

  const cap = truong.measures.flatMap((thuocDo) =>
    truong.dimensions
      .map((chieu) => ({ chieu, thuocDo, diem: diemCap(chieu, thuocDo) }))
      // `sort` của JS ỔN ĐỊNH từ ES2019, nên cặp cùng điểm giữ nguyên thứ tự
      // của chính cột trường — thứ tự người dùng đang nhìn thấy.
      .sort((a, b) => b.diem - a.diem)
      .slice(0, moiThuocDo),
  );

  return cap
    .sort((a, b) => b.diem - a.diem)
    .slice(0, tran)
    .map(({ chieu, thuocDo }) => ({ chieu, thuocDo, loai: loaiHop(chieu, '') }));
}

export function capChoMoHinh(
  truong: ExplorerFieldsDto | undefined,
  cauHoi: string,
  tran = 20,
): GoiYBieuDo[] {
  if (truong === undefined) return [];
  const q = chuanHoa(cauHoi);

  const thuocDo = chamTruong(truong.measures, veTruong(truong, q).veDo);
  if (thuocDo === null) return deXuatBieuDo(truong, tran, 99);

  const rieng = truong.dimensions.map((chieu) => ({ chieu, thuocDo, loai: loaiHop(chieu, q) }));
  // Thước đo khác vẫn được góp mặt ở phần đuôi: khớp được một thước đo không
  // có nghĩa là chắc chắn người dùng muốn đúng cái đó.
  const them = deXuatBieuDo(truong, tran, 99).filter((g) => g.thuocDo.id !== thuocDo.id);
  return [...rieng, ...them].slice(0, tran);
}

export function tenDeXuat(g: GoiYBieuDo): string {
  return `${g.thuocDo.label} theo ${g.chieu.label}`;
}

export function tenPhanBiet(ds: GoiYBieuDo[]): string[] {
  const demTheo = (xs: string[]): Map<string, number> => {
    const m = new Map<string, number>();
    for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
    return m;
  };

  const tran = ds.map(tenDeXuat);
  const dem = demTheo(tran);

  // Bảng của CHIỀU gỡ được gần như mọi ca: hai bảng cùng có cột `Market`.
  const themChieu = ds.map((g, i) =>
    (dem.get(tran[i] ?? '') ?? 0) < 2
      ? (tran[i] ?? '')
      : `${tran[i] ?? ''} (bảng ${g.chieu.datasetName})`,
  );
  const dem2 = demTheo(themChieu);

  // Còn trùng nữa thì chính THƯỚC ĐO mới là chỗ khác nhau.
  return ds.map((g, i) => {
    const t = themChieu[i] ?? '';
    return (dem2.get(t) ?? 0) < 2 ? t : `${t.slice(0, -1)} · thước đo ở ${g.thuocDo.datasetName})`;
  });
}

export function capTheoId(
  truong: ExplorerFieldsDto | undefined,
  chieuId: number | undefined,
  thuocDoId: number | undefined,
  cauHoi: string,
): GoiYBieuDo | null {
  if (truong === undefined || chieuId === undefined || thuocDoId === undefined) return null;

  const chieu = truong.dimensions.find((d) => d.id === chieuId);
  const thuocDo = truong.measures.find((m) => m.id === thuocDoId);
  if (chieu === undefined || thuocDo === undefined) return null;

  return { chieu, thuocDo, loai: loaiHop(chieu, chuanHoa(cauHoi)) };
}

/* ═══ SỬA biểu đồ đã vẽ ══════════════════════════════════════════════════════
 *
 * Mọi thứ ở trên DỰNG một biểu đồ mới. Nhưng câu hỏi hay gặp nhất sau khi biểu
 * đồ hiện ra lại không phải "vẽ cái khác" — nó là "cái này nhưng gọn hơn":
 * "chỉ lấy top 5", "5 cái thấp nhất", "tách theo nhóm hàng".
 *
 * ═══ Vì sao KHÔNG có lọc, dù tui đã hứa ba thứ ═════════════════════════════
 *
 * `ReportModelConfigDto` không có ô lọc nào. Một biểu đồ ở đây là "gộp thước
 * đo theo chiều, lấy N nhóm" — không có mệnh đề WHERE để mà ghi vào. Làm lọc
 * nghĩa là thêm trường vào DTO, thêm nhánh dựng truy vấn ở backend và một ô
 * soạn lọc trong trình dựng; đó là một tính năng của trình dựng, không phải
 * một tính năng của khung chat. Nên ở đây chỉ có ba thứ CÓ THẬT.
 *
 * ═══ Vì sao mấy danh sách từ dưới đây KHÔNG phải cái bẫy đã gỡ ═════════════
 *
 * `TU_Y_DINH` bị gỡ khỏi đường vẽ vì nó đoán xem NGƯỜI DÙNG gọi ý định của họ
 * là gì — vô hạn cách nói, và thiếu một cách là trượt hẳn. Mấy từ dưới đây nói
 * về CÁI NÚT CỦA CHÍNH TA: "top", "tách theo", "thấp nhất" là tên mấy ô điều
 * khiển trong trình dựng, không phải tên trường của khách. Cùng cái ranh giới
 * đã ghi ở `DONG_NGHIA` và ở `loaiGoiTen`: từ vựng của ta thì liệt kê được,
 * từ vựng về dữ liệu của khách thì không.
 *
 * Và chúng chỉ quyết ĐƯỜNG ĐI, không quyết câu trả lời: trượt hết thì câu hỏi
 * rơi xuống đúng mọi lớp nó vẫn rơi xuống từ trước.
 */

export interface SuaBieuDo {
  soNhom?: number;
  sapXep?: ChartSort;
  chieuPhuId?: number | null;
}

const TRAN_NHOM = 200;

const TU_TACH = [
  'tach theo',
  'chia theo',
  'phan theo',
  'tach mau theo',
  'chia mau theo',
  'nhom mau theo',
  'to mau theo',
  'tach ra theo',
  'chia nho theo',
];
const TU_BO_TACH = [
  'bo tach',
  'bo chia',
  'bo mau',
  'gop lai',
  'khong tach',
  'thoi tach',
  'bo nhom mau',
  'go tach',
];

function docSoNhom(q: string): number | null {
  const m =
    /\btop\s*(\d{1,3})\b/.exec(q) ??
    /\b(\d{1,3})\s*(?:cai|nhom|muc|dong|cot|phan tu)\b/.exec(q) ??
    /\b(?:chi|lay|gioi han|rut con|con)\s*(\d{1,3})\b/.exec(q) ??
    /\b(\d{1,3})\s*(?:thoi|la du|cho gon)\b/.exec(q);
  if (m === null) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= TRAN_NHOM ? n : null;
}

function docSapXep(q: string): ChartSort | undefined {
  const xuong = /thap nhat|nho nhat|it nhat|be nhat|yeu nhat|kem nhat|tu duoi/.test(q);
  const len = /cao nhat|lon nhat|nhieu nhat|manh nhat|tot nhat|tu tren|ban chay/.test(q);
  // Nói cả hai chiều trong một câu thì không có chiều nào được chọn hộ.
  if (xuong === len) return undefined;
  return xuong ? 'value-asc' : 'value';
}

export function docSuaBieuDo(
  truong: ExplorerFieldsDto | undefined,
  cauHoi: string,
): SuaBieuDo | 'mo-ho' | null {
  const q = chuanHoa(cauHoi);

  if (TU_BO_TACH.some((t) => q.includes(t))) return { chieuPhuId: null };

  const tach = TU_TACH.find((t) => q.includes(t));
  if (tach !== undefined) {
    if (truong === undefined) return null;
    const ve = tuNoiDung(q.slice(q.indexOf(tach) + tach.length));
    const top = topTruong(truong.dimensions, ve);
    if (top.length > 1) return 'mo-ho';
    const chieu = top[0];
    return chieu === undefined ? null : { chieuPhuId: chieu.id };
  }

  const soNhom = docSoNhom(q);
  if (soNhom === null) return null;
  const sapXep = docSapXep(q);
  return sapXep === undefined ? { soNhom } : { soNhom, sapXep };
}

export function tachMoHo(
  truong: ExplorerFieldsDto | undefined,
  cauHoi: string,
): ExplorerFieldDto[] {
  const q = chuanHoa(cauHoi);
  const tach = TU_TACH.find((t) => q.includes(t));
  if (tach === undefined || truong === undefined) return [];
  return topTruong(truong.dimensions, tuNoiDung(q.slice(q.indexOf(tach) + tach.length)));
}

export function cauSua(thay: SuaBieuDo, tenChieuPhu: string | null): TraLoi {
  const ve: string[] = [];
  const so: string[] = [];

  if (thay.soNhom !== undefined) {
    ve.push(`rút còn ${String(thay.soNhom)} nhóm mỗi trang`);
    so.push(String(thay.soNhom));
  }
  if (thay.sapXep !== undefined) {
    ve.push(thay.sapXep === 'value-asc' ? 'xếp từ nhỏ lên lớn' : 'xếp từ lớn xuống nhỏ');
  }
  if (thay.chieuPhuId === null) ve.push('bỏ tách màu');
  else if (thay.chieuPhuId !== undefined && tenChieuPhu !== null) {
    ve.push(`tách màu theo "${tenChieuPhu}"`);
    so.push(tenChieuPhu);
  }

  return {
    cau: `Đã ${ve.join(', ')} cho ô đang chọn. Không ưng thì Ctrl+Z.`,
    so,
  };
}

export function duKienODangChon(o: {
  ten: string;
  loai: ChartType;
  chieu: string | null;
  thuocDo: string | null;
  chieuPhu: string | null;
  soNhom: number;
  sapXep: ChartSort;
}): DuKien[] {
  const o2 = CHART_SHELF_LABELS[o.loai];
  const d: DuKien[] = [
    { nhan: `Loại biểu đồ của ô ${o.ten}`, gia: CHART_TYPE_LABELS[o.loai] },
    { nhan: `Số nhóm mỗi trang của ô ${o.ten}`, gia: String(o.soNhom) },
    { nhan: `Thứ tự nhóm của ô ${o.ten}`, gia: CHART_SORT_LABELS[o.sapXep] },
    {
      /*
       * Ô thứ ba gọi tên KHÁC NHAU theo loại biểu đồ: "Nhóm màu" ở cột và
       * đường, "Trục Y" ở heatmap, "Cột nhóm thứ hai" ở bảng. Chép cứng một
       * cái tên ở đây là nói sai tên ô cho hai loại biểu đồ.
       */
      nhan: `Trường ở ô ${o2.series} của ${o.ten}`,
      // Nói thẳng "chưa chọn" chứ không bỏ trống dòng này: câu "ô này tách màu
      // theo gì" phải có câu trả lời, và "chưa chọn" LÀ câu trả lời đúng.
      gia: o.chieuPhu ?? 'chưa chọn',
    },
  ];
  if (o.chieu !== null) d.push({ nhan: `Trường ở ô ${o2.dimension} của ${o.ten}`, gia: o.chieu });
  if (o.thuocDo !== null) d.push({ nhan: `Trường ở ô ${o2.measure} của ${o.ten}`, gia: o.thuocDo });
  return d;
}
