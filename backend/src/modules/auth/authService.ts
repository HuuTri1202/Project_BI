import { ERROR_CODES, type AuthSessionDto, type MeDto, type RoleCode } from '@bi/shared';

import { newId } from '../../db/id';
import { withTransaction } from '../../db/tx';
import { AppError } from '../../errors/AppError';
import * as repo from './authRepository';
import { burnPasswordCompareTime, hashPassword, verifyPassword } from './password';
import type { LoginRequest, RegisterRequest } from './schemas';
import { toUserDto, type MembershipRow } from './types';

/** Vai trò của người tạo ra tenant. Người được mời sau sẽ mặc định là 'viewer'. */
const FOUNDER_ROLE: RoleCode = 'tenant_admin';

const DEFAULT_WORKSPACE_NAME = 'Không gian làm việc mặc định';

/**
 * Nhận diện lỗi vi phạm UNIQUE của MySQL.
 *
 * Kiểm CẢ `errno` LẪN tên index: `errno` 1062 chỉ nói "có unique key bị vi
 * phạm", không nói key nào. Khi bảng users có unique key thứ hai, một lỗi bất kỳ
 * sẽ bị báo nhầm thành "email đã tồn tại" nếu không lọc theo tên.
 *
 * MySQL 8 ghi tên dạng `users.uq_users_email`, MySQL 5.7 ghi `uq_users_email` —
 * `includes` khớp cả hai. Tuyệt đối không moi giá trị trong dấu nháy ra rồi trả
 * lại cho client: đó là dữ liệu người dùng gửi lên, echo lại là mở đường XSS.
 */
function isDuplicateEntry(err: unknown, indexName: string): boolean {
  if (!(err instanceof Error) || !('errno' in err)) {
    return false;
  }
  const { errno } = err as Error & { errno?: number };
  return errno === 1062 && err.message.includes(indexName);
}

export async function register(input: RegisterRequest): Promise<AuthSessionDto> {
  // Băm NGOÀI transaction. bcrypt cost 12 mất khoảng 250–400ms; làm việc đó bên
  // trong BEGIN nghĩa là giữ 1 trong 10 connection của pool và một transaction
  // InnoDB suốt một phần ba giây chỉ để đốt CPU.
  const passwordHash = await hashPassword(input.password);

  // Sinh sẵn toàn bộ id để bốn câu INSERT độc lập nhau — không cần round-trip
  // LAST_INSERT_ID() nào giữa chúng.
  const userId = newId();
  const tenantId = newId();
  const workspaceId = newId();
  const membershipId = newId();

  try {
    await withTransaction(async (conn) => {
      // users ĐI ĐẦU: đây là câu insert duy nhất thực tế có thể vi phạm ràng
      // buộc (email trùng). Hỏng ngay từ đầu thì không phí công tạo tenant.
      //
      // KHÔNG có câu SELECT kiểm tra trùng trước đó, và đó là chủ ý: unique
      // index CHÍNH LÀ phép kiểm tra phía server, và là phép kiểm duy nhất thật
      // sự bảo đảm. Một câu SELECT trước vẫn có khe TOCTOU (hai request đồng
      // thời cùng thấy email còn trống) nên vẫn phải bắt ER_DUP_ENTRY; giữ cả
      // hai chỉ tạo ra hai nhánh code phải luôn đồng ý với nhau.
      await repo.insertUser(conn, {
        id: userId,
        email: input.email,
        passwordHash,
        fullName: input.fullName,
        phone: input.phone,
        jobTitle: input.jobTitle,
      });
      // Tenant CHÍNH LÀ công ty người dùng khai lúc đăng ký.
      //
      // Mỗi lần đăng ký tạo một công ty MỚI, kể cả khi trùng tên công ty đã có —
      // `tenants.name` không unique, và cố ý như vậy: "FPT Software" ở hai nơi
      // hoàn toàn có thể là hai tổ chức khác nhau, còn gộp nhầm hai công ty
      // thành một là để lộ dữ liệu giữa các khách hàng. Muốn người thứ hai vào
      // chung công ty thì phải qua lời mời, không phải qua việc gõ trùng tên.
      await repo.insertTenant(conn, { id: tenantId, name: input.companyName });
      await repo.insertWorkspace(conn, {
        id: workspaceId,
        tenantId,
        name: DEFAULT_WORKSPACE_NAME,
      });
      await repo.insertMembership(conn, {
        id: membershipId,
        userId,
        tenantId,
        roleCode: FOUNDER_ROLE,
      });
    });
  } catch (err) {
    if (isDuplicateEntry(err, 'uq_users_email')) {
      // withTransaction đã rollback trước khi ném lên tới đây.
      throw new AppError(
        409,
        ERROR_CODES.EMAIL_ALREADY_REGISTERED,
        'Email đã được đăng ký',
      );
    }
    throw err;
  }

  const user = await repo.findUserById(userId);
  if (!user) {
    throw new Error('Vừa tạo user xong nhưng đọc lại không thấy — dữ liệu không nhất quán');
  }

  return {
    user: toUserDto(user),
    tenant: { id: tenantId, name: input.companyName },
    workspace: { id: workspaceId, name: DEFAULT_WORKSPACE_NAME },
    role: FOUNDER_ROLE,
  };
}

/** Dùng chung cho mọi nhánh thất bại khi đăng nhập — xem giải thích bên dưới. */
function invalidCredentials(): AppError {
  return new AppError(
    401,
    ERROR_CODES.INVALID_CREDENTIALS,
    'Email hoặc mật khẩu không đúng',
  );
}

export async function login(input: LoginRequest): Promise<AuthSessionDto> {
  const user = await repo.findUserByEmail(input.email);

  if (!user) {
    // Vẫn tiêu tốn thời gian so mật khẩu rồi mới báo lỗi, để endpoint không trả
    // lời câu "email này có tồn tại không" chỉ bằng độ trễ.
    await burnPasswordCompareTime(input.password);
    throw invalidCredentials();
  }

  const ok = await verifyPassword(input.password, user.password_hash);
  if (!ok) {
    throw invalidCredentials();
  }

  // Tài khoản bị khoá cũng trả về ĐÚNG lỗi đó: nói "tài khoản đã bị khoá" là xác
  // nhận với kẻ tấn công rằng email tồn tại và mật khẩu họ đoán là đúng.
  if (user.status !== 'active') {
    throw invalidCredentials();
  }

  const memberships = await repo.findMembershipsByUser(user.id);
  const primary = memberships[0];
  if (!primary) {
    // Không thể xảy ra qua luồng đăng ký, nhưng có thể xảy ra nếu ai đó xoá
    // membership bằng SQL tay. Báo rõ ràng còn hơn ném TypeError ở đâu đó.
    throw new AppError(
      403,
      'NO_MEMBERSHIP',
      'Tài khoản chưa thuộc tổ chức nào. Liên hệ quản trị viên.',
    );
  }

  const workspaces = await repo.findWorkspacesByTenant(primary.tenant_id);
  const workspace = workspaces[0];

  await repo.touchLastLogin(user.id);

  return {
    user: toUserDto(user),
    tenant: { id: primary.tenant_id, name: primary.tenant_name },
    workspace: workspace
      ? { id: workspace.id, name: workspace.name }
      : { id: '', name: DEFAULT_WORKSPACE_NAME },
    role: primary.role_code,
  };
}

/**
 * Chọn tenant đang hoạt động: ưu tiên tenant ghi trong token, nếu không còn hợp
 * lệ (bị mời ra khỏi tổ chức) thì lùi về membership sớm nhất.
 *
 * Cố ý KHÔNG thêm cột `is_default`: "membership sớm nhất" là một QUY TẮC, không
 * phải cam kết schema, nên thay bằng quy tắc khác sau này không cần migration.
 */
function pickActiveMembership(
  memberships: MembershipRow[],
  preferredTenantId: string,
): MembershipRow | undefined {
  return memberships.find((m) => m.tenant_id === preferredTenantId) ?? memberships[0];
}

export async function loadMe(userId: string, tenantId: string): Promise<MeDto> {
  const user = await repo.findUserById(userId);
  if (!user || user.status !== 'active') {
    throw new AppError(401, ERROR_CODES.UNAUTHENTICATED, 'Phiên không còn hợp lệ');
  }

  const memberships = await repo.findMembershipsByUser(userId);
  const active = pickActiveMembership(memberships, tenantId);
  if (!active) {
    throw new AppError(403, 'NO_MEMBERSHIP', 'Tài khoản chưa thuộc tổ chức nào');
  }

  const workspaces = await repo.findWorkspacesByTenant(active.tenant_id);

  return {
    user: toUserDto(user),
    role: active.role_code,
    tenant: { id: active.tenant_id, name: active.tenant_name },
    workspaces: workspaces.map((w) => ({ id: w.id, name: w.name })),
    // Danh sách đầy đủ, hiện luôn dài 1. Trả sẵn để giao diện không phải đổi
    // hình dạng dữ liệu vào ngày có bộ chuyển tenant.
    tenants: memberships.map((m) => ({
      id: m.tenant_id,
      name: m.tenant_name,
      role: m.role_code,
    })),
  };
}
