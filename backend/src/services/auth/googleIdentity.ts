import { createRemoteJWKSet, errors as joseErrors, jwtVerify } from 'jose';

import { env } from '../../config/env';
import { HttpError } from '../../utils/httpError';

/**
 * Xác minh ID token của Google — §1.9.
 *
 * ═══ Vì sao KHÔNG tự viết phần này ══════════════════════════════════════════
 *
 * "Kiểm một JWT" nghe như ba dòng, và với token do chính ta ký thì đúng là ba
 * dòng (`services/auth/token.ts`). Token của Google thì khác về bản chất: ta
 * không giữ khoá. Phải tải bộ khoá công khai của Google, chọn đúng khoá theo
 * `kid`, cache nó lại, và xử lý việc Google XOAY khoá vài tuần một lần — tải
 * lại đúng lúc gặp `kid` lạ, mà không mở cửa cho ai đó ép ta tải liên tục.
 *
 * Viết sai một trong mấy việc đó thì hoặc hệ thống chết lúc Google xoay khoá,
 * hoặc nó nhận một token không ai ký. `jose` làm sẵn cả cụm và không kéo theo
 * gói phụ thuộc nào — đây là lý do duy nhất một dependency mới được thêm vào.
 *
 * ═══ Bốn điều phải kiểm, thiếu một là thủng ═════════════════════════════════
 *
 *   chữ ký   token do CHÍNH Google ký, bằng khoá đang còn hiệu lực
 *   `aud`    token cấp cho ỨNG DỤNG NÀY. Thiếu nó thì một token Google hợp lệ
 *            cấp cho bất kỳ ứng dụng nào khác cũng đăng nhập được vào đây —
 *            lỗ nổi tiếng nhất của đăng nhập bằng ID token.
 *   `iss`    đúng Google, không phải một nhà phát hành khác.
 *   `exp`    `jwtVerify` kiểm sẵn.
 *
 * `algorithms: ['RS256']` khai tường minh, cùng lý do đã ghi ở `token.ts`:
 * không chốt thuật toán thì `alg: none` có đường đi vào.
 *
 * ═══ `email_verified` là chốt chống chiếm tài khoản ═════════════════════════
 *
 * Hệ thống TỰ LIÊN KẾT một tài khoản Google với tài khoản mật khẩu cùng email
 * (quyết định đã chốt). Điều đó chỉ an toàn chừng nào Google đã chứng minh
 * người này thật sự kiểm soát hộp thư đó. Với tài khoản Google Workspace do
 * quản trị viên tạo thủ công, `email_verified` có thể là `false` — và khi ấy
 * tự liên kết là trao tài khoản cho người chỉ cần khai một địa chỉ.
 *
 * Nên cờ này được trả về nguyên vẹn, và nơi gọi BẮT BUỘC phải từ chối khi nó
 * sai. Không có ngoại lệ nào, kể cả cho tên miền "tin được".
 */

/** Hai dạng `iss` Google dùng — cả hai đều hợp lệ và đều gặp trong thực tế. */
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

const JWKS_URL = new URL('https://www.googleapis.com/oauth2/v3/certs');

/**
 * Tạo MỘT lần rồi dùng lại — `createRemoteJWKSet` giữ cache bên trong nó.
 *
 * Dựng lại ở mỗi lần đăng nhập là ném cache đi, và biến mỗi lần bấm nút thành
 * một lượt gọi ra ngoài Internet trong đường xác thực.
 */
let boKhoa: ReturnType<typeof createRemoteJWKSet> | null = null;

function khoaGoogle(): ReturnType<typeof createRemoteJWKSet> {
  boKhoa ??= createRemoteJWKSet(JWKS_URL);
  return boKhoa;
}

/** Chỉ dùng trong test — quên bộ khoá đã cache. */
export function quenBoKhoa(): void {
  boKhoa = null;
}

export interface DanhTinhGoogle {
  /** `sub` — định danh Google cấp, KHÔNG BAO GIỜ đổi. Đây là khoá tra cứu. */
  sub: string;
  email: string;
  emailVerified: boolean;
  fullName: string | null;
}

/** Tính năng chỉ bật khi có `GOOGLE_CLIENT_ID` — cùng khuôn với lớp LLM. */
export function coCauHinhGoogle(): boolean {
  return env.GOOGLE_CLIENT_ID !== undefined;
}

const TOKEN_HONG = 'Đăng nhập Google không thành công. Vui lòng thử lại.';

export async function xacMinhGoogle(credential: string): Promise<DanhTinhGoogle> {
  const clientId = env.GOOGLE_CLIENT_ID;
  if (clientId === undefined) {
    throw new HttpError(
      503,
      'GoogleNotConfigured',
      'Đăng nhập bằng Google chưa được bật trên hệ thống này.',
    );
  }

  let payload;
  try {
    ({ payload } = await jwtVerify(credential, khoaGoogle(), {
      algorithms: ['RS256'],
      audience: clientId,
      issuer: GOOGLE_ISSUERS,
    }));
  } catch (err) {
    /*
     * Token sai/hết hạn là chuyện BÌNH THƯỜNG — không log như lỗi hệ thống.
     * Nhưng không với tới được Google thì phải phân biệt: đó là sự cố của ta,
     * và trả 401 cho nó sẽ khiến người dùng đi đổi mật khẩu vì một mạng hỏng.
     */
    const laTokenSai =
      err instanceof joseErrors.JOSEError && !(err instanceof joseErrors.JWKSNoMatchingKey);
    if (!laTokenSai) {
      console.error('[google] không xác minh được ID token:', err);
      throw new HttpError(
        503,
        'GoogleUnavailable',
        'Chưa kết nối được tới Google. Vui lòng thử lại sau.',
      );
    }
    throw new HttpError(401, 'InvalidGoogleToken', TOKEN_HONG);
  }

  const sub = payload.sub;
  const email = typeof payload['email'] === 'string' ? payload['email'].toLowerCase() : null;
  if (sub === undefined || email === null) {
    throw new HttpError(401, 'InvalidGoogleToken', TOKEN_HONG);
  }

  return {
    sub,
    email,
    // `=== true` chứ không ép kiểu: Google trả về boolean, nhưng một giá trị lạ
    // (chuỗi "false", thiếu hẳn trường) phải rơi về phía KHÔNG tin.
    emailVerified: payload['email_verified'] === true,
    fullName: typeof payload['name'] === 'string' ? payload['name'] : null,
  };
}
