import { ZOOM_MAX, ZOOM_MIN, zoomStep } from './zoom';

/**
 * Hoàn tác, làm lại, thu phóng — §10.20.
 *
 *   "thêm nút hoàn tác, zoom in, zoom out"
 *
 * Cùng một cụm, đứng cạnh nút "Thêm biểu đồ" trên đầu khung: cả ba đều tác động
 * lên KHUNG chứ không lên một ô, và một chỗ duy nhất để tìm thì dễ nhớ hơn ba chỗ.
 *
 * Nút chỉ có hình, nên tên đầy đủ kèm phím tắt nằm ở `aria-label` VÀ `title`:
 * trình đọc màn hình đọc cái trước, người dùng chuột rê lên thấy cái sau.
 */
export function CanvasTools({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  zoom,
  onZoom,
  zoomDisabled,
}: {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  zoom: number;
  onZoom: (zoom: number) => void;
  /** Khung đang ẩn (Cube chưa chạy) — không có gì để thu phóng. */
  zoomDisabled: boolean;
}): React.ReactElement {
  const percent = Math.round(zoom * 100);

  return (
    <div className="flex items-center gap-2">
      <div role="group" aria-label="Lịch sử thao tác" className={GROUP}>
        <ToolButton label="Hoàn tác (Ctrl+Z)" disabled={!canUndo} onClick={onUndo}>
          <path d="M9 14 4 9l5-5" />
          <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
        </ToolButton>
        <ToolButton label="Làm lại (Ctrl+Y)" disabled={!canRedo} onClick={onRedo}>
          <path d="m15 14 5-5-5-5" />
          <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
        </ToolButton>
      </div>

      <div role="group" aria-label="Thu phóng khung" className={GROUP}>
        <ToolButton
          label="Thu nhỏ"
          disabled={zoomDisabled || zoom <= ZOOM_MIN}
          onClick={() => onZoom(zoomStep(zoom, -1))}
        >
          <path d="M5 12h14" />
        </ToolButton>
        {/* Con số CŨNG là một nút: bấm để về 100%. Đó là chỗ mắt nhìn khi muốn
            "trả lại như cũ", nên đó là chỗ tay bấm. */}
        <button
          type="button"
          onClick={() => onZoom(1)}
          disabled={zoomDisabled || zoom === 1}
          title="Về 100%"
          aria-label={`Mức thu phóng ${percent}%. Bấm để về 100%`}
          className="min-w-[3.25rem] rounded-md px-1.5 py-1 text-xs font-medium text-slate-600 tabular-nums transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:cursor-default disabled:hover:bg-transparent"
        >
          {percent}%
        </button>
        <ToolButton
          label="Phóng to"
          disabled={zoomDisabled || zoom >= ZOOM_MAX}
          onClick={() => onZoom(zoomStep(zoom, 1))}
        >
          <path d="M12 5v14M5 12h14" />
        </ToolButton>
      </div>
    </div>
  );
}

const GROUP = 'flex items-center gap-0.5 rounded-lg border border-slate-200 bg-white px-1 py-0.5';

function ToolButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex h-7 w-7 items-center justify-center rounded-md text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent"
    >
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {children}
      </svg>
    </button>
  );
}
