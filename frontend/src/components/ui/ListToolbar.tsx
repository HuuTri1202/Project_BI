import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '../../components/ui/Button';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';

interface ListToolbarProps {
  /** Giá trị tìm kiếm hiện tại, đọc từ URL. */
  search: string;
  onSearch: (value: string) => void;
  placeholder: string;
  /** Các ô lọc riêng của từng trang. */
  children?: ReactNode;
  hasFilter: boolean;
  onReset: () => void;
}

/**
 * Thanh công cụ dùng chung cho ba trang danh sách.
 *
 * Ô nhập giữ state RIÊNG để gõ không bị chậm: bind thẳng vào URL thì mỗi phím
 * là một lần điều hướng router cộng một lần render lại cả bảng.
 */
export function ListToolbar({
  search,
  onSearch,
  placeholder,
  children,
  hasFilter,
  onReset,
}: ListToolbarProps): React.ReactElement {
  const [term, setTerm] = useState(search);
  const debounced = useDebouncedValue(term, 300);

  useEffect(() => {
    if (debounced !== search) onSearch(debounced);
    // Chỉ chạy khi giá trị đã ổn định. Đưa `search` vào deps sẽ tạo vòng lặp:
    // onSearch -> URL đổi -> search đổi -> effect chạy lại.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  // Người dùng bấm "Xoá lọc" hoặc quay lại bằng nút Back -> đồng bộ ô nhập theo
  // URL. Không có đoạn này thì ô nhập vẫn giữ chữ cũ trong khi bảng đã đổi.
  useEffect(() => {
    setTerm(search);
  }, [search]);

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-[16rem] flex-1">
        <label htmlFor="list-search" className="mb-1.5 block text-sm font-medium text-slate-700">
          Tìm kiếm
        </label>
        <input
          id="list-search"
          type="search"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder={placeholder}
          className="block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-slate-900 shadow-sm transition-colors outline-none placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
        />
      </div>

      {children}

      {hasFilter && (
        <Button variant="ghost" onClick={onReset}>
          Xoá lọc
        </Button>
      )}
    </div>
  );
}

interface FilterSelectProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Nhãn cho lựa chọn "không lọc". Phải nói rõ mặc định bao gồm những gì. */
  allLabel: string;
  options: { value: string; label: string }[];
}

export function FilterSelect({
  id,
  label,
  value,
  onChange,
  allLabel,
  options,
}: FilterSelectProps): React.ReactElement {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-slate-700">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="block max-w-[14rem] rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-slate-900 shadow-sm transition-colors outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
      >
        <option value="">{allLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

