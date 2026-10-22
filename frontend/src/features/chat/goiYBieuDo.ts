import {
  CHART_SHELF_LABELS,
  CHART_TYPE_HINTS,
  CHART_TYPE_LABELS,
  type ChartType,
  type ExplorerFieldDto,
  type ExplorerFieldsDto,
} from '@bi/shared';

import { chuanHoa } from './traLoi';
import type { TraLoi } from './traLoi';

/**
 * "Tui muốn xem doanh thu theo khu vực" — kéo trường nào, chọn biểu đồ nào.
 *
 * ═══ Vì sao nó KHÔNG phải một câu trả lời bằng số liệu ═════════════════════
 *
 * Mọi đường khác của khung đều kết thúc ở một con số đã có. Đường này kết thúc
 * ở một HƯỚNG DẪN: người dùng đang đứng trước một ô biểu đồ trống và một cột
 * bốn chục trường, và thứ họ thiếu không phải con số — là biết kéo cái nào vào
 * đâu. Trả về một con số ở đây là trả lời đúng cho một câu hỏi khác.
 *
 * ═══ Ý ĐỊNH tách khỏi phép KHỚP — hai việc, hai hàm ═══════════════════════
 *
 * Bản đầu nhét cả hai vào một: không có từ ý định trong danh sách thì không
 * khớp gì hết. Đo được là 10/30, và 8 ca trượt chỉ vì cách nói nằm ngoài một
 * danh sách viết tay — "cho tui xem", "biểu đồ …", "phân tích", "so sánh".
 * Danh sách ấy không bao giờ đóng lại được; đó là chính điều người dùng lo:
 *
 *   "ko dựa vào chat bằng câu chữ của khách hàng vì nó rất rộng"
 *
 * Giờ `goiYBieuDo` chỉ trả lời MỘT câu: "câu này gọi tên cặp trường nào". Còn
 * "họ muốn một con số hay một biểu đồ" là việc của `muonVe` và của thứ tự gọi
 * ở panel — một câu không có chữ ý định nào vẫn được khớp, chỉ là nó đứng SAU
 * đường số liệu thay vì trước.
 *
 * ═══ Nhãn ô và tên loại biểu đồ MƯỢN của `@bi/shared` ══════════════════════
 *
 * `CHART_SHELF_LABELS` là đúng mấy chữ đang in trên ba cái ô ở cột phải, và nó
 * đổi theo loại biểu đồ (ô "Chiều dữ liệu" của biểu đồ cột là trục X, của thanh
 * ngang là trục Y). Viết cứng "ô Trục" ở đây là hướng dẫn người dùng đi tìm một
 * cái ô không tồn tại — và sẽ lệch thêm một lần nữa ở lần ai đó đổi tên ô.
 *
 * `CHART_TYPE_HINTS` cũng vậy: câu giải thích vì sao chọn loại này đã có sẵn
 * ngay dưới hàng tám cái nút, nên khung nói LẠI đúng câu đó chứ không tự chế
 * một câu thứ hai để hai chỗ lệch nhau.
 */

/**
 * Chữ nói "tôi muốn DỰNG", không phải "cho tôi con số".
 *
 * ⚠️ Danh sách này KHÔNG cần đóng, và đó là chỗ khác hẳn bản đầu. Thiếu một
 * cách nói ở đây không còn làm câu hỏi trượt hẳn — nó chỉ làm đường vẽ đứng
 * sau đường số liệu, và vẫn được thử. Xem thứ tự gọi trong `HoiDapPanel`.
 *
 * ⚠️ Toàn cụm hai chữ trở lên, trừ mấy cụm đã tự đủ nghĩa. Một chữ như "ve"
 * (vẽ) sau khi bỏ dấu trùng với "về" — giới từ phổ biến nhất tiếng Việt — nên
 * nó sẽ bật đường này cho gần như mọi câu hỏi. Cùng cái bẫy mà `chuanHoa` đã
 * ghi với chữ "đ".
 */
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

/** Câu này xin một BIỂU ĐỒ, không xin một con số. */
export function muonVe(cauHoi: string): boolean {
  const q = chuanHoa(cauHoi);
  return TU_Y_DINH.some((t) => q.includes(t));
}

/** Chữ của câu hỏi, không phải của dữ liệu — bỏ đi trước khi chấm điểm. */
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
]);

export interface GoiYBieuDo {
  chieu: ExplorerFieldDto;
  thuocDo: ExplorerFieldDto;
  loai: ChartType;
}

/**
 * Trường khớp NHẤT với một vế của câu hỏi. Hoà điểm = `null`.
 *
 * Hoà thì bỏ, không bẻ hoà bằng một luật phụ. Hai trường cùng điểm nghĩa là câu
 * hỏi không đủ để phân biệt chúng, và một hướng dẫn kéo nhầm trường dẫn người
 * dùng dựng ra một biểu đồ đúng hình, sai số liệu — thứ họ sẽ không kiểm lại.
 */
function chamTruong(ds: ExplorerFieldDto[], ve: Set<string>): ExplorerFieldDto | null {
  const diem = ds.map((f) => ({
    f,
    d: [...new Set(chuanHoa(f.label).split(' '))].filter((t) => ve.has(t)).length,
  }));
  const cao = Math.max(0, ...diem.map((x) => x.d));
  if (cao === 0) return null;
  const nhat = diem.filter((x) => x.d === cao);
  return nhat.length === 1 ? (nhat[0]?.f ?? null) : null;
}

/** Tách thành từ, bỏ chữ của câu hỏi. */
function tuNoiDung(ve: string): Set<string> {
  return new Set(ve.split(' ').filter((t) => t !== '' && !TU_THUA.has(t)));
}

/**
 * Loại biểu đồ mà câu hỏi GỌI THẲNG TÊN. `null` = không gọi, hoặc gọi hai cái.
 *
 * ═══ Vì sao đòi có chữ "biểu đồ"/"dạng"/"kiểu" đứng trước ═════════════════
 *
 * Vì mấy chữ phân biệt loại biểu đồ cũng là chữ thường ngày, và một trong số
 * đó va vào đúng câu hỏi hay gặp nhất:
 *
 *     "tui muốn xem doanh thu theo MIỀN"
 *
 * "miền" một mình là `area`. Nhận nó ở đây thì một câu hỏi về vùng địa lý biến
 * thành một lệnh đổi loại biểu đồ — im lặng, và đúng kiểu dữ liệu. "cột",
 * "đường", "bảng" cũng vậy: tên cột, tên đường phố, tên bảng.
 *
 * ⚠️ Danh sách SINH RA từ `CHART_TYPE_LABELS`, không chép tay. Thêm loại biểu
 * đồ thứ chín là nó tự nhận ra, và không có bản sao thứ hai để quên.
 */
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

/**
 * Loại biểu đồ hợp với thứ vừa chọn.
 *
 * Bốn luật, và không hơn. Mỗi luật thêm vào là một chỗ khung nói chắc chắn về
 * một thứ nó không biết: số nhóm, độ dài tên nhóm, hình dạng phân bố — không
 * thứ nào đọc được từ danh sách trường. `bar` là mặc định mà chính
 * `CHART_TYPE_HINTS` đã khai ("Chọn mặc định khi chưa biết chọn gì").
 *
 * ⚠️ Người dùng GỌI TÊN thì họ thắng, kể cả khi chiều là thời gian. Họ đang
 * nhìn màn hình và họ nói ra rồi; vẽ loại khác là bỏ ngoài tai.
 */
function loaiHop(chieu: ExplorerFieldDto, q: string): ChartType {
  const goiTen = loaiGoiTen(q);
  if (goiTen !== null) return goiTen;
  if (chieu.cubeType === 'time') return 'line';
  if (/ti trong|ty trong|co cau|phan tram|ti le|ty le|%/.test(q)) return 'pie';
  return 'bar';
}

/**
 * `null` = trang không có ô nào để kéo vào, hoặc không đoán chắc được trường
 * nào. KHÔNG còn phụ thuộc vào việc câu có chữ ý định hay không — xem `muonVe`.
 *
 * ⚠️ Nhận cả `undefined` thay vì bắt nơi gọi kiểm trước. Bản đầu có một câu
 * `if` ở panel, và nó THỪA: danh sách trường rỗng thì phép chấm điểm tự trả về
 * `null`. Nhận ở đây thì kiểu dữ liệu lo việc đó — không có câu `if` nào để ai
 * quên ở lời gọi thứ hai.
 */
export function goiYBieuDo(
  truong: ExplorerFieldsDto | undefined,
  cauHoi: string,
): GoiYBieuDo | null {
  if (truong === undefined) return null;
  const q = chuanHoa(cauHoi);

  /*
   * "theo" (và "từng") tách câu làm hai vế, và đó là tín hiệu mạnh nhất có
   * trong câu: vế SAU là chiều, vế TRƯỚC là thước đo. "Doanh thu theo khu vực"
   * — không cần hiểu gì thêm về tiếng Việt.
   *
   * Không có chữ nào tách thì chấm cả hai danh sách trên cả câu. Yếu hơn, nhưng
   * hai danh sách vốn rời nhau nên một thước đo không thể thắng ở ô chiều.
   */
  const cat = q.split(/ theo | tung /);
  const veDo = tuNoiDung(cat[0] ?? q);
  const veChieu = tuNoiDung(cat.length > 1 ? (cat[cat.length - 1] ?? '') : q);

  const chieu = chamTruong(truong.dimensions, veChieu);
  const thuocDo = chamTruong(truong.measures, veDo);
  if (chieu === null || thuocDo === null) return null;

  return { chieu, thuocDo, loai: loaiHop(chieu, q) };
}

/**
 * Hướng dẫn thành câu — và thành danh sách chuỗi mà lớp diễn đạt KHÔNG được
 * làm biến mất.
 *
 * `so` ở đây không mang con số nào; nó mang TÊN TRƯỜNG và TÊN LOẠI BIỂU ĐỒ.
 * Luật đối chiếu ở backend chỉ hỏi "mọi chuỗi trong `so` còn nguyên không", nên
 * cùng một cơ chế canh được cả hai: mô hình viết lại cho mượt thì được, đổi
 * "Doanh thu" thành "doanh số" thì câu bị bỏ và câu mẫu ở lại. Một hướng dẫn
 * gọi sai tên trường thì người dùng tìm cả buổi không thấy nó trong cột.
 */
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

/**
 * ═══ ĐỀ XUẤT SẴN: không gian đầu ra ĐÓNG ══════════════════════════════════
 *
 * Người dùng nói ra được vô hạn câu; mô hình này dựng được một số HỮU HẠN biểu
 * đồ — đúng `chiều × thước đo` của nó. Nên cách chắc chắn nhất để hiểu đúng ý
 * không phải hiểu câu giỏi hơn, mà là bày sẵn mấy cái tốt nhất để bấm. Cùng
 * nguyên tắc mà khung đã áp cho lớp mô hình: nó chỉ chọn một chỉ số trong một
 * danh sách người khác dựng, không bao giờ tự viết ra một câu trả lời.
 *
 * ⚠️ Mọi phép xếp hạng ở đây chỉ dùng thứ ĐỌC ĐƯỢC từ danh sách trường: tên
 * bảng và kiểu dữ liệu. Số nhóm, độ dài tên nhóm, hình dạng phân bố — ba thứ
 * quyết định một biểu đồ có đọc được hay không — đều không có trong tay, và
 * đoán chúng là nói chắc về một thứ mình không biết.
 */

/** Điểm của một cặp. Chỉ hai luật, và cả hai đều đọc được từ chính trường. */
function diemCap(chieu: ExplorerFieldDto, thuocDo: ExplorerFieldDto): number {
  // CÙNG BẢNG trước: cặp đó không cần quan hệ nào bắc qua, nên nó luôn vẽ ra
  // được. Cặp bắc qua hai bảng phụ thuộc vào một quan hệ mà danh sách trường
  // không nói gì về nó.
  const cungBang = chieu.datasetName === thuocDo.datasetName ? 2 : 0;
  // Rồi tới THỜI GIAN: "theo tháng" gần như luôn là câu người ta hỏi trước.
  return cungBang + (chieu.cubeType === 'time' ? 1 : 0);
}

/**
 * Mấy biểu đồ đáng dựng nhất của mô hình này, nhiều nhất `tran` cái.
 *
 * ⚠️ Mặc định tối đa HAI cặp cho mỗi thước đo. Không có trần đó thì một thước
 * đo nhiều chiều cùng bảng chiếm sạch danh sách, và người dùng mở khung ra chỉ
 * thấy năm biến thể của cùng một con số.
 *
 * `moiThuocDo` nới ra cho danh sách gửi cho MÔ HÌNH chọn: ở đó không ai phải
 * đọc hết, và thứ quý nhất là ĐỘ PHỦ — thiếu một cặp nghĩa là mô hình không có
 * cách nào chọn đúng nó. Xem `nhoMoHinhChon`.
 */
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

/**
 * Tên đề xuất — ĐÚNG công thức tiêu đề mà ô sẽ mang sau khi vẽ (`titleOf`).
 *
 * Lệch một chữ là người dùng bấm "Doanh thu theo Khu vực" rồi nhìn lên thấy ô
 * tên khác, và phải tự đoán xem có phải cái mình vừa bấm không.
 */
export function tenDeXuat(g: GoiYBieuDo): string {
  return `${g.thuocDo.label} theo ${g.chieu.label}`;
}
