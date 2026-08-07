import { loginSchema, matchConfirmPassword, normalizePhone, registerFields } from '@bi/shared';
import { z } from 'zod';

/**
 * Schema phía server = luật dùng chung (@bi/shared) + CHUẨN HOÁ.
 *
 * Chuẩn hoá chỉ nằm ở đây chứ không nằm trong gói dùng chung, vì nó là việc của
 * nơi ghi dữ liệu. Nếu đưa transform vào schema mà frontend cũng dùng, kiểu
 * input và output của zod sẽ lệch nhau, và khi đó `zodResolver` của
 * react-hook-form bắt buộc phải khai `useForm<Input, Ctx, Output>` cho đúng —
 * một cái bẫy rất khó thấy.
 *
 * Server VẪN validate lại toàn bộ, không tin frontend đã kiểm: frontend chỉ là
 * trải nghiệm người dùng, ai cũng gọi thẳng API được.
 */

/**
 * Cắt khoảng trắng TRƯỚC khi áp luật, không phải sau.
 *
 * Thứ tự này quan trọng: người dùng dán email từ nơi khác rất hay kèm khoảng
 * trắng ở hai đầu. Nếu trim nằm trong `.transform()` (chạy SAU khi validate) thì
 * `" a@b.com "` bị `.email()` từ chối trước khi kịp được cắt — người dùng nhận
 * "Email không hợp lệ" cho một email hoàn toàn hợp lệ.
 */
function trimmedThen<T extends z.ZodTypeAny>(rule: T) {
  return z.string().trim().pipe(rule);
}

const normalizedRegisterFields = registerFields.extend({
  // Hạ về chữ thường để dữ liệu lưu ở dạng chuẩn tắc. Collation _ci đã cho ta
  // unique không phân biệt hoa thường, nhưng lưu chuẩn tắc thì sau này đổi sang
  // index phân biệt hoa thường (hoặc chuyển sang Postgres) không âm thầm đổi
  // ngữ nghĩa dữ liệu cũ.
  email: trimmedThen(registerFields.shape.email).transform((v) => v.toLowerCase()),
  // Gộp khoảng trắng giữa các từ: "Nguyễn   Văn  A" -> "Nguyễn Văn A".
  fullName: trimmedThen(registerFields.shape.fullName).transform((v) => v.replace(/\s+/g, ' ')),
  companyName: trimmedThen(registerFields.shape.companyName).transform((v) =>
    v.replace(/\s+/g, ' '),
  ),
  // phoneRule đã bảo đảm normalizePhone() không trả null, nên `?? v` ở đây chỉ
  // để thoả kiểu, không phải nhánh chạy thật.
  phone: trimmedThen(registerFields.shape.phone).transform((v) => normalizePhone(v) ?? v),
  jobTitle: trimmedThen(registerFields.shape.jobTitle),
});

export const registerRequestSchema = normalizedRegisterFields.superRefine(matchConfirmPassword);

export const loginRequestSchema = loginSchema.extend({
  email: trimmedThen(loginSchema.shape.email).transform((v) => v.toLowerCase()),
});

export type RegisterRequest = z.infer<typeof registerRequestSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
