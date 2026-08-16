import type { ColumnRole } from '@bi/shared';

/**
 * Hình học của canvas quan hệ — §10.4, TOÀN BỘ hàm thuần.
 *
 * ─── Kích thước CỐ ĐỊNH là toàn bộ mẹo của canvas này ───────────────────────
 *
 * Vì bề rộng thẻ và chiều cao mỗi dòng là hằng số, mọi điểm neo tính được bằng
 * số học. Không `getBBox()`, không đo DOM, không `useLayoutEffect`, và không có
 * cảnh đường nối vẽ sai chỗ ở khung hình đầu tiên rồi mới nhảy về đúng.
 *
 * Cái giá: tên bảng dài bị cắt bằng `text-overflow`, bù lại bằng `<title>`. So
 * với việc phải đo từng thẻ sau mỗi lần render thì đây là đổi chác đúng chiều.
 */

export const NODE_W = 220;
export const HEADER_H = 34;
export const ROW_H = 22;
/** Quá số này thì thẻ liệt kê "+ N cột nữa" thay vì cao vô tận. */
export const MAX_ROWS = 8;
export const CORNER_R = 8;

export interface CanvasColumn {
  id: number;
  name: string;
  role: ColumnRole;
}

export interface CanvasNode {
  /** id dòng `datamodel_datasets` — định danh của thẻ. */
  id: number;
  label: string;
  columns: CanvasColumn[];
  x: number;
  y: number;
}

export interface Point {
  x: number;
  y: number;
}

export function visibleColumns(node: CanvasNode): CanvasColumn[] {
  return node.columns.filter((c) => c.role !== 'hidden').slice(0, MAX_ROWS);
}

export function hiddenCount(node: CanvasNode): number {
  return Math.max(0, node.columns.filter((c) => c.role !== 'hidden').length - MAX_ROWS);
}

export function nodeHeight(node: CanvasNode): number {
  const rows = visibleColumns(node).length + (hiddenCount(node) > 0 ? 1 : 0);
  return HEADER_H + rows * ROW_H + 6;
}

/**
 * Điểm neo của đường nối.
 *
 * Neo vào ĐÚNG DÒNG của cột khoá khi cột đó nằm trong phần hiện ra — đó là thứ
 * khiến bức tranh nói được điều mà một bảng danh sách không nói: nhìn là thấy
 * NỐI BẰNG CỘT NÀO. Cột bị cắt khỏi danh sách thì neo vào giữa phần tiêu đề.
 */
export function anchorFor(node: CanvasNode, columnId: number, side: 'l' | 'r'): Point {
  const index = visibleColumns(node).findIndex((c) => c.id === columnId);
  const y =
    index === -1
      ? node.y + HEADER_H / 2
      : node.y + HEADER_H + index * ROW_H + ROW_H / 2;

  return { x: side === 'l' ? node.x : node.x + NODE_W, y };
}

/**
 * Đường nối ba đoạn, bo góc.
 *
 * Chọn mép trái hay mép phải theo vị trí tương đối của hai thẻ, để đường không
 * cắt ngang qua chính cái thẻ nó xuất phát.
 */
export function edgePath(a: Point, b: Point): string {
  const mx = (a.x + b.x) / 2;
  const dy = b.y - a.y;

  // Hai thẻ gần ngang nhau -> một đường thẳng, đỡ rối mắt hơn hẳn ba đoạn.
  if (Math.abs(dy) < CORNER_R * 2) {
    return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
  }

  const s = Math.sign(dy);
  return (
    `M ${a.x} ${a.y} ` +
    `H ${mx - CORNER_R} ` +
    `Q ${mx} ${a.y} ${mx} ${a.y + s * CORNER_R} ` +
    `V ${b.y - s * CORNER_R} ` +
    `Q ${mx} ${b.y} ${mx + CORNER_R} ${b.y} ` +
    `H ${b.x}`
  );
}

/** Hai thẻ nối nhau nên dùng mép nào. */
export function sidesFor(left: CanvasNode, right: CanvasNode): ['l' | 'r', 'l' | 'r'] {
  return right.x >= left.x ? ['r', 'l'] : ['l', 'r'];
}

/** Khung nhìn đủ chứa mọi thẻ, chừa lề. */
export function viewBoxFor(nodes: readonly CanvasNode[]): string {
  if (nodes.length === 0) return '0 0 800 400';

  const maxX = Math.max(...nodes.map((n) => n.x + NODE_W));
  const maxY = Math.max(...nodes.map((n) => n.y + nodeHeight(n)));
  const minX = Math.min(...nodes.map((n) => n.x));
  const minY = Math.min(...nodes.map((n) => n.y));

  const pad = 40;
  return `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`;
}
