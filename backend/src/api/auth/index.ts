import type { MembershipDto, TenantDto } from '@bi/shared';
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
import {
  changePasswordSchema,
  loginSchema,
  registerSchema,
  switchTenantSchema,
  updateProfileSchema,
} from './schemas';

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
 * Hạn mức của `/login` — chỉ đếm lần ĐĂNG NHẬP SAI.
 *
 * Thứ hạn mức này chặn là dò mật khẩu, mà dò mật khẩu thì luôn thất bại. Đếm cả
 * lần đăng nhập đúng không chặn thêm được gì, nhưng nó khoá đúng người dùng
 * thật — mười lần đăng nhập đúng trong mười lăm phút là chuyện bình thường khi
 * đang phát triển hoặc dùng nhiều thiết bị, và họ nhận 429 dù chưa gõ sai lần
 * nào.
 *
 * `/register` KHÔNG dùng biến thể này: ở đó chính lần thành công mới là thứ cần
 * chặn (tạo hàng loạt tài khoản), còn kênh liệt kê email qua 409 vẫn bị nhánh
 * đếm-thất-bại phủ.
 */
const loginRateLimit = rateLimit({
  bucket: 'login',
  max: env.LOGIN_MAX_ATTEMPTS,
  windowSeconds: env.LOGIN_LOCKOUT_MINUTES * 60,
  countFailuresOnly: true,
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
  loginRateLimit,
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
 * POST /api/auth/switch-tenant — §5.1 đổi tổ chức đang mở
 *
 * ─── Vì sao phải CẤP LẠI TOKEN, không đổi được bằng một header ───────────────
 *
 * `tenantId` nằm TRONG payload JWT và được ký. Mọi thứ phía sau — `authenticate`,
 * `requireFreshMembership`, và toàn bộ repository nhận `tenantId` làm tham số đầu
 * — đọc nó từ đó. Nếu cho client gửi tổ chức đang mở qua header hay query thì
 * chính con số quyết định phạm vi dữ liệu lại trở thành thứ client tự khai, và
 * mọi lớp cách ly tổ chức trong hệ thống sụp cùng lúc.
 *
 * Nên đổi tổ chức = ký một token mới. Trả về đúng hình dạng của `POST /login` để
 * frontend dùng lại một đường xử lý duy nhất.
 *
 * ─── Ba điều đáng nói ───────────────────────────────────────────────────────
 *
 * 1. `tenantId` gửi lên KHÔNG được tin. `findByUserAndTenant` đọc lại từ database
 *    và đã lọc đủ: membership còn `is_active`, chưa `removed_at`, tổ chức chưa
 *    khoá và chưa xoá. Không có dòng nào -> 403, và người dùng không thể "đổi"
 *    sang một tổ chức họ chưa từng thuộc về.
 *
 * 2. Vai trò lấy TỪ MEMBERSHIP MỚI, không mang theo vai trò cũ. Admin ở công ty A
 *    mà chỉ là viewer ở công ty B thì sau khi đổi phải là viewer — mang vai trò
 *    cũ sang là leo thang đặc quyền ngang hàng.
 *
 * 3. Token CŨ vẫn hợp lệ tới lúc hết hạn (JWT vô trạng thái). Ở đây điều đó vô
 *    hại: nó chỉ mở đúng tổ chức mà người này vẫn đang là thành viên, nên không
 *    có quyền nào bị lộ thêm. Muốn thu hồi thật thì cần danh sách chặn trên Redis
 *    — đã ghi trong phần nợ kỹ thuật.
 */
authRouter.post(
  '/switch-tenant',
  authenticate,
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const { tenantId } = switchTenantSchema.parse(req.body);

    // Đọc lại user chứ không tin token: tài khoản có thể vừa bị khoá toàn hệ
    // thống sau khi token được cấp.
    const user = await usersRepo.findById(auth.userId);
    if (!user) throw unauthorized('Tài khoản không còn tồn tại.');
    if (!user.isActive) {
      throw new HttpError(403, 'AccountDisabled', 'Tài khoản đã bị khoá.');
    }

    const target = await membershipsRepo.findByUserAndTenant(auth.userId, tenantId);
    if (!target) {
      throw new HttpError(
        403,
        'NoMembership',
        'Bạn không còn quyền truy cập tổ chức này.',
      );
    }

    const memberships = await membershipsRepo.listActiveByUser(auth.userId);

    res.json({
      token: signAccessToken({
        userId: user.id,
        tenantId: target.tenantId,
        // Vai trò của TỔ CHỨC MỚI. Xem ghi chú (2) ở trên.
        role: target.role,
        platformRole: user.platformRole,
      }),
      expiresIn: expiresInSeconds(),
      mustChangePassword: user.mustChangePassword,
      user,
      tenant: toTenantSummary(target),
      role: target.role,
      memberships: memberships.map(toTenantSummaryWithRole),
    });
  }),
);

/**
 * PATCH /api/auth/me — §4.4 sửa hồ sơ cá nhân
 *
 * Đặt ở router auth chứ không phải `/api/v1`, dù cả Section 04 nằm ở đó: hồ sơ
 * là danh tính TOÀN CỤC (`users`), không thuộc tổ chức nào. Gắn nó sau
 * `requireFreshMembership` của `/api/v1` nghĩa là người vừa bị gỡ khỏi tổ chức
 * cũng không sửa được tên mình — sai phạm vi. Nó thuộc về đây, cạnh `GET /me`.
 *
 * Chỉ `authenticate`: mọi người dùng đã đăng nhập đều sửa được hồ sơ CỦA MÌNH,
 * và `auth.userId` từ token là thứ duy nhất quyết định "của mình" là ai.
 */
authRouter.patch(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const patch = updateProfileSchema.parse(req.body);

    const current = await usersRepo.findById(auth.userId);
    if (!current) throw unauthorized('Tài khoản không còn tồn tại.');

    // Trộn trong JS rồi ghi CẢ BỐN cột, thay vì dựng câu UPDATE động theo những
    // khoá client gửi lên. Câu lệnh động là chỗ `SET ${key} = ?` lọt vào, và khi
    // đó client tự chọn được cột — kể cả `role` hay `password_hash`. Ở đây danh
    // sách cột là hằng số viết tay trong repository.
    //
    // `=== undefined` chứ không phải `??`: `null` là XOÁ TRỐNG, một giá trị hợp
    // lệ do người dùng chủ động gửi. `??` sẽ nuốt mất nó và biến thao tác xoá
    // thành thao tác không làm gì.
    await usersRepo.updateProfile(auth.userId, {
      fullName: patch.fullName === undefined ? current.fullName : patch.fullName,
      phone: patch.phone === undefined ? current.phone : patch.phone,
      jobTitle: patch.jobTitle === undefined ? current.jobTitle : patch.jobTitle,
      dateOfBirth: patch.dateOfBirth === undefined ? current.dateOfBirth : patch.dateOfBirth,
    });

    // Đọc lại rồi trả về bản ghi đầy đủ thay vì `204`: frontend cần cập nhật tên
    // trên topbar ngay, và đọc lại từ DB là cách duy nhất chắc chắn nó khớp với
    // thứ vừa được ghi.
    const updated = await usersRepo.findById(auth.userId);
    if (!updated) throw unauthorized('Tài khoản không còn tồn tại.');

    res.json(updated);
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

function toTenantSummary(m: membershipsRepo.Membership): TenantDto {
  return { id: m.tenantId, name: m.tenantName, slug: m.tenantSlug };
}

/**
 * Phần tử của dropdown đổi tổ chức.
 *
 * `isPersonal` đi kèm để bộ chuyển gắn được nhãn phân biệt không gian riêng của
 * người dùng với công ty thật — hai thứ trông giống hệt nhau nếu chỉ có tên.
 */
function toTenantSummaryWithRole(m: membershipsRepo.Membership): MembershipDto {
  return { ...toTenantSummary(m), role: m.role, isPersonal: m.isPersonal };
}
