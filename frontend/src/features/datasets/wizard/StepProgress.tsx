import { Button } from '../../../components/ui/Button';

/**
 * Bước 3 — hệ thống tự chạy, hiện trạng thái (§7.6).
 *
 * Không có ô nhập nào: người dùng đã chốt xong mọi thứ ở bước 2. Màn hình này
 * chỉ trả lời một câu hỏi — "đang làm gì, và xong chưa".
 *
 * ─── Bước này CHỈ tạo bộ dữ liệu ────────────────────────────────────────────
 *
 * Không tạo báo cáo, không dựng biểu đồ. Bản trước của màn hình này tự suy trục
 * rồi vẽ luôn một biểu đồ cột — nó chạy được, nhưng trả lời hộ một câu hỏi chưa
 * ai đặt ra. Việc dựng biểu đồ là của người dùng, trên trang Report.
 */

export type PhaseState = 'pending' | 'running' | 'done';

export interface ProgressState {
  dataset: PhaseState;
  /** Số bộ dữ liệu sẽ tạo — bằng số sheet đã tích ở bước 2. */
  total: number;
}

interface Props {
  progress: ProgressState;
  error: string | null;
  onOpenDatasets: () => void;
  onRetry: () => void;
}

export function StepProgress({
  progress,
  error,
  onOpenDatasets,
  onRetry,
}: Props): React.ReactElement {
  const multi = progress.total > 1;

  if (progress.dataset === 'done') {
    return (
      <div className="py-6 text-center">
        <span
          aria-hidden="true"
          className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-9 w-9 text-green-600"
          >
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </span>

        <h3 className="mt-4 text-lg font-semibold text-slate-900">
          {multi
            ? `Đã tạo ${progress.total} bộ dữ liệu thành công!`
            : 'Đã tạo bộ dữ liệu thành công!'}
        </h3>
        <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">
          Dữ liệu đã được nhập vào hệ thống. Mở bộ dữ liệu để bắt đầu dựng báo cáo.
        </p>

        <ProgressBar percent={100} done />

        <div className="mt-5">
          <Button variant="primary" onClick={onOpenDatasets}>
            Xem bộ dữ liệu
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="py-4">
      <ul className="space-y-3">
        <li className="flex items-start gap-3">
          <PhaseIcon state={progress.dataset} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-slate-900">
              {multi ? `Đang tạo ${progress.total} bộ dữ liệu…` : 'Đang tạo bộ dữ liệu…'}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              Đọc dữ liệu từ sheet đã chọn và nạp vào hệ thống. File lớn có thể mất một lúc.
            </p>
          </div>
        </li>
      </ul>

      <ProgressBar percent={progress.dataset === 'running' ? 60 : 0} />

      {error !== null && (
        <div className="mt-5">
          <p role="alert" className="rounded-lg bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
            {error}
          </p>
          <div className="mt-3">
            <Button variant="primary" onClick={onRetry}>
              Thử lại
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Thanh tiến trình.
 *
 * Lúc đang chạy đứng ở 60% chứ không bò dần: việc nạp dữ liệu diễn ra trong MỘT
 * lời gọi, nên ta không biết nó đã xong bao nhiêu phần. Một thanh tự bò lên
 * theo đồng hồ là bịa ra thông tin — nó sẽ tới 99% rồi đứng đó, và người dùng
 * tin rằng hệ thống treo.
 */
function ProgressBar({ percent, done = false }: { percent: number; done?: boolean }) {
  return (
    <div
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Tiến trình tạo bộ dữ liệu"
      className="mt-6 h-2 w-full overflow-hidden rounded-full bg-slate-200"
    >
      <div
        className={`h-full rounded-full transition-[width] duration-300 ${
          done ? 'bg-green-600' : 'bg-brand-600'
        }`}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

function PhaseIcon({ state }: { state: PhaseState }): React.ReactElement {
  if (state === 'done') {
    return (
      <span
        aria-hidden="true"
        className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green-100"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-3 w-3 text-green-600"
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </span>
    );
  }

  if (state === 'running') {
    return (
      <span
        aria-hidden="true"
        className="mt-0.5 h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600"
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className="mt-0.5 h-5 w-5 shrink-0 rounded-full border-2 border-slate-200"
    />
  );
}
