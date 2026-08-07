import jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import { isTenantRole, type TenantRole } from '../../repositories/memberships';
import { unauthorized } from '../../utils/httpError';

/**
 * Nội dung token.
 *
 * `role` ở đây là vai trò trong TỔ CHỨC đang mở (`tenantId`), lấy từ bảng
 * `memberships`. `platformRole` là trục quyền độc lập ở cấp hệ thống — xem ghi
 * chú hai trục vai trò trong db/migrations.ts.
 *
 * Vì một người có thể thuộc nhiều tổ chức, token luôn gắn với ĐÚNG MỘT tổ chức.
 * Đổi tổ chức nghĩa là cấp token mới, không phải sửa token cũ.
 */
export interface AccessTokenPayload {
  userId: number;
  tenantId: number;
  role: TenantRole;
  platformRole: PlatformRoleClaim;
}

type PlatformRoleClaim = 'superadmin' | 'user';

/**
 * Payload cố ý giữ tối thiểu: định danh + hai trục quyền.
 *
 * KHÔNG nhét email/họ tên/thông tin cá nhân vào đây. Payload JWT chỉ được ký
 * chứ không được mã hoá — ai cầm token cũng giải base64 ra đọc được. Token lại
 * nằm trong localStorage (quyết định đã chốt), nên càng ít dữ liệu càng đỡ
 * thiệt hại nếu bị lộ.
 */
export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(
    {
      tenantId: payload.tenantId,
      role: payload.role,
      platformRole: payload.platformRole,
    },
    env.JWT_SECRET,
    {
      algorithm: 'HS256',
      subject: String(payload.userId),
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      expiresIn: env.JWT_EXPIRES_IN,
    } as jwt.SignOptions,
  );
}

function isPlatformRoleClaim(value: unknown): value is PlatformRoleClaim {
  return value === 'superadmin' || value === 'user';
}

/**
 * Xác thực token và trả về payload đã kiểm kiểu.
 *
 * Khai `algorithms: ['HS256']` là bắt buộc: không chốt thuật toán thì token
 * mang `alg: none` hoặc `alg` khác có thể được chấp nhận — đây là lỗ hổng JWT
 * nổi tiếng nhất.
 */
export function verifyAccessToken(token: string): AccessTokenPayload {
  let decoded: jwt.JwtPayload;
  try {
    decoded = jwt.verify(token, env.JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
    }) as jwt.JwtPayload;
  } catch {
    // Không phân biệt hết hạn / sai chữ ký / sai định dạng ra ngoài; client chỉ
    // cần biết là phải đăng nhập lại.
    throw unauthorized('Phiên đăng nhập không hợp lệ hoặc đã hết hạn.');
  }

  const userId = Number(decoded.sub);
  const tenantId = Number(decoded['tenantId']);
  const role: unknown = decoded['role'];
  const platformRole: unknown = decoded['platformRole'];

  if (
    !Number.isInteger(userId) ||
    userId <= 0 ||
    !Number.isInteger(tenantId) ||
    tenantId <= 0 ||
    !isTenantRole(role) ||
    !isPlatformRoleClaim(platformRole)
  ) {
    throw unauthorized('Phiên đăng nhập không hợp lệ hoặc đã hết hạn.');
  }

  return { userId, tenantId, role, platformRole };
}

/** Đổi '7d' / '15m' / '3600' thành số giây, để trả về cho client biết hạn dùng. */
export function expiresInSeconds(): number {
  const raw = env.JWT_EXPIRES_IN.trim();
  const match = /^(\d+)\s*([smhd])?$/.exec(raw);
  if (!match) return 0;

  const amount = Number(match[1]);
  const unit = match[2] ?? 's';
  const multiplier = { s: 1, m: 60, h: 3600, d: 86400 }[unit] ?? 1;
  return amount * multiplier;
}
