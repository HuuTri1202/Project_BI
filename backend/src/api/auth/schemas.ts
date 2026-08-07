import { loginSchema as sharedLoginSchema, normalizePhone, registerFields } from '@bi/shared';
import { z } from 'zod';
import { MAX_PASSWORD_BYTES, MIN_PASSWORD_LENGTH } from '../../services/auth/password';

/**
 * Schema của tầng HTTP.
 *
 * Luật VALIDATE nằm ở `@bi/shared` và frontend dùng đúng schema đó — nhờ vậy
 * không có cảnh frontend chặt hơn backend (người dùng bị từ chối bởi một luật
 * server không hề có) hay lỏng hơn (form báo hợp lệ rồi server trả 400).
 *
 * Ranh giới: `@bi/shared` chỉ validate, KHÔNG transform. Việc chuẩn hoá (hạ
 * email về chữ thường, đổi số điện thoại về +84) nằm ở đây, vì đó là việc của
 * nơi ghi dữ liệu. Trộn transform vào gói chung sẽ làm kiểu input và output của
 * zod lệch nhau, mà với `zodResolver` của react-hook-form thì điều đó buộc phải
 * khai `useForm<Input, Ctx, Output>` cho đúng — một cái bẫy rất khó nhận ra.
 */

/**
 * Chuẩn hoá TRƯỚC khi validate, bằng `z.preprocess` chứ không phải `.transform`.
 *
 * Đây là chỗ rất dễ sai: `.transform()` chạy SAU khi rule đã chấm, nên
 * `emailRule.transform(v => v.trim())` vẫn từ chối `" a@b.com "` — chuỗi tới
 * tay `.email()` khi còn nguyên khoảng trắng. Người dùng dán email từ nơi khác
 * là dính ngay, và thông báo lỗi ("Email không hợp lệ") thì vô nghĩa với họ.
 *
 * Frontend có `setValueAs` cắt khoảng trắng ở ô nhập, nhưng backend tuyệt đối
 * không được dựa vào đó — mọi client khác đều gửi thẳng vào đây.
 */
const normalized = <T extends z.ZodTypeAny>(fn: (v: string) => string, rule: T) =>
  z.preprocess((v) => (typeof v === 'string' ? fn(v) : v), rule);

const trimmed = <T extends z.ZodTypeAny>(rule: T) => normalized((v) => v.trim(), rule);

/** Email: cắt khoảng trắng + hạ chữ thường, khớp collation _ci của cột. */
const emailInput = <T extends z.ZodTypeAny>(rule: T) =>
  normalized((v) => v.trim().toLowerCase(), rule);

/**
 * Đăng ký: lấy nguyên luật của `@bi/shared` rồi bọc thêm bước chuẩn hoá.
 *
 * `.extend()` gọi được vì `registerFields` là ZodObject thuần; `registerSchema`
 * (đã qua `.superRefine`) thì không. Đó chính là lý do gói chung tách hai thứ.
 * Ràng buộc chéo mật khẩu nhập lại được áp lại bằng `.superRefine` ở cuối.
 */
export const registerSchema = registerFields
  .extend({
    email: emailInput(registerFields.shape.email),
    fullName: trimmed(registerFields.shape.fullName),
    companyName: trimmed(registerFields.shape.companyName),
    // Chuẩn hoá về +84XXXXXXXXX để lưu. `?? v` giữ nguyên chuỗi gốc khi không
    // nhận dạng được — khi đó `phoneRule` bên trong sẽ là bên từ chối, kèm
    // thông báo đúng nghĩa, thay vì ta âm thầm ghi một giá trị sai dạng.
    phone: normalized((v) => normalizePhone(v) ?? v, registerFields.shape.phone),
  })
  .superRefine((value, ctx) => {
    if (value.password !== value.confirmPassword) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['confirmPassword'],
        message: 'Mật khẩu nhập lại không khớp',
      });
    }
  });

/** Đăng nhập: chuẩn hoá email, giữ nguyên luật mật khẩu lỏng của gói chung. */
export const loginSchema = sharedLoginSchema.extend({
  email: emailInput(sharedLoginSchema.shape.email),
});

const newPasswordSchema = z
  .string({ required_error: 'Vui lòng nhập mật khẩu mới' })
  .min(1, 'Vui lòng nhập mật khẩu mới')
  .min(MIN_PASSWORD_LENGTH, `Mật khẩu phải có ít nhất ${MIN_PASSWORD_LENGTH} ký tự`)
  // Đếm BYTE chứ không phải ký tự: bcrypt cắt âm thầm ở byte thứ 72, và tiếng
  // Việt có dấu là 2–3 byte mỗi ký tự nên một mật khẩu ~24 ký tự đã chạm trần.
  .refine(
    (v) => new TextEncoder().encode(v).length <= MAX_PASSWORD_BYTES,
    `Mật khẩu quá dài (tối đa ${MAX_PASSWORD_BYTES} byte — chữ có dấu tính 2–3 byte)`,
  );

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Vui lòng nhập mật khẩu hiện tại'),
    newPassword: newPasswordSchema,
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    path: ['newPassword'],
    message: 'Mật khẩu mới phải khác mật khẩu hiện tại',
  });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
