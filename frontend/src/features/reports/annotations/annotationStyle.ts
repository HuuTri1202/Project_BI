import type {
  AnnotationLayer,
  LineAnnotationDto,
  ShapeAnnotationDto,
  TextAnnotationDto,
} from '@bi/shared';

/**
 * Phép tính HÌNH của chú thích — §10.18. Dùng CHUNG giữa trình dựng và trang xem.
 *
 * File riêng, không nằm trong `AnnotationView.tsx`: quy tắc `react-refresh` chỉ
 * thay nóng được module chỉ xuất component. Cùng lý do `canvasLayout.ts` tách
 * khỏi `CanvasGrid`.
 *
 * Hộp văn bản của trình dựng khi đang GÕ là một `<textarea>`, còn lúc xem là
 * một đoạn chữ thường. Cả hai đọc cỡ chữ, màu, căn lề từ `textStyle` ở đây, nên
 * bấm đúp để sửa không làm chữ nhảy sang một kiểu khác.
 */

/**
 * Tầng vẽ trên lưới.
 *
 * ⚠️ Phải là `z-index`, không trông vào thứ tự trong DOM được. Thứ tự DOM chỉ
 * quyết định giữa những ô KHÔNG định vị; mà ô biểu đồ ở trình dựng là
 * `relative`, còn vega-embed bên trong ô ở trang xem cũng là `relative`. Một
 * phần tử định vị luôn được vẽ đè lên phần tử không định vị bất kể thứ tự — tức
 * là biểu đồ sẽ đè lên mũi tên "nằm trên biểu đồ". Grid item có `z-index` thì tự
 * thành một stacking context, và khi đó thứ tự trở lại đúng như khai.
 */
export const CANVAS_LAYER_Z: Record<AnnotationLayer | 'visual', number> = {
  back: 1,
  visual: 2,
  front: 3,
};

/** `#RRGGBB` + phần trăm → `rgba()`. Schema đã bảo đảm đúng sáu chữ số hex. */
export function withOpacity(hex: string, percent: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const alpha = Math.min(Math.max(percent, 0), 100) / 100;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/*
 * `safe`: chữ dài hơn hộp thì tràn xuống DƯỚI và bị cắt ở đó. Không có nó,
 * căn giữa làm chữ tràn đều hai đầu — và dòng ĐẦU TIÊN, dòng quan trọng nhất,
 * là dòng bị cắt mất.
 */
const JUSTIFY: Record<TextAnnotationDto['valign'], string> = {
  top: 'flex-start',
  middle: 'safe center',
  bottom: 'safe flex-end',
};

/** Khung ngoài của hộp văn bản — nền, bo góc, và căn DỌC. */
export function textFrameStyle(a: TextAnnotationDto): React.CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: JUSTIFY[a.valign],
    width: '100%',
    height: '100%',
    padding: '4px 8px',
    boxSizing: 'border-box',
    overflow: 'hidden',
    backgroundColor: a.fill ?? 'transparent',
    borderRadius: a.fill === null ? 0 : 8,
  };
}

/** Chữ bên trong — dùng chung cho đoạn chữ lúc xem và `<textarea>` lúc gõ. */
export function textStyle(a: TextAnnotationDto): React.CSSProperties {
  return {
    margin: 0,
    color: a.color,
    fontSize: a.fontSize,
    fontWeight: a.bold ? 700 : 400,
    fontStyle: a.italic ? 'italic' : 'normal',
    textAlign: a.align,
    lineHeight: 1.3,
    // Xuống dòng người viết gõ phải hiện ra đúng chỗ đó.
    whiteSpace: 'pre-wrap',
    // Một chuỗi dài không dấu cách (đường dẫn, mã đơn) phải gãy dòng thay vì
    // thò ra khỏi hộp.
    overflowWrap: 'anywhere',
  };
}

export function shapeStyle(a: ShapeAnnotationDto): React.CSSProperties {
  return {
    width: '100%',
    height: '100%',
    boxSizing: 'border-box',
    borderRadius: a.shape === 'ellipse' ? '50%' : a.shape === 'rounded' ? 16 : 2,
    backgroundColor: a.fill === null ? 'transparent' : withOpacity(a.fill, a.opacity),
    border: a.stroke === null ? 'none' : `${a.strokeWidth}px ${a.strokeStyle} ${a.stroke}`,
  };
}

/** Cỡ đầu mũi tên, tính bằng pixel — to theo nét, nhưng nét mảnh vẫn nhìn thấy mũi. */
export function arrowSize(width: number): number {
  return 6 + width * 2.5;
}

/**
 * Hai đầu của đường kẻ, bằng PHẦN TRĂM của khung.
 *
 * Phần trăm chứ không phải toạ độ pixel đo từ DOM: `<line>` trong một `<svg>`
 * không có `viewBox` hiểu `x1="100%"` là trọn bề rộng thật, và độ dày nét vẫn
 * là pixel — không méo khi ô bị kéo dẹt, không phải đo lại mỗi lần co giãn.
 */
export function lineEnds(direction: LineAnnotationDto['direction']): {
  x1: string;
  y1: string;
  x2: string;
  y2: string;
} {
  switch (direction) {
    case 'horizontal':
      return { x1: '0%', y1: '50%', x2: '100%', y2: '50%' };
    case 'vertical':
      return { x1: '50%', y1: '0%', x2: '50%', y2: '100%' };
    case 'diagonal-down':
      return { x1: '0%', y1: '0%', x2: '100%', y2: '100%' };
    case 'diagonal-up':
      return { x1: '0%', y1: '100%', x2: '100%', y2: '0%' };
  }
}

/** Nét đứt / chấm, tỉ lệ theo độ dày — cùng một mẫu gạch trông giống nhau ở mọi độ dày. */
export function dashArray(style: LineAnnotationDto['style'], width: number): string | undefined {
  if (style === 'dashed') return `${width * 4} ${width * 3}`;
  if (style === 'dotted') return `0 ${width * 2.5}`;
  return undefined;
}
