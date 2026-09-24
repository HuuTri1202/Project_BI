import type { ReactNode } from 'react';

/**
 * Ba trạng thái mà mọi danh sách đều phải có, gom vào một chỗ để hai trang quản
 * trị không tự vẽ mỗi nơi một kiểu.
 *
 * Phân biệt "chưa có gì" với "không tìm thấy" là chuyện quan trọng: người dùng
 * lọc ra 0 kết quả mà thấy dòng "Chưa có thành viên nào" sẽ tưởng dữ liệu đã bị
 * mất. Vì vậy `EmptyState` nhận nội dung từ nơi gọi thay vì tự viết sẵn.
 */

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}): React.ReactElement {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {hint && <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">{hint}</p>}
      {/*
       * `flex justify-center`, KHÔNG dựa vào `text-center` của thẻ cha.
       *
       * `text-align` chỉ căn được nội dung INLINE. Phần lớn nút truyền vào đây
       * là `Button` (`inline-flex`) nên nó trúng — nhưng một hành động bọc
       * trong thẻ `div` của riêng nó thì không, và nó dạt hẳn sang mép trái
       * giữa một khung căn giữa. Đúng chuyện đã xảy ra với nút "Tạo báo cáo"
       * trong một thư mục rỗng: `CreateReportMenu` bọc ngoài một
       * `div.relative` để neo menu thả xuống.
       *
       * Căn ở ĐÂY chứ không bắt từng nơi gọi tự bọc thêm một lớp: hai trang đã
       * phải tự viết `flex justify-center` cho đúng việc này, và trang thứ ba
       * quên là lại lệch đúng như vậy.
       */}
      {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

/** Khung xám nhấp nháy thay cho bảng lúc đang tải. */
export function TableSkeleton({ rows = 5 }: { rows?: number }): React.ReactElement {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4" role="status">
      <span className="sr-only">Đang tải danh sách…</span>
      <div className="animate-pulse space-y-3">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="h-9 rounded bg-slate-100" />
        ))}
      </div>
    </div>
  );
}

export function ErrorState({ message }: { message: string }): React.ReactElement {
  return (
    <div
      role="alert"
      className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700"
    >
      {message}
    </div>
  );
}
