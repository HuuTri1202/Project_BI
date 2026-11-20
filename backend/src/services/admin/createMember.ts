import {
  ADMIN_ERROR_CODES,
  type CreateAdminUserResultDto,
  type JobTitle,
  type TenantRole,
} from '@bi/shared';

import { mysqlPool } from '../../config/mysql';
import { withTransaction } from '../../db/tx';
import * as adminMembersRepo from '../../repositories/adminMembers';
import * as membershipsRepo from '../../repositories/memberships';
import * as workspaceMembersRepo from '../../repositories/workspaceMembers';
import * as usersRepo from '../../repositories/users';
import { HttpError } from '../../utils/httpError';
import { generateTempPassword, hashPassword } from '../auth/password';
import { kiemHanMuc } from '../billing/limits';
import { provisionTenant } from '../tenant/provisionTenant';

export interface CreateMemberInput {
  tenantId: number;
  email: string;
  fullName: string;
  role: TenantRole;
  jobTitle?: JobTitle | undefined;
  /**
   * Ai đang tạo — ghi vào `workspace_members.created_by` (§B5).
   *
   * `null` khi không biết: cột đó `ON DELETE SET NULL`, tức dòng phân quyền
   * sống lâu hơn người đã gán nó, nên "không biết ai gán" là một trạng thái
   * bảng này vốn đã chịu được.
   */
  actorId?: number | null | undefined;
}

/**
 * Admin thêm một người vào tổ chức (§4.7).
 *
 * ─── Vì sao "mời" lại là "tạo tài khoản + mật khẩu tạm" ──────────────────────
 *
 * Khi viết hàm này, hệ thống chưa có kênh gửi mail nào, nên lời mời qua link
 * đồng nghĩa với dựng cả một hạ tầng mới. Cách này dùng đúng những thứ đã có sẵn
 * trong schema: `must_change_password` và trang đổi mật khẩu bắt buộc. Admin đọc
 * mật khẩu tạm cho người kia qua Zalo/Teams, người kia đăng nhập và bị buộc đổi.
 *
 * ⚠️ LÝ LẼ TRÊN ĐÃ CŨ. `services/mail/mailer.ts` có từ lúc làm quên-mật-khẩu, và
 * migration 42 đã để lại sẵn khuôn bảng vé dùng-một-lần. Nghĩa là mời-bằng-liên-kết
 * giờ chỉ còn thiếu một trang đặt mật khẩu lần đầu, và nó là cách đúng: Admin sẽ
 * không còn biết mật khẩu của ai, và chính lá thư mời trở thành bằng chứng sở hữu
 * hộp thư (xem `emailVerified` ở dưới).
 *
 * ─── Hai luồng, và vì sao email đã tồn tại thì GẮN chứ không báo lỗi ─────────
 *
 * Email là định danh TOÀN CỤC (migration 1). Một người đang làm ở công ty khác
 * hoàn toàn có thể được mời sang đây. Từ chối vì "email đã tồn tại" sẽ khiến họ
 * vĩnh viễn không được mời vào bất kỳ tổ chức thứ hai nào — hỏng hẳn mô hình đa
 * tổ chức.
 *
 * ⚠️ Cái giá phải trả, nói thẳng: endpoint này cho bất kỳ Admin nào biết được
 * một email bất kỳ ĐÃ ĐĂNG KÝ trên nền tảng hay chưa (phản hồi 'created' hay
 * 'attached'). Đó là một kênh dò email thật sự. Không bịt được mà không phá tính
 * năng — "luôn giả vờ tạo mới" thì đưa Admin một mật khẩu tạm không dùng được.
 * Giảm nhẹ bằng rate limit, và ghi ra đây để người sau biết nó là quyết định chứ
 * không phải sơ suất.
 *
 * ─── Tài khoản mới còn được cấp một TỔ CHỨC CÁ NHÂN ─────────────────────────
 *
 * Chỉ ở nhánh 'created'. Người được tạo tài khoản nhận HAI membership: tổ chức
 * được mời (vai trò do Admin chọn) và không gian riêng của chính họ (vai trò
 * `admin`) — đúng bằng thứ mà người tự đăng ký có. Nhánh 'attached' cố ý không
 * cấp gì thêm: tài khoản đã tồn tại thì không gian riêng của họ, nếu có, cũng đã
 * tồn tại; tạo thêm một cái nữa là sinh tổ chức rác.
 */
export async function createMember(input: CreateMemberInput): Promise<CreateAdminUserResultDto> {
  const existing = await usersRepo.findByEmailForLogin(input.email);

  // ── Luồng 2: tài khoản đã tồn tại ──────────────────────────────────────────
  if (existing) {
    if (!existing.user.isActive) {
      throw new HttpError(
        409,
        ADMIN_ERROR_CODES.ACCOUNT_UNAVAILABLE,
        'Tài khoản này đang bị khoá ở cấp hệ thống, không thêm vào tổ chức được.',
      );
    }

    const current = await adminMembersRepo.findMember(mysqlPool, input.tenantId, existing.user.id);
    if (current && current.removedAt === null) {
      throw new HttpError(
        409,
        ADMIN_ERROR_CODES.MEMBER_ALREADY_EXISTS,
        'Người này đã là thành viên của tổ chức.',
        { email: 'Đã là thành viên' },
      );
    }

    /*
     * Từ §11.2 nhánh này CÓ transaction, dù vẫn chỉ một câu ghi.
     *
     * Transaction ở đây không phải để gộp nhiều câu ghi mà để KHOÁ: hạn mức
     * thành viên là hạn mức về QUYỀN TRUY CẬP, nên vượt nó không chỉ là một con
     * số lệch — người thứ 11 ở gói 10 người vẫn đọc được dữ liệu tổ chức cho tới
     * khi có ai đó gỡ họ bằng tay. Thao tác này hiếm (rate limit 20 lượt/10 phút)
     * nên tuần tự hoá theo tổ chức không tốn gì.
     *
     * Guard đặt SAU câu kiểm `MEMBER_ALREADY_EXISTS` ở trên: mời lại người ĐANG
     * là thành viên không làm số tăng, nên chặn nó là chặn sai. Tới được đây thì
     * hoặc chưa có membership, hoặc có nhưng đã bị gỡ — và `upsert` đặt lại
     * `removed_at = NULL`, tức là cả hai đều làm số tăng.
     */
    await withTransaction(async (conn) => {
      await conn.query('SELECT id FROM tenants WHERE id = ? FOR UPDATE', [input.tenantId]);
      await kiemHanMuc(conn, input.tenantId, 'members', new Date());
      await membershipsRepo.upsert(conn, input.tenantId, existing.user.id, input.role);
      // §B5 — thấy được workspace nào. Xem `ganWorkspaceMacDinh`.
      await ganWorkspaceMacDinh(conn, input.tenantId, existing.user.id, input.actorId ?? null);
    });

    const attached = await adminMembersRepo.findMember(mysqlPool, input.tenantId, existing.user.id);
    if (!attached) {
      throw new Error('Vừa gắn thành viên xong nhưng đọc lại không thấy');
    }
    // KHÔNG kèm tempPassword: họ đã có mật khẩu riêng, và Admin của tổ chức này
    // không có quyền đặt lại mật khẩu của một danh tính dùng chung.
    return { mode: 'attached', user: attached };
  }

  // ── Luồng 1: tạo tài khoản mới ─────────────────────────────────────────────
  const tempPassword = generateTempPassword();
  // Băm NGOÀI transaction: bcrypt cost 12 mất khoảng 290ms, giữ một trong mười
  // connection của pool suốt ngần ấy thời gian chỉ để đốt CPU là lãng phí.
  const passwordHash = await hashPassword(tempPassword);

  const userId = await withTransaction(async (conn) => {
    /*
     * Hạn mức thành viên — §11.2. Khoá rồi kiểm, TRƯỚC khi tạo tài khoản.
     *
     * Trước chứ không sau: tạo user rồi mới phát hiện hết chỗ thì transaction
     * rollback và tài khoản biến mất — đúng về dữ liệu, nhưng đã đốt một lần
     * bcrypt cost 12 (~290ms) cho một việc không bao giờ thành.
     *
     * ⚠️ Chỉ tính TỔ CHỨC MỜI. Tổ chức cá nhân cấp thêm ở dưới là một tenant
     * KHÁC, vừa sinh ra và có đúng một thành viên — không đụng hạn mức của ai.
     */
    await conn.query('SELECT id FROM tenants WHERE id = ? FOR UPDATE', [input.tenantId]);
    await kiemHanMuc(conn, input.tenantId, 'members', new Date());

    const id = await usersRepo.createUser(conn, {
      email: input.email,
      passwordHash,
      fullName: input.fullName,
      jobTitle: input.jobTitle ?? null,
      platformRole: 'user',
      // Điểm mấu chốt của cả luồng này: Admin biết mật khẩu tạm, nên nó phải
      // chết ngay sau lần đăng nhập đầu tiên.
      mustChangePassword: true,
      /*
       * ─── Vì sao tài khoản do Admin tạo được coi là ĐÃ xác minh (§1.10) ─────
       *
       * Vì không có đường nào khác mà vẫn giữ được luồng này. `/login` chặn tài
       * khoản chưa xác minh; để `null` ở đây thì người vừa được mời không đăng
       * nhập được bằng mật khẩu tạm, và cả chức năng "Admin thêm thành viên"
       * ngừng hoạt động.
       *
       * Cái ta dựa vào là: Admin tự gõ email ấy vào và chịu trách nhiệm về nó.
       * Yếu hơn một lá thư xác minh, nhưng không phải không có gì — và muốn tới
       * được đây đã phải là admin của một tổ chức thật, tức đã qua một lần đăng
       * ký có xác minh.
       *
       * ⚠️ RỦI RO CÒN LẠI: một admin xấu bụng squat được email của người khác
       * trong phạm vi tổ chức của mình. Cách sửa thật là MỜI BẰNG LIÊN KẾT thay
       * cho mật khẩu tạm — lúc đó chính lá thư mời là bằng chứng sở hữu hộp thư,
       * và `email_verified_at` ghi khi người ta bấm vào nó. Hạ tầng đã có đủ
       * (`guiMail` + khuôn vé của migration 42); việc còn lại là trang đặt mật
       * khẩu lần đầu.
       *
       * ponytail: tin Admin thay cho thư mời; nâng lên khi làm mời-bằng-liên-kết.
       */
      emailVerified: true,
    });

    // ⚠️ THỨ TỰ HAI CÂU `upsert` DƯỚI ĐÂY LÀ CÓ NGHĨA, đừng hoán đổi.
    //
    // `listActiveByUser` sắp theo `m.id ASC` và màn đăng nhập lấy phần tử đầu
    // làm tổ chức mở sẵn. Membership của TỔ CHỨC MỜI phải được chèn trước để
    // mang id nhỏ hơn, nhờ vậy người vừa được tạo tài khoản đăng nhập vào đúng
    // nơi họ được mời tới. Đảo lại thì họ mở ra một không gian cá nhân trống
    // rỗng và tưởng mình bị mời nhầm.
    await membershipsRepo.upsert(conn, input.tenantId, id, input.role);

    /*
     * Thấy được workspace nào — §B5. Ngay sau `upsert` membership và trong cùng
     * transaction: hai dòng cùng trả lời một câu hỏi ("người này vào được đâu"),
     * nên chúng phải cùng sống hoặc cùng chết.
     */
    await ganWorkspaceMacDinh(conn, input.tenantId, id, input.actorId ?? null);

    // ─── Không gian riêng, ngang hàng với người tự đăng ký ────────────────────
    //
    // Người tự đăng ký lập ra công ty của mình và làm `admin` ở đó. Người được
    // Admin tạo tài khoản trước đây không có gì của riêng mình — họ chỉ tồn tại
    // bên trong tổ chức của người mời, và mất tư cách thành viên là mất luôn
    // đường đăng nhập (`403 NoMembership`). Cấp sẵn một tổ chức cá nhân cho họ
    // một chỗ đứng độc lập với người đã mời.
    //
    // Vai trò `admin` chứ không phải `viewer`: đây là không gian của chính họ.
    const personal = await provisionTenant(conn, {
      name: personalTenantName(input.fullName),
      createdBy: id,
      ownerUserId: id,
    });
    await membershipsRepo.upsert(conn, personal.tenantId, id, 'admin');

    return id;
  }).catch((err: unknown) => {
    // Hai request cùng thêm một email trong tích tắc: câu SELECT ở đầu hàm đều
    // thấy trống, nhưng UNIQUE(email) chỉ cho một cái qua. Ràng buộc mới là thứ
    // thật sự chặn trùng; SELECT chỉ để có thông báo tử tế.
    if (isDuplicateEntry(err, 'uq_users_email')) {
      throw new HttpError(409, 'EmailAlreadyRegistered', 'Email này vừa được đăng ký.', {
        email: 'Email này đã tồn tại',
      });
    }
    throw err;
  });

  const created = await adminMembersRepo.findMember(mysqlPool, input.tenantId, userId);
  if (!created) {
    throw new Error('Vừa tạo thành viên xong nhưng đọc lại không thấy');
  }

  return { mode: 'created', user: created, tempPassword };
}

/**
 * Tên tổ chức cá nhân, suy từ họ tên.
 *
 * Không hỏi Admin đặt tên: đây là không gian của NGƯỜI KIA, để người mời đặt tên
 * hộ là sai chủ thể. Cũng không lấy trơn họ tên làm tên tổ chức — trong console
 * hệ thống, một dòng tên "Trần Thị Thu" nằm giữa các công ty thật trông như dữ
 * liệu lỗi. Tiền tố "Không gian của" nói rõ nó là loại gì ngay ở chỗ đọc.
 */
/**
 * Workspace mặc định của người vừa được thêm — §B5.
 *
 * ═══ Chỉ gán khi tổ chức có ĐÚNG MỘT workspace ════════════════════════════
 *
 * Hai hành vi sai nằm hai bên, và luật này đi giữa.
 *
 * Bên trái là hành vi CŨ: không gán gì cả. Người được mời đăng nhập vào và
 * thấy "Chưa có workspace — hãy nhờ quản trị viên thêm bạn vào một workspace",
 * kèm `409` ở trang chủ; còn Admin thì không được nhắc gì lúc tạo vì hộp thoại
 * không có ô workspace nào. Đo được ngày 20/11/2026 trên một tổ chức chỉ có
 * MỘT workspace — tức là trên mọi tổ chức gói Miễn phí. Một tài khoản vừa tạo
 * ra đã là ngõ cụt cho cả hai phía.
 *
 * Bên phải là "gán hết": nó xoá sạch lý do `workspace_members` ra đời
 * (migration 40) — thêm một nhân viên nhân sự thì họ thấy luôn dữ liệu của
 * Sale, của Kế toán, của Ban giám đốc.
 *
 * Luật ở giữa: chỉ gán khi KHÔNG CÓ GÌ ĐỂ CHỌN. Một workspace thì "chọn
 * workspace nào" không phải một câu hỏi, và bắt Admin trả lời nó là bắt họ làm
 * một thao tác chỉ có một đáp án. Từ hai workspace trở lên thì đó là một quyết
 * định thật về phạm vi dữ liệu, và hệ thống không đoán hộ — hộp thoại tạo nói
 * thẳng điều đó.
 */
async function ganWorkspaceMacDinh(
  conn: Parameters<typeof membershipsRepo.upsert>[0],
  tenantId: number,
  userId: number,
  actorId: number | null,
): Promise<void> {
  const ws = await workspaceMembersRepo.liveWorkspaceIds(conn, tenantId);
  const duyNhat = ws.length === 1 ? ws[0] : undefined;
  if (duyNhat === undefined) return;
  await workspaceMembersRepo.grant(conn, tenantId, duyNhat, userId, actorId);
}

function personalTenantName(fullName: string): string {
  return `Không gian của ${fullName}`;
}

function isDuplicateEntry(err: unknown, indexName: string): boolean {
  if (!(err instanceof Error) || !('errno' in err)) return false;
  const { errno } = err as Error & { errno?: number };
  return errno === 1062 && err.message.includes(indexName);
}
