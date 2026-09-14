import {
  ANNOTATION_FONT_SIZES,
  ANNOTATION_KIND_LABELS,
  ANNOTATION_TEXT_MAX,
  STROKE_WIDTHS,
  type LineAnnotationDto,
  type ReportAnnotationDto,
  type ShapeAnnotationDto,
  type TextAnnotationDto,
} from '@bi/shared';

import { PanelTitle } from './controls';
import { FILL_COLORS, INK_COLORS, type AnnotationPatch, type ColorOption } from './annotation';

/**
 * Bảng chỉnh MỘT chú thích — §10.18. Chiếm chỗ của `VisualPanel` khi thứ đang
 * chọn trên khung là một chú thích chứ không phải một biểu đồ.
 *
 * Không giữ state riêng, cùng lý do với `VisualPanel`: mọi thay đổi đi ra qua
 * `onChange` rồi quay lại thành `annotation` mới.
 *
 * ═══ Nút bấm thấy được, không phải ô chọn thả xuống ═════════════════════════
 *
 * Cỡ chữ, căn lề, hướng đường kẻ, kiểu mũi tên: mỗi thứ có ba tới sáu lựa chọn,
 * và người dùng chọn bằng MẮT — "cái mũi tên chỉ sang phải". Một `<select>` bắt
 * họ đọc chữ "Cuối" rồi đoán nó là đầu nào. Cùng lập luận đã đưa bảng màu biểu
 * đồ từ ô chọn sang dãy ô vuông (`PaletteChoice`).
 */
export function AnnotationPanel({
  annotation,
  onChange,
  onRemove,
  onDuplicate,
  onMove,
}: {
  annotation: ReportAnnotationDto;
  onChange: (patch: AnnotationPatch) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onMove: (to: 'top' | 'bottom') => void;
}): React.ReactElement {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <PanelTitle>{ANNOTATION_KIND_LABELS[annotation.kind]}</PanelTitle>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={onDuplicate}
            className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
          >
            Nhân bản
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="rounded-md border border-slate-200 px-2 py-1 text-xs text-red-600 hover:border-red-200 hover:bg-red-50"
          >
            Xoá
          </button>
        </div>
      </div>

      {annotation.kind === 'text' && <TextFields annotation={annotation} onChange={onChange} />}
      {annotation.kind === 'line' && <LineFields annotation={annotation} onChange={onChange} />}
      {annotation.kind === 'shape' && <ShapeFields annotation={annotation} onChange={onChange} />}

      <div className="space-y-3">
        <PanelTitle>Sắp lớp</PanelTitle>
        <Segmented
          label="Nằm ở"
          value={annotation.layer}
          onChange={(layer) => onChange({ layer })}
          options={[
            { value: 'front', label: 'Trên biểu đồ' },
            { value: 'back', label: 'Dưới biểu đồ' },
          ]}
          hint={
            annotation.layer === 'back'
              ? 'Biểu đồ đè lên nó — hợp cho khung nền gom vài biểu đồ thành một khu.'
              : 'Nó đè lên biểu đồ — hợp cho mũi tên và vòng khoanh chỉ vào con số.'
          }
        />
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => onMove('top')}
            className="flex-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
          >
            Lên trên cùng
          </button>
          <button
            type="button"
            onClick={() => onMove('bottom')}
            className="flex-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
          >
            Xuống dưới cùng
          </button>
        </div>
      </div>

      {/* Phím tắt là đường ĐẦY ĐỦ, không phải lối phụ — nhưng không ai đoán ra
          được Enter mở ô gõ chữ nếu không có chỗ nào nói ra. */}
      <p className="text-xs leading-snug text-slate-400">
        Kéo để dời, kéo góc dưới-phải để đổi cỡ.
        {annotation.kind === 'text' && ' Bấm đúp (hoặc Enter) để gõ chữ, Esc để thôi.'} Trên bàn
        phím: mũi tên dời, Shift+mũi tên đổi cỡ, Delete xoá.
      </p>
    </div>
  );
}

function TextFields({
  annotation,
  onChange,
}: {
  annotation: TextAnnotationDto;
  onChange: (patch: Partial<TextAnnotationDto>) => void;
}): React.ReactElement {
  return (
    <div className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-700">Nội dung</span>
        <textarea
          value={annotation.text}
          onChange={(e) => onChange({ text: e.target.value })}
          maxLength={ANNOTATION_TEXT_MAX}
          rows={3}
          placeholder="Nhập chữ…"
          className="w-full resize-y rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
        />
        {/* Hộp trống không lỗi gì lúc lưu — nó chỉ lặng lẽ không được lưu. Nói
            ra, không thì người dùng mở lại báo cáo và tưởng mất hộp. */}
        {annotation.text.trim() === '' && (
          <span className="mt-1 block text-xs leading-snug text-amber-700">
            Hộp còn trống sẽ không được lưu.
          </span>
        )}
      </label>

      <Segmented
        label="Cỡ chữ"
        value={annotation.fontSize}
        onChange={(fontSize) => onChange({ fontSize })}
        options={ANNOTATION_FONT_SIZES.map((n) => ({ value: n, label: String(n) }))}
      />

      <div role="group" aria-label="Kiểu chữ">
        <span className="mb-1 block text-xs font-medium text-slate-700">Kiểu chữ</span>
        <div className="flex gap-1.5">
          <PressButton
            pressed={annotation.bold}
            onClick={() => onChange({ bold: !annotation.bold })}
            label="Đậm"
          >
            <span className="font-bold">B</span>
          </PressButton>
          <PressButton
            pressed={annotation.italic}
            onClick={() => onChange({ italic: !annotation.italic })}
            label="Nghiêng"
          >
            <span className="italic">I</span>
          </PressButton>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Segmented
          label="Căn ngang"
          value={annotation.align}
          onChange={(align) => onChange({ align })}
          options={[
            {
              value: 'left',
              label: 'Trái',
              icon: <AlignIcon lines={['M4 6h16', 'M4 12h10', 'M4 18h13']} />,
            },
            {
              value: 'center',
              label: 'Giữa',
              icon: <AlignIcon lines={['M4 6h16', 'M7 12h10', 'M5.5 18h13']} />,
            },
            {
              value: 'right',
              label: 'Phải',
              icon: <AlignIcon lines={['M4 6h16', 'M10 12h10', 'M7 18h13']} />,
            },
          ]}
        />
        <Segmented
          label="Căn dọc"
          value={annotation.valign}
          onChange={(valign) => onChange({ valign })}
          options={[
            { value: 'top', label: 'Trên', icon: <AlignIcon lines={['M4 4h16', 'M8 9h8']} /> },
            {
              value: 'middle',
              label: 'Giữa',
              icon: <AlignIcon lines={['M8 12h8', 'M4 4h16', 'M4 20h16']} faint={[1, 2]} />,
            },
            { value: 'bottom', label: 'Dưới', icon: <AlignIcon lines={['M4 20h16', 'M8 15h8']} /> },
          ]}
        />
      </div>

      <ColorChoice
        label="Màu chữ"
        value={annotation.color}
        options={INK_COLORS}
        onChange={(color) => color !== null && onChange({ color })}
      />
      <ColorChoice
        label="Màu nền"
        value={annotation.fill}
        options={FILL_COLORS}
        allowNone
        onChange={(fill) => onChange({ fill })}
      />
    </div>
  );
}

function LineFields({
  annotation,
  onChange,
}: {
  annotation: LineAnnotationDto;
  onChange: (patch: Partial<LineAnnotationDto>) => void;
}): React.ReactElement {
  return (
    <div className="space-y-3">
      <Segmented
        label="Hướng"
        value={annotation.direction}
        onChange={(direction) => onChange({ direction })}
        options={[
          { value: 'horizontal', label: 'Ngang', icon: <StrokeIcon d="M3 12h18" /> },
          { value: 'vertical', label: 'Dọc', icon: <StrokeIcon d="M12 3v18" /> },
          { value: 'diagonal-down', label: 'Chéo xuống', icon: <StrokeIcon d="M4 4l16 16" /> },
          { value: 'diagonal-up', label: 'Chéo lên', icon: <StrokeIcon d="M4 20L20 4" /> },
        ]}
      />
      <Segmented
        label="Mũi tên"
        value={annotation.arrow}
        onChange={(arrow) => onChange({ arrow })}
        options={[
          { value: 'none', label: 'Không có', icon: <StrokeIcon d="M3 12h18" /> },
          { value: 'start', label: 'Ở đầu', icon: <StrokeIcon d="M3 12h18M8 7l-5 5 5 5" /> },
          { value: 'end', label: 'Ở cuối', icon: <StrokeIcon d="M3 12h18M16 7l5 5-5 5" /> },
          {
            value: 'both',
            label: 'Hai đầu',
            icon: <StrokeIcon d="M3 12h18M8 7l-5 5 5 5M16 7l5 5-5 5" />,
          },
        ]}
      />
      <Segmented
        label="Kiểu nét"
        value={annotation.style}
        onChange={(style) => onChange({ style })}
        options={[
          { value: 'solid', label: 'Liền', icon: <StrokeIcon d="M3 12h18" /> },
          { value: 'dashed', label: 'Gạch', icon: <StrokeIcon d="M3 12h18" dash="5 3" /> },
          { value: 'dotted', label: 'Chấm', icon: <StrokeIcon d="M3 12h18" dash="0 4" round /> },
        ]}
      />
      <Segmented
        label="Độ dày"
        value={annotation.width}
        onChange={(width) => onChange({ width })}
        options={STROKE_WIDTHS.map((n) => ({ value: n, label: `${n}px` }))}
      />
      <ColorChoice
        label="Màu"
        value={annotation.color}
        options={INK_COLORS}
        onChange={(color) => color !== null && onChange({ color })}
      />
    </div>
  );
}

/** Các bậc độ đậm của nền — bậc nhạt để đặt đè lên biểu đồ mà vẫn đọc được số bên dưới. */
const OPACITIES = [100, 60, 30, 15] as const;

function ShapeFields({
  annotation,
  onChange,
}: {
  annotation: ShapeAnnotationDto;
  onChange: (patch: Partial<ShapeAnnotationDto>) => void;
}): React.ReactElement {
  return (
    <div className="space-y-3">
      <Segmented
        label="Hình"
        value={annotation.shape}
        onChange={(shape) => onChange({ shape })}
        options={[
          { value: 'rect', label: 'Chữ nhật', icon: <ShapeIcon radius={1} /> },
          { value: 'rounded', label: 'Bo góc', icon: <ShapeIcon radius={5} /> },
          { value: 'ellipse', label: 'Tròn', icon: <ShapeIcon radius={12} /> },
        ]}
      />
      <ColorChoice
        label="Màu nền"
        value={annotation.fill}
        options={FILL_COLORS}
        allowNone
        onChange={(fill) => onChange({ fill })}
      />
      {/* Ẩn hẳn chứ không khoá khi không có nền: một thanh độ đậm cho một màu
          không tồn tại là một câu hỏi không có nghĩa. */}
      {annotation.fill !== null && (
        <Segmented
          label="Độ đậm nền"
          value={OPACITIES.find((o) => o === annotation.opacity) ?? 100}
          onChange={(opacity) => onChange({ opacity })}
          options={OPACITIES.map((n) => ({ value: n, label: `${n}%` }))}
          hint={
            annotation.layer === 'front' && annotation.opacity > 30
              ? 'Hình đang nằm TRÊN biểu đồ — nền đậm sẽ che mất số bên dưới.'
              : undefined
          }
        />
      )}
      <ColorChoice
        label="Viền"
        value={annotation.stroke}
        options={INK_COLORS}
        allowNone
        onChange={(stroke) => onChange({ stroke })}
      />
      {annotation.stroke !== null && (
        <div className="grid grid-cols-2 gap-2">
          <Segmented
            label="Độ dày viền"
            value={annotation.strokeWidth}
            onChange={(strokeWidth) => onChange({ strokeWidth })}
            options={STROKE_WIDTHS.map((n) => ({ value: n, label: String(n) }))}
          />
          <Segmented
            label="Kiểu viền"
            value={annotation.strokeStyle}
            onChange={(strokeStyle) => onChange({ strokeStyle })}
            options={[
              { value: 'solid', label: 'Liền', icon: <StrokeIcon d="M3 12h18" /> },
              { value: 'dashed', label: 'Gạch', icon: <StrokeIcon d="M3 12h18" dash="5 3" /> },
            ]}
          />
        </div>
      )}
    </div>
  );
}

/* ─── Mảnh giao diện ─────────────────────────────────────────────────────── */

/**
 * Một hàng nút loại trừ nhau.
 *
 * `radiogroup` chứ không phải một mớ nút, cùng lý do với `PaletteChoice`: trình
 * đọc màn hình phải đọc ra "Giữa, đã chọn, 2 trong 3". Nút có hình thì tên vẫn
 * nằm trong `title` và trong `sr-only` — hình một mình không đọc được bằng lời.
 */
function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
  hint,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string; icon?: React.ReactNode }[];
  onChange: (value: T) => void;
  hint?: string | undefined;
}): React.ReactElement {
  return (
    <div role="radiogroup" aria-label={label}>
      <span className="mb-1 block text-xs font-medium text-slate-700">{label}</span>
      <div className="flex gap-0.5 rounded-lg border border-slate-300 bg-white p-0.5">
        {options.map((option) => {
          const chosen = option.value === value;
          return (
            <button
              key={String(option.value)}
              type="button"
              role="radio"
              aria-checked={chosen}
              title={option.label}
              onClick={() => onChange(option.value)}
              className={`flex min-w-0 flex-1 items-center justify-center rounded-md px-1 py-1 text-xs transition-colors ${
                chosen
                  ? 'text-brand-800 bg-brand-50 font-semibold ring-1 ring-brand-500/40'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {option.icon ?? option.label}
              {option.icon !== undefined && <span className="sr-only">{option.label}</span>}
            </button>
          );
        })}
      </div>
      {hint !== undefined && (
        <span className="mt-1 block text-xs leading-snug text-slate-500">{hint}</span>
      )}
    </div>
  );
}

function PressButton({
  pressed,
  onClick,
  label,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`h-8 w-8 rounded-lg border text-sm transition-colors ${
        pressed
          ? 'text-brand-800 border-brand-500 bg-brand-50'
          : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Chọn màu: một dãy ô màu có tên, "không màu" nếu được phép, và một ô "màu khác".
 *
 * Dãy có sẵn là đường chính — màu đã chọn để chữ đen đọc được trên nền, và để
 * hai người dựng hai báo cáo vẫn ra cùng một thứ màu xám. Ô "màu khác" là cho
 * màu thương hiệu của công ty, thứ không dãy có sẵn nào đoán trước được.
 */
function ColorChoice({
  label,
  value,
  options,
  allowNone = false,
  onChange,
}: {
  label: string;
  value: string | null;
  options: readonly ColorOption[];
  allowNone?: boolean;
  onChange: (value: string | null) => void;
}): React.ReactElement {
  const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();
  const custom = value !== null && !options.some((o) => same(o.value, value));
  const ring = 'ring-2 ring-brand-500 ring-offset-1';

  return (
    <div role="radiogroup" aria-label={label}>
      <span className="mb-1 block text-xs font-medium text-slate-700">{label}</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {allowNone && (
          <button
            type="button"
            role="radio"
            aria-checked={value === null}
            title="Không màu"
            onClick={() => onChange(null)}
            className={`relative h-6 w-6 overflow-hidden rounded-md border border-slate-300 bg-white ${
              value === null ? ring : ''
            }`}
          >
            {/* Gạch chéo đỏ — ký hiệu "không có" mà ai cũng đọc được. */}
            <svg viewBox="0 0 24 24" className="absolute inset-0 h-full w-full" aria-hidden="true">
              <path d="M3 21L21 3" stroke="#DC2626" strokeWidth="2" />
            </svg>
            <span className="sr-only">Không màu</span>
          </button>
        )}
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value !== null && same(option.value, value)}
            title={option.label}
            onClick={() => onChange(option.value)}
            style={{ backgroundColor: option.value }}
            className={`h-6 w-6 rounded-md border border-slate-300 ${
              value !== null && same(option.value, value) ? ring : ''
            }`}
          >
            <span className="sr-only">{option.label}</span>
          </button>
        ))}
        <label
          title="Màu khác"
          style={custom ? { backgroundColor: value } : undefined}
          className={`relative h-6 w-6 cursor-pointer overflow-hidden rounded-md border border-slate-300 ${
            custom ? ring : ''
          }`}
        >
          {!custom && (
            <span
              aria-hidden="true"
              className="absolute inset-0"
              style={{
                background:
                  'conic-gradient(#ef4444, #f59e0b, #22c55e, #06b6d4, #3b82f6, #a855f7, #ef4444)',
              }}
            />
          )}
          <input
            type="color"
            value={value ?? '#000000'}
            onChange={(e) => onChange(e.target.value.toUpperCase())}
            aria-label={`${label}: màu khác`}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </label>
      </div>
    </div>
  );
}

function AlignIcon({
  lines,
  faint = [],
}: {
  lines: string[];
  /** Chỉ số những nét vẽ mờ — đường biên trên/dưới của biểu tượng căn giữa. */
  faint?: number[];
}): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden="true">
      {lines.map((d, i) => (
        <path
          key={d}
          d={d}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          opacity={faint.includes(i) ? 0.35 : 1}
        />
      ))}
    </svg>
  );
}

function StrokeIcon({
  d,
  dash,
  round = false,
}: {
  d: string;
  dash?: string;
  round?: boolean;
}): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden="true">
      <path
        d={d}
        stroke="currentColor"
        strokeWidth="2"
        strokeDasharray={dash}
        strokeLinecap={round ? 'round' : 'butt'}
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ShapeIcon({ radius }: { radius: number }): React.ReactElement {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx={radius} stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
