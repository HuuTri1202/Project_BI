import { useQueryClient } from '@tanstack/react-query';
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

  const queryClient = useQueryClient();

  /**
   * Dọn sạch phiên phía client. Dùng chung cho đăng xuất và hết hạn token.
   *
   * `queryClient.clear()` KHÔNG phải dọn dẹp cho gọn. Cache của react-query nằm
   * trong bộ nhớ của tab, không gắn với tài khoản nào cả — đăng xuất rồi đăng
   * nhập bằng tài khoản khác trên cùng tab mà không xoá thì danh sách nhân sự,
   * email và số liệu của tổ chức trước sẽ hiện ra cho người sau, ít nhất cho tới
   * lần refetch kế tiếp. Trên máy dùng chung đó là rò rỉ dữ liệu giữa hai tổ
   * chức, không phải lỗi hiển thị.
   */
  const clearSession = useCallback(() => {
    clearToken();
    queryClient.clear();
    setSession(ANONYMOUS);
  }, [queryClient]);

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

  /**
   * Đổi tổ chức đang mở — §5.1.
   *
   * `queryClient.clear()` KHÔNG phải dọn dẹp cho gọn, nó là bắt buộc và vì một
   * lý do khác với lúc đăng xuất: query key của khu người dùng CỐ Ý không chứa
   * `tenantId` (xem `features/tenant/keys.ts`), vì token chỉ mở đúng một tổ chức
   * nên chuyện đó không cần thiết. Đổi tổ chức phá vỡ đúng giả định ấy — không
   * xoá thì danh sách thành viên, workspace và project của công ty CŨ hiện
   * nguyên xi dưới tên công ty MỚI cho tới lần refetch kế tiếp.
   *
   * Ghi token TRƯỚC khi dọn cache và đổi state: react-query có thể bắn refetch
   * ngay trong lần render kế tiếp, và nó phải đi kèm token của tổ chức mới.
   */
  const switchTenant = useCallback(
    async (tenantId: number): Promise<void> => {
      const res = await authApi.switchTenant(tenantId);
      writeToken(res.token);
      queryClient.clear();
      setSession({
        status: 'authenticated',
        user: res.user,
        tenant: res.tenant,
        role: res.role,
        memberships: res.memberships,
      });
    },
    [queryClient],
  );

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

  /**
   * Thay bản ghi user bằng bản vừa lưu (§4.4).
   *
   * Ghi đè cả đối tượng thay vì trộn từng trường: server đã trả về bản ghi đầy
   * đủ và mới nhất, còn trộn tay thì mỗi lần thêm một cột vào `users` lại phải
   * nhớ sửa cả chỗ này — kiểu nợ mà không ai phát hiện cho tới khi một trường
   * lặng lẽ không bao giờ cập nhật.
   */
  const applyProfile = useCallback((user: PublicUser) => {
    setSession((prev) => (prev.user ? { ...prev, user } : prev));
  }, []);

  /**
   * Thay bản ghi tổ chức sau khi đổi tên.
   *
   * Phải cập nhật CẢ HAI chỗ: `tenant` (topbar, dòng ngữ cảnh trên màn hẹp) và
   * đúng phần tử trong `memberships` (bộ chuyển tổ chức). Sửa một chỗ thì màn
   * hình tự mâu thuẫn — topbar ghi tên mới còn dropdown ngay cạnh vẫn tên cũ, và
   * người dùng sẽ tưởng thao tác đổi tên chỉ thành công một nửa.
   *
   * So khớp theo `id` chứ không giả định tổ chức đang mở nằm ở đầu danh sách:
   * thứ tự do `m.id ASC` quyết định, không liên quan gì tới tổ chức nào đang mở.
   */
  const applyTenant = useCallback((tenant: Tenant) => {
    setSession((prev) => ({
      ...prev,
      tenant: prev.tenant?.id === tenant.id ? { ...prev.tenant, ...tenant } : prev.tenant,
      memberships: prev.memberships.map((m) => (m.id === tenant.id ? { ...m, ...tenant } : m)),
    }));
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...session,
      login,
      logout,
      switchTenant,
      markPasswordChanged,
      applyProfile,
      applyTenant,
    }),
    [session, login, logout, switchTenant, markPasswordChanged, applyProfile, applyTenant],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
