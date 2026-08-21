import type { TenantRole } from '@bi/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AuthContext, type AuthContextValue } from '../src/auth/authContext';
import type { PermissionFlag } from '../src/auth/usePermissions';
import { TenantAdminRoute } from '../src/routes/TenantAdminRoute';

/**
 * Cổng route theo quyền tổ chức — mặt giao diện của migration 26.
 *
 * ─── Cái test này canh gì ───────────────────────────────────────────────────
 *
 * KHÔNG phải bảo mật. Chặn ở trình duyệt chỉ để người dùng khỏi lạc vào một
 * trang mà mọi request bên trong đều trả 403; phần thật nằm ở
 * `backend/tests/rbac.integration.test.ts`.
 *
 * Nó canh đúng một thứ: hai nguồn sự thật đừng lệch nhau. `matrixForRole` của
 * `@bi/shared` và cổng route phải nói cùng một điều, vì mục sidebar cũng đọc
 * đúng ô đó. Lệch nghĩa là hoặc menu hiện lên rồi dẫn thẳng vào /403, hoặc
 * giấu mất trang người dùng có quyền mở — và cả hai đều không tự lộ ra.
 *
 * ─── Vì sao không cần mock `GET /v1/permissions` ────────────────────────────
 *
 * `usePermissions` rơi về `matrixForRole(role)` khi request chưa trả lời. Ở đây
 * nó không bao giờ trả lời, nên thứ đang được kiểm chính là bảng nguồn dùng
 * chung — đúng cái ta muốn kiểm.
 */

function renderAt(role: TenantRole | null, needs: PermissionFlag, path: string): void {
  const value = {
    status: 'authenticated',
    user: { id: 1, email: 'a@b.com', fullName: 'A', platformRole: 'user' },
    tenant: null,
    role,
    memberships: [],
    login: async () => ({}) as never,
    logout: async () => undefined,
    markPasswordChanged: () => undefined,
  } as unknown as AuthContextValue;

  // `retry: false` để một lần fetch hỏng không kéo dài bài test bằng ba lần thử.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={value}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route element={<TenantAdminRoute needs={needs} />}>
              <Route path={path} element={<p>VAO DUOC</p>} />
            </Route>
            <Route path="/403" element={<p>KHONG CO QUYEN</p>} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

describe('TenantAdminRoute — Kho dữ liệu và Mô hình dữ liệu', () => {
  /*
   * Ba vai trò × hai cổng, viết thành bảng: thêm một vai trò mới mà quên nghĩ
   * tới hai trang này sẽ lộ ra ở đây chứ không lộ ra trên máy người dùng.
   */
  const BANG: [TenantRole, PermissionFlag, boolean][] = [
    ['admin', 'readDatasets', true],
    ['creator', 'readDatasets', true],
    ['viewer', 'readDatasets', false],
    ['admin', 'readDataModels', true],
    ['creator', 'readDataModels', true],
    ['viewer', 'readDataModels', false],
    /*
     * ─── Kết nối CSDL: HAI cổng, và chúng loại trừ nhau ─────────────────────
     *
     * Cùng một trang, hai chỗ đứng: admin vào qua tab của "Quản lý tổ chức",
     * creator vào qua mục sidebar riêng. Nên hai ô phải NGƯỢC nhau ở hai vai
     * trò, và bảng này là chỗ giữ điều đó.
     *
     * Nếu cả hai cùng đúng với một vai trò thì người đó thấy trang Kết nối ở
     * hai nơi; nếu cả hai cùng sai thì họ không vào được đâu cả. Cả hai kiểu
     * hỏng đều không tự lộ ra khi bấm thử một đường.
     */
    ['admin', 'manageOrgConnections', true],
    ['creator', 'manageOrgConnections', false],
    ['viewer', 'manageOrgConnections', false],
    ['admin', 'managePersonalConnections', false],
    ['creator', 'managePersonalConnections', true],
    ['viewer', 'managePersonalConnections', false],
  ];

  it.each(BANG)('%s + %s -> vào được: %s', (role, needs, duocVao) => {
    renderAt(role, needs, '/trang-thu');

    if (duocVao) {
      expect(screen.getByText('VAO DUOC')).toBeInTheDocument();
    } else {
      expect(screen.getByText('KHONG CO QUYEN')).toBeInTheDocument();
      expect(screen.queryByText('VAO DUOC')).not.toBeInTheDocument();
    }
  });

  it('viewer VẪN mở được trang báo cáo — đó là điều còn lại sau khi siết', () => {
    // Báo cáo cố ý KHÔNG có cổng nào trong `App.tsx`. Ca này giữ quyết định đó:
    // ai đó bọc `/reports/:id` bằng `readDatasets` "cho nhất quán" là khoá viewer
    // ra khỏi đúng thứ duy nhất họ được mời vào để xem.
    const value = {
      status: 'authenticated',
      user: { id: 1, email: 'a@b.com', fullName: 'A', platformRole: 'user' },
      tenant: null,
      role: 'viewer' as TenantRole,
      memberships: [],
      login: async () => ({}) as never,
      logout: async () => undefined,
      markPasswordChanged: () => undefined,
    } as unknown as AuthContextValue;

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={value}>
          <MemoryRouter initialEntries={['/reports/1']}>
            <Routes>
              <Route path="/reports/:id" element={<p>BAO CAO</p>} />
              <Route path="/403" element={<p>KHONG CO QUYEN</p>} />
            </Routes>
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>,
    );

    expect(screen.getByText('BAO CAO')).toBeInTheDocument();
  });
});
