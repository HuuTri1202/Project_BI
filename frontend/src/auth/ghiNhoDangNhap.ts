/**
 * "Ghi nhớ đăng nhập trên máy này" — mong muốn D7.
 *
 * ═══ Nó tắt luật nào, và vì sao luật đó tồn tại ════════════════════════════
 *
 * `appSession.ts` xoá token khi app đã đóng hẳn từ lần trước, để trên máy dùng
 * chung người ngồi sau không vào thẳng tài khoản của người ngồi trước. Luật đó
 * ĐÚNG, và nó vẫn là mặc định — đo được trong lần dùng thử như người thật: đóng
 * trình duyệt là mất phiên, và đó là điều gây bực mình nhất với một người dùng
 * máy riêng.
 *
 * Nên bản vá này không đổi mặc định; nó biến luật thành LỰA CHỌN của người
 * dùng, đúng như mong muốn D7 viết: "nên là lựa chọn của người dùng".
 *
 * ═══ Vì sao cờ nằm ở localStorage, không ở token ═══════════════════════════
 *
 * Đây là sở thích của một CÁI MÁY, không phải một thuộc tính của tài khoản: ông
 * chủ có thể muốn ghi nhớ trên máy ở nhà và không ghi nhớ trên máy ở quán. Đặt
 * nó vào token hoặc vào `users` là buộc một lựa chọn của máy này lên mọi máy
 * khác của cùng người.
 *
 * ═══ Giới hạn, ghi ra chứ không giấu ═══════════════════════════════════════
 *
 * - Trần vẫn là hạn của token (`JWT_EXPIRES_IN`, 7 ngày). Ghi nhớ KHÔNG kéo dài
 *   phiên quá hạn đó; hết hạn là phải đăng nhập lại.
 * - Token nằm trong `localStorage` nên XSS đọc được — đánh đổi đã ghi ở
 *   `tokenStorage.ts`. Cờ này không làm chuyện đó tệ hơn, nhưng nó làm khoảng
 *   thời gian token có mặt trên đĩa dài hơn, nên nhãn ô tích phải nói rõ "máy
 *   riêng".
 * - Đăng xuất XOÁ cờ. Người bấm đăng xuất đang nói "tôi xong rồi", và giữ lại
 *   một lựa chọn ghi nhớ sau câu đó là hiểu sai câu đó.
 */

const KEY = 'bi.app.remember';

export function docGhiNho(): boolean {
  try {
    return window.localStorage.getItem(KEY) === '1';
  } catch {
    // Chặn localStorage thì không ghi nhớ được gì — hỏng theo hướng CHẶT hơn.
    return false;
  }
}

export function ghiGhiNho(bat: boolean): void {
  try {
    if (bat) window.localStorage.setItem(KEY, '1');
    else window.localStorage.removeItem(KEY);
  } catch {
    /* không ghi được thì phiên hành xử đúng như trước bản vá này */
  }
}
