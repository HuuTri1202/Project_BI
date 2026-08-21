import { UPLOAD_MAX_BYTES } from '@bi/shared';
import type Uppy from '@uppy/core';
import Dashboard from '@uppy/react/dashboard';
import type { UploadState } from './useUppyS3';

/**
 * Bước 1 — tải file Excel/CSV lên (§7.2).
 *
 * ─── Giao diện là Dashboard của Uppy, không phải bản tự viết ────────────────
 *
 * Vùng kéo thả, danh sách file, thanh tiến trình, nút huỷ và nút thử lại đều do
 * `@uppy/dashboard` dựng. Ta chỉ cấu hình nó và đặt một khung bao quanh.
 *
 * Đổi lại việc mất quyền kiểm soát chi tiết bố cục, ta được những thứ mà một
 * bản tự viết phải làm lại từ đầu và thường làm thiếu: hiện phần trăm cùng tốc
 * độ và thời gian còn lại, huỷ giữa chừng, thử lại đúng file hỏng, thông báo
 * lỗi theo từng file, dán file từ clipboard, và toàn bộ phần điều hướng bằng
 * bàn phím cùng nhãn cho trình đọc màn hình.
 *
 * Tiếng Việt lấy từ `@uppy/locales/lib/vi_VN` — cấu hình ở `useUppyS3.ts`, để
 * Dashboard không hiện tiếng Anh lẫn với phần còn lại của app.
 *
 * ─── Chỉ MỘT nguồn: file từ máy người dùng ──────────────────────────────────
 *
 * Google Drive, OneDrive và SharePoint đã bỏ khỏi §7.2. Uppy có plugin sẵn cho
 * cả ba, nhưng chúng đòi dựng thêm một server Companion và đăng ký OAuth app —
 * xem lịch sử git nếu cần lấy lại.
 */

interface Props {
  uppy: Uppy | null;
  state: UploadState;
  /**
   * File đã lên tới nơi, nhưng bước sau ĐÃ TỪ CHỐI nó (không đọc được nội dung,
   * không có hàng tiêu đề…).
   *
   * ─── Vì sao cần một cờ riêng thay vì đọc `state` ───────────────────────────
   *
   * Vì `state` chỉ biết chuyện tải lên, và chuyện đó đã thành công thật. Không
   * có cờ này thì hai câu trái ngược nhau nằm chồng lên nhau đúng một màn hình:
   *
   *     ✓  Đã tải lên xong. Bấm Tiếp tục để chọn dữ liệu.
   *     ✗  Không đọc được nội dung file Excel này.
   *
   * Người dùng vừa bấm đúng cái nút mà dòng xanh bảo họ bấm. Mời họ bấm lại là
   * mời lặp lại một việc chắc chắn hỏng.
   */
  rejected: boolean;
}

export function StepUpload({ uppy, state, rejected }: Props): React.ReactElement {
  const maxMb = Math.round(UPLOAD_MAX_BYTES / 1_048_576);

  return (
    <div>
      {uppy === null ? (
        // Khoảnh khắc giữa lần render đầu và lúc effect khởi tạo Uppy chạy. Giữ
        // đúng chiều cao của Dashboard để bố cục không giật một nhịp.
        <div className="h-[320px] animate-pulse rounded-xl bg-slate-100" />
      ) : (
        <Dashboard
          uppy={uppy}
          height={320}
          width="100%"
          // Không cần: wizard đã có nút "Tiếp tục" ở chân, và `autoProceed` tự
          // bắt đầu tải ngay khi thả file.
          hideUploadButton
          // Đúng một file, nên bảng danh sách nhiều dòng là thừa.
          showSelectedFiles
          proudlyDisplayPoweredByUppy={false}
          // KHÔNG dùng prop `note` của Uppy: nó render ra một thẻ có kích thước
          // 0x0 trong bố cục này — chữ nằm trong DOM nhưng không ai nhìn thấy,
          // mà §7.2 lại yêu cầu dòng giới hạn định dạng/dung lượng phải hiện.
          // Tự render bên dưới thì nó luôn thấy được và không phụ thuộc vào
          // cách Uppy sắp xếp bên trong.
          locale={{
            strings: {
              // Ghi đè hai chuỗi để khớp đúng chữ trong đặc tả §7.2. Phần còn
              // lại lấy từ gói locale tiếng Việt.
              dropPasteFiles: 'Kéo thả file vào đây hoặc %{browseFiles}',
              browseFiles: 'chọn file từ máy',
            },
          }}
        />
      )}

      <p className="mt-2 text-center text-xs text-slate-500">
        Chấp nhận .xlsx và .csv, tối đa {maxMb}MB
      </p>

      {/* Lời mời bấm "Tiếp tục" biến mất khi bước sau đã từ chối file — câu nói
          rõ vì sao nằm ngay dưới, do wizard render. Hai câu là đủ một câu. */}
      {state.status === 'done' && !rejected && (
        <p className="mt-3 rounded-lg bg-green-50 px-3.5 py-2.5 text-sm text-green-800">
          Đã tải lên xong. Bấm <strong>Tiếp tục</strong> để chọn dữ liệu.
        </p>
      )}

      {/* Dashboard đã hiện lỗi ngay trên dòng của file. Dòng này là bản tóm tắt
          cho lỗi đến từ BACKEND (403 thiếu quyền, 413 quá cỡ) — thứ Uppy chỉ
          biết là "upload failed". */}
      {state.status === 'error' && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
          {state.message}
        </p>
      )}
    </div>
  );
}
