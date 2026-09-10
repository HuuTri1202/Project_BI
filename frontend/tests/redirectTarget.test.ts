import { describe, expect, it } from 'vitest';
import { redirectTargetFor } from '../src/auth/redirectTarget';
import type { PublicUser, TenantRole } from '../src/types/auth';

/**
 * Điều hướng sau đăng nhập.
 *
 * Đáng viết test vì thứ tự ưu tiên ở đây là loại logic mà đọc code thấy đúng
 * nhưng chạy lại sai với đúng một tổ hợp đầu vào.
 *
 * Người vận hành NỀN TẢNG vào thẳng console; mọi người khác về trang chủ.
 *
 * ⚠️ Bộ test này ĐÃ TỪNG khẳng định điều ngược lại, và nói rất chắc chắn. Giữ
 * ghi chú đó ở đây để người sau thấy: một bài test xanh không chứng minh hành vi
 * ĐÚNG, nó chỉ chứng minh hành vi KHỚP với thứ ai đó đã viết ra. Lý lẽ cũ ("con
 * sole là nơi chủ động đi tới") đúng về nguyên tắc nhưng sai với tài khoản
 * `seed:admin`: tổ chức `bi-platform` của nó chỉ tồn tại để thoả ràng buộc
 * membership, không có dữ liệu và không có ai khác trong đó.
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

  it('quản trị hệ thống vào THẲNG console', () => {
    // Việc của tài khoản này là vận hành nền tảng, nên đó là nơi nó phải rơi
    // vào. Bắt đi qua một trang chủ trống rồi bấm thêm một nút là thêm một bước
    // cho mọi lần đăng nhập.
    expect(redirectTargetFor(superadmin(), 'admin', null)).toBe('/admin');
    expect(redirectTargetFor(superadmin(), 'admin', '/')).toBe('/admin');
  });

  it('ADMIN CỦA TỔ CHỨC vẫn về trang chủ — rẽ theo trục NỀN TẢNG', () => {
    /*
     * Ca canh ranh giới quan trọng nhất của hàm này.
     *
     * Luồng đăng ký cấp `admin` TRONG TỔ CHỨC cho mọi người tự lập công ty. Nếu
     * ai đó "đơn giản hoá" bằng cách rẽ theo `role === 'admin'` thay vì
     * `platformRole`, thì mọi người tự đăng ký đều bị ném vào console vận hành —
     * rồi `AdminRoute` đá họ sang /403, và họ không vào được app nữa.
     *
     * `AdminRoute` cùng ba lớp guard ở backend là chỗ chặn THẬT; hàm này chỉ
     * chọn nơi rơi vào, nên nó phải chọn đúng để không dẫn người ta vào tường.
     */
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

  it.each(['//evil.com', 'https://evil.com', '/\\evil.com'])(
    'chặn open redirect CẢ với superadmin: %s',
    (from) => {
      // Ca riêng vì nhánh trả về của superadmin nằm SAU phép lọc `from`. Gộp vào
      // ca trên sẽ bỏ sót đúng thứ tự đó — và một open redirect nhắm vào tài
      // khoản vận hành nền tảng là ca tệ nhất trong mọi ca.
      expect(redirectTargetFor(superadmin(), 'admin', from)).toBe('/admin');
    },
  );
});
