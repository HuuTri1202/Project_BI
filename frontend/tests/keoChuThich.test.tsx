import { CANVAS_COLUMNS, type LineAnnotationDto, type ReportAnnotationDto } from '@bi/shared';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CanvasBoard } from '../src/features/reports/builder/CanvasBoard';
import { emptyVisual, type VisualDraft } from '../src/features/reports/builder/visual';
import { CANVAS_GAP } from '../src/features/reports/canvasLayout';
import { useModelReportPreview } from '../src/features/datamodels/hooks';

/**
 * Kéo một chú thích là kéo TỰ DO; kéo một biểu đồ vẫn bám lưới — §10.24.
 *
 * ═══ Ca này canh gì ═════════════════════════════════════════════════════════
 *
 * Lỗi người dùng báo, đo lại được trên Chromium: kéo một đường kẻ dọc 40px thì
 * nó ĐỨNG YÊN hoàn toàn, kéo 60px thì nó nhảy 83px. Bước lưới là 83px ngang và
 * 56px dọc, nên không có cách nào đặt đường kẻ vào khe giữa hai biểu đồ.
 *
 * Bài đầu tiên viết cho §10.24 chỉ kiểm công thức đặt chú thích và hàm
 * `freeBox`, và đột biến "cho chú thích bám lưới trở lại" VẪN XANH — tức là
 * đúng cái lỗi vừa sửa không có ai canh. Bài này đóng chỗ đó: nó kéo thật, qua
 * đúng `CanvasBoard`, và đọc xem trang nhận về toạ độ nào.
 *
 * ═══ Vì sao phải giả lập hình học ═══════════════════════════════════════════
 *
 * jsdom không tính bố cục: mọi `getBoundingClientRect` trả 0, nên bước lưới sẽ
 * ra vô nghĩa và cú kéo không nói lên điều gì. Ở đây khung được gán một hình
 * học CỐ ĐỊNH (1200px, không thu phóng) — con số thật không quan trọng, điều
 * quan trọng là nó xác định, để "kéo 20px" có một ý nghĩa đo được.
 */

vi.mock('../src/features/datamodels/hooks', () => ({
  useModelReportPreview: vi.fn(),
}));

/** Bề rộng khung giả. Bước cột = (1200 − 12×11) / 12 + 12 = 101px. */
const RONG = 1200;
const BUOC_COT = (RONG - CANVAS_GAP * (CANVAS_COLUMNS - 1)) / CANVAS_COLUMNS + CANVAS_GAP;

const duongKe = (): LineAnnotationDto => ({
  id: 'k1',
  x: 2,
  y: 2,
  w: 1,
  h: 6,
  layer: 'front',
  kind: 'line',
  direction: 'vertical',
  style: 'solid',
  width: 2,
  color: '#94A3B8',
  arrow: 'none',
});

const bieuDo = (): VisualDraft => ({
  ...emptyVisual({ x: 0, y: 0 }),
  id: 'v1',
  chartType: 'table',
  dimensionId: 5,
  measureId: 10,
});

const onChangeAnnotation = vi.fn();
const onChange = vi.fn();

function ve(annotations: ReportAnnotationDto[] = [duongKe()]): void {
  vi.mocked(useModelReportPreview).mockReturnValue({
    data: undefined,
    isError: false,
    error: null,
    isFetching: false,
  } as ReturnType<typeof useModelReportPreview>);

  render(
    <CanvasBoard
      drafts={[bieuDo()]}
      annotations={annotations}
      selectedId={null}
      editingId={null}
      modelId={7}
      tenBaoCao="BC"
      labelOf={() => 'Biểu đồ'}
      onSelect={vi.fn()}
      onChange={onChange}
      onRemove={vi.fn()}
      onChangeAnnotation={onChangeAnnotation}
      onRemoveAnnotation={vi.fn()}
      onEditText={vi.fn()}
    />,
  );
}

/** Kéo `el` đi `dx`,`dy` pixel — pointerdown, một nhịp move, rồi thả. */
async function keo(el: HTMLElement, dx: number, dy: number): Promise<void> {
  fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: 400, clientY: 300 });
  fireEvent.pointerMove(el, { pointerId: 1, clientX: 400 + dx, clientY: 300 + dy });
  // `paint` chạy trong `requestAnimationFrame`, và chỉ nó mới đặt cờ "đã kéo".
  // Thiếu nhịp này thì `end` coi cú kéo là một cú bấm và không đổi gì.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 40));
  });
  fireEvent.pointerUp(el, { pointerId: 1, clientX: 400 + dx, clientY: 300 + dy });
}

let rectGoc: typeof HTMLElement.prototype.getBoundingClientRect;

beforeEach(() => {
  vi.clearAllMocks();

  rectGoc = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function rect(this: HTMLElement): DOMRect {
    return {
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: RONG,
      bottom: 800,
      width: RONG,
      height: 800,
    } as DOMRect;
  };
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get: () => RONG,
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get: () => 300,
  });
  // jsdom chưa cài Pointer Capture; thiếu ba hàm này thì `begin` ném ngay.
  HTMLElement.prototype.setPointerCapture = (): void => {};
  HTMLElement.prototype.releasePointerCapture = (): void => {};
  HTMLElement.prototype.hasPointerCapture = (): boolean => false;
});

afterEach(() => {
  HTMLElement.prototype.getBoundingClientRect = rectGoc;
});

describe('chú thích — kéo tới đâu nằm tới đó', () => {
  it('kéo 20px (một phần năm bước lưới) thì nó DỊCH, không đứng yên', async () => {
    ve();
    await keo(screen.getByRole('region', { name: 'Đường kẻ' }), 20, 0);

    expect(onChangeAnnotation).toHaveBeenCalledTimes(1);
    const [id, patch] = onChangeAnnotation.mock.calls[0] ?? [];
    expect(id).toBe('k1');
    // Đây là con số mà bản bám lưới KHÔNG cho ra: nó làm tròn 0,198 thành 0.
    expect(patch.x).toBeCloseTo(2 + 20 / BUOC_COT, 2);
    expect(patch.x).not.toBe(2);
  });

  it('kéo dọc cũng vậy — 15px không phải là 0 hàng', async () => {
    ve();
    await keo(screen.getByRole('region', { name: 'Đường kẻ' }), 0, 15);

    const [, patch] = onChangeAnnotation.mock.calls[0] ?? [];
    expect(patch.y).toBeGreaterThan(2);
    expect(patch.y).toBeLessThan(2.5);
  });

  it('quãng RẤT nhỏ vẫn là một cú bấm, không phải cú kéo', async () => {
    ve();
    await keo(screen.getByRole('region', { name: 'Đường kẻ' }), 2, 0);

    // Dưới `DRAG_DEAD_ZONE_PX`: run tay khi bấm chọn không được dời hộp đi.
    expect(onChangeAnnotation).not.toHaveBeenCalled();
  });
});

describe('biểu đồ — vẫn bám lưới', () => {
  it('kéo 20px thì KHÔNG dịch: lưới là thứ giữ các biểu đồ thẳng hàng', async () => {
    ve();
    const dau = screen.getByRole('region', { name: /Ô biểu đồ/ }).querySelector('header');
    await keo(dau as HTMLElement, 20, 0);

    expect(onChange).not.toHaveBeenCalled();
  });

  it('kéo quá nửa bước thì nhảy nguyên MỘT ô', async () => {
    ve();
    const dau = screen.getByRole('region', { name: /Ô biểu đồ/ }).querySelector('header');
    await keo(dau as HTMLElement, BUOC_COT * 0.6, 0);

    const [, patch] = onChange.mock.calls[0] ?? [];
    expect(patch.x).toBe(1);
  });
});

/**
 * ═══ Cú kéo MƯỢN `el.style` — và phải trả lại ══════════════════════════════
 *
 * Bài trên canh chú thích đi ĐÚNG CHỖ. Nó không canh chú thích còn nguyên HÌNH
 * DẠNG khi tới nơi, và đó là chỗ §10.24 hỏng lần thứ hai: `end` xoá trắng
 * `width`/`height` sau mỗi cú kéo, vốn đúng khi hai thuộc tính đó thuộc về lưới,
 * nhưng từ §10.24 chúng là của React. React không ghi lại một giá trị không
 * đổi, mà dời chỗ thì chỉ đổi `left`/`top` — nên không ai trả lại, và hộp co về
 * bằng nội dung.
 *
 * Đo trên Chromium: đường kẻ ngang phủ hết khung 988px tụt còn 304px, dính mép
 * trái, ngay sau cú kéo đầu tiên. Số ĐÃ LƯU vẫn đúng, nên tải lại trang là nó
 * dài trở lại — hỏng ở lớp vẽ, không ở dữ liệu.
 */
describe('kéo xong, hộp còn nguyên hình dạng', () => {
  it('chú thích giữ BỀ RỘNG và CHIỀU CAO sau khi dời chỗ', async () => {
    ve();
    const el = screen.getByRole('region', { name: 'Đường kẻ' });
    const rong = el.style.width;
    const cao = el.style.height;
    // Nếu hai dòng này rỗng thì cả bài không canh gì: `annotationStyle` phải
    // thật sự đặt được `width`/`height` lên phần tử thì mới có gì để mất.
    expect(rong).not.toBe('');
    expect(cao).not.toBe('');

    await keo(el, 20, 15);

    expect(el.style.width).toBe(rong);
    expect(el.style.height).toBe(cao);
  });

  it('ô biểu đồ thì KHÔNG được nhận `width` — lưới định cỡ nó', async () => {
    ve();
    const o = screen.getByRole('region', { name: /Ô biểu đồ/ });
    await keo(o.querySelector('header') as HTMLElement, BUOC_COT * 0.6, 0);

    // `cellStyle` không khai hai thuộc tính này. Trả lại một con số pixel ở đây
    // là ô đóng băng bề rộng của khoảnh khắc thả tay, và thôi co theo lưới.
    expect(o.style.width).toBe('');
    expect(o.style.height).toBe('');
  });
});
