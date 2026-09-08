import { isTest } from '../../config/env';
import { mysqlPool } from '../../config/mysql';
import * as billingRepo from '../../repositories/billing';

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

let timer: NodeJS.Timeout | undefined;
let stopping = false;
let running: Promise<void> | undefined;

export function startBillingRunner(): void {
  if (isTest) return;
  stopping = false;
  schedule(0);
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
  await running;
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
