/**
 * Chỗ DUY NHẤT đụng tới localStorage cho token.
 *
 * Gom về một file để sau này muốn đổi sang cookie httpOnly thì chỉ phải sửa
 * đây + phần set cookie ở backend, không phải đi lùng `localStorage` rải rác.
 *
 * Đã biết và chấp nhận: token trong localStorage đọc được bởi XSS. Đánh đổi có
 * ý thức theo quyết định §2.5 — bù lại bằng hạn dùng ngắn và payload token
 * không chứa dữ liệu nhạy cảm (chỉ userId, role, tenantId).
 */

const TOKEN_KEY = 'bi_platform_token';

export function readToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    // Safari ở chế độ riêng tư và một số cấu hình chặn cookie sẽ NÉM khi đụng
    // localStorage. Coi như không có token còn hơn để cả app chết trắng.
    return null;
  }
}

export function writeToken(token: string): void {
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Ghi hỏng thì phiên chỉ sống tới lúc F5 — vẫn dùng được, không đáng chết.
  }
}

export function clearToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* không làm gì được thêm */
  }
}
