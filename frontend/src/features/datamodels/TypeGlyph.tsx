import type { ExplorerFieldDto } from '@bi/shared';

import type { LoaiTruong } from './sheets';

/**
 * Ký hiệu kiểu dữ liệu, đọc trong nửa giây.
 *
 * Cùng quy ước với mọi công cụ BI: `#` là số, `T` là chữ, lịch là thời gian.
 * Thước đo dùng ký hiệu tổng `Σ` chứ không dùng kiểu của cột nó gộp — cái người
 * dùng cần phân biệt ở đây là "cái này ra một con số đã gộp" chứ không phải
 * "cột gốc là Float64".
 *
 * Từ khi hai bộ chọn trường thôi chia theo vai trò, ký hiệu này là chỗ DUY NHẤT
 * còn nói được trường nào đã gộp sẵn — nên nó không còn là trang trí. Dùng chung
 * giữa bảng trường của trình dựng và bộ chọn của tab Explorer: hai bảng ký hiệu
 * khác nhau cho cùng một mô hình là hai thứ người dùng phải học riêng.
 */
export function TypeGlyph({
  field,
  kind,
}: {
  field: ExplorerFieldDto;
  kind: LoaiTruong;
}): React.ReactElement {
  const text =
    kind === 'measure'
      ? 'Σ'
      : field.cubeType === 'number'
        ? '#'
        : field.cubeType === 'time'
          ? '📅'
          : field.cubeType === 'boolean'
            ? '✓'
            : 'T';

  return (
    <span
      aria-hidden="true"
      className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center text-xs font-semibold text-slate-400"
    >
      {text}
    </span>
  );
}
