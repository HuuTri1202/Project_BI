import { MEMBER_STATUS_LABELS, TENANT_ROLE_LABELS } from '@bi/shared';
import { useEffect, useState } from 'react';
import { Button } from '../../../components/ui/Button';
import type { UserListQuery } from '../api';
import { useDebouncedValue } from '../useDebouncedValue';

interface UserFiltersProps {
  query: UserListQuery;
  onChange: (patch: Partial<UserListQuery>) => void;
  onReset: () => void;
}

export function UserFilters({ query, onChange, onReset }: UserFiltersProps): React.ReactElement {
  // Ô nhập giữ state RIÊNG để gõ không bị chậm: nếu bind thẳng vào URL thì mỗi
  // phím là một lần điều hướng router + một lần render lại cả bảng.
  const [term, setTerm] = useState(query.q);
  const debounced = useDebouncedValue(term, 300);

  useEffect(() => {
    if (debounced !== query.q) onChange({ q: debounced });
    // Chỉ chạy khi giá trị đã ổn định. Đưa `query.q` vào deps sẽ tạo vòng lặp:
    // onChange -> URL đổi -> query.q đổi -> effect chạy lại.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  // Người dùng bấm "Xoá lọc" hoặc quay lại bằng nút Back -> đồng bộ ô nhập theo
  // URL. Không có đoạn này thì ô nhập vẫn giữ chữ cũ trong khi bảng đã đổi.
  useEffect(() => {
    setTerm(query.q);
  }, [query.q]);

  const hasFilter = query.q !== '' || query.role !== '' || query.status !== '';

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-[16rem] flex-1">
        <label htmlFor="user-search" className="mb-1.5 block text-sm font-medium text-slate-700">
          Tìm kiếm
        </label>
        <input
          id="user-search"
          type="search"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Họ tên hoặc email…"
          className="block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-slate-900 shadow-sm transition-colors outline-none placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
        />
      </div>

      <FilterSelect
        id="filter-role"
        label="Vai trò"
        value={query.role}
        onChange={(v) => onChange({ role: v as UserListQuery['role'] })}
        allLabel="Tất cả vai trò"
        options={Object.entries(TENANT_ROLE_LABELS)}
      />

      <FilterSelect
        id="filter-status"
        label="Trạng thái"
        value={query.status}
        onChange={(v) => onChange({ status: v as UserListQuery['status'] })}
        allLabel="Đang hoạt động + bị khoá"
        options={Object.entries(MEMBER_STATUS_LABELS)}
      />

      {hasFilter && (
        <Button variant="ghost" onClick={onReset}>
          Xoá lọc
        </Button>
      )}
    </div>
  );
}

function FilterSelect({
  id,
  label,
  value,
  onChange,
  allLabel,
  options,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  allLabel: string;
  options: [string, string][];
}): React.ReactElement {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-slate-700">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="block rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-slate-900 shadow-sm transition-colors outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
      >
        {/* Giá trị rỗng nghĩa là "không lọc" — nhãn phải nói rõ mặc định đang
            bao gồm những gì, vì "Tất cả" ở cột trạng thái sẽ gây hiểu nhầm là
            có cả người đã bị gỡ. */}
        <option value="">{allLabel}</option>
        {options.map(([key, text]) => (
          <option key={key} value={key}>
            {text}
          </option>
        ))}
      </select>
    </div>
  );
}
