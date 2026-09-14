import { useCallback, useReducer } from 'react';

/**
 * Hoàn tác / làm lại cho trình dựng — §10.20.
 *
 * ═══ Lưu cả ẢNH CHỤP, không lưu từng lệnh ═════════════════════════════════
 *
 * Mỗi bước lịch sử là toàn bộ mảng trang TRƯỚC thay đổi, chứ không phải một lệnh
 * "dời ô X sang phải" kèm lệnh ngược của nó. Mọi phép sửa khung vốn đã tạo mảng
 * mới và giữ nguyên các phần không đổi, nên một ảnh chụp chỉ tốn vài con trỏ —
 * còn lịch sử theo lệnh thì mỗi phép sửa mới (§10.18 thêm cả chục) là một lệnh
 * ngược phải viết đúng, và viết sai một cái là hoàn tác ra một khung chưa từng
 * tồn tại.
 *
 * ═══ Gộp bước ═══════════════════════════════════════════════════════════════
 *
 * Gõ một câu mười chữ không được thành mười lần bấm hoàn tác. Hai thay đổi
 * CÙNG khoá (`key`), cách nhau dưới `MERGE_WINDOW_MS`, gộp làm một bước. Khoá do
 * nơi gọi đặt: gõ chữ, giữ phím mũi tên, kéo bộ chọn màu là khoá có sẵn; còn
 * một cú kéo thả xong thì không mang khoá — hai cú kéo liền nhau là hai việc.
 *
 * ⚠️ Thời điểm (`at`) đi VÀO hành động, không đọc `Date.now()` trong reducer:
 * StrictMode gọi reducer hai lần, và một reducer đọc đồng hồ là một reducer
 * không thuần.
 */

export const MERGE_WINDOW_MS = 800;
/** Đủ cho một buổi dựng; mỗi bước chỉ là vài con trỏ, không phải một bản sao sâu. */
export const HISTORY_LIMIT = 100;

interface Step<T> {
  value: T;
  /** Trang người dùng đang mở khi thay đổi này xảy ra — hoàn tác thì đưa họ về đó. */
  pageId: string | null;
}

export interface HistoryState<T> {
  past: Step<T>[];
  present: T;
  future: Step<T>[];
  lastKey: string | null;
  lastAt: number;
}

export type HistoryAction<T> =
  | {
      type: 'set';
      update: (current: T) => T;
      key: string | null;
      at: number;
      pageId: string | null;
    }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'reset'; value: T };

export function initialHistory<T>(value: T): HistoryState<T> {
  return { past: [], present: value, future: [], lastKey: null, lastAt: 0 };
}

export function historyReducer<T>(
  state: HistoryState<T>,
  action: HistoryAction<T>,
): HistoryState<T> {
  switch (action.type) {
    case 'set': {
      const next = action.update(state.present);
      // Không đổi gì thì không có gì để hoàn tác. Không có dòng này thì bấm lại
      // đúng nút cỡ chữ đang chọn cũng thành một bước hoàn tác "không làm gì".
      if (Object.is(next, state.present)) return state;

      const merge =
        action.key !== null &&
        action.key === state.lastKey &&
        action.at - state.lastAt < MERGE_WINDOW_MS &&
        state.past.length > 0;

      return {
        past: merge
          ? state.past
          : [...state.past, { value: state.present, pageId: action.pageId }].slice(-HISTORY_LIMIT),
        present: next,
        // Sửa sau khi đã hoàn tác là rẽ nhánh: nhánh cũ không còn đường về.
        future: [],
        lastKey: action.key,
        lastAt: action.at,
      };
    }

    case 'undo': {
      const step = state.past[state.past.length - 1];
      if (step === undefined) return state;
      return {
        past: state.past.slice(0, -1),
        present: step.value,
        future: [{ value: state.present, pageId: step.pageId }, ...state.future],
        // Hoàn tác ngắt chuỗi gộp: gõ tiếp sau đó là một bước MỚI, không phải
        // viết đè vào bước vừa được khôi phục.
        lastKey: null,
        lastAt: 0,
      };
    }

    case 'redo': {
      const step = state.future[0];
      if (step === undefined) return state;
      return {
        past: [...state.past, { value: state.present, pageId: step.pageId }],
        present: step.value,
        future: state.future.slice(1),
        lastKey: null,
        lastAt: 0,
      };
    }

    case 'reset':
      return initialHistory(action.value);
  }
}

/** Trang mà bước hoàn tác / làm lại KẾ TIẾP sẽ đụng tới, nếu có. */
export function pageOfUndo<T>(state: HistoryState<T>): string | null {
  return state.past[state.past.length - 1]?.pageId ?? null;
}

export function pageOfRedo<T>(state: HistoryState<T>): string | null {
  return state.future[0]?.pageId ?? null;
}

export interface History<T> {
  present: T;
  canUndo: boolean;
  canRedo: boolean;
  /** Sửa trạng thái; `key` khác `null` thì gộp với thay đổi cùng khoá ngay trước. */
  set: (update: (current: T) => T, options: { key: string | null; pageId: string | null }) => void;
  /** Hoàn tác; trả về trang của bước vừa hoàn tác để trang gọi mở trang đó. */
  undo: () => string | null;
  redo: () => string | null;
  /** Thay hẳn trạng thái và XOÁ lịch sử — nạp báo cáo, đổi mô hình. */
  reset: (value: T) => void;
}

export function useHistory<T>(initial: () => T): History<T> {
  const [state, dispatch] = useReducer(historyReducer<T>, undefined, () =>
    initialHistory(initial()),
  );

  const set = useCallback<History<T>['set']>(
    (update, { key, pageId }) => dispatch({ type: 'set', update, key, pageId, at: Date.now() }),
    [],
  );
  const reset = useCallback((value: T) => dispatch({ type: 'reset', value }), []);

  return {
    present: state.present,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    set,
    undo: () => {
      const pageId = pageOfUndo(state);
      dispatch({ type: 'undo' });
      return pageId;
    },
    redo: () => {
      const pageId = pageOfRedo(state);
      dispatch({ type: 'redo' });
      return pageId;
    },
    reset,
  };
}

/**
 * Phím tắt hoàn tác có nên để trình duyệt tự lo không.
 *
 * Trong ô nhập chữ (tên báo cáo, hộp văn bản đang gõ, tiêu đề biểu đồ), Ctrl+Z
 * là hoàn tác CHỮ của chính ô đó — thứ người đang gõ chờ đợi. Giật nó sang hoàn
 * tác cả khung thì một lần sửa lỗi chính tả xoá mất cái biểu đồ vừa kéo.
 */
export function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (!(target instanceof HTMLInputElement)) return false;
  // Ô tích, nút radio, thanh trượt không có chữ nào để hoàn tác.
  return !['checkbox', 'radio', 'range', 'button', 'submit', 'color', 'file'].includes(target.type);
}

/** Ctrl/⌘+Z = hoàn tác; Ctrl/⌘+Shift+Z và Ctrl+Y = làm lại. */
export function undoShortcut(event: KeyboardEvent): 'undo' | 'redo' | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
  if (key === 'y' && !event.shiftKey) return 'redo';
  return null;
}
