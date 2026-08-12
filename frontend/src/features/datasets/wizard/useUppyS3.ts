import { ACCEPTED_EXTENSIONS, UPLOAD_MAX_BYTES } from '@bi/shared';
import AwsS3 from '@uppy/aws-s3';
import Uppy from '@uppy/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getApiError } from '../../../services/apiClient';
import * as api from '../api';

/**
 * Tải file lên S3 bằng Uppy — §7.2 và §7.4.
 *
 * ─── Vì sao dùng lõi Uppy chứ không dùng Dashboard ──────────────────────────
 *
 * `@uppy/dashboard` mang theo giao diện của nó cùng ~200KB CSS/JS, mà §7.2 lại
 * yêu cầu một giao diện rất cụ thể: vùng thả riêng, bốn ô nguồn import với ba ô
 * bị mờ. Dùng Dashboard nghĩa là viết CSS đè lên một giao diện có sẵn để nó
 * trông giống thứ ta cần — nhiều việc hơn là tự dựng.
 *
 * Lõi Uppy là headless. Nó giữ phần khó — hàng đợi, tiến trình theo từng byte,
 * huỷ giữa chừng, thử lại khi mạng chập chờn — và để phần hiển thị cho ta.
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
  state: UploadState;
  /** Kiểm tra phía client rồi đưa file vào hàng đợi. */
  addFile: (file: File) => void;
  /** Huỷ và quay về trạng thái ban đầu — dùng cho nút "Chọn file khác". */
  reset: () => void;
}

/** Thông báo lỗi phía client (§7.3). Kiểm ngay, không tốn một vòng mạng nào. */
function validate(file: File): string | null {
  const lower = file.name.toLowerCase();
  if (!ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
    return 'Chỉ nhận file .csv hoặc .xlsx.';
  }
  if (file.size > UPLOAD_MAX_BYTES) {
    const mb = Math.round(UPLOAD_MAX_BYTES / 1_048_576);
    return `File nặng ${formatMb(file.size)}, vượt quá giới hạn ${mb}MB.`;
  }
  if (file.size === 0) return 'File rỗng.';
  return null;
}

function formatMb(bytes: number): string {
  return `${(bytes / 1_048_576).toFixed(1)}MB`;
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
   * File người dùng chọn TRƯỚC khi Uppy kịp dựng xong.
   *
   * Uppy được tạo trong một effect, nên có một khoảng — ngắn nhưng có thật —
   * giữa lần render đầu và lúc nó sẵn sàng. Thả file đúng khoảnh khắc đó mà
   * không có hàng đợi này thì file bị bỏ rơi im lặng, đúng loại triệu chứng
   * "không thấy gì xảy ra" mà cả tính năng này vừa mắc phải một lần rồi.
   */
  const pendingFileRef = useRef<File | null>(null);

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
      autoProceed: true,
      // Một file mỗi lần: wizard dựng đúng MỘT bộ dữ liệu, và cho thả năm file
      // rồi im lặng chỉ dùng file đầu là bày ra một cái bẫy.
      restrictions: { maxNumberOfFiles: 1, maxFileSize: UPLOAD_MAX_BYTES },
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
      setState({ status: 'error', message: getApiError(error).message });
    };

    instance.on('upload-progress', onProgress);
    instance.on('upload-success', onSuccess);
    instance.on('upload-error', onError);

    setUppy(instance);

    // Người dùng đã thả file trước khi tới được đây -> nhận nó ngay bây giờ.
    const queued = pendingFileRef.current;
    if (queued !== null) {
      pendingFileRef.current = null;
      instance.addFile({ name: queued.name, type: queued.type, data: queued });
    }

    // Huỷ ĐÚNG instance của lượt mount này. Không có bước này thì đóng wizard
    // giữa chừng vẫn để lại một lần PUT đang bay và một callback gọi `setState`
    // trên component đã unmount.
    return () => {
      instance.destroy();
    };
  }, []);

  const addFile = useCallback(
    (file: File) => {
      const problem = validate(file);
      if (problem !== null) {
        setState({ status: 'error', message: problem });
        return;
      }
      datasetIdRef.current = null;
      setState({ status: 'uploading', filename: file.name, progress: 0 });

      if (uppy === null) {
        // Uppy chưa dựng xong. Xếp hàng thay vì báo lỗi hay nuốt im lặng —
        // effect khởi tạo sẽ nhận file này ngay khi nó chạy.
        pendingFileRef.current = file;
        return;
      }

      // Xoá file cũ trước: `maxNumberOfFiles: 1` sẽ từ chối file thứ hai, nên
      // "chọn lại file khác" phải là thay thế chứ không phải thêm vào.
      uppy.cancelAll();

      try {
        uppy.addFile({ name: file.name, type: file.type, data: file });
      } catch (err) {
        setState({ status: 'error', message: getApiError(err).message });
      }
    },
    [uppy],
  );

  const reset = useCallback(() => {
    uppy?.cancelAll();
    pendingFileRef.current = null;
    datasetIdRef.current = null;
    setState({ status: 'idle' });
  }, [uppy]);

  return { state, addFile, reset };
}
