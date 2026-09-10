import type { ExplorerFieldDto } from '@bi/shared';
import { useState } from 'react';

import { DND_MIME, type DragField, type FieldKind } from './dnd';
import { moTaCua, shortName } from './fieldText';
import { filterSheets, groupBySheet } from './sheets';

/**
 * Cột "Mô hình dữ liệu" — MỌI trường của mô hình, chia theo bảng.
 *
 * Tách khỏi trang ở §10.9: cột này giờ đứng cạnh một KHUNG nhiều ô thay vì cạnh
 * một biểu đồ, và trang đã đủ dài mà không cần thêm 200 dòng bảng trường.
 *
 * ═══ Vì sao KHÔNG còn hai mục "Chiều" và "Thước đo" ════════════════════════
 *
 * Bản trước xếp trường thành hai khối theo vai trò mà hệ thống ĐOÁN ra: cột số
 * thì vào "Thước đo", cột chữ và ngày vào "Chiều", trừ khi từ cuối của tên nghe
 * như một định danh (`id`, `code`, `order`…) — xem `classifyColumn.ts` phía
 * backend. Phép đoán đó sai vừa đủ thường xuyên để gây hại:
 *
 *   - Một cột số bị đoán thành thước đo thì KHÔNG còn nằm trong nhóm "Chiều",
 *     nên người dùng đi tìm nó để chia nhóm và không thấy ở đâu cả.
 *   - Hai khối tự tin nói "đây là chiều, đây là thước đo" trong khi thứ tự sắp
 *     xếp thật ra đến từ một danh sách từ khoá dài mười mấy chữ.
 *
 * Nên bảng này thôi phát biểu về vai trò. Nó chia theo BẢNG — đơn vị mà người
 * dùng thật sự nhớ, vì họ là người đã nạp từng bảng vào mô hình — rồi liệt kê
 * mọi trường của bảng đó. Ai dựng báo cáo thì biết cột nào đo được, và họ chọn.
 *
 * ⚠️ Đây là thay đổi CÁCH HIỂN THỊ. Backend vẫn phân vai trò như cũ, nên một
 * cột bị đoán thành thước đo vẫn chưa kéo được vào ô Trục. Ký hiệu đầu dòng nói
 * ra điều đó (`Σ` = trường đã gộp sẵn), và mỗi ô thả tự in ra loại trường nó
 * nhận rồi sáng lên đúng lúc kéo — xem `Shelf` trong `controls.tsx`. Bỏ hẳn
 * phép đoán ở backend là việc khác, lớn hơn nhiều: nó đụng bộ sinh schema Cube,
 * DTO cấu hình báo cáo và cả việc sinh lại schema cho mọi mô hình đã có.
 */

export function FieldsPanel({
  dimensions,
  measures,
  used,
  onPick,
  onDragStart,
  onDragEnd,
}: {
  dimensions: ExplorerFieldDto[];
  measures: ExplorerFieldDto[];
  /** Trường đang được ô ĐANG CHỌN dùng — để tô sáng, không phải để khoá. */
  used: Set<number>;
  onPick: (field: DragField) => void;
  onDragStart: (field: DragField) => void;
  onDragEnd: () => void;
}): React.ReactElement {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();

  const sheets = filterSheets(groupBySheet(dimensions, measures), q);

  return (
    <>
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Tìm trường…"
        aria-label="Tìm trường trong mô hình"
        className="mt-2 w-full shrink-0 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
      />

      <div className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {sheets.length === 0 ? (
          <p className="text-xs text-slate-400">
            {needle === ''
              ? 'Mô hình này chưa có trường nào. Kiểm ở tab Schemas.'
              : 'Không có trường nào khớp.'}
          </p>
        ) : (
          sheets.map((sheet) => (
            <section key={sheet.name}>
              {/* Tên BẢNG, không phải tên mô hình: tên mô hình đã ở thanh công
                  cụ trên khung, và lặp nó trước mỗi bảng chỉ đẩy tên bảng — thứ
                  duy nhất khác nhau giữa các nhóm — ra ngoài mép cắt chữ. */}
              <h3 className="mb-1 truncate text-xs font-semibold text-slate-600" title={sheet.name}>
                {shortName(sheet.name)}
              </h3>
              <ul className="space-y-0.5">
                {sheet.fields.map(({ field, kind }) => (
                  <li key={`${kind}-${field.id}`}>
                    <FieldPill
                      field={field}
                      kind={kind}
                      inUse={used.has(field.id)}
                      description={kind === 'measure' ? moTaCua(field) : null}
                      onPick={onPick}
                      onDragStart={onDragStart}
                      onDragEnd={onDragEnd}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </>
  );
}

/**
 * Một trường: kéo được BẰNG CHUỘT và bấm được BẰNG BÀN PHÍM.
 *
 * `<button draggable>` chứ không phải `<div draggable>`: thẻ div không nhận
 * focus, không đọc được bằng trình đọc màn hình như một thứ bấm được, và không
 * phản ứng với phím Enter. Kéo thả là lối tắt cho chuột; bấm là lối chính.
 */
function FieldPill({
  field,
  kind,
  inUse,
  description,
  onPick,
  onDragStart,
  onDragEnd,
}: {
  field: ExplorerFieldDto;
  kind: FieldKind;
  inUse: boolean;
  description: string | null;
  onPick: (field: DragField) => void;
  onDragStart: (field: DragField) => void;
  onDragEnd: () => void;
}): React.ReactElement {
  const payload: DragField = { kind, id: field.id };

  return (
    <button
      type="button"
      draggable
      onClick={() => onPick(payload)}
      onDragStart={(e) => {
        e.dataTransfer.setData(DND_MIME, JSON.stringify(payload));
        // `copy` chứ không `move`: trường vẫn ở lại trong bảng sau khi thả, và
        // con trỏ chuột phải nói đúng điều đó.
        e.dataTransfer.effectAllowed = 'copy';
        onDragStart(payload);
      }}
      onDragEnd={onDragEnd}
      className={`flex w-full cursor-grab items-start gap-2 rounded-md px-1.5 py-1 text-left transition-colors active:cursor-grabbing ${
        inUse ? 'text-brand-800 bg-brand-50' : 'text-slate-700 hover:bg-slate-100'
      }`}
    >
      <TypeGlyph field={field} kind={kind} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{field.label}</span>
        {description !== null && (
          <span className="block truncate text-xs text-slate-500" title={description}>
            {description}
          </span>
        )}
      </span>
    </button>
  );
}

/**
 * Ký hiệu kiểu dữ liệu, đọc trong nửa giây.
 *
 * Cùng quy ước với mọi công cụ BI: `#` là số, `T` là chữ, lịch là thời gian.
 * Thước đo dùng ký hiệu tổng `Σ` chứ không dùng kiểu của cột nó gộp — cái người
 * dùng cần phân biệt trong bảng này là "kéo cái này ra được một con số" chứ
 * không phải "cột gốc là Float64".
 *
 * Từ khi bảng trường thôi chia theo vai trò, ký hiệu này là chỗ DUY NHẤT còn
 * nói được trường nào đã gộp sẵn — nên nó không còn là trang trí.
 */
function TypeGlyph({
  field,
  kind,
}: {
  field: ExplorerFieldDto;
  kind: FieldKind;
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
