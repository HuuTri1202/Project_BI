import { isTest } from '../config/env';
import { memoryStorage } from './memoryStorage';
import { s3Storage } from './s3Storage';

/**
 * Tầng lưu trữ file — §7.4.
 *
 * ─── Vì sao có interface thay vì gọi thẳng @aws-sdk/client-s3 ────────────────
 *
 * Bộ test tích hợp hiện chạy chỉ với MySQL + Redis. Nếu tầng này gọi thẳng vào
 * SDK thì mọi ca chạm tới upload sẽ đỏ trên máy chưa bật profile `data` của
 * docker-compose — và một bộ test đỏ vì lý do không liên quan tới thứ nó kiểm là
 * bộ test người ta sẽ học cách bỏ qua.
 *
 * Interface ở đây MỎNG có chủ ý: ba hàm, không bọc lại khái niệm nào của S3.
 * Nó không cố trở thành một lớp trừu tượng hoá lưu trữ tổng quát — nó chỉ đủ để
 * thay bản thật bằng một Map trong bộ nhớ khi chạy test.
 *
 * ─── Presigned URL: vì sao upload không đi qua Express ───────────────────────
 *
 * Luồng của §7.4 là client xin URL rồi PUT THẲNG lên S3. Express không bao giờ
 * nhìn thấy nội dung file. Đổi lại:
 *
 *   - Một file 50MB không chiếm bộ nhớ và không giữ một worker của Node.
 *   - Trần dung lượng phải nằm trong ĐIỀU KIỆN của chính URL đó, vì không còn
 *     middleware nào để kiểm. Xem `presignPut`.
 *   - `key` phải do SERVER sinh. URL đã ký là một tấm vé ghi vào đúng key đó
 *     trong 15 phút mà không cần token nào nữa; nhận key từ client nghĩa là cho
 *     người ta ghi đè file của tổ chức khác.
 */
export interface PresignedUpload {
  url: string;
  /** ISO 8601. Frontend dùng để biết khi nào phải xin URL mới. */
  expiresAt: string;
}

export interface ObjectStorage {
  /**
   * Cấp một tấm vé ghi có hạn cho đúng một `key`.
   *
   * `maxBytes` đi vào điều kiện của URL để chính S3/MinIO từ chối file quá cỡ.
   * Kiểm ở Express là kiểm một con số do client tự khai, trên một request không
   * mang theo file.
   */
  presignPut(key: string, contentType: string, maxBytes: number): Promise<PresignedUpload>;
  getObject(key: string): Promise<Buffer>;
  deleteObject(key: string): Promise<void>;
  /** Có thật sự tồn tại không, và nặng bao nhiêu. Dùng để xác nhận upload xong. */
  headObject(key: string): Promise<{ size: number } | null>;
}

/**
 * Bản dựng đang dùng.
 *
 * Chọn theo `NODE_ENV` chứ không theo một biến bật/tắt riêng: một cờ riêng là
 * một cách để bản memory lọt lên production, và khi đó file "upload thành công"
 * rồi biến mất lúc restart mà không có lỗi nào.
 */
export const storage: ObjectStorage = isTest ? memoryStorage : s3Storage;
