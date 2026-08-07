import { Route, Routes } from 'react-router-dom';

import { LoginPage } from './features/auth/LoginPage';
import { RegisterPage } from './features/auth/RegisterPage';
import { HomePage } from './pages/HomePage';

/**
 * Bảng route. Chưa có route cần bảo vệ vì chưa có trang nào chỉ dành cho người
 * đã đăng nhập — khi có, thêm một component `<RequireAuth>` bọc quanh nhóm route
 * đó thay vì kiểm tra rải rác trong từng trang.
 */
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="*" element={<HomePage />} />
    </Routes>
  );
}
