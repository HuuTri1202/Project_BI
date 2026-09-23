import { moTaThuocDo, type ExplorerFieldDto, type MeasureAgg } from '@bi/shared';

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
export function moTaCua(field: ExplorerFieldDto, agg?: MeasureAgg | null): string | null {
  if (field.nguon === undefined || field.agg === undefined) return null;
  // `agg` là phép ô này CHỌN LẠI; vắng mặt thì dùng phép mô hình khai. Cùng quy
  // ước với tab Explorer, và phải dựng lại ở thời điểm render chứ không lấy một
  // câu backend nướng sẵn — xem ghi chú ở `MeasureSourceDto`.
  return moTaThuocDo(field.nguon, agg ?? field.agg, field.datasetName);
}
