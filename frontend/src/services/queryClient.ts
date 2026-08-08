import { QueryClient } from '@tanstack/react-query';
import axios from 'axios';

/**
 * Lỗi 4xx là lỗi của REQUEST, thử lại không đổi kết quả.
 *
 * Mặc định react-query thử lại 3 lần cho mọi lỗi. Với API này thì đó là hành vi
 * sai ở hai chỗ cụ thể: một mã 403 từ `requireFreshAdmin` sẽ mất ba vòng mới
 * hiện ra cho người dùng, còn 401 thì bị thử lại SAU KHI interceptor của axios
 * đã dọn phiên và chuyển hướng sang /login — request thừa bắn vào khoảng không.
 */
function isClientError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  const status = error.response?.status;
  return status !== undefined && status >= 400 && status < 500;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Trang quản trị là thứ mở ra rồi thao tác liên tục trong vài phút.
        // 30 giây đủ để chuyển qua lại giữa các trang không bắn lại request,
        // nhưng vẫn đủ mới để không hiển thị số liệu của tuần trước.
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        // Admin alt-tab sang chỗ khác rồi quay lại là chuyện xảy ra liên tục;
        // bắn lại toàn bộ query mỗi lần như vậy chỉ tốn băng thông và làm nháy
        // giao diện mà không mang lại thông tin gì mới trong 30 giây.
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => failureCount < 2 && !isClientError(error),
      },
      mutations: {
        // Thao tác ghi KHÔNG BAO GIỜ tự thử lại: "gỡ thành viên" chạy hai lần
        // không phải là điều ta muốn đoán hộ người dùng.
        retry: false,
      },
    },
  });
}
