import { useEffect, useRef, useState } from 'react';

/**
 * Nút "Tạo báo cáo" — §4.9.
 *
 * Dropdown chọn giữa BÁO CÁO và SỔ BÁO CÁO. Cả hai mục dựng đủ nhưng ở trạng
 * thái *sắp có*: chưa có bảng `reports` trong schema và chưa có trình soạn báo
 * cáo — cả hai thuộc phần sau.
 *
 * Hiện mục vô hiệu kèm nhãn "sắp có" thay vì giấu nút đi, hoặc tệ hơn là để nó
 * bấm được rồi dẫn tới trang 404. Người dùng thấy được lộ trình mà không bị lừa
 * bấm vào chỗ trống — đúng cách `AdminLayout` đang xử lý trang chưa xây.
 *
 * `aria-disabled` chứ không phải thuộc tính `disabled`: nút bị `disabled` biến
 * mất khỏi luồng Tab và trình đọc màn hình bỏ qua hoàn toàn, nên người dùng bàn
 * phím không bao giờ biết hai mục này tồn tại. Cách này giữ chúng đọc được,
 * chỉ không kích hoạt.
 */
const ITEMS = [
  {
    label: 'Báo cáo',
    hint: 'Một biểu đồ hoặc bảng số liệu',
    icon: 'M4 19V5m0 14h16M8 15V9m4 6v-4m4 4V7',
  },
  {
    label: 'Sổ báo cáo',
    hint: 'Nhiều báo cáo gom trên một trang',
    icon: 'M4 5h16v14H4V5Zm0 5h16M9 10v9',
  },
];

export function CreateReportMenu(): React.ReactElement {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

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

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
      >
        Tạo báo cáo
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`h-4 w-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-1.5 w-72 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg"
        >
          {ITEMS.map((item) => (
            <div
              key={item.label}
              role="menuitem"
              aria-disabled="true"
              className="flex cursor-not-allowed items-start gap-3 rounded-lg px-3 py-2.5"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="mt-0.5 h-5 w-5 shrink-0 text-slate-300"
                aria-hidden="true"
              >
                <path d={item.icon} />
              </svg>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm font-medium text-slate-400">
                  {item.label}
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-slate-500 uppercase">
                    sắp có
                  </span>
                </p>
                <p className="mt-0.5 text-xs text-slate-400">{item.hint}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
