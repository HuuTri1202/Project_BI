import { FILE_ACCEPT_ATTR, UPLOAD_MAX_BYTES } from '@bi/shared';
import { useRef, useState } from 'react';
import { Button } from '../../../components/ui/Button';
import type { UploadState } from './useUppyS3';

/**
 * Bước 1 — tải file Excel/CSV lên (§7.2).
 *
 * ─── Chỉ MỘT nguồn: file từ máy người dùng ──────────────────────────────────
 *
 * Google Drive, OneDrive và SharePoint đã được bỏ hẳn khỏi giao diện — không
 * hiện mờ, không nhãn "sắp có".
 *
 * Cả khối "Hoặc lấy từ" cũng bỏ luôn: còn đúng một ô "Máy của tôi" thì nó chỉ
 * lặp lại việc mà vùng kéo thả ngay trên đã làm, và hai chỗ bấm cho cùng một
 * hành động chỉ khiến người dùng dừng lại tự hỏi chúng khác nhau chỗ nào.
 *
 * Bản Google Drive đã viết xong nhưng gỡ đi vì nó đòi mỗi người triển khai phải
 * tự tạo OAuth client trong tài khoản Google của mình — không có khoá thì nút
 * chỉ là một chỗ bấm rồi báo lỗi. Code còn trong lịch sử git nếu cần lấy lại.
 */

interface Props {
  state: UploadState;
  onPick: (file: File) => void;
  onReset: () => void;
}

export function StepUpload({ state, onPick, onReset }: Props): React.ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function handleDrop(event: React.DragEvent): void {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) onPick(file);
  }

  const maxMb = Math.round(UPLOAD_MAX_BYTES / 1_048_576);

  return (
    <div>
      <div
        onDragOver={(e) => {
          // Không chặn mặc định thì trình duyệt MỞ file trong tab mới thay vì
          // báo sự kiện drop — cả vùng thả thành vô dụng.
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={`rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
          dragging ? 'border-brand-500 bg-brand-50' : 'border-slate-300 bg-slate-50'
        }`}
      >
        {state.status === 'uploading' ? (
          <UploadProgress filename={state.filename} percent={state.progress} />
        ) : state.status === 'done' ? (
          <UploadDone filename={state.filename} onReset={onReset} />
        ) : (
          <>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="mx-auto h-10 w-10 text-slate-400"
              aria-hidden="true"
            >
              <path d="M12 16V4m0 0L8 8m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
            </svg>
            <p className="mt-3 text-sm font-medium text-slate-700">Kéo thả file vào đây</p>
            <p className="mt-1 text-sm text-slate-500">
              hoặc{' '}
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="font-medium text-brand-700 underline underline-offset-2 hover:text-brand-800"
              >
                chọn file từ máy
              </button>
            </p>
            <p className="mt-3 text-xs text-slate-400">
              Chấp nhận .xlsx và .csv, tối đa {maxMb}MB
            </p>
          </>
        )}

        <input
          ref={inputRef}
          type="file"
          accept={FILE_ACCEPT_ATTR}
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onPick(file);
            // Đặt lại giá trị để chọn LẠI CÙNG một file vẫn kích hoạt onChange.
            // Không có dòng này thì người dùng sửa file rồi chọn lại sẽ không
            // thấy gì xảy ra.
            e.target.value = '';
          }}
        />
      </div>

      {state.status === 'error' && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
          {state.message}
        </p>
      )}

    </div>
  );
}

function UploadProgress({ filename, percent }: { filename: string; percent: number }) {
  return (
    <div>
      <p className="truncate text-sm font-medium text-slate-700">{filename}</p>
      <div
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Tiến trình tải lên"
        className="mx-auto mt-3 h-2 w-full max-w-sm overflow-hidden rounded-full bg-slate-200"
      >
        <div
          className="h-full rounded-full bg-brand-600 transition-[width] duration-200"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="mt-2 text-sm text-slate-500 tabular-nums">Đang tải lên… {percent}%</p>
    </div>
  );
}

function UploadDone({ filename, onReset }: { filename: string; onReset: () => void }) {
  return (
    <div>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="mx-auto h-10 w-10 text-green-600"
        aria-hidden="true"
      >
        <path d="M20 6 9 17l-5-5" />
      </svg>
      <p className="mt-3 truncate text-sm font-medium text-slate-900">{filename}</p>
      <p className="mt-1 text-sm text-slate-500">Đã tải lên xong. Bấm Tiếp tục để chọn dữ liệu.</p>
      <div className="mt-3">
        <Button size="sm" variant="ghost" onClick={onReset}>
          Chọn file khác
        </Button>
      </div>
    </div>
  );
}
