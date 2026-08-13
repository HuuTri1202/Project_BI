import type { AnalyzeResultDto } from '@bi/shared';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../../components/ui/Button';
import { getApiError } from '../../../services/apiClient';
import { useWorkspace } from '../../../workspace/useWorkspace';
import * as api from '../api';
import { useInvalidateDatasets } from '../hooks';
import { StepChooseData } from './StepChooseData';
import { StepProgress, type ProgressState } from './StepProgress';
import { StepUpload } from './StepUpload';
import { useUppyS3 } from './useUppyS3';

/**
 * Quick Create Report Wizard — §7.1.
 *
 * ─── Vì sao TOÀN BỘ state nằm ở đây ─────────────────────────────────────────
 *
 * Ba component `Step*` là thuần hiển thị: chúng nhận giá trị và gọi callback,
 * không giữ gì. Nhờ vậy điều kiện bật nút "Tiếp tục" sống ở đúng MỘT chỗ
 * (`canAdvance` bên dưới) và đọc được bằng cách nhìn một hàm, thay vì phải mở ba
 * file rồi tự ghép lại trong đầu.
 *
 * ─── Vì sao KHÔNG dùng component Modal có sẵn ───────────────────────────────
 *
 * `components/ui/Modal` dựng sẵn phần tiêu đề và hàng nút ở đáy theo một khuôn
 * cố định. Wizard cần một header khác hẳn: bộ chọn workspace và thanh ba bước
 * nằm CÙNG hàng với tiêu đề. Ở đây vẫn dùng thẻ `<dialog>` gốc với đúng những lý
 * do ghi trong Modal — bẫy tiêu điểm, phím Escape, `inert` cho phần còn lại của
 * trang, lớp nền `::backdrop` — chỉ khác phần ruột.
 */

type StepIndex = 0 | 1 | 2;

/**
 * Nhãn bước 3 là "Tạo bộ dữ liệu", không phải "Tạo báo cáo".
 *
 * Wizard này chỉ nhập dữ liệu vào hệ thống (§7.6). Việc dựng biểu đồ diễn ra
 * sau, trên trang Report. Để nhãn cũ thì thanh bước hứa một thứ mà bước đó
 * không làm.
 */
const STEPS = ['Tải file lên', 'Chọn dữ liệu', 'Tạo bộ dữ liệu'] as const;

const IDLE_PROGRESS: ProgressState = { dataset: 'pending', total: 0 };

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ReportWizard({ open, onClose }: Props): React.ReactElement {
  const navigate = useNavigate();
  const { current, options, select } = useWorkspace();
  const dialogRef = useRef<HTMLDialogElement>(null);

  const [step, setStep] = useState<StepIndex>(0);
  const [analysis, setAnalysis] = useState<AnalyzeResultDto | null>(null);
  /** Tên các sheet được TÍCH — mỗi cái sẽ thành một bộ dữ liệu riêng (§7.5). */
  const [sheets, setSheets] = useState<string[]>([]);
  const [datasetName, setDatasetName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Trạng thái việc của bước 3 (§7.6). */
  const [progress, setProgress] = useState<ProgressState>(IDLE_PROGRESS);

  /**
   * Chốt chống chạy hai lần.
   *
   * Bước 3 tự khởi động bằng một effect, mà StrictMode ở dev gọi effect HAI
   * lần — không có chốt này thì mỗi lần vào bước 3 sẽ nạp dữ liệu và tạo báo cáo
   * gấp đôi. Đúng họ với lỗi Uppy bị destroy đã ghi trong `useUppyS3.ts`.
   */
  const startedRef = useRef(false);

  const upload = useUppyS3(current?.id ?? null);
  const invalidateDatasets = useInvalidateDatasets();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    // Gọi `showModal()` trên hộp thoại đang mở sẽ ném InvalidStateError.
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  /** Về trạng thái ban đầu mỗi lần mở lại, để lần dùng sau không thấy file cũ. */
  useEffect(() => {
    if (open) return;
    setStep(0);
    setAnalysis(null);
    setSheets([]);
    setDatasetName('');
    setProgress(IDLE_PROGRESS);
    startedRef.current = false;
    setError(null);
    upload.reset();
    // `upload` đổi tham chiếu mỗi render; đưa vào deps sẽ chạy vô hạn. Chỉ cần
    // chạy đúng lúc `open` chuyển sang false.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /**
   * Điều kiện bật nút chính — MỘT chỗ duy nhất.
   *
   * Đây là thứ §7.1 gọi là "Next disabled khi chưa đủ điều kiện". Bước 3 không
   * có nút này: nó tự chạy.
   */
  function canAdvance(): boolean {
    if (busy) return false;
    if (step === 0) return upload.state.status === 'done';
    return sheets.length > 0;
  }

  async function goToStep2(): Promise<void> {
    if (upload.state.status !== 'done') return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.analyzeDataset(upload.state.datasetId);
      const first = result.sheets[0];
      if (!first) throw new Error('File không có sheet nào chứa dữ liệu.');

      setAnalysis(result);
      // File một sheet thì tích sẵn — bắt người dùng bấm một ô tích duy nhất
      // trước khi đi tiếp là một bước thừa không mang thông tin gì.
      setSheets(result.sheets.length === 1 ? [first.name] : []);
      setDatasetName(stripExtension(upload.state.filename));
      setStep(1);
    } catch (err) {
      setError(getApiError(err).message);
    } finally {
      setBusy(false);
    }
  }

  function goToStep3(): void {
    setStep(2);
    setError(null);
  }

  /**
   * Bước 3 — hệ thống tự chạy ba việc, hiện trạng thái từng việc (§7.6).
   *
   * ─── Vì sao nối tiếp chứ không `Promise.all` ────────────────────────────────
   *
   * `commit` phải xong TRƯỚC khi tạo báo cáo: backend từ chối dựng báo cáo trên
   * một bộ dữ liệu chưa ở trạng thái `ready` (409 DatasetNotReady). Thứ tự đó là
   * bắt buộc, không phải lựa chọn.
   *
   * Vòng tạo báo cáo cũng tuần tự: pool chỉ có 10 connection, và bắn 20 request
   * cùng lúc để tiết kiệm vài trăm mili-giây trên một thao tác người dùng làm
   * vài lần một tuần là đổi chác sai chiều. Tuần tự còn cho đếm được "2/3" trên
   * màn hình.
   *
   * ─── 3a và 3b thường xong cùng lúc, và đó là sự thật ────────────────────────
   *
   * Nạp dữ liệu và ánh xạ cột sang chiều/thước đo nằm trong CÙNG một lời gọi
   * `commit` — cùng một transaction, cùng một lần parse. Khi phản hồi về thì cả
   * hai đều đã xảy ra, nên cả hai cùng được đánh dấu.
   *
   * Cố ý KHÔNG chèn `setTimeout` để chúng nhấp nháy lần lượt cho "đẹp": một
   * thanh tiến trình nói dối về việc hệ thống đang làm gì thì tệ hơn một thanh
   * tiến trình chạy nhanh.
   *
   * KHÔNG gửi `config` và `chartType` do người dùng chọn: bản cập nhật của §7.6
   * bỏ hết ô nhập ở bước này. Tên báo cáo mặc định là TÊN SHEET, biểu đồ mặc
   * định là biểu đồ cột, trục do backend tự suy từ cột của từng bộ dữ liệu.
   */
  async function runStep3(): Promise<void> {
    if (upload.state.status !== 'done') return;

    setError(null);
    setProgress({ dataset: 'running', total: sheets.length });

    try {
      const datasets = await api.commitDatasets(upload.state.datasetId, {
        name: datasetName.trim(),
        sheets,
      });

      // Dọn cache TRƯỚC khi hiện nút: bấm "Xem bộ dữ liệu" mà danh sách còn là
      // bản cũ thì người dùng nhìn vào một trang không có thứ họ vừa tạo, rồi
      // tin rằng việc nhập đã hỏng.
      await invalidateDatasets();
      setProgress({ dataset: 'done', total: datasets.length });
    } catch (err) {
      setError(getApiError(err).message);
      // Trả về `pending` để màn hình không kẹt ở vòng xoay khi có nút "Thử lại".
      setProgress((p) => ({ ...p, dataset: 'pending' }));
    }
  }

  /**
   * Bước 3 tự khởi động khi vừa vào.
   *
   * `startedRef` là bắt buộc: StrictMode ở dev gọi effect HAI lần, và không có
   * chốt này thì mỗi lần vào bước 3 sẽ nạp dữ liệu và tạo báo cáo gấp đôi.
   */
  useEffect(() => {
    if (step !== 2 || startedRef.current) return;
    startedRef.current = true;
    void runStep3();
    // Chỉ phụ thuộc `step`: mọi giá trị khác đã cố định từ bước 2, và đưa chúng
    // vào deps sẽ khiến effect chạy lại giữa chừng.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  function retry(): void {
    startedRef.current = true;
    void runStep3();
  }

  /**
   * Đưa người dùng sang danh sách bộ dữ liệu (§7.6).
   *
   * KHÔNG mở thẳng một bộ dữ liệu: tích nhiều sheet thì sinh ra nhiều bộ, và
   * chọn hộ một cái để mở là quyết định hộ người dùng. Danh sách cho họ thấy
   * TẤT CẢ những gì vừa tạo.
   */
  function openDatasets(): void {
    onClose();
    navigate('/datasets');
  }

  function handleNext(): void {
    if (step === 0) void goToStep2();
    else goToStep3();
  }

  /**
   * Nhãn nút chính.
   *
   * §7.5 yêu cầu nút ở bước 2 nói rõ SỐ BỘ DỮ LIỆU sẽ sinh ra — đó là thông tin
   * duy nhất cho người dùng biết việc tích 5 sheet nghĩa là gì trước khi bấm.
   */
  function nextLabel(): string {
    if (busy) return 'Đang xử lý…';
    if (step === 0) return 'Tiếp tục';
    // Chỉ còn hai bước có nút này — bước 3 tự chạy và không có chân điều hướng.
    return `Tạo báo cáo từ ${sheets.length} bộ dữ liệu`;
  }

  /** Tổng số dòng của các sheet đã tích — cho người dùng biết quy mô trước khi bấm. */
  const totalRows = (analysis?.sheets ?? [])
    .filter((s) => sheets.includes(s.name))
    .reduce((sum, s) => sum + s.rowCount, 0);

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
      aria-labelledby="wizard-title"
      className="m-auto w-[min(64rem,calc(100vw-2rem))] rounded-2xl border border-slate-200 bg-white p-0 shadow-xl backdrop:bg-slate-900/40"
    >
      <header className="border-b border-slate-100 px-6 pt-5 pb-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="wizard-title" className="text-lg font-semibold text-slate-900">
              Tạo báo cáo nhanh
            </h2>
            <p className="mt-0.5 text-sm text-slate-500">
              Tải file Excel hoặc CSV lên và dựng báo cáo trong ba bước.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="wizard-workspace" className="sr-only">
              Workspace
            </label>
            <select
              id="wizard-workspace"
              value={current?.id ?? ''}
              // Đổi workspace ở bước 0 là hợp lệ. Từ bước 1 trở đi thì không:
              // file đã nằm trong workspace cũ, và đổi sẽ tạo ra một bản ghi trỏ
              // vào một nơi khác với chỗ file thật sự nằm.
              disabled={step > 0}
              onChange={(e) => select(Number(e.target.value))}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200 disabled:bg-slate-100 disabled:text-slate-500"
            >
              {options.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={onClose}
              aria-label="Đóng"
              className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                className="h-5 w-5"
                aria-hidden="true"
              >
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <ol className="mt-4 flex items-center gap-2">
          {STEPS.map((label, index) => (
            <li key={label} className="flex flex-1 items-center gap-2">
              <span
                aria-current={index === step ? 'step' : undefined}
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                  index < step
                    ? 'bg-brand-600 text-white'
                    : index === step
                      ? 'bg-brand-100 text-brand-800 ring-2 ring-brand-500'
                      : 'bg-slate-100 text-slate-400'
                }`}
              >
                {index < step ? '✓' : index + 1}
              </span>
              <span
                className={`truncate text-sm ${
                  index === step ? 'font-medium text-slate-900' : 'text-slate-500'
                }`}
              >
                {label}
              </span>
              {index < STEPS.length - 1 && (
                <span className="h-px flex-1 bg-slate-200" aria-hidden="true" />
              )}
            </li>
          ))}
        </ol>
      </header>

      <div className="px-6 py-5">
        {step === 0 && (
          <StepUpload uppy={upload.uppy} state={upload.state} />
        )}

        {step === 1 && analysis && (
          <StepChooseData analysis={analysis} selected={sheets} onChange={setSheets} />
        )}

        {step === 2 && (
          <StepProgress
            progress={progress}
            error={error}
            onOpenDatasets={openDatasets}
            onRetry={retry}
          />
        )}

        {/* Lỗi của bước 3 hiện NGAY TRONG màn hình tiến trình, cạnh nút "Thử
            lại" — nên chỉ hai bước đầu dùng khối này. */}
        {error !== null && step !== 2 && (
          <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
            {error}
          </p>
        )}
      </div>

      {/* Bước 3 KHÔNG có chân điều hướng: nó tự chạy, và nút duy nhất ở đó —
          "Xem báo cáo" — nằm trong chính màn hình tiến trình, ngay dưới dấu
          tích. Để lại "Quay lại"/"Huỷ" ở đây sẽ mời người dùng bấm giữa lúc
          đang nạp dữ liệu, mà huỷ nửa chừng thì không hoàn tác được. */}
      {step < 2 && (
        <footer className="flex items-center justify-between gap-2 rounded-b-2xl border-t border-slate-100 bg-slate-50 px-6 py-4">
          <span className="text-sm text-slate-500">
            {step === 1 && sheets.length > 0
              ? `${totalRows.toLocaleString('vi-VN')} dòng sẽ được nhập`
              : ''}
          </span>

          <div className="flex gap-2">
            {step > 0 && (
              <Button
                variant="ghost"
                onClick={() => setStep((s) => (s - 1) as StepIndex)}
                disabled={busy}
              >
                Quay lại
              </Button>
            )}
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Huỷ
            </Button>
            <Button variant="primary" onClick={handleNext} disabled={!canAdvance()}>
              {nextLabel()}
            </Button>
          </div>
        </footer>
      )}
    </dialog>
  );
}

function stripExtension(filename: string): string {
  return filename.replace(/\.(csv|xlsx)$/i, '').trim();
}
