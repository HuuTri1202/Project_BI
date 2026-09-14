import {
  CHART_PALETTE_COLORS,
  CHART_PALETTE_HINTS,
  CHART_PALETTE_LABELS,
  CHART_PALETTES,
  COLUMN_ROLE_TERMS,
  type ChartPalette,
  type ExplorerFieldDto,
} from '@bi/shared';
import { useState } from 'react';

import { DND_MIME, safeParse, type DragField, type FieldKind } from './dnd';
import { shortName } from './fieldText';

/**
 * Những mảnh giao diện nhỏ của trình dựng — §10.9, tách ra ở §10.10.
 *
 * Chúng nằm riêng vì từ §10.10 có hai chỗ dùng: bảng cấu hình của ô đang chọn,
 * và (với `Choice`) cả thanh công cụ của khung.
 */

export function PanelTitle({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <h2 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{children}</h2>
  );
}

export function Choice({
  label,
  value,
  onChange,
  options,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  hint?: string | undefined;
}): React.ReactElement {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-700">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {hint !== undefined && (
        <span className="mt-1 block text-xs leading-snug text-slate-500">{hint}</span>
      )}
    </label>
  );
}

/**
 * Chọn bảng màu bằng cách NHÌN THẤY nó.
 *
 * ─── Vì sao không còn là một `<select>` ────────────────────────────────────
 *
 * Bản trước là một ô chọn với bốn dòng chữ: "Phân loại 10 màu", "Phân loại 20
 * màu", "Pastel dịu", "Đậm tương phản". Người dùng phải chọn MÀU bằng cách đọc
 * TÊN, rồi bấm, rồi nhìn biểu đồ, rồi quay lại đổi — mà "Pastel dịu" với "Đậm
 * tương phản" thì đọc xong vẫn không hình dung được cái nào hợp.
 *
 * Ở đây mỗi bảng màu là một dãy ô vuông tô đúng màu Vega sẽ dùng, theo đúng
 * thứ tự sẽ gán cho chuỗi thứ 1, 2, 3… Không còn gì để đoán.
 *
 * ─── Ba chi tiết không được bỏ ─────────────────────────────────────────────
 *
 * 1. `radiogroup` chứ không phải một mớ nút. Bàn phím phải đi qua nó bằng
 *    mũi tên như một ô chọn thật, và trình đọc màn hình phải đọc ra "1 trong
 *    2".
 * 2. Tên vẫn còn, không chỉ có màu — và nó nói về CẢ DÃY, không về ô đầu tiên.
 *    Màu một mình thì không đọc được bằng lời, không tìm được bằng chữ, và vô
 *    nghĩa với người loạn sắc; còn một cái tên như "Xanh ngọc" nằm cạnh một dãy
 *    có cam, đỏ và tím thì tệ hơn cả không có tên.
 * 3. Bảng màu CŨ mà báo cáo đang dùng vẫn hiện ra một dòng. Lọc nó đi thì mở
 *    một báo cáo cũ sẽ thấy bộ chọn tô sáng một bảng màu KHÔNG phải bảng đang
 *    vẽ — người dùng bấm Lưu và lặng lẽ đổi màu biểu đồ của mình.
 */
export function PaletteChoice({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: ChartPalette;
  onChange: (value: ChartPalette) => void;
  hint?: string | undefined;
}): React.ReactElement {
  const offered: readonly ChartPalette[] = CHART_PALETTES.includes(
    value as (typeof CHART_PALETTES)[number],
  )
    ? CHART_PALETTES
    : [...CHART_PALETTES, value];

  return (
    <div role="radiogroup" aria-label={label}>
      <span className="mb-1 block text-xs font-medium text-slate-700">{label}</span>
      <div className="space-y-1">
        {offered.map((palette) => {
          const chosen = palette === value;
          return (
            <button
              key={palette}
              type="button"
              role="radio"
              aria-checked={chosen}
              onClick={() => onChange(palette)}
              className={`flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition-colors ${
                chosen
                  ? 'border-brand-600 bg-brand-50'
                  : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              <Swatches palette={palette} />
              <span className="min-w-0 flex-1">
                <span
                  className={`block truncate text-xs ${chosen ? 'text-brand-800' : 'text-slate-600'}`}
                >
                  {CHART_PALETTE_LABELS[palette]}
                </span>
                {/* Một câu nói bảng này HỢP VỚI VIỆC GÌ. Dãy ô vuông đã cho
                    thấy màu; cái người dùng còn thiếu là lý do để chọn cái này
                    thay vì cái kia — mà hai dãy tám màu thì nhìn không ra. */}
                {hintFor(palette) !== undefined && (
                  <span className="block truncate text-[11px] text-slate-400">
                    {hintFor(palette)}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
      {hint !== undefined && (
        <span className="mt-1 block text-xs leading-snug text-slate-500">{hint}</span>
      )}
    </div>
  );
}

/** Câu gợi ý của một bảng — chỉ bảng còn được mời mới có. */
function hintFor(palette: ChartPalette): string | undefined {
  return CHART_PALETTE_HINTS[palette as (typeof CHART_PALETTES)[number]];
}

/**
 * Dãy ô vuông của một bảng màu.
 *
 * Hai trường hợp KHÔNG có danh sách hex để tô, và mỗi cái cần một hình khác:
 *
 *   `brand`     một màu duy nhất, đọc từ biến CSS lúc chạy. Tô bằng chính lớp
 *               Tailwind của biến đó, nên nó luôn đúng kể cả khi màu thương
 *               hiệu đổi — một mã cứng ở đây sẽ lệch mà không ai thấy.
 *
 *               `normalizePalette` đã dẹp nó ngay lúc nạp, nên nhánh này chỉ
 *               còn là lưới an toàn cho một đường gọi khác chưa qua bước đó.
 *
 *   bảng màu CŨ  Vega giữ danh sách, ta chỉ có cái tên. Chép lại một dãy gần
 *               đúng vào đây là bày ra màu KHÔNG PHẢI màu biểu đồ đang vẽ, nên
 *               thà nói thẳng là không xem trước được.
 */
function Swatches({ palette }: { palette: ChartPalette }): React.ReactElement {
  if (palette === 'brand') {
    return <span aria-hidden="true" className="h-4 w-4 shrink-0 rounded-sm bg-brand-600" />;
  }

  const colors = CHART_PALETTE_COLORS[palette];

  if (colors === undefined) {
    return <span className="shrink-0 text-[10px] text-slate-400">bảng cũ</span>;
  }

  return (
    <span aria-hidden="true" className="flex shrink-0 gap-px">
      {colors.map((color) => (
        <span
          key={color}
          style={{ backgroundColor: color }}
          className="h-4 w-2.5 first:rounded-l-sm last:rounded-r-sm"
        />
      ))}
    </span>
  );
}

/**
 * Công tắc khoá được, và khi khoá thì NÓI VÌ SAO.
 *
 * Một ô tích xám không giải thích gì là chỗ người dùng bấm mãi rồi kết luận
 * trang bị hỏng. Câu giải thích cũng chính là gợi ý phải làm gì để mở nó ra —
 * "cần một chiều ở ô Nhóm màu" vừa là lý do vừa là hướng dẫn.
 */
export function Toggle({
  label,
  checked,
  onChange,
  disabledReason,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabledReason?: string | undefined;
}): React.ReactElement {
  const locked = disabledReason !== undefined;

  return (
    <div>
      <label
        className={`flex items-center gap-2 text-sm ${
          locked ? 'text-slate-400' : 'cursor-pointer text-slate-700'
        }`}
      >
        <input
          type="checkbox"
          checked={checked && !locked}
          disabled={locked}
          onChange={(e) => onChange(e.target.checked)}
          className="rounded border-slate-300"
        />
        {label}
      </label>
      {locked && (
        <p className="mt-0.5 ml-6 text-xs leading-snug text-slate-400">{disabledReason}</p>
      )}
    </div>
  );
}

/**
 * Một ô thả: tên riêng của ô, và LOẠI TRƯỜNG nó nhận.
 *
 * ─── Vì sao phải in loại trường ra ─────────────────────────────────────────
 *
 * Tên ba ô là "Trục", "Giá trị", "Nhóm màu" — chúng nói ô đó VẼ RA CÁI GÌ, chứ
 * không nói phải bỏ cái gì vào. Câu `hint` có nói ("Chiều để chia nhóm"),
 * nhưng nó chỉ hiện khi ô còn TRỐNG: thả xong một trường là dòng chữ đó bị
 * chính trường vừa thả thay chỗ, và từ lúc ấy màn hình không còn chỗ nào nói ô
 * Trục nhận chiều còn ô Giá trị nhận thước đo. Người dùng gặp đúng lúc cần
 * biết nhất — lúc muốn ĐỔI trường đang nằm trong ô.
 *
 * Từ trong ngoặc đọc từ `COLUMN_ROLE_TERMS` chứ không viết lại ở đây, vì cùng
 * hai từ đó còn hiện ở Explorer và ở ô chọn vai trò của tab Schemas.
 *
 * Nó lấy theo `accepts` — CHÍNH biến quyết định ô có nhận cú thả hay không
 * (xem `nhanDuoc` bên dưới) — nên nhãn không thể nói một đằng còn ô làm một
 * nẻo. Một hằng `kindLabel` truyền từ ngoài vào thì lệch được.
 *
 * ⚠️ Không mâu thuẫn với việc bảng trường thôi chia theo vai trò (xem
 * `FieldsPanel`). Ở đó vai trò là thứ backend ĐOÁN cho từng cột, và phép đoán
 * sai đủ thường xuyên để không đáng đem ra xếp nhóm. Ở đây nó là ràng buộc
 * cứng của chính ô này: ô Trục nhận chiều, hết, không có gì để đoán.
 */
export function Shelf({
  label,
  hint,
  accepts,
  field,
  dragging,
  onAssign,
  onClear,
  describe,
  disabledReason,
}: {
  label: string;
  hint: string;
  accepts: FieldKind;
  field: ExplorerFieldDto | null;
  /** Trường đang bay trên màn hình — để tô sáng đúng ô nhận được nó. */
  dragging: DragField | null;
  onAssign: (field: DragField) => void;
  onClear: () => void;
  describe?: (field: ExplorerFieldDto) => string | null;
  /** Có mặt = ô này bị khoá, và đây là câu giải thích vì sao. */
  disabledReason?: string | undefined;
}): React.ReactElement {
  const [over, setOver] = useState(false);
  const locked = disabledReason !== undefined;

  /*
   * Ô này có nhận được thứ đang kéo không.
   *
   * Đọc từ state chứ không từ `dataTransfer`: trong sự kiện `dragover`, đặc tả
   * KHÔNG cho đọc dữ liệu đã set (chỉ đọc được lúc `drop`). Không có state này
   * thì mọi ô sáng lên như nhau, kể cả ô sẽ từ chối cú thả.
   */
  const nhanDuoc = !locked && dragging !== null && dragging.kind === accepts;

  return (
    <div
      onDragOver={(e) => {
        if (!nhanDuoc) return;
        // `preventDefault` mới là thứ biến một phần tử thành nơi thả được.
        // Thiếu nó thì trình duyệt hiện con trỏ cấm và `drop` không bao giờ bắn.
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        if (!nhanDuoc) return;
        e.preventDefault();
        const raw = e.dataTransfer.getData(DND_MIME);
        const parsed = raw === '' ? dragging : (safeParse(raw) ?? dragging);
        if (parsed !== null) onAssign(parsed);
      }}
      className={`rounded-lg border border-dashed px-2.5 py-2 transition-colors ${
        locked
          ? 'border-slate-200 bg-slate-50'
          : over
            ? 'border-brand-500 bg-brand-50'
            : nhanDuoc
              ? 'border-brand-300 bg-white'
              : 'border-slate-300 bg-white'
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span
          className={`truncate text-xs font-semibold ${locked ? 'text-slate-400' : 'text-slate-700'}`}
        >
          {label} <span className="font-normal text-slate-400">({COLUMN_ROLE_TERMS[accepts]})</span>
        </span>
        {field !== null && !locked && (
          <button
            type="button"
            onClick={onClear}
            className="text-xs text-slate-400 hover:text-red-600"
            aria-label={`Bỏ ${field.label} khỏi ô ${label}`}
          >
            Bỏ
          </button>
        )}
      </div>

      {locked ? (
        <p className="mt-0.5 text-xs leading-snug text-slate-400">{disabledReason}</p>
      ) : field === null ? (
        <p className="mt-0.5 text-xs leading-snug text-slate-400">{hint}</p>
      ) : (
        <div className="mt-1 rounded-md bg-brand-50 px-2 py-1">
          <span className="block truncate text-sm text-brand-900" title={field.label}>
            {field.label}
          </span>
          <span className="block truncate text-xs text-brand-700/70">
            {describe?.(field) ?? shortName(field.datasetName)}
          </span>
        </div>
      )}
    </div>
  );
}
