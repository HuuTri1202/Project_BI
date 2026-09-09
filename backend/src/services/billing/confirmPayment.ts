import { BILLING_ERROR_CODES, type PaymentProvider } from '@bi/shared';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

import { withTransaction } from '../../db/tx';
import type { Db } from '../../repositories/db';
import { HttpError } from '../../utils/httpError';
import { AUDIT_ACTIONS, writeAudit, type AuditEntry } from '../audit/log';
import { tinhChuKy } from './period';

/**
 * Ghi nhận một khoản tiền đã về — §11.
 *
 * ═══ MỘT đường duy nhất cho cả webhook lẫn xác nhận tay ════════════════════
 *
 * Hai lối vào (`POST /api/webhooks/:provider` và `POST /admin/billing/orders/
 * :code/confirm`) gọi CÙNG hàm này. Đó là điều kiện để bất biến "một đơn chỉ
 * được trả tiền một lần" có nghĩa: viết hai đường riêng nghĩa là hai bản kiểm
 * tra, và chúng sẽ lệch nhau ở lần sửa đầu tiên.
 *
 * ═══ Idempotent, và do DATABASE cưỡng chế ═════════════════════════════════
 *
 * Hàm này KHÔNG hỏi "đơn đã trả chưa" rồi mới ghi. Giữa câu hỏi và câu ghi luôn
 * có khe hở cho một request thứ hai đi qua — và với thanh toán thì hai request
 * đồng thời là chuyện bình thường, không phải giả định: webhook thử lại trong
 * khi quản trị viên cũng đang bấm xác nhận.
 *
 * Thay vào đó nó CỨ GHI, rồi bắt hai lỗi trùng khoá:
 *
 *   uq_payment_txn_provider_ref    cùng một sự kiện gửi hai lần
 *   uq_payment_txn_one_success     đơn này đã được trả tiền rồi (ref khác)
 *
 * Cả hai đều trả về `alreadyProcessed`, KHÔNG phải lỗi. Webhook nhận 200 và
 * ngừng thử lại; quản trị viên nhận một câu nói rõ đơn đã được ghi nhận.
 *
 * ═══ Toàn bộ trong MỘT transaction ════════════════════════════════════════
 *
 * Giao dịch, trạng thái đơn, subscription mới, subscription cũ bị thay thế và
 * dòng nhật ký — hoặc tất cả, hoặc không gì cả. Nửa vời ở đây nghĩa là tiền đã
 * ghi nhận mà khách không được gói, hoặc ngược lại.
 */

export interface ConfirmInput {
  orderCode: string;
  /** Số tiền THỰC NHẬN. Có thể lệch với đơn — xem ghi chú ở dưới. */
  amountVnd: number;
  /** Mã tham chiếu của cổng, hoặc số tham chiếu trên sao kê ngân hàng. */
  providerTxnRef: string;
  source: 'webhook' | 'manual';
  /** Bắt buộc khi `source = 'manual'` — ràng buộc CHECK ở database cưỡng chế. */
  confirmedBy?: number | null;
  reason?: string | null;
  /** Payload nguyên văn của webhook. `null` với xác nhận tay. */
  rawPayload?: unknown;
  occurredAt?: Date | null;
  /** Người thực hiện, để ghi nhật ký. */
  actor: Pick<
    AuditEntry,
    'actorUserId' | 'actorEmail' | 'actorPlatformRole' | 'ipAddress' | 'userAgent'
  >;
}

export interface ConfirmResult {
  orderCode: string;
  tenantId: number;
  /** `true` khi đơn đã được ghi nhận từ trước — KHÔNG phải lỗi. */
  alreadyProcessed: boolean;
  subscriptionId: number | null;
}

interface OrderRow extends RowDataPacket {
  id: number;
  tenant_id: number;
  status: string;
  amount_vnd: number;
  plan_id: number;
  plan_code: string;
  plan_name: string;
  plan_duration_days: number;
  payment_method_id: number;
  provider: PaymentProvider;
}

function isDup(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === 'ER_DUP_ENTRY';
}

/** Lỗi trùng khoá này thuộc ràng buộc nào — hai cái mang hai nghĩa khác nhau. */
function dupKey(err: unknown): string {
  return (err as { message?: string } | null)?.message ?? '';
}

export async function confirmPayment(input: ConfirmInput): Promise<ConfirmResult> {
  return withTransaction(async (conn) => {
    /*
     * `FOR UPDATE` khoá dòng đơn trong suốt transaction.
     *
     * Nó KHÔNG phải thứ giữ bất biến "một đơn một lần trả tiền" — hai khoá
     * UNIQUE mới là thứ đó, và chúng đúng kể cả với hai tiến trình khác nhau.
     * Khoá ở đây làm một việc hẹp hơn: giữ cho phần ĐỌC (trạng thái, số tiền,
     * gói) không đổi giữa lúc ta đọc và lúc ta ghi, để thông báo trả về không
     * mô tả một trạng thái đã cũ.
     */
    const [orders] = await conn.query<OrderRow[]>(
      `SELECT o.id, o.tenant_id, o.status, o.amount_vnd, o.plan_id,
              o.plan_code, o.plan_name, o.plan_duration_days,
              o.payment_method_id, pm.provider
         FROM orders o
         JOIN payment_methods pm ON pm.id = o.payment_method_id
        WHERE o.order_code = ?
        FOR UPDATE`,
      [input.orderCode],
    );

    const order = orders[0];
    if (order === undefined) {
      throw new HttpError(
        404,
        BILLING_ERROR_CODES.ORDER_NOT_FOUND,
        `Không tìm thấy đơn hàng ${input.orderCode}.`,
      );
    }

    // Đơn ĐÃ trả tiền: trả về ngay, không ném lỗi. Đây là nhánh mà một webhook
    // gửi lại lần thứ ba rơi vào, và nó phải nhận 200.
    if (order.status === 'paid') {
      return {
        orderCode: input.orderCode,
        tenantId: Number(order.tenant_id),
        alreadyProcessed: true,
        subscriptionId: null,
      };
    }

    /*
     * Đơn đã HUỶ hoặc HOÀN TIỀN thì tiền về là chuyện phải xử lý TAY.
     *
     * Không tự kích hoạt gói: khách huỷ đơn rồi vẫn chuyển tiền (hoặc chuyển
     * chậm sau khi đơn hết hạn) là tình huống có thật, và câu trả lời đúng là
     * hoàn tiền hoặc tạo đơn mới — không phải lặng lẽ bật gói cho một đơn đã
     * đóng sổ.
     *
     * `expired` thì CHO QUA: đơn hết hạn chỉ nghĩa là mã QR không còn dùng
     * được, không nghĩa là ta từ chối tiền khách đã chuyển. Chuyển khoản ngân
     * hàng mất vài phút tới vài giờ, nên tiền về sau hạn 15 phút là chuyện
     * thường ngày chứ không phải ngoại lệ.
     */
    if (order.status === 'cancelled' || order.status === 'refunded') {
      throw new HttpError(
        409,
        BILLING_ERROR_CODES.ORDER_STATE_INVALID,
        `Đơn ${input.orderCode} đã đóng (${order.status}) nên không ghi nhận thanh toán được. ` +
          'Hãy hoàn tiền cho khách hoặc để khách tạo đơn mới.',
      );
    }

    // ─── Ghi giao dịch. Hai khoá UNIQUE là lớp chặn thật ────────────────────
    try {
      await conn.query<ResultSetHeader>(
        `INSERT INTO payment_transactions
           (tenant_id, order_id, payment_method_id, provider, provider_txn_ref,
            direction, status, amount_vnd, source, confirmed_by, confirm_reason,
            raw_payload, occurred_at)
         VALUES (?, ?, ?, ?, ?, 'inbound', 'succeeded', ?, ?, ?, ?, ?, ?)`,
        [
          order.tenant_id,
          order.id,
          order.payment_method_id,
          order.provider,
          input.providerTxnRef,
          input.amountVnd,
          input.source,
          input.confirmedBy ?? null,
          input.reason ?? null,
          input.rawPayload === undefined ? null : JSON.stringify(input.rawPayload),
          input.occurredAt ?? null,
        ],
      );
    } catch (err) {
      if (!isDup(err)) throw err;

      /*
       * Hai ràng buộc, hai nghĩa — và phân biệt được là điều đáng làm.
       *
       *   uq_payment_txn_one_success  đơn đã trả tiền bằng một ref KHÁC. Đây là
       *                               ca "webhook về rồi admin cũng bấm xác
       *                               nhận". Coi như đã xử lý.
       *   uq_payment_txn_provider_ref cùng một mã tham chiếu gửi lại. Cũng coi
       *                               như đã xử lý — nhưng nếu ref đó thuộc một
       *                               ĐƠN KHÁC thì đó là lỗi của người nhập,
       *                               và phải nói ra.
       */
      const key = dupKey(err);
      if (key.includes('uq_payment_txn_provider_ref')) {
        const [existing] = await conn.query<(RowDataPacket & { order_id: number })[]>(
          `SELECT order_id FROM payment_transactions
            WHERE provider = ? AND provider_txn_ref = ? LIMIT 1`,
          [order.provider, input.providerTxnRef],
        );
        if (existing[0] !== undefined && Number(existing[0].order_id) !== Number(order.id)) {
          throw new HttpError(
            409,
            BILLING_ERROR_CODES.TRANSACTION_DUPLICATE,
            `Mã tham chiếu "${input.providerTxnRef}" đã được dùng cho một đơn khác. ` +
              'Hãy kiểm lại số tham chiếu trên sao kê.',
          );
        }
      }

      return {
        orderCode: input.orderCode,
        tenantId: Number(order.tenant_id),
        alreadyProcessed: true,
        subscriptionId: null,
      };
    }

    const now = new Date();

    await conn.query(
      "UPDATE orders SET status = 'paid', paid_at = ? WHERE id = ?",
      [now, order.id],
    );

    const subscriptionId = await capNhatSubscription(conn, {
      tenantId: Number(order.tenant_id),
      orderId: Number(order.id),
      planId: Number(order.plan_id),
      planCode: order.plan_code,
      planName: order.plan_name,
      priceVnd: Number(order.amount_vnd),
      durationDays: Number(order.plan_duration_days),
      now,
    });

    await writeAudit(conn, {
      ...input.actor,
      tenantId: Number(order.tenant_id),
      action:
        input.source === 'manual'
          ? AUDIT_ACTIONS.ORDER_CONFIRM_MANUAL
          : AUDIT_ACTIONS.ORDER_CONFIRM_WEBHOOK,
      entityType: 'order',
      entityId: Number(order.id),
      before: { status: order.status },
      after: {
        status: 'paid',
        amountVnd: input.amountVnd,
        providerTxnRef: input.providerTxnRef,
        subscriptionId,
      },
      reason: input.reason ?? null,
    });

    return {
      orderCode: input.orderCode,
      tenantId: Number(order.tenant_id),
      alreadyProcessed: false,
      subscriptionId,
    };
  });
}

interface SubInput {
  tenantId: number;
  orderId: number;
  planId: number;
  planCode: string;
  planName: string;
  priceVnd: number;
  durationDays: number;
  now: Date;
}

/**
 * Thay gói đang chạy bằng gói vừa mua.
 *
 * Thứ tự BẮT BUỘC: đóng dòng cũ TRƯỚC, mở dòng mới SAU.
 *
 * `uq_subscriptions_one_active` là một khoá UNIQUE trên cột sinh
 * `IF(status = 'active', tenant_id, NULL)`. Chèn dòng mới khi dòng cũ còn
 * `active` sẽ đâm thẳng vào nó — và đó là điều TỐT: ràng buộc bắt được đúng
 * loại lỗi này thay vì để tổ chức có hai gói cùng hiệu lực.
 */
async function capNhatSubscription(conn: Db, input: SubInput): Promise<number> {
  const [current] = await conn.query<(RowDataPacket & { id: number; period_end: Date })[]>(
    `SELECT id, period_end FROM subscriptions
      WHERE tenant_id = ? AND status = 'active'
      FOR UPDATE`,
    [input.tenantId],
  );

  const dangChay = current[0];

  const chuKy = tinhChuKy({
    now: input.now,
    // Hạn cũ ĐÃ QUA thì `tinhChuKy` tự bỏ qua — nó lấy mốc muộn hơn giữa "bây
    // giờ" và "hạn cũ". Nên không cần lọc `period_end > now` ở đây.
    currentPeriodEnd: dangChay?.period_end ?? null,
    durationDays: input.durationDays,
  });

  if (dangChay !== undefined) {
    await conn.query(
      "UPDATE subscriptions SET status = 'superseded', ended_at = ? WHERE id = ?",
      [input.now, dangChay.id],
    );
  }

  const [result] = await conn.query<ResultSetHeader>(
    `INSERT INTO subscriptions
       (tenant_id, plan_id, order_id, status, source, plan_code, plan_name, price_vnd,
        period_start, period_end, carried_over_days, previous_subscription_id)
     VALUES (?, ?, ?, 'active', 'purchase', ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.tenantId,
      input.planId,
      input.orderId,
      input.planCode,
      input.planName,
      input.priceVnd,
      chuKy.periodStart,
      chuKy.periodEnd,
      chuKy.carriedOverDays,
      dangChay?.id ?? null,
    ],
  );

  return result.insertId;
}
