import { RELATIONSHIP_KIND_SHORT, type DataModelRelationshipDto } from '@bi/shared';
import { useEffect, useRef, useState } from 'react';

import {
  anchorFor,
  columnAt,
  edgePath,
  nodeHeight,
  sidesFor,
  viewBoxFor,
  visibleColumns,
  HEADER_H,
  NODE_W,
  ROW_H,
  type CanvasNode,
} from './geometry';

/**
 * Sơ đồ quan hệ — §10.4, SVG tự viết, không thêm thư viện nào.
 *
 * Bản build frontend đã 776KB; react-flow là +150KB nữa cho đúng một tab. Thứ
 * ta cần ở đây — thẻ kéo được và đường nối — là vài trăm dòng.
 *
 * ⚠️ Canvas KHÔNG phải con đường duy nhất. Ngay dưới nó là một bảng liệt kê
 * đúng những quan hệ đang vẽ, và mọi thao tác thêm/xoá đều làm được từ bảng đó.
 * Xem `RelationshipTab`. Cùng nguyên tắc với `VegaChart` (có bảng `sr-only`) và
 * `Badge` ("luôn có chữ, không bao giờ chỉ có màu").
 */

/** Một đầu của quan hệ, theo ngôn ngữ của canvas. */
export interface ConnectEnd {
  /** Id dòng `datamodel_datasets` — chính là `CanvasNode.id`. */
  nodeId: number;
  columnId: number;
}

interface Props {
  nodes: CanvasNode[];
  relationships: DataModelRelationshipDto[];
  canEdit: boolean;
  onMove: (positions: { id: number; x: number; y: number }[]) => void;
  /**
   * Người dùng vừa KÉO từ một cột sang một cột của bảng khác.
   *
   * Canvas KHÔNG tự lưu quan hệ. Kiểu quan hệ (nhiều→một, một→một…) không suy ra
   * được từ một cử chỉ kéo, và chọn sai kiểu thì con số vẫn ra nhưng sai — nên
   * cử chỉ này mở form đã điền sẵn hai bảng và hai cột, để người dùng chỉ còn
   * xác nhận đúng một điều mà máy không đoán được.
   */
  onConnect: (left: ConnectEnd, right: ConnectEnd) => void;
}

/** Bước di chuyển bằng bàn phím. Shift để chỉnh tinh. */
const STEP = 10;
const STEP_FINE = 1;

/**
 * Giới hạn thu phóng.
 *
 * Chặn hai đầu là bắt buộc chứ không phải làm đẹp: `viewBox` co về 0 thì SVG
 * biến mất hẳn và không còn gì để bấm nhằm quay lại, còn phóng quá to thì một
 * thẻ chiếm trọn khung và người dùng lạc mất phương hướng.
 */
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 3;
const ZOOM_STEP = 1.25;

/**
 * Số cột mà quá đó thì thẻ TỰ thu gọn khi mở trang.
 *
 * ─── Vì sao phải có ngưỡng này ──────────────────────────────────────────────
 *
 * `zoom = 1` nghĩa là vừa khít MỌI thẻ, nên thẻ CAO NHẤT quyết định tỉ lệ của cả
 * sơ đồ. `Global-Superstore · Orders` có 24 cột hiện được, tức 562 đơn vị chiều
 * cao — một mình nó ép hai thẻ còn lại (3 và 2 cột) xuống mức không đọc nổi,
 * trong khi phần lớn chiều cao đó là những cột không dính tới quan hệ nào.
 *
 * Thu gọn KHÔNG phải quay lại lối cắt "+ 16 cột nữa" đã bỏ. Khác nhau ở hai
 * điểm, và đó là hai điểm quyết định:
 *
 *   1. Cột đang được NỐI luôn hiện, dù thẻ gọn hay mở — sơ đồ vẫn trả lời được
 *      câu hỏi duy nhất nó sinh ra để trả lời: nối bằng cột nào.
 *   2. Mở lại là một cú bấm, và trạng thái đó được nhớ.
 *
 * Ngưỡng đặt ở 12: dưới mức này thẻ vẫn thấp hơn phần lớn màn hình, còn trên
 * mức này thì nó bắt đầu ép các thẻ khác.
 */
const AUTO_COLLAPSE_OVER = 12;

export function RelationshipCanvas({
  nodes,
  relationships,
  canEdit,
  onMove,
  onConnect,
}: Props): React.ReactElement {
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ id: number; dx: number; dy: number } | null>(null);
  const [positions, setPositions] = useState<Record<number, { x: number; y: number }>>({});

  /**
   * Đang kéo một đường nối từ một cột.
   *
   * `x`,`y` là vị trí con trỏ trong hệ SVG — dùng để vẽ đường "ma" đi theo tay
   * người dùng, và để dò xem đang thả trúng cột nào.
   */
  const [link, setLink] = useState<{ from: ConnectEnd; x: number; y: number } | null>(null);

  /**
   * Thu phóng và dời khung — §10.4.
   *
   * `zoom = 1` nghĩa là VỪA KHÍT mọi thẻ, không phải "tỉ lệ 1:1 với pixel":
   * `viewBoxFor` đã tự tính khung ôm trọn sơ đồ, nên mốc tự nhiên ở đây là
   * "thấy hết" chứ không phải một cỡ chữ cụ thể. Nhờ vậy nút "Vừa khung" chỉ là
   * đặt lại hai state về mặc định, không cần đo đạc gì thêm.
   *
   * `pan` tính bằng ĐƠN VỊ SVG, không phải pixel màn hình — cùng hệ với toạ độ
   * thẻ, nên phóng to rồi dời khung không bị lệch dần.
   */
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panning = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null);
  // Con trỏ phải đổi hình khi đang kéo, mà `useRef` thì không kích hoạt render —
  // nên trạng thái "đang kéo" cần một `useState` song song.
  const [grabbing, setGrabbing] = useState(false);

  /**
   * Thẻ nào đang MỞ, theo lựa chọn tường minh của người dùng.
   *
   * Vắng mặt nghĩa là "chưa động tới" — khi đó `isOpen` quyết theo số cột. Lưu
   * ngược lại (một tập "đã thu gọn") sẽ sai: thẻ chưa động tới và thẻ vừa được
   * mở tay trông giống hệt nhau trong state, nên mở một thẻ 24 cột xong thì lần
   * render sau nó tự gọn lại.
   */
  const [openIds, setOpenIds] = useState<Record<number, boolean>>({});

  /** Cột đang tham gia một quan hệ — luôn hiện, kể cả khi thẻ thu gọn. */
  const joined = new Set<number>();
  for (const rel of relationships) {
    joined.add(rel.left.columnId);
    joined.add(rel.right.columnId);
  }

  const isOpen = (node: CanvasNode): boolean =>
    openIds[node.id] ?? visibleColumns(node).length <= AUTO_COLLAPSE_OVER;

  /**
   * Thẻ đã đặt vị trí VÀ đã rút cột theo trạng thái thu gọn.
   *
   * Rút ngay tại đây là điểm mấu chốt: mọi thứ phía dưới — `nodeHeight`,
   * `anchorFor`, `columnAt`, `viewBoxFor` — làm việc trên danh sách cột đã rút
   * mà không cần biết gì về việc thu gọn. Nhờ vậy đường nối vẫn neo đúng dòng,
   * phép dò cột lúc kéo vẫn đúng, và khung nhìn tự tính lại khi gọn/mở.
   */
  const placed: CanvasNode[] = nodes.map((node) => {
    const pos = positions[node.id] ?? { x: node.x, y: node.y };
    const all = visibleColumns(node);
    if (isOpen(node)) return { ...node, ...pos, columns: all };

    const shown = all.filter((c) => joined.has(c.id) || c.isPrimary === true);
    return { ...node, ...pos, columns: shown, hiddenCount: all.length - shown.length };
  });
  const byId = new Map(placed.map((n) => [n.id, n]));

  /** Đủ để dán nhãn nút gộp: còn thẻ nào mở thì việc tiếp theo là thu gọn. */
  const anyOpen = nodes.some((node) => isOpen(node));

  function toggle(id: number): void {
    const node = nodes.find((n) => n.id === id);
    if (node === undefined) return;
    setOpenIds((prev) => ({ ...prev, [id]: !(prev[id] ?? isOpen(node)) }));
  }

  function toggleAll(): void {
    setOpenIds(Object.fromEntries(nodes.map((n) => [n.id, !anyOpen])));
  }

  // Khung ôm trọn sơ đồ, rồi thu/phóng quanh tâm của chính nó.
  const [bx, by, bw, bh] = viewBoxFor(placed).split(' ').map(Number);
  const vw = (bw ?? 800) / zoom;
  const vh = (bh ?? 400) / zoom;
  const cx = (bx ?? 0) + (bw ?? 800) / 2 + pan.x;
  const cy = (by ?? 0) + (bh ?? 400) / 2 + pan.y;
  const viewBox = `${cx - vw / 2} ${cy - vh / 2} ${vw} ${vh}`;

  function zoomBy(factor: number): void {
    setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z * factor)));
  }

  function fit(): void {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }

  /**
   * Ctrl/⌘ + lăn chuột để thu phóng.
   *
   * Gắn tay bằng `addEventListener` chứ không dùng `onWheel` của React: React
   * đăng ký sự kiện wheel ở dạng passive, và listener passive thì gọi
   * `preventDefault()` không có tác dụng — trình duyệt vẫn phóng to cả trang.
   *
   * KHÔNG bắt lăn chuột trần: sơ đồ nằm trong một trang có thể cuộn, và cướp cử
   * chỉ cuộn mặc định là cách chắc chắn làm người dùng bực.
   */
  useEffect(() => {
    const svg = svgRef.current;
    if (svg === null) return;

    const onWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      zoomBy(event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP);
    };

    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  /**
   * Toạ độ con trỏ trong hệ SVG.
   *
   * `viewBox` cố định còn phần tử co giãn theo khung, nên phải nhân hệ số —
   * không thì thẻ chạy nhanh hoặc chậm hơn con trỏ. Sau khi có thu phóng, hệ số
   * đó cũng chính là thứ giữ cho thẻ bám đúng con trỏ ở mọi mức zoom.
   */
  function toSvg(event: React.PointerEvent): { x: number; y: number } {
    const svg = svgRef.current;
    if (svg === null) return { x: 0, y: 0 };

    const rect = svg.getBoundingClientRect();
    const [x0, y0, w, h] = viewBox.split(' ').map(Number);
    return {
      x: (x0 ?? 0) + ((event.clientX - rect.left) / rect.width) * (w ?? 1),
      y: (y0 ?? 0) + ((event.clientY - rect.top) / rect.height) * (h ?? 1),
    };
  }

  function move(id: number, x: number, y: number): void {
    setPositions((prev) => ({ ...prev, [id]: { x: Math.round(x), y: Math.round(y) } }));
  }

  function commit(id: number): void {
    const node = byId.get(id);
    if (node !== undefined) onMove([{ id, x: node.x, y: node.y }]);
  }

  /** Thẻ chứa cột đang được kéo đi, để neo đầu đường "ma". */
  const linkSource = link === null ? null : (byId.get(link.from.nodeId) ?? null);

  /**
   * Cột đang bị con trỏ phủ lên trong lúc kéo — để tô sáng chỗ sắp thả.
   *
   * Không có nó thì người dùng thả trong mù mờ và chỉ biết mình trượt sau khi
   * chẳng có gì xảy ra. Loại luôn cột của chính bảng nguồn: thả vào đó không tạo
   * được quan hệ nên tô sáng là hứa hẹn sai.
   */
  const hovered =
    link === null
      ? null
      : (() => {
          const hit = columnAt(placed, { x: link.x, y: link.y });
          return hit !== null && hit.nodeId !== link.from.nodeId ? hit : null;
        })();

  return (
    <div className="relative h-full w-full">
      {/* Thanh thu phóng nổi trên sơ đồ. Đặt trong cùng component với canvas vì
          nó điều khiển state của canvas; đặt ở trang cha thì phải kéo `zoom`
          ngược lên và mọi thứ dùng canvas đều phải tự dựng lại thanh này. */}
      <div className="absolute top-2 right-2 z-10 flex items-center gap-1 rounded-lg border border-slate-200 bg-white/95 p-1 shadow-sm">
        {/* Gộp trước, thu phóng sau: thu gọn là thứ thay đổi bố cục, còn thu
            phóng chỉ đổi cách nhìn cùng một bố cục. */}
        <button
          type="button"
          onClick={toggleAll}
          className="rounded px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
        >
          {anyOpen ? 'Thu gọn tất cả' : 'Mở tất cả'}
        </button>
        <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-slate-200" />
        <ZoomButton label="Thu nhỏ" onClick={() => zoomBy(1 / ZOOM_STEP)} disabled={zoom <= ZOOM_MIN}>
          <path d="M5 12h14" />
        </ZoomButton>
        {/* Con số là CHỮ chứ không phải một thanh trượt: nó cho biết đang ở mức
            nào, và bấm vào là về vừa khung — hai việc trong một chỗ. */}
        <button
          type="button"
          onClick={fit}
          title="Vừa khung"
          className="min-w-14 rounded px-2 py-1 text-xs font-medium text-slate-600 tabular-nums hover:bg-slate-100"
        >
          {Math.round(zoom * 100)}%
        </button>
        <ZoomButton label="Phóng to" onClick={() => zoomBy(ZOOM_STEP)} disabled={zoom >= ZOOM_MAX}>
          <path d="M12 5v14M5 12h14" />
        </ZoomButton>
      </div>

      <svg
        ref={svgRef}
        viewBox={viewBox}
        role="group"
        aria-label="Sơ đồ quan hệ giữa các bảng"
        // `select-none`: kéo ngang qua tên cột sẽ BÔI ĐEN chữ như đang chọn văn
        // bản, để lại một vệt xanh trông y hệt trạng thái "đã chọn" mà thao tác
        // thật lại là kéo nối. Hai nghĩa chồng lên nhau trên cùng một vệt màu.
        className="h-full w-full select-none"
        style={{ minHeight: 320, touchAction: 'none', cursor: grabbing ? 'grabbing' : 'grab' }}
        // Kéo NỀN để dời khung. Thẻ chặn sự kiện nổi bọt (xem `stopPropagation`
        // bên dưới) nên nhánh này chỉ chạy khi bấm vào chỗ trống.
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          panning.current = { sx: event.clientX, sy: event.clientY, px: pan.x, py: pan.y };
          setGrabbing(true);
        }}
        onPointerMove={(event) => {
          const p = panning.current;
          if (p === null) return;
          const rect = svgRef.current?.getBoundingClientRect();
          if (rect === undefined) return;
          // Đổi quãng đường của con trỏ (pixel) sang đơn vị SVG. Kéo sang phải
          // thì khung nhìn phải dịch sang TRÁI, nên dấu trừ.
          setPan({
            x: p.px - ((event.clientX - p.sx) / rect.width) * vw,
            y: p.py - ((event.clientY - p.sy) / rect.height) * vh,
          });
        }}
        onPointerUp={(event) => {
          if (panning.current === null) return;
          event.currentTarget.releasePointerCapture(event.pointerId);
          panning.current = null;
          setGrabbing(false);
        }}
        onPointerCancel={() => {
          panning.current = null;
          setGrabbing(false);
        }}
      >
      <desc>
        {nodes.length} bảng, {relationships.length} quan hệ. Bảng liệt kê đầy đủ nằm ngay dưới sơ
        đồ này.
      </desc>

      {/* Đường nối vẽ TRƯỚC thẻ để thẻ nằm đè lên, không bị đường cắt ngang. */}
      <g fill="none" stroke="currentColor" className="text-slate-400">
        {relationships.map((rel) => {
          const left = byId.get(rel.left.datasetRef);
          const right = byId.get(rel.right.datasetRef);
          if (left === undefined || right === undefined) return null;

          const [ls, rs] = sidesFor(left, right);
          const a = anchorFor(left, rel.left.columnId, ls);
          const b = anchorFor(right, rel.right.columnId, rs);
          const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };

          return (
            <g key={rel.id}>
              <path d={edgePath(a, b)} strokeWidth={1.5} />
              <circle cx={a.x} cy={a.y} r={3} fill="currentColor" />
              <circle cx={b.x} cy={b.y} r={3} fill="currentColor" />
              {/* Nhãn là CHỮ, không phải ký hiệu chân quạ: ở cỡ 11px một ký
                  hiệu chân quạ không đọc được và cũng không đọc thành lời cho
                  trình đọc màn hình. */}
              <rect
                x={mid.x - 16}
                y={mid.y - 8}
                width={32}
                height={16}
                rx={4}
                className="fill-white"
                stroke="none"
              />
              <text
                x={mid.x}
                y={mid.y + 4}
                textAnchor="middle"
                className="fill-slate-500 text-[10px]"
                stroke="none"
              >
                {RELATIONSHIP_KIND_SHORT[rel.kind]}
              </text>
            </g>
          );
        })}
      </g>

      {placed.map((node) => {
        const rows = visibleColumns(node);
        const hidden = node.hiddenCount ?? 0;
        const open = hidden === 0;

        return (
          <g
            key={node.id}
            transform={`translate(${node.x} ${node.y})`}
            tabIndex={0}
            role="button"
            aria-expanded={open}
            aria-label={
              `Bảng ${node.label}, ${rows.length} cột hiện` +
              (hidden > 0 ? `, còn ${hidden} cột đang thu gọn` : '') +
              '. Mũi tên để di chuyển, Enter để thu gọn hoặc mở.'
            }
            // `touchAction: none` BẮT BUỘC: thiếu nó thì trên thiết bị cảm ứng
            // trình duyệt giành lấy cử chỉ để cuộn trang và `pointermove` ngừng
            // bắn giữa chừng — chạy hoàn hảo với chuột, hỏng lặng lẽ trên tablet.
            style={{ touchAction: 'none', cursor: canEdit ? 'grab' : 'default' }}
            onPointerDown={(event) => {
              if (!canEdit) return;
              // Chặn nổi bọt để cú bấm này KHÔNG đồng thời khởi động việc dời
              // khung ở nền. Thiếu dòng này thì kéo một thẻ sẽ kéo luôn cả sơ đồ
              // theo chiều ngược lại, và thẻ đứng yên tại chỗ.
              event.stopPropagation();
              // `setPointerCapture` chính là lý do dùng pointer event ở đây: nó
              // chuyển tiếp mọi sự kiện của con trỏ đó về phần tử này kể cả khi
              // con trỏ rời khỏi thẻ hoặc rời khỏi cửa sổ. Không có nó thì phải
              // gắn listener lên `window` kèm dọn dẹp và một lỗi closure cũ.
              event.currentTarget.setPointerCapture(event.pointerId);
              const p = toSvg(event);
              drag.current = { id: node.id, dx: p.x - node.x, dy: p.y - node.y };
            }}
            onPointerMove={(event) => {
              const d = drag.current;
              if (d === null || d.id !== node.id) return;
              const p = toSvg(event);
              move(node.id, p.x - d.dx, p.y - d.dy);
            }}
            onPointerUp={(event) => {
              if (drag.current === null) return;
              event.currentTarget.releasePointerCapture(event.pointerId);
              drag.current = null;
              commit(node.id);
            }}
            // Chạm bị ngắt giữa chừng (cuộc gọi đến, cử chỉ của trình duyệt) —
            // không dọn ở đây thì thẻ dính vào con trỏ vĩnh viễn.
            onPointerCancel={() => {
              drag.current = null;
            }}
            onKeyDown={(event) => {
              // Thu gọn/mở KHÔNG đòi quyền sửa: nó chỉ đổi cách nhìn, không
              // đụng tới dữ liệu. Người chỉ-xem cũng cần đọc được sơ đồ.
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                toggle(node.id);
                return;
              }
              if (!canEdit) return;
              const step = event.shiftKey ? STEP_FINE : STEP;
              const delta: Record<string, [number, number]> = {
                ArrowLeft: [-step, 0],
                ArrowRight: [step, 0],
                ArrowUp: [0, -step],
                ArrowDown: [0, step],
              };
              const d = delta[event.key];
              if (d === undefined) return;
              event.preventDefault();
              move(node.id, node.x + d[0], node.y + d[1]);
              commit(node.id);
            }}
            className="focus:outline-none [&:focus-visible>rect:first-child]:stroke-brand-600 [&:focus-visible>rect:first-child]:stroke-[3]"
          >
            <rect
              width={NODE_W}
              height={nodeHeight(node)}
              rx={10}
              className="fill-white stroke-slate-300"
            />
            <rect width={NODE_W} height={HEADER_H} rx={10} className="fill-slate-50" />
            <text x={12} y={22} className="fill-slate-900 text-[13px] font-semibold">
              {truncateMiddle(node.label, 24)}
            </text>
            <title>{node.label}</title>

            {/* Chevron thu gọn/mở. Vùng bấm là cả một ô 28×28 chứ không chỉ nét
                vẽ — mũi tên rộng 8 đơn vị thì ở mức thu nhỏ gần như không nắm
                trúng. `stopPropagation` để cú bấm không đồng thời kéo thẻ. */}
            <g
              onPointerDown={(event) => {
                event.stopPropagation();
                toggle(node.id);
              }}
              style={{ cursor: 'pointer' }}
              className="text-slate-400 hover:text-slate-700"
            >
              <rect
                x={NODE_W - 28}
                y={3}
                width={28}
                height={28}
                rx={6}
                className="fill-transparent hover:fill-slate-200"
              />
              {/* Quy ước quen thuộc: đang MỞ thì mũi tên chỉ LÊN (bấm để gấp
                  lại), đang GỌN thì chỉ XUỐNG (bấm để bung ra). */}
              <path
                d={open ? 'm-5 3 5 -5 5 5' : 'm-5 -2 5 5 5 -5'}
                transform={`translate(${NODE_W - 14} ${HEADER_H / 2})`}
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                pointerEvents="none"
              />
            </g>

            {rows.map((column, index) => (
              <g key={column.id}>
                {/* Ô BẮT CHUỘT của dòng cột — trong suốt, phủ trọn bề ngang thẻ.
                    Không có nó thì chỉ đúng những pixel của chữ mới kéo được, và
                    một cột tên ngắn gần như không nắm trúng. */}
                <rect
                  x={0}
                  y={HEADER_H + index * ROW_H}
                  width={NODE_W}
                  height={ROW_H}
                  className={
                    hovered?.columnId === column.id
                      ? 'fill-brand-100'
                      : 'fill-transparent hover:fill-slate-100'
                  }
                  style={{ cursor: canEdit ? 'crosshair' : 'default' }}
                  onPointerDown={(event) => {
                    if (!canEdit) return;
                    // Chặn nổi bọt để cú bấm này KHÔNG khởi động việc kéo cả thẻ
                    // (ở `<g>` cha) lẫn việc dời khung (ở nền SVG).
                    event.stopPropagation();
                    event.currentTarget.setPointerCapture(event.pointerId);
                    const p = toSvg(event);
                    setLink({ from: { nodeId: node.id, columnId: column.id }, x: p.x, y: p.y });
                  }}
                  onPointerMove={(event) => {
                    if (link === null) return;
                    const p = toSvg(event);
                    setLink({ ...link, x: p.x, y: p.y });
                  }}
                  onPointerUp={(event) => {
                    if (link === null) return;
                    event.currentTarget.releasePointerCapture(event.pointerId);
                    const target = columnAt(placed, toSvg(event));
                    const from = link.from;
                    setLink(null);
                    // Thả vào chính bảng mình là vô nghĩa — một bảng không nối
                    // với chính nó ở đây. Im lặng bỏ qua, không báo lỗi: người
                    // dùng chỉ vừa nhả chuột sai chỗ.
                    if (target !== null && target.nodeId !== from.nodeId) onConnect(from, target);
                  }}
                  onPointerCancel={() => setLink(null)}
                />
                {/* Vạch ở mép trái cho cột ĐANG được nối. Nó là thứ trả lời
                    "nối bằng cột nào" khi liếc qua, không phải lần theo đường
                    nối bằng mắt — và nó vẫn đọc được ở mức thu nhỏ, nơi đường
                    nối mảnh 1,5 đơn vị gần như biến mất. */}
                {joined.has(column.id) && (
                  <rect
                    x={0}
                    y={HEADER_H + index * ROW_H + 3}
                    width={3}
                    height={ROW_H - 6}
                    className="fill-brand-600"
                    pointerEvents="none"
                  />
                )}
                <text
                  x={12}
                  y={HEADER_H + index * ROW_H + 15}
                  pointerEvents="none"
                  className={
                    joined.has(column.id)
                      ? 'fill-slate-900 text-[11px] font-semibold'
                      : column.role === 'measure'
                        ? 'fill-brand-700 text-[11px]'
                        : 'fill-slate-600 text-[11px]'
                  }
                >
                  {truncate(column.name, column.isPrimary === true ? 22 : 27)}
                </text>
                {/* `PK` là CHỮ chứ không phải hình chìa khoá: ở cỡ 9px một hình
                    chìa khoá thành vệt mờ, còn hai chữ cái thì vẫn đọc được và
                    trình đọc màn hình cũng đọc thành lời. */}
                {column.isPrimary === true && (
                  <text
                    x={NODE_W - 10}
                    y={HEADER_H + index * ROW_H + 15}
                    textAnchor="end"
                    pointerEvents="none"
                    className="fill-amber-600 text-[9px] font-bold tracking-wide"
                  >
                    PK
                  </text>
                )}
              </g>
            ))}

            {/* Dòng tổng kết của thẻ thu gọn. Nói RÕ còn bao nhiêu và bấm được
                — một dấu ba chấm im lặng thì người dùng không biết mình đang
                thiếu gì, đúng nhược điểm của lối cắt "+ N cột" đã bỏ. */}
            {hidden > 0 && (
              <g
                onPointerDown={(event) => {
                  event.stopPropagation();
                  toggle(node.id);
                }}
                style={{ cursor: 'pointer' }}
              >
                {/* Chính dòng chữ là chỗ bấm, không chỉ cái chevron ở góc: đây
                    là nơi mắt người dùng đang nhìn khi họ muốn xem phần còn lại. */}
                <rect
                  x={0}
                  y={HEADER_H + rows.length * ROW_H}
                  width={NODE_W}
                  height={ROW_H}
                  className="fill-transparent hover:fill-slate-100"
                />
                <text
                  x={12}
                  y={HEADER_H + rows.length * ROW_H + 15}
                  pointerEvents="none"
                  className="fill-slate-400 text-[10px] italic"
                >
                  còn {hidden} cột — bấm để mở
                </text>
              </g>
            )}

            </g>
          );
        })}

        {/* Đường "ma" đi theo con trỏ trong lúc kéo nối.
            Vẽ SAU cùng để nó nằm trên mọi thẻ — đường bị thẻ che khuất giữa
            chừng khiến người dùng tưởng thao tác đã hỏng. `pointerEvents` tắt
            để nó không tự chắn phép dò cột bên dưới. */}
        {link !== null && (
          <g pointerEvents="none">
            <path
              d={edgePath(anchorFor(linkSource ?? placed[0]!, link.from.columnId, 'r'), {
                x: link.x,
                y: link.y,
              })}
              fill="none"
              strokeWidth={2}
              strokeDasharray="5 4"
              className={hovered === null ? 'stroke-slate-400' : 'stroke-brand-600'}
            />
            <circle cx={link.x} cy={link.y} r={4} className="fill-brand-600" />
          </g>
        )}
      </svg>
    </div>
  );
}

/** SVG không có `text-overflow`, nên cắt bằng tay. */
function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Cắt ở GIỮA, giữ cả hai đầu — dành cho tên bảng.
 *
 * Cắt đuôi như thường lệ ở đây thì hỏng: tên bảng trong một mô hình gần như luôn
 * chung tiền tố (`Global-Superstore · Orders`, `… · People`, `… · Returns`), nên
 * cắt đuôi để lại đúng ba thẻ mang cùng một chữ `Global-Superstore · …` — phần
 * bị vứt đi lại chính là phần phân biệt chúng.
 */
function truncateMiddle(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = Math.ceil((max - 1) / 2);
  return `${text.slice(0, head)}…${text.slice(text.length - (max - 1 - head))}`;
}

/** Nút vuông của thanh thu phóng — chỉ khác nhau ở đường vẽ bên trong. */
function ZoomButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="rounded p-1.5 text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        className="h-4 w-4"
        aria-hidden="true"
      >
        {children}
      </svg>
    </button>
  );
}
