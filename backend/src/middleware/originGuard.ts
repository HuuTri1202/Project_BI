import type { NextFunction, Request, Response } from 'express';

import { env } from '../config/env';
import { HttpError } from '../utils/httpError';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Chặn CSRF ở mức tối thiểu, không cần thư viện và không cần kho token.
 *
 * ⚠️ Bối cảnh HIỆN TẠI: phiên đăng nhập KHÔNG nằm trong cookie. Token ở
 * `localStorage` và đi lên bằng header `Authorization` — xem
 * `frontend/src/auth/tokenStorage.ts`. Một header thì trình duyệt KHÔNG tự đính
 * kèm, nên CSRF kinh điển hiện không áp dụng được vào API này.
 *
 * Vậy middleware này để làm gì? Nó là chốt cho ngày phiên đăng nhập chuyển sang
 * cookie — một đổi thay hoàn toàn có thể xảy ra, vì `localStorage` đọc được bởi
 * XSS và đó là đánh đổi đã ghi ra ở `tokenStorage.ts`. Ngày đó, cookie trở thành
 * "credential môi trường": trình duyệt tự gửi nó kèm cả những request mà app này
 * không khởi tạo. Chốt đặt sẵn từ giờ tốn ba dòng và không đòi ai phải nhớ gì;
 * đặt sau thì nó là một việc phải nhớ giữa một lần đổi kiến trúc xác thực.
 *
 * Khi đó `SameSite=Lax` lo phần lớn, và ba thứ còn lại là:
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
