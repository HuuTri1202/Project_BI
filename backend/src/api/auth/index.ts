import { Router } from 'express';
import { authenticate, requireAuth } from '../../middleware/authenticate';
import { findTenantById } from '../../repositories/tenants';
import * as usersRepo from '../../repositories/users';
import {
  assertNotThrottled,
  clearFailures,
  recordFailure,
} from '../../services/auth/loginThrottle';
import { hashPassword, verifyAgainstDummy, verifyPassword } from '../../services/auth/password';
import { expiresInSeconds, signAccessToken } from '../../services/auth/token';
import { asyncHandler } from '../../utils/asyncHandler';
import { HttpError, unauthorized } from '../../utils/httpError';
import { changePasswordSchema, loginSchema } from './schemas';

export const authRouter = Router();

/**
 * Một thông báo DUY NHẤT cho mọi trường hợp đăng nhập thất bại.
 *
 * Nếu tách riêng "email không tồn tại" và "sai mật khẩu", ta tặng kẻ tấn công
 * một công cụ dò xem email nào đã đăng ký trong hệ thống.
 */
const INVALID_CREDENTIALS = 'Email hoặc mật khẩu không đúng.';

/** POST /api/auth/login — §2.3, §2.4 */
authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const ip = req.ip ?? 'unknown';

    await assertNotThrottled(email, ip);

    const found = await usersRepo.findByEmailForLogin(email);

    // Email không tồn tại: VẪN chạy một lần so khớp bcrypt với hash giả.
    // Bỏ qua bước này thì request email-không-có trả về sau ~1 ms còn
    // email-có-thật mất ~291 ms, và chênh lệch đó tự nó là một kênh dò.
    if (!found) {
      await verifyAgainstDummy(password);
      await recordFailure(email, ip);
      throw new HttpError(401, 'InvalidCredentials', INVALID_CREDENTIALS);
    }

    const ok = await verifyPassword(password, found.passwordHash);
    if (!ok) {
      await recordFailure(email, ip);
      throw new HttpError(401, 'InvalidCredentials', INVALID_CREDENTIALS);
    }

    // Kiểm tra khoá tài khoản SAU khi mật khẩu đã đúng. Báo "tài khoản bị khoá"
    // trước khi xác thực mật khẩu cũng là một cách để lộ email có tồn tại.
    if (!found.user.isActive) {
      throw new HttpError(403, 'AccountDisabled', 'Tài khoản đã bị khoá. Liên hệ quản trị viên.');
    }

    await clearFailures(email, ip);
    await usersRepo.touchLastLogin(found.user.id);

    const tenant = await findTenantById(found.user.tenantId);

    res.json({
      token: signAccessToken({
        userId: found.user.id,
        role: found.user.role,
        tenantId: found.user.tenantId,
      }),
      expiresIn: expiresInSeconds(),
      mustChangePassword: found.user.mustChangePassword,
      user: found.user,
      tenant,
    });
  }),
);

/** GET /api/auth/me — §2.5 khôi phục phiên khi F5 */
authRouter.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);

    // Đọc lại từ DB chứ không tin payload token: vai trò có thể vừa bị đổi,
    // tài khoản có thể vừa bị khoá hoặc xoá mềm sau khi token được cấp.
    const user = await usersRepo.findById(auth.tenantId, auth.userId);
    if (!user) throw unauthorized('Tài khoản không còn tồn tại.');
    if (!user.isActive) {
      throw new HttpError(403, 'AccountDisabled', 'Tài khoản đã bị khoá.');
    }

    const tenant = await findTenantById(user.tenantId);
    res.json({ user, tenant });
  }),
);

/**
 * POST /api/auth/logout
 *
 * JWT vô trạng thái nên server không có gì để xoá — client tự bỏ token.
 * Endpoint vẫn tồn tại để (a) frontend gọi một chỗ duy nhất, (b) sau này thêm
 * danh sách token bị thu hồi trên Redis mà không phải đổi hợp đồng API.
 */
authRouter.post('/logout', (_req, res) => {
  res.status(204).end();
});

/** POST /api/auth/change-password — bắt buộc sau khi được cấp mật khẩu tạm */
authRouter.post(
  '/change-password',
  authenticate,
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);

    const currentHash = await usersRepo.findPasswordHash(auth.tenantId, auth.userId);
    if (!currentHash) throw unauthorized('Tài khoản không còn tồn tại.');

    const ok = await verifyPassword(currentPassword, currentHash);
    if (!ok) {
      throw new HttpError(400, 'ValidationError', 'Mật khẩu hiện tại không đúng.', {
        currentPassword: 'Mật khẩu hiện tại không đúng',
      });
    }

    await usersRepo.updatePassword(
      auth.tenantId,
      auth.userId,
      await hashPassword(newPassword),
      false,
    );

    res.status(204).end();
  }),
);
