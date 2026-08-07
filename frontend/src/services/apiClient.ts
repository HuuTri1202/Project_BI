import axios, { type AxiosError, type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import { readToken } from '../auth/tokenStorage';
import type { ApiErrorBody } from '../types/auth';

/**
 * Gốc API. Phải là `/api` — router xác thực mount ở `/api/auth`, còn `/api/v1`
 * chỉ là một nhánh con. Khi dev, đường dẫn tương đối đi qua proxy của Vite nên
 * không dính CORS (xem `server.proxy` trong vite.config.ts).
 */
const BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

export const apiClient: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
});

// --- Interceptor 1: gắn token vào mọi request ---------------------------------
// Đọc token ở thời điểm GỬI chứ không phải lúc tạo instance: người dùng đăng
// nhập sau khi app đã khởi động, nếu chốt token lúc tạo thì request đầu tiên
// sau đăng nhập vẫn đi tay không.
apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = readToken();
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`);
  }
  return config;
});

// --- Interceptor 2: 401 giữa chừng = hết phiên --------------------------------

/**
 * Những endpoint TỰ xử lý 401 của mình, interceptor phải bỏ qua.
 *
 * `/auth/login` — nhập sai mật khẩu cũng trả 401. Nếu coi đó là hết phiên thì
 *   trang bị điều hướng đi và form KHÔNG BAO GIỜ hiện được thông báo lỗi từ
 *   API. Đây là lỗi dễ mắc nhất của bước này.
 * `/auth/me`    — chỉ được gọi lúc khôi phục phiên. AuthProvider tự chuyển sang
 *   trạng thái ẩn danh; để interceptor chen vào sẽ mất `location.state.from`,
 *   người dùng đăng nhập xong không quay lại được trang đang định vào.
 *
 * Nói gọn: hai endpoint này THIẾT LẬP phiên, không phải SỬ DỤNG phiên.
 */
const SESSION_ENDPOINTS = ['/auth/login', '/auth/me'];

type UnauthorizedHandler = () => void;
let onUnauthorized: UnauthorizedHandler | null = null;

/**
 * Đăng ký việc cần làm khi phiên hết hạn giữa chừng.
 *
 * Interceptor nằm NGOÀI cây React nên không gọi được `useNavigate`. Dùng
 * `window.location.href = '/login'` thì tải lại toàn trang, mất trạng thái và
 * nháy trắng. Thay vào đó `AuthProvider` đăng ký một hàm đóng gói sẵn
 * `navigate()` của router — điều hướng mượt, không reload.
 */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  onUnauthorized = handler;
}

apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError<ApiErrorBody>) => {
    const url = error.config?.url ?? '';
    const isSessionEndpoint = SESSION_ENDPOINTS.some((path) => url.startsWith(path));

    if (error.response?.status === 401 && !isSessionEndpoint) {
      onUnauthorized?.();
    }

    // Luôn ném tiếp: nơi gọi vẫn cần biết request đã hỏng.
    return Promise.reject(error);
  },
);

// --- Đọc lỗi ------------------------------------------------------------------

const NETWORK_ERROR: ApiErrorBody = {
  error: 'NetworkError',
  message: 'Không kết nối được máy chủ. Kiểm tra backend đang chạy ở cổng 4000.',
};

const UNKNOWN_ERROR: ApiErrorBody = {
  error: 'UnknownError',
  message: 'Có lỗi không xác định. Vui lòng thử lại.',
};

/**
 * Bóc thân lỗi của backend ra khỏi AxiosError.
 *
 * Bọc lại vì phần lớn màn hình chỉ cần `message` và `fields`; để mỗi trang tự
 * mò `err.response.data` sẽ sinh ra cả tá đường dẫn tuỳ tiện, và trang nào quên
 * xử lý lỗi mạng sẽ hiện "undefined" cho người dùng.
 */
export function getApiError(err: unknown): ApiErrorBody {
  if (!axios.isAxiosError(err)) return UNKNOWN_ERROR;

  const body = (err as AxiosError<ApiErrorBody>).response?.data;
  // Có phản hồi nhưng không đúng khuôn (ví dụ nginx trả HTML 502) -> đừng tin.
  if (body && typeof body.message === 'string') return body;

  return err.response ? UNKNOWN_ERROR : NETWORK_ERROR;
}
