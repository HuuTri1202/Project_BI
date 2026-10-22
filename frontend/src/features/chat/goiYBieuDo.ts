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
 * ═══ Vì sao đòi một TỪ Ý ĐỊNH, không đoán theo hình dạng câu ═══════════════
 *
 * "Doanh thu theo khu vực" một mình là một câu hỏi SỐ LIỆU hoàn toàn hợp lệ, và
 * trang này trả lời được nó — bằng ô đang chọn, hoặc bằng một truy vấn mới trên
 * chính mô hình. Chen hướng dẫn vào trước là cướp mất câu trả lời thật.
 *
 * Thứ phân biệt hai ý định nằm ở mấy chữ người dùng thêm vào: "tui MUỐN XEM",
 * "LÀM SAO để", "VẼ cho tui". Nên đó là điều kiện vào cửa, chứ không phải một
 * phép đoán theo độ dài câu hay theo việc mấy lớp kia có trả lời được không.
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
 * ⚠️ Toàn cụm hai chữ trở lên, trừ hai cụm đã tự đủ nghĩa. Một chữ như "ve"
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
];

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
 * Loại biểu đồ hợp với thứ vừa chọn.
 *
 * Ba luật, và không hơn. Mỗi luật thêm vào là một chỗ khung nói chắc chắn về
 * một thứ nó không biết: số nhóm, độ dài tên nhóm, hình dạng phân bố — không
 * thứ nào đọc được từ danh sách trường. `bar` là mặc định mà chính
 * `CHART_TYPE_HINTS` đã khai ("Chọn mặc định khi chưa biết chọn gì").
 */
function loaiHop(chieu: ExplorerFieldDto, q: string): ChartType {
  if (chieu.cubeType === 'time') return 'line';
  if (/ti trong|ty trong|co cau|phan tram|ti le|ty le|%/.test(q)) return 'pie';
  return 'bar';
}

/**
 * `null` = trang không có ô nào để kéo vào, câu này không phải lời nhờ dựng
 * biểu đồ, hoặc không đoán chắc được trường nào.
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
  if (!TU_Y_DINH.some((t) => q.includes(t))) return null;

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
