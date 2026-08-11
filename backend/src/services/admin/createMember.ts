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
import * as usersRepo from '../../repositories/users';
import { HttpError } from '../../utils/httpError';
import { generateTempPassword, hashPassword } from '../auth/password';
import { provisionTenant } from '../tenant/provisionTenant';

export interface CreateMemberInput {
  tenantId: number;
  email: string;
  fullName: string;
  role: TenantRole;
  jobTitle?: JobTitle | undefined;
}

/**
 * Admin thêm một người vào tổ chức (§4.7).
 *
 * ─── Vì sao "mời" lại là "tạo tài khoản + mật khẩu tạm" ──────────────────────
 *
 * Hệ thống chưa có kênh gửi mail nào. Lời mời qua link thì cần bảng token, cần
 * trang nhận lời mời, và vẫn phải nhờ Admin tự chuyển link đi. Cách này dùng
 * đúng những thứ đã có sẵn trong schema: `must_change_password` và trang đổi mật
 * khẩu bắt buộc. Admin đọc mật khẩu tạm cho người kia qua Zalo/Teams, người kia
 * đăng nhập và bị buộc đổi ngay.
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

    // Một câu duy nhất nên không cần transaction. `upsert` đặt lại
    // `removed_at = NULL`, tức là mời lại người từng bị gỡ cũng đi qua đây.
    await membershipsRepo.upsert(mysqlPool, input.tenantId, existing.user.id, input.role);

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
    const id = await usersRepo.createUser(conn, {
      email: input.email,
      passwordHash,
      fullName: input.fullName,
      jobTitle: input.jobTitle ?? null,
      platformRole: 'user',
      // Điểm mấu chốt của cả luồng này: Admin biết mật khẩu tạm, nên nó phải
      // chết ngay sau lần đăng nhập đầu tiên.
      mustChangePassword: true,
    });

    // ⚠️ THỨ TỰ HAI CÂU `upsert` DƯỚI ĐÂY LÀ CÓ NGHĨA, đừng hoán đổi.
    //
    // `listActiveByUser` sắp theo `m.id ASC` và màn đăng nhập lấy phần tử đầu
    // làm tổ chức mở sẵn. Membership của TỔ CHỨC MỜI phải được chèn trước để
    // mang id nhỏ hơn, nhờ vậy người vừa được tạo tài khoản đăng nhập vào đúng
    // nơi họ được mời tới. Đảo lại thì họ mở ra một không gian cá nhân trống
    // rỗng và tưởng mình bị mời nhầm.
    await membershipsRepo.upsert(conn, input.tenantId, id, input.role);

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
function personalTenantName(fullName: string): string {
  return `Không gian của ${fullName}`;
}

function isDuplicateEntry(err: unknown, indexName: string): boolean {
  if (!(err instanceof Error) || !('errno' in err)) return false;
  const { errno } = err as Error & { errno?: number };
  return errno === 1062 && err.message.includes(indexName);
}
