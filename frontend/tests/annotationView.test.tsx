import {
  CANVAS_ROW_HEIGHT,
  type LineAnnotationDto,
  type ReportPageDto,
  type ShapeAnnotationDto,
  type TextAnnotationDto,
} from '@bi/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AnnotationView } from '../src/features/reports/annotations/AnnotationView';
import { CANVAS_GAP } from '../src/features/reports/canvasLayout';
import { AnnotationBox } from '../src/features/reports/builder/AnnotationBox';
import { CanvasView } from '../src/features/reports/CanvasView';

/**
 * Vẽ chú thích, và hộp chú thích trong trình dựng — §10.18.
 *
 * Nhóm cuối là nhóm đáng giá nhất: một hộp văn bản mà Backspace để xoá một chữ
 * lại xoá luôn cả hộp là thứ không test đơn vị nào khác bắt được, và người dùng
 * gặp nó ở đúng lần gõ đầu tiên.
 */

const text: TextAnnotationDto = {
  id: 't1',
  x: 0,
  y: 0,
  w: 4,
  h: 2,
  layer: 'front',
  kind: 'text',
  text: 'Doanh thu quý 3\ngiảm do đóng kho',
  fontSize: 20,
  bold: true,
  italic: false,
  align: 'center',
  valign: 'middle',
  color: '#B91C1C',
  fill: '#FEF3C7',
};

const line: LineAnnotationDto = {
  id: 'l1',
  x: 0,
  y: 10,
  w: 6,
  h: 1,
  layer: 'front',
  kind: 'line',
  direction: 'horizontal',
  style: 'dashed',
  width: 2,
  color: '#475569',
  arrow: 'end',
};

const shape: ShapeAnnotationDto = {
  id: 's1',
  x: 0,
  y: 0,
  w: 6,
  h: 8,
  layer: 'back',
  kind: 'shape',
  shape: 'ellipse',
  fill: '#DBEAFE',
  opacity: 30,
  stroke: null,
  strokeWidth: 2,
  strokeStyle: 'solid',
};

describe('AnnotationView', () => {
  it('văn bản giữ nguyên chỗ xuống dòng và mang đúng cỡ, màu, đậm', () => {
    render(<AnnotationView annotation={text} />);
    const p = screen.getByText(/Doanh thu quý 3/);

    expect(p.textContent).toBe('Doanh thu quý 3\ngiảm do đóng kho');
    expect(p).toHaveStyle({
      fontSize: '20px',
      fontWeight: '700',
      textAlign: 'center',
      whiteSpace: 'pre-wrap',
      color: '#B91C1C',
    });
  });

  it('chữ mờ gợi ý CHỈ hiện khi được truyền vào — trang xem không bao giờ hiện nó', () => {
    const trong = { ...text, text: '' };
    const { rerender } = render(<AnnotationView annotation={trong} />);
    expect(screen.queryByText('Bấm đúp để nhập chữ')).toBeNull();

    rerender(<AnnotationView annotation={trong} placeholder="Bấm đúp để nhập chữ" />);
    expect(screen.getByText('Bấm đúp để nhập chữ')).toBeInTheDocument();
  });

  it('hai mũi tên trên cùng trang có HAI marker riêng — không mượn màu của nhau', () => {
    const { container } = render(
      <>
        <AnnotationView annotation={line} />
        <AnnotationView annotation={{ ...line, id: 'l2', color: '#B91C1C', arrow: 'both' }} />
      </>,
    );
    const markers = [...container.querySelectorAll('marker')];
    expect(markers).toHaveLength(2);
    expect(markers[0]?.id).not.toBe(markers[1]?.id);

    const [first, second] = [...container.querySelectorAll('line')];
    expect(first?.getAttribute('marker-end')).toBe(`url(#${markers[0]?.id})`);
    expect(first?.getAttribute('marker-start')).toBeNull();
    expect(second?.getAttribute('marker-start')).toBe(`url(#${markers[1]?.id})`);
    expect(markers[1]?.querySelector('path')?.getAttribute('fill')).toBe('#B91C1C');
  });

  it('đường kẻ không mũi tên thì không có marker nào', () => {
    const { container } = render(<AnnotationView annotation={{ ...line, arrow: 'none' }} />);
    expect(container.querySelector('marker')).toBeNull();
    expect(container.querySelector('line')?.getAttribute('stroke-dasharray')).toBe('8 6');
  });

  it('hình tròn: bo 50%, nền pha độ đậm, không viền khi `stroke` là null', () => {
    const { container } = render(<AnnotationView annotation={shape} />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.borderRadius).toBe('50%');
    expect(el.style.backgroundColor).toBe('rgba(219, 234, 254, 0.3)');
    expect(el.style.borderStyle).toBe('none');
  });
});

describe('CanvasView với chú thích', () => {
  const page: ReportPageDto = {
    id: 'p1',
    name: 'Một',
    visuals: [
      {
        id: 'v1',
        chartType: 'bar',
        config: { dimensionId: 1, measureId: 2, limit: 10 },
        x: 0,
        y: 0,
        w: 6,
        h: 6,
      },
    ],
    // Cố ý đảo thứ tự trong mảng: tầng quyết định chỗ vẽ, không phải vị trí.
    annotations: [text, shape, line],
  };

  const ve = () =>
    render(
      <QueryClientProvider client={new QueryClient()}>
        <CanvasView page={page} reportId={1} data={undefined} />
      </QueryClientProvider>,
    );

  /** Ô lưới của một chú thích, tìm theo nội dung chứ không theo vị trí trong DOM. */
  const oCua = (grid: HTMLElement) => {
    const cells = [...grid.children] as HTMLElement[];
    return {
      bieuDo: cells.find((el) => el.tagName === 'SECTION'),
      chu: cells.find((el) => el.textContent?.startsWith('Doanh thu quý 3')),
      nen: cells.find((el) => el.style.zIndex === '1'),
      duong: cells.find((el) => el.querySelector('line') !== null),
    };
  };

  it('ba tầng do z-index quyết định: khung nền 1, biểu đồ 2, chú thích nổi 3', () => {
    const { container } = ve();
    const o = oCua(container.firstElementChild as HTMLElement);

    expect(o.bieuDo?.style.zIndex).toBe('2');
    expect(o.chu?.style.zIndex).toBe('3');
    expect(o.duong?.style.zIndex).toBe('3');
    // Khung nền đứng GIỮA hai chú thích nổi trong mảng, và vẫn nằm dưới biểu đồ.
    expect(o.nen?.firstElementChild).toHaveStyle({ borderRadius: '50%' });
  });

  it('đổi tầng KHÔNG gắn lại phần tử — hộp giữ nguyên tiêu điểm và trạng thái', () => {
    // Bản đầu vẽ hai danh sách "dưới" và "trên": đổi tầng là gỡ khỏi danh sách
    // này, gắn mới vào danh sách kia, và hộp đang gõ dở mất luôn ô gõ.
    const client = new QueryClient();
    const { container, rerender } = render(
      <QueryClientProvider client={client}>
        <CanvasView page={page} reportId={1} data={undefined} />
      </QueryClientProvider>,
    );
    const truoc = oCua(container.firstElementChild as HTMLElement).nen;

    rerender(
      <QueryClientProvider client={client}>
        <CanvasView
          page={{ ...page, annotations: [text, { ...shape, layer: 'front' }, line] }}
          reportId={1}
          data={undefined}
        />
      </QueryClientProvider>,
    );
    const grid = container.firstElementChild as HTMLElement;
    const sau = [...grid.children].find(
      (el) => (el.firstElementChild as HTMLElement | null)?.style.borderRadius === '50%',
    ) as HTMLElement;

    expect(sau).toBe(truoc);
    expect(sau.style.zIndex).toBe('3');
  });

  it('đường kẻ và hình không chặn chuột của biểu đồ; hộp chữ thì chép được', () => {
    const { container } = ve();
    const o = oCua(container.firstElementChild as HTMLElement);

    expect(o.nen).toHaveClass('pointer-events-none');
    expect(o.duong).toHaveClass('pointer-events-none');
    expect(o.chu).not.toHaveClass('pointer-events-none');
  });

  it('chú thích nằm dưới đáy biểu đồ cuối cùng vẫn được tính vào chiều cao khung', () => {
    const { container } = ve();
    // Đường kẻ ở hàng 10, cao 1 → khung phải cao ít nhất 11 hàng, không phải 8
    // hàng tối thiểu hay 6 hàng của biểu đồ.
    //
    // Từ §10.24 điều này CHỈ còn đúng nhờ `rowsNeeded` + `minHeight`: chú thích
    // định vị tuyệt đối, nó không còn là ô lưới nên không tự kéo dài khung nữa.
    expect((container.firstElementChild as HTMLElement).style.minHeight).toBe(
      `${11 * (CANVAS_ROW_HEIGHT + CANVAS_GAP) - CANVAS_GAP}px`,
    );
  });
});

describe('AnnotationBox — phím bấm', () => {
  const handlers = () => ({
    onSelect: vi.fn(),
    onGrabMove: vi.fn(),
    onGrabResize: vi.fn(),
    onPointerMove: vi.fn(),
    onPointerUp: vi.fn(),
    onKeyDown: vi.fn(),
    onRemove: vi.fn(),
    onEdit: vi.fn(),
    onText: vi.fn(),
  });

  it('Backspace và mũi tên TRONG ô gõ chữ không đụng tới hộp', () => {
    const h = handlers();
    render(<AnnotationBox annotation={text} selected editing {...h} />);
    const o = screen.getByRole('textbox', { name: 'Nội dung hộp văn bản' });

    fireEvent.keyDown(o, { key: 'Backspace' });
    fireEvent.keyDown(o, { key: 'Delete' });
    fireEvent.keyDown(o, { key: 'ArrowLeft' });

    expect(h.onKeyDown).not.toHaveBeenCalled();
    expect(h.onRemove).not.toHaveBeenCalled();
  });

  it('gõ chữ đi ra qua `onText`', () => {
    const h = handlers();
    render(<AnnotationBox annotation={text} selected editing {...h} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Mới' } });
    expect(h.onText).toHaveBeenCalledWith('Mới');
  });

  it('Esc trả tiêu điểm về hộp, và rời ô gõ là kết thúc chế độ gõ', () => {
    const h = handlers();
    render(<AnnotationBox annotation={text} selected editing {...h} />);
    const o = screen.getByRole('textbox');
    o.focus();

    fireEvent.keyDown(o, { key: 'Escape' });

    expect(document.activeElement?.tagName).toBe('SECTION');
    expect(h.onEdit).toHaveBeenCalledWith(false);
  });

  it('hộp đang chọn (không gõ): Delete đi vào phím tắt chung, Enter mở ô gõ', () => {
    const h = handlers();
    render(<AnnotationBox annotation={text} selected editing={false} {...h} />);
    const hop = screen.getByRole('region');

    fireEvent.keyDown(hop, { key: 'Delete' });
    expect(h.onKeyDown).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(hop, { key: 'Enter' });
    expect(h.onEdit).toHaveBeenCalledWith(true);
    // Enter không bị chuyển tiếp thành một phím di chuyển.
    expect(h.onKeyDown).toHaveBeenCalledTimes(1);
  });

  it('bấm đúp mở ô gõ ở hộp văn bản, KHÔNG làm gì ở đường kẻ', () => {
    const h = handlers();
    const { rerender } = render(
      <AnnotationBox annotation={text} selected={false} editing={false} {...h} />,
    );
    fireEvent.doubleClick(screen.getByRole('region'));
    expect(h.onEdit).toHaveBeenCalledWith(true);

    const h2 = handlers();
    rerender(<AnnotationBox annotation={line} selected={false} editing={false} {...h2} />);
    fireEvent.doubleClick(screen.getByRole('region'));
    expect(h2.onEdit).not.toHaveBeenCalled();
    // Enter trên đường kẻ đi thẳng vào phím tắt chung — không có gì để gõ.
    fireEvent.keyDown(screen.getByRole('region'), { key: 'Enter' });
    expect(h2.onKeyDown).toHaveBeenCalledTimes(1);
  });
});
