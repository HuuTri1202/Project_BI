import { z } from 'zod';

import { CANVAS_COLUMNS } from './report';

/**
 * Chú thích trên khung báo cáo — §10.18.
 *
 *   "tui muốn trang vẽ biểu đồ có thêm mục chứa tính năng như thêm text box,
 *    đường kẻ ,... để ghi chú cho báo cáo biểu đồ của họ"
 *
 * ═══ Ba loại, chọn theo việc người ta LÀM với một báo cáo ═══════════════════
 *
 *   text   tiêu đề, một đoạn giải thích, một tờ ghi chú vàng dán cạnh biểu đồ —
 *          "doanh thu tháng 7 giảm vì đóng cửa kho Bình Dương".
 *   line   đường kẻ chia khu, và MŨI TÊN chỉ vào đúng cái cột cần nhìn.
 *   shape  khung nền gom vài biểu đồ thành một khu, và vòng khoanh quanh một
 *          điểm bất thường.
 *
 * Đó là đúng những thứ Power BI để ở mục Insert và Looker Studio để trên thanh
 * công cụ. Ảnh (logo) cố ý CHƯA có: nó cần một chỗ lưu file và một vòng đời
 * dọn file khi ô bị xoá, và nhét ảnh base64 vào cột JSON thì mỗi lần mở báo
 * cáo là tải lại cả cái ảnh đó.
 *
 * ═══ Vì sao là mảng RIÊNG, không trộn vào `visuals` ═════════════════════════
 *
 * Một ô biểu đồ là một câu hỏi gửi xuống Cube. Mọi thứ quanh `visuals` được
 * dựng trên giả định ấy: trần 12 ô vì mỗi ô tốn một lượt quét ClickHouse,
 * `canvas-data` lặp qua từng ô để tính số, ô đầu tiên được chép sang
 * `chart_type`/`config`. Một hộp văn bản lọt vào đó thì hoặc phải thêm một
 * nhánh "không phải biểu đồ" ở từng chỗ ấy, hoặc nó được đem đi hỏi Cube.
 *
 * Mảng riêng thì đường tính số liệu không đổi một dòng — THEO CẤU TẠO, không
 * phải vì đã nhớ sửa đủ chỗ.
 *
 * ═══ Vì sao zod ở ĐÂY, không ở `backend/src/api/v1/schemas.ts` ══════════════
 *
 * Ba bên cần đúng cùng một luật: backend kiểm lúc GHI, repository đọc khoan
 * dung lúc ĐỌC (bỏ qua chú thích hỏng thay vì làm hỏng cả khung), và test của
 * frontend kiểm rằng thứ trình dựng gửi đi thì backend nhận. Kiểu TypeScript
 * cũng suy ra từ chính schema, nên kiểu và luật không lệch nhau được.
 */

/** Trần số chú thích trên MỘT trang. Không tốn truy vấn — trần này là để còn đọc được. */
export const CANVAS_MAX_ANNOTATIONS = 40;

/**
 * Trần độ dài một hộp văn bản.
 *
 * Một báo cáo đầy trần là 10 trang × 40 hộp × 1.000 ký tự ≈ 400 KB, còn dưới
 * giới hạn 1 MB của `express.json` trong `app.ts`. Nâng số này thì nhớ con số
 * kia.
 */
export const ANNOTATION_TEXT_MAX = 1000;

/** Chú thích được nhỏ tới MỘT ô lưới — đường kẻ ngang chỉ cao một hàng. */
export const ANNOTATION_MIN_W = 1;
export const ANNOTATION_MIN_H = 1;

export const ANNOTATION_KINDS = ['text', 'line', 'shape'] as const;
export type AnnotationKind = (typeof ANNOTATION_KINDS)[number];

export const ANNOTATION_KIND_LABELS: Record<AnnotationKind, string> = {
  text: 'Văn bản',
  line: 'Đường kẻ',
  shape: 'Hình',
};

/**
 * Nằm TRÊN hay DƯỚI các biểu đồ.
 *
 * Hai tầng chứ không phải một thứ tự z tự do: câu hỏi người dựng báo cáo thật
 * sự có là "cái khung nền này có che mất biểu đồ không", và hai tầng trả lời
 * đúng câu đó. Trong cùng một tầng, phần tử đứng SAU trong mảng nằm trên.
 */
export const ANNOTATION_LAYERS = ['front', 'back'] as const;
export type AnnotationLayer = (typeof ANNOTATION_LAYERS)[number];

export const ANNOTATION_FONT_SIZES = [12, 14, 16, 20, 24, 32] as const;
export type AnnotationFontSize = (typeof ANNOTATION_FONT_SIZES)[number];

export const TEXT_ALIGNS = ['left', 'center', 'right'] as const;
export const TEXT_VALIGNS = ['top', 'middle', 'bottom'] as const;

export const LINE_DIRECTIONS = ['horizontal', 'vertical', 'diagonal-down', 'diagonal-up'] as const;
export type LineDirection = (typeof LINE_DIRECTIONS)[number];

export const LINE_STYLES = ['solid', 'dashed', 'dotted'] as const;
export type LineStyle = (typeof LINE_STYLES)[number];

/** Mũi tên ở đầu nào. "Đầu" là điểm bắt đầu theo `LINE_DIRECTIONS`: trái, trên. */
export const LINE_ARROWS = ['none', 'start', 'end', 'both'] as const;
export type LineArrow = (typeof LINE_ARROWS)[number];

export const STROKE_WIDTHS = [1, 2, 3, 4, 6] as const;

export const SHAPE_TYPES = ['rect', 'rounded', 'ellipse'] as const;
export type ShapeType = (typeof SHAPE_TYPES)[number];

/**
 * Mã màu `#RRGGBB` — và CHỈ thế.
 *
 * Giá trị này đi thẳng vào thuộc tính `style` và `stroke` lúc vẽ. Nhận một chuỗi
 * CSS tuỳ ý (`url(...)`, `var(...)`, `red; background-image: …`) là mở một cửa
 * cho người dựng báo cáo cài thứ khác vào trang của người xem.
 */
const color = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Màu phải có dạng #RRGGBB');

const idRule = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[A-Za-z0-9_-]+$/, 'Mã chú thích chỉ nhận chữ, số, gạch ngang và gạch dưới');

/** Cùng lưới 12 cột với biểu đồ, cùng trần `y`/`h` — chỉ khác kích thước tối thiểu. */
const box = {
  id: idRule,
  x: z.coerce
    .number()
    .int()
    .min(0)
    .max(CANVAS_COLUMNS - 1),
  y: z.coerce.number().int().min(0).max(500),
  w: z.coerce.number().int().min(ANNOTATION_MIN_W).max(CANVAS_COLUMNS),
  h: z.coerce.number().int().min(ANNOTATION_MIN_H).max(60),
  layer: z.enum(ANNOTATION_LAYERS),
};

const oneOf = <T extends readonly [number, ...number[]]>(values: T, message: string) =>
  z.coerce
    .number()
    .refine((n): n is T[number] => (values as readonly number[]).includes(n), message);

export const textAnnotationSchema = z
  .object({
    ...box,
    kind: z.literal('text'),
    /**
     * KHÔNG `trim()`: xuống dòng và thụt đầu dòng là thứ người viết cố ý gõ.
     * Nhưng một hộp CHỈ có khoảng trắng thì bị từ chối — nó vô hình ở trang xem,
     * và trình dựng đã tự bỏ những hộp như vậy trước khi gửi.
     */
    text: z
      .string()
      .max(ANNOTATION_TEXT_MAX, `Một hộp văn bản tối đa ${ANNOTATION_TEXT_MAX} ký tự`)
      .refine((s) => s.trim() !== '', 'Hộp văn bản không được để trống'),
    fontSize: oneOf(ANNOTATION_FONT_SIZES, 'Cỡ chữ không hợp lệ'),
    bold: z.boolean(),
    italic: z.boolean(),
    align: z.enum(TEXT_ALIGNS),
    valign: z.enum(TEXT_VALIGNS),
    color,
    /** `null` = trong suốt. */
    fill: color.nullable(),
  })
  .strict();

export const lineAnnotationSchema = z
  .object({
    ...box,
    kind: z.literal('line'),
    direction: z.enum(LINE_DIRECTIONS),
    style: z.enum(LINE_STYLES),
    width: oneOf(STROKE_WIDTHS, 'Độ dày nét không hợp lệ'),
    color,
    arrow: z.enum(LINE_ARROWS),
  })
  .strict();

export const shapeAnnotationSchema = z
  .object({
    ...box,
    kind: z.literal('shape'),
    shape: z.enum(SHAPE_TYPES),
    /** `null` = không tô. */
    fill: color.nullable(),
    /** Độ đậm của nền, tính bằng phần trăm — nền nhạt đè lên biểu đồ vẫn thấy được số bên dưới. */
    opacity: z.coerce.number().int().min(0).max(100),
    /** `null` = không viền. */
    stroke: color.nullable(),
    strokeWidth: oneOf(STROKE_WIDTHS, 'Độ dày viền không hợp lệ'),
    strokeStyle: z.enum(['solid', 'dashed'] as const),
  })
  .strict();

/**
 * Một chú thích.
 *
 * Bề rộng được KẸP vào mép phải thay vì bị từ chối — cùng luật và cùng lý do
 * với `reportVisualSchema`: kéo một hộp sang phải rồi nới rộng là thao tác bình
 * thường, không đáng mất cả lần lưu.
 */
export const reportAnnotationSchema = z
  .discriminatedUnion('kind', [textAnnotationSchema, lineAnnotationSchema, shapeAnnotationSchema])
  .transform((a) => ({ ...a, w: Math.min(a.w, CANVAS_COLUMNS - a.x) }));

export type TextAnnotationDto = z.output<typeof textAnnotationSchema>;
export type LineAnnotationDto = z.output<typeof lineAnnotationSchema>;
export type ShapeAnnotationDto = z.output<typeof shapeAnnotationSchema>;
export type ReportAnnotationDto = TextAnnotationDto | LineAnnotationDto | ShapeAnnotationDto;

/**
 * Đọc KHOAN DUNG một mảng chú thích đã lưu.
 *
 * Chú thích hỏng bị bỏ qua, không làm hỏng cả trang — cùng lập luận với
 * `parseVisuals` ở repository: một hộp văn bản có mã màu lạ không được phép
 * chặn đường vào sửa cả báo cáo. Không phải mảng (bản ghi trước §10.18) thì là
 * mảng rỗng.
 */
export function parseAnnotations(raw: unknown): ReportAnnotationDto[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const parsed = reportAnnotationSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}
