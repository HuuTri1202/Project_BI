/**
 * Kéo thả một TRƯỜNG từ bảng mô hình vào một ô thả — §10.9, dùng lại ở §10.10.
 *
 * Tách khỏi trang vì từ §10.10 có hai bên cùng cần: bảng trường (bên gửi) và
 * bảng cấu hình của ô đang chọn (bên nhận) nay nằm ở hai file khác nhau.
 */

/** Kiểu dữ liệu kéo đi, cũng là chìa khoá để ô thả biết mình có nhận được không. */
export const DND_MIME = 'application/x-bi-field';

export type FieldKind = 'dimension' | 'measure';

export interface DragField {
  kind: FieldKind;
  id: number;
}

/**
 * Dữ liệu kéo thả tới từ NGOÀI ứng dụng cũng rơi vào đây.
 *
 * Thả một file hay một đoạn chữ từ tab khác vào ô thả sẽ cho một chuỗi không
 * phải JSON. `JSON.parse` ném lỗi, mà lỗi trong handler `drop` thì không ai
 * bắt — nó nổi lên console và ô thả im lặng không làm gì. Trả `null` để nhánh
 * gọi rơi về `dragging`, vốn chỉ có giá trị khi cú kéo bắt đầu từ bảng trường.
 */
export function safeParse(raw: string): DragField | null {
  try {
    const value = JSON.parse(raw) as Partial<DragField>;
    if (typeof value.id !== 'number') return null;
    if (value.kind !== 'dimension' && value.kind !== 'measure') return null;
    return { kind: value.kind, id: value.id };
  } catch {
    return null;
  }
}
