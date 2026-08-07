import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// jsdom giữ nguyên DOM giữa các test trong cùng một file; không dọn thì test sau
// tìm thấy hai element trùng nhãn và `getByLabelText` ném lỗi "found multiple".
afterEach(() => {
  cleanup();
});
