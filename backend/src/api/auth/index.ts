import { Router } from 'express';
import { env } from '../../config/env';
import { authenticate, requireAuth } from '../../middleware/authenticate';
import { rateLimit } from '../../middleware/rateLimit';
import * as membershipsRepo from '../../repositories/memberships';
import * as usersRepo from '../../repositories/users';
import { hashPassword, verifyAgainstDummy, verifyPassword } from '../../services/auth/password';
import { registerAccount } from '../../services/auth/registerAccount';
import { expiresInSeconds, signAccessToken } from '../../services/auth/token';
import { asyncHandler } from '../../utils/asyncHandler';
import { HttpError, unauthorized } from '../../utils/httpError';
import { changePasswordSchema, loginSchema, registerSchema } from './schemas';

export const authRouter = Router();

/**
 * Hạn mức cho hai endpoint công khai.
 *
 * `/register` trả 409 khi email trùng — đó là một kênh liệt kê email rất rõ
 * ràng, và không bỏ được nếu vẫn muốn báo lỗi tử tế cho người dùng thật.
 * `/login` thì mở cho credential stuffing. Không có lớp này thì cả hai đều
 * không giới hạn.
 *
 * Đếm theo IP và theo từng bucket riêng, nên người dùng bị chặn ở màn đăng ký
 * vẫn đăng nhập được bình thường.
 */
const authRateLimit = (bucket: string) =>
  rateLimit({
    bucket,
    max: env.LOGIN_MAX_ATTEMPTS,
    windowSeconds: env.LOGIN_LOCKOUT_MINUTES * 60,
  });

/**
 * POST /api/auth/register — §1.4
 *
 * Tạo tổ chức + tài khoản + tư cách thành viên + workspace, và người đăng ký là
 * quản trị viên của tổ chức mình vừa lập.
 *
 * CỐ Ý không trả token: đăng ký xong thì sang trang đăng nhập (§1.5). Tự đăng
 * nhập luôn nghe tiện hơn, nhưng nó khiến bước "đăng nhập lần đầu" không bao
 * giờ được thực hiện — mà đó là bước duy nhất chứng minh mật khẩu vừa đặt đúng
 * như người dùng nghĩ. Sai một ký tự lúc gõ thì họ sẽ phát hiện ngay bây giờ,
 * chứ không phải ở lần mở máy hôm sau.
 */
authRouter.post(
  '/register',
  authRateLimit('register'),
  asyncHandler(async (req, res) => {
    const input = registerSchema.parse(req.body);

    // Kiểm tra sớm chỉ để trả thông báo gắn đúng ô email. Thứ THẬT SỰ chặn
    // trùng là ràng buộc UNIQUE, xử lý trong registerAccount — giữa câu SELECT
    // này và câu INSERT luôn có khe hở cho hai request đồng thời.
    if (await usersRepo.emailExists(input.email)) {
      throw new HttpError(409, 'EmailAlreadyRegistered', 'Email này đã được đăng ký.', {
        email: 'Email này đã được đăng ký',
      });
    }

    const created = await registerAccount({
      fullName: input.fullName,
      companyName: input.companyName,
      email: input.email,
      password: input.password,
      phone: input.phone,
      jobTitle: input.jobTitle,
    });

    res.status(201).json(created);
  }),
);

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
  authRateLimit('login'),
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);

    const found = await usersRepo.findByEmailForLogin(email);

    // Email không tồn tại: VẪN chạy một lần so khớp bcrypt với hash giả.
    // Bỏ qua bước này thì request email-không-có trả về sau ~1 ms còn
    // email-có-thật mất ~291 ms, và chênh lệch đó tự nó là một kênh dò.
    if (!found) {
      await verifyAgainstDummy(password);
      throw new HttpError(401, 'InvalidCredentials', INVALID_CREDENTIALS);
    }

    const ok = await verifyPassword(password, found.passwordHash);
    if (!ok) {
      throw new HttpError(401, 'InvalidCredentials', INVALID_CREDENTIALS);
    }

    // Kiểm tra khoá tài khoản SAU khi mật khẩu đã đúng. Báo "tài khoản bị khoá"
    // trước khi xác thực mật khẩu cũng là một cách để lộ email có tồn tại.
    if (!found.user.isActive) {
      throw new HttpError(403, 'AccountDisabled', 'Tài khoản đã bị khoá. Liên hệ quản trị viên.');
    }

    // Từ đây là phần mới do mô hình `memberships`: xác thực xong mới biết người
    // này thuộc những tổ chức nào.
    const memberships = await membershipsRepo.listActiveByUser(found.user.id);

    // Tài khoản có thật, mật khẩu đúng, nhưng không thuộc tổ chức nào — xảy ra
    // khi vừa bị gỡ khỏi tổ chức cuối cùng. KHÔNG trả 401 ở đây: mật khẩu đúng
    // rồi, báo sai mật khẩu là nói dối và người dùng sẽ thử lại tới khi bị khoá.
    const active = memberships[0];
    if (!active) {
      throw new HttpError(
        403,
        'NoMembership',
        'Tài khoản chưa thuộc tổ chức nào. Liên hệ quản trị viên để được thêm vào.',
      );
    }

    await usersRepo.touchLastLogin(found.user.id);

    res.json({
      token: signAccessToken({
        userId: found.user.id,
        tenantId: active.tenantId,
        role: active.role,
        platformRole: found.user.platformRole,
      }),
      expiresIn: expiresInSeconds(),
      mustChangePassword: found.user.mustChangePassword,
      user: found.user,
      // Tổ chức đang mở và vai trò trong đó — hai thứ frontend dùng để điều hướng.
      tenant: toTenantSummary(active),
      role: active.role,
      // Danh sách đầy đủ, kể cả khi mới có một phần tử. Trả sẵn từ bây giờ để
      // lúc thêm chức năng đổi tổ chức không phải sửa hợp đồng API.
      memberships: memberships.map(toTenantSummaryWithRole),
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
    // tài khoản có thể vừa bị khoá hoặc gỡ khỏi tổ chức sau khi token được cấp.
    const user = await usersRepo.findById(auth.userId);
    if (!user) throw unauthorized('Tài khoản không còn tồn tại.');
    if (!user.isActive) {
      throw new HttpError(403, 'AccountDisabled', 'Tài khoản đã bị khoá.');
    }

    // Token gắn với một tổ chức cụ thể. Tư cách thành viên trong đó mất hiệu
    // lực thì token cũng vậy — 401 để frontend đẩy về trang đăng nhập, ở đó
    // người dùng sẽ được đưa vào tổ chức còn lại (nếu có).
    const membership = await membershipsRepo.findByUserAndTenant(auth.userId, auth.tenantId);
    if (!membership) {
      throw unauthorized('Bạn không còn quyền truy cập tổ chức này.');
    }

    const memberships = await membershipsRepo.listActiveByUser(auth.userId);

    res.json({
      user,
      tenant: toTenantSummary(membership),
      role: membership.role,
      memberships: memberships.map(toTenantSummaryWithRole),
    });
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

    const currentHash = await usersRepo.findPasswordHash(auth.userId);
    if (!currentHash) throw unauthorized('Tài khoản không còn tồn tại.');

    const ok = await verifyPassword(currentPassword, currentHash);
    if (!ok) {
      throw new HttpError(400, 'ValidationError', 'Mật khẩu hiện tại không đúng.', {
        currentPassword: 'Mật khẩu hiện tại không đúng',
      });
    }

    await usersRepo.updatePassword(auth.userId, await hashPassword(newPassword), false);

    res.status(204).end();
  }),
);

function toTenantSummary(m: membershipsRepo.Membership): {
  id: number;
  name: string;
  slug: string;
} {
  return { id: m.tenantId, name: m.tenantName, slug: m.tenantSlug };
}

function toTenantSummaryWithRole(m: membershipsRepo.Membership): {
  id: number;
  name: string;
  slug: string;
  role: membershipsRepo.TenantRole;
} {
  return { ...toTenantSummary(m), role: m.role };
}
