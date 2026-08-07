import { z } from 'zod';
import { MAX_PASSWORD_BYTES, MIN_PASSWORD_LENGTH } from '../../services/auth/password';

/**
 * `.trim().toLowerCase()` trước khi kiểm định dạng: người dùng hay chép email
 * kèm khoảng trắng thừa hoặc gõ hoa. Chuẩn hoá ngay tại cửa cho khớp với
 * collation không phân biệt hoa thường của cột `email`.
 *
 * `.min(1)` đặt TRƯỚC `.email()` để ô trống báo "Vui lòng nhập email" thay vì
 * "Email không đúng định dạng".
 */
const emailSchema = z
  .string({ required_error: 'Vui lòng nhập email' })
  .trim()
  .toLowerCase()
  .min(1, 'Vui lòng nhập email')
  .max(255, 'Email quá dài')
  .email('Email không đúng định dạng');

const passwordSchema = z
  .string({ required_error: 'Vui lòng nhập mật khẩu' })
  .min(1, 'Vui lòng nhập mật khẩu')
  .min(MIN_PASSWORD_LENGTH, `Mật khẩu phải có ít nhất ${MIN_PASSWORD_LENGTH} ký tự`)
  // bcrypt cắt cụt ở byte thứ 72 — chặn ở đây thay vì im lặng bỏ phần dư.
  .max(MAX_PASSWORD_BYTES, `Mật khẩu tối đa ${MAX_PASSWORD_BYTES} ký tự`);

export const loginSchema = z.object({
  email: emailSchema,
  // Lúc ĐĂNG NHẬP không áp luật độ dài tối thiểu: mật khẩu cũ có thể được tạo
  // theo luật khác. Áp luật ở đây chỉ tổ tiết lộ quy tắc mật khẩu của hệ thống
  // cho người chưa đăng nhập.
  password: z.string({ required_error: 'Vui lòng nhập mật khẩu' }).min(1, 'Vui lòng nhập mật khẩu'),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Vui lòng nhập mật khẩu hiện tại'),
    newPassword: passwordSchema,
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    path: ['newPassword'],
    message: 'Mật khẩu mới phải khác mật khẩu hiện tại',
  });

export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export { passwordSchema, emailSchema };
