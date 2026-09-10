import {
  CHART_SERIES_SUPPORT,
  CHART_SORTS,
  CHART_SORT_LABELS,
  CHART_STACKABLE,
  CHART_TYPE_HINTS,
  CHART_TYPE_LABELS,
  CHART_VALUE_LABELS,
  VISUAL_TITLE_MAX,
  type ChartSort,
  type ExplorerFieldDto,
} from '@bi/shared';

import { CHART_CHOICES } from '../chartCatalog';
import { Choice, PaletteChoice, PanelTitle, Shelf, Toggle } from './controls';
import type { DragField } from './dnd';
import { moTaCua } from './fieldText';
import { assignField, LIMIT_CHOICES, seriesUsed, type VisualDraft } from './visual';

/**
 * Bảng cấu hình của MỘT ô — §10.9, thu hẹp phạm vi ở §10.10.
 *
 * Tới §10.9 đây là "cấu hình của báo cáo", vì báo cáo chỉ có một biểu đồ. Từ
 * §10.10 nó là cấu hình của ô ĐANG CHỌN, và đổi ở đây chỉ đụng đúng ô đó.
 *
 * Không giữ state riêng: mọi thay đổi đi ra qua `onChange` rồi quay lại thành
 * `draft` mới. Một bản sao cục bộ ở đây sẽ lệch ngay khi người dùng chọn sang ô
 * khác — bảng vẫn hiện lựa chọn của ô cũ trong khi khung đã tô sáng ô mới.
 */
export function VisualPanel({
  draft,
  dimensions,
  measures,
  dragging,
  onChange,
}: {
  draft: VisualDraft;
  dimensions: ExplorerFieldDto[];
  measures: ExplorerFieldDto[];
  dragging: DragField | null;
  onChange: (patch: Partial<VisualDraft>) => void;
}): React.ReactElement {
  const support = CHART_SERIES_SUPPORT[draft.chartType];
  const series = seriesUsed(draft);

  const chosenDimension = dimensions.find((f) => f.id === draft.dimensionId) ?? null;
  const chosenMeasure = measures.find((f) => f.id === draft.measureId) ?? null;
  const chosenSeries = dimensions.find((f) => f.id === series) ?? null;

  /*
   * Bảng màu dùng CẢ DÃY, hay chỉ dùng màu đầu tiên — §10.15.
   *
   * Trước bản này câu hỏi là "bảng màu có tác dụng không", và với biểu đồ một
   * chuỗi câu trả lời là KHÔNG: nó tô bằng màu thương hiệu bất kể người dùng
   * chọn gì. Người dùng bấm thử từng dòng, không thấy gì đổi, rồi kết luận bộ
   * chọn hỏng — và họ đúng.
   *
   *   "phần bảng màu chỉ hiển thị bấm được với các biểu đồ có thể điều chỉnh
   *    biểu đồ thôi, chứ như biểu đồ cột lại ko thể thay đổi bảng màu"
   *
   * Giờ mọi loại đều nghe theo bảng màu (xem `markColorFor` trong `chartSpec`),
   * nên câu hỏi còn lại chỉ là dùng bao nhiêu màu trong dãy — và câu chú thích
   * bên dưới nói ra điều đó thay vì xin lỗi cho một ô chọn không làm gì.
   */
  const caDay =
    draft.chartType === 'pie' || (draft.chartType !== 'heatmap' && chosenSeries !== null);

  const drop = (slot: 'dimension' | 'measure' | 'series', field: DragField): void => {
    const patch = assignField(draft, slot, field);
    if (patch !== null) onChange(patch);
  };

  const setOption = (patch: Partial<VisualDraft['options']>): void =>
    onChange({ options: { ...draft.options, ...patch } });

  return (
    <div className="space-y-5">
      <div>
        <PanelTitle>Loại biểu đồ</PanelTitle>
        <div className="mt-2 grid grid-cols-4 gap-1.5">
          {CHART_CHOICES.map((choice) => (
            <button
              key={choice.type}
              type="button"
              onClick={() => onChange({ chartType: choice.type })}
              aria-pressed={draft.chartType === choice.type}
              title={`${choice.label} — ${choice.hint}`}
              className={`flex aspect-square items-center justify-center rounded-lg border transition-colors ${
                draft.chartType === choice.type
                  ? 'border-brand-600 bg-brand-50 text-brand-700'
                  : 'border-slate-200 text-slate-500 hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              {choice.icon}
              <span className="sr-only">{choice.label}</span>
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs leading-snug text-slate-500">
          <span className="font-medium text-slate-700">{CHART_TYPE_LABELS[draft.chartType]}</span> —{' '}
          {CHART_TYPE_HINTS[draft.chartType]}
        </p>
      </div>

      <div className="space-y-2">
        <PanelTitle>Ô thả</PanelTitle>
        <Shelf
          label={draft.chartType === 'pie' ? 'Lát cắt' : 'Trục'}
          hint="Chiều để chia nhóm"
          accepts="dimension"
          field={chosenDimension}
          dragging={dragging}
          onAssign={(f) => drop('dimension', f)}
          onClear={() => onChange({ dimensionId: null })}
        />
        <Shelf
          label="Giá trị"
          hint="Thước đo để đo"
          accepts="measure"
          field={chosenMeasure}
          dragging={dragging}
          onAssign={(f) => drop('measure', f)}
          onClear={() => onChange({ measureId: null })}
          describe={moTaCua}
        />
        <Shelf
          label="Nhóm màu"
          hint={
            support === 'required'
              ? 'Chiều thứ hai — bắt buộc với loại này'
              : 'Chiều thứ hai, tách thành nhiều chuỗi'
          }
          accepts="dimension"
          field={chosenSeries}
          dragging={dragging}
          onAssign={(f) => drop('series', f)}
          onClear={() => onChange({ seriesId: null })}
          disabledReason={
            support === 'no'
              ? `${CHART_TYPE_LABELS[draft.chartType]} đã dùng màu để phân từng phần.`
              : undefined
          }
        />
      </div>

      <div className="space-y-3">
        <PanelTitle>Định dạng</PanelTitle>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-700">Tiêu đề ô</span>
          <input
            type="text"
            value={draft.title}
            onChange={(e) => onChange({ title: e.target.value })}
            maxLength={VISUAL_TITLE_MAX}
            placeholder={
              chosenMeasure !== null && chosenDimension !== null
                ? `${chosenMeasure.label} theo ${chosenDimension.label}`
                : 'Tự đặt theo chiều và thước đo'
            }
            className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
          />
          {/* Ô rỗng KHÔNG phải chưa đặt tên — nó là "để hệ thống tự đặt". Nói
              rõ, vì placeholder mờ trông y hệt một ô bị bỏ quên. */}
          <span className="mt-1 block text-xs leading-snug text-slate-500">
            Để trống thì ô tự lấy tên theo thước đo và chiều.
          </span>
        </label>

        {/* ─── Hai ô, không phải bốn — §10.15 ────────────────────────────
            Tới §10.14 chỗ này có bốn ô chọn nói về cùng một chuyện: bao nhiêu
            nhóm, phần thừa đi đâu, giữ đầu nào của bảng xếp hạng, xếp trục ra
            sao. Người dùng bảo bỏ hai ô giữa đi — và họ đúng: phần thừa giờ
            luôn sang trang sau, còn "giữ đầu nào" thì chính ô "Sắp xếp" đã
            nói rồi. Xem `pickOf` trong `visual.ts`. */}
        <Choice
          label="Số nhóm mỗi trang"
          value={String(draft.limit)}
          onChange={(v) => onChange({ limit: Number(v) })}
          options={LIMIT_CHOICES.map((n) => ({ value: String(n), label: `${n} nhóm` }))}
          hint="Không nhóm nào bị bỏ đi: phần vượt nằm ở trang sau, mở bằng hai nút ‹ › dưới góc phải ô."
        />

        {/* Nhãn đọc từ `CHART_SORT_LABELS`, danh sách đọc từ `CHART_SORTS` — thêm
            một cách sắp là sửa đúng một chỗ ở `shared`, và ô chọn với bộ kiểm
            của backend không thể lệch nhau. */}
        <Choice
          label="Sắp xếp"
          value={draft.options.sort}
          onChange={(v) => setOption({ sort: v as ChartSort })}
          options={CHART_SORTS.map((s) => ({ value: s, label: CHART_SORT_LABELS[s] }))}
          hint={sapXepHint(draft.options.sort, draft.limit, chosenMeasure?.label)}
        />

        <PaletteChoice
          label="Bảng màu"
          value={draft.options.palette}
          onChange={(palette) => setOption({ palette })}
          hint={
            caDay
              ? undefined
              : draft.chartType === 'heatmap'
                ? 'Bản đồ nhiệt tô theo ĐỘ ĐẬM của con số: thang màu chạy từ nhạt tới MÀU ĐẦU TIÊN của bảng.'
                : 'Biểu đồ một chuỗi dùng MÀU ĐẦU TIÊN của bảng. Thả một chiều vào ô Nhóm màu thì cả dãy được dùng.'
          }
        />

        <Toggle
          label="Hiện chú giải"
          checked={draft.options.showLegend}
          onChange={(v) => setOption({ showLegend: v })}
          disabledReason={
            chosenSeries === null && draft.chartType !== 'pie' && draft.chartType !== 'heatmap'
              ? 'Chỉ có một chuỗi nên không có gì để chú giải.'
              : undefined
          }
        />

        <Toggle
          label="Xếp chồng các chuỗi"
          checked={draft.options.stacked}
          onChange={(v) => setOption({ stacked: v })}
          disabledReason={
            chosenSeries === null
              ? 'Cần một chiều ở ô Nhóm màu thì mới có gì để chồng.'
              : !CHART_STACKABLE.includes(draft.chartType)
                ? `${CHART_TYPE_LABELS[draft.chartType]} không xếp chồng được.`
                : undefined
          }
        />

        <Toggle
          label="In số lên biểu đồ"
          checked={draft.options.showValues}
          onChange={(v) => setOption({ showValues: v })}
          disabledReason={
            CHART_VALUE_LABELS.includes(draft.chartType)
              ? undefined
              : `${CHART_TYPE_LABELS[draft.chartType]} có các điểm quá sát nhau, chữ sẽ đè lên nhau.`
          }
        />
      </div>
    </div>
  );
}

/**
 * Câu chú thích dưới ô "Sắp xếp".
 *
 * Ô này làm HAI việc khác nhau tuỳ lựa chọn, và người dùng có quyền biết mình
 * đang dùng việc nào:
 *
 *   theo giá trị  đổi cả CÂU HỎI gửi xuống Cube — "nhỏ → lớn" xin đúng các
 *                 nhóm nhỏ nhất, chứ không xếp ngược một tập đã cắt.
 *   theo tên      chỉ đổi thứ tự trên trục. Các trang vẫn đi theo thước đo,
 *                 vì "trang 2 theo bảng chữ cái" là một câu hỏi khác.
 *
 * Trước §10.15 chỗ này phải in ra một lời đính chính ("đây vẫn là các nhóm lớn
 * nhất, xếp ngược") vì ô chọn nói một đằng còn dữ liệu một nẻo. Giờ nó chỉ còn
 * nói ra thứ đang xảy ra.
 */
function sapXepHint(
  sort: ChartSort,
  limit: number,
  measure: string | undefined,
): string | undefined {
  const thuocDo = measure ?? 'thước đo';
  if (sort === 'value-asc') return `Trang 1 là ${limit} nhóm NHỎ NHẤT theo ${thuocDo}.`;
  if (sort === 'value') return undefined;
  return `Xếp theo tên trong phạm vi trang này; các trang vẫn đi theo thứ hạng của ${thuocDo}.`;
}
