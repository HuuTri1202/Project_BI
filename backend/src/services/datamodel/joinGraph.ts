/**
 * Đồ thị nối giữa các bảng trong một mô hình — §10.4, HÀM THUẦN.
 *
 * ─── Vì sao phải chặn, và vì sao chặn CHẶT HƠN mức Cube đòi ─────────────────
 *
 * Cube cần đúng MỘT đường nối giữa hai bảng bất kỳ. Có hai đường thì nó không
 * chọn được đường nào và từ chối với "multiple join paths" — một thông báo xuất
 * hiện lúc TRUY VẤN, ở tab Explorer, cách xa tab Quan hệ nơi người dùng vừa tạo
 * ra sai sót vài phút trước.
 *
 * Nên ta chặn ngay lúc LƯU, và chặn mọi cạnh nối hai bảng ĐÃ LIÊN THÔNG — chứ
 * không chỉ chặn vòng theo nghĩa hẹp. Chặt hơn mức tối thiểu, và đó là chủ ý:
 * mọi cạnh như vậy đều tạo ra một đường thứ hai giữa ít nhất một cặp bảng.
 *
 * Kết quả là đồ thị quan hệ luôn là một RỪNG (nhiều cây rời nhau) — đúng thứ
 * Cube làm việc được, và cũng đúng thứ vẽ ra canvas mà người đọc hiểu.
 *
 * Cấu trúc: union-find. Không dùng đệ quy để một mô hình sâu không làm tràn
 * ngăn xếp, và vì nó trả lời đúng một câu hỏi ta cần: "hai bảng này đã nối được
 * với nhau chưa".
 */

export interface Edge {
  left: number;
  right: number;
}

class UnionFind {
  private readonly parent = new Map<number, number>();

  find(x: number): number {
    let root = this.parent.get(x) ?? x;
    if (root === x) return x;

    // Nén đường đi bằng vòng lặp, không đệ quy.
    const path: number[] = [];
    let current = x;
    while (root !== current) {
      path.push(current);
      current = root;
      root = this.parent.get(current) ?? current;
    }
    for (const node of path) this.parent.set(node, root);
    return root;
  }

  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }

  connected(a: number, b: number): boolean {
    return this.find(a) === this.find(b);
  }
}

/**
 * Thêm cạnh này có tạo ra đường nối thứ hai không.
 *
 * `true` = phải từ chối.
 */
export function wouldCreateCycle(existing: readonly Edge[], candidate: Edge): boolean {
  const uf = new UnionFind();
  for (const edge of existing) uf.union(edge.left, edge.right);
  return uf.connected(candidate.left, candidate.right);
}

/**
 * Cạnh y hệt đã tồn tại chưa — KHÔNG phân biệt chiều.
 *
 * Nối A→B rồi nối B→A là cùng một quan hệ nhìn từ hai phía, và cho phép cả hai
 * sẽ sinh ra hai `joins` mô tả cùng một phép nối.
 */
export function isDuplicate(existing: readonly Edge[], candidate: Edge): boolean {
  return existing.some(
    (edge) =>
      (edge.left === candidate.left && edge.right === candidate.right) ||
      (edge.left === candidate.right && edge.right === candidate.left),
  );
}
