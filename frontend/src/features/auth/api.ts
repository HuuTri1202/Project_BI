import { apiClient } from '../../services/apiClient';

/**
 * Ba lời gọi của luồng "quên mật khẩu".
 *
 * Tách khỏi component vì cả `ForgotPasswordPage` lẫn `ResetPasswordPage` đều
 * gọi, và vì trộn hàm thuần vào một module component làm module đó mất
 * hot-reload.
 *
 * ⚠️ Vé luôn nằm trong BODY, không bao giờ trên query string của request. Nó có
 * mặt trên URL của trình duyệt (đó là cách người dùng nhận được nó từ email),
 * nhưng từ đó trở đi ta không đẩy nó vào access log của backend nữa.
 */

export async function xinLienKetDatLai(email: string): Promise<string> {
  const res = await apiClient.post<{ message: string }>('/auth/forgot-password', { email });
  return res.data.message;
}

export async function kiemLienKetDatLai(token: string): Promise<void> {
  await apiClient.post('/auth/reset-password/verify', { token });
}

export async function datLaiMatKhau(token: string, newPassword: string): Promise<void> {
  await apiClient.post('/auth/reset-password', { token, newPassword });
}

/**
 * Hai lời gọi của luồng xác minh email — §1.10.
 *
 * Cùng luật vé như trên: vé đi trong BODY. Nó có mặt trên URL của trình duyệt vì
 * đó là cách người dùng nhận nó từ thư, và `VerifyEmailPage` đọc nó từ đấy —
 * nhưng từ đó trở đi nó không đi vào access log của backend nữa.
 */
export async function xacMinhEmail(token: string): Promise<void> {
  await apiClient.post('/auth/verify-email', { token });
}

export async function guiLaiThuXacMinh(email: string): Promise<string> {
  const res = await apiClient.post<{ message: string }>('/auth/resend-verification', { email });
  return res.data.message;
}
