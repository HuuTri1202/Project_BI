import { Button } from './Button';

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  /**
   * Bật ô chọn số dòng mỗi trang. Bỏ trống thì không hiện — danh sách vài chục
   * dòng (thành viên, báo cáo) không cần, còn bảng dữ liệu hàng vạn dòng thì có.
   */
  pageSizeOptions?: readonly number[];
  onPageSizeChange?: (pageSize: number) => void;
  /** Đơn vị trong câu "Hiện 1–20 trong 43". Mặc định để trống. */
  unit?: string;
}

/**
 * Phân trang tối giản: Trước / Sau + vị trí hiện tại.
 *
 * Cố ý không vẽ dãy số trang. Dãy số cần logic rút gọn (1 … 4 5 6 … 20), và với
 * một tổ chức có vài chục thành viên thì nó là công sức bỏ ra cho thứ không ai
 * dùng — người ta lọc chứ không nhảy tới trang 7.
 *
 * Câu "Hiện 1–20 trong 43" quan trọng hơn cả các nút: nó cho biết bộ lọc đang
 * khớp bao nhiêu, thứ mà chỉ nhìn bảng thì không đoán được.
 */
export function Pagination({
  page,
  pageSize,
  total,
  totalPages,
  onPageChange,
  pageSizeOptions,
  onPageSizeChange,
  unit,
}: PaginationProps): React.ReactElement | null {
  if (total === 0) return null;

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-4">
        <p className="text-sm text-slate-500">
          Hiện <span className="font-medium text-slate-700">{from.toLocaleString('vi-VN')}</span>–
          <span className="font-medium text-slate-700">{to.toLocaleString('vi-VN')}</span> trong{' '}
          <span className="font-medium text-slate-700">{total.toLocaleString('vi-VN')}</span>
          {unit ? ` ${unit}` : ''}
        </p>

        {pageSizeOptions && onPageSizeChange && (
          <div className="flex items-center gap-2">
            <label htmlFor="page-size" className="text-sm text-slate-500">
              Mỗi trang
            </label>
            <select
              id="page-size"
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="rounded-lg border border-slate-300 bg-white py-1.5 pr-8 pl-3 text-sm text-slate-700 shadow-sm transition-colors outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
            >
              {pageSizeOptions.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          Trước
        </Button>
        <span className="text-sm text-slate-500">
          {page}/{totalPages}
        </span>
        <Button size="sm" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
          Sau
        </Button>
      </div>
    </div>
  );
}
