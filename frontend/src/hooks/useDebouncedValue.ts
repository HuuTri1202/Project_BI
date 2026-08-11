import { useEffect, useState } from 'react';

/**
 * Trả về `value` sau khi nó đã ngừng thay đổi `delay` mili-giây.
 *
 * Dùng cho ô tìm kiếm: ô nhập giữ state riêng nên gõ không bao giờ giật, còn
 * giá trị đã ổn định mới được ghi vào URL — và vì query key của react-query dẫn
 * xuất từ URL, request cũng được gộp lại theo. Gõ "nguyen" ra một request thay
 * vì sáu.
 */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    // Dọn timer cũ mỗi khi `value` đổi — đây chính là phần "debounce". Thiếu nó
    // thì mọi lần gõ đều tự hẹn giờ riêng và tất cả đều nổ.
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
