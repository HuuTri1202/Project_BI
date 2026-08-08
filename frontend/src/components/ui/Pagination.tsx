import { Button } from './Button';

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  onPageChange: (page: number) => void;
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
}: PaginationProps): React.ReactElement | null {
  if (total === 0) return null;

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-slate-500">
        Hiện <span className="font-medium text-slate-700">{from}</span>–
        <span className="font-medium text-slate-700">{to}</span> trong{' '}
        <span className="font-medium text-slate-700">{total}</span>
      </p>

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
