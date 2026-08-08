import type { TenantRole } from '@bi/shared';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AuthContext, type AuthContextValue } from '../src/auth/authContext';
import { AdminRoute } from '../src/routes/AdminRoute';

/**
 * §3.6 phía giao diện.
 *
 * Đây KHÔNG phải test bảo mật — chặn route ở trình duyệt chỉ để người dùng khỏi
 * lạc vào trang không dùng được, ai cũng gọi thẳng API bằng curl được. Phần bảo
 * mật thật nằm ở `backend/tests/admin.integration.test.ts`, chạy theo bảng route.
 *
 * Cái test này canh: đừng để một lần refactor biến cổng đó thành vô hiệu, khiến
 * viewer thấy giao diện quản trị rồi bấm gì cũng nhận 403 — trải nghiệm tệ hơn
 * hẳn so với nói thẳng ngay từ đầu.
 */

function renderWithRole(role: TenantRole | null): void {
  const value = {
    status: 'authenticated',
    user: null,
    tenant: null,
    role,
    memberships: [],
    login: async () => ({}) as never,
    logout: async () => undefined,
    markPasswordChanged: () => undefined,
  } as unknown as AuthContextValue;

  render(
    <AuthContext.Provider value={value}>
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route element={<AdminRoute />}>
            <Route path="/admin" element={<p>KHU QUAN TRI</p>} />
          </Route>
          <Route path="/403" element={<p>KHONG CO QUYEN</p>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe('AdminRoute', () => {
  it('cho admin vào', () => {
    renderWithRole('admin');
    expect(screen.getByText('KHU QUAN TRI')).toBeInTheDocument();
  });

  it.each(['creator', 'viewer'] as TenantRole[])('đẩy %s sang /403', (role) => {
    renderWithRole(role);
    expect(screen.getByText('KHONG CO QUYEN')).toBeInTheDocument();
    expect(screen.queryByText('KHU QUAN TRI')).not.toBeInTheDocument();
  });

  it('chưa có vai trò cũng bị chặn', () => {
    // Chỉ `=== 'admin'` mới được qua. Viết ngược lại thành `!== 'viewer'` là lỗi
    // rất dễ mắc khi thêm vai trò mới, và nó mở cửa cho mọi vai trò chưa biết.
    renderWithRole(null);
    expect(screen.getByText('KHONG CO QUYEN')).toBeInTheDocument();
  });
});
