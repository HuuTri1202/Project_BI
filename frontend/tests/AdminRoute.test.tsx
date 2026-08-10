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

function renderWithRole(role: TenantRole | null, platformRole: 'superadmin' | 'user' = 'user'): void {
  const value = {
    status: 'authenticated',
    user: { id: 1, email: 'a@b.com', fullName: 'A', platformRole },
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
  it('cho quản trị viên HỆ THỐNG vào', () => {
    renderWithRole('admin', 'superadmin');
    expect(screen.getByText('KHU QUAN TRI')).toBeInTheDocument();
  });

  it('CHẶN admin của tổ chức — đây là lỗ hổng đã từng có', () => {
    // Luồng đăng ký cấp `admin` cho người tự lập tổ chức của mình, nên gác bằng
    // trục tổ chức nghĩa là ai đăng ký cũng vào được khu vận hành hệ thống.
    renderWithRole('admin', 'user');
    expect(screen.getByText('KHONG CO QUYEN')).toBeInTheDocument();
    expect(screen.queryByText('KHU QUAN TRI')).not.toBeInTheDocument();
  });

  it.each(['creator', 'viewer'] as TenantRole[])('đẩy %s sang /403', (role) => {
    renderWithRole(role, 'user');
    expect(screen.getByText('KHONG CO QUYEN')).toBeInTheDocument();
  });

  it('superadmin vẫn vào được dù vai trò tổ chức thấp', () => {
    // Hai trục độc lập: quyền vận hành hệ thống không phụ thuộc vai trò trong
    // một tổ chức cụ thể.
    renderWithRole('viewer', 'superadmin');
    expect(screen.getByText('KHU QUAN TRI')).toBeInTheDocument();
  });

  it('chưa có thông tin người dùng thì bị chặn', () => {
    renderWithRole(null, 'user');
    expect(screen.getByText('KHONG CO QUYEN')).toBeInTheDocument();
  });
});
