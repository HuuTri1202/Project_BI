import { moTaThuocDo, type ExplorerFieldDto } from '@bi/shared';

/**
 * Câu chữ mô tả một trường — §10.9.
 *
 * File riêng vì cả `FieldsPanel` lẫn `controls` đều cần, và vì trộn hàm thuần
 * vào một module component làm module đó mất hot-reload.
 */

/**
 * "Tổng của Total amount" — phép tính đứng dưới tên thước đo.
 *
 * Cùng câu mà tab Explorer hiện, dựng bằng cùng `moTaThuocDo`. Thước đo gieo sẵn
 * trùng tên với cột nó gộp, nên thiếu dòng này thì "Total amount" trong bảng
 * trường và "Total amount" của một đơn hàng là hai dòng chữ y hệt nhau.
 */
export function moTaCua(field: ExplorerFieldDto): string | null {
  if (field.nguon === undefined || field.agg === undefined) return null;
  return moTaThuocDo(field.nguon, field.agg, field.datasetName);
}

/** "Global-Superstore · Orders" → "Orders". Tên mô hình đã ở tiêu đề trang. */
export function shortName(datasetName: string): string {
  return datasetName.split(' · ').pop() ?? datasetName;
}
