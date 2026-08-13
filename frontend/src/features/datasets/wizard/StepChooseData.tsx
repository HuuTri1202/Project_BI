import type { AnalyzeResultDto, SheetPreviewDto } from '@bi/shared';
import { useMemo, useState } from 'react';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';

/**
 * Bước 2 — chọn dữ liệu cần nhập (§7.5).
 *
 * ─── Mỗi sheet được tích là MỘT bộ dữ liệu riêng ────────────────────────────
 *
 * Đây là điều khiến màn hình này không phải một ô chọn sheet thông thường:
 * người dùng đang chọn sẽ sinh ra bao nhiêu bộ dữ liệu, chứ không phải đang xem
 * sheet nào. Nhãn nút ở chân wizard nói rõ con số đó.
 *
 * ─── Hai vai trò tách bạch của một dòng ─────────────────────────────────────
 *
 *   Ô tích      quyết định sheet có được NHẬP không.
 *   Bấm tên     chỉ mở bảng XEM TRƯỚC ở dưới, không đổi lựa chọn.
 *
 * Gộp hai việc vào một cú bấm thì xem thử một sheet là vô tình tích nó, và
 * người dùng không có cách nào xem mà không chọn.
 */

interface Props {
  analysis: AnalyzeResultDto;
  selected: string[];
  onChange: (sheets: string[]) => void;
}

export function StepChooseData({ analysis, selected, onChange }: Props): React.ReactElement {
  const [search, setSearch] = useState('');
  const [focused, setFocused] = useState(analysis.sheets[0]?.name ?? '');

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (term === '') return analysis.sheets;
    return analysis.sheets.filter((s) => s.name.toLowerCase().includes(term));
  }, [analysis.sheets, search]);

  const preview = analysis.sheets.find((s) => s.name === focused) ?? visible[0];

  function toggle(name: string): void {
    onChange(
      selected.includes(name) ? selected.filter((s) => s !== name) : [...selected, name],
    );
  }

  /**
   * "Chọn tất cả" chỉ tác động lên những sheet ĐANG HIỆN.
   *
   * Đang lọc còn 3 sheet mà bấm rồi tích luôn 40 sheet khuất là một bất ngờ khó
   * chịu, và người dùng sẽ không nhận ra cho tới khi thấy 40 bộ dữ liệu.
   */
  function toggleVisible(check: boolean): void {
    const names = visible.map((s) => s.name);
    onChange(
      check
        ? [...new Set([...selected, ...names])]
        : selected.filter((s) => !names.includes(s)),
    );
  }

  const allVisibleChecked =
    visible.length > 0 && visible.every((s) => selected.includes(s.name));

  return (
    <div>
      {analysis.truncated && (
        // Cắt âm thầm rồi để người ta tin vào một biểu đồ thiếu phần lớn dữ liệu
        // là kiểu sai tệ nhất trong sản phẩm BI. Nói ngay từ đây.
        <p className="mb-4 rounded-lg bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800">
          File có nhiều hơn {analysis.maxRows.toLocaleString('vi-VN')} dòng. Hệ thống chỉ nhập{' '}
          {analysis.maxRows.toLocaleString('vi-VN')} dòng đầu của mỗi sheet.
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-[20rem_1fr]">
        <div className="min-w-0">
          <label htmlFor="sheet-search" className="mb-1.5 block text-sm font-medium text-slate-700">
            Tìm sheet
          </label>
          <input
            id="sheet-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tên sheet…"
            className="block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-slate-900 shadow-sm outline-none placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
          />

          <div className="mt-2 flex items-center justify-between">
            <span className="text-xs text-slate-500">
              {selected.length}/{analysis.sheets.length} sheet được chọn
            </span>
            {visible.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => toggleVisible(!allVisibleChecked)}>
                {allVisibleChecked ? 'Bỏ chọn' : 'Chọn tất cả'}
              </Button>
            )}
          </div>

          <ul className="mt-2 max-h-80 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-1.5">
            {visible.length === 0 && (
              <li className="px-3 py-6 text-center text-sm text-slate-500">
                Không có sheet nào khớp “{search}”.
              </li>
            )}

            {visible.map((sheet) => {
              const checked = selected.includes(sheet.name);
              const isFocused = preview?.name === sheet.name;

              return (
                <li key={sheet.name}>
                  <div
                    className={`flex items-start gap-2.5 rounded-lg px-2.5 py-2 transition-colors ${
                      isFocused ? 'bg-brand-50 ring-1 ring-brand-200' : 'hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      id={`sheet-${sheet.name}`}
                      checked={checked}
                      onChange={() => toggle(sheet.name)}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                    />
                    <label htmlFor={`sheet-${sheet.name}`} className="sr-only">
                      Nhập sheet {sheet.name}
                    </label>
                    <button
                      type="button"
                      onClick={() => setFocused(sheet.name)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="block truncate text-sm font-medium text-slate-900">
                        {sheet.name}
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-500">
                        {sheet.columns.length} cột · {sheet.rowCount.toLocaleString('vi-VN')} dòng
                      </span>
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="min-w-0">
          {preview ? (
            <SheetPreview sheet={preview} previewRowLimit={analysis.previewRowLimit} />
          ) : (
            <p className="text-sm text-slate-500">Chọn một sheet để xem trước.</p>
          )}
        </div>
      </div>

      {selected.length === 0 && (
        <p role="alert" className="mt-4 text-sm text-red-700">
          Hãy tích ít nhất một sheet để nhập.
        </p>
      )}
    </div>
  );
}

function SheetPreview({
  sheet,
  previewRowLimit,
}: {
  sheet: SheetPreviewDto;
  previewRowLimit: number;
}): React.ReactElement {
  const shown = Math.min(sheet.previewRows.length, previewRowLimit);

  return (
    <div className="min-w-0">
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <h3 className="text-sm font-semibold text-slate-900">{sheet.name}</h3>
        {/* Dòng tóm tắt của §7.5. Câu "đang xem N dòng đầu" là phần bắt buộc:
            không có nó, người dùng thấy 100 dòng rồi tin rằng hệ thống chỉ nhập
            chừng đó, trong khi thực tế nhập tới 50.000. */}
        <p className="text-xs text-slate-500">
          {sheet.columns.length} cột · {sheet.rowCount.toLocaleString('vi-VN')} dòng · đang xem{' '}
          {shown.toLocaleString('vi-VN')} dòng đầu
        </p>
      </div>

      <div className="max-h-80 overflow-auto rounded-xl border border-slate-200">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-slate-50 text-left">
            <tr className="border-b border-slate-200">
              {sheet.columns.map((column) => (
                <th
                  key={column.columnIndex}
                  scope="col"
                  className="px-3 py-2 whitespace-nowrap"
                >
                  <span className="block font-medium text-slate-700">
                    {column.sourceName || `Cột ${column.columnIndex + 1}`}
                  </span>
                  <span className="mt-0.5 block">
                    <Badge tone="neutral">{TYPE_LABELS[column.semanticType]}</Badge>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sheet.previewRows.slice(0, previewRowLimit).map((row, rowIndex) => (
              <tr key={rowIndex}>
                {sheet.columns.map((column) => (
                  <td
                    key={column.columnIndex}
                    className="max-w-[16rem] truncate px-3 py-1.5 text-slate-600"
                  >
                    {row[column.columnIndex] ?? ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const TYPE_LABELS: Record<string, string> = {
  text: 'Chữ',
  number: 'Số',
  date: 'Ngày',
  boolean: 'Đúng/Sai',
};
