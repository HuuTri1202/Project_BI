import { randomBytes } from 'node:crypto';

/**
 * Sinh mã đơn hàng — §11.
 *
 * ═══ Mã này KHÔNG chỉ là khoá kỹ thuật ═════════════════════════════════════
 *
 * Nó là NỘI DUNG CHUYỂN KHOẢN mà khách gõ vào ứng dụng ngân hàng, và là thứ
 * người vận hành dò trên sao kê để đối chiếu. Ba ràng buộc đến từ đó, không
 * phải từ database:
 *
 *   1. Trường nội dung của VietQR (field 08 của Additional Data, theo NAPAS)
 *      tối đa 25 ký tự, và nhiều ngân hàng LỌC BỎ ký tự không phải chữ-số rồi
 *      ép hoa trước khi ghi vào sao kê. Nên chỉ dùng [0-9A-Z].
 *   2. Mã này SẼ bị đọc qua điện thoại cho kế toán. `0` với `O`, `1` với `I`
 *      là lỗi chép tay được bảo đảm sẽ xảy ra.
 *   3. Nó hiện công khai trên màn hình của khách.
 *
 * ─── Vì sao KHÔNG nhúng id, tenant hay dấu thời gian ───────────────────────
 *
 * `BI-000042` vừa mời người ta đoán đơn của người khác (đổi 42 thành 43), vừa
 * là một chỉ báo doanh thu công khai — "công ty này mới có 42 đơn". Mã ngẫu
 * nhiên không nói gì cả, và đó là toàn bộ điểm của nó.
 *
 * ─── Vì sao tính duy nhất KHÔNG kiểm ở đây ─────────────────────────────────
 *
 * Không có hàm `isTaken()` nào trong file này, và đó là chủ ý. Một câu SELECT
 * kiểm trước rồi INSERT sau để lại đúng khe hở mà hai request song song đi
 * qua cùng lúc. Tính duy nhất do `uq_orders_code` của database bảo đảm; nơi
 * gọi bắt `ER_DUP_ENTRY` rồi sinh mã khác — xem `createOrder.ts`.
 */

/**
 * Bảng chữ Crockford Base32: bỏ I, L, O, U.
 *
 * I/L/O bị bỏ vì nhìn giống 1/1/0. U bị bỏ theo đúng chuẩn Crockford, để bảng
 * chữ không sinh ra từ tục — một mã đơn hàng bậy bạ hiện trên màn hình khách
 * là chuyện không ai muốn giải thích.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const PREFIX = 'BI';
/** 10 ký tự x 5 bit = 50 bit lấy từ 56 bit ngẫu nhiên. */
const BODY_LENGTH = 10;

/** Khớp `CHAR(12)` của cột `orders.order_code`. */
export const ORDER_CODE_LENGTH = PREFIX.length + BODY_LENGTH;

/**
 * Nhận diện một chuỗi có phải mã đơn hợp lệ không.
 *
 * Dùng ở tầng route để từ chối sớm một tham số URL rác, và ở webhook để không
 * mang một chuỗi tuỳ ý đi tra database.
 */
export const ORDER_CODE_PATTERN = new RegExp(`^${PREFIX}[${ALPHABET}]{${BODY_LENGTH}}$`);

export function isOrderCode(value: string): boolean {
  return ORDER_CODE_PATTERN.test(value);
}

/**
 * Một mã mới. Ngẫu nhiên mật mã, KHÔNG phải `Math.random`.
 *
 * `Math.random` không hứa hẹn gì về việc đoán trước được hay không, và ở đây
 * đoán được một mã nghĩa là đọc được đơn hàng của người khác.
 */
export function newOrderCode(): string {
  // 7 byte = 56 bit, thừa cho 50 bit cần dùng. Lấy dư còn hơn thiếu: ghép hai
  // lần `randomBytes` nhỏ hơn sẽ tốn một lời gọi hệ thống nữa mà không được gì.
  const bytes = randomBytes(7);

  let acc = 0n;
  for (const byte of bytes) acc = (acc << 8n) | BigInt(byte);

  let body = '';
  for (let i = 0; i < BODY_LENGTH; i += 1) {
    // Lấy từ 5 bit THẤP rồi dịch phải: thứ tự ký tự không mang nghĩa gì nên
    // chiều nào cũng được, và chiều này khỏi phải tính vị trí bit.
    body = ALPHABET[Number(acc & 31n)] + body;
    acc >>= 5n;
  }

  return PREFIX + body;
}
