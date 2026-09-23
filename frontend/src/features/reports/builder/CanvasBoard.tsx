import {
  CANVAS_COLUMNS,
  CANVAS_MIN_H,
  CANVAS_MIN_W,
  type ReportAnnotationDto,
  type ReportDataDto,
} from '@bi/shared';
import { useEffect, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';

import { useModelReportPreview } from '../../datamodels/hooks';
import { getApiError } from '../../../services/apiClient';
import { ROW_MENU_ICONS, RowMenu, RowMenuItem } from '../../../components/ui/RowMenu';
import { DANG_TAI, KHONG_XUAT } from '../../../services/danhDauXuat';
import { CANVAS_LAYER_Z } from '../annotations/annotationStyle';
import { CanvasGrid } from '../CanvasGrid';
import { cellStyle, rowsNeeded } from '../canvasLayout';
import { LoiXuat } from '../export/chupBaoCao';
import { xuatMotO, type KieuMotO } from '../export/xuatMotO';
import { ReportChart } from '../ReportChart';
import { ANNOTATION_MIN, type AnnotationPatch } from './annotation';
import { AnnotationBox } from './AnnotationBox';
import { DRAG_DEAD_ZONE_PX, gridPitch, sameBox, snapBox, spanPx, type Box } from './dragMath';
import { glide, scaleOf } from './glide';
import { blockerOf, clampBox, previewConfigOfDraft, type VisualDraft } from './visual';

/**
 * Khung soạn thảo — §10.10.
 *
 * ═══ Kéo bằng con trỏ, KHÔNG bằng HTML5 drag-and-drop ═══════════════════════
 *
 * Bảng trường dùng `draggable` của HTML5 vì ở đó cú kéo mang một MẨU DỮ LIỆU từ
 * chỗ này sang chỗ khác — đúng việc mà API đó sinh ra để làm.
 *
 * Di chuyển một ô thì khác hẳn: nó là thao tác thao tác hình học liên tục, cần
 * biết vị trí con trỏ ở TỪNG khung hình. `dragover` chỉ bắn khi con trỏ đi qua
 * một vùng thả, không cho đọc dữ liệu, và trên phần lớn trình duyệt còn kéo
 * theo một ảnh ma nửa trong suốt không tắt được. Pointer Events cho toạ độ thật
 * ở mọi khung hình, và `setPointerCapture` giữ được sự kiện cả khi con trỏ chạy
 * ra ngoài cửa sổ — thứ mà thả tay ngoài mép màn hình cần tới.
 *
 * ═══ Hộp đi theo con trỏ, khung nét đứt đi theo lưới — §10.20 ══════════════
 *
 *   "cải thiện độ mượt mà khi thao tác với các tính năng chèn"
 *
 * Tới §10.19 hộp quy về ô lưới NGAY trong lúc kéo: nó nhảy cóc từng bước 56–90px,
 * và đo trên Chromium thì hộp lệch khỏi con trỏ trung bình 25px, có lúc 45px.
 * Mỗi nhịp chuột còn ghi thẳng vào state của cả trang, nên cả trình dựng — hai
 * cột bên, mọi ô biểu đồ — vẽ lại vài chục lần một giây.
 *
 * Giờ một cú kéo có hai lớp, và KHÔNG lớp nào đi qua React:
 *
 *   - Hộp đi theo con trỏ từng pixel bằng `transform` (co giãn thì bằng
 *     `width`/`height`), ghi thẳng vào DOM trong `requestAnimationFrame`.
 *   - Một khung nét đứt nhảy theo ô lưới, báo trước chỗ hộp sẽ đặt. Người dùng
 *     vẫn thấy đúng thứ sẽ được lưu ở mọi thời điểm — lời hứa cũ của lưới, giữ
 *     nguyên — chỉ là không bắt chính cái hộp phải nhảy cóc để nói điều đó.
 *
 * Thả tay mới ghi vào state, ĐÚNG MỘT LẦN, rồi hộp trượt từ chỗ tay thả về ô
 * lưới (`glide`). Một lần ghi cũng là một bước hoàn tác.
 *
 * ⚠️ Mọi thứ ghi vào `el.style` trong lúc kéo phải được xoá trước khi React đặt
 * hộp vào ô mới. Sót `width` là hộp giữ cỡ của khoảnh khắc thả tay mãi mãi, dù ô
 * lưới đã đổi. React không tự dọn: những thuộc tính đó chưa bao giờ nằm trong
 * prop `style` của nó.
 *
 * ═══ Bàn phím là đường đi ĐẦY ĐỦ, không phải lối phụ ════════════════════════
 *
 * Mũi tên di chuyển, Shift+mũi tên co giãn, Delete xoá. Một khung chỉ sắp xếp
 * được bằng chuột là một khung người dùng bàn phím không dựng nổi báo cáo.
 */

/** Vùng sát mép khung cuộn mà giữ con trỏ ở đó thì khung tự cuộn theo. */
const EDGE_PX = 40;

/**
 * Tầng của hộp ĐANG KÉO và của khung nét đứt: trên cả ba tầng vẽ thường
 * (`CANVAS_LAYER_Z`), để thứ đang cầm trên tay không chui xuống dưới biểu đồ.
 */
const DRAGGING_Z = '5';
const GHOST_Z = 4;

/**
 * Thứ đang được kéo — một ô biểu đồ HOẶC một chú thích (§10.18).
 *
 * Mang sẵn phần tử DOM và hình học lúc bắt đầu: mỗi khung hình chỉ cộng quãng
 * con trỏ đi vào đó, không đo lại gì — đo DOM giữa lúc ghi DOM là cách chắc
 * chắn nhất để trình duyệt phải tính lại bố cục mỗi khung hình.
 */
interface DragState {
  mode: 'move' | 'resize';
  target: Grabbable;
  el: HTMLElement;
  ghost: HTMLElement;
  scroller: HTMLElement | null;
  startX: number;
  startY: number;
  startScrollLeft: number;
  startScrollTop: number;
  clientX: number;
  clientY: number;
  /** Mức thu phóng thật của khung (§10.20). */
  scale: number;
  /** Bước lưới tính bằng pixel màn hình. */
  pitch: { x: number; y: number };
  /** Hình học BỐ CỤC (px chưa thu phóng) lúc bắt đầu, tính từ góc trên-trái của lưới. */
  left: number;
  top: number;
  width: number;
  height: number;
  gridWidth: number;
  /** Ô lưới khung nét đứt đang chỉ — cũng là thứ sẽ được lưu khi thả tay. */
  snapped: Box;
  moved: boolean;
  frame: number | null;
  zIndex: string;
  onScroll: () => void;
}

/** Một phần tử kéo được trên khung, nhìn từ phía phép tính kéo thả. */
interface Grabbable {
  box: Box;
  min: { w: number; h: number };
  /** `merge`: gộp với thay đổi cùng loại ngay trước vào một bước hoàn tác. */
  apply: (patch: Partial<Box>, merge: boolean) => void;
  select: () => void;
  remove: () => void;
}

const boxOf = ({ x, y, w, h }: Box): Box => ({ x, y, w, h });

/** Ba định dạng xuất một ô — cùng thứ tự và cùng chữ với menu của trang xem. */
const MUC_XUAT: { kieu: KieuMotO; nhan: string; icon: string }[] = [
  { kieu: 'png', nhan: 'Xuất ảnh PNG', icon: ROW_MENU_ICONS.image },
  { kieu: 'pdf', nhan: 'Xuất tệp PDF', icon: ROW_MENU_ICONS.pdf },
  { kieu: 'excel', nhan: 'Xuất bảng tính Excel', icon: ROW_MENU_ICONS.sheet },
];

export function CanvasBoard({
  drafts,
  annotations,
  selectedId,
  editingId,
  modelId,
  tenBaoCao,
  labelOf,
  onSelect,
  onChange,
  onRemove,
  onChangeAnnotation,
  onRemoveAnnotation,
  onEditText,
}: {
  drafts: VisualDraft[];
  /** Văn bản, đường kẻ, hình của trang này — §10.18. */
  annotations: ReportAnnotationDto[];
  selectedId: string | null;
  /** Hộp văn bản đang ở chế độ gõ chữ, nếu có. */
  editingId: string | null;
  modelId: number;
  /** Tên báo cáo đang dựng — vào dải tiêu đề và tên tệp khi xuất một ô. */
  tenBaoCao: string;
  /** Tiêu đề để hiện trên đầu ô — trang tự dựng từ nhãn chiều và thước đo. */
  labelOf: (draft: VisualDraft) => string;
  onSelect: (id: string) => void;
  onChange: (id: string, patch: Partial<VisualDraft>, merge?: boolean) => void;
  onRemove: (id: string) => void;
  onChangeAnnotation: (id: string, patch: AnnotationPatch, merge?: boolean) => void;
  onRemoveAnnotation: (id: string) => void;
  onEditText: (id: string | null) => void;
}): React.ReactElement {
  const boardRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const drag = useRef<DragState | null>(null);

  const conSong = useRef(true);
  /** Ô đang được xuất, và câu lỗi của lần xuất gần nhất — xem `xuatO`. */
  const [dangXuat, setDangXuat] = useState<string | null>(null);
  const [loiXuat, setLoiXuat] = useState<string | null>(null);

  // Rời trang giữa một cú kéo (đổi trang báo cáo bằng bàn phím, hoàn tác…) thì
  // khung hình đã hẹn không được chạy trên một phần tử đã gỡ.
  useEffect(() => {
    conSong.current = true;
    return () => {
      conSong.current = false;
      const state = drag.current;
      if (state?.frame != null) cancelAnimationFrame(state.frame);
      state?.scroller?.removeEventListener('scroll', state.onScroll);
    };
  }, []);

  /**
   * Xuất MỘT ô — menu "⋮" trên đầu ô, §10.23.
   *
   * Trạng thái để ở ĐÂY chứ không trong từng ô: một cái toast ở giữa màn hình
   * đọc được câu lỗi đầy đủ, còn nhét nó vào tiêu đề ô rộng 200px thì câu lỗi
   * bị cắt ngay chữ thứ tư. Và hai ô không bao giờ xuất cùng lúc, nên một chỗ
   * là đủ.
   */
  const xuatO = (
    kieu: KieuMotO,
    el: HTMLElement | null,
    ten: string,
    data: ReportDataDto | undefined,
  ): void => {
    setLoiXuat(null);
    setDangXuat(ten);
    void xuatMotO({ kieu, el, ten, tenBaoCao, data })
      .catch((e: unknown) => {
        if (!conSong.current) return;
        setLoiXuat(
          e instanceof LoiXuat
            ? e.message
            : 'Không xuất được biểu đồ. Hãy thử lại, hoặc dùng trình duyệt Chrome/Edge bản mới.',
        );
        // Lỗi không phải của ta thì vẫn phải để lại dấu vết cho người sửa.
        if (!(e instanceof LoiXuat)) console.error(e);
      })
      .finally(() => {
        if (conSong.current) setDangXuat(null);
      });
  };

  const visualTarget = (draft: VisualDraft): Grabbable => ({
    box: draft,
    min: { w: CANVAS_MIN_W, h: CANVAS_MIN_H },
    apply: (patch, merge) => onChange(draft.id, patch, merge),
    select: () => onSelect(draft.id),
    remove: () => onRemove(draft.id),
  });

  const annotationTarget = (a: ReportAnnotationDto): Grabbable => ({
    box: a,
    min: ANNOTATION_MIN,
    apply: (patch, merge) => onChangeAnnotation(a.id, patch, merge),
    select: () => onSelect(a.id),
    remove: () => onRemoveAnnotation(a.id),
  });

  function begin(
    mode: 'move' | 'resize',
    target: Grabbable,
    event: React.PointerEvent<HTMLElement>,
  ): void {
    const board = boardRef.current;
    const ghost = ghostRef.current;
    const el = event.currentTarget.closest('section');
    // Chỉ nút chuột CHÍNH. Chuột phải để mở menu của trình duyệt, không phải để
    // bắt đầu dời một biểu đồ.
    if (board === null || ghost === null || el === null || event.button !== 0) return;

    const grid = board.getBoundingClientRect();
    const own = el.getBoundingClientRect();
    const scale = scaleOf(board);
    const scroller = board.closest<HTMLElement>('[data-canvas-scroller]');

    const state: DragState = {
      mode,
      target,
      el,
      ghost,
      scroller,
      startX: event.clientX,
      startY: event.clientY,
      startScrollLeft: scroller?.scrollLeft ?? 0,
      startScrollTop: scroller?.scrollTop ?? 0,
      clientX: event.clientX,
      clientY: event.clientY,
      scale,
      pitch: gridPitch(grid.width, scale),
      left: (own.left - grid.left) / scale,
      top: (own.top - grid.top) / scale,
      width: el.offsetWidth,
      height: el.offsetHeight,
      gridWidth: board.offsetWidth,
      snapped: boxOf(target.box),
      moved: false,
      frame: null,
      zIndex: el.style.zIndex,
      // Cuộn bằng con lăn giữa lúc kéo: con trỏ đứng yên nhưng khung chạy dưới
      // nó, nên hộp phải đi theo dù không có `pointermove` nào.
      onScroll: () => schedule(state),
    };
    drag.current = state;
    scroller?.addEventListener('scroll', state.onScroll);

    event.currentTarget.setPointerCapture(event.pointerId);
    // Chặn hành vi mặc định: kéo trên một tiêu đề sẽ bôi đen chữ, và trên màn
    // cảm ứng sẽ cuộn trang thay vì di chuyển ô.
    event.preventDefault();
    target.select();
  }

  function schedule(state: DragState): void {
    if (state.frame !== null) return;
    state.frame = requestAnimationFrame(() => {
      state.frame = null;
      if (drag.current === state) paint(state, true);
    });
  }

  /** Vẽ MỘT khung hình của cú kéo. Chỉ ghi DOM, không đụng state của React. */
  function paint(state: DragState, autoScroll: boolean): void {
    const { el, ghost, scroller, scale, target } = state;
    const dx = state.clientX - state.startX + ((scroller?.scrollLeft ?? 0) - state.startScrollLeft);
    const dy = state.clientY - state.startY + ((scroller?.scrollTop ?? 0) - state.startScrollTop);

    if (!state.moved) {
      if (Math.hypot(dx, dy) < DRAG_DEAD_ZONE_PX) return;
      state.moved = true;
      el.style.zIndex = DRAGGING_Z;
      el.style.willChange = state.mode === 'move' ? 'transform' : 'width, height';
      Object.assign(ghost.style, cellStyle(state.snapped));
      ghost.hidden = false;
    }

    const lx = dx / scale;
    const ly = dy / scale;
    if (state.mode === 'move') {
      // Kẹp trong khung: hộp không được trôi ra ngoài mép trái/phải hay lên trên
      // hàng đầu — nơi khung nét đứt cũng không theo tới được.
      const tx = Math.min(Math.max(lx, -state.left), state.gridWidth - state.left - state.width);
      const ty = Math.max(ly, -state.top);
      el.style.transform = `translate3d(${tx}px, ${ty}px, 0)`;
    } else {
      const minW = spanPx(target.min.w, state.pitch.x / scale);
      const minH = spanPx(target.min.h, state.pitch.y / scale);
      el.style.width = `${Math.min(Math.max(state.width + lx, minW), state.gridWidth - state.left)}px`;
      el.style.height = `${Math.max(state.height + ly, minH)}px`;
    }

    const snapped = snapBox(state.mode, boxOf(target.box), target.min, dx, dy, state.pitch);
    if (!sameBox(snapped, state.snapped)) {
      state.snapped = snapped;
      Object.assign(ghost.style, cellStyle(snapped));
    }

    // Giữ con trỏ sát mép trên/dưới thì khung tự cuộn — không có nó thì không
    // kéo nổi một hộp xuống quá đáy màn hình, trừ khi thả ra, cuộn, rồi kéo lại.
    if (autoScroll && scroller !== null) {
      const edge = scroller.getBoundingClientRect();
      const over =
        state.clientY > edge.bottom - EDGE_PX
          ? state.clientY - (edge.bottom - EDGE_PX)
          : state.clientY < edge.top + EDGE_PX
            ? state.clientY - (edge.top + EDGE_PX)
            : 0;
      if (over !== 0) {
        const before = scroller.scrollTop;
        scroller.scrollTop += Math.sign(over) * Math.max(2, Math.round(Math.abs(over) / 3));
        // Chạm đáy thì thôi — không thì vòng khung hình quay mãi mà không cuộn được gì.
        if (scroller.scrollTop !== before) schedule(state);
      }
    }
  }

  function move(event: React.PointerEvent<HTMLElement>): void {
    const state = drag.current;
    if (state === null) return;
    state.clientX = event.clientX;
    state.clientY = event.clientY;
    schedule(state);
  }

  function end(event: React.PointerEvent<HTMLElement>): void {
    const state = drag.current;
    if (state === null) return;
    drag.current = null;
    if (state.frame !== null) cancelAnimationFrame(state.frame);
    state.scroller?.removeEventListener('scroll', state.onScroll);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!state.moved) return;

    // Khung hình CUỐI với toạ độ lúc thả tay — nhịp `pointermove` sau cùng có thể
    // còn nằm trong một khung hình chưa kịp chạy.
    paint(state, false);
    const { el, ghost, target, snapped } = state;
    const from = el.getBoundingClientRect();

    el.style.transform = '';
    el.style.width = '';
    el.style.height = '';
    el.style.willChange = '';
    el.style.zIndex = state.zIndex;
    ghost.hidden = true;

    if (!sameBox(snapped, boxOf(target.box))) {
      const patch =
        state.mode === 'move' ? { x: snapped.x, y: snapped.y } : { w: snapped.w, h: snapped.h };
      // `flushSync`: hộp phải đứng ở ô MỚI trước khi đo cho `glide`. Để React tự
      // gộp lượt vẽ thì phép đo thấy ô cũ, và hộp trượt ngược về chỗ vừa rời.
      flushSync(() => target.apply(patch, false));
    }
    glide(el, from, state.scale);
  }

  function onKey(event: React.KeyboardEvent<HTMLElement>, target: Grabbable): void {
    const step: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };

    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      target.remove();
      return;
    }

    const delta = step[event.key];
    if (delta === undefined) return;
    event.preventDefault();

    const [dx, dy] = delta;
    const { box, min } = target;
    const next: Box = event.shiftKey
      ? {
          ...boxOf(box),
          w: Math.min(Math.max(box.w + dx, min.w), CANVAS_COLUMNS - box.x),
          h: Math.max(box.h + dy, min.h),
        }
      : clampBox({ ...boxOf(box), x: box.x + dx, y: box.y + dy }, min);
    if (sameBox(next, boxOf(box))) return;

    const el = event.currentTarget;
    const from = el.getBoundingClientRect();
    // Giữ phím mũi tên là MỘT bước hoàn tác, không phải hai chục.
    flushSync(() => target.apply(next, true));
    glide(el, from, boardRef.current === null ? 1 : scaleOf(boardRef.current));
  }

  const annotationBox = (a: ReportAnnotationDto): React.ReactElement => {
    const target = annotationTarget(a);
    return (
      <AnnotationBox
        key={a.id}
        annotation={a}
        selected={a.id === selectedId}
        editing={a.id === editingId}
        onSelect={target.select}
        onGrabMove={(e) => begin('move', target, e)}
        onGrabResize={(e) => begin('resize', target, e)}
        onPointerMove={move}
        onPointerUp={end}
        onKeyDown={(e) => onKey(e, target)}
        onRemove={target.remove}
        onEdit={(on) => onEditText(on ? a.id : null)}
        onText={(text) => onChangeAnnotation(a.id, { text })}
      />
    );
  };

  /*
   * Ba tầng vẽ (khung nền → biểu đồ → chú thích nổi) do `z-index` quyết định,
   * KHÔNG do thứ tự trong DOM — xem `CANVAS_LAYER_Z`. Nên chú thích nằm trong
   * MỘT danh sách, đúng thứ tự của mảng, dù tầng nào.
   *
   * ⚠️ Đừng tách thành hai danh sách "dưới" và "trên" cho dễ đọc. React đối
   * chiếu con theo từng danh sách, nên đổi tầng một hộp là GỠ nó khỏi danh sách
   * này rồi GẮN MỚI vào danh sách kia: hộp mất tiêu điểm, và một hộp văn bản
   * đang gõ dở thì mất luôn ô gõ. Bản đầu tiên của §10.18 đã làm đúng như vậy.
   */
  return (
    <div ref={boardRef}>
      {/* Toast dựng qua PORTAL, không đặt trong khung.
          `boardRef` được dùng làm gốc toạ độ của mọi cú kéo (`begin`) và làm bề
          ngang lưới, nên chèn bất cứ thứ gì vào trong nó là dời gốc ấy đi —
          biểu đồ sẽ nhảy lệch khỏi con trỏ đúng bằng chiều cao cái toast. Đặt
          ngoài `ZoomViewport` luôn: nằm trong thì chữ co theo mức thu phóng, và
          ở 50% thì đọc không ra. */}
      {(dangXuat !== null || loiXuat !== null) &&
        createPortal(
          <div className="fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
            <div
              role={loiXuat === null ? 'status' : 'alert'}
              className={`flex max-w-lg items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg ${
                loiXuat === null
                  ? 'border-slate-200 bg-white text-slate-700'
                  : 'border-red-200 bg-white'
              }`}
            >
              {loiXuat === null ? (
                <span>Đang xuất “{dangXuat}”…</span>
              ) : (
                <>
                  <span className="min-w-0">
                    <span className="block font-medium text-red-700">Chưa xuất được biểu đồ</span>
                    <span className="mt-0.5 block text-slate-600">{loiXuat}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setLoiXuat(null)}
                    aria-label="Đóng thông báo"
                    className="-mt-1 shrink-0 rounded px-1.5 py-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  >
                    ✕
                  </button>
                </>
              )}
            </div>
          </div>,
          document.body,
        )}

      <CanvasGrid minRows={rowsNeeded([...drafts, ...annotations])}>
        {drafts.map((draft) => {
          const target = visualTarget(draft);
          const ten = labelOf(draft);
          return (
            <Card
              key={draft.id}
              draft={draft}
              title={ten}
              selected={draft.id === selectedId}
              modelId={modelId}
              onSelect={target.select}
              onRemove={target.remove}
              onXuat={(kieu, el, data) => xuatO(kieu, el, ten, data)}
              onGrabMove={(e) => begin('move', target, e)}
              onGrabResize={(e) => begin('resize', target, e)}
              onPointerMove={move}
              onPointerUp={end}
              onKeyDown={(e) => onKey(e, target)}
            />
          );
        })}
        {annotations.map(annotationBox)}
        {/* Khung nét đứt của cú kéo. Luôn nằm sẵn trong lưới và chỉ bật lên khi
            kéo: gắn/gỡ nó mỗi lần là một lượt vẽ lại cả khung đúng lúc cú kéo
            bắt đầu — khoảnh khắc nhạy nhất với độ giật. */}
        <div
          ref={ghostRef}
          hidden
          aria-hidden="true"
          data-drag-ghost=""
          style={{ zIndex: GHOST_Z }}
          className="pointer-events-none rounded-lg border-2 border-dashed border-brand-400 bg-brand-50/50"
        />
      </CanvasGrid>
    </div>
  );
}

function Card({
  draft,
  title,
  selected,
  modelId,
  onSelect,
  onRemove,
  onXuat,
  onGrabMove,
  onGrabResize,
  onPointerMove,
  onPointerUp,
  onKeyDown,
}: {
  draft: VisualDraft;
  title: string;
  selected: boolean;
  modelId: number;
  onSelect: () => void;
  onRemove: () => void;
  /** Xuất riêng ô này — `el` là thẻ của ô, `data` là số liệu nó đang vẽ. */
  onXuat: (kieu: KieuMotO, el: HTMLElement | null, data: ReportDataDto | undefined) => void;
  onGrabMove: (event: React.PointerEvent<HTMLElement>) => void;
  onGrabResize: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
}): React.ReactElement {
  const blocker = blockerOf(draft);

  /*
   * Mỗi ô tự hỏi số liệu của mình.
   *
   * Một request cho cả khung sẽ gọn hơn, nhưng trong trình dựng thì các ô đổi
   * KHÔNG cùng nhịp: kéo một trường vào ô số 3 không có lý do gì bắt ba ô kia
   * quét lại ClickHouse. react-query gộp theo khoá `config`, nên hai ô cấu hình
   * y hệt nhau vẫn chỉ tốn một lượt.
   *
   * Trang XEM thì ngược lại — ở đó mọi ô nạp cùng lúc đúng một lần, nên nó dùng
   * `GET /reports/:id/canvas-data`.
   */
  // Cấu hình dựng bằng `previewConfigOfDraft` chứ không viết tay ở đây: trang
  // XEM dựng cùng hình dạng đó từ cấu hình đã lưu (`previewConfigOfDto`), và
  // hai bên chỉ dùng lại được số liệu của nhau khi hai khoá TRÙNG từng trường.
  const config = blocker === null ? previewConfigOfDraft(draft) : null;

  /**
   * Trang NHÓM của ô này — hai cái nút ‹ › (§10.12).
   *
   * ⚠️ Đừng lẫn với TRANG BÁO CÁO: cái đó là một sheet và nó nằm ở
   * `ReportBuilderPage`. Cái này là một lát cắt bên trong một biểu đồ.
   *
   * Cố ý KHÔNG lưu vào `VisualDraft`: nó không đi vào cấu hình báo cáo, nên để
   * nó ở đó là mời nó lọt vào `toDto` rồi thành "báo cáo này mở ra ở trang 4".
   */
  const [groupPage, setGroupPage] = useState(0);

  /*
   * Đổi cấu hình là VỀ trang đầu.
   *
   * Đổi thước đo trong lúc đang ở trang 6 thì trang 6 của câu hỏi MỚI gần như
   * chắc chắn không tồn tại — người dùng nhận một ô trống và không hiểu vì sao
   * cú thả vừa rồi làm hỏng biểu đồ. Khoá theo chuỗi JSON của `config` chứ
   * không theo từng trường: thêm một trường vào `PreviewConfig` sau này sẽ tự
   * được tính vào, không phải nhớ sửa thêm ở đây.
   */
  const configKey = JSON.stringify(config);
  useEffect(() => setGroupPage(0), [configKey]);

  const preview = useModelReportPreview(
    modelId,
    config === null ? null : { chartType: draft.chartType, config, page: groupPage },
  );

  // Xem `ReportBuilderPage` §10.9: vẽ thẳng `preview.data` nghĩa là một hộp lỗi
  // nằm trên một biểu đồ trông bình thường, mà biểu đồ đó là kết quả của lựa
  // chọn TRƯỚC. Thà không có gì để nhìn còn hơn nhìn nhầm.
  const shown = blocker === null && !preview.isError ? preview.data : undefined;

  /*
   * Có biểu đồ trên màn hình, và nó CHƯA phải câu trả lời vừa xin.
   *
   * Hai đường vào cùng một trạng thái: ảnh chụp lần trước đọc từ đĩa (xem
   * `useModelReportPreview`), và biểu đồ của cấu hình cũ mà `keepPreviousData`
   * giữ lại. Cả hai đều là "số đang hiện không sai, nhưng chưa mới" — và người
   * đọc một biểu đồ cần biết điều đó trước khi đọc con số.
   *
   * Làm mờ thôi thì chưa đủ: mờ nói "có gì đó đang xảy ra", không nói cái gì.
   */
  const refreshing = shown !== undefined && preview.isFetching;

  const secRef = useRef<HTMLElement>(null);

  return (
    <section
      ref={secRef}
      style={{ ...cellStyle(draft), zIndex: CANVAS_LAYER_Z.visual }}
      tabIndex={0}
      aria-label={`Ô biểu đồ: ${title}`}
      onFocus={onSelect}
      onKeyDown={onKeyDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className={`relative flex flex-col overflow-hidden rounded-xl border bg-white transition-shadow outline-none ${
        selected
          ? 'border-brand-500 ring-2 ring-brand-500/30'
          : 'border-slate-200 hover:border-slate-300'
      }`}
    >
      {/* `h-[29px]` khai CỨNG, đúng con số `CanvasView` khai — §10.13.
          Để chiều cao tự tính theo nội dung thì thêm một cái nút vào đây là dải
          tiêu đề cao thêm vài pixel, và ô người dùng vừa xếp ở trình dựng mở ra
          ở trang xem lại cao khác. Đo trên Chromium: 31px ở đây, 29px ở kia. */}
      <header
        onPointerDown={onGrabMove}
        className="flex h-[29px] shrink-0 cursor-grab items-center gap-2 border-b border-slate-100 px-3 py-1.5 select-none active:cursor-grabbing"
      >
        <span
          className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-700"
          title={title}
        >
          {title}
        </span>
        {/* `DANG_TAI`: xuất một ô phải đợi con số MỚI, không chụp con số cũ
            đang mờ trên màn hình — xem `choVeXong`. */}
        {refreshing && (
          <span className="shrink-0 text-[10px] whitespace-nowrap text-slate-400" {...DANG_TAI}>
            đang cập nhật…
          </span>
        )}
        {/*
          Menu "⋮" thay cho nút ✕ cũ — §10.23.
          - `onPointerDown` phải dừng ở đây: nếu không, bấm vào menu cũng khởi
            động một cú kéo trên tiêu đề bên dưới.
          - Nút cao hơn dòng chữ, nên dải tiêu đề phải khai cứng chiều cao —
            xem chú thích ở thẻ <header>.
          - `KHONG_XUAT` để chính cái menu này không lọt vào ảnh vừa chụp.
        */}
        <span {...KHONG_XUAT} onPointerDown={(e) => e.stopPropagation()} className="shrink-0">
          <RowMenu label={`Thao tác trên ô ${title}`}>
            {(close) => (
              <>
                {MUC_XUAT.map((m) => (
                  <RowMenuItem
                    key={m.kieu}
                    icon={m.icon}
                    disabled={shown === undefined}
                    title={shown === undefined ? 'Biểu đồ chưa có số liệu để xuất.' : undefined}
                    onClick={() => {
                      close();
                      onXuat(m.kieu, secRef.current, shown);
                    }}
                  >
                    {m.nhan}
                  </RowMenuItem>
                ))}
                <div className="my-1 border-t border-slate-100" role="separator" />
                <RowMenuItem
                  icon={ROW_MENU_ICONS.trash}
                  danger
                  onClick={() => {
                    close();
                    onRemove();
                  }}
                >
                  Xoá ô
                </RowMenuItem>
              </>
            )}
          </RowMenu>
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden p-2" aria-busy={preview.isFetching}>
        {blocker !== null ? (
          <p className="flex h-full items-center justify-center px-3 text-center text-xs leading-snug text-slate-400">
            {blocker}
          </p>
        ) : preview.isError ? (
          <p className="flex h-full items-center justify-center px-3 text-center text-xs leading-snug text-red-600">
            {getApiError(preview.error).message}
          </p>
        ) : shown === undefined ? (
          <p
            className="flex h-full items-center justify-center text-xs text-slate-400"
            {...DANG_TAI}
          >
            Đang tính…
          </p>
        ) : (
          <div className={`h-full ${refreshing ? 'opacity-60 transition-opacity' : ''}`}>
            {/* `fit`: xem `CanvasView`. Bản xem trước và bản đã lưu phải cùng
                một chế độ, nếu không thì kéo ô ở đây trông một kiểu và mở ra
                trông một kiểu khác (§10.13). */}
            <ReportChart
              chartType={draft.chartType}
              data={shown}
              options={draft.options}
              onPage={setGroupPage}
              fit
            />
          </div>
        )}
      </div>

      {/* Tay nắm co giãn. `aria-hidden` vì bàn phím đã có Shift+mũi tên — một
          nút không bấm được bằng Enter mà vẫn nằm trong thứ tự Tab chỉ làm
          người dùng bàn phím mất một nhịp mà không được gì. */}
      <span
        onPointerDown={onGrabResize}
        aria-hidden="true"
        {...KHONG_XUAT}
        className="absolute right-0 bottom-0 h-4 w-4 cursor-nwse-resize rounded-tl border-t border-l border-slate-300 bg-white/80"
      />
    </section>
  );
}
