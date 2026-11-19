import { z } from 'zod';

/**
 * Rule validate dùng chung cho backend và frontend.
 *
 * Đây là lý do gói `@bi/shared` tồn tại: luật "mật khẩu tối thiểu 8 ký tự, có
 * hoa và số" mà hai phía viết riêng thì sớm muộn cũng lệch, và kiểu lệch tệ
 * nhất là frontend chặt hơn backend — người dùng bị từ chối vì một luật mà
 * server không hề có.
 *
 * Ranh giới: file này chỉ VALIDATE, không TRANSFORM. Chuẩn hoá (lowercase
 * email, đổi SĐT về +84) nằm ở schema riêng của backend, vì đó là việc của nơi
 * ghi dữ liệu. Trộn transform vào đây sẽ làm kiểu input và output của zod lệch
 * nhau, mà với `zodResolver` của react-hook-form thì điều đó buộc phải khai
 * `useForm<Input, Ctx, Output>` cho đúng — một cái bẫy rất khó nhận ra.
 */

/** Ký tự phân cách người dùng hay gõ xen vào số điện thoại. */
const PHONE_SEPARATORS = /[\s.\-()]/g;

/**
 * Đưa số điện thoại về đúng một dạng `+84XXXXXXXXX` để lưu.
 *
 * Trả về `null` nếu không nhận dạng được — hàm này KHÔNG ném lỗi, việc báo lỗi
 * là của `phoneRule`.
 *
 * Chỗ nhập nhằng duy nhất: chuỗi mở đầu bằng "84". Nó có thể là mã quốc gia
 * (84901234567) hoặc là số nội địa thật sự bắt đầu bằng 84. Ở đây chỉ coi là mã
 * quốc gia khi bỏ đi rồi vẫn còn đủ 9–10 chữ số, tức là độ dài tổng 11–12.
 */
export function normalizePhone(input: string): string | null {
  const compact = input.replace(PHONE_SEPARATORS, '');

  let national: string;
  if (compact.startsWith('+84')) {
    national = compact.slice(3);
  } else if (compact.startsWith('84') && compact.length >= 11 && compact.length <= 12) {
    national = compact.slice(2);
  } else if (compact.startsWith('0')) {
    national = compact.slice(1);
  } else {
    national = compact;
  }

  return /^\d{9,10}$/.test(national) ? `+84${national}` : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rule từng trường
// ─────────────────────────────────────────────────────────────────────────────

export const fullNameRule = z
  .string()
  .min(1, 'Vui lòng nhập họ và tên')
  .max(150, 'Họ và tên tối đa 150 ký tự')
  .refine((v) => v.trim().length > 0, 'Họ và tên không được chỉ có khoảng trắng');

/**
 * Tên công ty — chính là `tenants.name`.
 *
 * Giới hạn 150 ký tự KHÔNG phải con số tuỳ tiện: nó khớp đúng `VARCHAR(150)` của
 * cột `tenants.name`. Nếu nới ở đây mà quên ALTER cột, MySQL sẽ cắt cụt âm thầm
 * (hoặc ném lỗi 1406 tuỳ sql_mode) — kiểu hỏng chỉ lộ ra với đúng vài người dùng
 * có tên tổ chức dài.
 */
export const companyNameRule = z
  .string()
  .min(2, 'Tên công ty phải có ít nhất 2 ký tự')
  .max(150, 'Tên công ty tối đa 150 ký tự')
  .refine((v) => v.trim().length >= 2, 'Tên công ty không được chỉ có khoảng trắng');

export const emailRule = z
  .string()
  .min(1, 'Vui lòng nhập email')
  .max(255, 'Email tối đa 255 ký tự')
  .email('Email không hợp lệ');

export const passwordRule = z
  .string()
  .min(8, 'Mật khẩu tối thiểu 8 ký tự')
  .regex(/[A-Z]/, 'Mật khẩu phải có ít nhất 1 chữ hoa')
  .regex(/[0-9]/, 'Mật khẩu phải có ít nhất 1 chữ số')
  // bcrypt CẮT ÂM THẦM ở byte thứ 72. Không chặn ở đây thì hai mật khẩu dài
  // khác nhau nhưng trùng 72 byte đầu sẽ đăng nhập được vào cùng một tài khoản.
  // Phải đếm BYTE chứ không phải ký tự: tiếng Việt có dấu là 2–3 byte/ký tự nên
  // một mật khẩu khoảng 24 ký tự đã chạm trần.
  // TextEncoder có ở cả Node 20 lẫn trình duyệt nên một hàm chạy được hai phía.
  .refine(
    (v) => new TextEncoder().encode(v).length <= 72,
    'Mật khẩu quá dài (tối đa 72 byte — chữ có dấu tính 2–3 byte)',
  );

export const phoneRule = z
  .string()
  .min(1, 'Vui lòng nhập số điện thoại')
  .refine(
    (v) => normalizePhone(v) !== null,
    'Số điện thoại phải gồm 9–10 chữ số (chấp nhận 0…, +84…, có khoảng trắng)',
  );

/**
 * Danh sách chức danh cho người dùng chọn.
 *
 * Là danh sách đóng chứ không phải ô nhập tự do, nên nó vừa là nguồn dữ liệu cho
 * thẻ <select> ở frontend, vừa là luật validate ở backend — không thể lệch nhau.
 *
 * Thêm giá trị mới thì NỐI VÀO CUỐI và giữ nguyên chuỗi cũ: chuỗi này được lưu
 * thẳng vào cột `users.job_title`, nên đổi chữ của một mục sẽ làm mọi bản ghi cũ
 * mang giá trị không còn nằm trong danh sách.
 */
export const JOB_TITLES = [
  // Bốn mục dưới đây THÊM MỚI cho vá B1 — xem khối chú thích ngay dưới danh sách.
  'Business Owner',
  'Sales / Marketing',
  'Accounting / Finance',
  'Operations',
  'Department Manager / Director',
  'Data Analyst',
  'Business Analyst',
  'BI Developer',
  'Data Engineer',
  'Data Scientist',
  'Product Manager',
  'Database Administrator',
  'IT Manager / CTO',
  'Other',
] as const;

export type JobTitle = (typeof JOB_TITLES)[number];

/**
 * Chữ HIỂN THỊ cho người dùng — vá B1 và C4.
 *
 * ═══ Hai lỗi đã đo khi dùng hệ thống như người thật ════════════════════════
 *
 *   B1  Danh sách chức danh trong form đăng ký bằng TIẾNG ANH giữa một form
 *       tiếng Việt, và không có mục nào cho một chủ cửa hàng chọn ngoài
 *       "Other". Danh sách cũ giả định khách hàng là đội dữ liệu doanh nghiệp.
 *   C4  Bảng Thành viên in thẳng giá trị đã lưu, nên dưới tên người hiện chữ
 *       "Other".
 *
 * ═══ Vì sao là BẢNG NHÃN, không phải đổi chữ trong `JOB_TITLES` ════════════
 *
 * Chuỗi trong `JOB_TITLES` được lưu thẳng vào `users.job_title`. Đổi chữ của
 * một mục sẽ làm mọi bản ghi cũ mang giá trị không còn nằm trong danh sách —
 * chính cảnh báo đã viết sẵn ở trên. Nên giá trị lưu giữ nguyên từng byte, và
 * chỉ thêm một lớp dịch khi hiển thị.
 *
 * THỨ TỰ thì đổi được tự do: nó không phải dữ liệu, chỉ là thứ tự dòng trong
 * thẻ <select>. Bốn mục nghiệp vụ lên đầu vì đó là khách hàng thật của một
 * nền tảng BI nhỏ, còn "Khác" xuống cuối đúng chỗ của nó.
 *
 * `Record<JobTitle, string>` chứ không phải `Partial`: thêm một chức danh mà
 * quên nhãn là lỗi BIÊN DỊCH, không phải một ô trống trên màn hình.
 */
export const JOB_TITLE_LABELS: Record<JobTitle, string> = {
  'Business Owner': 'Chủ doanh nghiệp / chủ cửa hàng',
  'Sales / Marketing': 'Kinh doanh / marketing',
  'Accounting / Finance': 'Kế toán / tài chính',
  Operations: 'Vận hành / kho',
  'Department Manager / Director': 'Trưởng phòng / giám đốc',
  'Data Analyst': 'Chuyên viên phân tích dữ liệu',
  'Business Analyst': 'Chuyên viên phân tích nghiệp vụ',
  'BI Developer': 'Lập trình viên BI',
  'Data Engineer': 'Kỹ sư dữ liệu',
  'Data Scientist': 'Chuyên gia khoa học dữ liệu',
  'Product Manager': 'Quản lý sản phẩm',
  'Database Administrator': 'Quản trị cơ sở dữ liệu',
  'IT Manager / CTO': 'Trưởng phòng IT / CTO',
  Other: 'Khác',
};

/** Dạng sẵn dùng cho thẻ <select>, đúng thứ tự của `JOB_TITLES`. */
export const JOB_TITLE_OPTIONS: readonly { value: JobTitle; label: string }[] = JOB_TITLES.map(
  (value) => ({ value, label: JOB_TITLE_LABELS[value] }),
);

/**
 * Nhãn để HIỆN, chịu được cả giá trị không còn trong danh sách.
 *
 * Trả về chính giá trị đã lưu khi không tra được: trong database dev có những
 * dòng `job_title` do seed hoặc do một bản cũ ghi vào ('Trưởng phòng dữ liệu'),
 * và hiện nguyên văn vẫn đúng hơn là hiện một ô trống hay chữ "Khác".
 */
export function nhanChucDanh(jobTitle: string | null): string | null {
  if (jobTitle === null || jobTitle === '') return null;
  return JOB_TITLE_LABELS[jobTitle as JobTitle] ?? jobTitle;
}

export const jobTitleRule = z.enum(JOB_TITLES, {
  // Không có errorMap thì zod trả "Invalid enum value. Expected 'Data Analyst' |
  // 'Business Analyst' | ..." — đọc như thông báo dành cho lập trình viên, và
  // còn phơi nguyên danh sách ra thông báo lỗi.
  errorMap: () => ({ message: 'Vui lòng chọn chức danh' }),
});

// ─────────────────────────────────────────────────────────────────────────────
// Schema hoàn chỉnh
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Các trường thô của form đăng ký, chưa ràng buộc chéo.
 *
 * Tách riêng để backend `.extend()` thêm transform chuẩn hoá mà không phải chép
 * lại danh sách trường — `.superRefine` ở dưới không cho phép `.extend()` nữa.
 */
export const registerFields = z.object({
  fullName: fullNameRule,
  companyName: companyNameRule,
  email: emailRule,
  password: passwordRule,
  confirmPassword: z.string().min(1, 'Vui lòng nhập lại mật khẩu'),
  phone: phoneRule,
  jobTitle: jobTitleRule,
});

/** Ràng buộc chéo: lỗi phải gắn vào ô xác nhận, không phải ô mật khẩu. */
export const matchConfirmPassword = <T extends { password: string; confirmPassword: string }>(
  value: T,
  ctx: z.RefinementCtx,
): void => {
  if (value.password !== value.confirmPassword) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['confirmPassword'],
      message: 'Mật khẩu nhập lại không khớp',
    });
  }
};

export const registerSchema = registerFields.superRefine(matchConfirmPassword);

export const loginSchema = z.object({
  email: emailRule,
  // Đăng nhập KHÔNG áp passwordRule: mật khẩu cũ có thể không thoả luật mới, và
  // báo "mật khẩu phải có chữ hoa" ở màn đăng nhập là rò rỉ thông tin vô ích.
  password: z.string().min(1, 'Vui lòng nhập mật khẩu'),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
