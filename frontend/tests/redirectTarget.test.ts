import { describe, expect, it } from 'vitest';
import { redirectTargetFor } from '../src/auth/redirectTarget';
import type { PublicUser, TenantRole } from '../src/types/auth';

/**
 * Điều hướng sau đăng nhập.
 *
 * Đáng viết test vì thứ tự ưu tiên ở đây là loại logic mà đọc code thấy đúng
 * nhưng chạy lại sai với đúng một tổ hợp đầu vào.
 *
 * MỌI người — kể cả quản trị hệ thống — đều về trang chủ. Đường vào console vận
 * hành là nút "Admin Console" trên chính trang chủ đó, chỉ hiện với
 * `platformRole === 'superadmin'`. Bản trước đưa thẳng superadmin vào `/admin`,
 * nghĩa là muốn xem workspace của chính mình thì phải tự gõ địa chỉ.
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

  it('quản trị hệ thống cũng về trang chủ, KHÔNG nhảy thẳng vào /admin', () => {
    // Console vận hành là nơi người ta chủ động đi tới, không phải điểm rơi mặc
    // định của mỗi lần đăng nhập. Nút "Admin Console" trên trang chủ mới là cửa.
    expect(redirectTargetFor(superadmin(), 'admin', null)).toBe('/');
    expect(redirectTargetFor(superadmin(), 'admin', '/')).toBe('/');
  });

  it('ADMIN CỦA TỔ CHỨC cũng về trang chủ', () => {
    // Luồng đăng ký cấp `admin` trong tổ chức cho mọi người tự lập công ty. Vai
    // trò đó KHÔNG mở được khu vận hành hệ thống — đó là lỗ hổng đã từng có, và
    // `AdminRoute` cùng ba lớp guard ở backend là chỗ chặn thật.
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
