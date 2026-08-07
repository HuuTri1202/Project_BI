import type { RoleCode } from '@bi/shared';
import type { CookieOptions, Response } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

import { env, isProduction } from '../../config/env';

const ISSUER = 'bi-platform';
const AUDIENCE = 'bi-platform-api';

/**
 * Nội dung token phiên: CHỈ ĐỊNH DANH.
 *
 * Cố ý KHÔNG mang `workspaceIds` / `projectIds`, dù README có nhắc tới chúng
 * trong securityContext của Cube. Ba lý do:
 *   1. Chúng thay đổi ngay khi ai đó tạo project mới, nên token sống 1 giờ sẽ
 *      cấp quyền theo một danh sách đã cũ.
 *   2. Chúng không có giới hạn số lượng, còn cookie thì chỉ khoảng 4KB.
 *   3. Chúng là dữ liệu PHÂN QUYỀN, còn cookie phiên là XÁC THỰC. Trộn hai thứ
 *      có vòng đời khác nhau vào một chỗ là nguồn gốc của lỗi phân quyền cũ.
 *
 * Yêu cầu securityContext được đáp ứng bằng TOKEN THỨ HAI: `POST /api/v1/query`
 * tra projectIds từ database (cache Redis), rồi ký một JWT riêng cho Cube sống
 * khoảng 2 phút bằng CUBEJS_API_SECRET. Hai token, hai vòng đời, hai secret.
 */
export interface SessionClaims {
  sub: string;
  tid: string;
  role: RoleCode;
}

/**
 * Validate lại payload sau khi verify.
 *
 * `jwt.verify` chỉ bảo đảm chữ ký đúng, không bảo đảm hình dạng. Một token do
 * chính ta ký vẫn là dữ liệu không tin được sau khi xoay secret hoặc đổi tên
 * claim — lúc đó `payload.sub` có thể `undefined` và mọi thứ phía sau nhận
 * `undefined` làm id người dùng.
 */
const claimsSchema = z.object({
  sub: z.string().min(1),
  tid: z.string().min(1),
  role: z.enum(['tenant_admin', 'creator', 'viewer']),
});

export function signSessionToken(claims: SessionClaims): string {
  return jwt.sign(claims, env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: env.JWT_ACCESS_TTL,
    issuer: ISSUER,
    audience: AUDIENCE,
    jwtid: crypto.randomUUID(),
  });
}

/** Trả `null` nếu token sai chữ ký, hết hạn, hoặc sai hình dạng. */
export function verifySessionToken(token: string): SessionClaims | null {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET, {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    // jwt.verify trả `string | JwtPayload` — phải thu hẹp, không được ép kiểu.
    if (typeof payload === 'string') {
      return null;
    }
    const parsed = claimsSchema.safeParse(payload);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Thuộc tính cookie, khai MỘT LẦN và dùng chung cho cả set lẫn clear.
 *
 * Đây không phải chuyện gọn gàng: `Set-Cookie` để xoá mà khác thuộc tính so với
 * lúc tạo sẽ nhắm vào một cookie KHÁC, trình duyệt giữ nguyên cookie cũ và người
 * dùng không đăng xuất được. Tách rời hai bộ thuộc tính thì lỗi này chắc chắn
 * xảy ra, chỉ là sớm hay muộn.
 *
 * `secure: isProduction` chứ không phải `true`: trình duyệt từ chối cookie
 * `Secure` trên `http://`. Chrome coi `http://localhost` là nguồn tin cậy và vẫn
 * nhận, nhưng Safari thì không — và kiểu hỏng là IM LẶNG: login trả 200 còn
 * /me trả 401 mãi mãi. Ở production nên dùng thêm tiền tố tên `__Host-`.
 */
const BASE_COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: isProduction,
  path: '/',
};

/** Đổi '15m' / '1h' / '7d' sang mili-giây cho `maxAge` của cookie. */
function ttlToMs(ttl: string): number {
  const match = /^(\d+)([smhd])$/.exec(ttl);
  if (!match?.[1] || !match[2]) {
    throw new Error(`JWT_ACCESS_TTL không hợp lệ: ${ttl}`);
  }
  const amount = Number(match[1]);
  const unit = match[2];
  const factor = unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
  return amount * factor;
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(env.AUTH_COOKIE_NAME, token, {
    ...BASE_COOKIE_OPTIONS,
    maxAge: ttlToMs(env.JWT_ACCESS_TTL),
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(env.AUTH_COOKIE_NAME, BASE_COOKIE_OPTIONS);
}
