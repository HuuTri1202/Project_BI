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
 * Bao lâu sau khi tạo đơn thì vẫn còn đi tìm tiền cho nó.
 *
 * Đơn hết hiệu lực sau 15 phút, nhưng đó chỉ là hạn của MÃ QR. Tiền thì vẫn về
 * sau đó — chuyển khoản liên ngân hàng ngoài giờ, hoặc khách quét mã rồi đi ăn
 * trưa mới bấm xác nhận. `confirmPayment` CỐ Ý chấp nhận đơn `expired` vì lý do
 * đó, và nếu con quét này ngừng nhìn sau 15 phút thì sự cho phép đó thành vô
 * nghĩa: tiền về, không ai đi lấy, khách mất tiền.
 */
const CUA_SO_GIO = 24;

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
 * Chặn theo THỜI GIAN TẠO thay vì theo trạng thái: 24 giờ đủ rộng cho mọi kiểu
 * chuyển khoản chậm, và đủ hẹp để câu SELECT không quét cả lịch sử đơn hàng.
 */
async function coDonDangCho(): Promise<boolean> {
  const [rows] = await mysqlPool.query<RowDataPacket[]>(
    `SELECT 1 FROM orders
      WHERE status IN ('pending', 'awaiting_confirmation', 'expired')
        AND created_at > NOW() - INTERVAL ? HOUR
      LIMIT 1`,
    [CUA_SO_GIO],
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
      await confirmPayment({
        orderCode: maDon,
        // Số tiền phải là SỐ NGUYÊN đồng. Ngân hàng Việt Nam không có phần lẻ,
        // nhưng chuỗi vẫn mang ".00" nên vẫn phải cắt tường minh.
        amountVnd: Math.round(vao),
        providerTxnRef: String(t.id),
        source: 'webhook',
        rawPayload: t,
        occurredAt: t.transaction_date === null ? null : new Date(t.transaction_date),
        // Không có người thực hiện — nhật ký ghi `actor_user_id = NULL`, và đó
        // là sự thật chứ không phải thiếu dữ liệu.
        actor: { actorUserId: null, actorEmail: null, actorPlatformRole: null },
      });
      apDung += 1;
    } catch {
      /*
       * Nuốt và đi tiếp. Danh sách này chứa MỌI giao dịch gần đây, phần lớn đã
       * được ghi nhận từ lần quét trước — chúng đâm vào khoá UNIQUE và ném ở đây
       * mỗi vòng. Đó là hoạt động BÌNH THƯỜNG, không phải lỗi, nên không log.
       *
       * Lỗi thật (đơn không tồn tại, đơn đã huỷ) cũng không được kéo theo những
       * giao dịch khác trong cùng lô.
       */
    }
  }

  return { doc: list.length, apDung };
}
