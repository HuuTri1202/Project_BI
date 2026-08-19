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
export const CORNER_R = 8;

export interface CanvasColumn {
  id: number;
  name: string;
  role: ColumnRole;
  /** Khoá chính nghiệp vụ khai ở tab Schemas — vẽ dấu `PK` ở mép phải. */
  isPrimary?: boolean;
}

export interface CanvasNode {
  /** id dòng `datamodel_datasets` — định danh của thẻ. */
  id: number;
  label: string;
  columns: CanvasColumn[];
  x: number;
  y: number;
  /**
   * Số cột KHÔNG vẽ ra vì thẻ đang thu gọn.
   *
   * Thẻ thu gọn nhận sẵn một `columns` đã rút bớt (xem `RelationshipCanvas`),
   * nên mọi phép hình học bên dưới không phải biết gì về việc thu gọn. Con số
   * này chỉ để vẽ thêm MỘT dòng "còn N cột" ở đáy — và vì nó chiếm một dòng
   * thật nên `nodeHeight` phải cộng vào, nếu không viền thẻ cắt ngang chữ.
   */
  hiddenCount?: number;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * Cột vẽ được của một thẻ.
 *
 * Chỉ lọc theo vai trò `Ẩn` — đó là lựa chọn của người dùng ở tab Schemas. Việc
 * thu gọn thẻ KHÔNG xử lý ở đây: `RelationshipCanvas` rút `columns` trước khi
 * đưa xuống, nên hàm này (và `anchorFor`, `columnAt`, `nodeHeight`) không cần
 * biết thẻ đang mở hay đang gọn.
 */
export function visibleColumns(node: CanvasNode): CanvasColumn[] {
  return node.columns.filter((c) => c.role !== 'hidden');
}

export function nodeHeight(node: CanvasNode): number {
  const summaryRow = (node.hiddenCount ?? 0) > 0 ? ROW_H : 0;
  return HEADER_H + visibleColumns(node).length * ROW_H + summaryRow + 6;
}

/**
 * Điểm neo của đường nối.
 *
 * Neo vào ĐÚNG DÒNG của cột khoá — đó là thứ khiến bức tranh nói được điều mà
 * một bảng danh sách không nói: nhìn là thấy NỐI BẰNG CỘT NÀO.
 *
 * Nhánh `-1` giờ chỉ còn xảy ra với cột đặt vai trò `Ẩn`: nó không hiện thành
 * dòng nào nên đường nối neo vào giữa phần tiêu đề thay vì rơi ra ngoài thẻ.
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

/**
 * Cột nằm dưới một điểm — dùng để thả chuột khi KÉO NỐI hai bảng.
 *
 * Dò bằng SỐ HỌC chứ không bằng `document.elementFromPoint`: trong lúc kéo,
 * `setPointerCapture` chuyển hướng mọi sự kiện về phần tử nguồn, nên trình duyệt
 * không cho biết con trỏ đang ở trên phần tử nào. Kích thước thẻ là hằng số
 * (xem đầu file) nên phép dò này chỉ là vài phép so sánh.
 *
 * Duyệt NGƯỢC danh sách: thẻ vẽ sau nằm đè lên thẻ vẽ trước, nên khi hai thẻ
 * chồng nhau thì thẻ ở trên phải thắng — đúng thứ mắt người dùng thấy.
 */
export function columnAt(
  nodes: readonly CanvasNode[],
  point: Point,
): { nodeId: number; columnId: number } | null {
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const node = nodes[i];
    if (node === undefined) continue;
    if (point.x < node.x || point.x > node.x + NODE_W) continue;

    const rows = visibleColumns(node);
    const top = node.y + HEADER_H;
    if (point.y < top || point.y >= top + rows.length * ROW_H) continue;

    const column = rows[Math.floor((point.y - top) / ROW_H)];
    if (column !== undefined) return { nodeId: node.id, columnId: column.id };
  }
  return null;
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
