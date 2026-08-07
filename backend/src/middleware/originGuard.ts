import type { NextFunction, Request, Response } from 'express';

import { env } from '../config/env';
import { HttpError } from '../utils/httpError';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Chặn CSRF ở mức tối thiểu, không cần thư viện và không cần kho token.
 *
 * Bối cảnh: phiên đăng nhập nằm trong cookie httpOnly, tức là một "credential
 * môi trường" — trình duyệt tự đính kèm vào cả những request mà app này không
 * khởi tạo. `SameSite=Lax` lo phần lớn, ba thứ còn lại là:
 *
 *   1. Không endpoint GET nào được đổi trạng thái (Lax vẫn gửi cookie khi điều
 *      hướng top-level GET). Mọi mutation trong repo này là POST.
 *   2. API chỉ nhận `application/json`. Form HTML cross-origin chỉ gửi được
 *      urlencoded/multipart/text-plain, nên chỉ riêng việc bỏ
 *      `express.urlencoded` đã chặn được lớp tấn công đó — xem app.ts.
 *   3. Chính middleware này.
 *
 * Vì sao thiếu `Origin` thì cho qua: trình duyệt LUÔN gửi `Origin` cho request
 * cross-origin, nên kẻ tấn công không bỏ được header này. Còn curl, PowerShell
 * và test tích hợp thì không gửi — chặn chúng chỉ làm hỏng khâu kiểm thử mà
 * không tăng thêm chút an toàn nào.
 */
export function originGuard(req: Request, _res: Response, next: NextFunction): void {
  if (!MUTATING_METHODS.has(req.method)) {
    next();
    return;
  }

  const origin = req.get('origin');
  if (origin !== undefined && origin !== env.CORS_ORIGIN) {
    next(new HttpError(403, 'ForbiddenOrigin', 'Origin không được phép'));
    return;
  }

  next();
}
