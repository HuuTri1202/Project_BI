import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { setUnauthorizedHandler } from '../services/apiClient';
import * as authApi from '../services/authApi';
import type { Membership, PublicUser, Tenant, TenantRole } from '../types/auth';
import {
  AuthContext,
  type AuthContextValue,
  type AuthStatus,
  type LoginOutcome,
} from './authContext';
import { clearToken, readToken, writeToken } from './tokenStorage';

interface Session {
  status: AuthStatus;
  user: PublicUser | null;
  tenant: Tenant | null;
  role: TenantRole | null;
  memberships: Membership[];
}

const ANONYMOUS: Session = {
  status: 'anonymous',
  user: null,
  tenant: null,
  role: null,
  memberships: [],
};

export function AuthProvider({ children }: { children: ReactNode }): React.ReactElement {
  // Khởi tạo là 'loading' khi CÓ token sẵn trong máy, 'anonymous' khi không.
  // Tính ngay lúc dựng state chứ không để mặc định 'loading' rồi sửa trong
  // effect: người chưa từng đăng nhập sẽ không phải nhìn màn hình chờ vô nghĩa.
  const [session, setSession] = useState<Session>(() =>
    readToken() ? { ...ANONYMOUS, status: 'loading' } : ANONYMOUS,
  );

  const navigate = useNavigate();

  /** Dọn sạch phiên phía client. Dùng chung cho đăng xuất và hết hạn token. */
  const clearSession = useCallback(() => {
    clearToken();
    setSession(ANONYMOUS);
  }, []);

  // --- §2.5 Khôi phục phiên khi F5 --------------------------------------------
  useEffect(() => {
    if (!readToken()) return;

    // StrictMode ở dev cố tình chạy effect hai lần, nên tab Network sẽ hiện HAI
    // request /me. Vô hại vì GET idempotent — cờ này chỉ để phản hồi của lần
    // chạy đã bị huỷ không ghi đè state.
    let ignore = false;

    authApi
      .fetchMe()
      .then((me) => {
        if (!ignore) {
          setSession({
            status: 'authenticated',
            user: me.user,
            tenant: me.tenant,
            role: me.role,
            memberships: me.memberships,
          });
        }
      })
      .catch(() => {
        // Token hỏng, hết hạn, tài khoản bị khoá, hoặc đã bị gỡ khỏi tổ chức
        // trong token -> coi như chưa đăng nhập. Không điều hướng ở đây:
        // ProtectedRoute sẽ tự đẩy đi và giữ được `location.state.from`.
        if (!ignore) {
          clearToken();
          setSession(ANONYMOUS);
        }
      });

    return () => {
      ignore = true;
    };
  }, []);

  // --- Token hết hạn giữa chừng ------------------------------------------------
  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearSession();
      // Đọc URL tại đúng thời điểm 401 xảy ra, thay vì bắt `useLocation()` vào
      // closure — làm vậy sẽ phải đăng ký lại handler sau mỗi lần chuyển trang.
      const from = window.location.pathname + window.location.search;
      navigate('/login', { replace: true, state: { from } });
    });

    return () => setUnauthorizedHandler(null);
  }, [clearSession, navigate]);

  const login = useCallback(async (email: string, password: string): Promise<LoginOutcome> => {
    const res = await authApi.login(email, password);
    // Ghi token TRƯỚC khi đổi state: request đầu tiên phát ra ngay sau khi
    // render lại đã có sẵn header Authorization.
    writeToken(res.token);
    setSession({
      status: 'authenticated',
      user: res.user,
      tenant: res.tenant,
      role: res.role,
      memberships: res.memberships,
    });
    return { user: res.user, role: res.role };
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout();
    clearSession();
    navigate('/login', { replace: true });
  }, [clearSession, navigate]);

  const markPasswordChanged = useCallback(() => {
    setSession((prev) =>
      prev.user ? { ...prev, user: { ...prev.user, mustChangePassword: false } } : prev,
    );
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ ...session, login, logout, markPasswordChanged }),
    [session, login, logout, markPasswordChanged],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
