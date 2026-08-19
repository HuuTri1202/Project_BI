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
 *
 * ⚠️ Đây là hạn đo theo ĐỒNG HỒ CỦA MÁY NÀY. Cube kiểm nó bằng đồng hồ của
 * container, và hai đồng hồ đó độc lập với nhau (Windows ↔ máy ảo Docker). Bao
 * nhiêu lệch được tha là việc của `CLOCK_TOLERANCE` trong
 * `infrastructure/cube/cube.js` — cố tình tách khỏi con số này, vì gộp một tham
 * số an toàn với một tham số môi trường vào cùng một chỗ chính là gốc của lỗi
 * "Explorer chết sạch vì máy chậm giờ 2 phút".
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

/**
 * Câu SQL mà Cube SẼ chạy cho truy vấn này — không chạy nó.
 *
 * ─── Vì sao đáng có ────────────────────────────────────────────────────────
 *
 * Tầng ngữ nghĩa là một hộp đen: người dùng chọn hai trường, nhận về một con số,
 * và không có cách nào biết con số đó ra từ phép nối nào. Khi số trông sai —
 * chuyện xảy ra thật, xem cảnh báo khoá trùng ở §10.3 và §10.5 — câu SQL là
 * bằng chứng duy nhất phân biệt được "mô hình khai sai" với "dữ liệu vốn thế".
 *
 * ─── Vì sao lộ SQL ra không phải rò rỉ ─────────────────────────────────────
 *
 * Nó chỉ chứa tên bảng vật lý và tên cột của CHÍNH mô hình người dùng đang mở —
 * đúng những thứ tab Schemas đã hiện ở cột "Bảng vật lý". Truy vấn vẫn dựng từ
 * ID qua `buildQuery`, nên không có chuỗi nào của người dùng đi vào SQL và không
 * có đường nào trỏ sang bảng của tổ chức khác.
 *
 * Cube nhận truy vấn ở QUERY STRING cho endpoint này (không phải body), nên phải
 * `encodeURIComponent` — thiếu bước đó thì mọi truy vấn có dấu `&` trong tên cột
 * sẽ bị cắt đôi.
 */
export async function sqlFromCube(
  context: CubeSecurityContext,
  query: CubeQuery,
): Promise<{ sql: string; params: (string | number)[] }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    const url =
      `${env.CUBEJS_URL}/cubejs-api/v1/sql?query=` + encodeURIComponent(JSON.stringify(query));
    response = await fetch(url, {
      headers: { authorization: sign(context) },
      signal: controller.signal,
    });
  } catch (cause) {
    throw unavailable(cause);
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  if (!response.ok) throw explain(response.status, text);

  // Cube trả `{ sql: { sql: [câu lệnh, [tham số]] } }` — một mảng hai phần tử,
  // không phải một chuỗi. Đọc phòng thủ vì đây là hình dạng nội bộ của Cube.
  try {
    const body = JSON.parse(text) as { sql?: { sql?: unknown } };
    const pair = body.sql?.sql;
    if (!Array.isArray(pair) || typeof pair[0] !== 'string') {
      throw new Error('hình dạng lạ');
    }
    return {
      sql: pair[0],
      params: Array.isArray(pair[1]) ? (pair[1] as (string | number)[]) : [],
    };
  } catch (cause) {
    console.error('[datamodel] Cube trả câu SQL không đọc được:', cause, text.slice(0, 300));
    throw new HttpError(
      502,
      DATAMODEL_ERROR_CODES.SCHEMA_INVALID,
      'Tầng ngữ nghĩa không trả về được câu lệnh SQL cho truy vấn này.',
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
  /*
   * ⚠️ Lỗi xác thực của Cube KHÔNG tới đây dưới dạng 401/403.
   *
   * `checkAuth` trong `infrastructure/cube/cube.js` NÉM lỗi, và gateway của Cube
   * biến mọi ngoại lệ trong đó thành **500**. Nên nếu chỉ nhìn mã trạng thái thì
   * một token hết hạn rơi vào nhánh "lỗi máy chủ" và người dùng nhận câu "Tầng
   * ngữ nghĩa không trả lời được truy vấn này" — một câu không dẫn tới đâu cả.
   *
   * Đó chính xác là chuyện đã xảy ra: đồng hồ máy ảo Docker đi trước máy thật
   * hơn 60 giây, nên token vừa ký đã hết hạn khi tới nơi và MỌI truy vấn
   * Explorer đều hỏng — kể cả truy vấn trong đúng một bảng, tức là không liên
   * quan gì tới quan hệ giữa các bảng.
   *
   * Vì vậy phải soi THÂN phản hồi, không chỉ mã trạng thái.
   */
  if (body.includes('TokenExpiredError') || body.includes('ĐỒNG HỒ LỆCH')) {
    console.error('[datamodel] Cube từ chối token vì hết hạn:', body.slice(0, 400));
    return new HttpError(
      503,
      DATAMODEL_ERROR_CODES.CUBE_UNAVAILABLE,
      'Đồng hồ máy bạn và đồng hồ container Cube.js lệch nhau quá 6 phút, vượt cả dung sai đã ' +
        'nới, nên token hết hạn ngay khi vừa ký. So bằng: date -u  và  docker exec bi-cube ' +
        'date -u. Máy Windows hay bị chậm giờ — mở PowerShell với quyền quản trị rồi chạy: ' +
        'w32tm /resync. Hai tab Schemas và Relationship không bị ảnh hưởng.',
    );
  }

  if (body.includes('JsonWebTokenError') || body.includes('CUBEJS_API_SECRET')) {
    console.error('[datamodel] Cube từ chối chữ ký token:', body.slice(0, 400));
    return new HttpError(
      500,
      DATAMODEL_ERROR_CODES.CUBE_UNAVAILABLE,
      'Tầng ngữ nghĩa từ chối yêu cầu: CUBEJS_API_SECRET trong backend/.env không trùng ' +
        'infrastructure/.env.',
    );
  }

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
