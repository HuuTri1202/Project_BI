import type { TenantRole } from '../repositories/memberships';

/**
 * Mở rộng `Request` của Express để middleware `authenticate` gắn được thông tin
 * người dùng đã xác thực, và mọi handler phía sau đọc có kiểu.
 *
 * `auth` để optional vì route công khai không đi qua `authenticate`. Handler
 * nằm sau `authenticate` vẫn phải kiểm tra — xem `requireAuth` trong
 * middleware/authenticate.ts để lấy giá trị đã thu hẹp kiểu.
 *
 * `role` là vai trò trong tổ chức `tenantId`, không phải vai trò toàn hệ thống;
 * `platformRole` mới là trục còn lại. Xem ghi chú hai trục trong db/migrations.ts.
 */
declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: number;
        tenantId: number;
        role: TenantRole;
        platformRole: 'superadmin' | 'user';
      };
    }
  }
}

export {};
