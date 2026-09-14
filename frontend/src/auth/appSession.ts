import { clearSnapshots } from '../services/querySnapshots';
import { clearToken } from './tokenStorage';

/**
 * Phiên đăng nhập sống đúng bằng thời gian APP còn mở trong trình duyệt.
 *
 * ═══ Vấn đề nó giải ═════════════════════════════════════════════════════════
 *
 * Token nằm ở `localStorage` (quyết định số 3, README › Xác thực), mà
 * `localStorage` sống qua cả lần đóng trình duyệt. Token lại có hạn 7 ngày
 * (`JWT_EXPIRES_IN`). Cộng hai thứ đó: đóng trình duyệt tối nay, sáng mai mở
 * lên là vào thẳng trang chủ, không ai phải gõ mật khẩu. Trên máy dùng chung,
 * người ngồi sau vào thẳng tài khoản của người ngồi trước.
 *
 * ═══ Luật ═══════════════════════════════════════════════════════════════════
 *
 * Lúc một tab khởi động app, token trên đĩa được GIỮ khi và chỉ khi:
 *
 *   1. CHÍNH tab này đã chạy app trước đó — có dấu trong `sessionStorage`.
 *      Đó là F5, là bấm Back từ một trang ngoài quay về. `sessionStorage` sống
 *      qua lần tải lại và chết theo tab, đúng theo định nghĩa của nó.
 *   2. HOẶC một tab KHÁC đang mở app ngay lúc này — đang giữ khoá Web Locks.
 *      Đó là Ctrl+bấm một báo cáo để mở sang tab mới.
 *
 * Không rơi vào cả hai nghĩa là app đã đóng hẳn từ lần trước: xoá token, và
 * trang đăng nhập hiện ra.
 *
 * ═══ Vì sao là khoá, không phải hỏi nhau qua BroadcastChannel ══════════════
 *
 * Hỏi "còn tab nào mở không?" rồi đợi trả lời thì phải chọn một thời gian chờ,
 * và không có con số nào đúng: tab nền bị trình duyệt đóng băng thì không trả
 * lời kịp, còn chờ lâu thì LẦN MỞ APP NÀO cũng chậm đúng chừng ấy — kể cả lần
 * phổ biến nhất là không có tab nào khác. Khoá thì trình duyệt tự nhả khi tab
 * đóng, cả khi tab chết đột ngột, và `query()` trả lời ngay. Không có gì để đoán.
 *
 * ⚠️ HỎI trước, rồi mới GIỮ khoá. Đảo lại thì tab thấy chính mình đang giữ
 * khoá, và không bao giờ đăng xuất ai.
 *
 * ⚠️ F5 KHÔNG dựa được vào khoá: trang cũ nhả khoá trước khi trang mới kịp hỏi.
 * Đó là lý do luật 1 phải tồn tại.
 *
 * ═══ Giới hạn, ghi ra chứ không giấu ════════════════════════════════════════
 *
 * - Trình duyệt bật "Tiếp tục từ nơi bạn đã dừng" khôi phục cả tab LẪN
 *   `sessionStorage` của tab đó. Với luật 1, lần mở lại ấy là một lần F5.
 * - Web Locks chỉ có trong ngữ cảnh bảo mật (HTTPS hoặc localhost). Chạy qua
 *   HTTP trên một địa chỉ IP thì luật 2 mất, tab mới phải đăng nhập lại. Hỏng
 *   theo hướng CHẶT hơn, không phải lỏng hơn.
 * - Token cũ vẫn nằm trên đĩa từ lúc đóng app tới lần mở kế tiếp. Thứ này sửa
 *   việc app TỰ vào tài khoản, không phải việc token bị trộm từ ổ cứng — cái
 *   đó là việc của thu hồi token phía server (README › Những gì CHƯA có).
 */

/** Dấu "tab này đã chạy app" trong `sessionStorage`. */
const TAB_MARK = 'bi.app.tab';

/** Khoá mọi tab đang mở app cùng giữ (chế độ `shared`). */
const ALIVE_LOCK = 'bi.app.alive';

type TabStore = Pick<Storage, 'getItem' | 'setItem'>;
type Locks = Pick<LockManager, 'query' | 'request'>;

export interface AppSessionEnv {
  /** `sessionStorage` của tab; `null` khi trình duyệt chặn hẳn. */
  tab: TabStore | null;
  /** `navigator.locks`; `null` ngoài ngữ cảnh bảo mật. */
  locks: Locks | null;
}

/**
 * `resumed` — luật 1 (F5); `joined` — luật 2 (tab mới khi app đang mở);
 * `fresh` — app đã đóng hẳn, phiên cũ vừa bị xoá.
 */
export type AppSessionStart = 'resumed' | 'joined' | 'fresh';

/**
 * Chạy ĐÚNG MỘT LẦN, TRƯỚC lần render đầu tiên (`main.tsx`).
 *
 * Không bao giờ reject: `main.tsx` chỉ render sau khi nó xong, nên một lỗi lọt
 * ra ngoài ở đây là một trang trắng.
 */
export async function beginAppSession(env: AppSessionEnv = browserEnv()): Promise<AppSessionStart> {
  const start: AppSessionStart = hasMark(env.tab)
    ? 'resumed'
    : (await otherTabAlive(env.locks))
      ? 'joined'
      : 'fresh';

  if (start === 'fresh') {
    clearToken();
    // Cùng lý do `clearSession` trong AuthProvider xoá nó: ảnh chụp số liệu
    // không gắn với tài khoản nào, và người đăng nhập kế tiếp có thể là người
    // khác. Lần này còn cần hơn, vì phiên cũ kết thúc mà không ai bấm đăng xuất.
    clearSnapshots();
  }

  setMark(env.tab);
  holdAlive(env.locks);
  return start;
}

function browserEnv(): AppSessionEnv {
  let tab: TabStore | null;
  try {
    tab = window.sessionStorage;
  } catch {
    tab = null;
  }
  return { tab, locks: 'locks' in navigator ? navigator.locks : null };
}

function hasMark(tab: TabStore | null): boolean {
  try {
    return tab?.getItem(TAB_MARK) === '1';
  } catch {
    return false;
  }
}

function setMark(tab: TabStore | null): void {
  try {
    tab?.setItem(TAB_MARK, '1');
  } catch {
    // Không ghi được thì F5 kế tiếp bị coi là mở mới. Chặn `sessionStorage`
    // thì `localStorage` cũng bị chặn, nên đằng nào token cũng không qua được F5.
  }
}

async function otherTabAlive(locks: Locks | null): Promise<boolean> {
  if (locks === null) return false;
  try {
    const { held = [] } = await locks.query();
    return held.some((lock) => lock.name === ALIVE_LOCK);
  } catch {
    return false;
  }
}

function holdAlive(locks: Locks | null): void {
  if (locks === null) return;
  try {
    // Hàm trả về một promise không bao giờ xong: khoá được giữ tới lúc tab đóng.
    locks
      .request(ALIVE_LOCK, { mode: 'shared' }, () => new Promise<never>(() => {}))
      .catch(() => {});
  } catch {
    /* không giữ được khoá thì tab mới mở từ đây phải đăng nhập lại — chặt hơn, không lỏng hơn */
  }
}
