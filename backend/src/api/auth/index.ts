import type { MembershipDto, TenantDto } from '@bi/shared';
import { Router } from 'express';
import { env } from '../../config/env';
import { authenticate, requireAuth } from '../../middleware/authenticate';
import { rateLimit } from '../../middleware/rateLimit';
import * as membershipsRepo from '../../repositories/memberships';
import * as identitiesRepo from '../../repositories/userIdentities';
import * as usersRepo from '../../repositories/users';
import { hashPassword, verifyAgainstDummy, verifyPassword } from '../../services/auth/password';
import { xacMinhGoogle } from '../../services/auth/googleIdentity';
import { registerAccount } from '../../services/auth/registerAccount';
import { expiresInSeconds, signAccessToken } from '../../services/auth/token';
import { asyncHandler } from '../../utils/asyncHandler';
import { HttpError, unauthorized } from '../../utils/httpError';
import {
  DA_GUI_NEU_CO,
  datLaiMatKhau,
  kiemVe,
  yeuCauDatLai,
} from '../../services/auth/passwordReset';
import {
  DA_GUI_NEU_CAN,
  guiVeXacMinh,
  xacMinhBangVe,
  yeuCauGuiLai,
} from '../../services/auth/emailVerification';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  googleLoginSchema,
  loginSchema,
  registerSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  switchTenantSchema,
  updateProfileSchema,
  verifyEmailSchema,
  verifyResetTokenSchema,
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

    /*
     * Thư xác minh (§1.10) — và vì sao lỗi gửi thư KHÔNG làm hỏng cả request.
     *
     * Tài khoản + tổ chức + workspace đã COMMIT xong. Ném lỗi ở đây sẽ trả về
     * 500 cho một người mà tài khoản của họ THẬT SỰ đã được tạo: lần sau họ bấm
     * Đăng ký lại và nhận "email đã được đăng ký", không hiểu gì cả.
     *
     * Đường thoát khi SMTP hỏng: `POST /auth/resend-verification`, mà trang đăng
     * nhập chỉ đúng tới khi gặp `EmailNotVerified`. Nên lỗi ở đây chỉ cần ghi
     * log để người vận hành thấy, không cần dội lên người dùng.
     *
     * ⚠️ `console.error` chứ không im lặng: SMTP sai cấu hình nghĩa là KHÔNG AI
     * đăng ký được nữa (không ai xác minh được email), và đó là loại sự cố phải
     * nhìn thấy trong log ngay từ lần đầu.
     */
    try {
      await guiVeXacMinh(created.user, input.companyName);
    } catch (err) {
      console.error(
        '[auth] Không gửi được thư xác minh cho',
        created.user.email,
        err instanceof Error ? err.message : err,
      );
    }

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

    /*
     * Chưa xác minh email -> không vào được (§1.10).
     *
     * ═══ Vì sao chốt này đứng ĐÂY, sau `verifyPassword` ═══════════════════════
     *
     * Cùng lý lẽ với chốt `isActive` ngay trên: ai tới được dòng này đã chứng
     * minh biết mật khẩu, nên nói thật với họ không tiết lộ gì. Đưa chốt lên
     * trước `verifyPassword` là biến `/login` thành máy dò "email nào đã đăng ký
     * mà chưa xác minh" — đúng thứ `INVALID_CREDENTIALS` đang cẩn thận che.
     *
     * ═══ Vì sao CHẶN chứ không chỉ cảnh báo ══════════════════════════════════
     *
     * Đây là thứ làm cho một tài khoản squat trở nên VÔ DỤNG. Kẻ đăng ký bằng
     * email của người khác không bao giờ nhận được lá thư, nên không bao giờ
     * xác minh được, nên không bao giờ đăng nhập được. Cho vào kèm một dải băng
     * vàng "bạn chưa xác minh email" thì tài khoản đó vẫn dùng được bình thường
     * và cả chốt này thành vô nghĩa. Xem migration 42.
     */
    if (found.user.emailVerifiedAt === null) {
      throw new HttpError(
        403,
        'EmailNotVerified',
        'Email chưa được xác minh. Hãy mở liên kết trong thư chúng tôi đã gửi, hoặc bấm "Gửi lại thư xác minh".',
      );
    }

    res.json(await moPhien(found.user));
  }),
);

/**
 * Gói phiên trả về — DÙNG CHUNG cho mọi đường đăng nhập.
 *
 * ⚠️ Gom lại chứ không chép, và đây là lý do: `/login` và `/google` phải trả về
 * ĐÚNG MỘT hình dạng, vì frontend chỉ có một đường xử lý phiên. Hai bản sao của
 * cùng một object literal thì lệch nhau ở lần sửa đầu tiên — và cái lệch đó rơi
 * vào đường xác thực, nơi một trường thiếu nghĩa là người đăng nhập bằng Google
 * nhận một phiên khác với người đăng nhập bằng mật khẩu, mà không ai thấy ngay.
 *
 * `/switch-tenant` CỐ Ý không dùng hàm này: ở đó tổ chức đang mở do người dùng
 * chọn chứ không phải lấy cái đầu danh sách, nên nó có một luật khác.
 */
async function moPhien(user: usersRepo.PublicUser): Promise<Record<string, unknown>> {
  // Xác thực xong mới biết người này thuộc những tổ chức nào.
  const memberships = await membershipsRepo.listActiveByUser(user.id);

  // Tài khoản có thật, chứng thực đúng, nhưng không thuộc tổ chức nào — xảy ra
  // khi vừa bị gỡ khỏi tổ chức cuối cùng. KHÔNG trả 401 ở đây: chứng thực đã
  // đúng rồi, báo sai là nói dối và người dùng sẽ thử lại tới khi bị khoá.
  const active = memberships[0];
  if (!active) {
    throw new HttpError(
      403,
      'NoMembership',
      'Tài khoản chưa thuộc tổ chức nào. Liên hệ quản trị viên để được thêm vào.',
    );
  }

  await usersRepo.touchLastLogin(user.id);

  return {
    token: signAccessToken({
      userId: user.id,
      tenantId: active.tenantId,
      role: active.role,
      platformRole: user.platformRole,
    }),
    expiresIn: expiresInSeconds(),
    /*
     * ⚠️ Cờ này VẪN áp cho người đăng nhập bằng Google, và đó là chủ ý.
     *
     * Nghe vô lý — họ có gõ mật khẩu đâu mà bắt đổi. Nhưng `must_change_password`
     * bật lên khi quản trị viên tạo tài khoản bằng một mật khẩu TẠM, và mật khẩu
     * tạm ấy vẫn là một chứng thực sống mà người khác đang biết. Cho qua vì người
     * dùng vào bằng Google là để lại một lối vào thứ hai không ai đóng.
     */
    mustChangePassword: user.mustChangePassword,
    user,
    // Tổ chức đang mở và vai trò trong đó — hai thứ frontend dùng để điều hướng.
    tenant: toTenantSummary(active),
    role: active.role,
    // Danh sách đầy đủ, kể cả khi mới có một phần tử.
    memberships: memberships.map(toTenantSummaryWithRole),
  };
}

/**
 * POST /api/auth/google — §1.9 đăng nhập bằng tài khoản Google.
 *
 * ═══ CHỈ ĐĂNG NHẬP, KHÔNG ĐĂNG KÝ ══════════════════════════════════════════
 *
 * Endpoint này không bao giờ tạo người dùng mới. Google chỉ đưa được `email`,
 * `name` và `sub`; mà `registerAccount` còn cần tên công ty, số điện thoại,
 * chức danh — và quan trọng hơn, nó DỰNG MỘT TỔ CHỨC. Tạo tổ chức từ một cú bấm
 * nút là thứ không hoàn tác được qua giao diện, nên người chưa có tài khoản
 * được mời đi qua trang đăng ký như cũ.
 *
 * ═══ TỰ LIÊN KẾT, và chốt duy nhất giữ cho nó an toàn ══════════════════════
 *
 * Email đã có tài khoản mật khẩu, nay bấm nút Google: hệ thống tự lập liên kết.
 * Điều đó chỉ đúng khi `email_verified === true` — tức Google đã chứng minh
 * người này kiểm soát hộp thư ấy. Thiếu chốt đó thì bất kỳ ai khai được một địa
 * chỉ đều nhận được tài khoản của người khác.
 *
 * ⚠️ Không có ngoại lệ nào cho chốt này, kể cả với tên miền "tin được".
 *
 * ═══ Vì sao ở đây KHÔNG sợ lộ danh sách email ══════════════════════════════
 *
 * `/register` phải trả 409 khi email trùng, và đó là một kênh liệt kê email —
 * README đã ghi. Endpoint này thì không: muốn hỏi "email X có tài khoản không"
 * thì phải có một ID token Google hợp lệ CỦA CHÍNH email X, nghĩa là phải đang
 * nắm hộp thư đó. Nên ở đây nói thẳng được, và nói thẳng thì người dùng thật
 * biết mình phải làm gì tiếp.
 */
authRouter.post(
  '/google',
  authRateLimit('google'),
  asyncHandler(async (req, res) => {
    const { credential } = googleLoginSchema.parse(req.body);
    const danhTinh = await xacMinhGoogle(credential);

    // Đã liên kết từ trước: `sub` là khoá tra cứu, không đụng tới email.
    let userId = await identitiesRepo.findUserIdByProviderSubject('google', danhTinh.sub);

    if (userId === null) {
      if (!danhTinh.emailVerified) {
        throw new HttpError(
          401,
          'GoogleEmailUnverified',
          'Google chưa xác nhận email của tài khoản này, nên chưa thể dùng để đăng nhập.',
        );
      }

      const theoEmail = await usersRepo.findByEmailForLogin(danhTinh.email);
      if (!theoEmail) {
        throw new HttpError(
          404,
          'NoAccount',
          `Chưa có tài khoản nào dùng email ${danhTinh.email}. Vui lòng đăng ký trước.`,
        );
      }
      // Kiểm khoá TRƯỚC khi lập liên kết: một tài khoản đã bị khoá thì không nên
      // để lại thêm một lối vào, kể cả lối vào chưa dùng được ngay.
      if (!theoEmail.user.isActive) {
        throw new HttpError(403, 'AccountDisabled', 'Tài khoản đã bị khoá. Liên hệ quản trị viên.');
      }

      /*
       * ⚠️ KHÔNG tự liên kết vào một tài khoản chưa xác minh email (§1.10).
       *
       * Đây là nửa còn lại của lỗ hổng pre-hijacking mà migration 42 mô tả. Nửa
       * kia là `/login` chặn tài khoản chưa xác minh — nhưng nếu đường này vẫn
       * liên kết, thì kẻ squat vẫn thắng: nạn nhân vào được bằng Google, tin đó
       * là workspace của mình, nạp dữ liệu lên, và mật khẩu của kẻ squat vẫn
       * dùng được. Chặn cả hai đường thì tài khoản squat vô dụng hoàn toàn.
       *
       * Chốt đứng TRƯỚC `linkIdentity`, không phải sau: xếp sau thì dòng liên
       * kết đã được ghi rồi mới bị từ chối, và hệ thống để lại một lối vào cho
       * một tài khoản mà chính nó vừa nói là không dùng được.
       */
      if (theoEmail.user.emailVerifiedAt === null) {
        throw new HttpError(
          403,
          'EmailNotVerified',
          `Tài khoản dùng email ${danhTinh.email} chưa xác minh email. Hãy mở liên kết trong thư xác minh trước khi đăng nhập bằng Google.`,
        );
      }

      const lienKetDuoc = await identitiesRepo.linkIdentity({
        userId: theoEmail.user.id,
        provider: 'google',
        subject: danhTinh.sub,
        email: danhTinh.email,
      });
      if (!lienKetDuoc) {
        // Một trong hai khoá duy nhất đụng — xem `linkIdentity`. Cả hai đều là
        // tình huống thật, và cả hai đều cần người thật xử lý.
        throw new HttpError(
          409,
          'IdentityConflict',
          'Tài khoản này đã được liên kết với một tài khoản Google khác. Liên hệ quản trị viên.',
        );
      }
      userId = theoEmail.user.id;
    }

    // Đọc lại từ database chứ không tin bản vừa tìm: đường "đã liên kết" ở trên
    // mới chỉ có `userId`, và cả hai đường phải kiểm khoá bằng cùng một câu.
    const user = await usersRepo.findById(userId);
    if (!user) throw unauthorized('Tài khoản không còn tồn tại.');
    if (!user.isActive) {
      throw new HttpError(403, 'AccountDisabled', 'Tài khoản đã bị khoá. Liên hệ quản trị viên.');
    }
    // Chốt xác minh lặp lại ở đây để phủ CẢ đường "đã liên kết từ trước" — đường
    // đó không đi qua khối trên. Một liên kết lập trước §1.10 có thể trỏ tới
    // tài khoản chưa xác minh, và nó phải chịu đúng luật như mọi tài khoản khác.
    if (user.emailVerifiedAt === null) {
      throw new HttpError(
        403,
        'EmailNotVerified',
        'Email của tài khoản này chưa được xác minh. Hãy mở liên kết trong thư xác minh trước khi đăng nhập.',
      );
    }

    await identitiesRepo.touchIdentityLogin('google', danhTinh.sub);
    res.json(await moPhien(user));
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

/**
 * POST /api/auth/forgot-password — xin liên kết đặt lại mật khẩu
 *
 * LUÔN trả 202 với cùng một câu, kể cả khi email không tồn tại hay tài khoản đã
 * bị khoá. Lý lẽ đầy đủ ở `services/auth/passwordReset.ts`; tóm tắt: phân biệt
 * được ở đây là biến endpoint này thành máy dò xem email nào có tài khoản.
 *
 * Hạn mức dùng bucket RIÊNG chứ không dùng chung với `login`. Hai lý do: người
 * bị khoá vì gõ sai mật khẩu vẫn phải xin lại được mật khẩu (đó chính là lúc họ
 * cần nhất), và ngược lại một kẻ dội email vào đây không được phép khoá luôn
 * đường đăng nhập của cả một dải IP.
 */
authRouter.post(
  '/forgot-password',
  authRateLimit('forgot-password'),
  asyncHandler(async (req, res) => {
    const { email } = forgotPasswordSchema.parse(req.body);

    await yeuCauDatLai(email);

    // 202 chứ không phải 200: ta đã NHẬN yêu cầu, còn thư có tới hộp thư hay
    // không thì ở đây chưa biết và cố ý không nói.
    res.status(202).json({ message: DA_GUI_NEU_CO });
  }),
);

/**
 * POST /api/auth/verify-email — xác minh email bằng vé trong thư (§1.10)
 *
 * POST chứ không phải GET dù liên kết trong thư là một URL mà người dùng bấm:
 * trang `/xac-minh-email` của frontend đọc vé từ query string rồi gọi endpoint
 * này. Để vé đi vào một GET của API nghĩa là nó nằm trong access log của
 * `morgan` — cùng lý lẽ với `/reset-password/verify` ngay dưới.
 *
 * Hạn mức dùng bucket RIÊNG: một người mở lại liên kết vài lần vì tưởng chưa
 * được không được phép khoá luôn đường đăng nhập của họ.
 */
authRouter.post(
  '/verify-email',
  authRateLimit('verify-email'),
  asyncHandler(async (req, res) => {
    const { token } = verifyEmailSchema.parse(req.body);
    await xacMinhBangVe(token);

    // 204 và KHÔNG tự đăng nhập: cùng lập luận với `/register`. Người vừa xác
    // minh sang trang đăng nhập và tự gõ mật khẩu họ đã đặt — đó là bước duy
    // nhất chứng minh mật khẩu ấy đúng như họ nghĩ.
    res.status(204).end();
  }),
);

/**
 * POST /api/auth/resend-verification — gửi lại thư xác minh (§1.10)
 *
 * LUÔN trả 202 với cùng một câu, kể cả khi email không tồn tại hoặc đã xác minh
 * rồi. Lý lẽ đầy đủ ở `services/auth/emailVerification.ts`; tóm tắt: phân biệt
 * được ở đây là biến endpoint này thành máy dò email — y như `/forgot-password`.
 *
 * Bucket riêng, không dùng chung với `login`: người đang mắc ở đúng chỗ này cần
 * bấm được nút gửi lại, và họ tới đây CHÍNH VÌ không đăng nhập được.
 */
authRouter.post(
  '/resend-verification',
  authRateLimit('resend-verification'),
  asyncHandler(async (req, res) => {
    const { email } = resendVerificationSchema.parse(req.body);
    await yeuCauGuiLai(email);
    res.status(202).json({ message: DA_GUI_NEU_CAN });
  }),
);

/**
 * POST /api/auth/reset-password/verify — kiểm liên kết trước khi dựng form
 *
 * Tách riêng khỏi bước đổi mật khẩu để người mở một liên kết đã hết hạn biết
 * ngay, thay vì gõ xong mật khẩu mới rồi mới bị từ chối.
 *
 * POST chứ không phải GET dù nó chỉ đọc: vé nằm trong body, không nằm trên URL.
 * Trên URL thì nó vào access log của `morgan`, vào lịch sử trình duyệt, và vào
 * header `Referer` của mọi request đi ra từ trang đó.
 */
authRouter.post(
  '/reset-password/verify',
  authRateLimit('reset-password'),
  asyncHandler(async (req, res) => {
    const { token } = verifyResetTokenSchema.parse(req.body);
    await kiemVe(token);
    res.status(204).end();
  }),
);

/** POST /api/auth/reset-password — đặt mật khẩu mới bằng vé trong email */
authRouter.post(
  '/reset-password',
  authRateLimit('reset-password'),
  asyncHandler(async (req, res) => {
    const { token, newPassword } = resetPasswordSchema.parse(req.body);

    await datLaiMatKhau(token, newPassword);

    // KHÔNG tự đăng nhập, cùng lập luận với `/register` ở đầu file: bước đăng
    // nhập đầu tiên là bước duy nhất chứng minh mật khẩu vừa đặt đúng như người
    // dùng nghĩ. Gõ nhầm thì họ biết ngay bây giờ.
    //
    // ⚠️ Token JWT đã cấp TRƯỚC lần đổi này vẫn sống tới lúc hết hạn — JWT vô
    // trạng thái, không có gì để thu hồi. Nghĩa là đổi mật khẩu KHÔNG đá được
    // kẻ đang chiếm phiên ra ngoài. Muốn vậy cần danh sách chặn trên Redis, đã
    // ghi trong phần nợ kỹ thuật của README.
    res.status(204).end();
  }),
);

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
