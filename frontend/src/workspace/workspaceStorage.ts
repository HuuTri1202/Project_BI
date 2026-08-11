/**
 * Ghi nhớ workspace đang mở (§4.6).
 *
 * ─── Vì sao khoá lưu phải kèm `tenantId` ────────────────────────────────────
 *
 * Một người làm ở hai công ty sẽ có hai bộ workspace với hai dải id riêng. Dùng
 * chung một khoá `bi.workspace` thì đăng nhập vào công ty B sẽ mang theo id của
 * công ty A — id đó hoặc không tồn tại (rơi về mặc định, khó chịu nhưng vô hại),
 * hoặc TÌNH CỜ trùng với một workspace có thật của công ty B, và khi đó người
 * dùng mở nhầm workspace mà không hề biết. Khoá theo tenant khiến chuyện đó
 * không xảy ra được.
 *
 * ─── Vì sao localStorage chứ không phải URL ─────────────────────────────────
 *
 * §4.6 yêu cầu "ghi nhớ workspace đang mở", không phải "chia sẻ được". Đánh đổi
 * đã biết: link `/home` gửi cho đồng nghiệp sẽ mở ở workspace của họ chứ không
 * phải của bạn. Muốn đổi thì đưa `?ws=` vào URL và đọc nó ở `WorkspaceProvider`,
 * không phải sửa gì thêm.
 *
 * Mọi lời gọi đều bọc try/catch: chế độ riêng tư của Safari và một số cấu hình
 * chặn cookie làm `localStorage` NÉM LỖI chứ không phải trả null. Không bọc thì
 * cả ứng dụng trắng màn hình chỉ vì không ghi nhớ được một con số.
 */

const PREFIX = 'bi.workspace';

function keyFor(tenantId: number): string {
  return `${PREFIX}.${tenantId}`;
}

export function readRememberedWorkspace(tenantId: number): number | null {
  try {
    const raw = window.localStorage.getItem(keyFor(tenantId));
    if (raw === null) return null;
    const parsed = Number(raw);
    // `Number('')` là 0 và `Number('abc')` là NaN — cả hai đều không phải id hợp
    // lệ. Trả null để nơi gọi rơi về workspace mặc định thay vì gửi `?workspaceId=0`
    // lên server rồi nhận 404.
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

export function rememberWorkspace(tenantId: number, workspaceId: number): void {
  try {
    window.localStorage.setItem(keyFor(tenantId), String(workspaceId));
  } catch {
    // Không ghi nhớ được thì phiên này vẫn dùng bình thường, chỉ là lần sau mở
    // lại sẽ về workspace mặc định.
  }
}

export function forgetWorkspace(tenantId: number): void {
  try {
    window.localStorage.removeItem(keyFor(tenantId));
  } catch {
    // Không có gì để làm.
  }
}
