import type { ReportAnnotationDto } from './annotation';
import type { DatasetSource } from './data';
import type { MeasureAgg, MeasureFormat } from './datamodel';

/**
 * Hợp đồng dữ liệu của báo cáo và biểu đồ (§7.6, mở rộng ở §10.8).
 *
 * Một báo cáo là MỘT biểu đồ dựng trên MỘT nguồn số liệu. Có HAI loại nguồn, và
 * chúng khác nhau ở chỗ sâu hơn cái tên:
 *
 *   `dataset`    — một bộ dữ liệu. Cấu hình trỏ tới cột bằng TÊN, và câu tổng
 *                  hợp do `aggregateWarehouse` dựng thẳng trên bảng kho.
 *   `datamodel`  — một mô hình. Cấu hình trỏ tới chiều và thước đo bằng ID, và
 *                  câu lệnh do Cube sinh — nên nó thừa hưởng cả phép nối lẫn
 *                  thước đo tính toán mà tầng ngữ nghĩa đã khai.
 *
 * Vì sao đáng có cả hai thay vì ép mọi báo cáo qua mô hình: một file vừa tải
 * lên chưa thuộc mô hình nào, và bắt người dùng dựng mô hình trước khi xem được
 * biểu đồ đầu tiên là dựng một bức tường ngay ở bước một.
 *
 * Vì sao báo cáo trên mô hình KHÔNG nhận tên cột: cùng nguyên tắc với §10.7 —
 * trình duyệt gửi ID, backend tra ID trong phạm vi đã lọc theo tổ chức rồi tự
 * dựng tên cube. Một ID bịa ra không trỏ được sang mô hình của người khác.
 */

/**
 * ⚠️ NỐI VÀO CUỐI, không chèn vào giữa.
 *
 * Danh sách này là bản sao của `reports.chart_type` — một ENUM của MySQL, mà
 * MySQL lưu ENUM theo SỐ THỨ TỰ. Chèn `'hbar'` vào sau `'bar'` cho đẹp mắt sẽ
 * đổi nghĩa của mọi dòng đã lưu: báo cáo đang là `'line'` lặng lẽ thành
 * `'hbar'`. Ba loại thêm ở §10.9 vì vậy đứng cuối, dù thứ tự đó không phải thứ
 * tự người dùng nên thấy — thứ tự hiển thị do trình dựng biểu đồ tự sắp.
 */
export const CHART_TYPES = [
  'bar',
  'line',
  'area',
  'pie',
  'table',
  'hbar',
  'scatter',
  'heatmap',
] as const;
export type ChartType = (typeof CHART_TYPES)[number];

export const CHART_TYPE_LABELS: Record<ChartType, string> = {
  bar: 'Biểu đồ cột',
  line: 'Biểu đồ đường',
  area: 'Biểu đồ miền',
  pie: 'Biểu đồ tròn',
  table: 'Bảng số liệu',
  hbar: 'Biểu đồ thanh ngang',
  scatter: 'Biểu đồ phân tán',
  heatmap: 'Bản đồ nhiệt',
};

/**
 * Một câu nói loại biểu đồ này ĐỌC RA ĐIỀU GÌ, không phải nó trông thế nào.
 *
 * Người đứng trước tám ô vuông trong trình dựng không thiếu hình minh hoạ —
 * họ thiếu câu trả lời cho "cái nào hợp với số liệu tôi vừa kéo vào". Nên mỗi
 * câu nói về DỮ LIỆU chứ không về hình: "so sánh giữa các nhóm" giúp chọn,
 * "các cột đứng cạnh nhau" thì không.
 */
export const CHART_TYPE_HINTS: Record<ChartType, string> = {
  bar: 'So sánh giá trị giữa các nhóm. Chọn mặc định khi chưa biết chọn gì.',
  hbar: 'Như biểu đồ cột, nhưng tên nhóm dài vẫn đọc được vì nó nằm ngang.',
  line: 'Diễn biến theo thời gian hoặc theo một chiều có thứ tự.',
  area: 'Như đường, nhưng nhấn vào ĐỘ LỚN tích luỹ bên dưới.',
  pie: 'Tỉ trọng của từng phần trong một tổng. Quá 6–7 nhóm là không đọc nổi.',
  scatter: 'Từng nhóm là một điểm — thấy ngay nhóm nào lệch hẳn khỏi số còn lại.',
  heatmap: 'Hai chiều bắt chéo nhau, giá trị đọc bằng độ đậm của màu.',
  table: 'Con số chính xác, không diễn giải. Dùng khi người đọc cần tra cứu.',
};

/**
 * Loại biểu đồ nào dùng được chiều thứ hai (tách chuỗi / tô màu).
 *
 * Ba trạng thái chứ không hai:
 *   `'no'`        không nhận — biểu đồ tròn đã dùng màu để phân lát cắt rồi.
 *   `'optional'`  nhận thì tách chuỗi, không nhận thì vẽ một chuỗi duy nhất.
 *   `'required'`  BẮT BUỘC — bản đồ nhiệt cần đủ hai trục mới có ô để tô.
 *
 * Trình dựng đọc bảng này để bật/tắt ô "Nhóm màu" và để chặn nút Lưu, nên nó
 * phải nằm ở `shared`: backend kiểm lại cùng một luật ở `POST /reports/
 * from-datamodel`, và hai bảng chép tay sẽ lệch nhau ngay lần thêm loại thứ chín.
 */
export const CHART_SERIES_SUPPORT: Record<ChartType, 'no' | 'optional' | 'required'> = {
  bar: 'optional',
  hbar: 'optional',
  line: 'optional',
  area: 'optional',
  scatter: 'optional',
  heatmap: 'required',
  pie: 'no',
  table: 'optional',
};

/** Loại biểu đồ có xếp chồng được không — chỉ hỏi khi đã có chiều thứ hai. */
export const CHART_STACKABLE: readonly ChartType[] = ['bar', 'hbar', 'area'];

/** Loại biểu đồ in được con số lên từng mark. Xem `ReportChartOptionsDto`. */
export const CHART_VALUE_LABELS: readonly ChartType[] = ['bar', 'hbar', 'heatmap'];

/**
 * Bảng màu của biểu đồ — những bảng người dùng CHỌN ĐƯỢC hôm nay.
 *
 * Thứ tự trong mảng này là thứ tự trong bộ chọn.
 *
 * ─── Vì sao chỉ còn HAI, và vì sao `brand` không nằm trong đó ───────────────
 *
 * Bộ chọn từng có ba dòng, và dòng đầu là `brand` — "một màu thương hiệu". Nó
 * trông y hệt dòng thứ hai: cả hai bắt đầu bằng một ô vuông xanh dương, nên
 * người dùng đọc ra hai lựa chọn giống nhau và không biết chọn cái nào.
 *
 * Nó giống nhau vì nó THẬT SỰ không làm gì cả. Biểu đồ một chuỗi hồi đó tô
 * bằng màu thương hiệu bất kể bảng màu nào đang chọn, còn biểu đồ nhiều chuỗi
 * thì `brand` rơi về đúng bảng mặc định. Một lựa chọn không đổi được một pixel
 * nào là một lựa chọn nên biến mất, không phải một lựa chọn nên giải thích thêm.
 *
 * ⚠️ Vế đầu của câu đó đã HẾT đúng từ §10.15: biểu đồ một chuỗi giờ tô bằng
 * MÀU ĐẦU TIÊN của bảng đang chọn, nên bảng màu có tác dụng trên mọi loại biểu
 * đồ. `brand` vẫn ở lại nhóm cũ vì nó không có dãy hex nào để lấy màu đầu —
 * `normalizePalette` đưa nó về bảng mặc định trước khi tới đó.
 *
 * Nên `brand` xuống `CHART_PALETTES_LEGACY`: báo cáo đã lưu vẫn nhận nó, vẫn
 * vẽ ra y hệt, chỉ không được mời chọn nữa. Xem `normalizePalette`.
 *
 * ─── Vì sao tên nói về CẢ DÃY, không nói về màu đầu tiên ────────────────────
 *
 * Hai tên cũ là "Power BI" và "Xanh ngọc". Cái đầu mượn tên một sản phẩm khác
 * ngay trong ứng dụng của người dùng; cái sau đặt tên cho ĐÚNG MỘT ô trong tám
 * ô, nên hàng chữ "Xanh ngọc" nằm cạnh một dãy có cam, đỏ, tím và vàng.
 *
 * Tên mới nói về tính chất của cả dãy — cái duy nhất người chọn thật sự đang
 * chọn.
 */
export const CHART_PALETTES = ['bright', 'muted'] as const;

/** Bảng dùng khi cấu hình không nói gì, hoặc nói một bảng không phân loại được. */
export const DEFAULT_CHART_PALETTE = 'bright' as const;

/**
 * Bảng màu CŨ — không còn mời chọn, nhưng vẫn phải vẽ ra y hệt.
 *
 * Báo cáo đã lưu mang một trong bốn tên này trong cột `config`, và mở lại rồi
 * bấm Lưu sẽ gửi chính nó lên. Bỏ khỏi `z.enum` là biến mọi báo cáo cũ thành
 * không lưu lại được; đổi màu của chúng là lặng lẽ vẽ lại báo cáo của người
 * khác. Nên chúng ở lại, đúng màu cũ, chỉ không xuất hiện trong bộ chọn nữa.
 *
 * Bộ chọn vẫn HIỆN bảng màu cũ mà báo cáo đang dùng — xem `PaletteChoice`.
 * Giấu nó đi thì mở một báo cáo cũ sẽ thấy bộ chọn tô sáng một bảng màu không
 * phải bảng đang vẽ.
 */
export const CHART_PALETTES_LEGACY = [
  'brand',
  'powerbi',
  'teal',
  'tableau10',
  'tableau20',
  'pastel',
  'dark',
] as const;

export const CHART_PALETTES_ALL = [...CHART_PALETTES, ...CHART_PALETTES_LEGACY] as const;
export type ChartPalette = (typeof CHART_PALETTES_ALL)[number];

export const CHART_PALETTE_LABELS: Record<ChartPalette, string> = {
  bright: 'Tươi sáng',
  muted: 'Trầm dịu',
  brand: 'Một màu thương hiệu (cũ)',
  powerbi: 'Tươi sáng (tên cũ)',
  teal: 'Xanh ngọc (cũ)',
  tableau10: 'Phân loại 10 màu (cũ)',
  tableau20: 'Phân loại 20 màu (cũ)',
  pastel: 'Pastel dịu (cũ)',
  dark: 'Đậm tương phản (cũ)',
};

/**
 * Một câu nói bảng màu này HỢP VỚI VIỆC GÌ — chỉ cho những bảng còn được mời.
 *
 * Dãy ô vuông đã cho thấy màu; câu này trả lời câu hỏi còn lại, "vậy tôi chọn
 * cái nào". Hai dãy đều tám màu và đều tách bạch, nên khác biệt thật nằm ở nơi
 * biểu đồ sẽ được nhìn chứ không ở chỗ nào đẹp hơn.
 */
export const CHART_PALETTE_HINTS: Record<(typeof CHART_PALETTES)[number], string> = {
  bright: 'Màu mạnh, nổi trên màn hình.',
  muted: 'Cùng tám hướng màu nhưng dịu hơn, đỡ chói khi nhìn lâu.',
};

/**
 * Bảng màu cũ nào vẽ y hệt một bảng còn được mời.
 *
 * Chỉ `brand` và `powerbi` — hai cái tên đã đổi mà màu thì không đổi một mã
 * nào. Đưa chúng về tên mới ngay lúc nạp là điều kiện để bộ chọn không phải
 * hiện thêm một dòng "(cũ)" cho thứ đang vẽ giống hệt dòng ngay trên nó.
 *
 * `teal` KHÔNG có mặt: bảng "Trầm dịu" là một dãy màu KHÁC, không phải `teal`
 * đổi tên. Gộp nó vào đây sẽ lặng lẽ vẽ lại mọi báo cáo đang dùng `teal`.
 */
const PALETTE_ALIASES: Partial<Record<ChartPalette, (typeof CHART_PALETTES)[number]>> = {
  brand: DEFAULT_CHART_PALETTE,
  powerbi: 'bright',
};

/**
 * Tên bảng màu mà bộ chọn nên tô sáng, cho một giá trị đã lưu bất kỳ.
 *
 * An toàn đúng vì `PALETTE_ALIASES` chỉ chứa những bảng vẽ ra KHÔNG KHÁC một
 * pixel. Người dùng mở báo cáo cũ, thấy đúng bảng đang vẽ được tô sáng, bấm Lưu
 * — và cấu hình đổi tên mà biểu đồ đứng yên.
 */
export function normalizePalette(palette: ChartPalette | undefined): ChartPalette {
  if (palette === undefined) return DEFAULT_CHART_PALETTE;
  return PALETTE_ALIASES[palette] ?? palette;
}

/**
 * Màu THẬT của từng bảng, theo đúng thứ tự gán cho chuỗi thứ 1, 2, 3…
 *
 * ═══ Vì sao là danh sách hex, không phải tên scheme của Vega ════════════════
 *
 * Bảng màu cũ khai `scheme: 'tableau10'` — một cái tên mà chỉ Vega hiểu. Hậu
 * quả: bộ chọn không có cách nào VẼ được bảng màu ra cho người dùng nhìn, nên
 * nó chỉ liệt kê "Phân loại 10 màu", "Pastel dịu", "Đậm tương phản" và bắt
 * người ta chọn màu bằng cách đọc chữ. Danh sách hex ở đây vừa là thứ Vega
 * nhận (`scale.range`), vừa là thứ bộ chọn tô ra thành từng ô vuông.
 *
 * ═══ Vì sao ĐÚNG những màu này ══════════════════════════════════════════════
 *
 * Cả hai dãy đều được kiểm BẰNG MÁY chứ không bằng mắt, và cùng năm phép: dải
 * sáng an toàn, sàn sắc độ, khoảng cách ΔE giữa hai màu LIỀN KỀ dưới cả ba kiểu
 * loạn sắc (protan/deutan/tritan), khoảng cách với mắt thường, và tương phản
 * với nền. Cả hai PASS cả năm, không một cảnh báo.
 *
 * `bright` xuất phát từ bảng mặc định của Power BI với ba màu bị kéo vào dải:
 *
 *   #12239E -> #2F4BBF   xanh đậm và tím đậm nằm DƯỚI dải sáng an toàn: trên
 *   #6B007B -> #8E2A9E   nền trắng chúng đọc ra gần như cùng một vệt tối
 *   #D9B300 -> #B08A00   vàng gốc chỉ đạt tương phản 1,97:1 với nền — dưới 3:1
 *
 * `muted` được dựng từ đầu trong không gian OKLCH với sắc độ 0,11–0,13 (thấp
 * hơn hẳn `bright`) — đó là thứ làm nó "dịu". Sáng tối XEN KẼ nhau chứ không
 * đều: độ sáng là chiều duy nhất mắt loạn sắc vẫn đọc được, nên hai màu cạnh
 * nhau luôn lệch nhau một bậc sáng. Không có nó thì cặp đỏ–lục trượt ngay.
 *
 * ⚠️ Thứ tự trong hai mảng KHÔNG phải để cho đẹp: hai màu cạnh nhau là hai màu
 * dễ bị đem so nhất, nên chúng được xếp để cách nhau xa nhất. Đổi thứ tự cũng
 * là đổi bảng màu — CHẠY LẠI bộ kiểm, đừng ước lượng bằng mắt.
 *
 * ⚠️ Màu ĐẦU TIÊN gánh thêm một việc từ §10.15: nó là màu của biểu đồ một
 * chuỗi, và là đầu đậm của thang bản đồ nhiệt. Đổi nó là đổi màu của phần lớn
 * biểu đồ trong hệ thống, không chỉ đổi chuỗi thứ nhất của biểu đồ nhiều chuỗi.
 *
 * ⚠️ Bảng cũ có mặt ở đây thì phải giữ NGUYÊN dãy màu của nó (`teal`), hoặc
 * trỏ về đúng dãy nó vẫn vẽ (`powerbi`). Sửa một mã là lặng lẽ vẽ lại báo cáo
 * người khác đã lưu.
 */
const BRIGHT = [
  '#118DFF',
  '#E66C37',
  '#2F4BBF',
  '#B08A00',
  '#8E2A9E',
  '#D64550',
  '#744EC2',
  '#E044A7',
] as const;

export const CHART_PALETTE_COLORS: Partial<Record<ChartPalette, readonly string[]>> = {
  bright: BRIGHT,
  muted: ['#2E69B2', '#C87F37', '#7B52A4', '#089CA2', '#AF4C4D', '#8D8F37', '#A64C7B', '#4EA364'],
  // Tên cũ của `bright`, cùng một dãy — không phải bản sao chép tay.
  powerbi: BRIGHT,
  teal: ['#00A19B', '#D2691E', '#3D6FD9', '#C94F5E', '#7B3FA0', '#A8761B', '#B3477F', '#4F9A3F'],
  // `brand` cố ý VẮNG MẶT: màu của nó đến từ biến CSS lúc chạy, không phải từ
  // một danh sách. Xem `normalizePalette` — nó không bao giờ tới được đây nữa.
};

/**
 * Thứ tự các nhóm trên trục.
 *
 * Hai cặp, mỗi cặp hai chiều: theo GIÁ TRỊ và theo TÊN. Mặc định là
 * `'value'` — thứ tự backend đã trả về — nên cấu hình cũ không có trường này
 * vẫn vẽ ra đúng biểu đồ cũ.
 *
 * ⚠️ `'value-asc'` ĐỔI CẢ TRUY VẤN từ §10.15, không chỉ đổi cách sắp: nó suy ra
 * `config.pick = 'bottom'`, tức xin Cube đúng các nhóm NHỎ NHẤT. Trước đó nó chỉ
 * xếp ngược một tập đã cắt theo giá trị lớn nhất, nên nhãn "nhỏ → lớn" nói một
 * đằng còn dữ liệu là một nẻo — xem `GROUP_PICKS`.
 *
 * Hai cách sắp theo TÊN không đụng tới truy vấn: chúng vẫn nhận các nhóm lớn
 * nhất rồi xếp theo bảng chữ cái. "Hai mươi nhóm theo thứ tự A→Z" là một câu
 * hỏi khác hẳn, và nó cần Cube sắp theo chiều chứ không theo thước đo.
 */
export const CHART_SORTS = ['value', 'value-asc', 'label', 'label-desc'] as const;
export type ChartSort = (typeof CHART_SORTS)[number];

export const CHART_SORT_LABELS: Record<ChartSort, string> = {
  value: 'Theo giá trị (lớn → nhỏ)',
  'value-asc': 'Theo giá trị (nhỏ → lớn)',
  label: 'Theo tên (A → Z)',
  'label-desc': 'Theo tên (Z → A)',
};

/** Phép tổng hợp khi nhiều dòng rơi vào cùng một nhóm. */
export const AGGREGATES = ['sum', 'avg', 'count', 'min', 'max'] as const;
export type Aggregate = (typeof AGGREGATES)[number];

export const AGGREGATE_LABELS: Record<Aggregate, string> = {
  sum: 'Tổng',
  avg: 'Trung bình',
  count: 'Đếm',
  min: 'Nhỏ nhất',
  max: 'Lớn nhất',
};

/**
 * Cấu hình biểu đồ.
 *
 * Lưu thành JSON chứ không trải ra thành cột: mỗi loại biểu đồ cần một bộ tham
 * số khác nhau, và biểu đồ tròn không có trục X. Trải thành cột nghĩa là phần
 * lớn cột luôn NULL, và thêm một loại biểu đồ là một migration.
 */
export interface ReportConfigDto {
  /** Cột dùng để nhóm — trục ngang, hoặc lát cắt của biểu đồ tròn. */
  dimension: string;
  /** Cột được đo — trục dọc. `null` khi phép tổng hợp là `count`. */
  measure: string | null;
  aggregate: Aggregate;
  /** Số nhóm tối đa hiện trên biểu đồ; phần còn lại gộp thành "Khác". */
  limit: number;
}

/**
 * Bảng xếp hạng nhóm được đọc từ ĐẦU nào — lớn nhất xuống, hay nhỏ nhất lên.
 *
 * ─── Từ §10.15 nó KHÔNG còn là một ô chọn riêng ─────────────────────────────
 *
 * Bảng cấu hình từng có hai ô cạnh nhau nói về cùng một chuyện: "Giữ lại nhóm
 * nào" (lớn nhất / nhỏ nhất) và "Sắp xếp trục" (giá trị lớn → nhỏ / nhỏ →
 * lớn). Hai ô, bốn tổ hợp, và cái bẫy nằm ở chỗ ba trong bốn tổ hợp đọc lên
 * nghe giống nhau: chọn "nhỏ → lớn" ở ô thứ hai thì người dùng tưởng mình đang
 * xem các nhóm nhỏ nhất, trong khi thứ hiện ra vẫn là hai mươi nhóm LỚN nhất
 * xếp ngược. Giao diện phải in ra một dòng chú thích để đính chính chính nó.
 *
 * Nên `pick` giờ được SUY RA từ `options.sort`: "nhỏ → lớn" hỏi Cube các nhóm
 * nhỏ nhất, mọi cách sắp khác giữ các nhóm lớn nhất. Một ô chọn, và nó làm
 * đúng thứ nhãn của nó hứa.
 *
 * ⚠️ Trường vẫn ở lại `ReportModelConfigDto` chứ KHÔNG chuyển sang
 * `ReportChartOptionsDto`, dù thứ suy ra nó nằm bên kia. Nó đổi câu hỏi gửi
 * xuống Cube, nên nó phải nằm trong khoá cache — và backend phải đọc được nó
 * mà không phải đọc khối `options`, để ranh giới "options không đổi số" còn
 * nguyên. Phép suy ra nằm ở `pickOf` trong trình dựng, đúng chỗ dựng khoá.
 */
export const GROUP_PICKS = ['top', 'bottom'] as const;
export type GroupPick = (typeof GROUP_PICKS)[number];

/* ─── §10.15 Phần vượt trần LUÔN chia trang ──────────────────────────────────
 *
 * Từ §10.12 tới §10.14 ở đây có một ô chọn `overflow`: gộp phần vượt thành cột
 * "Khác", hay chia trang. §10.15 bỏ ô đó và giữ lại vế thứ hai.
 *
 *   "Bỏ cột khi còn nhóm chưa hiện và giữ lại nhóm nào đi vì mặc định sẽ tạo
 *    ra nhiều biểu đồ báo cáo và người dùng sẽ bấm sang trang từ từ để xem nó"
 *
 * Cột "Khác" trả lời được đúng một câu — "phần còn lại lớn cỡ nào" — và không
 * bao giờ trả lời được câu người ta hỏi tiếp: "trong đó có gì". Trên một chiều
 * 1800 giá trị nó còn nuốt cả biểu đồ: một cái cột 48 triệu đứng cạnh hai mươi
 * cái cột li ti, và hình dạng của dữ liệu thật biến mất sau nó.
 *
 * Chia trang trả lời được cả hai, nên nó ở lại một mình. Bỏ HẲN ô chọn thay vì
 * đổi mặc định: hai lựa chọn loại trừ nhau mà một trong hai luôn tốt hơn thì
 * cái ô ấy chỉ đang bắt người dùng học một khái niệm để rồi chọn đúng cái
 * mặc định.
 *
 * Nhánh bộ dữ liệu (`aggregateWarehouse`) KHÔNG đổi: nó không có `offset`, không
 * có trình dựng, và không còn báo cáo mới nào đi qua đó.
 */

/**
 * Trần số trang.
 *
 * Không phải giới hạn kỹ thuật mà là điểm dừng cho `offset`: 200 trang × 100
 * nhóm là hai vạn nhóm, và ai bấm tới đó thì thứ họ cần là một cái bảng chứ
 * không phải một biểu đồ.
 */
export const MAX_GROUP_PAGE = 199;

/** Nguồn số liệu của một báo cáo — xem ghi chú đầu file. */
export const REPORT_SOURCES = ['dataset', 'datamodel'] as const;
export type ReportSource = (typeof REPORT_SOURCES)[number];

export const REPORT_SOURCE_LABELS: Record<ReportSource, string> = {
  dataset: 'Bộ dữ liệu',
  datamodel: 'Mô hình dữ liệu',
};

/**
 * Cấu hình biểu đồ dựng trên MÔ HÌNH — §10.8.
 *
 * Toàn ID, không một tên nào. Nhờ vậy đổi tên hiển thị của cột hay của thước đo
 * không làm mồ côi báo cáo, và chuỗi trong cấu hình không bao giờ đi vào câu
 * lệnh — Cube nhận tên do backend dựng từ chính hai ID này.
 *
 * ⚠️ Bản trước của chú thích này viết: "KHÔNG có `aggregate`: cho phép chọn lại
 * ở đây nghĩa là cùng một thước đo cho hai con số khác nhau tuỳ báo cáo — đúng
 * thứ tầng ngữ nghĩa sinh ra để dẹp." Nỗi lo đó ĐÚNG, nhưng kết luận thì không,
 * và thực tế đã chỉ ra:
 *
 *   - Tab Explorer của mô hình dữ liệu ĐÃ cho đổi phép gộp (`measureAggs`), nên
 *     "một thước đo một con số" vốn đã không còn đúng trong hệ thống. Cấm ở
 *     trình dựng chỉ khiến người dùng phải sang Explorer, tự tính, rồi quay lại
 *     — hoặc bắt quản trị viên đẻ thêm một thước đo "Trung bình Quantity" nằm
 *     cạnh "Tổng Quantity", đúng cái rác mà tầng ngữ nghĩa muốn tránh.
 *   - Cube đã sinh sẵn một measure cho MỖI phép gộp cho phép (`altAggs`), nên
 *     đây không phải mở một cánh cửa mới; cánh cửa đã mở, chỉ là trình dựng
 *     không với tới.
 *
 * Cái phải giữ là điều kiện đi kèm: **con số không bao giờ được xuất hiện mà
 * không nói nó là phép tính gì**. `explorer.ts` gắn hậu tố vào nhãn khi có đổi
 * ("Sales (Trung bình)"), nhãn đó chảy vào tiêu đề trục, chú giải, tooltip và
 * bảng số liệu; trình dựng gắn đúng hậu tố ấy để hai bên không lệch nhau. Mở
 * quyền chọn mà bỏ phần nhãn thì mới đúng là thứ đáng cấm.
 */
export interface ReportModelConfigDto {
  dimensionId: number;
  measureId: number;
  /**
   * Đổi phép gộp của thước đo CHO RIÊNG biểu đồ này.
   *
   * Vắng mặt = dùng phép gộp mà mô hình khai (`ExplorerFieldDto.agg`), tức đúng
   * hành vi từ §10.8 — nên mọi báo cáo đã lưu đọc ra không đổi một con số nào,
   * và không cần migrate dữ liệu.
   *
   * Chỉ nhận giá trị nằm trong `availableAggs` của chính thước đo đó; backend
   * từ chối 400 chứ không âm thầm rơi về mặc định (xem `explorer.ts`). Thước đo
   * công thức và thước đo đếm dòng có `availableAggs` rỗng — chúng đã gộp sẵn,
   * gộp lần nữa là sai — nên với chúng trường này không bao giờ được đặt.
   */
  measureAgg?: MeasureAgg | null | undefined;
  /**
   * Số nhóm MỖI TRANG — §10.15.
   *
   * Tới §10.14 nó là "số nhóm tối đa", và phần vượt bị gộp lại hoặc bỏ đi. Giờ
   * phần vượt nằm ở trang sau, nên con số này chỉ còn nói ĐỘ DÀY của một trang.
   *
   * ⚠️ Trang ĐANG XEM cố ý KHÔNG được lưu ở đây. Nó là chỗ người đọc đang đứng
   * trong một lượt xem, không phải một thuộc tính của báo cáo — lưu nó nghĩa là
   * mở báo cáo lần sau sẽ rơi vào trang 7 mà không hiểu vì sao. Xem tham số
   * `page` của `aggregateFromModel`.
   */
  limit: number;
  /**
   * Đọc bảng xếp hạng từ đầu nào — xem `GROUP_PICKS`.
   *
   * Vắng mặt = `'top'`, đúng hành vi từ §10.8, nên báo cáo đã lưu không đổi
   * một con số nào.
   *
   * Từ §10.15 trình dựng SUY RA trường này từ `options.sort` thay vì hỏi bằng
   * một ô chọn thứ hai — nhưng nó vẫn được LƯU ra đây, vì backend chỉ đọc
   * `config` và không bao giờ đọc `options`.
   */
  pick?: GroupPick | undefined;
  /**
   * Chiều THỨ HAI — tách biểu đồ thành nhiều chuỗi, mỗi chuỗi một màu (§10.9).
   *
   * Vắng mặt hoặc `null` = biểu đồ một chuỗi, tức đúng hành vi từ §10.8. Mọi
   * báo cáo đã lưu trước bản này đọc ra đúng như cũ, nên không cần migrate dữ
   * liệu — đó là lý do nó là trường TUỲ CHỌN chứ không phải một `config` phiên
   * bản 2.
   *
   * ⚠️ Chiều thứ hai có trần RIÊNG (12 chuỗi) và trần đó KHÔNG chia trang: hai
   * cái nút ‹ › lật nhóm, không lật màu. Xem `aggregateWithSeries`.
   */
  seriesDimensionId?: number | null | undefined;
  /**
   * Cách TRÌNH BÀY, không đụng tới con số — xem `ReportChartOptionsDto`.
   *
   * Nằm trong cùng một cột `config` vì nó cùng vòng đời với báo cáo và cùng
   * người sửa. Tách ra cột riêng nghĩa là một migration cho mỗi lần thêm một
   * công tắc, đúng cái giá mà việc lưu JSON sinh ra để khỏi phải trả.
   */
  options?: ReportChartOptionsDto | undefined;
}

/**
 * Tuỳ chọn TRÌNH BÀY của biểu đồ — §10.9.
 *
 * Ranh giới với `ReportModelConfigDto` rất cứng và đáng giữ: mọi thứ ở đây đổi
 * HÌNH mà không đổi SỐ. Nhờ vậy backend không phải đọc khối này (nó không ảnh
 * hưởng tới truy vấn Cube), và bật tắt một công tắc trong trình dựng không tốn
 * một vòng tới ClickHouse.
 *
 * Mọi trường đều tuỳ chọn và mọi giá trị vắng mặt đều rơi về mặc định của §10.8
 * — cấu hình cũ vì vậy vẫn vẽ ra đúng biểu đồ cũ.
 */
export interface ReportChartOptionsDto {
  /** Xếp chồng thay vì đặt cạnh nhau. Chỉ có nghĩa khi đã có chiều thứ hai. */
  stacked?: boolean | undefined;
  showLegend?: boolean | undefined;
  /** In con số lên từng mark — chỉ vài loại làm được, xem `CHART_VALUE_LABELS`. */
  showValues?: boolean | undefined;
  /**
   * Thứ tự các nhóm trên trục — xem `CHART_SORTS`.
   *
   * `'value'` (mặc định) giữ NGUYÊN thứ tự backend trả về, tức giảm dần theo
   * thước đo.
   *
   * ⚠️ Đây là trường DUY NHẤT trong khối này đụng tới số liệu, và nó đụng gián
   * tiếp: `'value-asc'` suy ra `config.pick = 'bottom'` (§10.15). Ranh giới vẫn
   * nguyên — backend chỉ đọc `config.pick` — nhưng ai đổi phép suy ra ở
   * `pickOf` thì phải nhớ nó cũng là một khoá cache.
   */
  sort?: ChartSort | undefined;
  palette?: ChartPalette | undefined;
}

/* ─── §10.10 Khung nhiều biểu đồ ─────────────────────────────────────────────
 *
 * Tới §10.9 một báo cáo là MỘT biểu đồ. Điều đó đủ để trả lời một câu hỏi, và
 * không đủ để kể một câu chuyện: "doanh thu theo khu vực" cạnh "doanh thu theo
 * tháng" cạnh một bảng chi tiết là ba câu hỏi phải đọc CÙNG NHAU mới ra nghĩa.
 * Trước bản này người dùng phải mở ba trang và tự nhớ.
 *
 * ─── Vì sao lưới chứ không phải toạ độ pixel ───────────────────────────────
 *
 * Vị trí lưu bằng ĐƠN VỊ LƯỚI, không phải pixel. Người dựng báo cáo trên màn
 * 27 inch, người xem mở trên laptop 13 inch — lưu pixel nghĩa là mọi ô lệch chỗ
 * ở mọi màn hình khác màn hình đã dựng. Lưới 12 cột co giãn theo bề rộng thật,
 * nên bố cục giữ nguyên TỈ LỆ ở mọi khổ.
 *
 * 12 vì nó chia hết cho 2, 3, 4 và 6 — bốn cách chia mà người ta thật sự dùng.
 *
 * ─── Các ô ĐƯỢC PHÉP đè lên nhau ───────────────────────────────────────────
 *
 * Không có bước tự đẩy nhau ra như `react-grid-layout`. Đẩy tự động nghĩa là
 * kéo một ô làm ba ô khác nhảy chỗ, và người dùng mất luôn bố cục vừa sắp.
 * Cho đè lên nhau là hành vi của Power BI, và nó dễ đoán hơn hẳn.
 */

/** Số cột của lưới. Đổi số này là đổi nghĩa của mọi `x`/`w` đã lưu. */
export const CANVAS_COLUMNS = 12;

/**
 * Chiều cao một hàng lưới, tính bằng pixel.
 *
 * Dùng CHUNG giữa trình dựng và trang xem — hai con số khác nhau nghĩa là báo
 * cáo dựng xong trông một kiểu, mở ra trông một kiểu khác.
 */
export const CANVAS_ROW_HEIGHT = 44;

/** Kích thước tối thiểu của một ô, tính bằng đơn vị lưới. */
export const CANVAS_MIN_W = 2;
export const CANVAS_MIN_H = 3;

/** Kích thước một ô mới thả xuống — nửa bề rộng, đủ cao để đọc được trục. */
export const CANVAS_DEFAULT_W = 6;
export const CANVAS_DEFAULT_H = 7;

/**
 * Trần số ô trên MỘT TRANG.
 *
 * Không phải giới hạn kỹ thuật mà là giới hạn CHI PHÍ: mỗi ô là một truy vấn
 * Cube riêng khi mở trang. Hai mươi ô là hai mươi lượt quét ClickHouse cho một
 * lần bấm, và không ai đọc nổi hai mươi biểu đồ cùng lúc.
 *
 * ⚠️ Trần này là MỖI TRANG, không phải mỗi báo cáo — và điều đó không nới lỏng
 * lập luận chi phí ở trên, vì `GET /reports/:id/canvas-data` chỉ tính số liệu
 * cho ĐÚNG một trang. Mở một báo cáo mười trang vẫn tốn đúng một trang truy vấn.
 */
export const CANVAS_MAX_VISUALS = 12;

/**
 * Trần số trang trên một báo cáo — §10.12.
 *
 * Đây là giới hạn về việc ĐỌC ĐƯỢC, không phải về chi phí (chỉ trang đang mở
 * mới tốn truy vấn). Quá mười cái thẻ ở mép dưới thì không còn đọc được cái nào
 * là cái nào, và thứ người dùng cần khi đó là hai báo cáo chứ không phải một.
 */
export const CANVAS_MAX_PAGES = 10;

export const VISUAL_TITLE_MAX = 120;
export const PAGE_NAME_MAX = 60;

/** Một ô trên khung — một biểu đồ kèm chỗ đứng của nó. */
export interface ReportVisualDto {
  /**
   * Khoá ổn định do trình duyệt sinh, KHÔNG phải số thứ tự trong mảng.
   *
   * Số thứ tự đổi mỗi lần xoá một ô ở giữa, và khi đó dữ liệu trả về cho ô số 2
   * sẽ được vẽ vào ô đã tụt xuống vị trí đó — biểu đồ đúng, số liệu của ô khác.
   */
  id: string;
  chartType: ChartType;
  config: ReportModelConfigDto;
  /** Tiêu đề riêng; vắng mặt hoặc rỗng = dùng câu tự sinh từ chiều và thước đo. */
  title?: string | undefined;
  /** Cột bắt đầu, `0` tới `CANVAS_COLUMNS - 1`. */
  x: number;
  /** Hàng bắt đầu, đếm từ `0` và không có trần — khung cuộn dọc. */
  y: number;
  w: number;
  h: number;
}

/**
 * Một TRANG của báo cáo — §10.12.
 *
 * ─── Vì sao một báo cáo cần nhiều trang ─────────────────────────────────────
 *
 * §10.10 cho một báo cáo nhiều biểu đồ trên MỘT khung, và điều đó đủ cho tới
 * lúc câu chuyện dài hơn một màn hình. "Tổng quan" và "Chi tiết theo khu vực"
 * là hai thứ người ta đọc NỐI TIẾP nhau, không phải cạnh nhau — nhồi cả hai vào
 * một khung là bắt người đọc cuộn, và cuộn thì mất chỗ vừa đọc.
 *
 * Đúng mô hình của một sheet trong Excel, và cố ý: người dùng đã biết cách dùng
 * nó rồi.
 *
 * ─── Trang RỖNG là hợp lệ ───────────────────────────────────────────────────
 *
 * `visuals` được phép rỗng. Người ta thêm một trang TRƯỚC rồi mới dựng biểu đồ
 * cho nó, và bắt trang phải có sẵn một ô mới lưu được nghĩa là bấm Lưu giữa
 * chừng sẽ làm biến mất một trang vừa tạo. Cả khung thì vẫn phải có ít nhất một
 * ô — xem `reportCanvasSchema`.
 */
export interface ReportPageDto {
  /** Khoá ổn định, cùng luật với `ReportVisualDto.id` và cùng lý do. */
  id: string;
  name: string;
  visuals: ReportVisualDto[];
  /**
   * Văn bản, đường kẻ, hình — §10.18. Xem `annotation.ts`.
   *
   * Mảng RIÊNG, không trộn vào `visuals`: đường tính số liệu (trần 12 ô,
   * `canvas-data`, bản sao ô đầu tiên) chỉ đọc `visuals`, nên một hộp văn bản
   * không bao giờ bị đem đi hỏi Cube.
   *
   * Bắt buộc có mặt ở hình dạng ĐỌC — repository điền `[]` cho bản ghi trước
   * §10.18. Ở đường GHI thì vắng mặt vẫn được nhận (`.default([])`): một tab mở
   * từ trước lúc triển khai vẫn phải lưu được.
   *
   * ⚠️ Không đếm vào luật "khung phải có ít nhất một biểu đồ". Một báo cáo chỉ có
   * chữ không phải một báo cáo trên mô hình dữ liệu.
   */
  annotations: ReportAnnotationDto[];
}

/**
 * Khung của một báo cáo — một hoặc nhiều trang.
 *
 * ⚠️ Hình dạng CŨ (`{ visuals: [...] }`, tức §10.10) vẫn được đường ĐỌC nhận và
 * quy về một trang duy nhất — xem `parseCanvas`. Không có bước migrate dữ liệu:
 * cột `reports.canvas` là JSON, và một bản ghi cũ vẫn là một bản ghi đúng.
 */
export interface ReportCanvasDto {
  pages: ReportPageDto[];
}

/** Mọi ô của mọi trang. Dùng khi câu hỏi thật sự là về cả báo cáo. */
export function allVisuals(canvas: ReportCanvasDto): ReportVisualDto[] {
  return canvas.pages.flatMap((p) => p.visuals);
}

/** Tạo báo cáo nhiều biểu đồ — §10.10. */
export interface CreateCanvasReportInput {
  datamodelId: number;
  name: string;
  canvas: ReportCanvasDto;
}

export interface UpdateCanvasReportInput {
  name: string;
  canvas: ReportCanvasDto;
}

/**
 * Số liệu của MỘT ô.
 *
 * `error` là câu chữ chứ không phải mã lỗi, và nó nằm ở TỪNG ô chứ không ở cả
 * request: một ô trỏ vào thước đo vừa bị xoá không được phép làm trắng cả trang
 * — bảy ô còn lại vẫn đọc được, và ô hỏng tự nói ra nó hỏng vì sao.
 */
export interface ReportVisualDataDto {
  visualId: string;
  data: ReportDataDto | null;
  error?: string | undefined;
}

export interface ReportCanvasDataDto {
  visuals: ReportVisualDataDto[];
}

/**
 * Một báo cáo.
 *
 * `chartType` và `config` là `null` khi báo cáo mới được tạo và CHƯA ai dựng
 * biểu đồ. Đó là trạng thái bình thường, không phải dữ liệu hỏng — trang Report
 * hiện lời mời dựng biểu đồ thay vì một biểu đồ mặc định không ai yêu cầu.
 *
 * Hai trường đi CÙNG NHAU: có cấu hình thì có loại biểu đồ, và ngược lại.
 *
 * ⚠️ Báo cáo dựng trên MÔ HÌNH thì không đi qua trạng thái đó: hộp thoại tạo đã
 * hỏi đủ chiều, thước đo và loại biểu đồ, nên nó ra đời với cấu hình đầy đủ.
 *
 * `datasetId` và `datamodelId` loại trừ nhau — database ép bằng CHECK ở
 * migration 15, không chỉ bằng quy ước. `sourceName` là tên của bên nào đang
 * được dùng, để nơi hiển thị không phải tự phân nhánh chỉ để in một cái tên.
 */
export interface ReportDto {
  id: number;
  workspaceId: number;
  source: ReportSource;
  /** Tên bộ dữ liệu hoặc tên mô hình — tuỳ `source`. */
  sourceName: string;
  datasetId: number | null;
  /** Bộ dữ liệu đến từ đâu — để trang Report nói đúng nguồn của số liệu. */
  datasetSource: DatasetSource | null;
  datamodelId: number | null;
  name: string;
  chartType: ChartType | null;
  /** Chỉ khi `source === 'dataset'`. */
  config: ReportConfigDto | null;
  /** Chỉ khi `source === 'datamodel'`. */
  modelConfig: ReportModelConfigDto | null;
  /**
   * Nhiều biểu đồ trên một khung — §10.10. Chỉ khi `source === 'datamodel'`.
   *
   * `null` = báo cáo MỘT biểu đồ, tức mọi báo cáo có trước §10.10. Trang xem
   * phân nhánh trên chính trường này, nên không cần migrate dữ liệu cũ.
   *
   * ⚠️ Khi khác `null` thì ĐÂY là bản gốc, còn `chartType`/`modelConfig` chỉ là
   * bản sao của `canvas.visuals[0]` — xem `updateCanvasReport`.
   */
  canvas: ReportCanvasDto | null;
  creatorName: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Tạo báo cáo RỖNG — chỉ tên và bộ dữ liệu.
 *
 * Cố ý KHÔNG nhận loại biểu đồ hay cấu hình trục, kể cả tuỳ chọn: một cấu hình
 * đoán bừa trông y hệt một cấu hình người dùng đã chọn, nên không ai biết cái
 * nào là cái nào.
 */
export interface CreateReportInput {
  datasetId: number;
  name: string;
}

/**
 * Tạo báo cáo trên MÔ HÌNH — §10.8. Ngược hẳn `CreateReportInput`: ra đời là đã
 * có biểu đồ.
 *
 * Không phải mâu thuẫn với ghi chú "không đoán hộ cấu hình" ở trên. Ở luồng
 * file, người dùng vừa tải một file lạ lên và hệ thống chưa biết cột nào đáng
 * vẽ — nên nó không đoán. Ở đây họ vừa TỰ chọn chiều và thước đo trong hộp
 * thoại, nên tạo ra một báo cáo rỗng để bắt họ chọn lại là việc thừa.
 */
export interface CreateModelReportInput {
  datamodelId: number;
  name: string;
  chartType: ChartType;
  config: ReportModelConfigDto;
}

/** Dựng hoặc sửa biểu đồ — trang Report, không phải wizard. */
export interface UpdateReportInput {
  name: string;
  chartType: ChartType;
  config: ReportConfigDto;
}

/**
 * Sửa một báo cáo ĐÃ dựng trên mô hình — §10.9.
 *
 * Đi đường riêng (`PATCH /reports/:id/from-datamodel`) chứ không nhồi vào
 * `UpdateReportInput`, cùng lập luận với `CreateModelReportInput`: hai `config`
 * là hai hình dạng không giao nhau (tên cột so với ID), và một union ở zod chỉ
 * đẻ ra thông báo lỗi "không khớp nhánh nào".
 *
 * Trước bản này `PATCH /reports/:id` từ chối thẳng báo cáo trên mô hình với câu
 * "hãy tạo báo cáo mới" — đúng vào lúc chưa có màn hình nào sửa được nó. Trình
 * dựng biểu đồ là màn hình đó.
 */
export interface UpdateModelReportInput {
  name: string;
  chartType: ChartType;
  config: ReportModelConfigDto;
}

/** Dữ liệu đã tổng hợp sẵn cho biểu đồ — frontend không tính lại gì. */
export interface ReportDataDto {
  /**
   * `series` chỉ có mặt khi cấu hình khai `seriesDimensionId` (§10.9).
   *
   * Thêm một trường TUỲ CHỌN vào từng dòng, chứ không đổi `rows` thành một hình
   * dạng khác: nhánh bộ dữ liệu (§7.6) không bao giờ đặt nó, và trình vẽ chỉ
   * cần hỏi `seriesLabel` có mặt hay không để biết mình đang vẽ một chuỗi hay
   * nhiều chuỗi.
   */
  rows: { label: string; value: number; series?: string }[];
  /** Nhãn trục, lấy từ tên field người dùng đặt chứ không phải tên cột gốc. */
  dimensionLabel: string;
  measureLabel: string;
  /** Có mặt = biểu đồ nhiều chuỗi, và đây là tên chiều tách chuỗi. */
  seriesLabel?: string | undefined;
  /**
   * Có nhóm nào bị cắt khỏi biểu đồ không — để trang xem NÓI RA điều đó.
   *
   * Từ §10.15 nhánh mô hình một chiều luôn `false`: chia trang thì không nhóm
   * nào bị cắt, chúng chỉ nằm ở trang khác, và câu "chỉ hiện các nhóm lớn nhất"
   * ở đó là nói sai. Còn `true` ở hai chỗ — trần CHUỖI của biểu đồ hai chiều,
   * và nhánh bộ dữ liệu vốn không chia trang.
   */
  grouped: boolean;
  /**
   * Trang đang xem — mọi biểu đồ dựng trên MÔ HÌNH đều có, từ §10.15.
   *
   * Vắng mặt ở nhánh bộ dữ liệu, nơi không có `offset` nào để đi tiếp.
   *
   * `hasMore` đến từ mẹo hỏi thừa MỘT dòng, cùng mẹo đã dùng cho `grouped`, nên
   * nó KHÔNG tốn thêm một vòng nào tới Cube.
   *
   * Cố ý không có tổng số trang: biết nó đòi đếm toàn bộ giá trị phân biệt của
   * chiều, tức một lượt quét nữa trên mỗi lần vẽ, cho một con số chỉ để in ra.
   * "Còn nữa" hay "hết rồi" là thứ hai cái nút thật sự cần.
   */
  paging?: { page: number; hasMore: boolean } | undefined;
  /**
   * Cách ĐỌC con số, không phải cách tính nó — §10.6.
   *
   * Vắng mặt nghĩa là số thường. Có `'percent'` khi thước đo được khai là tỉ lệ:
   * kho lưu 0,283 và chỗ hiển thị phải đọc thành 28,3 %. Đi kèm dữ liệu chứ
   * không tra lại từ mô hình, vì trang xem báo cáo không mở mô hình ra.
   */
  format?: MeasureFormat | undefined;
}

export const REPORT_NAME_MAX = 255;

export const REPORT_ERROR_CODES = {
  /**
   * Báo cáo chưa được dựng biểu đồ, nên chưa có gì để tổng hợp.
   *
   * KHÔNG phải lỗi: đây là trạng thái mọi báo cáo đi qua ngay sau khi được tạo.
   * Giao diện hiện lời mời dựng biểu đồ chứ không hiện màn hình lỗi.
   */
  REPORT_NOT_CONFIGURED: 'ReportNotConfigured',
  /**
   * Bộ dữ liệu chưa nằm trong kho phân tích, nên chưa tổng hợp được.
   *
   * Cũng KHÔNG phải lỗi hỏng: từ khi §7.6 gom nhóm bằng ClickHouse thay vì trong
   * RAM Node, một báo cáo chỉ vẽ được sau khi bộ dữ liệu đã nạp. Trạng thái này
   * kéo dài vài giây sau khi tải file lên, và giao diện hiện tiến độ nạp thay vì
   * một biểu đồ rỗng.
   *
   * Thà 409 còn hơn vẽ trên `dataset_rows`: bảng đó giờ chỉ giữ MẪU, nên tổng
   * hợp trên nó sẽ ra một biểu đồ trông hoàn toàn hợp lý mà sai số liệu.
   */
  DATASET_NOT_LOADED: 'DatasetNotLoaded',
} as const;

export type ReportErrorCode = (typeof REPORT_ERROR_CODES)[keyof typeof REPORT_ERROR_CODES];
