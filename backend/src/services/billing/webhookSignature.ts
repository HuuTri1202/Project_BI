import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Xác thực chữ ký webhook — §11.
 *
 * ═══ So sánh bằng `timingSafeEqual`, không bằng `===` ═════════════════════
 *
 * `a === b` trên chuỗi thoát ra ngay tại byte đầu tiên khác nhau. Thời gian
 * chạy vì thế phụ thuộc vào việc kẻ tấn công đoán đúng bao nhiêu ký tự đầu, và
 * đo đủ nhiều lần thì dò ra được từng byte của chữ ký hợp lệ. Đây là tấn công
 * kênh phụ kinh điển, và nó không đắt tiền như nghe có vẻ.
 *
 * `timingSafeEqual` chạy hết mọi byte bất kể khác nhau ở đâu.
 *
 * ⚠️ Nó NÉM khi hai buffer khác độ dài — không phải trả `false`. Nên phải kiểm
 * độ dài trước, và bản thân phép kiểm đó cũng rò một bit thông tin (độ dài chữ
 * ký), nhưng độ dài chữ ký là hằng số công khai của thuật toán nên không mất gì.
 *
 * ═══ Vì sao đây là hàm THUẦN, tách khỏi route ═════════════════════════════
 *
 * Chữ ký sai là thứ chỉ xảy ra khi có người thử — tức là đúng lúc ta cần chắc
 * chắn code này đúng, và cũng là lúc không thể thử bằng tay. Nên nó phải kiểm
 * được bằng test đơn vị, không cần Redis, MySQL hay một cổng thanh toán thật.
 */

/**
 * Thuật toán băm. Chỉ SHA-256 và SHA-512 — không nhận tên tuỳ ý từ cấu hình.
 *
 * Một chuỗi tự do đi vào `createHmac` là đường để ai đó cấu hình `md5` rồi
 * tưởng mình vẫn an toàn.
 */
export const HMAC_ALGORITHMS = ['sha256', 'sha512'] as const;
export type HmacAlgorithm = (typeof HMAC_ALGORITHMS)[number];

export interface VerifyInput {
  /** Thân request NGUYÊN VĂN, đúng chuỗi byte cổng thanh toán đã gửi. */
  rawBody: Buffer | string;
  /** Chữ ký cổng gửi kèm, thường ở một header. */
  signature: string;
  secret: string;
  algorithm?: HmacAlgorithm;
}

/** Chữ ký ta TỰ TÍNH từ thân request — dạng hex chữ thường. */
export function signPayload(
  rawBody: Buffer | string,
  secret: string,
  algorithm: HmacAlgorithm = 'sha256',
): string {
  return createHmac(algorithm, secret).update(rawBody).digest('hex');
}

/**
 * Chữ ký có khớp không.
 *
 * Nhận cả `sha256=<hex>` lẫn `<hex>` trần: mỗi cổng viết một kiểu, và bắt nơi
 * gọi tự bóc tiền tố nghĩa là mỗi adapter lại tự bóc một lần — chỗ nào quên thì
 * mọi webhook của cổng đó bị từ chối, và triệu chứng là "chữ ký sai" cho một
 * chữ ký hoàn toàn đúng.
 */
export function verifySignature(input: VerifyInput): boolean {
  const { rawBody, secret } = input;
  const algorithm = input.algorithm ?? 'sha256';

  if (secret === '' || input.signature === '') return false;

  const nhan = input.signature.includes('=')
    ? (input.signature.split('=').pop() ?? '')
    : input.signature;

  const ta = signPayload(rawBody, secret, algorithm);

  const a = Buffer.from(ta, 'utf8');
  const b = Buffer.from(nhan.trim().toLowerCase(), 'utf8');

  // Độ dài khác nhau thì chắc chắn không khớp, và `timingSafeEqual` sẽ NÉM chứ
  // không trả `false`. Thoát sớm ở đây an toàn: độ dài chữ ký là hằng số công
  // khai của thuật toán, không phải bí mật.
  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}
