import type { ApiErrorBody, AuthSessionDto, MeDto } from '@bi/shared';

const BASE_URL = import.meta.env.VITE_API_BASE_URL;

/**
 * Lỗi có cấu trúc dựng lại từ envelope của backend.
 *
 * Nhờ backend thống nhất một hình dạng lỗi duy nhất
 * (`{ error: { code, message, fields? } }`) mà chỗ này chỉ cần một hàm parse,
 * và giao diện có thể phân nhánh theo `code` thay vì so khớp chuỗi tiếng Việt.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null || !('error' in value)) {
    return false;
  }
  const { error } = value as { error: unknown };
  return typeof error === 'object' && error !== null && 'code' in error && 'message' in error;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...init?.headers,
      },
      // 'include' chứ không phải 'same-origin': proxy của Vite làm request thành
      // same-origin khi dev, nên 'same-origin' chạy được hôm nay và sẽ vỡ đúng
      // vào hôm ai đó trỏ VITE_API_BASE_URL thẳng sang http://localhost:4000.
      credentials: 'include',
    });
  } catch {
    // fetch chỉ reject khi lỗi mạng — server trả 500 vẫn là resolve.
    throw new ApiError(0, 'NETWORK_ERROR', 'Không kết nối được máy chủ. Vui lòng thử lại.');
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    if (isApiErrorBody(body)) {
      throw new ApiError(
        response.status,
        body.error.code,
        body.error.message,
        body.error.fields,
      );
    }
    throw new ApiError(response.status, 'UNKNOWN', `Lỗi không xác định (HTTP ${response.status})`);
  }

  return body as T;
}

export interface RegisterPayload {
  fullName: string;
  email: string;
  password: string;
  confirmPassword: string;
  phone: string;
  jobTitle: string;
}

export const authApi = {
  register: (payload: RegisterPayload) =>
    request<AuthSessionDto>('/auth/register', { method: 'POST', body: JSON.stringify(payload) }),

  login: (payload: { email: string; password: string }) =>
    request<AuthSessionDto>('/auth/login', { method: 'POST', body: JSON.stringify(payload) }),

  me: () => request<MeDto>('/auth/me'),

  logout: () => request<void>('/auth/logout', { method: 'POST' }),
};
