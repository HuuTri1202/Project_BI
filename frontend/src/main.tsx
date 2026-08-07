import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import App from './App';
import './index.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found');

createRoot(rootEl).render(
  <StrictMode>
    {/* BrowserRouter (không phải HashRouter) dùng được vì Vite mặc định
        appType:'spa' — F5 ở /register vẫn trả index.html. Khi deploy thật, web
        server cũng phải có fallback tương tự, nếu không /register sẽ ra 404. */}
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
