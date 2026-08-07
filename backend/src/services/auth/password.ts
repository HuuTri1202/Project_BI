import bcrypt from 'bcryptjs';
import { randomInt } from 'node:crypto';
import { env } from '../../config/env';

/**
 * bcrypt CẮT CỤT chuỗi ở byte thứ 72 — hai mật khẩu dài khác nhau nhưng trùng
 * 72 byte đầu sẽ ra cùng một hash. Vì vậy 72 là trần cứng, phải chặn ở tầng
 * validate chứ không im lặng cắt bớt.
 */
export const MAX_PASSWORD_BYTES = 72;
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Hash dùng cho trường hợp email không tồn tại.
 *
 * Khi không tìm thấy user, ta vẫn chạy `verifyPassword` với hash này. Nếu bỏ
 * qua, request với email không tồn tại trả về sau ~1 ms còn email có thật mất
 * ~291 ms — chênh lệch đó tự nó là một kênh để dò xem email nào đã đăng ký.
 *
 * Sinh một lần lúc nạp module để không tốn thêm chi phí mỗi request.
 */
const DUMMY_HASH = bcrypt.hashSync('bi-platform-dummy-password', env.BCRYPT_COST);

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, env.BCRYPT_COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** Đốt đúng lượng thời gian như một lần so khớp thật. Luôn trả về false. */
export async function verifyAgainstDummy(plain: string): Promise<false> {
  await bcrypt.compare(plain, DUMMY_HASH);
  return false;
}

// Bỏ các ký tự dễ đọc nhầm khi chép tay: 0/O, 1/l/I.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const SYMBOLS = '!@#$%^&*';

/**
 * Sinh mật khẩu tạm cho tài khoản do Admin tạo (§3.4).
 *
 * Dùng `randomInt` của node:crypto chứ không phải `Math.random()`: Math.random
 * không phải nguồn ngẫu nhiên an toàn mật mã, đoán được trạng thái là đoán được
 * mọi mật khẩu tạm đã cấp.
 */
export function generateTempPassword(length = 14): string {
  const chars: string[] = [];
  for (let i = 0; i < length - 2; i += 1) {
    chars.push(ALPHABET[randomInt(ALPHABET.length)] as string);
  }
  // Bảo đảm có ít nhất một chữ số và một ký tự đặc biệt để luôn qua mọi luật
  // độ mạnh mật khẩu về sau.
  chars.push(String(randomInt(10)));
  chars.push(SYMBOLS[randomInt(SYMBOLS.length)] as string);

  // Trộn Fisher-Yates để hai ký tự vừa thêm không luôn nằm cuối.
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j] as string, chars[i] as string];
  }
  return chars.join('');
}
