import { ERROR_CODES } from '@bi/shared';
import { Router, type Request, type Response } from 'express';
import { type z } from 'zod';

import { AppError } from '../../../errors/AppError';
import { asyncHandler } from '../../../middleware/asyncHandler';
import { rateLimit } from '../../../middleware/rateLimit';
import { requireAuth } from '../../../middleware/requireAuth';
import * as authService from '../../../modules/auth/authService';
import { loginRequestSchema, registerRequestSchema } from '../../../modules/auth/schemas';
import {
  clearSessionCookie,
  setSessionCookie,
  signSessionToken,
} from '../../../modules/auth/token';

/**
 * Tầng HTTP và chỉ tầng HTTP: parse body, ném lỗi validate, gọi service, set
 * cookie, trả JSON. Không SQL, không bcrypt, không tự dựng JWT ở đây.
 *
 * Mọi handler async đều phải bọc `asyncHandler` — Express 4 không tự chuyển
 * promise reject sang error handler, thiếu nó thì request treo im lặng.
 */
export const authRouter = Router();

/**
 * Đổi ZodError sang AppError 400 kèm lỗi theo từng trường.
 *
 * `flatten().fieldErrors` cho đúng hình dạng mà react-hook-form cần để gọi
 * `setError('email', ...)`. Kiểu của nó là `{ [k]?: string[] }` nên phải lọc bỏ
 * các khoá `undefined` thay vì ép kiểu — ép kiểu ở đây sẽ nói dối rằng mọi
 * trường đều có lỗi.
 */
function validationError(error: z.ZodError): AppError {
  const fields: Record<string, string[]> = {};
  for (const [name, messages] of Object.entries(error.flatten().fieldErrors)) {
    if (messages && messages.length > 0) {
      fields[name] = messages;
    }
  }
  return new AppError(400, ERROR_CODES.VALIDATION_ERROR, 'Dữ liệu không hợp lệ', fields);
}

authRouter.post(
  '/register',
  rateLimit({ bucket: 'register', max: 10, windowSeconds: 600 }),
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = registerRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw validationError(parsed.error);
    }

    const session = await authService.register(parsed.data);

    // Đăng ký xong đăng nhập luôn: đã bỏ bước xác thực email thì bắt người dùng
    // nhập lại email/mật khẩu ngay lập tức chỉ là ma sát vô ích.
    setSessionCookie(
      res,
      signSessionToken({
        sub: session.user.id,
        tid: session.tenant.id,
        role: session.role,
      }),
    );

    res.status(201).json(session);
  }),
);

authRouter.post(
  '/login',
  rateLimit({ bucket: 'login', max: 20, windowSeconds: 600 }),
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = loginRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw validationError(parsed.error);
    }

    const session = await authService.login(parsed.data);

    setSessionCookie(
      res,
      signSessionToken({
        sub: session.user.id,
        tid: session.tenant.id,
        role: session.role,
      }),
    );

    res.status(200).json(session);
  }),
);

/**
 * Đây mới là thứ thực sự thoả yêu cầu "load Tenant + Workspace khi đăng nhập":
 * frontend gọi nó ở mỗi lần tải trang để khôi phục phiên sau khi F5, chứ không
 * chỉ đúng một lần ngay sau khi bấm nút đăng nhập.
 */
authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const session = req.session;
    if (!session) {
      throw new AppError(401, ERROR_CODES.UNAUTHENTICATED, 'Chưa đăng nhập');
    }
    res.status(200).json(await authService.loadMe(session.sub, session.tid));
  }),
);

// POST chứ không phải GET: SameSite=Lax vẫn gửi cookie khi điều hướng top-level
// bằng GET, nên một `<img src=".../logout">` trên trang bất kỳ sẽ đăng xuất
// người dùng. Không endpoint GET nào được đổi trạng thái.
authRouter.post('/logout', (_req: Request, res: Response) => {
  clearSessionCookie(res);
  res.status(204).end();
});
