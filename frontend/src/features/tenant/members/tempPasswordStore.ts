import type { AdminUserDto } from '@bi/shared';

/**
 * Giữ mật khẩu tạm vừa cấp qua các lần chuyển trang và F5.
 *
 * ─── Vấn đề ────────────────────────────────────────────────────────────────
 *
 * Trước file này, mật khẩu tạm chỉ sống trong `useState` của `MembersPage`. Nó
 * biến mất khi: bấm sang mục khác ở sidebar, F5, bấm nhầm nút đóng, hoặc trình
 * duyệt khôi phục tab. Nghĩa là đúng một cú chuột vô ý là mất bản sao DUY NHẤT
 * của mật khẩu, và người vừa được tạo tài khoản không đăng nhập được.
 *
 * ─── Đánh đổi, nói thẳng ───────────────────────────────────────────────────
 *
 * Ghi một mật khẩu ở dạng đọc được vào bộ nhớ trình duyệt không phải chuyện
 * nhẹ nhàng. Ba thứ giữ nó trong vòng chấp nhận được:
 *
 *   sessionStorage, không phải localStorage  chết theo tab, không sống qua ngày
 *   khoá kèm id người đang đăng nhập         admin khác đăng nhập cùng tab
 *                                            KHÔNG đọc được của người trước
 *   hạn 30 phút                              để quên thì nó tự dọn
 *
 * Và quan trọng nhất: nó chỉ là mật khẩu TẠM, dùng một lần rồi bị
 * `must_change_password` buộc đổi. Trước đó nó đã nằm nguyên trên màn hình cho
 * tới khi admin tự bấm đóng, nên bề mặt rủi ro không rộng thêm — chỉ là bây giờ
 * nó không còn bốc hơi vì một lần F5.
 *
 * Mọi lời gọi đều bọc try/catch: chế độ riêng tư của Safari làm `sessionStorage`
 * NÉM LỖI chứ không trả null, và mất chỗ ghi nhớ thì không đáng để cả trang
 * trắng màn hình.
 */

/** Ba cách một mật khẩu tạm xuất hiện trên màn hình. */
export type TempPasswordIssue =
  | { kind: 'created'; user: AdminUserDto; tempPassword: string }
  | { kind: 'reset'; user: AdminUserDto; tempPassword: string }
  /** Gắn tài khoản có sẵn vào tổ chức — không có mật khẩu nào được cấp. */
  | { kind: 'attached'; user: AdminUserDto };

const PREFIX = 'bi.temp-password';

/**
 * 30 phút. Đủ dài cho "tạo xong rồi đi họp mất mười lăm phút", đủ ngắn để không
 * còn nằm đó vào sáng hôm sau. Hết hạn cũng không mất gì nữa: đã có nút cấp lại.
 */
const TTL_MS = 30 * 60 * 1000;

interface StoredIssue {
  issue: TempPasswordIssue;
  expiresAt: number;
}

/**
 * Khoá gắn CẢ tổ chức LẪN người đang đăng nhập.
 *
 * Thiếu `actorUserId`: admin A tạo tài khoản rồi đăng xuất, admin B đăng nhập
 * trên cùng tab và thấy ngay mật khẩu A vừa cấp. Thiếu `tenantId`: đổi tổ chức
 * (§5) sẽ mang bảng của tổ chức cũ sang.
 */
function keyFor(tenantId: number, actorUserId: number): string {
  return `${PREFIX}.${tenantId}.${actorUserId}`;
}

export function readIssue(tenantId: number, actorUserId: number): TempPasswordIssue | null {
  try {
    const raw = window.sessionStorage.getItem(keyFor(tenantId, actorUserId));
    if (raw === null) return null;

    const parsed = JSON.parse(raw) as StoredIssue;
    if (typeof parsed?.expiresAt !== 'number' || Date.now() > parsed.expiresAt) {
      forgetIssue(tenantId, actorUserId);
      return null;
    }
    return parsed.issue;
  } catch {
    // JSON hỏng hoặc storage không đọc được — coi như chưa có gì.
    return null;
  }
}

export function rememberIssue(
  tenantId: number,
  actorUserId: number,
  issue: TempPasswordIssue,
): void {
  try {
    const payload: StoredIssue = { issue, expiresAt: Date.now() + TTL_MS };
    window.sessionStorage.setItem(keyFor(tenantId, actorUserId), JSON.stringify(payload));
  } catch {
    // Không ghi nhớ được thì bảng vẫn hiện bình thường trong lần render này,
    // chỉ là F5 sẽ mất. Nút cấp lại vẫn là lối thoát.
  }
}

export function forgetIssue(tenantId: number, actorUserId: number): void {
  try {
    window.sessionStorage.removeItem(keyFor(tenantId, actorUserId));
  } catch {
    // Không có gì để làm.
  }
}
