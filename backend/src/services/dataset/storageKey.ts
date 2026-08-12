import { randomUUID } from 'node:crypto';
import type { FileExt } from '@bi/shared';

/**
 * Sinh khoá lưu trữ cho một file.
 *
 * ─── Vì sao khoá PHẢI do server sinh ────────────────────────────────────────
 *
 * Presigned URL là một tấm vé ghi vào ĐÚNG khoá đó, có hiệu lực 15 phút, không
 * cần token nào nữa. Nếu khoá lấy từ body request thì client gửi lên
 * `t1/w1/bao-cao-tai-chinh.xlsx` là ghi đè file của tổ chức số 1 — và không lớp
 * phân quyền nào ở tầng HTTP nhìn thấy chuyện đó, vì việc ghi diễn ra thẳng giữa
 * trình duyệt và S3.
 *
 * Đây là lý do hàm này không nhận tên file mong muốn từ đâu cả. Tên gốc người
 * dùng đặt được giữ ở cột `original_filename` trong MySQL, nơi nó vô hại.
 *
 * ─── Vì sao có tenant và workspace trong đường dẫn ──────────────────────────
 *
 * UUID đã đủ để không đụng nhau. Hai đoạn đầu là để CON NGƯỜI dùng: xem bucket
 * trên giao diện MinIO/S3 mà biết file thuộc về ai, và xoá được toàn bộ dữ liệu
 * của một tổ chức bằng một lệnh xoá theo tiền tố khi họ rời đi.
 */
export function buildStorageKey(tenantId: number, workspaceId: number, ext: FileExt): string {
  return `t${tenantId}/w${workspaceId}/${randomUUID()}.${ext}`;
}

/**
 * Lấy đuôi file từ tên người dùng tải lên.
 *
 * Trả `null` khi đuôi không nằm trong danh sách cho phép — nơi gọi biến nó thành
 * 400. KHÔNG đoán, không tự sửa: `bao-cao.xls` (định dạng cũ, khác hẳn .xlsx)
 * phải bị từ chối rõ ràng chứ không được lặng lẽ coi là .xlsx rồi hỏng ở bước
 * parse với một thông báo chẳng liên quan.
 *
 * Kết quả của hàm này CHỈ dùng để chọn parser và đặt đuôi cho khoá. Định dạng
 * thật vẫn do `checkFormat` quyết định bằng magic bytes.
 */
export function extensionOf(filename: string): FileExt | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.csv')) return 'csv';
  if (lower.endsWith('.xlsx')) return 'xlsx';
  return null;
}

/** Kiểu MIME để ký vào presigned URL. Phải khớp header trình duyệt gửi lên. */
export function contentTypeOf(ext: FileExt): string {
  return ext === 'csv'
    ? 'text/csv'
    : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
}

/**
 * Tên mặc định cho bộ dữ liệu, suy từ tên file.
 *
 * `Báo cáo quý 4.xlsx` -> `Báo cáo quý 4`. Người dùng sửa được ở bước 3, nhưng
 * phải có sẵn một cái tên hợp lý: bắt gõ lại đúng thứ vừa chọn từ máy là bắt làm
 * một việc thừa.
 */
export function defaultDatasetName(filename: string): string {
  const withoutExt = filename.replace(/\.(csv|xlsx)$/i, '').trim();
  return withoutExt === '' ? 'Bộ dữ liệu' : withoutExt.slice(0, 255);
}
