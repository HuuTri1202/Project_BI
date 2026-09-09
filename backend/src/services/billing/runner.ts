import { env, isTest } from '../../config/env';
import { mysqlPool } from '../../config/mysql';
import * as billingRepo from '../../repositories/billing';
import { quetSepay } from './sepayPull';

/**
 * Vòng lặp nền của §11 — cho hết hạn những đơn quá giờ.
 *
 * ═══ Vì sao cần vòng lặp khi ĐÃ CÓ kiểm lười lúc đọc ══════════════════════
 *
 * Mọi route đọc đơn đều gọi `expireOverdueOrders` trước — nhờ vậy một đơn vừa
 * quá hạn ba giây không hiện "đang chờ thanh toán". Nhưng kiểm lười chỉ chạm
 * tới đơn CÓ NGƯỜI MỞ. Đơn không ai quay lại xem sẽ nằm `pending` vĩnh viễn, và
 * hai thứ hỏng theo:
 *
 *   · thống kê tỉ lệ chuyển đổi đếm chúng như đơn đang chờ
 *   · `findLivePendingOrder` thấy chúng còn sống nên từ chối tạo đơn mới cho
 *     cùng một gói — khách bị kẹt vì một đơn họ đã bỏ từ lâu
 *
 * Cần cả hai, và mỗi cái lo một nửa.
 *
 * ═══ Khuôn giống hệt `services/ingest/runner.ts`, và cố ý ═════════════════
 *
 * `setTimeout` NỐI TIẾP chứ không `setInterval`: `setInterval` bắn theo đồng hồ
 * bất kể lần trước xong chưa, nên một câu UPDATE chậm sẽ tích lại nhiều lần gọi
 * chồng lên nhau rồi bung ra cùng lúc. Ở đây câu lệnh nhẹ nên rủi ro thấp,
 * nhưng dùng một khuôn khác cho một việc cùng loại là cách người đọc sau tưởng
 * hai chỗ khác nhau về bản chất.
 *
 * ⚠️ KHÔNG chạy trong test — cùng lý do đã ghi ở runner của §9: một vòng lặp
 * chạy song song sẽ đổi trạng thái đơn mà bài test vừa dựng, và bài đó sẽ đỏ
 * hoặc xanh tuỳ tốc độ máy.
 */

/**
 * Năm phút, theo đúng đề bài.
 *
 * Thưa hơn nhiều so với 2 giây của §9, và đó là đúng: §9 chờ một job người dùng
 * đang nhìn màn hình đợi, còn ở đây không ai đợi — người dùng đã có kiểm lười
 * lo phần họ nhìn thấy.
 */
const POLL_MS = 5 * 60_000;

/**
 * Nhịp hỏi Sepay — 5 giây, DÀY hơn hẳn vòng dọn đơn hết hạn.
 *
 * Hai vòng, hai nhịp, vì chúng phục vụ hai loại người: dọn đơn quá hạn thì không
 * ai ngồi đợi, còn ở đây có một khách vừa chuyển tiền xong đang nhìn màn hình.
 * Năm phút cho việc đó là quá lâu — họ sẽ đi mở ticket trước khi vòng lặp chạy.
 *
 * 5 giây rẻ vì `quetSepay` hỏi DATABASE trước: không có đơn nào đang chờ thì nó
 * về ngay, không đụng tới mạng. Chỉ khi thật sự có người đang chờ tiền thì mới
 * có một request ra Internet — và lúc đó nó đáng.
 *
 * ⚠️ Đây là nhịp của PHẦN TA LÀM CHỦ. Độ trễ khách thấy còn cộng thêm thời gian
 * Sepay đọc được giao dịch từ ngân hàng, thứ nằm ngoài tầm với và thường lớn hơn
 * con số này. Rút xuống nữa không mua thêm được gì đáng kể mà chỉ đến gần giới
 * hạn nhịp gọi của Sepay hơn.
 */
const SEPAY_MS = 5_000;

/**
 * Trần khi LÙI NHỊP vì Sepay lỗi.
 *
 * Bắt buộc phải có khi nhịp cơ bản dày: nếu Sepay chặn vì gọi quá nhanh (429)
 * hoặc đang trục trặc, một vòng lặp 5 giây cứng đầu sẽ gõ cửa 720 lần mỗi giờ —
 * cách chắc chắn nhất để bị chặn lâu hơn. Gấp đôi sau mỗi lần hỏng, về lại 5
 * giây ngay khi gọi được.
 */
const SEPAY_MS_MAX = 60_000;
let sepayDelay = SEPAY_MS;

let timer: NodeJS.Timeout | undefined;
let sepayTimer: NodeJS.Timeout | undefined;
let stopping = false;
let running: Promise<void> | undefined;
let sepayRunning: Promise<void> | undefined;

export function startBillingRunner(): void {
  if (isTest) return;
  stopping = false;
  schedule(0);

  /*
   * Vòng Sepay chỉ bật khi CÓ token.
   *
   * Không có token thì mọi lần gọi đều 401, và một vòng lặp gõ cửa Sepay bốn lần
   * mỗi phút để nhận 401 vừa vô ích vừa sinh ra một dòng log lỗi mỗi 15 giây —
   * đủ để chôn vùi mọi log thật khác.
   */
  if (env.SEPAY_API_TOKEN !== undefined) {
    sepayDelay = SEPAY_MS;
    console.log('[billing] tự đọc sao kê Sepay: BẬT, quét mỗi 5 giây khi có đơn đang chờ');
    scheduleSepay(0);
  }
}

/**
 * Dừng có trật tự.
 *
 * Phải gọi TRƯỚC `closeMysql()`: vòng lặp đang giữ connection từ chính pool đó,
 * và đóng pool trước là cắt ngang nó — một lần dừng êm biến thành một dòng log
 * "Pool is closed" không nói gì về chuyện thật sự xảy ra.
 */
export async function stopBillingRunner(): Promise<void> {
  stopping = true;
  if (timer !== undefined) {
    clearTimeout(timer);
    timer = undefined;
  }
  if (sepayTimer !== undefined) {
    clearTimeout(sepayTimer);
    sepayTimer = undefined;
  }
  await running;
  await sepayRunning;
}

function scheduleSepay(delay: number): void {
  if (stopping) return;
  sepayTimer = setTimeout(() => {
    // Lịch lần sau đặt TRONG `finally`, sau khi `tickSepay` đã kịp đổi
    // `sepayDelay` — đọc trước thì lần lùi nhịp đầu tiên không có tác dụng.
    sepayRunning = tickSepay().finally(() => {
      scheduleSepay(sepayDelay);
    });
  }, delay);
}

async function tickSepay(): Promise<void> {
  try {
    const { apDung } = await quetSepay();
    sepayDelay = SEPAY_MS;
    // Chỉ log khi CÓ chuyện xảy ra. Một dòng "đã quét, 0 giao dịch" mỗi 5 giây
    // là 17.280 dòng mỗi ngày che mất mọi thứ đáng đọc.
    if (apDung > 0) {
      console.log(`[billing] Sepay: đã tự ghi nhận ${String(apDung)} khoản tiền về`);
    }
  } catch (err) {
    /*
     * Nuốt rồi đi tiếp, cùng lý do với vòng trên: một lần Sepay chậm hoặc mạng
     * chập không được phép giết tiến trình đang phục vụ người dùng.
     *
     * Nhưng KHÔNG giữ nguyên nhịp: hỏng thường không tự khỏi trong 5 giây, và
     * gọi lại ngay chỉ làm mọi thứ tệ hơn nếu nguyên nhân là bị chặn vì gọi quá
     * nhanh. Gấp đôi tới trần, rồi về 5 giây ngay lần gọi được đầu tiên.
     */
    sepayDelay = Math.min(sepayDelay * 2, SEPAY_MS_MAX);
    console.error(
      `[billing] hỏi Sepay thất bại (lùi nhịp còn ${String(Math.round(sepayDelay / 1000))}s):`,
      err instanceof Error ? err.message : err,
    );
  }
}

function schedule(delay: number): void {
  if (stopping) return;
  timer = setTimeout(() => {
    running = tick().finally(() => {
      schedule(POLL_MS);
    });
  }, delay);
}

async function tick(): Promise<void> {
  try {
    // Không truyền `tenantId` — quét TOÀN hệ thống. Câu lệnh dùng
    // `idx_orders_status_expires` nên nó là một lần dò chỉ mục, và gần như luôn
    // khớp 0 dòng.
    const n = await billingRepo.expireOverdueOrders(mysqlPool, new Date());
    if (n > 0) console.log(`[billing] đã cho hết hạn ${String(n)} đơn quá giờ`);
  } catch (err) {
    /*
     * Nuốt lỗi rồi đi tiếp, KHÔNG để nó thoát ra.
     *
     * Một lỗi thoát khỏi đây sẽ thành `unhandledRejection` và giết cả tiến
     * trình — tức là một trục trặc MySQL thoáng qua làm sập máy chủ đang phục
     * vụ người dùng, vì một việc dọn dẹp có thể đợi năm phút nữa.
     */
    console.error('[billing] lượt quét đơn hết hạn thất bại:', err);
  }
}
