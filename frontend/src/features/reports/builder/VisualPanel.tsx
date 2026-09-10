import {
  CHART_SERIES_SUPPORT,
  CHART_SORTS,
  CHART_SORT_LABELS,
  CHART_STACKABLE,
  CHART_TYPE_HINTS,
  CHART_TYPE_LABELS,
  CHART_VALUE_LABELS,
  GROUP_OVERFLOW_LABELS,
  GROUP_OVERFLOWS,
  GROUP_PICK_LABELS,
  GROUP_PICKS,
  VISUAL_TITLE_MAX,
  type ChartSort,
  type ExplorerFieldDto,
  type GroupOverflow,
  type GroupPick,
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
   * Bảng màu có ĐỔI được gì trên biểu đồ này không.
   *
   * Một biểu đồ cột một chuỗi tô đúng một màu, nên chọn bảng nào cũng ra hình
   * y hệt — người dùng bấm thử ba dòng, không thấy gì đổi, rồi kết luận bộ chọn
   * hỏng. Bản đồ nhiệt cũng vậy nhưng vì lý do khác: màu ở đó là ĐỘ ĐẬM của
   * con số, một thang liên tục, không phải bảng phân loại.
   */
  const paletteMatters =
    draft.chartType === 'pie' || (draft.chartType !== 'heatmap' && chosenSeries !== null);

  /** Chia trang: cùng ba ô chọn, nhưng chúng đọc ra một câu khác hẳn. */
  const paged = draft.overflow === 'pages';

  const drop = (slot: 'dimension' | 'measure' | 'series', field: DragField): void => {
    const patch = assignField(draft, slot, field);
    if (patch !== null) onChange(patch);
  };

  const setOption = (patch: Partial<VisualDraft['options']>): void =>
    onChange({ options: { ...draft.options, ...patch } });

  return (
    <div className="space-y-5">
      <div>
        <PanelTitle>Biểu đồ</PanelTitle>
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

        {/* Ba ô đi CÙNG NHAU và phải đọc được như MỘT CÂU, theo đúng thứ tự này:
            "20 nhóm mỗi trang, chia trang, bắt đầu từ nhóm lớn nhất". Tách
            "bao nhiêu" khỏi "phần thừa đi đâu" khỏi "đầu hay cuối bảng" ra ba
            chỗ khác nhau trong bảng là để người dùng đọc được một phần ba câu. */}
        <Choice
          label={paged ? 'Số nhóm mỗi trang' : 'Số nhóm tối đa'}
          value={String(draft.limit)}
          onChange={(v) => onChange({ limit: Number(v) })}
          options={LIMIT_CHOICES.map((n) => ({ value: String(n), label: `${n} nhóm` }))}
        />

        <Choice
          label="Khi còn nhóm chưa hiện"
          value={draft.overflow}
          onChange={(v) => onChange({ overflow: v as GroupOverflow })}
          options={GROUP_OVERFLOWS.map((o) => ({ value: o, label: GROUP_OVERFLOW_LABELS[o] }))}
          hint={
            paged
              ? 'Không nhóm nào bị giấu — vì vậy cũng không còn cột “Khác”, kể cả ở trang đầu.'
              : 'Một cột duy nhất cho tất cả phần còn lại. Chỉ gộp được khi phép tính cộng được; tỉ lệ, trung bình hay biểu đồ có chiều thứ hai sẽ tự chia trang thay vì bỏ mất phần thừa.'
          }
        />

        <Choice
          label={paged ? 'Trang đầu bắt đầu từ' : 'Giữ lại nhóm nào'}
          value={draft.pick}
          onChange={(v) => onChange({ pick: v as GroupPick })}
          options={GROUP_PICKS.map((p) => ({ value: p, label: GROUP_PICK_LABELS[p] }))}
          hint={
            paged
              ? `Xếp hạng theo ${chosenMeasure?.label ?? 'thước đo'}; hai nút ‹ › đi tiếp theo đúng thứ hạng đó.`
              : draft.seriesId !== null && seriesUsed(draft) !== null
                ? `Xếp hạng theo ${chosenMeasure?.label ?? 'thước đo'}. Có chiều thứ hai thì phần bị cắt KHÔNG gộp thành “Khác” — chia nó cho từng chuỗi là bịa ra số.`
                : `Xếp hạng theo ${chosenMeasure?.label ?? 'thước đo'}.`
          }
        />

        {/* Nhãn đọc từ `CHART_SORT_LABELS`, danh sách đọc từ `CHART_SORTS` — thêm
            một cách sắp là sửa đúng một chỗ ở `shared`, và ô chọn với bộ kiểm
            của backend không thể lệch nhau. */}
        <Choice
          label="Sắp xếp trục"
          value={draft.options.sort}
          onChange={(v) => setOption({ sort: v as ChartSort })}
          options={CHART_SORTS.map((s) => ({ value: s, label: CHART_SORT_LABELS[s] }))}
          hint={
            draft.options.sort !== 'value-asc' || draft.pick !== 'top'
              ? undefined
              : paged
                ? 'Chỉ sắp lại những nhóm của TRANG NÀY — đây vẫn là các nhóm lớn nhất, xếp ngược. Muốn nhóm nhỏ nhất trước thì đổi “Trang đầu bắt đầu từ”.'
                : 'Chỉ sắp lại những nhóm đang hiện — đây là các nhóm LỚN nhất xếp ngược. Muốn đúng các nhóm nhỏ nhất thì đổi “Giữ lại nhóm nào”.'
          }
        />

        <PaletteChoice
          label="Bảng màu"
          value={draft.options.palette}
          onChange={(palette) => setOption({ palette })}
          hint={
            paletteMatters
              ? undefined
              : draft.chartType === 'heatmap'
                ? 'Bản đồ nhiệt tô theo ĐỘ ĐẬM của con số, không theo bảng phân loại.'
                : 'Biểu đồ một chuỗi chỉ dùng một màu. Bảng màu có tác dụng khi ô Nhóm màu có một chiều, hoặc với biểu đồ tròn.'
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
