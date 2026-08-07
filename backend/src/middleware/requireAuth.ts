import { ERROR_CODES } from '@bi/shared';
import type { NextFunction, Request, Response } from 'express';

import { env } from '../config/env';
import { AppError } from '../errors/AppError';
import { verifySessionToken, type SessionClaims } from '../modules/auth/token';

/**
 * Gắn thông tin phiên vào `req`.
 *
 * Khai bằng `declare module` thay vì ép kiểu ở từng handler: ép kiểu rải rác thì
 * chỉ cần một chỗ quên là mất luôn tác dụng kiểm tra kiểu.
 */
declare module 'express-serve-static-core' {
  interface Request {
    session?: SessionClaims;
  }
}

/** Chặn request không có phiên hợp lệ. Route công khai không dùng middleware này. */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const raw: unknown = req.cookies?.[env.AUTH_COOKIE_NAME];
  if (typeof raw !== 'string' || raw.length === 0) {
    next(new AppError(401, ERROR_CODES.UNAUTHENTICATED, 'Chưa đăng nhập'));
    return;
  }

  const claims = verifySessionToken(raw);
  if (!claims) {
    next(new AppError(401, ERROR_CODES.UNAUTHENTICATED, 'Phiên không hợp lệ hoặc đã hết hạn'));
    return;
  }

  req.session = claims;
  next();
}
