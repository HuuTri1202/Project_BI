import type { ReactNode, ThHTMLAttributes } from 'react';

/**
 * Bộ thẻ bảng mỏng — chỉ gói lại className, không hơn.
 *
 * CỐ Ý KHÔNG làm một `DataTable` tổng quát điều khiển bằng mảng cấu hình cột.
 * Bảng viết markup tường minh dễ đọc, dễ sửa một ô, và không cần học API riêng;
 * bản tổng quát thì lúc nào cũng thiếu đúng cái prop mình cần và sinh ra một
 * tầng trừu tượng phải bảo trì. Hai bảng trong khu quản trị chưa đủ để đánh đổi.
 */

export function TableWrap({
  children,
  /**
   * Cho bảng cuộn DỌC bên trong thay vì đẩy dài cả trang.
   *
   * `min-h-0` mà KHÔNG `flex-1`, và khác biệt đó nhìn thấy được: `flex-1` bắt
   * hộp căng hết chiều cao, nên bảng ba dòng để lại một mảng trắng mênh mông
   * tới tận đáy màn hình. Chỉ `min-h-0` thì hộp cao bằng nội dung, và chỉ co lại
   * (rồi sinh thanh cuộn riêng) khi nội dung vượt quá chỗ còn trống.
   *
   * Cần cha là một flex column có `min-h-0` — xem `PageBody`.
   */
  fill = false,
  /**
   * Căng hộp hết chiều cao còn lại (`flex-1`) — NGƯỢC với mặc định của `fill`.
   *
   * Dùng cho bảng là NỘI DUNG CHÍNH của một trang quản lý: ở đó khoảng trắng
   * dưới vài dòng dữ liệu không phải lãng phí mà là chỗ cho dòng sắp thêm, và
   * một khung cao cố định giữ cho trang không nhảy mỗi lần thêm/bớt một dòng.
   *
   * Nó còn sửa một lỗi thấy được: menu "⋮" ở cuối dòng bung xuống dưới, và với
   * một hộp chỉ cao bằng ba dòng thì menu rơi ra ngoài vùng `overflow-auto` rồi
   * bị cắt cụt. (`RowMenu` cũng đã chuyển sang portal để không phụ thuộc vào
   * chiều cao hộp nữa — hai lớp cho cùng một vấn đề, vì hộp có thể vẫn hẹp trên
   * màn hình thấp.)
   */
  grow = false,
  /**
   * Lớp phụ — dành cho TRẦN chiều cao (`max-h-60`).
   *
   * Có `fill` rồi vẫn cần cái này: `fill` để bảng nhường chỗ còn lại, còn ở tab
   * Quan hệ thì ngược lại — bảng phải bị CHẶN để không lấn vào sơ đồ, dù trên
   * màn hình còn thừa chỗ. Đó là hai luật khác nhau, không phải một luật hai tên.
   */
  className = '',
}: {
  children: ReactNode;
  fill?: boolean;
  grow?: boolean;
  className?: string;
}): React.ReactElement {
  return (
    // overflow-auto: bảng có 6 cột không vừa màn hình điện thoại, cho cuộn
    // trong khung thay vì để cả trang bị đẩy rộng ra.
    <div
      className={`overflow-auto rounded-xl border border-slate-200 bg-white ${
        fill || grow ? 'min-h-0' : ''
      } ${grow ? 'flex-1' : ''} ${className}`}
    >
      <table className="w-full min-w-[52rem] border-collapse text-sm">{children}</table>
    </div>
  );
}

/**
 * `sticky top-0`: hàng tiêu đề đứng yên khi cuộn trong hộp.
 *
 * Không có nó, cuộn tới dòng thứ 60 là mất tên cột và người dùng phải cuộn
 * ngược lên để nhớ cột nào là cột nào. `bg-slate-50` phải đục — nền trong suốt
 * thì các dòng chạy XUYÊN QUA chữ tiêu đề.
 */
export function THead({ children }: { children: ReactNode }): React.ReactElement {
  return (
    <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50">{children}</thead>
  );
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
