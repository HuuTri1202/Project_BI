import { useContext } from 'react';
import { AuthContext, type AuthContextValue } from './authContext';

/**
 * Lấy phiên đăng nhập hiện tại.
 *
 * Ném lỗi thay vì trả `null` khi dùng ngoài `AuthProvider`: đó là lỗi lắp ráp
 * của lập trình viên, phải nổ ngay lúc dev chứ không được âm thầm biến thành
 * "chưa đăng nhập" rồi làm người ta đi tìm bug ở chỗ khác.
 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth phải được dùng bên trong <AuthProvider>');
  }
  return ctx;
}
