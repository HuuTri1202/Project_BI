import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';

/**
 * Ô chọn có tìm kiếm, danh sách CUỘN TẠI CHỖ.
 *
 * ─── Vì sao không dùng `<select>` gốc ───────────────────────────────────────
 *
 * `<select>` bung một danh sách cao bằng đúng số tuỳ chọn. Với 25 cột của
 * `Global-Superstore · Orders`, trình duyệt vẽ nó tràn lên hết màn hình và đè
 * lên chính hộp thoại đang mở — người dùng mất dấu ngữ cảnh, và không cách nào
 * chặn được vì popup của `<select>` nằm ngoài tầm với của CSS.
 *
 * Ở đây danh sách nằm NGAY TRONG luồng nội dung, cao cố định, tự cuộn. Không có
 * popup thì không có gì tràn ra được — cả lớp lỗi đó biến mất chứ không phải
 * được vá.
 *
 * ─── Cái được thêm, không chỉ là cái mất đi ────────────────────────────────
 *
 * Danh sách 25 cột thì cuộn tìm bằng mắt là việc nặng. Ô tìm kiếm ở trên giải
 * đúng chuyện đó, và nó lọc cả theo KIỂU dữ liệu — gõ "Date" là ra mọi cột ngày,
 * "String" là ra mọi cột chữ. Chọn khoá hay chọn cột nối đều bắt đầu từ kiểu.
 *
 * ─── Bàn phím ──────────────────────────────────────────────────────────────
 *
 * Theo đúng khuôn mẫu combobox của ARIA: ô nhập giữ tiêu điểm, mũi tên lên
 * xuống dời con trỏ, Enter chọn. Danh sách không bao giờ nhận tiêu điểm, nên
 * `aria-activedescendant` là thứ nói cho trình đọc màn hình biết đang ở dòng
 * nào — bỏ nó đi thì component này chỉ dùng được bằng chuột.
 */

export interface SearchSelectOption {
  value: number;
  label: string;
  /** Chữ phụ bên phải: kiểu ClickHouse, ghi chú "khoá chính"… Cũng được đem đi lọc. */
  hint?: string;
}

interface Item {
  value: number | null;
  label: string;
  hint?: string;
}

interface SearchSelectProps {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  options: readonly SearchSelectOption[];
  /** Nhãn của mục "để trống". `null` = bắt buộc chọn, không vẽ mục đó. */
  emptyLabel?: string | null;
  /** Số dòng thấy được trước khi phải cuộn. */
  rows?: number;
  disabled?: boolean;
  hint?: ReactNode;
  /** Danh từ đếm được, đi vào chữ mờ của ô tìm: "Tìm trong 24 cột…". */
  noun?: string;
}

/** Chiều cao một dòng, khớp với `px-3 py-1.5 text-sm` bên dưới. */
const ROW_H = 32;

export function SearchSelect({
  label,
  value,
  onChange,
  options,
  emptyLabel = null,
  rows = 7,
  disabled = false,
  hint,
  noun = 'mục',
}: SearchSelectProps): React.ReactElement {
  const baseId = useId();
  const listId = `${baseId}-list`;
  const [query, setQuery] = useState('');
  /** `null` = người dùng chưa động tới bàn phím. Xem `cursor`. */
  const [active, setActive] = useState<number | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const items = useMemo<Item[]>(() => {
    const q = query.trim().toLowerCase();
    const matched: Item[] =
      q === ''
        ? options.map((o) => ({ ...o }))
        : options.filter(
            (o) =>
              o.label.toLowerCase().includes(q) || (o.hint ?? '').toLowerCase().includes(q),
          );

    // Mục "để trống" chỉ hiện khi CHƯA gõ gì: nó không phải một kết quả tìm
    // kiếm, và để nó lẫn vào danh sách đã lọc thì Enter dễ chọn nhầm nó.
    return emptyLabel === null || q !== '' ? matched : [{ value: null, label: emptyLabel }, ...matched];
  }, [options, query, emptyLabel]);

  const selectedIndex = items.findIndex((o) => o.value === value);

  /**
   * Con trỏ bàn phím. Khi chưa động phím, nó nằm ở mục ĐANG CHỌN — nhờ vậy mở
   * lên là thấy ngay giá trị hiện tại kể cả khi nó ở dòng thứ 20.
   */
  const cursor = Math.min(active ?? selectedIndex, items.length - 1);

  useEffect(() => {
    if (cursor < 0) return;
    listRef.current?.children[cursor]?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  function move(delta: number): void {
    if (items.length === 0) return;
    const from = cursor < 0 ? (delta > 0 ? -1 : items.length) : cursor;
    setActive(Math.max(0, Math.min(items.length - 1, from + delta)));
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(-1);
    } else if (event.key === 'Enter') {
      // Chặn Enter, nếu không nó kích hoạt nút mặc định của hộp thoại và LƯU
      // luôn trong khi người dùng mới chỉ định chọn một dòng.
      event.preventDefault();
      const item = items[cursor];
      if (item !== undefined) commit(item.value);
    }
  }

  function commit(next: number | null): void {
    onChange(next);
    setQuery('');
    setActive(null);
  }

  return (
    <div>
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>

      <div
        className={`overflow-hidden rounded-lg border border-slate-300 bg-white focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-200 ${
          disabled ? 'opacity-60' : ''
        }`}
      >
        <input
          type="text"
          role="combobox"
          value={query}
          disabled={disabled}
          // Chữ mờ mang theo TỔNG SỐ: danh sách chỉ hiện được bảy dòng, và nếu
          // không nói ra thì người dùng không biết mình đang nhìn 7 trên 24.
          placeholder={`Tìm trong ${options.length} ${noun}…`}
          aria-label={label}
          aria-expanded
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={cursor >= 0 ? `${baseId}-opt-${cursor}` : undefined}
          onChange={(e) => {
            setQuery(e.target.value);
            // Đang lọc thì con trỏ về dòng đầu, để Enter chọn được kết quả đầu
            // tiên mà không phải bấm mũi tên.
            setActive(e.target.value.trim() === '' ? null : 0);
          }}
          onKeyDown={onKeyDown}
          className="w-full border-b border-slate-200 px-3 py-2 text-sm outline-none disabled:bg-slate-50"
        />

        <ul
          id={listId}
          ref={listRef}
          role="listbox"
          aria-label={label}
          className="overflow-y-auto"
          // NỬA dòng dư: dòng thứ tám bị cắt ngang là dấu hiệu không cần chữ
          // nghĩa nào cũng hiểu — còn nữa, cuộn xuống. Cắt đúng ranh giới dòng
          // trông như danh sách đã hết.
          style={{ maxHeight: `${rows * ROW_H + ROW_H / 2}px` }}
        >
          {items.map((item, index) => {
            const selected = item.value === value;
            return (
              <li
                key={item.value ?? 'none'}
                id={`${baseId}-opt-${index}`}
                role="option"
                aria-selected={selected}
                // Giữ tiêu điểm trong ô nhập khi bấm chuột, để gõ tiếp được ngay.
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => !disabled && commit(item.value)}
                className={[
                  'flex cursor-pointer items-center justify-between gap-3 px-3 py-1.5 text-sm',
                  index === cursor ? 'bg-slate-100' : '',
                  selected ? 'font-medium text-brand-700' : 'text-slate-700',
                  item.value === null ? 'text-slate-500 italic' : '',
                ].join(' ')}
              >
                <span className="truncate">{item.label}</span>
                <span className="flex shrink-0 items-center gap-2">
                  {item.hint !== undefined && (
                    <code className="text-xs text-slate-400">{item.hint}</code>
                  )}
                  {/* Dấu tích chứ không chỉ đổi màu — cùng luật với Badge ở
                      những bảng khác: không bao giờ chỉ dùng màu để phân biệt. */}
                  {selected && <CheckIcon />}
                </span>
              </li>
            );
          })}

          {items.length === 0 && (
            <li className="px-3 py-2 text-sm text-slate-500">Không có mục nào khớp.</li>
          )}
        </ul>
      </div>

      {hint !== undefined && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

function CheckIcon(): React.ReactElement {
  return (
    <svg
      className="h-4 w-4 text-brand-600"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      aria-hidden="true"
    >
      <path d="m5 13 4 4L19 7" />
    </svg>
  );
}
