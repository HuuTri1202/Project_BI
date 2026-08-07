/**
 * Màn hình chờ khi đang khôi phục phiên (§2.5).
 *
 * `role="status"` + `aria-live="polite"` để trình đọc màn hình thông báo đang
 * tải; vòng xoay thuần CSS thì người khiếm thị không biết chuyện gì đang xảy ra.
 */
export function FullPageLoader({ label = 'Đang tải…' }: { label?: string }): React.ReactElement {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50"
    >
      <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-brand-200 border-t-brand-600" />
      <p className="text-sm text-slate-500">{label}</p>
    </div>
  );
}
