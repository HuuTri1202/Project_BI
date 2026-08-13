import { ACCEPTED_EXTENSIONS, UPLOAD_MAX_BYTES } from '@bi/shared';
import AwsS3 from '@uppy/aws-s3';
import Uppy from '@uppy/core';
import vi_VN from '@uppy/locales/lib/vi_VN.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getApiError } from '../../../services/apiClient';
import * as api from '../api';

/**
 * Tải file lên S3 bằng Uppy — §7.2 và §7.4.
 *
 * Hook này dựng và giữ instance Uppy; giao diện là component `<Dashboard>` của
 * `@uppy/dashboard`, xem `StepUpload.tsx`.
 *
 * ─── Vì sao KHÔNG dùng apiClient để PUT lên S3 ──────────────────────────────
 *
 * `apiClient` có interceptor gắn `Authorization: Bearer ...` vào mọi request.
 * Presigned URL đã ký sẵn một tập header cố định; thêm một header lạ vào là chữ
 * ký không khớp và S3 trả 403 kèm thông báo chẳng liên quan gì tới quyền. Uppy
 * dùng XHR riêng của nó nên không dính.
 */

export type UploadState =
  | { status: 'idle' }
  | { status: 'uploading'; filename: string; progress: number }
  | { status: 'done'; filename: string; datasetId: number }
  | { status: 'error'; message: string };

export interface UseUppyS3 {
  /**
   * Instance để truyền cho `<Dashboard uppy={...} />`.
   *
   * `null` trong khoảnh khắc giữa lần render đầu và lúc effect khởi tạo chạy —
   * Dashboard chỉ được render khi nó khác `null`.
   */
  uppy: Uppy | null;
  state: UploadState;
  /** Huỷ và quay về trạng thái ban đầu — dùng khi mở lại wizard. */
  reset: () => void;
}

export function useUppyS3(workspaceId: number | null): UseUppyS3 {
  const [state, setState] = useState<UploadState>({ status: 'idle' });

  /**
   * `datasetId` của file đang tải, giữ trong ref chứ không phải state.
   *
   * Nó được gán bên trong callback của Uppy — một closure dựng đúng MỘT lần khi
   * Uppy khởi tạo. Đọc từ state trong đó sẽ luôn thấy giá trị của lần render đầu
   * tiên, đúng cái bẫy stale closure kinh điển.
   */
  const datasetIdRef = useRef<number | null>(null);
  const workspaceRef = useRef(workspaceId);
  workspaceRef.current = workspaceId;

  /**
   * Uppy được dựng TRONG effect và giữ ở state, KHÔNG phải ở ref.
   *
   * ─── Vì sao: StrictMode chạy effect hai lần ─────────────────────────────────
   *
   * Bản đầu của file này dựng Uppy một lần rồi cất vào `useRef`, và dọn bằng
   * `useEffect(() => () => uppy.destroy(), [])`. Ở chế độ dev, StrictMode gọi
   * mount -> unmount -> mount, nên trình tự thật là:
   *
   *   mount    tạo Uppy A, cất vào ref
   *   unmount  cleanup chạy -> A.destroy()
   *   mount    ref VẪN giữ A (ref sống qua remount) -> dùng một Uppy đã chết
   *
   * Uppy đã destroy vẫn NHẬN file mà không ném lỗi, chỉ là không bao giờ tải —
   * không có request nào rời trình duyệt, không có dòng lỗi nào trong console.
   * Người dùng thấy thanh tiến trình đứng ở 0% mãi mãi.
   *
   * Giữ ở state thì mỗi lần mount tạo một instance mới và cleanup chỉ huỷ đúng
   * instance của lượt đó. Đây cùng họ với cái bẫy đã ghi trong
   * `components/charts/VegaChart.tsx`.
   */
  const [uppy, setUppy] = useState<Uppy | null>(null);

  useEffect(() => {
    const instance = new Uppy({
      // Tiếng Việt cho toàn bộ giao diện Dashboard: nhãn nút, thông báo lỗi,
      // đơn vị dung lượng. Không đặt thì Dashboard hiện tiếng Anh lẫn với phần
      // còn lại của app.
      locale: vi_VN,
      autoProceed: true,
      restrictions: {
        // Một file mỗi lần: wizard dựng đúng MỘT bộ dữ liệu, và cho thả năm file
        // rồi im lặng chỉ dùng file đầu là bày ra một cái bẫy.
        maxNumberOfFiles: 1,
        maxFileSize: UPLOAD_MAX_BYTES,
        // §7.3 phía client. Uppy tự từ chối và tự hiện thông báo — đây là lý do
        // hook không còn hàm `validate` viết tay như bản trước.
        allowedFileTypes: [...ACCEPTED_EXTENSIONS],
      },
    }).use(AwsS3, {
      // Một lần PUT cho cả file, không chia phần.
      //
      // Multipart là chế độ MẶC ĐỊNH của plugin này và nó cần thêm bốn endpoint
      // ở backend (tạo phiên, ký từng phần, liệt kê phần, hoàn tất) cùng việc
      // dọn những phiên bỏ dở. Với trần 50MB thì lợi ích duy nhất của multipart —
      // tải tiếp sau khi đứt mạng — không đáng bốn endpoint đó.
      shouldUseMultipart: false,

      // Uppy hỏi ta gửi file đi đâu. Đây là lúc xin presigned URL từ backend —
      // và cũng là lúc bản ghi `datasets` được tạo ở trạng thái `pending`.
      async getUploadParameters(file) {
        const ws = workspaceRef.current;
        if (ws === null) throw new Error('Chưa chọn workspace.');

        const result = await api.createUpload({
          workspaceId: ws,
          filename: file.name,
          fileSize: file.size ?? 0,
        });

        datasetIdRef.current = result.datasetId;

        return {
          method: 'PUT' as const,
          url: result.uploadUrl,
          // PHẢI khớp `ContentType` mà backend đã ký vào URL. Lệch một ký tự là
          // chữ ký không khớp và S3 trả 403.
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
        };
      },
    });

    // Gắn sự kiện TRONG CÙNG effect đã tạo instance, không tách ra effect riêng:
    // tách ra thì có một khoảnh khắc instance đã sống mà chưa ai nghe, và
    // `autoProceed` bắt đầu tải sau 4ms — đủ để bỏ lỡ những mốc tiến trình đầu.
    const onProgress = (
      file: { name?: string } | undefined,
      progress: { bytesUploaded: number; bytesTotal: number | null },
    ): void => {
      const total = progress.bytesTotal ?? 0;
      setState({
        status: 'uploading',
        filename: file?.name ?? '',
        progress: total > 0 ? Math.round((progress.bytesUploaded / total) * 100) : 0,
      });
    };

    const onSuccess = (file: { name?: string } | undefined): void => {
      const datasetId = datasetIdRef.current;
      if (datasetId === null) {
        setState({ status: 'error', message: 'Không nhận được mã bộ dữ liệu từ máy chủ.' });
        return;
      }
      setState({ status: 'done', filename: file?.name ?? '', datasetId });
    };

    const onError = (_file: unknown, error: unknown): void => {
      // Lỗi từ `getUploadParameters` là lỗi HTTP của backend (403 thiếu quyền,
      // 413 file quá lớn) và có envelope đọc được. Lỗi từ chính lần PUT thì
      // không — nó là lỗi mạng hoặc lỗi S3.
      //
      // Dashboard cũng tự hiện lỗi của nó; state ở đây là để wizard biết còn
      // được bấm "Tiếp tục" hay không.
      setState({ status: 'error', message: getApiError(error).message });
    };

    // Người dùng bấm nút xoá file trong Dashboard -> quay về trạng thái đầu,
    // nếu không thì nút "Tiếp tục" vẫn sáng cho một file đã bị gỡ.
    const onRemoved = (): void => {
      datasetIdRef.current = null;
      setState({ status: 'idle' });
    };

    instance.on('upload-progress', onProgress);
    instance.on('upload-success', onSuccess);
    instance.on('upload-error', onError);
    instance.on('file-removed', onRemoved);

    setUppy(instance);

    // Huỷ ĐÚNG instance của lượt mount này. Không có bước này thì đóng wizard
    // giữa chừng vẫn để lại một lần PUT đang bay và một callback gọi `setState`
    // trên component đã unmount.
    return () => {
      instance.destroy();
    };
  }, []);

  const reset = useCallback(() => {
    uppy?.cancelAll();
    datasetIdRef.current = null;
    setState({ status: 'idle' });
  }, [uppy]);

  return { uppy, state, reset };
}
