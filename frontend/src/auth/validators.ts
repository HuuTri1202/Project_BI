/**
 * Validate phía client — §2.2.
 *
 * Viết tay, không thêm thư viện form: chỉ có hai form và ba luật, kéo cả
 * react-hook-form + resolver về là thêm 3 gói cho một việc 40 dòng.
 *
 * Luật ở đây phải KHỚP với zod ở backend (backend/src/api/auth/schemas.ts).
 * Đây là lớp trải nghiệm để người dùng biết sai ngay, KHÔNG phải lớp bảo vệ —
 * backend vẫn validate lại toàn bộ vì trình duyệt sửa được.
 */

/** bcrypt cắt cụt ở byte thứ 72; backend chặn ở đúng con số này. */
export const MAX_PASSWORD_LENGTH = 72;
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Biểu thức email cố tình dễ dãi: chặn lỗi gõ nhầm rõ ràng (thiếu @, thiếu tên
 * miền, có khoảng trắng) chứ không cố bám RFC 5322 — regex đúng chuẩn dài hàng
 * trăm ký tự và vẫn từ chối nhầm những địa chỉ hợp lệ.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(value: string): string | undefined {
  const email = value.trim();
  if (!email) return 'Vui lòng nhập email';
  if (email.length > 255) return 'Email quá dài';
  if (!EMAIL_PATTERN.test(email)) return 'Email không đúng định dạng';
  return undefined;
}

/**
 * Dùng lúc ĐĂNG NHẬP: chỉ kiểm tra có nhập hay chưa.
 *
 * Cố ý không áp luật độ dài tối thiểu ở đây — mật khẩu cũ có thể được tạo theo
 * quy tắc khác, và báo "phải đủ 8 ký tự" ngay trên form đăng nhập là tiết lộ
 * quy tắc mật khẩu của hệ thống cho người chưa xác thực.
 */
export function validateLoginPassword(value: string): string | undefined {
  if (!value) return 'Vui lòng nhập mật khẩu';
  return undefined;
}

/** Dùng khi ĐẶT mật khẩu mới: áp đủ luật độ dài. */
export function validateNewPassword(value: string): string | undefined {
  if (!value) return 'Vui lòng nhập mật khẩu mới';
  if (value.length < MIN_PASSWORD_LENGTH) {
    return `Mật khẩu phải có ít nhất ${MIN_PASSWORD_LENGTH} ký tự`;
  }
  if (value.length > MAX_PASSWORD_LENGTH) {
    return `Mật khẩu tối đa ${MAX_PASSWORD_LENGTH} ký tự`;
  }
  return undefined;
}
