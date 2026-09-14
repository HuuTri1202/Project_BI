import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
 * Khi `datamodelId` có mặt (trang Mô hình dữ liệu), nút bỏ hẳn dropdown và đi
 * THẲNG tới trình dựng biểu đồ của chính mô hình đang mở. Hỏi "dùng Excel hay
 * dùng mô hình" ngay bên trong một mô hình là hỏi một câu người dùng đã trả lời
 * bằng việc mở trang đó ra.
 *
 * ═══ §10.10: nhánh "mô hình" đi thẳng tới khu Báo cáo ══════════════════════
 *
 * Trước bản này nó mở `PickDataModelModal` để hỏi "mô hình nào" rồi mới sang
 * trình dựng. Từ khi trình dựng có màn chọn mô hình NGAY TRONG trang, hộp thoại
 * đó là câu hỏi thứ hai cho cùng một thứ — và hai chỗ hỏi là hai bộ luật sẽ
 * lệch nhau ngay lần đầu thêm một lựa chọn. Hộp thoại đã bị xoá.
 *
 * ═══ Nhánh FILE giờ đi tới trình dựng, không dừng ở Kho dữ liệu ════════════
 *
 * Trước bản này, "dùng file Excel/CSV" chỉ mở wizard nạp dữ liệu rồi thả người
 * dùng ở danh sách bộ dữ liệu — còn đúng hai bước nữa (dựng mô hình, mở trình
 * dựng) mà không có gì nói ra. Nút hứa "tạo báo cáo" và giao lại một bộ dữ liệu.
 *
 * Nay wizard dựng hộ một mô hình trên đúng các sheet vừa tích rồi vào thẳng
 * trình dựng. Mô hình đó được LƯU và bày ra như mọi mô hình khác (§10.13) — xem
 * `UploadWizard` để biết vì sao việc này KHÔNG phải là mang cơ chế tự sinh mô
 * hình (migration 19/20) trở lại.
 *
 * ═══ Không còn hộp thoại hỏi cấu hình ══════════════════════════════════════
 *
 * Tới §10.8, nút này mở một hộp thoại hỏi chiều, thước đo, loại biểu đồ và tên,
 * rồi tạo báo cáo. §10.9 chuyển cả bốn câu đó sang trình dựng — nơi có khung
 * xem trước để trả lời chúng bằng mắt thay vì bằng phỏng đoán. Giữ lại hộp
 * thoại cũ nghĩa là hai đường tạo cùng một thứ, và người dùng đi đường nào thì
 * cũng chỉ biết một nửa những gì làm được.
 */
const ITEMS = [
  {
    key: 'file' as const,
    label: 'Tạo nhanh với file Excel/CSV',
    hint: 'Tải file lên rồi vào thẳng trình dựng — không phải cấu hình mô hình',
    icon: 'M13 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9l-6-6Zm0 0v6h6',
  },
  {
    key: 'model' as const,
    label: 'Tạo từ mô hình dữ liệu có sẵn',
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
  const rootRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

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

  // Trong một mô hình: một nút thường, không dropdown, không hộp thoại. Xem
  // ghi chú đầu file.
  if (datamodelId !== undefined) {
    return (
      <button
        type="button"
        onClick={() => navigate(`/datamodels/${datamodelId}/report/new`)}
        className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
      >
        Tạo báo cáo
      </button>
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
                else void navigate('/reports/new');
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

      {/* `goal="report"` là toàn bộ điểm khác của nhánh này: wizard nạp file
          như thường, rồi dựng hộ một mô hình ẩn trên đúng các sheet vừa tích và
          đi thẳng vào trình dựng. Xem `UploadWizard`. */}
      <UploadWizard open={wizardOpen} onClose={() => setWizardOpen(false)} goal="report" />
    </div>
  );
}
