import jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import type { UserRole } from '../../repositories/users';
import { unauthorized } from '../../utils/httpError';

export interface AccessTokenPayload {
  userId: number;
  role: UserRole;
  tenantId: number;
}

/**
 * Nội dung token cố ý giữ tối thiểu: userId, role, tenantId.
 *
 * KHÔNG nhét email/họ tên/thông tin cá nhân vào đây. Payload JWT chỉ được ký
 * chứ không được mã hoá — ai cầm token cũng giải base64 ra đọc được. Token lại
 * nằm trong localStorage (quyết định đã chốt), nên càng ít dữ liệu càng đỡ
 * thiệt hại nếu bị lộ.
 */
export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(
    { role: payload.role, tenantId: payload.tenantId },
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

const ROLES: readonly UserRole[] = ['admin', 'creator', 'viewer'];

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
  const role = decoded['role'] as unknown;
  const tenantId = Number(decoded['tenantId']);

  if (
    !Number.isInteger(userId) ||
    userId <= 0 ||
    !Number.isInteger(tenantId) ||
    tenantId <= 0 ||
    typeof role !== 'string' ||
    !ROLES.includes(role as UserRole)
  ) {
    throw unauthorized('Phiên đăng nhập không hợp lệ hoặc đã hết hạn.');
  }

  return { userId, role: role as UserRole, tenantId };
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
