import { env } from '../../config/env';
import { redis } from '../../config/redis';
import { HttpError } from '../../utils/httpError';

/**
 * Chống dò mật khẩu bằng cách đếm số lần đăng nhập sai trên Redis.
 *
 * Khoá gồm CẢ email lẫn IP:
 *  - chỉ theo email  -> kẻ tấn công khoá được tài khoản người khác bằng cách cố
 *                       tình nhập sai (tự tạo ra một kiểu tấn công từ chối dịch vụ)
 *  - chỉ theo IP     -> dò lần lượt nhiều email từ một máy vẫn lọt
 *
 * Redis đang chạy sẵn trong compose nên không thêm hạ tầng gì. Bộ đếm tự hết
 * hạn theo TTL, không cần dọn dẹp.
 */
function key(email: string, ip: string): string {
  return `login:fail:${email.toLowerCase()}:${ip}`;
}

/** Ném 429 nếu đã vượt ngưỡng. Redis chết thì bỏ qua, không chặn đăng nhập. */
export async function assertNotThrottled(email: string, ip: string): Promise<void> {
  let attempts = 0;
  try {
    attempts = Number((await redis.get(key(email, ip))) ?? 0);
  } catch {
    // Redis hỏng là sự cố hạ tầng, không phải lý do để chặn người dùng hợp lệ
    // đăng nhập. Ưu tiên khả dụng ở đây là đánh đổi có ý thức.
    return;
  }

  if (attempts >= env.LOGIN_MAX_ATTEMPTS) {
    throw new HttpError(
      429,
      'TooManyAttempts',
      `Bạn đã nhập sai quá nhiều lần. Vui lòng thử lại sau ${env.LOGIN_LOCKOUT_MINUTES} phút.`,
    );
  }
}

export async function recordFailure(email: string, ip: string): Promise<void> {
  try {
    const k = key(email, ip);
    const attempts = await redis.incr(k);
    // Chỉ đặt TTL ở lần sai đầu tiên -> cửa sổ đếm là "15 phút kể từ lần sai
    // đầu", không phải cửa sổ trượt kéo dài mãi theo mỗi lần sai mới.
    if (attempts === 1) {
      await redis.expire(k, env.LOGIN_LOCKOUT_MINUTES * 60);
    }
  } catch {
    // Bỏ qua: không ghi nhận được thì cùng lắm là mất một lớp phòng thủ.
  }
}

/** Đăng nhập thành công thì xoá bộ đếm. */
export async function clearFailures(email: string, ip: string): Promise<void> {
  try {
    await redis.del(key(email, ip));
  } catch {
    // Bỏ qua.
  }
}
