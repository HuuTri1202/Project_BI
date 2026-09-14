import type { ReactNode } from 'react';

/**
 * Khung TOÀN MÀN HÌNH của một báo cáo — dùng chung cho trang xem và trình dựng.
 *
 * ═══ Vì sao một file, không phải hai ════════════════════════════════════════
 *
 * Từ §10.13 mở một báo cáo là hai trang nối nhau: `/reports/:id` để XEM, rồi
 * bấm "Chỉnh sửa" sang `/reports/:id/edit` để SỬA. Hai trang đó phải trông như
 * một chỗ — cùng chiều cao thanh trên, cùng chỗ đặt mũi tên ←, cùng chỗ đặt
 * tên báo cáo. Lệch một nhịp thôi thì cú bấm "Chỉnh sửa" đọc ra như một cú nhảy
 * sang màn hình khác, và người dùng phải tìm lại mọi thứ.
 *
 * Cùng lập luận với `CanvasGrid`, nơi trình dựng và trang xem cũng dùng chung
 * đúng một cái lưới.
 *
 * ═══ Ba thứ nó phải tự lo ═══════════════════════════════════════════════════
 *
 * Cả hai trang đứng NGOÀI `UserLayout` (xem khối route toàn màn hình trong
 * `App.tsx`), nên không còn sidebar làm hộ:
 *
 *   1. LỐI RA. Mũi tên ← là đường về duy nhất và không được vắng mặt ở bất kỳ
 *      trạng thái nào — kể cả màn hình lỗi.
 *   2. CHIỀU CAO. `h-screen` bắt đầu lại chuỗi chiều cao mà `UserLayout` vẫn
 *      giữ hộ; đứt ở đây thì mọi `h-full` bên dưới vô nghĩa — kể cả phép đo ô
 *      của `ReportChart`.
 *   3. `min-h-0` ở `main`. Thiếu nó thì một khung dài đẩy cả trang cao lên thay
 *      vì cuộn bên trong, và thanh thẻ trang ghim ở đáy trôi mất.
 */
export function ReportShell({
  onExit,
  exitLabel = 'Quay lại danh sách báo cáo',
  title,
  actions,
  children,
}: {
  /** Mũi tên ← góc trái. Luôn có, kể cả ở màn hình lỗi — đây là đường về duy nhất. */
  onExit: () => void;
  /**
   * Mũi tên ← đi đâu, nói bằng lời.
   *
   * Đích KHÔNG giống nhau giữa hai trang: trang xem về danh sách, còn trình dựng
   * về chính báo cáo đang sửa. Một nhãn cố định sẽ nói sai ở một trong hai chỗ,
   * và nói sai với người dùng trình đọc màn hình là nói sai với đúng người
   * không kiểm chứng lại được bằng mắt.
   */
  exitLabel?: string;
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}): React.ReactElement {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-50">
      <header className="z-30 flex h-14 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3 sm:gap-3 sm:px-4">
        <button
          type="button"
          onClick={onExit}
          aria-label={exitLabel}
          title="Quay lại"
          className="-ml-1 shrink-0 rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-5 w-5"
            aria-hidden="true"
          >
            <path d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <div aria-hidden="true" className="h-6 w-px shrink-0 bg-slate-200" />

        <div className="max-w-md min-w-0 flex-1">{title}</div>

        {actions !== undefined && (
          <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>
        )}
      </header>

      <main className="flex min-h-0 flex-1 flex-col p-3 sm:p-4">{children}</main>
    </div>
  );
}
