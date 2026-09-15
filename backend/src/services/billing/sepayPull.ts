import { LATE_PAYMENT_WINDOW_HOURS } from '@bi/shared';
import type { RowDataPacket } from 'mysql2';

import { env } from '../../config/env';
import { mysqlPool } from '../../config/mysql';
import { confirmPayment } from './confirmPayment';
import { timMaDon } from './webhook';

/**
 * Tự đọc sao kê ngân hàng qua API của Sepay — §11.2.
 *
 * ═══ Vì sao có đường này khi đã có webhook ════════════════════════════════
 *
 * Webhook là Sepay gọi VÀO ta, nên nó đòi một URL công khai. Trên máy dev,
 * `localhost:4000` không có đường nào từ Internet tới — và hậu quả không phải
 * "kém tiện" mà là tính năng KHÔNG TỒN TẠI: khách quét mã, tiền về tài khoản
 * thật, đơn nằm `pending` cho tới khi có người bấm tay.
 *
 * Chiều KÉO thì máy nào cũng chạy được, kể cả sau NAT. Đổi lại là độ trễ: tiền
 * về được phát hiện ở lần quét kế tiếp chứ không phải tức thì.
 *
 * ═══ Hai đường, MỘT đích ══════════════════════════════════════════════════
 *
 * Cả hai gọi cùng `confirmPayment` và cùng dùng `id` giao dịch của Sepay làm
 * `provider_txn_ref`. Nhờ vậy chúng chống trùng LẪN NHAU qua
 * `uq_payment_txn_provider_ref`: bật cả hai cùng lúc thì cái nào tới trước ghi
 * nhận, cái sau đâm vào khoá UNIQUE và lặng lẽ dừng. Không có cờ nào phải bật,
 * không có ai phải nhớ tắt một bên.
 *
 * ⚠️ Đây là lý do KHÔNG được đổi sang `reference_number` làm khoá: đó là mã của
 * ngân hàng, còn webhook của Sepay gửi `id` của Sepay. Hai bên dùng hai khoá
 * khác nhau nghĩa là một khoản tiền được ghi nhận HAI LẦN.
 */

/** Chỉ lấy vài chục giao dịch gần nhất — quét thưa thì mới cần nhìn xa hơn. */
const LIMIT = 20;

/** Sepay dùng `Authorization: Bearer <token>` cho API đọc, không phải `Apikey`. */
const SEPAY_URL = `https://my.sepay.vn/userapi/transactions/list?limit=${String(LIMIT)}`;

interface SepayTxn {
  id: string;
  transaction_content: string | null;
  amount_in: string;
  reference_number: string | null;
  transaction_date: string | null;
}

interface KetQua {
  /** Số giao dịch đọc được từ Sepay. */
  doc: number;
  /** Số đơn vừa được ghi nhận thanh toán trong lần quét này. */
  apDung: number;
}

/**
 * Có đơn nào đáng đi tìm tiền không.
 *
 * Hỏi database TRƯỚC khi gọi Sepay, và đó là thứ khiến nhịp quét dày trở nên rẻ:
 * phần lớn thời gian không có đơn nào chờ, và khi đó lần quét tốn đúng một câu
 * SELECT theo chỉ mục thay vì một vòng HTTP ra Internet.
 *
 * ⚠️ Bao gồm cả `expired`, không chỉ `pending`. Bản đầu của hàm này chỉ nhìn hai
 * trạng thái còn sống, và nó tạo ra đúng một lỗ hổng mất tiền: khách chuyển
 * khoản lúc 17h05 cho đơn tạo lúc 16h50, đơn đã `expired`, con quét ngừng nhìn,
 * và khoản tiền đó nằm trong tài khoản mà không đơn nào nhận.
 *
 * Chặn theo HẠN MÃ QR, cửa sổ `LATE_PAYMENT_WINDOW_HOURS` lấy từ `@bi/shared`:
 * màn thanh toán của khách còn hỏi lại trạng thái đúng tới mốc đó, và hai phía
 * đọc chung một luật thì không bên nào ngừng nhìn trước bên kia. Đủ rộng cho
 * mọi kiểu chuyển khoản chậm, đủ hẹp để không quét cả lịch sử đơn hàng.
 *
 * `expires_at` chứ không `created_at`: cột này do Node ghi, so với đồng hồ Node;
 * còn `created_at` do MySQL tự điền, và đồng hồ của container MySQL trên máy dev
 * lệch với máy thật vài phút là chuyện đã đo được. Nó cũng khớp thẳng chỉ mục
 * `idx_orders_status_expires`.
 */
async function coDonDangCho(): Promise<boolean> {
  const [rows] = await mysqlPool.query<RowDataPacket[]>(
    `SELECT 1 FROM orders
      WHERE status IN ('pending', 'awaiting_confirmation', 'expired')
        AND expires_at > ?
      LIMIT 1`,
    [new Date(Date.now() - LATE_PAYMENT_WINDOW_HOURS * 3_600_000)],
  );
  return rows.length > 0;
}

/**
 * Một lần quét. Ném khi không gọi được Sepay — người gọi quyết định nuốt hay không.
 */
export async function quetSepay(): Promise<KetQua> {
  const token = env.SEPAY_API_TOKEN;
  if (token === undefined) return { doc: 0, apDung: 0 };
  if (!(await coDonDangCho())) return { doc: 0, apDung: 0 };

  const res = await fetch(SEPAY_URL, {
    headers: { Authorization: `Bearer ${token}` },
    // Không để treo vô hạn: một lần gọi kẹt sẽ giữ luôn vòng lặp, và triệu
    // chứng là "hệ thống ngừng nhận tiền" mà không có dòng log nào.
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(
      `Sepay trả ${String(res.status)}. ` +
        (res.status === 401
          ? 'SEPAY_API_TOKEN sai hoặc đã bị thu hồi.'
          : 'Kiểm lại kết nối mạng hoặc trạng thái dịch vụ.'),
    );
  }

  const body = (await res.json()) as { transactions?: SepayTxn[] };
  const list = body.transactions ?? [];

  let apDung = 0;
  for (const t of list) {
    /*
     * `amount_in` là CHUỖI thập phân ("2000.00"), không phải số.
     *
     * `Number('2000.00')` cho 2000 — đúng. Nhưng phải chặn nhánh 0: mọi giao
     * dịch CHUYỂN ĐI cũng nằm trong danh sách này với `amount_in = "0.00"`, và
     * nếu chúng lọt qua thì một lần chuyển khoản có ghi nhầm mã đơn trong nội
     * dung sẽ kích hoạt gói mà không ai trả tiền.
     */
    const vao = Number(t.amount_in);
    if (!Number.isFinite(vao) || vao <= 0) continue;

    const maDon = timMaDon(t.transaction_content);
    if (maDon === null) continue;

    try {
      const r = await confirmPayment({
        orderCode: maDon,
        // Số tiền phải là SỐ NGUYÊN đồng. Ngân hàng Việt Nam không có phần lẻ,
        // nhưng chuỗi vẫn mang ".00" nên vẫn phải cắt tường minh.
        amountVnd: Math.round(vao),
        providerTxnRef: String(t.id),
        source: 'webhook',
        rawPayload: t,
        occurredAt: gioSepay(t.transaction_date),
        // Không có người thực hiện — nhật ký ghi `actor_user_id = NULL`, và đó
        // là sự thật chứ không phải thiếu dữ liệu.
        actor: { actorUserId: null, actorEmail: null, actorPlatformRole: null },
      });
      /*
       * Chỉ đếm khoản MỚI ghi nhận. Danh sách này chứa mọi giao dịch gần đây, nên
       * khoản của lần quét trước quay lại ở MỖI vòng — `confirmPayment` trả
       * `alreadyProcessed` cho chúng chứ không ném. Đếm cả chúng thì còn một đơn
       * nào đang chờ là log "đã tự ghi nhận" lặp lại mỗi 5 giây cho một khoản cũ.
       */
      if (!r.alreadyProcessed) apDung += 1;
    } catch (err) {
      /*
       * Không kéo theo những giao dịch khác trong cùng lô — nhưng cũng KHÔNG
       * nuốt im. Tới được đây là lỗi thật: mã đơn không có trong database này
       * (hai máy dev dùng chung một tài khoản ngân hàng), đơn đã huỷ, mã tham
       * chiếu đã thuộc đơn khác, hoặc MySQL hỏng. Nuốt im nghĩa là khách đã
       * chuyển tiền, đơn đứng `pending`, và không một dòng log nào nói vì sao.
       *
       * Báo MỘT lần cho mỗi cặp (giao dịch, lỗi): giao dịch đó quay lại mỗi 5
       * giây, và cùng một câu lặp 720 lần mỗi giờ thì chôn mất mọi log khác.
       */
      baoLoiMotLan(String(t.id), maDon, err);
    }
  }

  return { doc: list.length, apDung };
}

/**
 * `transaction_date` của Sepay là GIỜ VIỆT NAM không kèm múi giờ: `"2026-09-15 10:58:00"`.
 *
 * `new Date()` đọc chuỗi dạng đó theo múi giờ của MÁY CHẠY. Trên máy dev ở Việt
 * Nam thì tình cờ đúng; lên một server chạy UTC thì mọi `occurred_at` lệch 7
 * tiếng, lặng lẽ — sao kê ghi 10:58 mà hệ thống ghi 17:58.
 *
 * Hình dạng lạ thì trả `null` (cột cho phép) thay vì đoán: một mốc thời gian sai
 * trong sổ đối soát tệ hơn một ô trống.
 */
export function gioSepay(raw: string | null): Date | null {
  if (raw === null || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw.replace(' ', 'T')}+07:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

const daBao = new Set<string>();

function baoLoiMotLan(txnId: string, maDon: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  const key = `${txnId}|${message}`;
  if (daBao.has(key)) return;
  // Trần cho một tiến trình sống nhiều tuần. Xoá sạch thì tệ nhất là báo lại
  // một lần những lỗi còn đó — chấp nhận được.
  if (daBao.size >= 1_000) daBao.clear();
  daBao.add(key);
  console.warn(
    `[billing] Sepay: giao dịch ${txnId} ghi mã ${maDon} nhưng không ghi nhận được — ${message}`,
  );
}
