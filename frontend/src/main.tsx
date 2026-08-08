import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './auth/AuthProvider';
import { createQueryClient } from './services/queryClient';
import './index.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found');

const queryClient = createQueryClient();

createRoot(rootEl).render(
  <StrictMode>
    {/* Thứ tự bọc là bắt buộc, và mỗi lớp có lý do riêng:
     *
     *   BrowserRouter      ngoài cùng — AuthProvider dùng `useNavigate` để đẩy
     *                      về /login khi token hết hạn.
     *
     *   QueryClientProvider phải bọc NGOÀI AuthProvider, vì lúc đăng xuất
     *                      AuthProvider gọi `queryClient.clear()`. Không có
     *                      bước đó thì đăng xuất rồi đăng nhập tài khoản khác
     *                      trên cùng một tab sẽ đọc lại cache cũ — tức là danh
     *                      sách nhân sự của tổ chức trước hiện ra cho người sau.
     *                      Trên máy dùng chung, đó là rò rỉ dữ liệu thật.
     */}
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </QueryClientProvider>
    </BrowserRouter>
  </StrictMode>,
);
