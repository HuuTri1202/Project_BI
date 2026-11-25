import {
  FILTER_OPERATORS,
  FILTER_OPERATORS_NO_VALUE,
  FILTER_OPERATOR_LABELS,
  type ExplorerFieldDto,
  type ExplorerFilterDto,
  type FilterOperator,
} from '@bi/shared';

import { PanelTitle } from './controls';

/**
 * Điều kiện LỌC của một ô biểu đồ — §B1.
 *
 * ═══ Vì sao nó phải có ═══════════════════════════════════════════════════
 *
 * Trước bản này mọi ô là "toàn bộ dữ liệu, toàn bộ thời gian". Chủ một quán cà
 * phê không dựng được "Doanh thu tháng này", "Chỉ chi nhánh Quận 1" hay "Quý
 * 4" — tức là không dựng được phần lớn câu hỏi người ta thật sự hỏi. Explorer
 * và khung hỏi đáp đã lọc được từ lâu; chỉ thứ được LƯU lại thì không.
 *
 * ═══ Ô nhập GIÁ TRỊ đọc theo kiểu cột, và đó không phải trang trí ═════════
 *
 * Cube so sánh ngày bằng chuỗi ISO (`2026-10-01`). Một người Việt gõ tay sẽ gõ
 * `01/10/2026`, và điều kiện đó KHÔNG khớp dòng nào — biểu đồ trắng, không lỗi,
 * không dấu hiệu. `<input type="date">` của trình duyệt hiện theo ngôn ngữ máy
 * nhưng trả về đúng ISO, nên cái bẫy ấy không còn chỗ để xảy ra.
 */
export function BoLoc({
  filters,
  dimensions,
  onChange,
}: {
  filters: readonly ExplorerFilterDto[];
  dimensions: ExplorerFieldDto[];
  onChange: (filters: ExplorerFilterDto[]) => void;
}): React.ReactElement | null {
  // Mô hình chưa có chiều nào thì không có gì để lọc theo.
  if (dimensions.length === 0) return null;

  const dau = dimensions[0];
  if (dau === undefined) return null;

  const sua = (i: number, patch: Partial<ExplorerFilterDto>): void =>
    onChange(filters.map((f, k) => (k === i ? { ...f, ...patch } : f)));

  const them = (): void =>
    onChange([...filters, { dimensionId: dau.id, operator: 'equals', values: [''] }]);

  const bo = (i: number): void => onChange(filters.filter((_, k) => k !== i));

  return (
    <div className="space-y-2">
      <PanelTitle>Bộ lọc</PanelTitle>

      {filters.map((f, i) => {
        const chieu = dimensions.find((d) => d.id === f.dimensionId);
        const canGiaTri = !FILTER_OPERATORS_NO_VALUE.includes(f.operator);
        const laNgay = chieu?.cubeType === 'time';

        return (
          <div
            // Chỉ số làm khoá: danh sách này không sắp xếp lại, và hai điều kiện
            // giống hệt nhau là hợp lệ (`bằng A` hai lần thì vẫn là một câu hỏi
            // đúng, chỉ thừa) nên không có khoá tự nhiên nào khác.
            key={i}
            className="space-y-1.5 rounded-lg border border-slate-200 p-2"
          >
            <div className="flex items-center gap-1.5">
              <select
                aria-label="Trường để lọc"
                value={String(f.dimensionId)}
                onChange={(e) => sua(i, { dimensionId: Number(e.target.value) })}
                className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
              >
                {dimensions.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => bo(i)}
                aria-label={`Bỏ điều kiện ${String(i + 1)}`}
                title="Bỏ điều kiện"
                className="shrink-0 rounded-lg px-2 py-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              >
                ✕
              </button>
            </div>

            <div className="flex items-center gap-1.5">
              <select
                aria-label="Phép so sánh"
                value={f.operator}
                onChange={(e) => {
                  const op = e.target.value as FilterOperator;
                  // `set`/`notSet` KHÔNG nhận giá trị — backend từ chối cả câu
                  // nếu còn sót. Dọn ngay lúc đổi, không đợi lúc lưu.
                  sua(i, {
                    operator: op,
                    values: FILTER_OPERATORS_NO_VALUE.includes(op) ? [] : (f.values ?? ['']),
                  });
                }}
                className="w-32 shrink-0 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
              >
                {FILTER_OPERATORS.map((op) => (
                  <option key={op} value={op}>
                    {FILTER_OPERATOR_LABELS[op]}
                  </option>
                ))}
              </select>

              {canGiaTri && (
                <input
                  aria-label="Giá trị"
                  type={laNgay ? 'date' : 'text'}
                  value={f.values[0] ?? ''}
                  onChange={(e) => sua(i, { values: [e.target.value] })}
                  placeholder={laNgay ? '' : 'Giá trị…'}
                  className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
                />
              )}
            </div>
          </div>
        );
      })}

      <button
        type="button"
        onClick={them}
        className="w-full rounded-lg border border-dashed border-slate-300 px-2 py-1.5 text-xs font-medium text-slate-600 hover:border-brand-400 hover:text-brand-700"
      >
        + Thêm điều kiện
      </button>

      <p className="text-xs leading-snug text-slate-500">
        {filters.length === 0
          ? 'Chưa lọc gì: ô này đang vẽ toàn bộ dữ liệu.'
          : 'Chỉ những dòng thoả MỌI điều kiện mới vào ô này. Các ô khác không bị ảnh hưởng.'}
      </p>
    </div>
  );
}
