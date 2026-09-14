import { CANVAS_COLUMNS, CANVAS_ROW_HEIGHT } from '@bi/shared';
import { afterEach, describe, expect, it } from 'vitest';

import {
  CANVAS_GAP,
  gridPitch,
  sameBox,
  snapBox,
  spanPx,
} from '../src/features/reports/builder/dragMath';
import {
  HISTORY_LIMIT,
  MERGE_WINDOW_MS,
  historyReducer,
  initialHistory,
  isTextEntry,
  pageOfRedo,
  pageOfUndo,
  undoShortcut,
  type HistoryAction,
  type HistoryState,
} from '../src/features/reports/builder/history';
import { readZoom, writeZoom, ZOOM_LEVELS, zoomStep } from '../src/features/reports/builder/zoom';

/**
 * Hoàn tác, kéo mượt, thu phóng — §10.20. Hàm thuần.
 *
 * Phần lớn ca kiểm chuyện hoàn tác KHÔNG làm gì sai theo cách lặng lẽ: gộp nhầm
 * hai việc làm một (Ctrl+Z xoá luôn thứ không định xoá), không gộp khi phải gộp
 * (gõ một câu phải bấm Ctrl+Z hai chục lần), và làm lại sau khi đã rẽ nhánh.
 */

type S = HistoryState<string>;

const set = (
  value: string,
  key: string | null,
  at: number,
  pageId = 'p1',
): HistoryAction<string> => ({
  type: 'set',
  update: () => value,
  key,
  at,
  pageId,
});

function run(actions: HistoryAction<string>[], start = 'A'): S {
  return actions.reduce(historyReducer<string>, initialHistory(start));
}

describe('lịch sử khung', () => {
  it('sửa rồi hoàn tác rồi làm lại đi đúng ba trạng thái', () => {
    const edited = run([set('B', null, 0), set('C', null, 10)]);
    expect(edited.present).toBe('C');

    const once = historyReducer(edited, { type: 'undo' });
    expect(once.present).toBe('B');
    const twice = historyReducer(once, { type: 'undo' });
    expect(twice.present).toBe('A');
    // Hết bước để lùi thì đứng yên, không văng lỗi.
    expect(historyReducer(twice, { type: 'undo' })).toBe(twice);

    expect(historyReducer(twice, { type: 'redo' }).present).toBe('B');
  });

  it('gõ liền tay vào CÙNG một chỗ là MỘT bước hoàn tác', () => {
    const typed = run([
      set('A1', 'c:t1:text', 0),
      set('A12', 'c:t1:text', 200),
      set('A123', 'c:t1:text', 400),
    ]);
    expect(typed.present).toBe('A123');
    expect(historyReducer(typed, { type: 'undo' }).present).toBe('A');
  });

  it('KHÔNG gộp: khác khoá, quá thời gian, hoặc thay đổi không mang khoá', () => {
    const khacKhoa = run([set('B', 'c:t1:text', 0), set('C', 'c:t1:color', 100)]);
    expect(historyReducer(khacKhoa, { type: 'undo' }).present).toBe('B');

    const quaLau = run([set('B', 'c:t1:text', 0), set('C', 'c:t1:text', MERGE_WINDOW_MS + 1)]);
    expect(historyReducer(quaLau, { type: 'undo' }).present).toBe('B');

    // Hai cú kéo thả liền nhau là hai việc.
    const haiCuKeo = run([set('B', null, 0), set('C', null, 50)]);
    expect(historyReducer(haiCuKeo, { type: 'undo' }).present).toBe('B');
  });

  it('bước ĐẦU TIÊN mang khoá vẫn là một bước — không gộp vào trạng thái lúc mở', () => {
    // Không có ca này thì gõ chữ ngay sau khi mở báo cáo sẽ không hoàn tác được:
    // chẳng có bước nào trước đó để quay về.
    const s = run([set('B', 'c:t1:text', 0)]);
    expect(historyReducer(s, { type: 'undo' }).present).toBe('A');
  });

  it('sửa sau khi hoàn tác là RẼ NHÁNH: nhánh cũ không làm lại được nữa', () => {
    const s = run([set('B', null, 0), set('C', null, 10), { type: 'undo' }, set('X', null, 20)]);
    expect(s.present).toBe('X');
    expect(historyReducer(s, { type: 'redo' })).toBe(s);
    expect(historyReducer(s, { type: 'undo' }).present).toBe('B');
  });

  it('hoàn tác ngắt chuỗi gộp: gõ tiếp là một bước mới, không viết đè bước vừa khôi phục', () => {
    const s = run([
      set('B', 'c:t1:text', 0),
      set('C', 'c:t1:text', 100),
      { type: 'undo' },
      set('D', 'c:t1:text', 150),
    ]);
    expect(s.present).toBe('D');
    expect(historyReducer(s, { type: 'undo' }).present).toBe('A');
  });

  it('thay đổi không đổi gì (cùng tham chiếu) KHÔNG thành một bước', () => {
    const start = initialHistory('A');
    const noop = historyReducer(start, {
      type: 'set',
      update: (x) => x,
      key: null,
      at: 0,
      pageId: 'p1',
    });
    expect(noop).toBe(start);
  });

  it('nạp báo cáo / đổi mô hình (`reset`) xoá sạch lịch sử', () => {
    const s = historyReducer(run([set('B', null, 0)]), { type: 'reset', value: 'Z' });
    expect(s.present).toBe('Z');
    expect(s.past).toHaveLength(0);
    expect(historyReducer(s, { type: 'undo' })).toBe(s);
  });

  it('giữ tối đa HISTORY_LIMIT bước, bỏ bước CŨ nhất', () => {
    const actions = Array.from({ length: HISTORY_LIMIT + 20 }, (_, i) => set(`v${i}`, null, i));
    const s = run(actions);
    expect(s.past).toHaveLength(HISTORY_LIMIT);
    expect(s.past[0]?.value).toBe('v19');
  });

  it('nhớ TRANG của từng bước, để hoàn tác mở lại đúng trang vừa sửa', () => {
    const s = run([set('B', null, 0, 'trang-1'), set('C', null, 10, 'trang-2')]);
    expect(pageOfUndo(s)).toBe('trang-2');
    const back = historyReducer(s, { type: 'undo' });
    expect(pageOfUndo(back)).toBe('trang-1');
    expect(pageOfRedo(back)).toBe('trang-2');
  });
});

describe('phím tắt hoàn tác', () => {
  const key = (init: KeyboardEventInit): KeyboardEvent => new KeyboardEvent('keydown', init);

  it('Ctrl+Z hoàn tác; Ctrl+Shift+Z và Ctrl+Y làm lại; ⌘ trên Mac cũng vậy', () => {
    expect(undoShortcut(key({ key: 'z', ctrlKey: true }))).toBe('undo');
    expect(undoShortcut(key({ key: 'Z', ctrlKey: true, shiftKey: true }))).toBe('redo');
    expect(undoShortcut(key({ key: 'y', ctrlKey: true }))).toBe('redo');
    expect(undoShortcut(key({ key: 'z', metaKey: true }))).toBe('undo');
  });

  it('không có Ctrl, hoặc có Alt (AltGr trên bàn phím châu Âu) thì không phải phím tắt', () => {
    expect(undoShortcut(key({ key: 'z' }))).toBeNull();
    expect(undoShortcut(key({ key: 'z', ctrlKey: true, altKey: true }))).toBeNull();
  });

  it('trong ô nhập CHỮ thì để trình duyệt tự hoàn tác chữ; ô tích / nút thì không', () => {
    const text = document.createElement('input');
    const area = document.createElement('textarea');
    const box = document.createElement('input');
    box.type = 'checkbox';
    const color = document.createElement('input');
    color.type = 'color';
    const button = document.createElement('button');

    expect(isTextEntry(text)).toBe(true);
    expect(isTextEntry(area)).toBe(true);
    expect(isTextEntry(box)).toBe(false);
    expect(isTextEntry(color)).toBe(false);
    expect(isTextEntry(button)).toBe(false);
    expect(isTextEntry(document.body)).toBe(false);
  });
});

describe('phép tính kéo', () => {
  const start = { x: 2, y: 3, w: 4, h: 2 };
  const min = { w: 1, h: 1 };
  const pitch = { x: 80, y: 56 };

  it('bước lưới ở 100% đúng bằng bề rộng một cột cộng khoảng hở', () => {
    const p = gridPitch(1200, 1);
    expect(p.x).toBeCloseTo(
      (1200 - CANVAS_GAP * (CANVAS_COLUMNS - 1)) / CANVAS_COLUMNS + CANVAS_GAP,
    );
    expect(p.y).toBe(CANVAS_ROW_HEIGHT + CANVAS_GAP);
  });

  it('ở 50% bước lưới trên màn hình còn một nửa — con trỏ đi nửa quãng là sang một ô', () => {
    // Khung dựng ở 1200px rồi thu về 600px trên màn hình.
    const full = gridPitch(1200, 1);
    const half = gridPitch(600, 0.5);
    expect(half.x).toBeCloseTo(full.x / 2);
    expect(half.y).toBeCloseTo(full.y / 2);
  });

  it('dời: làm tròn về ô gần nhất, và bị kẹp trong khung', () => {
    expect(snapBox('move', start, min, 39, 27, pitch)).toEqual(start);
    expect(snapBox('move', start, min, 41, 29, pitch)).toEqual({ ...start, x: 3, y: 4 });
    expect(snapBox('move', start, min, -10_000, -10_000, pitch)).toEqual({ ...start, x: 0, y: 0 });
    expect(snapBox('move', start, min, 10_000, 0, pitch).x).toBe(CANVAS_COLUMNS - start.w);
  });

  it('co giãn: giữ góc trên-trái, không nhỏ hơn cỡ tối thiểu, không vượt mép phải', () => {
    expect(snapBox('resize', start, min, 160, 56, pitch)).toEqual({ ...start, w: 6, h: 3 });
    expect(snapBox('resize', start, { w: 2, h: 2 }, -10_000, -10_000, pitch)).toEqual({
      ...start,
      w: 2,
      h: 2,
    });
    expect(snapBox('resize', start, min, 10_000, 0, pitch)).toEqual({
      ...start,
      w: CANVAS_COLUMNS - start.x,
    });
  });

  it('cỡ tối thiểu theo pixel khớp đúng bề rộng của từng ấy ô trên lưới', () => {
    expect(spanPx(1, 80)).toBe(80 - CANVAS_GAP);
    expect(spanPx(3, 80)).toBe(3 * 80 - CANVAS_GAP);
    expect(sameBox(start, { ...start })).toBe(true);
    expect(sameBox(start, { ...start, h: 9 })).toBe(false);
  });
});

describe('thu phóng', () => {
  afterEach(() => window.localStorage.clear());

  it('bậc cố định, phóng to rồi thu nhỏ quay về ĐÚNG mức cũ, và dừng ở hai đầu', () => {
    expect(zoomStep(1, 1)).toBe(1.25);
    expect(zoomStep(zoomStep(1, 1), -1)).toBe(1);
    expect(zoomStep(ZOOM_LEVELS[0], -1)).toBe(ZOOM_LEVELS[0]);
    expect(zoomStep(ZOOM_LEVELS[ZOOM_LEVELS.length - 1] as number, 1)).toBe(
      ZOOM_LEVELS[ZOOM_LEVELS.length - 1],
    );
    // Mức lạ (bản cũ, hay ai sửa tay localStorage) rơi về bậc kề nó.
    expect(zoomStep(0.8, 1)).toBe(1);
    expect(zoomStep(0.8, -1)).toBe(0.75);
  });

  it('nhớ trong trình duyệt; giá trị lạ hoặc bị chặn thì về 100%', () => {
    expect(readZoom()).toBe(1);
    writeZoom(0.75);
    expect(readZoom()).toBe(0.75);
    window.localStorage.setItem('bi.builder.zoom', '7');
    expect(readZoom()).toBe(1);
  });
});
