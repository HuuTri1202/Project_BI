import { createContext } from 'react';
import type { PublicUser, Tenant } from '../types/auth';

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

export interface AuthContextValue {
  status: AuthStatus;
  user: PublicUser | null;
  tenant: Tenant | null;
  /** Đăng nhập; ném lỗi để trang gọi tự hiển thị thông báo từ API. */
  login: (email: string, password: string) => Promise<PublicUser>;
  logout: () => Promise<void>;
  /** Gọi sau khi đổi mật khẩu thành công để hạ cờ `mustChangePassword`. */
  markPasswordChanged: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
