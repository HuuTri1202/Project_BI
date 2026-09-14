import {
  CANVAS_COLUMNS,
  CANVAS_MIN_H,
  CANVAS_MIN_W,
  CANVAS_ROW_HEIGHT,
  type ReportAnnotationDto,
} from '@bi/shared';
import { useEffect, useRef, useState } from 'react';

import { useModelReportPreview } from '../../datamodels/hooks';
import { getApiError } from '../../../services/apiClient';
import { CANVAS_LAYER_Z } from '../annotations/annotationStyle';
import { CanvasGrid } from '../CanvasGrid';
import { cellStyle, rowsNeeded } from '../canvasLayout';
import { ReportChart } from '../ReportChart';
import { ANNOTATION_MIN, type AnnotationPatch } from './annotation';
import { AnnotationBox } from './AnnotationBox';
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
 * ═══ Lưới, không phải pixel ═════════════════════════════════════════════════
 *
 * Mọi thứ quy về đơn vị lưới NGAY trong lúc kéo, nên ô bám vào lưới liên tục
 * thay vì trôi tự do rồi mới nhảy về chỗ lúc thả tay. Người dùng thấy đúng thứ
 * sẽ được lưu, ở mọi thời điểm.
 *
 * ═══ Bàn phím là đường đi ĐẦY ĐỦ, không phải lối phụ ════════════════════════
 *
 * Mũi tên di chuyển, Shift+mũi tên co giãn, Delete xoá. Một khung chỉ sắp xếp
 * được bằng chuột là một khung người dùng bàn phím không dựng nổi báo cáo.
 */

/** Phải khớp `gap` của `CanvasGrid` — hai số lệch nhau thì ô trôi dần khi kéo. */
const GAP = 12;

type Box = { x: number; y: number; w: number; h: number };

/**
 * Thứ đang được kéo — một ô biểu đồ HOẶC một chú thích (§10.18).
 *
 * Không mang `id` mà mang sẵn `apply` và cỡ tối thiểu: phép tính kéo và co
 * giãn là MỘT, chỉ khác chỗ ghi kết quả vào và cỡ nhỏ nhất được phép. Hai bản
 * `begin`/`move` cho hai loại là hai chỗ để quên sửa khi đổi bước lưới.
 */
interface DragState {
  mode: 'move' | 'resize';
  pointerX: number;
  pointerY: number;
  box: Box;
  min: { w: number; h: number };
  apply: (patch: Partial<Box>) => void;
  pitchX: number;
  pitchY: number;
}

/** Một phần tử kéo được trên khung, nhìn từ phía phép tính kéo thả. */
interface Grabbable {
  box: Box;
  min: { w: number; h: number };
  apply: (patch: Partial<Box>) => void;
  select: () => void;
  remove: () => void;
}

export function CanvasBoard({
  drafts,
  annotations,
  selectedId,
  editingId,
  modelId,
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
  /** Tiêu đề để hiện trên đầu ô — trang tự dựng từ nhãn chiều và thước đo. */
  labelOf: (draft: VisualDraft) => string;
  onSelect: (id: string) => void;
  onChange: (id: string, patch: Partial<VisualDraft>) => void;
  onRemove: (id: string) => void;
  onChangeAnnotation: (id: string, patch: AnnotationPatch) => void;
  onRemoveAnnotation: (id: string) => void;
  onEditText: (id: string | null) => void;
}): React.ReactElement {
  const boardRef = useRef<HTMLDivElement>(null);
  const drag = useRef<DragState | null>(null);

  const visualTarget = (draft: VisualDraft): Grabbable => ({
    box: draft,
    min: { w: CANVAS_MIN_W, h: CANVAS_MIN_H },
    apply: (patch) => onChange(draft.id, patch),
    select: () => onSelect(draft.id),
    remove: () => onRemove(draft.id),
  });

  const annotationTarget = (a: ReportAnnotationDto): Grabbable => ({
    box: a,
    min: ANNOTATION_MIN,
    apply: (patch) => onChangeAnnotation(a.id, patch),
    select: () => onSelect(a.id),
    remove: () => onRemoveAnnotation(a.id),
  });

  function begin(
    mode: 'move' | 'resize',
    target: Grabbable,
    event: React.PointerEvent<HTMLElement>,
  ): void {
    const board = boardRef.current;
    if (board === null) return;

    const rect = board.getBoundingClientRect();
    const colWidth = (rect.width - GAP * (CANVAS_COLUMNS - 1)) / CANVAS_COLUMNS;
    const { x, y, w, h } = target.box;

    drag.current = {
      mode,
      pointerX: event.clientX,
      pointerY: event.clientY,
      box: { x, y, w, h },
      min: target.min,
      apply: target.apply,
      // BƯỚC lưới, không phải bề rộng ô: hai ô cạnh nhau cách nhau một bề rộng
      // CỘNG một khoảng hở. Bỏ quên khoảng hở thì kéo ngang qua 12 cột lệch mất
      // hơn một cột.
      pitchX: colWidth + GAP,
      pitchY: CANVAS_ROW_HEIGHT + GAP,
    };

    event.currentTarget.setPointerCapture(event.pointerId);
    // Chặn hành vi mặc định: kéo trên một tiêu đề sẽ bôi đen chữ, và trên màn
    // cảm ứng sẽ cuộn trang thay vì di chuyển ô.
    event.preventDefault();
    target.select();
  }

  function move(event: React.PointerEvent<HTMLElement>): void {
    const state = drag.current;
    if (state === null) return;

    const dx = Math.round((event.clientX - state.pointerX) / state.pitchX);
    const dy = Math.round((event.clientY - state.pointerY) / state.pitchY);
    if (dx === 0 && dy === 0) return;

    if (state.mode === 'move') {
      state.apply(clampBox({ ...state.box, x: state.box.x + dx, y: state.box.y + dy }, state.min));
      return;
    }

    // Co giãn giữ nguyên góc trên-trái, nên bề rộng bị chặn bởi mép phải của
    // khung chứ không được phép đẩy ô sang trái như `clampBox` sẽ làm.
    state.apply({
      w: Math.min(Math.max(state.box.w + dx, state.min.w), CANVAS_COLUMNS - state.box.x),
      h: Math.max(state.box.h + dy, state.min.h),
    });
  }

  function end(event: React.PointerEvent<HTMLElement>): void {
    if (drag.current === null) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
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
    if (event.shiftKey) {
      target.apply({
        w: Math.min(Math.max(box.w + dx, min.w), CANVAS_COLUMNS - box.x),
        h: Math.max(box.h + dy, min.h),
      });
      return;
    }
    target.apply(clampBox({ ...box, x: box.x + dx, y: box.y + dy }, min));
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
      <CanvasGrid minRows={rowsNeeded([...drafts, ...annotations])}>
        {drafts.map((draft) => {
          const target = visualTarget(draft);
          return (
            <Card
              key={draft.id}
              draft={draft}
              title={labelOf(draft)}
              selected={draft.id === selectedId}
              modelId={modelId}
              onSelect={target.select}
              onRemove={target.remove}
              onGrabMove={(e) => begin('move', target, e)}
              onGrabResize={(e) => begin('resize', target, e)}
              onPointerMove={move}
              onPointerUp={end}
              onKeyDown={(e) => onKey(e, target)}
            />
          );
        })}
        {annotations.map(annotationBox)}
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

  return (
    <section
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
      <header
        onPointerDown={onGrabMove}
        className="flex shrink-0 cursor-grab items-center gap-2 border-b border-slate-100 px-3 py-1.5 select-none active:cursor-grabbing"
      >
        <span
          className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-700"
          title={title}
        >
          {title}
        </span>
        {refreshing && (
          <span className="shrink-0 text-[10px] whitespace-nowrap text-slate-400">
            đang cập nhật…
          </span>
        )}
        <button
          type="button"
          onClick={onRemove}
          // `onPointerDown` phải dừng ở đây: nếu không, bấm nút Xoá cũng khởi
          // động một cú kéo trên tiêu đề bên dưới.
          onPointerDown={(e) => e.stopPropagation()}
          aria-label={`Xoá ô ${title}`}
          className="shrink-0 rounded px-1 text-xs text-slate-400 hover:bg-red-50 hover:text-red-600"
        >
          ✕
        </button>
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
          <p className="flex h-full items-center justify-center text-xs text-slate-400">
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
        className="absolute right-0 bottom-0 h-4 w-4 cursor-nwse-resize rounded-tl border-t border-l border-slate-300 bg-white/80"
      />
    </section>
  );
}
