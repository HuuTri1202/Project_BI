import { useEffect, useRef, useState } from 'react';
import { ModelReportModal } from '../datamodels/ModelReportModal';
import { UploadWizard } from '../datasets/wizard/UploadWizard';

/**
 * Nút "Tạo báo cáo" — §4.9, nay chọn theo NGUỒN SỐ LIỆU (§10.8).
 *
 * ═══ Vì sao hai mục là hai NGUỒN, không phải hai loại đầu ra ════════════════
 *
 * Bản trước chia theo thứ sẽ tạo ra: "Báo cáo" với "Sổ báo cáo". Nhưng người
 * dùng đứng trước nút này không đang phân vân giữa một biểu đồ và một trang gom
 * nhiều biểu đồ — họ đang có sẵn một file, hoặc có sẵn một mô hình, và câu hỏi
 * thật là số liệu lấy từ đâu. Hai nhánh đó đi hai đường khác nhau tới tận
 * database, nên đây là chỗ rẽ đúng.
 *
 * Cái mất: "Sổ báo cáo" không còn chỗ trên menu này. Nó vốn chỉ là một nhãn
 * *sắp có*, và giữ một mục không bấm được bên cạnh hai mục chạy được thì mục
 * nào cũng khó đọc hơn.
 *
 * ═══ Trong một mô hình thì không hỏi nữa ═══════════════════════════════════
 *
 * Khi `datamodelId` có mặt (trang Mô hình dữ liệu), nút bỏ hẳn dropdown và mở
 * thẳng hộp thoại cho chính mô hình đang mở. Hỏi "dùng Excel hay dùng mô hình"
 * ngay bên trong một mô hình là hỏi một câu người dùng đã trả lời bằng việc mở
 * trang đó ra.
 */
const ITEMS = [
  {
    key: 'file' as const,
    label: 'Dùng file Excel/CSV',
    hint: 'Tải file lên để tạo bộ dữ liệu, rồi dựng mô hình trên nó',
    icon: 'M13 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9l-6-6Zm0 0v6h6',
  },
  {
    key: 'model' as const,
    label: 'Dùng mô hình dữ liệu',
    hint: 'Chọn chiều và thước đo đã khai trong mô hình',
    icon: 'M4 7h6V4H4v3Zm10 13h6v-3h-6v3Zm0-6.5h6v-3h-6v3ZM7 7v10.5h7M7 11h7',
  },
];

export function CreateReportMenu({
  datamodelId,
}: {
  /** Có mặt = đang đứng trong một mô hình; nút không hỏi nguồn nữa. */
  datamodelId?: number | undefined;
} = {}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
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

  // Trong một mô hình: một nút thường, không dropdown. Xem ghi chú đầu file.
  if (datamodelId !== undefined) {
    return (
      <>
        <button
          type="button"
          onClick={() => setModelOpen(true)}
          className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
        >
          Tạo báo cáo
        </button>
        <ModelReportModal
          open={modelOpen}
          onClose={() => setModelOpen(false)}
          datamodelId={datamodelId}
        />
      </>
    );
  }

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
            <button
              key={item.key}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                if (item.key === 'file') setWizardOpen(true);
                else setModelOpen(true);
              }}
              className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-slate-50"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="mt-0.5 h-5 w-5 shrink-0 text-brand-600"
                aria-hidden="true"
              >
                <path d={item.icon} />
              </svg>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-slate-900">{item.label}</span>
                <span className="mt-0.5 block text-xs text-slate-500">{item.hint}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      <UploadWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />
      <ModelReportModal open={modelOpen} onClose={() => setModelOpen(false)} />
    </div>
  );
}
