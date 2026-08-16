import { RELATIONSHIP_KIND_SHORT, type DataModelRelationshipDto } from '@bi/shared';
import { useRef, useState } from 'react';

import {
  anchorFor,
  edgePath,
  hiddenCount,
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

interface Props {
  nodes: CanvasNode[];
  relationships: DataModelRelationshipDto[];
  canEdit: boolean;
  onMove: (positions: { id: number; x: number; y: number }[]) => void;
}

/** Bước di chuyển bằng bàn phím. Shift để chỉnh tinh. */
const STEP = 10;
const STEP_FINE = 1;

export function RelationshipCanvas({
  nodes,
  relationships,
  canEdit,
  onMove,
}: Props): React.ReactElement {
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ id: number; dx: number; dy: number } | null>(null);
  const [positions, setPositions] = useState<Record<number, { x: number; y: number }>>({});

  const placed: CanvasNode[] = nodes.map((node) => ({
    ...node,
    ...(positions[node.id] ?? { x: node.x, y: node.y }),
  }));
  const byId = new Map(placed.map((n) => [n.id, n]));
  const viewBox = viewBoxFor(placed);

  /**
   * Toạ độ con trỏ trong hệ SVG.
   *
   * `viewBox` cố định còn phần tử co giãn theo khung, nên phải nhân hệ số —
   * không thì thẻ chạy nhanh hoặc chậm hơn con trỏ.
   */
  function toSvg(event: React.PointerEvent): { x: number; y: number } {
    const svg = svgRef.current;
    if (svg === null) return { x: 0, y: 0 };

    const rect = svg.getBoundingClientRect();
    const [vx, vy, vw, vh] = viewBox.split(' ').map(Number);
    return {
      x: (vx ?? 0) + ((event.clientX - rect.left) / rect.width) * (vw ?? 1),
      y: (vy ?? 0) + ((event.clientY - rect.top) / rect.height) * (vh ?? 1),
    };
  }

  function move(id: number, x: number, y: number): void {
    setPositions((prev) => ({ ...prev, [id]: { x: Math.round(x), y: Math.round(y) } }));
  }

  function commit(id: number): void {
    const node = byId.get(id);
    if (node !== undefined) onMove([{ id, x: node.x, y: node.y }]);
  }

  return (
    <svg
      ref={svgRef}
      viewBox={viewBox}
      role="group"
      aria-label="Sơ đồ quan hệ giữa các bảng"
      className="h-full w-full"
      style={{ minHeight: 320 }}
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
        const more = hiddenCount(node);

        return (
          <g
            key={node.id}
            transform={`translate(${node.x} ${node.y})`}
            tabIndex={0}
            role="button"
            aria-label={`Bảng ${node.label}. Dùng phím mũi tên để di chuyển.`}
            // `touchAction: none` BẮT BUỘC: thiếu nó thì trên thiết bị cảm ứng
            // trình duyệt giành lấy cử chỉ để cuộn trang và `pointermove` ngừng
            // bắn giữa chừng — chạy hoàn hảo với chuột, hỏng lặng lẽ trên tablet.
            style={{ touchAction: 'none', cursor: canEdit ? 'grab' : 'default' }}
            onPointerDown={(event) => {
              if (!canEdit) return;
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
              {node.label.length > 24 ? `${node.label.slice(0, 23)}…` : node.label}
            </text>
            <title>{node.label}</title>

            {rows.map((column, index) => (
              <text
                key={column.id}
                x={12}
                y={HEADER_H + index * ROW_H + 15}
                className={
                  column.role === 'measure'
                    ? 'fill-brand-700 text-[11px]'
                    : 'fill-slate-600 text-[11px]'
                }
              >
                {column.name.length > 28 ? `${column.name.slice(0, 27)}…` : column.name}
              </text>
            ))}

            {more > 0 && (
              <text
                x={12}
                y={HEADER_H + rows.length * ROW_H + 15}
                className="fill-slate-400 text-[11px] italic"
              >
                + {more} cột nữa
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
