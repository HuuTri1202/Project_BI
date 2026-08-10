import { describe, expect, it } from 'vitest';
import { redirectTargetFor } from '../src/auth/redirectTarget';
import type { PublicUser, TenantRole } from '../src/types/auth';

/**
 * Điều hướng sau đăng nhập.
 *
 * Đáng viết test vì thứ tự ưu tiên ở đây là loại logic mà đọc code thấy đúng
 * nhưng chạy lại sai với đúng một tổ hợp đầu vào — và tổ hợp đó (`from === '/'`
 * với người dùng là admin) đã thật sự lọt ra sản phẩm: admin đăng nhập xong bị
 * trả về trang chủ trống và tưởng khu quản trị hỏng.
 */

/** Người dùng thường: `platformRole = 'user'`. */
const user = (overrides: Partial<PublicUser> = {}): PublicUser =>
  ({
    id: 1,
    email: 'a@b.com',
    fullName: 'A',
    platformRole: 'user',
    mustChangePassword: false,
    ...overrides,
  }) as PublicUser;

/** Quản trị viên hệ thống — tài khoản sinh bằng seed:admin. */
const superadmin = (overrides: Partial<PublicUser> = {}): PublicUser =>
  user({ platformRole: 'superadmin', ...overrides });

describe('redirectTargetFor', () => {
  it('mật khẩu tạm chặn TẤT CẢ, kể cả from và quyền hệ thống', () => {
    expect(
      redirectTargetFor(superadmin({ mustChangePassword: true }), 'admin', '/admin/users'),
    ).toBe('/change-password');
  });

  it('quản trị hệ thống về /admin khi không có from', () => {
    expect(redirectTargetFor(superadmin(), 'admin', null)).toBe('/admin');
  });

  it('quản trị hệ thống về /admin khi from là "/" — ca đã từng lọt', () => {
    // `/` là điểm rơi mặc định của phiên hết hạn, không phải trang người dùng
    // chủ động muốn tới.
    expect(redirectTargetFor(superadmin(), 'admin', '/')).toBe('/admin');
  });

  it('ADMIN CỦA TỔ CHỨC nhưng không phải quản trị hệ thống thì KHÔNG vào /admin', () => {
    // Đây là lỗ hổng đã từng có: luồng đăng ký cấp `admin` cho người tự lập tổ
    // chức, nên ai đăng ký cũng vào được khu vận hành hệ thống.
    expect(redirectTargetFor(user(), 'admin', null)).toBe('/');
  });

  it('vẫn tôn trọng from khi đó là một trang cụ thể', () => {
    expect(redirectTargetFor(superadmin(), 'admin', '/admin/workspaces')).toBe('/admin/workspaces');
    expect(redirectTargetFor(user(), 'viewer', '/system-health')).toBe('/system-health');
  });

  it('người dùng thường về trang chủ', () => {
    expect(redirectTargetFor(user(), 'viewer', null)).toBe('/');
    expect(redirectTargetFor(user(), 'creator', '/')).toBe('/');
  });

  it.each(['//evil.com', 'https://evil.com', '/\\evil.com', 'evil.com'])(
    'chặn open redirect: %s',
    (from) => {
      // Không lọc thì đăng nhập xong người dùng bị ném thẳng sang trang giả mạo.
      const target = redirectTargetFor(user(), 'viewer' as TenantRole, from);
      expect(target).toBe('/');
    },
  );
});
