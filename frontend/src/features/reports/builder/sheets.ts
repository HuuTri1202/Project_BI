import type { ExplorerFieldDto } from '@bi/shared';

import type { FieldKind } from './dnd';

/**
 * Gom trường của mô hình theo BẢNG — §10.10.
 *
 * File riêng, không nằm trong `FieldsPanel`: một module vừa xuất component vừa
 * xuất hàm thuần thì mất hot-reload (`react-refresh/only-export-components`).
 * Và tách ra thì khoá được bằng test, mà thứ tự ở đây đáng khoá — xem dưới.
 */

/** Một bảng trong mô hình, cùng mọi trường của nó. */
export interface Sheet {
  name: string;
  fields: { field: ExplorerFieldDto; kind: FieldKind }[];
}

/**
 * Gom theo bảng, giữ THỨ TỰ XUẤT HIỆN.
 *
 * Không sắp theo bảng chữ cái: thứ tự trong mô hình là thứ tự người dùng thêm
 * bảng vào, nên bảng chính (đơn hàng, doanh thu) thường đứng trước bảng tra cứu
 * — đúng thứ tự họ sẽ tìm.
 *
 * Trong một bảng thì cột đứng trước, trường đã gộp sẵn đứng sau. KHÔNG phải để
 * chia lại theo vai trò — bảng trường đã thôi làm điều đó — mà vì trường gộp là
 * thứ DỰNG TRÊN các cột ấy, nên đọc cột trước rồi tới thứ tính từ chúng là thứ
 * tự tự nhiên.
 *
 * Một bảng chỉ có trường gộp mà không có cột nào vẫn phải hiện ra: chuyện đó
 * xảy ra khi mọi cột của bảng bị đặt `hidden`, và để bảng biến mất thì thước đo
 * của nó cũng biến mất theo mà không có gì giải thích.
 */
export function groupBySheet(
  dimensions: readonly ExplorerFieldDto[],
  measures: readonly ExplorerFieldDto[],
): Sheet[] {
  const sheets = new Map<string, Sheet>();

  const push = (field: ExplorerFieldDto, kind: FieldKind): void => {
    const name = field.datasetName;
    const sheet = sheets.get(name) ?? { name, fields: [] };
    sheet.fields.push({ field, kind });
    sheets.set(name, sheet);
  };

  for (const field of dimensions) push(field, 'dimension');
  for (const field of measures) push(field, 'measure');

  return [...sheets.values()];
}

/**
 * Lọc theo từ khoá, rồi BỎ những bảng không còn trường nào.
 *
 * Một tên bảng không có gì bên dưới chỉ làm danh sách kết quả dài ra mà không
 * mang tin gì.
 */
export function filterSheets(sheets: readonly Sheet[], query: string): Sheet[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [...sheets];

  return sheets
    .map((sheet) => ({
      ...sheet,
      fields: sheet.fields.filter(
        ({ field }) =>
          field.label.toLowerCase().includes(needle) ||
          field.datasetName.toLowerCase().includes(needle),
      ),
    }))
    .filter((sheet) => sheet.fields.length > 0);
}
