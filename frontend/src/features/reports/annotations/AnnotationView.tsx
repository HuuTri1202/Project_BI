import type {
  LineAnnotationDto,
  ReportAnnotationDto,
  ShapeAnnotationDto,
  TextAnnotationDto,
} from '@bi/shared';
import { useId } from 'react';

import {
  arrowSize,
  dashArray,
  lineEnds,
  shapeStyle,
  textFrameStyle,
  textStyle,
} from './annotationStyle';

/**
 * Vẽ MỘT chú thích vào trọn khung chứa nó — §10.18.
 *
 * Không biết gì về lưới, về chọn, về kéo thả. Trình dựng bọc nó trong một hộp
 * kéo được (`AnnotationBox`), trang xem bọc nó trong một ô lưới trơn — và vì
 * cả hai vẽ bằng đúng component này, thứ người dựng thấy là thứ người xem thấy.
 */
export function AnnotationView({
  annotation,
  placeholder,
}: {
  annotation: ReportAnnotationDto;
  /** Chữ mờ cho hộp văn bản còn trống — chỉ trình dựng truyền vào. */
  placeholder?: string | undefined;
}): React.ReactElement {
  switch (annotation.kind) {
    case 'text':
      return <TextView annotation={annotation} placeholder={placeholder} />;
    case 'line':
      return <LineView annotation={annotation} />;
    case 'shape':
      return <ShapeView annotation={annotation} />;
  }
}

function TextView({
  annotation,
  placeholder,
}: {
  annotation: TextAnnotationDto;
  placeholder: string | undefined;
}): React.ReactElement {
  const empty = annotation.text.trim() === '';

  return (
    <div style={textFrameStyle(annotation)}>
      {empty && placeholder !== undefined ? (
        <p style={{ ...textStyle(annotation), color: '#94A3B8', fontWeight: 400 }}>{placeholder}</p>
      ) : (
        <p style={textStyle(annotation)}>{annotation.text}</p>
      )}
    </div>
  );
}

function LineView({ annotation }: { annotation: LineAnnotationDto }): React.ReactElement {
  /*
   * Mã `<marker>` phải DUY NHẤT trên cả trang: `url(#…)` tìm theo mã trong toàn
   * tài liệu, nên hai mũi tên cùng mã thì mũi tên thứ hai mượn màu của cái đầu.
   *
   * Lọc ký tự vì `useId` sinh mã có dấu hai chấm, và một số trình duyệt đọc
   * `url(#:r1:)` không ra.
   */
  const markerId = `mui-ten-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`;

  const { width, color, arrow } = annotation;
  const size = arrowSize(width);
  const hasArrow = arrow !== 'none';
  // Chừa mép bằng cỡ mũi tên để đầu mũi không bị cắt ở rìa ô.
  const pad = hasArrow ? size : Math.ceil(width / 2) + 1;

  /*
   * Đầu nét lùi vào trong mũi tên đúng `width` pixel: ở khoảng đó thân mũi đã
   * rộng bằng nét. Đặt đầu nét ngay ở đỉnh mũi thì hai góc vuông của nét dày
   * thò ra hai bên đỉnh.
   */
  const refX = 10 * (1 - width / size);

  return (
    <div className="h-full w-full" style={{ padding: pad, boxSizing: 'border-box' }}>
      <svg className="block h-full w-full overflow-visible" aria-hidden="true">
        {hasArrow && (
          <defs>
            <marker
              id={markerId}
              viewBox="0 0 10 10"
              refX={refX}
              refY={5}
              markerWidth={size}
              markerHeight={size}
              markerUnits="userSpaceOnUse"
              // `auto-start-reverse`: MỘT marker cho cả hai đầu, và đầu bắt
              // đầu tự quay ngược lại — không phải vẽ hai hình tam giác.
              orient="auto-start-reverse"
            >
              <path d="M0,0 L10,5 L0,10 z" fill={color} />
            </marker>
          </defs>
        )}
        <line
          {...lineEnds(annotation.direction)}
          stroke={color}
          strokeWidth={width}
          strokeDasharray={dashArray(annotation.style, width)}
          strokeLinecap={annotation.style === 'dotted' ? 'round' : 'butt'}
          markerStart={arrow === 'start' || arrow === 'both' ? `url(#${markerId})` : undefined}
          markerEnd={arrow === 'end' || arrow === 'both' ? `url(#${markerId})` : undefined}
        />
      </svg>
    </div>
  );
}

function ShapeView({ annotation }: { annotation: ShapeAnnotationDto }): React.ReactElement {
  return <div aria-hidden="true" style={shapeStyle(annotation)} />;
}
