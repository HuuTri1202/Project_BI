import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface SwitcherOption {
  id: number;
  label: string;
  /** Dòng phụ nhỏ bên phải — số project, vai trò… */
  meta?: string;
}

interface SidebarSwitcherProps {
  /** Nhãn nhỏ phía trên nút, ví dụ "Tổ chức". */
  caption: string;
  icon: string;
  current: SwitcherOption | null;
  options: SwitcherOption[];
  onSelect: (id: number) => void;
  /** Hiện khi danh sách rỗng hoặc lỗi. */
  emptyLabel: string;
  isLoading?: boolean;
  /** Đang gửi request đổi — khoá nút để không bấm hai lần. */
  pending?: boolean;
  error?: string | null;
  /** Nội dung thêm ở đáy danh sách, ví dụ link "Quản lý workspace". */
  footer?: ReactNode;
}

/**
 * Dropdown dùng chung cho hai bộ chuyển trên sidebar — §5.1.
 *
 * Bộ chuyển tổ chức và bộ chuyển workspace khác nhau ở nguồn dữ liệu và ở hậu
 * quả khi chọn (một cái cấp lại token, một cái chỉ đổi state), nhưng giống hệt
 * nhau về hành vi giao diện. Viết hai lần thì chúng lệch nhau ngay lần sửa đầu:
 * cái này đóng bằng Escape, cái kia thì không.
 *
 * Dựng bằng `<button>` + danh sách thay vì `<select>` gốc vì cần hiện dòng phụ
 * (số project, vai trò) và dấu tick, mà `<option>` chỉ chứa được text thuần.
 * Đổi lại phải tự làm ba thứ `<select>` cho không, và cả ba đều ở dưới đây:
 * đóng khi bấm ra ngoài, đóng bằng Escape, và `aria-expanded` + `role="listbox"`
 * để trình đọc màn hình hiểu đây là bộ chọn.
 *
 * Tông màu theo sidebar tối, không phải nền trắng của nội dung.
 */
export function SidebarSwitcher({
  caption,
  icon,
  current,
  options,
  onSelect,
  emptyLabel,
  isLoading = false,
  pending = false,
  error = null,
  footer,
}: SidebarSwitcherProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // `mousedown` chứ không phải `click`: nghe `click` thì thao tác bấm-giữ-kéo
  // bắt đầu trong menu và nhả ra ngoài bị tính là click ngoài, menu đóng ngay
  // giữa lúc người dùng đang bôi đen chữ.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Đang gửi request thì đóng danh sách lại: để nó mở trong lúc dữ liệu bên dưới
  // sắp bị thay toàn bộ chỉ khiến người dùng bấm tiếp vào một danh sách đã cũ.
  useEffect(() => {
    if (pending) setOpen(false);
  }, [pending]);

  if (isLoading) {
    return (
      <div className="px-3 py-2">
        <div className="h-9 animate-pulse rounded-lg bg-slate-800" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div ref={rootRef} className="relative px-3 py-1">
      <p className="px-1 pb-1 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
        {caption}
      </p>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={pending || current === null}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-lg bg-slate-800 px-2.5 py-2 text-left text-sm font-medium text-slate-100 transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4 shrink-0 text-slate-400"
          aria-hidden="true"
        >
          <path d={icon} />
        </svg>
        <span className="min-w-0 flex-1 truncate">{current?.label ?? emptyLabel}</span>
        {pending ? (
          <span
            className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-slate-500 border-t-transparent"
            aria-label="Đang đổi…"
          />
        ) : (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
            aria-hidden="true"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        )}
      </button>

      {error && (
        <p role="alert" className="mt-1 px-1 text-xs text-red-400">
          {error}
        </p>
      )}

      {open && (
        <div className="absolute inset-x-3 z-50 mt-1 overflow-hidden rounded-xl border border-slate-700 bg-slate-800 shadow-xl">
          <ul role="listbox" aria-label={caption} className="max-h-72 overflow-auto py-1">
            {options.map((option) => {
              const active = option.id === current?.id;
              return (
                <li key={option.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => {
                      setOpen(false);
                      if (!active) onSelect(option.id);
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                      active ? 'bg-brand-600 text-white' : 'text-slate-200 hover:bg-slate-700'
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    {option.meta && (
                      <span
                        className={`shrink-0 text-xs ${active ? 'text-brand-100' : 'text-slate-400'}`}
                      >
                        {option.meta}
                      </span>
                    )}
                    {active && (
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="h-4 w-4 shrink-0"
                        aria-hidden="true"
                      >
                        <path d="m5 13 4 4L19 7" />
                      </svg>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          {footer && <div className="border-t border-slate-700 p-1">{footer}</div>}
        </div>
      )}
    </div>
  );
}
