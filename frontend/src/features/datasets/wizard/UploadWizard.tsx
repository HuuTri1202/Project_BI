import { LOAD_STATUSES_LIVE, type AnalyzeResultDto, type DatasetDetailDto } from '@bi/shared';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../../components/ui/Button';
import { getApiError } from '../../../services/apiClient';
import { useWorkspace } from '../../../workspace/useWorkspace';
import * as datamodelApi from '../../datamodels/api';
import * as tenantApi from '../../tenant/api';
import * as api from '../api';
import { useInvalidateDatasets } from '../hooks';
import { StepChooseData } from './StepChooseData';
import { StepProgress, type ProgressState } from './StepProgress';
import { StepUpload } from './StepUpload';
import { useUppyS3 } from './useUppyS3';

/**
 * Hộp thoại tải file lên để tạo bộ dữ liệu — §7.1.
 *
 * ─── Tên cũ là `ReportWizard`, và cái tên đó nói dối ────────────────────────
 *
 * Nó chưa từng tạo ra một báo cáo nào: bước 3 gọi đúng một hàm, `commitDatasets`,
 * rồi đưa người dùng sang `/datasets`. Bản trước đã sửa nhãn bước 3 và cả màn
 * hình tiến trình cho đúng, nhưng tiêu đề hộp thoại vẫn là "Tạo báo cáo nhanh".
 * Nay hộp thoại này còn mở từ nút "Tạo bộ dữ liệu" trên trang Kho dữ liệu, nên
 * một cái tên hứa sai là thứ người dùng gặp ngay khi bấm.
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

/**
 * Wizard này phục vụ HAI đích, và đích quyết định bước cuối làm gì.
 *
 *   'dataset'  nạp file vào Kho dữ liệu rồi thôi. Xong thì mở danh sách bộ dữ
 *              liệu. Đây là đường vào từ mục Kho dữ liệu.
 *   'report'   nạp file, rồi DỰNG HỘ một mô hình ẩn trên đúng các sheet vừa
 *              tích và đi thẳng vào trình dựng báo cáo. Đây là đường vào từ
 *              nút "Tạo nhanh với file Excel/CSV".
 *
 * Một wizard hai đích chứ không phải hai wizard: ba bước đầu giống hệt nhau tới
 * từng câu chữ, và hai bản sao của một luồng tải file sẽ lệch nhau ngay lần đầu
 * ai đó sửa một bên.
 */
export type UploadGoal = 'dataset' | 'report';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Mặc định `'dataset'` — giữ nguyên hành vi của mọi nơi gọi cũ. */
  goal?: UploadGoal;
}

export function UploadWizard({ open, onClose, goal = 'dataset' }: Props): React.ReactElement {
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
  /**
   * Bộ dữ liệu đã commit xong của lần vào bước 3 này.
   *
   * Bắt buộc, không phải tối ưu: nút "Thử lại" gọi lại cả `runStep3`, và nếu
   * bước dựng mô hình hỏng SAU khi commit đã xong thì lần thử thứ hai sẽ nạp
   * cùng một file thành một bộ dữ liệu thứ hai. Người dùng bấm Thử lại để
   * chữa một lỗi, không phải để nhân đôi dữ liệu.
   */
  const committedRef = useRef<{ id: number }[] | null>(null);

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
   * File MỚI bắt đầu tải lên thì lỗi của file cũ hết hiệu lực.
   *
   * Lỗi chỉ được dọn trong `goToStep2`, tức là lúc bấm "Tiếp tục". Ai bị từ chối
   * một file rồi thả file khác vào sẽ thấy câu báo lỗi của file TRƯỚC nằm ngay
   * dưới file mới — và cùng lúc đó dòng xanh mời bấm "Tiếp tục" lại biến mất,
   * vì `rejected` vẫn còn bật. Giao diện trông như đã từ chối luôn file mới,
   * trước khi kịp đọc nó một chữ nào.
   */
  useEffect(() => {
    if (upload.state.status === 'uploading') setError(null);
  }, [upload.state.status]);

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
   * Lối ra khi file bị từ chối — trả Dashboard về vùng kéo thả.
   *
   * ─── Không có nút này thì bước 1 là một ngõ cụt ────────────────────────────
   *
   * Uppy tải xong là chuyển sang trạng thái "hoàn tất": danh sách file thay chỗ
   * vùng kéo thả, và cái `input[type=file]` biến mất khỏi DOM luôn. File vừa bị
   * bước sau từ chối thì người dùng còn đúng hai lựa chọn: bấm "Tiếp tục" để
   * hỏng lại y hệt, hoặc "Huỷ" rồi mở lại hộp thoại từ đầu.
   *
   * `upload.reset()` gọi `uppy.cancelAll()`, nên vùng kéo thả quay lại và họ thả
   * được file khác ngay tại chỗ.
   */
  function pickAnother(): void {
    setError(null);
    upload.reset();
  }

  /**
   * Bước 3 — hệ thống tự chạy, không hỏi gì thêm (§7.6).
   *
   * Đúng MỘT lời gọi: `commitDatasets` đọc các sheet đã tích, nạp dòng vào hệ
   * thống và ánh xạ cột sang chiều/thước đo trong cùng một transaction. Nên khi
   * phản hồi về là mọi việc đã xong — không có giai đoạn nào để hiện lần lượt.
   *
   * Cố ý KHÔNG chèn `setTimeout` để các dấu tích nhấp nháy nối nhau cho "đẹp":
   * một thanh tiến trình nói dối về việc hệ thống đang làm gì thì tệ hơn một
   * thanh tiến trình chạy nhanh.
   *
   * KHÔNG dựng báo cáo ở đây, và chỉ dựng mô hình khi `goal === 'report'`.
   *
   * ─── Vì sao mô hình chỉ dựng ở đúng nhánh đó ─────────────────────────────
   *
   * Hệ thống đã từng tự dựng mô hình ở đuôi MỌI lần nạp, và migration 20 bỏ
   * hẳn nó: máy không biết những bảng nào đáng hỏi cùng nhau, nó chỉ biết
   * chúng đi chung một file — trùng hợp về xuất xứ, không phải quan hệ về
   * nghĩa. Đo trên dữ liệu thật khi đó: 15 mô hình tự sinh, 12 cái bị xoá.
   *
   * Nhánh `report` khác ở chỗ người dùng đã tự trả lời đúng câu đó: họ bấm
   * "Tạo nhanh với file Excel/CSV" rồi tích đúng những sheet họ muốn báo cáo
   * trên đó. Mô hình ở đây là bước trung gian của một thao tác vừa được yêu
   * cầu — nhưng nó vẫn là mô hình CỦA HỌ, nên nó được lưu và bày ra như mọi mô
   * hình khác. Migration 31 từng giấu nó; migration 32 đảo lại, và ở đó có lý
   * do đầy đủ.
   */
  async function runStep3(): Promise<void> {
    if (upload.state.status !== 'done') return;

    setError(null);
    setProgress({ dataset: 'running', total: sheets.length });

    try {
      const datasets =
        committedRef.current ??
        (await api.commitDatasets(upload.state.datasetId, {
          name: datasetName.trim(),
          sheets,
        }));
      committedRef.current = datasets;

      // Dọn cache TRƯỚC khi hiện nút: bấm "Xem bộ dữ liệu" mà danh sách còn là
      // bản cũ thì người dùng nhìn vào một trang không có thứ họ vừa tạo, rồi
      // tin rằng việc nhập đã hỏng.
      await invalidateDatasets();

      /*
       * Nhánh báo cáo KHÔNG được đánh dấu 'done' ở đây.
       *
       * Hai lý do, và cả hai đã cắn thật:
       *
       *   1. Việc chưa xong. Còn phải chờ nạp vào kho phân tích rồi dựng mô
       *      hình; đánh dấu xong lúc này là hứa sai.
       *   2. `StepProgress` ở trạng thái 'done' RETURN SỚM và không render
       *      `error`. Nên một lỗi xảy ra sau đó sẽ được ghi vào state mà không
       *      bao giờ hiện ra: người dùng nhìn dấu tích xanh và không hiểu vì
       *      sao trang không chuyển. Đúng cái đã xảy ra khi dựng tính năng này.
       */
      if (goal === 'report') {
        await buildQuickModel(datasets);
        return;
      }

      setProgress({ dataset: 'done', total: datasets.length });
    } catch (err) {
      setError(getApiError(err).message);
      // Trả về `pending` để màn hình không kẹt ở vòng xoay khi có nút "Thử lại".
      setProgress((p) => ({ ...p, dataset: 'pending' }));
    }
  }

  /**
   * Chờ mọi bộ dữ liệu vào xong KHO PHÂN TÍCH.
   *
   * ─── Vì sao phải chờ ────────────────────────────────────────────────────
   *
   * `commitDatasets` trả về ngay khi dòng đã vào MySQL; việc nạp sang ClickHouse
   * chạy TIẾP SAU đó. Dựng mô hình trước lúc ấy thì backend trả 409
   * `DatasetNotLoaded` — "chưa được nạp vào kho phân tích nên chưa dựng mô hình
   * lên được". Không phải giả thuyết: đây đúng là lỗi 409 nhận được ở lần chạy
   * thử đầu tiên của luồng này.
   *
   * Hỏi lại mỗi 1,5 giây thay vì một lần `setTimeout` đủ dài: thời gian nạp phụ
   * thuộc số dòng, và chọn một con số cố định là chọn sai cho một trong hai
   * phía — hoặc bắt file nhỏ chờ vô cớ, hoặc bỏ cuộc trước khi file lớn xong.
   *
   * Trần 90 giây để vòng lặp có điểm dừng. Hết trần thì nói thật là chưa xong
   * chứ không dựng mô hình bừa lên một cái bảng chưa có.
   */
  async function waitLoaded(ids: number[]): Promise<void> {
    const deadline = Date.now() + 90_000;

    for (;;) {
      const states = await Promise.all(ids.map((id) => tenantApi.fetchDataset(id)));

      const failed = states.find((d) => d.loadStatus === 'failed');
      if (failed !== undefined) {
        throw new Error(
          `Bộ dữ liệu "${failed.name}" nạp vào kho phân tích không thành công, nên chưa dựng được báo cáo. Xem chi tiết ở mục Kho dữ liệu.`,
        );
      }

      if (states.every((d) => d.loadStatus === 'loaded')) return;

      const stuck = states.filter((d) => !LOAD_STATUSES_LIVE.includes(d.loadStatus));
      if (Date.now() > deadline) {
        throw new Error(
          stuck.length > 0
            ? `Bộ dữ liệu "${(stuck[0] as DatasetDetailDto).name}" vẫn chưa được nạp vào kho phân tích. Mở mục Kho dữ liệu và bấm "Nạp vào kho phân tích".`
            : 'Dữ liệu vẫn đang được nạp vào kho phân tích. Thử lại sau một lát.',
        );
      }

      await new Promise((resolve) => setTimeout(resolve, 1_500));
    }
  }

  /**
   * Dựng mô hình ẩn trên các bộ dữ liệu vừa nạp, rồi vào trình dựng.
   *
   * `workspaceId` gửi TƯỜNG MINH: backend có nhánh dự phòng nhưng nhánh đó chọn
   * workspace đầu tiên theo tên, không liên quan nơi người dùng đang đứng — mô
   * hình sẽ rơi vào workspace khác và biến mất ngay sau khi tạo.
   *
   * Lỗi ở đây KHÔNG làm mất phần đã xong: bộ dữ liệu đã nạp và đã hiện trong Kho
   * dữ liệu rồi. Nên câu thông báo mở đầu bằng đúng điều đó, và `committedRef`
   * lo cho việc "Thử lại" không nạp lại file lần nữa.
   */
  async function buildQuickModel(datasets: { id: number }[]): Promise<void> {
    if (current === null) {
      setError('Chưa có workspace nào đang mở, nên chưa dựng được mô hình cho báo cáo.');
      setProgress((prev) => ({ ...prev, dataset: 'pending' }));
      return;
    }

    try {
      await waitLoaded(datasets.map((d) => d.id));

      const model = await datamodelApi.createDataModel({
        workspaceId: current.id,
        name: datasetName.trim(),
        datasetIds: datasets.map((d) => d.id),
      });
      onClose();
      navigate(`/datamodels/${model.id}/report/new`);
    } catch (err) {
      setError(`Đã nạp xong dữ liệu, nhưng chưa dựng được báo cáo: ${getApiError(err).message}`);
      // Về 'pending' để câu lỗi HIỆN RA: nhánh 'done' của `StepProgress` không
      // render `error`.
      setProgress((prev) => ({ ...prev, dataset: 'pending' }));
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
    //
    // Nhánh báo cáo nói thêm đích đến: người bấm nút này đang chờ một báo cáo, và
    // "Tạo 2 bộ dữ liệu" nghe như họ bấm nhầm sang mục Kho dữ liệu.
    if (goal === 'report') return `Nạp ${sheets.length} sheet rồi dựng báo cáo`;
    return `Tạo ${sheets.length} bộ dữ liệu`;
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
              Tạo bộ dữ liệu từ file
            </h2>
            <p className="mt-0.5 text-sm text-slate-500">
              Tải file Excel hoặc CSV lên, chọn sheet, hệ thống nhập vào Kho dữ liệu.
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
                      ? 'text-brand-800 bg-brand-100 ring-2 ring-brand-500'
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
          <StepUpload uppy={upload.uppy} state={upload.state} rejected={error !== null} />
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
            lại" — nên chỉ hai bước đầu dùng khối này.

            Lối ra nằm CÙNG khối với lý do, không tách ra một chỗ khác: đọc xong
            "không đọc được file này" thì việc cần làm tiếp theo phải ở ngay đó. */}
        {error !== null && step !== 2 && (
          <div
            role="alert"
            className="mt-4 flex items-center justify-between gap-3 rounded-lg bg-red-50 px-3.5 py-2.5 text-sm text-red-700"
          >
            <span>{error}</span>
            {step === 0 && upload.state.status === 'done' && (
              <button
                type="button"
                onClick={pickAnother}
                className="shrink-0 font-medium text-red-800 underline underline-offset-2 hover:text-red-900"
              >
                Chọn file khác
              </button>
            )}
          </div>
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
