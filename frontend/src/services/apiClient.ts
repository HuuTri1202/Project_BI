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

/**
 * Mã lỗi do CHÍNH FRONTEND dựng ra, không bao giờ tới từ máy chủ.
 *
 * Tách khỏi `ERROR_CODES` của `@bi/shared` là có chủ đích: danh sách bên đó là
 * hợp đồng của API, và trộn vào nó những mã mà backend không bao giờ trả sẽ
 * khiến người đọc đi tìm chỗ ném chúng ở phía server.
 *
 * Nơi gọi có thể so mã để rẽ nhánh — ví dụ giấu nút "Thử lại" khi lỗi là
 * `CLIENT`, vì bấm lại một lỗi lập trình thì vẫn ra đúng lỗi đó.
 */
export const CLIENT_ERROR_CODES = {
  /** Không hề có phản hồi nào — DNS hỏng, mất mạng, hoặc không ai nghe ở cổng. */
  NETWORK: 'NetworkError',
  /** Có nối được nhưng quá hạn chờ; request CÓ THỂ vẫn đang chạy ở máy chủ. */
  TIMEOUT: 'Timeout',
  /** Request bị huỷ chủ động. Không phải sự cố. */
  CANCELED: 'Canceled',
  /** Tầng trung gian trả lời thay: backend chưa sẵn sàng hoặc đang khởi động lại. */
  UNREACHABLE: 'BackendUnreachable',
  /** Máy chủ hỏng nhưng không nói được vì sao — thân phản hồi không đọc nổi. */
  SERVER: 'UnreadableServerError',
  /** Lỗi ném ra từ chính mã frontend, không phải từ mạng. */
  CLIENT: 'ClientError',
} as const;

/**
 * Bóc thân lỗi của backend ra khỏi AxiosError.
 *
 * Bọc lại vì phần lớn màn hình chỉ cần `message` và `fields`; để mỗi trang tự
 * mò `err.response.data` sẽ sinh ra cả tá đường dẫn tuỳ tiện, và trang nào quên
 * xử lý lỗi mạng sẽ hiện "undefined" cho người dùng.
 *
 * ═══ Vì sao không còn câu "Có lỗi không xác định" ══════════════════════════
 *
 * Bản trước có đúng hai nhánh: đọc được thân lỗi thì trả nó, còn lại trả một
 * câu chung. Cái "còn lại" ấy gom vào một chỗ bốn tình huống chẳng liên quan gì
 * tới nhau — mạng chết, quá hạn chờ, backend đang restart, và bug của chính
 * frontend — rồi phát cho cả bốn cùng một câu không dẫn tới hành động nào.
 *
 * Tình huống hay gặp nhất là cái thứ ba, và nó gặp thường tới mức thành một
 * triệu chứng kinh niên: `tsx watch` khởi động lại backend sau MỖI lần lưu file,
 * và mọi request bay đúng vào khe đó nhận về `500 text/plain` với thân RỖNG do
 * proxy của Vite tự trả (`vite.config.ts` nay đã sửa chỗ này). Đó là một phản
 * hồi hợp lệ với axios, nên nhánh "có response" chạy, không thấy `message` nào,
 * và rơi thẳng vào câu chung.
 *
 * Nên hàm này giờ PHÂN LOẠI hết, và mỗi nhánh nói ra thứ khác nhau. Câu chung
 * cuối cùng vẫn còn — nhưng nó kèm mã trạng thái, tức là kèm manh mối.
 *
 * ⚠️ Thứ tự các nhánh là một phần của tính đúng đắn:
 *   - `isCancel` phải đứng TRƯỚC `isAxiosError`, vì `CanceledError` cũng là
 *     một `AxiosError` và sẽ bị nhánh sau nuốt mất.
 *   - "không phải AxiosError" phải đứng trước mọi thứ đọc `err.response`.
 */
export function getApiError(err: unknown): ApiErrorBody {
  // Bị huỷ: rời trang, hoặc một request mới thay chỗ request cũ. Không có gì
  // hỏng, nên câu chữ không được nghe như một sự cố.
  if (axios.isCancel(err)) {
    return { error: CLIENT_ERROR_CODES.CANCELED, message: 'Yêu cầu đã bị huỷ.' };
  }

  /*
   * Không phải lỗi mạng thì đây là lỗi LẬP TRÌNH: một `TypeError` ném ra trong
   * `queryFn`, một `.id` đọc trên `undefined` trong `onSuccess`…
   *
   * Log ra console chứ không nuốt: người dùng cần một câu đọc được, còn người
   * sửa cần stack trace. Bản trước trả về một câu chung và không log gì, nên
   * mọi bug loại này biến mất không dấu vết.
   */
  if (!axios.isAxiosError(err)) {
    console.error('[apiClient] lỗi KHÔNG tới từ mạng — nhiều khả năng là bug ở frontend:', err);
    return {
      error: CLIENT_ERROR_CODES.CLIENT,
      message: 'Giao diện gặp lỗi khi xử lý dữ liệu. Xem chi tiết ở Console của trình duyệt.',
    };
  }

  const response = (err as AxiosError<unknown>).response;

  // Chưa từng có phản hồi nào quay về.
  if (response === undefined) {
    // `ECONNABORTED` là mã axios dùng cho quá hạn chờ. Tách riêng vì hệ quả
    // KHÁC HẲN lỗi mạng: request có thể đã tới nơi và đang chạy, nên "thử lại"
    // ở đây có rủi ro làm hai lần.
    if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
      return {
        error: CLIENT_ERROR_CODES.TIMEOUT,
        message:
          'Máy chủ không trả lời trong 15 giây. Thao tác có thể vẫn đang chạy — tải lại trang để xem kết quả trước khi thử lại.',
      };
    }
    return {
      error: CLIENT_ERROR_CODES.NETWORK,
      message: 'Không kết nối được máy chủ. Kiểm tra backend đang chạy ở cổng 4000.',
    };
  }

  // Phản hồi ĐÚNG KHUÔN của API — đường đi bình thường của mọi lỗi nghiệp vụ.
  const body = asApiErrorBody(response.data);
  if (body !== null) return body;

  // Có phản hồi nhưng không đọc nổi: proxy trả text/plain rỗng, nginx trả HTML,
  // gateway trả khuôn của riêng nó. Suy từ MÃ TRẠNG THÁI — nó là thông tin duy
  // nhất còn đáng tin, và nó đủ để người đọc biết phải nhìn về phía nào.
  return fromStatus(response.status);
}

/**
 * Thân phản hồi có đúng khuôn lỗi của API không.
 *
 * Đòi `message` là chuỗi KHÔNG RỖNG: một `message: ''` lọt qua sẽ cho ra một
 * hộp lỗi đỏ trống trơn, tệ hơn hẳn câu suy từ mã trạng thái ở dưới.
 *
 * Cũng chặn `body` là CHUỖI. Axios tự `JSON.parse` thân phản hồi khi đọc được,
 * nên một `body` còn ở dạng chuỗi nghĩa là nó không phải JSON — và `''.message`
 * thì `undefined`, đúng cái bẫy đã sinh ra "Có lỗi không xác định".
 */
function asApiErrorBody(data: unknown): ApiErrorBody | null {
  if (typeof data !== 'object' || data === null) return null;

  const body = data as Partial<ApiErrorBody>;
  if (typeof body.message !== 'string' || body.message.trim() === '') return null;

  return {
    error: typeof body.error === 'string' ? body.error : CLIENT_ERROR_CODES.SERVER,
    message: body.message,
    ...(body.fields ? { fields: body.fields } : {}),
  };
}

/**
 * Câu cuối cùng, dựng từ mã trạng thái.
 *
 * Luôn KÈM con số. Đó là khác biệt thật sự so với câu chung cũ: "502" nói cho
 * người đọc biết lỗi nằm ở tầng trung gian, "500" nói nó nằm trong backend, và
 * "403" nói nó nằm ở quyền — ba hướng sửa khác nhau. Một câu không có con số
 * thì cả ba trông y hệt nhau.
 */
function fromStatus(status: number): ApiErrorBody {
  // 502/503/504 tới từ TẦNG TRUNG GIAN, không phải từ backend: proxy của Vite
  // khi backend đang khởi động lại, hoặc nginx khi không còn upstream nào sống.
  if (status === 502 || status === 503 || status === 504) {
    return {
      error: CLIENT_ERROR_CODES.UNREACHABLE,
      message: `Máy chủ tạm thời không nhận yêu cầu (mã ${status}). Backend có thể đang khởi động lại — chờ vài giây rồi thử lại.`,
    };
  }

  if (status >= 500) {
    return {
      error: CLIENT_ERROR_CODES.SERVER,
      message: `Máy chủ gặp lỗi (mã ${status}) và không mô tả được nguyên nhân. Xem log của backend để biết chi tiết.`,
    };
  }

  if (status === 401 || status === 403) {
    return {
      error: CLIENT_ERROR_CODES.SERVER,
      message: `Không đủ quyền cho thao tác này (mã ${status}). Thử đăng nhập lại, hoặc hỏi quản trị viên tổ chức.`,
    };
  }

  return {
    error: CLIENT_ERROR_CODES.SERVER,
    message: `Máy chủ từ chối yêu cầu (mã ${status}) mà không kèm lý do đọc được.`,
  };
}
