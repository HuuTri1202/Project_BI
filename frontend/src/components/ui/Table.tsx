import type { ReactNode, ThHTMLAttributes } from 'react';

/**
 * Bộ thẻ bảng mỏng — chỉ gói lại className, không hơn.
 *
 * CỐ Ý KHÔNG làm một `DataTable` tổng quát điều khiển bằng mảng cấu hình cột.
 * Bảng viết markup tường minh dễ đọc, dễ sửa một ô, và không cần học API riêng;
 * bản tổng quát thì lúc nào cũng thiếu đúng cái prop mình cần và sinh ra một
 * tầng trừu tượng phải bảo trì. Hai bảng trong khu quản trị chưa đủ để đánh đổi.
 */

export function TableWrap({ children }: { children: ReactNode }): React.ReactElement {
  return (
    // overflow-x-auto: bảng có 6 cột không vừa màn hình điện thoại, cho cuộn
    // ngang trong khung thay vì để cả trang bị đẩy rộng ra.
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full min-w-[52rem] border-collapse text-sm">{children}</table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }): React.ReactElement {
  return <thead className="border-b border-slate-200 bg-slate-50">{children}</thead>;
}

export function TBody({ children }: { children: ReactNode }): React.ReactElement {
  return <tbody className="divide-y divide-slate-100">{children}</tbody>;
}

export function Tr({ children }: { children: ReactNode }): React.ReactElement {
  return <tr className="hover:bg-slate-50/60">{children}</tr>;
}

export function Th({
  children,
  align = 'left',
  ...rest
}: { children: ReactNode; align?: 'left' | 'right' } & ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={`px-4 py-3 text-xs font-semibold tracking-wide text-slate-500 uppercase ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
      {...rest}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  align = 'left',
}: {
  children: ReactNode;
  align?: 'left' | 'right';
}): React.ReactElement {
  return (
    <td className={`px-4 py-3 text-slate-700 ${align === 'right' ? 'text-right' : ''}`}>
      {children}
    </td>
  );
}

interface SortableThProps {
  children: ReactNode;
  /** Khoá sắp xếp mà cột này đại diện. */
  sortKey: string;
  activeKey: string;
  order: 'asc' | 'desc';
  onSort: (key: string) => void;
}

/**
 * Ô tiêu đề bấm được để sắp xếp.
 *
 * `aria-sort` là thứ báo cho trình đọc màn hình biết bảng đang sắp theo cột nào
 * và theo chiều nào — mũi tên vẽ bằng SVG thì họ không thấy.
 */
export function SortableTh({
  children,
  sortKey,
  activeKey,
  order,
  onSort,
}: SortableThProps): React.ReactElement {
  const active = activeKey === sortKey;

  return (
    <Th aria-sort={active ? (order === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="inline-flex items-center gap-1 uppercase transition-colors hover:text-slate-900"
      >
        {children}
        <svg
          className={`h-3 w-3 ${active ? 'text-brand-600' : 'text-slate-300'}`}
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
        >
          {active && order === 'asc' ? <path d="M3 7.5 6 4.5l3 3" /> : <path d="M3 4.5 6 7.5l3-3" />}
        </svg>
      </button>
    </Th>
  );
}
