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

/**
 * Chữ nói "chia theo THỜI GIAN" — và chúng là chữ của TA, không của khách.
 *
 * ⚠️ Khác hẳn "vùng" hay "lãi". Mấy chữ kia là đoán xem khách gọi TRƯỜNG của họ
 * là gì, và khối chú thích của `DONG_NGHIA` đã ghi rõ vì sao khung không được
 * làm vậy. Còn "tháng", "quý", "xu hướng" chỉ nói ra một YÊU CẦU — "chia theo
 * trục thời gian" — còn trường nào đáp ứng nó thì `cubeType === 'time'` trả
 * lời chắc chắn, không phải đoán.
 *
 * Và vì thế nó cũng dừng ngay khi hết chắc chắn: mô hình có HAI chiều thời
 * gian (ngày đặt, ngày giao) thì "theo tháng" không chỉ ra cái nào, và khung
 * nhường cho đường hỏi lại.
 */
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

/**
 * MỌI trường cùng đạt điểm cao nhất với một vế của câu hỏi. Rỗng = không ai khớp.
 *
 * Trả về cả danh sách chứ không chỉ người thắng, vì hai trường cùng điểm không
 * phải một lỗi để nuốt — nó là một câu hỏi chưa đủ rõ, và khung có đường hỏi
 * lại. Xem `goiYMoHo`.
 */
function topTruong(ds: ExplorerFieldDto[], ve: Set<string>): ExplorerFieldDto[] {
  const diem = ds.map((f) => ({
    f,
    d: [...new Set(chuanHoa(f.label).split(' '))].filter((t) => ve.has(t)).length,
  }));
  const cao = Math.max(0, ...diem.map((x) => x.d));
  return cao === 0 ? [] : diem.filter((x) => x.d === cao).map((x) => x.f);
}

/**
 * Trường khớp NHẤT. Hoà điểm = `null`.
 *
 * Hoà thì bỏ, không bẻ hoà bằng một luật phụ. Hai trường cùng điểm nghĩa là câu
 * hỏi không đủ để phân biệt chúng, và một hướng dẫn kéo nhầm trường dẫn người
 * dùng dựng ra một biểu đồ đúng hình, sai số liệu — thứ họ sẽ không kiểm lại.
 */
function chamTruong(ds: ExplorerFieldDto[], ve: Set<string>): ExplorerFieldDto | null {
  const top = topTruong(ds, ve);
  return top.length === 1 ? (top[0] ?? null) : null;
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

  const { veDo, veChieu } = veTruong(truong, q);
  const thuocDo = chamTruong(truong.measures, veDo);
  if (thuocDo === null) return null;

  const chieu = chamTruong(truong.dimensions, veChieu) ?? doanChieu(truong, thuocDo, q, veChieu);
  if (chieu === null) return null;

  return { chieu, thuocDo, loai: loaiHop(chieu, q) };
}

/**
 * Chiều mà người dùng KHÔNG nói ra — `null` = không có cơ sở nào để điền.
 *
 * ═══ Vì sao điền hộ ở đây là chính đáng, mà đoán tên trường thì không ══════
 *
 * Vì nó không giấu gì. Kết quả hiện lên dưới dạng MỘT CÁI TÊN đọc được
 * ("Doanh thu theo Ngày đặt") kèm hai cái nút, nên người dùng đọc được điều
 * khung vừa điền hộ TRƯỚC KHI nó xảy ra. Khác hẳn một con số đã tính xong trên
 * một cặp trường họ chưa bao giờ thấy.
 *
 * Hai cơ sở, không hơn:
 *
 *   1. Câu nhắc tới THỜI GIAN và mô hình có đúng MỘT chiều thời gian.
 *   2. Câu chỉ nói thước đo, không nói gì về chiều, và nó đang XIN một biểu đồ
 *      — lúc đó im lặng là câu trả lời tệ nhất, vì biểu đồ nào cũng cần một
 *      chiều và khung biết chiều nào hợp nhất với thước đo đó.
 *
 * ⚠️ `veChieu` phải RỖNG ở luật (2). Khớp được mà hoà là chuyện khác hẳn —
 * đó là lúc gọi `goiYMoHo` để hỏi lại, không phải lúc tự điền.
 */
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

/**
 * Mấy cặp mà câu hỏi khớp NGANG NHAU — rỗng = không có gì mơ hồ.
 *
 * ═══ Vì sao im lặng là câu trả lời tệ nhất ở đây ══════════════════════════
 *
 * Hoà điểm nghĩa là khung đã hiểu gần hết câu: nó biết người dùng muốn thước
 * đo nào, chỉ không biết chiều nào trong hai cái cùng tên gần giống. Trả `null`
 * ở đó là ném đi toàn bộ phần đã hiểu, để rồi hỏi lại từ đầu.
 *
 * Một câu hỏi ngược thì giữ lại tất cả, và người dùng chỉ phải trả lời đúng
 * phần còn thiếu — bằng một cú bấm. Cùng khuôn với `nguonMoHo` ở đường hỏi-đáp,
 * và dùng lại nguyên dãy nút "Gợi ý / Vẽ" đã có.
 *
 * ⚠️ Chỉ khi ĐÚNG MỘT bên hoà. Hai bên cùng hoà thì tích hai danh sách ra một
 * mớ cặp mà phần lớn chẳng liên quan gì tới câu hỏi — bày ra một màn hình lựa
 * chọn còn tệ hơn nói thẳng là chưa hiểu.
 */
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

/**
 * Cắt câu làm hai vế quanh chữ "theo" / "từng".
 *
 * Tín hiệu mạnh nhất có trong câu: vế SAU là chiều, vế TRƯỚC là thước đo.
 * "Doanh thu theo khu vực" — không cần hiểu gì thêm về tiếng Việt.
 *
 * Không có chữ nào tách thì cả câu đi vào cả hai vế. Yếu hơn, nhưng hai danh
 * sách vốn rời nhau nên một thước đo không thể thắng ở ô chiều.
 */
function hangVe(q: string): { veDo: Set<string>; veChieu: Set<string> } {
  const cat = q.split(/ theo | tung /);
  return {
    veDo: tuNoiDung(cat[0] ?? q),
    veChieu: tuNoiDung(cat.length > 1 ? (cat[cat.length - 1] ?? '') : q),
  };
}

/**
 * Hai vế, kèm một bản NỚI cho vế nào phép tách không khớp được ai.
 *
 * ═══ Vì sao thứ tự trong câu KHÔNG được phép quyết định tất cả ════════════
 *
 * `hangVe` đọc "X theo Y" là "thước đo X, chiều Y" — tín hiệu mạnh nhất có
 * trong tiếng Việt, và đúng gần như mọi lần. Nhưng người ta cũng nói ngược:
 *
 *     "khu vực theo doanh thu"     (chiều trước, thước đo sau)
 *
 * Bản trước trượt hẳn câu đó: vế trước chấm trên danh sách THƯỚC ĐO và không
 * ai khớp, nên `goiYBieuDo` trả `null` ngay, dù cả hai trường đều có tên đầy
 * đủ ngay trong câu.
 *
 * Nới thế này an toàn vì hai danh sách RỜI NHAU: một thước đo không nằm trong
 * `dimensions` và ngược lại, nên vế nới ra không thể kéo một trường sang nhầm
 * ô. Và nó chỉ chạy khi phép tách theo thứ tự đã khớp đúng không ai — khớp
 * được rồi thì giữ nguyên, kể cả khi khớp hoà (hoà là việc của `goiYMoHo`).
 */
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

/** Chữ trong câu KHÔNG giải thích được bằng thước đo vừa khớp. */
function conLai(q: string, thuocDo: ExplorerFieldDto): Set<string> {
  const cua = new Set(chuanHoa(thuocDo.label).split(' '));
  return new Set([...tuNoiDung(q)].filter((t) => !cua.has(t)));
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
 * Danh sách cặp gửi cho MÔ HÌNH chọn — xoay quanh thước đo câu hỏi đã gọi tên.
 *
 * ═══ Vì sao `deXuatBieuDo` một mình KHÔNG đủ cho chỗ này ══════════════════
 *
 * Nó xếp mọi cặp theo `diemCap` rồi cắt ở `tran`. `sort` ổn định, nên sau khi
 * mấy cặp chiều-thời-gian đứng đầu, phần còn lại giữ nguyên thứ tự `flatMap`:
 * TẤT CẢ cặp của thước đo thứ nhất, rồi mới tới thước đo thứ hai. Trên
 * Global-Superstore — năm thước đo, gần hai chục chiều — hai mươi suất đầu bị
 * một mình "Quantity" ăn gần hết, và "Discount theo Region" không bao giờ lọt
 * vào danh sách để mà được chọn.
 *
 * Mà đó đúng là danh sách mô hình ngôn ngữ nhìn vào. Thiếu một cặp ở đây
 * không phải mô hình chọn sai — nó là mô hình KHÔNG CÓ CÁCH NÀO chọn đúng.
 *
 * Nên khi câu hỏi đã gọi tên được một thước đo (phần dễ: "discount" trùng
 * nguyên chữ), mọi chiều của ĐÚNG thước đo ấy được xếp lên đầu. Phần khó —
 * "khu vực" là chiều nào — để mô hình làm, và giờ nó có đủ lựa chọn để làm.
 *
 * Không khớp thước đo nào thì rơi về danh sách chung: không có gì để xoay
 * quanh, và một danh sách rộng vẫn hơn không có danh sách.
 */
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

/**
 * Tên đề xuất — ĐÚNG công thức tiêu đề mà ô sẽ mang sau khi vẽ (`titleOf`).
 *
 * Lệch một chữ là người dùng bấm "Doanh thu theo Khu vực" rồi nhìn lên thấy ô
 * tên khác, và phải tự đoán xem có phải cái mình vừa bấm không.
 */
export function tenDeXuat(g: GoiYBieuDo): string {
  return `${g.thuocDo.label} theo ${g.chieu.label}`;
}

/**
 * Tên của MỘT DÃY đề xuất — kèm tên bảng ở đúng chỗ hai tên trùng nhau.
 *
 * ═══ Lỗi đo được ══════════════════════════════════════════════════════════
 *
 * Trên Global-Superstore, "tui muốn xem profit theo market" ra câu hỏi ngược
 * "khớp với 2 cặp trường khác nhau, bạn muốn cái nào?" — kèm HAI cái nút đọc
 * y hệt nhau: "Profit theo Market" và "Profit theo Market". Mô hình có hai
 * bảng cùng mang cột `Market`, nên `tenDeXuat` trả về cùng một chuỗi.
 *
 * Một câu hỏi ngược mà hai lựa chọn không phân biệt được thì tệ hơn hẳn việc
 * không hỏi: nó bắt người dùng chọn, rồi không cho họ cơ sở nào để chọn.
 *
 * Kèm tên bảng CHỈ ở chỗ trùng, không kèm đại trà — `backend/hoiTrenMoHinh`
 * cũng đính tên bảng vào nhãn chiều vì đúng lý do này, nhưng ở đó danh sách
 * chỉ mô hình đọc. Danh sách này người dùng đọc, nên mỗi chữ thừa là một chữ
 * phải lướt qua.
 */
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

/**
 * Cặp trường mà lớp ĐIỀN FORM vừa chọn, dựng lại thành một đề xuất biểu đồ.
 *
 * ═══ Vì sao đường này mới là đường hiểu được tiếng Việt tự do ═════════════
 *
 * `hieuY` cho mô hình chọn MỘT mục trong danh sách cặp sẵn có, nên không gian
 * lựa chọn là tích `chiều × thước đo` — nó phình theo cấp số nhân và bị cắt ở
 * trần 60 nhãn. `datCauHoi` thì cho mô hình điền `{dimensionIds, measureIds}`,
 * tức CHỌN RIÊNG từng ô, nên không gian chỉ là `chiều + thước đo` và trần của
 * nó là 120 TRƯỜNG chứ không phải 120 cặp.
 *
 * Khác biệt đó quyết định đúng thứ người dùng vừa than: "thị trường" hiểu
 * được, "market" cũng hiểu được, và hiểu được trên mô hình bao nhiêu cột cũng
 * thế — vì mô hình không phải tìm một cặp có sẵn, nó ghép hai lựa chọn độc lập.
 *
 * Lớp đó đã chạy sẵn cho câu hỏi SỐ LIỆU. Chỗ này chỉ đọc lại cái form nó vừa
 * điền và dựng thành đề xuất, thay vì vứt đi rồi nói "chưa hiểu".
 *
 * ⚠️ Id lạ thì trả `null`. Form đã qua `explorerQueryBodySchema` ở backend,
 * nhưng danh sách trường trên máy này có thể cũ hơn — ai đó vừa xoá một cột.
 */
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

/** Một thay đổi trên ô đang chọn. Trường vắng mặt = không đụng tới. */
export interface SuaBieuDo {
  /** Số nhóm mỗi trang — `ReportModelConfigDto.limit`. */
  soNhom?: number;
  sapXep?: ChartSort;
  /** `null` = bỏ tách màu. */
  chieuPhuId?: number | null;
}

/** Trần số nhóm, đúng trần mà ô soạn trong trình dựng đang ép. */
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

/**
 * Số nhóm người dùng xin — `null` = câu này không nói gì về số nhóm.
 *
 * ⚠️ Một con số TRẦN TRỤI không bao giờ đủ. "doanh thu 2024" có một con số, và
 * hiểu nó thành "lấy 2024 nhóm" thì vừa sai vừa làm biểu đồ treo. Nên con số
 * phải đi kèm một chữ nói rằng nó ĐANG ĐẾM NHÓM — và mấy chữ đó là từ vựng
 * của ô điều khiển, không phải của dữ liệu.
 */
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

/**
 * Chiều xếp hạng — đọc từ chính chữ "cao/thấp" mà người dùng dùng.
 *
 * Chỉ trả về khi câu có nói, vì `undefined` ở đây nghĩa là "giữ nguyên thứ tự
 * đang có". Đặt mặc định `'value'` là lặng lẽ bẻ thứ tự của một biểu đồ mà
 * người dùng chỉ xin đổi số nhóm.
 */
function docSapXep(q: string): ChartSort | undefined {
  const xuong = /thap nhat|nho nhat|it nhat|be nhat|yeu nhat|kem nhat|tu duoi/.test(q);
  const len = /cao nhat|lon nhat|nhieu nhat|manh nhat|tot nhat|tu tren|ban chay/.test(q);
  // Nói cả hai chiều trong một câu thì không có chiều nào được chọn hộ.
  if (xuong === len) return undefined;
  return xuong ? 'value-asc' : 'value';
}

/**
 * Đọc một câu thành thay đổi trên ô đang chọn.
 *
 * `null` = câu này không xin sửa gì. `'mo-ho'` = có xin tách màu, nhưng tên
 * chiều trúng nhiều hơn một trường — hoà thì HỎI LẠI, đúng luật đang áp cho
 * cả đường vẽ.
 */
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

/** Mấy chiều mà một câu "tách theo…" mơ hồ đang trúng — để hỏi lại. */
export function tachMoHo(
  truong: ExplorerFieldsDto | undefined,
  cauHoi: string,
): ExplorerFieldDto[] {
  const q = chuanHoa(cauHoi);
  const tach = TU_TACH.find((t) => q.includes(t));
  if (tach === undefined || truong === undefined) return [];
  return topTruong(truong.dimensions, tuNoiDung(q.slice(q.indexOf(tach) + tach.length)));
}

/**
 * Câu báo đã sửa gì.
 *
 * `so` mang đúng những chuỗi mà lớp viết lại bị đối chiếu — tên trường và con
 * số nhóm — nên mô hình không bẻ được chúng. Xem `services/chat/dienDat.ts`.
 */
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

/**
 * Ô biểu đồ đang chọn đang được đặt như thế nào.
 *
 * ═══ Lỗ hổng mà nó lấp: SỬA được mà ĐỌC không được ═════════════════════════
 *
 * `docSuaBieuDo` cho khung đổi số nhóm, đổi thứ tự, đổi chiều tách màu. Nhưng
 * ô đang chọn khai `duKien: []`, nên hỏi ngược lại — "ô này đang lấy mấy
 * nhóm", "đang tách màu theo gì", "đang là biểu đồ loại gì" — thì khung chịu.
 * Lệch hẳn một bên: ghi được mà không đọc được.
 *
 * Nó cũng là thứ làm câu xác nhận của `cauSua` kiểm lại được. Khung nói "đã
 * rút còn 5 nhóm" rồi người dùng hỏi lại "giờ mấy nhóm" — không có mấy dữ kiện
 * này thì không có cách nào đối chiếu, và một câu xác nhận không kiểm lại được
 * thì chỉ là một lời hứa.
 *
 * ⚠️ Gọi ô bằng ĐÚNG TÊN Ô TRÊN MÀN HÌNH (`CHART_SHELF_LABELS`), không gọi
 * "chiều"/"thước đo". Người dùng nhìn thấy chữ "Trục ngang" và "Giá trị" ở
 * trình dựng; khung trả lời bằng từ vựng khác là bắt họ dịch một lần nữa, và
 * câu hỏi "trục ngang là trường nào" sẽ không khớp nhãn nào.
 */
export function duKienODangChon(o: {
  /** Tên ô, đúng như tiêu đề đang hiện trên đầu ô. */
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
