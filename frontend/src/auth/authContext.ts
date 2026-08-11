import { createContext } from 'react';
import type { Membership, PublicUser, Tenant, TenantRole } from '../types/auth';

/**
 * File này CỐ Ý không chứa component nào.
 *
 * Luật `react-refresh/only-export-components` cảnh báo mọi file vừa export
 * component vừa export thứ khác, và tuỳ chọn `allowConstantExport` chỉ tha cho
 * hằng số hiển nhiên chứ không tha cho kết quả của `createContext(...)`.
 * Tách ba file — context / provider / hook — là cách sạch nhất, không phải rải
 * `eslint-disable` khắp nơi.
 */

/**
 * Ba trạng thái, không phải hai.
 *
 * `loading` là bắt buộc: thiếu nó thì mỗi lần F5, `ProtectedRoute` thấy
 * `user === null` và đẩy về `/login` trong chớp mắt trước khi `GET /me` kịp trả
 * lời — người dùng thấy trang đăng nhập nháy lên rồi biến mất.
 */
export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

/** Kết quả đăng nhập mà trang gọi cần để quyết định điều hướng. */
export interface LoginOutcome {
  user: PublicUser;
  role: TenantRole;
}

export interface AuthContextValue {
  status: AuthStatus;
  user: PublicUser | null;
  /** Tổ chức đang mở. */
  tenant: Tenant | null;
  /** Vai trò TRONG tổ chức đang mở — đây là thứ mọi kiểm tra quyền dùng tới. */
  role: TenantRole | null;
  /** Mọi tổ chức người này thuộc về. Dùng cho chức năng đổi tổ chức sau này. */
  memberships: Membership[];
  /** Đăng nhập; ném lỗi để trang gọi tự hiển thị thông báo từ API. */
  login: (email: string, password: string) => Promise<LoginOutcome>;
  logout: () => Promise<void>;
  /**
   * Đổi tổ chức đang mở (§5.1) — cấp lại token vì `tenantId` nằm trong JWT.
   *
   * Ném lỗi để nơi gọi hiển thị thông báo: người dùng có thể vừa bị gỡ khỏi tổ
   * chức đó trong lúc dropdown còn hiện tên nó.
   */
  switchTenant: (tenantId: number) => Promise<void>;
  /** Gọi sau khi đổi mật khẩu thành công để hạ cờ `mustChangePassword`. */
  markPasswordChanged: () => void;
  /**
   * Gọi sau khi sửa hồ sơ (§4.4) với bản ghi `users` mới nhất từ server.
   *
   * Cần thiết vì tên hiển thị trên topbar đọc từ context này, không phải từ
   * cache react-query. Thiếu nó, người dùng lưu xong sẽ thấy tên mới trong form
   * và tên cũ ở góc màn hình — hai sự thật cùng lúc trên một trang.
   */
  applyProfile: (user: PublicUser) => void;
  /**
   * Gọi sau khi đổi tên tổ chức với bản ghi `tenants` mới nhất từ server.
   *
   * Cùng lý do với `applyProfile`: tên tổ chức hiện trên topbar và trong bộ
   * chuyển tổ chức đọc từ context này chứ không phải từ cache react-query.
   */
  applyTenant: (tenant: Tenant) => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
