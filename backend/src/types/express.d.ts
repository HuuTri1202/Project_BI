import type { UserRole } from '../repositories/users';

/**
 * Mở rộng `Request` của Express để middleware `authenticate` gắn được thông tin
 * người dùng đã xác thực, và mọi handler phía sau đọc có kiểu.
 *
 * `auth` để optional vì route công khai không đi qua `authenticate`. Handler
 * nằm sau `authenticate` vẫn phải kiểm tra — xem `requireAuth` trong
 * middleware/authenticate.ts để lấy giá trị đã thu hẹp kiểu.
 */
declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: number;
        role: UserRole;
        tenantId: number;
      };
    }
  }
}

export {};
