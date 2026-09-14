import {
  ANNOTATION_MIN_H,
  ANNOTATION_MIN_W,
  type LineAnnotationDto,
  type ReportAnnotationDto,
  type ShapeAnnotationDto,
  type TextAnnotationDto,
} from '@bi/shared';

/**
 * Chú thích trong TRÌNH DỰNG — §10.18. Hàm thuần, không component.
 *
 * Khác biểu đồ, chú thích không có trạng thái "soạn dở": một đường kẻ vừa thả
 * xuống đã là một đường kẻ hoàn chỉnh. Nên bản đang soạn CHÍNH LÀ
 * `ReportAnnotationDto`, không có một kiểu `…Draft` riêng — thêm một kiểu thì
 * thêm một cặp `fromDto`/`toDto` phải giữ cho khớp nhau.
 *
 * Ngoại lệ duy nhất là hộp văn bản còn TRỐNG, và nó được xử ở `readyAnnotations`.
 */

export const ANNOTATION_MIN = { w: ANNOTATION_MIN_W, h: ANNOTATION_MIN_H } as const;

/** Một lựa chọn màu trong bộ chọn — tên để đọc được bằng lời, không chỉ bằng mắt. */
export interface ColorOption {
  value: string;
  label: string;
}

/**
 * Màu CHỮ và màu NÉT.
 *
 * Toàn màu đậm đọc được trên nền trắng, cộng đúng một màu trắng cho chữ đặt
 * trên khung nền tối. Đỏ, cam, xanh lá đứng riêng vì đó là ba màu người ta dùng
 * để NÓI một điều gì đó về con số — giảm, cảnh báo, đạt.
 */
export const INK_COLORS: readonly ColorOption[] = [
  { value: '#0F172A', label: 'Đen' },
  { value: '#475569', label: 'Xám đậm' },
  { value: '#94A3B8', label: 'Xám nhạt' },
  { value: '#1D4ED8', label: 'Xanh dương' },
  { value: '#B91C1C', label: 'Đỏ' },
  { value: '#C2410C', label: 'Cam' },
  { value: '#15803D', label: 'Xanh lá' },
  { value: '#FFFFFF', label: 'Trắng' },
];

/**
 * Màu NỀN — toàn màu nhạt, để chữ đen đặt lên vẫn đọc được mà không phải nghĩ.
 *
 * Vàng đứng thứ hai vì nó là màu của một tờ ghi chú dán tường: người đọc nhận
 * ra "đây là lời nhắn" trước cả khi đọc chữ.
 */
export const FILL_COLORS: readonly ColorOption[] = [
  { value: '#F1F5F9', label: 'Xám nhạt' },
  { value: '#FEF3C7', label: 'Vàng ghi chú' },
  { value: '#DBEAFE', label: 'Xanh dương nhạt' },
  { value: '#DCFCE7', label: 'Xanh lá nhạt' },
  { value: '#FEE2E2', label: 'Đỏ nhạt' },
  { value: '#EDE9FE', label: 'Tím nhạt' },
  { value: '#FFFFFF', label: 'Trắng' },
  { value: '#0F172A', label: 'Đen' },
];

export type AnnotationPresetKey =
  'title' | 'text' | 'note' | 'hline' | 'vline' | 'arrow' | 'panel' | 'circle';

export interface AnnotationPreset {
  key: AnnotationPresetKey;
  label: string;
  /** Một câu nói cái này DÙNG ĐỂ LÀM GÌ — hiện khi rê chuột lên nút. */
  hint: string;
  w: number;
  h: number;
  make: (id: string, at: { x: number; y: number }) => ReportAnnotationDto;
}

const text = (
  id: string,
  box: { x: number; y: number; w: number; h: number },
  extra: Partial<TextAnnotationDto>,
): TextAnnotationDto => ({
  id,
  ...box,
  layer: 'front',
  kind: 'text',
  text: '',
  fontSize: 14,
  bold: false,
  italic: false,
  align: 'left',
  valign: 'top',
  color: '#0F172A',
  fill: null,
  ...extra,
});

const line = (
  id: string,
  box: { x: number; y: number; w: number; h: number },
  extra: Partial<LineAnnotationDto>,
): LineAnnotationDto => ({
  id,
  ...box,
  layer: 'front',
  kind: 'line',
  direction: 'horizontal',
  style: 'solid',
  width: 2,
  color: '#94A3B8',
  arrow: 'none',
  ...extra,
});

const shape = (
  id: string,
  box: { x: number; y: number; w: number; h: number },
  extra: Partial<ShapeAnnotationDto>,
): ShapeAnnotationDto => ({
  id,
  ...box,
  layer: 'back',
  kind: 'shape',
  shape: 'rounded',
  fill: '#F1F5F9',
  opacity: 100,
  stroke: null,
  strokeWidth: 2,
  strokeStyle: 'solid',
  ...extra,
});

/**
 * Tám thứ trên thanh Chèn — chọn theo VIỆC, không theo hình học.
 *
 * Về hình học chỉ có ba loại (văn bản, đường, hình). Nhưng "một đường có mũi
 * tên màu đỏ" và "một đường kẻ ngang màu xám" là hai việc khác hẳn nhau, và
 * người dựng báo cáo nghĩ bằng việc: "tôi muốn CHỈ vào cái cột này". Mỗi nút ở
 * đây là một điểm xuất phát đã chỉnh sẵn cho đúng một việc; sau khi thả xuống,
 * mọi thứ vẫn đổi được trong bảng bên phải.
 *
 * ⚠️ Tầng mặc định KHÔNG giống nhau, và đó là chủ ý: khung nền nằm DƯỚI biểu
 * đồ (nó là cái nền), còn vòng khoanh nằm TRÊN (nó phải thấy được đè lên số).
 */
export const ANNOTATION_PRESETS: readonly AnnotationPreset[] = [
  {
    key: 'title',
    label: 'Tiêu đề',
    hint: 'Một dòng chữ to, đậm — tên cho một khu của báo cáo.',
    w: 12,
    h: 1,
    make: (id, at) =>
      text(id, { ...at, w: 12, h: 1 }, { fontSize: 24, bold: true, valign: 'middle' }),
  },
  {
    key: 'text',
    label: 'Văn bản',
    hint: 'Một đoạn giải thích: số này tính thế nào, đọc nó ra sao.',
    w: 4,
    h: 2,
    make: (id, at) => text(id, { ...at, w: 4, h: 2 }, {}),
  },
  {
    key: 'note',
    label: 'Ghi chú',
    hint: 'Tờ ghi chú vàng dán cạnh biểu đồ — "tháng 7 giảm vì đóng kho".',
    w: 3,
    h: 3,
    make: (id, at) => text(id, { ...at, w: 3, h: 3 }, { fill: '#FEF3C7' }),
  },
  {
    key: 'hline',
    label: 'Kẻ ngang',
    hint: 'Đường kẻ chia báo cáo thành từng khu.',
    w: 12,
    h: 1,
    make: (id, at) => line(id, { ...at, w: 12, h: 1 }, {}),
  },
  {
    key: 'vline',
    label: 'Kẻ dọc',
    hint: 'Đường kẻ dọc ngăn hai cột biểu đồ.',
    w: 1,
    h: 6,
    make: (id, at) => line(id, { ...at, w: 1, h: 6 }, { direction: 'vertical' }),
  },
  {
    key: 'arrow',
    label: 'Mũi tên',
    hint: 'Chỉ vào đúng chỗ người đọc cần nhìn.',
    w: 3,
    h: 2,
    make: (id, at) =>
      line(
        id,
        { ...at, w: 3, h: 2 },
        { direction: 'diagonal-down', arrow: 'end', color: '#B91C1C', width: 3 },
      ),
  },
  {
    key: 'panel',
    label: 'Khung nền',
    hint: 'Nền xám nằm dưới vài biểu đồ để gom chúng thành một khu.',
    w: 6,
    h: 7,
    make: (id, at) => shape(id, { ...at, w: 6, h: 7 }, {}),
  },
  {
    key: 'circle',
    label: 'Khoanh vùng',
    hint: 'Vòng đỏ đè lên biểu đồ, khoanh quanh một điểm bất thường.',
    w: 3,
    h: 3,
    make: (id, at) =>
      shape(
        id,
        { ...at, w: 3, h: 3 },
        { layer: 'front', shape: 'ellipse', fill: null, stroke: '#B91C1C', strokeWidth: 3 },
      ),
  },
];

export function presetOf(key: AnnotationPresetKey): AnnotationPreset {
  const found = ANNOTATION_PRESETS.find((p) => p.key === key);
  if (found === undefined) throw new Error(`Không có mẫu chú thích "${key}"`);
  return found;
}

/**
 * Chú thích LƯU ĐƯỢC của một trang.
 *
 * Hộp văn bản còn trống bị bỏ, cùng luật với ô biểu đồ chưa đủ trường
 * (`readyVisuals`): nó vô hình ở trang xem, và backend từ chối nó. Bỏ ở đây
 * thay vì chặn cả lần lưu — một người thêm hộp chữ rồi đổi ý thì phần còn lại
 * của báo cáo vẫn phải lưu được.
 */
export function readyAnnotations(list: readonly ReportAnnotationDto[]): ReportAnnotationDto[] {
  return list.filter((a) => a.kind !== 'text' || a.text.trim() !== '');
}

/**
 * Vá một chú thích.
 *
 * Kiểu của `patch` là hợp của ba loại, nên một phép trải thẳng làm TypeScript
 * mất dấu `kind`. `kind` được giữ nguyên từ bản gốc: không có thao tác nào
 * trong trình dựng biến một đường kẻ thành một hộp văn bản.
 */
export type AnnotationPatch =
  | Partial<Omit<TextAnnotationDto, 'kind' | 'id'>>
  | Partial<Omit<LineAnnotationDto, 'kind' | 'id'>>
  | Partial<Omit<ShapeAnnotationDto, 'kind' | 'id'>>;

export function applyPatch(a: ReportAnnotationDto, patch: AnnotationPatch): ReportAnnotationDto {
  return { ...a, ...patch, kind: a.kind, id: a.id } as ReportAnnotationDto;
}

/**
 * Bản sao lệch xuống MỘT hàng — đặt chồng khít lên bản gốc thì người dùng bấm
 * "Nhân bản" rồi không thấy gì xảy ra.
 *
 * Mã mới do nơi gọi truyền vào (`newVisualId`) chứ không sinh ở đây: file này
 * không nhập `visual.ts`, vì `visual.ts` đã nhập file này — một vòng nhập nhau
 * là thứ chạy được hôm nay và hỏng ngày ai đó dời một hằng lên đầu module.
 */
export function duplicateOf(a: ReportAnnotationDto, id: string): ReportAnnotationDto {
  return { ...a, id, y: Math.min(a.y + 1, MAX_Y) };
}

/** Cùng trần `y` với schema ở `@bi/shared`. */
const MAX_Y = 500;

/**
 * Đưa lên trên cùng / xuống dưới cùng TRONG TẦNG của nó.
 *
 * Thứ tự trong mảng là thứ tự vẽ (xem `AnnotationLayer`), nên "lên trên cùng"
 * là dời xuống cuối mảng. Không cần lọc theo tầng: hai tầng được vẽ tách riêng,
 * nên thứ tự tương đối giữa một khung nền và một mũi tên không có nghĩa gì.
 */
export function moveInLayer(
  list: readonly ReportAnnotationDto[],
  id: string,
  to: 'top' | 'bottom',
): ReportAnnotationDto[] {
  const item = list.find((a) => a.id === id);
  if (item === undefined) return [...list];
  const rest = list.filter((a) => a.id !== id);
  return to === 'top' ? [...rest, item] : [item, ...rest];
}

/** Một câu ngắn gọi tên chú thích — cho `aria-label` và cho người dùng bàn phím. */
export function describeAnnotation(a: ReportAnnotationDto): string {
  if (a.kind === 'text') {
    const first = a.text.trim().split('\n')[0] ?? '';
    return first === '' ? 'Hộp văn bản trống' : `Văn bản: ${first.slice(0, 40)}`;
  }
  if (a.kind === 'line') return a.arrow === 'none' ? 'Đường kẻ' : 'Mũi tên';
  return a.shape === 'ellipse' ? 'Hình tròn' : 'Khung hình chữ nhật';
}
