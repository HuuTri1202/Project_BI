import { emailRule, passwordRule } from '@bi/shared';

/**
 * Bọc các rule zod của `@bi/shared` thành hàm trả `string | undefined`, đúng
 * kiểu mà `LoginPage` và `ChangePasswordPage` đang dùng.
 *
 * Vì sao không viết lại luật ở đây: luật "mật khẩu ≥ 8 ký tự, có hoa và số, tối
 * đa 72 BYTE" phải giống hệt backend. Bản viết tay trước đó của file này đếm
 * KÝ TỰ chứ không đếm byte — tiếng Việt có dấu là 2–3 byte mỗi ký tự nên một
 * mật khẩu ~24 ký tự đã chạm trần cắt cụt của bcrypt mà không bị chặn.
 *
 * `RegisterPage` không đi qua đây: nó dùng thẳng `registerSchema` qua
 * `zodResolver`, cách gọn hơn khi form có nhiều trường.
 */

function firstIssue(result: { success: boolean; error?: { issues: { message: string }[] } }) {
  return result.success ? undefined : result.error?.issues[0]?.message;
}

export function validateEmail(value: string): string | undefined {
  return firstIssue(emailRule.safeParse(value.trim()));
}

/**
 * Dùng lúc ĐĂNG NHẬP: chỉ kiểm tra có nhập hay chưa.
 *
 * Cố ý không áp `passwordRule` — mật khẩu cũ có thể không thoả luật mới, và báo
 * "mật khẩu phải có chữ hoa" ở màn đăng nhập là rò rỉ quy tắc mật khẩu của hệ
 * thống cho người chưa xác thực.
 */
export function validateLoginPassword(value: string): string | undefined {
  if (!value) return 'Vui lòng nhập mật khẩu';
  return undefined;
}

/** Dùng khi ĐẶT mật khẩu mới: áp đủ luật của `@bi/shared`. */
export function validateNewPassword(value: string): string | undefined {
  if (!value) return 'Vui lòng nhập mật khẩu mới';
  return firstIssue(passwordRule.safeParse(value));
}
