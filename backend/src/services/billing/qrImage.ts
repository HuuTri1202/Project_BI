import { randomUUID } from 'node:crypto';

/**
 * Ảnh mã QR tĩnh của phương thức thanh toán — §11 mục 3.2.
 *
 * ═══ Vì sao nhận ảnh dưới dạng data URL trong JSON ════════════════════════
 *
 * §7 tải file bằng presigned URL: client PUT thẳng lên S3, Express không nhìn
 * thấy nội dung. Đó là lựa chọn đúng cho một bảng tính 50MB.
 *
 * Ảnh QR thì khác hẳn về quy mô — vài chục KB, tải một lần rồi thôi. Đi đường
 * presigned nghĩa là ba vòng mạng (xin vé, PUT, xác nhận) cộng một nhánh
 * content-type mới trong phần ký vé, để đổi lấy việc không cho một file 30KB đi
 * qua Node. Đổi chác sai chiều.
 *
 * Nhận base64 trong JSON thì không cần thư viện multipart nào — và repo cố ý
 * KHÔNG bật `express.urlencoded` (xem `app.ts`), nên thêm multipart là mở lại
 * đúng cánh cửa CSRF mà việc đó đang đóng.
 *
 * ═══ Kiểm bằng MAGIC BYTES, không bằng chuỗi MIME người gửi khai ══════════
 *
 * `data:image/png;base64,...` — phần `image/png` là do CLIENT viết. Tin nó
 * nghĩa là kiểm đúng thứ client vừa khai, giống hệt cái bẫy mà `detectFormat.ts`
 * của §7.3 đã ghi: đổi tên `payload.exe` thành `.png` mất hai giây, thứ ngăn nó
 * là mấy byte đầu.
 */

/** PNG: 8 byte đầu cố định theo chuẩn. */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** JPEG: `FF D8 FF` — mọi biến thể JFIF/EXIF đều bắt đầu như vậy. */
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);

export type QrImageExt = 'png' | 'jpg';

/**
 * Trần 512KB.
 *
 * Một ảnh QR do ứng dụng ngân hàng xuất ra nằm trong khoảng 5–80KB. 512KB là
 * rộng rãi cho ảnh chụp màn hình độ phân giải cao, và vẫn nhỏ hơn nhiều so với
 * trần 1MB của `express.json` — nên một ảnh quá cỡ bị TỪ CHỐI KÈM LÝ DO ở đây,
 * thay vì bị body-parser cắt ngang với một lỗi 413 không nói gì về ảnh.
 *
 * Base64 phình khoảng 4/3, nên 512KB nhị phân là ~700KB chuỗi. Vẫn lọt.
 */
export const QR_IMAGE_MAX_BYTES = 512 * 1024;

export interface QrImage {
  bytes: Buffer;
  ext: QrImageExt;
  contentType: string;
}

export type QrImageResult = { ok: true; image: QrImage } | { ok: false; reason: string };

/**
 * Bóc một data URL thành bytes, và xác nhận nó THẬT SỰ là ảnh.
 *
 * Trả về kết quả thay vì ném: nơi gọi cần `reason` để dựng một câu 400 nói rõ
 * chuyện gì sai, và một ngoại lệ chỉ mang được một chuỗi mà không phân biệt được
 * "lỗi người dùng" với "lỗi hệ thống".
 */
export function parseQrDataUrl(input: string): QrImageResult {
  const match = /^data:([a-z]+\/[a-z0-9.+-]+);base64,(.+)$/i.exec(input.trim());
  if (match === null) {
    return {
      ok: false,
      reason: 'Ảnh phải ở dạng data URL base64 (data:image/png;base64,...).',
    };
  }

  let bytes: Buffer;
  try {
    bytes = Buffer.from(match[2] ?? '', 'base64');
  } catch {
    return { ok: false, reason: 'Chuỗi base64 không đọc được.' };
  }

  if (bytes.length === 0) return { ok: false, reason: 'Ảnh rỗng.' };
  if (bytes.length > QR_IMAGE_MAX_BYTES) {
    return {
      ok: false,
      reason: `Ảnh nặng ${String(Math.round(bytes.length / 1024))}KB, tối đa ${String(
        QR_IMAGE_MAX_BYTES / 1024,
      )}KB.`,
    };
  }

  // Magic bytes quyết định, KHÔNG phải chuỗi MIME trong data URL.
  if (bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    return { ok: true, image: { bytes, ext: 'png', contentType: 'image/png' } };
  }
  if (bytes.subarray(0, JPEG_SIGNATURE.length).equals(JPEG_SIGNATURE)) {
    return { ok: true, image: { bytes, ext: 'jpg', contentType: 'image/jpeg' } };
  }

  return {
    ok: false,
    reason: 'Chỉ nhận ảnh PNG hoặc JPEG. Nội dung file không khớp hai định dạng đó.',
  };
}

/**
 * Khoá lưu trữ cho ảnh QR.
 *
 * Do SERVER sinh, cùng lý lẽ đã ghi ở `dataset/storageKey.ts`: nhận khoá từ
 * client là cho người ta ghi đè object của người khác.
 *
 * Tiền tố `billing/qr/` tách hẳn khỏi `t{id}/w{id}/` của dữ liệu người dùng —
 * đây là cấu hình của NỀN TẢNG, không thuộc tổ chức nào, và lệnh xoá theo tiền
 * tố khi một tổ chức rời đi không được chạm tới nó.
 *
 * UUID mới cho MỖI lần tải: không ghi đè khoá cũ. Nhờ vậy ảnh đang hiện trên
 * màn hình khách không bị đổi giữa chừng bởi một lần lưu nửa vời, và ảnh cũ có
 * thể xoá sau khi bản ghi đã trỏ sang ảnh mới.
 */
export function buildQrKey(ext: QrImageExt): string {
  return `billing/qr/${randomUUID()}.${ext}`;
}

/** Nhận diện một khoá do ta sinh, để không đi đọc một chuỗi tuỳ ý từ database. */
export function isQrKey(value: string): boolean {
  return /^billing\/qr\/[0-9a-f-]{36}\.(png|jpg)$/.test(value);
}
