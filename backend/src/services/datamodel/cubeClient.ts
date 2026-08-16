import { DATAMODEL_ERROR_CODES } from '@bi/shared';
import jwt from 'jsonwebtoken';

import { env } from '../../config/env';
import { HttpError } from '../../utils/httpError';

/**
 * Nói chuyện với Cube.js — §10.7.
 *
 * ─── Cube không bao giờ lộ ra trình duyệt ───────────────────────────────────
 *
 * Đây là nơi DUY NHẤT của backend gọi tới Cube. Trình duyệt gọi
 * `POST /api/v1/query` của Express; Express kiểm quyền, ký một JWT ngắn hạn
 * mang `securityContext`, rồi mới chuyển tiếp. Cổng 4100 không được để lộ ra
 * ngoài, và `CUBEJS_DEV_MODE` phải TẮT ở production — xem ghi chú ở
 * `sign()` bên dưới.
 */

/**
 * 60 giây, không hơn.
 *
 * Token này mang quyền đọc dữ liệu của cả một tổ chức. Nó chỉ cần sống đủ lâu
 * cho một vòng HTTP nội bộ, nên một token bị chộp trên đường sẽ vô dụng trước
 * khi ai kịp dùng.
 */
const TOKEN_TTL_SECONDS = 60;

/** Cube có thể phải quét vài triệu dòng; 30 giây là trần phía ta. */
const REQUEST_TIMEOUT_MS = 30_000;

export interface CubeSecurityContext {
  tenantId: number;
  userId: number;
  dataModelId: number;
  /** `MAX(updated_at)` của mọi mô hình còn sống — buộc Cube biên dịch lại. */
  schemaVersion: string;
}

/**
 * Ký JWT ngắn hạn.
 *
 * ⚠️ `CUBEJS_API_SECRET` phải TRÙNG giá trị cùng tên trong
 * `infrastructure/.env`. Lệch nhau thì Cube trả 403 cho mọi truy vấn kèm một
 * thông báo không nói được vì sao — nên `checkAuth` trong `cube.js` được viết
 * để ném một câu tiếng Việt chỉ đúng chỗ phải sửa.
 */
function sign(context: CubeSecurityContext): string {
  return jwt.sign(context, env.CUBEJS_API_SECRET, { expiresIn: TOKEN_TTL_SECONDS });
}

export interface CubeQuery {
  measures: string[];
  dimensions: string[];
  timeDimensions?: { dimension: string; granularity: string }[];
  order?: Record<string, 'asc' | 'desc'>;
  limit?: number;
}

export interface CubeLoadResult {
  data: Record<string, unknown>[];
}

export async function loadFromCube(
  context: CubeSecurityContext,
  query: CubeQuery,
): Promise<CubeLoadResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${env.CUBEJS_URL}/cubejs-api/v1/load`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: sign(context),
      },
      body: JSON.stringify({ query }),
      signal: controller.signal,
    });
  } catch (cause) {
    // Không nối được TCP: Cube chưa chạy (nó nằm dưới `--profile bi` nên
    // `npm run infra:up` KHÔNG bật nó), hoặc quá hạn chờ.
    throw unavailable(cause);
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();

  if (!response.ok) throw explain(response.status, text);

  try {
    return JSON.parse(text) as CubeLoadResult;
  } catch (cause) {
    console.error('[datamodel] Cube trả về JSON hỏng:', cause, text.slice(0, 300));
    throw new HttpError(
      502,
      DATAMODEL_ERROR_CODES.SCHEMA_INVALID,
      'Tầng ngữ nghĩa trả về dữ liệu không đọc được.',
    );
  }
}

/** Cube có sống không — dùng cho `/health` và cho tab Explorer hỏi trước. */
export async function pingCube(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(`${env.CUBEJS_URL}/readyz`, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Lỗi hạ tầng, không phải lỗi của request.
 *
 * Câu trả về NÓI ĐÚNG LỆNH phải chạy — cùng tiền lệ `warehouseUnavailable` của
 * §9, vốn tồn tại vì bài học MinIO: khi một service phía sau không chạy, thứ
 * người dùng thấy là "Có lỗi không xác định. Vui lòng thử lại." — một câu không
 * dẫn tới bất kỳ hành động nào.
 */
function unavailable(cause: unknown): HttpError {
  console.error('[datamodel] không gọi được Cube.js:', cause);
  return new HttpError(
    503,
    DATAMODEL_ERROR_CODES.CUBE_UNAVAILABLE,
    'Chưa kết nối được tới tầng ngữ nghĩa (Cube.js). Hãy chạy "npm run infra:up:bi" rồi thử lại.',
  );
}

/**
 * Dịch lỗi của Cube thành lỗi người dùng đọc được.
 *
 * Ba nhóm với ba ý nghĩa khác hẳn nhau, và gộp chúng thành một câu chung là bỏ
 * mất đúng thông tin cần để đi sửa.
 */
function explain(status: number, body: string): HttpError {
  // 403 nghĩa là chữ ký của TA sai — `CUBEJS_API_SECRET` lệch giữa backend/.env
  // và infrastructure/.env. Đó là lỗi cấu hình của hệ thống, không phải thao tác
  // của người dùng, nên họ nhận một câu chung còn chi tiết đi vào log.
  if (status === 403 || status === 401) {
    console.error(
      '[datamodel] Cube từ chối token. Kiểm CUBEJS_API_SECRET trong backend/.env có TRÙNG ' +
        'infrastructure/.env không.',
      body,
    );
    return new HttpError(
      500,
      DATAMODEL_ERROR_CODES.CUBE_UNAVAILABLE,
      'Tầng ngữ nghĩa từ chối yêu cầu. Quản trị hệ thống cần kiểm tra cấu hình Cube.js.',
    );
  }

  // Cube không biên dịch được mô hình, hoặc không tìm được đường nối. Đây là
  // hậu quả của một mô hình người dùng dựng, nên nói được chỗ để đi sửa.
  if (status >= 400 && status < 500) {
    console.error('[datamodel] Cube từ chối truy vấn:', body);
    return new HttpError(
      409,
      DATAMODEL_ERROR_CODES.SCHEMA_INVALID,
      'Mô hình chưa truy vấn được. Kiểm tra tab Quan hệ — có thể hai bảng chưa được nối, ' +
        'hoặc đang nối vòng.',
    );
  }

  console.error('[datamodel] Cube lỗi máy chủ:', status, body);
  return new HttpError(
    502,
    DATAMODEL_ERROR_CODES.SCHEMA_INVALID,
    'Tầng ngữ nghĩa không trả lời được truy vấn này.',
  );
}
