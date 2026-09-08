import { createHash } from 'node:crypto';

import { PAYMENT_PROVIDERS, type PaymentProvider } from '@bi/shared';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

import { mysqlPool } from '../../config/mysql';
import { open } from '../connections/secretBox';
import { isOrderCode } from './orderCode';
import { confirmPayment } from './confirmPayment';
import { verifySignature } from './webhookSignature';

/**
 * Nhận webhook của cổng thanh toán — §11.
 *
 * ═══ Luật số một: LƯU TRƯỚC, xử lý sau ════════════════════════════════════
 *
 * Mọi webhook đi vào đây đều được ghi xuống `payment_webhook_events`, kể cả:
 *
 *   · chữ ký SAI          — đó là dấu hiệu có người đang thử, và vứt đi là vứt
 *                            luôn bằng chứng duy nhất về việc đó
 *   · `order_code` lạ     — lỗi cấu hình ở phía cổng, hoặc một lần dò tìm
 *   · thân request hỏng   — phải giữ nguyên văn mới gỡ được
 *
 * Chỉ sau khi đã lưu, và chỉ khi chữ ký ĐÚNG, ta mới đụng tới tiền.
 *
 * ═══ Luật số hai: luôn trả 2xx cho một sự kiện đã nhận ════════════════════
 *
 * Cổng thanh toán coi mã lỗi là "gửi lại". Trả 500 vì đơn không tồn tại nghĩa
 * là nhận lại cùng một webhook đó mỗi vài phút trong nhiều ngày. Ta trả 200 kèm
 * lý do trong thân — đã nhận, đã lưu, và đây là chuyện đã xảy ra với nó.
 *
 * Ngoại lệ DUY NHẤT là chữ ký sai: trả 401 để cổng thật biết cấu hình lệch, và
 * để kẻ dò tìm không nhận được 200 cho một chữ ký bịa.
 *
 * ═══ Adapter: chỗ cắm PayOS / Sepay / MoMo sau này ════════════════════════
 *
 * Bản này chạy một khuôn CHUNG: HMAC-SHA256 trên thân request thô, mã đơn nằm
 * ở một trong vài khoá quen thuộc. Ba cổng thật kia mỗi cổng một cách đặt tên
 * và một cách ký; khi có tài khoản merchant thật thì thêm một `WebhookAdapter`
 * cho cổng đó, KHÔNG sửa hàm này.
 *
 * Cố ý không viết sẵn ba adapter chưa từng chạy: code chưa bao giờ đối diện
 * một payload thật là code trông đúng và sai ở những chỗ không đoán được.
 */

export interface WebhookAdapter {
  /** Header mang chữ ký. Mỗi cổng một tên. */
  signatureHeader: string;
  /** Bóc mã đơn khỏi payload đã parse. `null` khi không tìm thấy. */
  extractOrderCode: (payload: Record<string, unknown>) => string | null;
  /** Số tiền thực nhận, đơn vị ĐỒNG. `null` khi payload không nói. */
  extractAmount: (payload: Record<string, unknown>) => number | null;
  /** Id sự kiện của cổng, để chống xử lý lại. `null` thì ta băm thân request. */
  extractEventId: (payload: Record<string, unknown>) => string | null;
}

/** Đọc một khoá lồng nhau kiểu `data.orderCode`, trả `undefined` nếu đứt đường. */
function pick(payload: Record<string, unknown>, path: string): unknown {
  let cur: unknown = payload;
  for (const key of path.split('.')) {
    if (typeof cur !== 'object' || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function firstString(payload: Record<string, unknown>, paths: string[]): string | null {
  for (const p of paths) {
    const v = pick(payload, p);
    if (typeof v === 'string' && v !== '') return v;
  }
  return null;
}

function firstNumber(payload: Record<string, unknown>, paths: string[]): number | null {
  for (const p of paths) {
    const v = pick(payload, p);
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    // Cổng gửi số dưới dạng chuỗi là chuyện thường. `Number('')` là 0 nên phải
    // loại chuỗi rỗng trước, nếu không một trường trống thành số tiền 0.
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

/**
 * Khuôn chung, dùng cho mọi cổng cho tới khi có adapter riêng.
 *
 * Danh sách khoá lấy từ tài liệu công khai của PayOS, Sepay và MoMo — đủ để một
 * cổng thật gửi về mà không cần sửa code, nhưng KHÔNG thay được việc kiểm với
 * payload thật.
 */
const GENERIC: WebhookAdapter = {
  signatureHeader: 'x-signature',
  extractOrderCode: (p) =>
    firstString(p, [
      'orderCode',
      'order_code',
      'data.orderCode',
      'data.order_code',
      // Sepay đẩy nội dung chuyển khoản vào `content`; mã đơn nằm lẫn trong đó.
      'description',
      'content',
      'data.description',
      'data.content',
    ]),
  extractAmount: (p) =>
    firstNumber(p, ['amount', 'data.amount', 'transferAmount', 'data.transferAmount']),
  extractEventId: (p) =>
    firstString(p, ['id', 'eventId', 'event_id', 'data.id', 'data.referenceCode', 'referenceCode']),
};

export function adapterFor(provider: PaymentProvider): WebhookAdapter {
  void provider;
  return GENERIC;
}

export function isPaymentProvider(value: string): value is PaymentProvider {
  return (PAYMENT_PROVIDERS as readonly string[]).includes(value);
}

/**
 * Tìm mã đơn trong một chuỗi nội dung chuyển khoản.
 *
 * Ngân hàng thường chèn thêm chữ quanh nội dung khách gõ: `"CT DEN:0011
 * BISSM2GF71A2 GD 123456"`. Bóc bằng regex thay vì so khớp cả chuỗi — không có
 * bước này thì mọi webhook của ngân hàng đều trượt, và triệu chứng là "không
 * tìm thấy đơn" cho những đơn đang nằm ngay đó.
 */
export function timMaDon(raw: string | null): string | null {
  if (raw === null) return null;
  if (isOrderCode(raw)) return raw;

  const m = /\bBI[0-9A-HJKMNP-TV-Z]{10}\b/.exec(raw.toUpperCase());
  return m !== null && isOrderCode(m[0]) ? m[0] : null;
}

export interface WebhookInput {
  provider: PaymentProvider;
  rawBody: Buffer;
  headers: Record<string, string | string[] | undefined>;
}

export interface WebhookOutcome {
  /** Mã HTTP để trả về. 401 CHỈ khi chữ ký sai — xem docblock đầu file. */
  status: number;
  /** Câu mô tả chuyện đã xảy ra. Đi vào cột `error` khi có vấn đề. */
  message: string;
  eventId: number | null;
}

function headerOf(headers: WebhookInput['headers'], name: string): string {
  const v = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(v)) return v[0] ?? '';
  return v ?? '';
}

/**
 * Xử lý một webhook từ đầu tới cuối.
 *
 * Trả về `WebhookOutcome` thay vì ném: route chỉ việc `res.status(...).json(...)`,
 * và mọi nhánh — kể cả nhánh hỏng — đều đã được ghi lại trước khi tới đây.
 */
export async function handleWebhook(input: WebhookInput): Promise<WebhookOutcome> {
  const adapter = adapterFor(input.provider);
  const rawText = input.rawBody.toString('utf8');

  let payload: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = JSON.parse(rawText);
    if (typeof parsed === 'object' && parsed !== null) payload = parsed as Record<string, unknown>;
  } catch {
    payload = null;
  }

  const signature = headerOf(input.headers, adapter.signatureHeader);
  const orderCode = payload === null ? null : timMaDon(adapter.extractOrderCode(payload));

  /*
   * `event_id` là NOT NULL, và khi cổng không cấp thì ta băm thân request.
   *
   * Nhờ vậy việc phát lại NGUYÊN VĂN một body cũ bị `uq_webhook_event` chặn
   * ngay tại INSERT — trước khi một dòng xử lý nào chạy. Để `null` thì hỏng
   * hẳn: MySQL cho phép nhiều NULL trong một UNIQUE.
   */
  const eventId =
    (payload === null ? null : adapter.extractEventId(payload)) ??
    createHash('sha256').update(input.rawBody).digest('hex');

  const secret = await docSecret(input.provider);
  const chuKyDung =
    secret !== null && verifySignature({ rawBody: input.rawBody, signature, secret });

  // ─── LƯU TRƯỚC, luôn luôn ────────────────────────────────────────────────
  const luu = await luuSuKien({
    provider: input.provider,
    eventId,
    signature,
    signatureValid: chuKyDung,
    orderCode,
    payloadJson: payload === null ? { _raw: rawText.slice(0, 4000) } : payload,
  });

  if (luu.trungLap) {
    // Đã nhận sự kiện này rồi. 200 để cổng ngừng gửi lại.
    return { status: 200, message: 'Sự kiện đã được xử lý trước đó.', eventId: luu.id };
  }

  if (secret === null) {
    await ghiKetQua(luu.id, 'Phương thức thanh toán chưa cấu hình khoá bí mật webhook.');
    return { status: 401, message: 'Chưa cấu hình khoá bí mật cho cổng này.', eventId: luu.id };
  }

  if (!chuKyDung) {
    await ghiKetQua(luu.id, 'Chữ ký không khớp.');
    return { status: 401, message: 'Chữ ký không hợp lệ.', eventId: luu.id };
  }

  if (payload === null) {
    await ghiKetQua(luu.id, 'Thân request không phải JSON hợp lệ.');
    return { status: 200, message: 'Đã ghi nhận, nhưng thân request không đọc được.', eventId: luu.id };
  }

  if (orderCode === null) {
    await ghiKetQua(luu.id, 'Không tìm thấy mã đơn trong payload.');
    return { status: 200, message: 'Đã ghi nhận, nhưng không tìm thấy mã đơn.', eventId: luu.id };
  }

  const amount = adapter.extractAmount(payload);
  if (amount === null || !Number.isInteger(amount) || amount <= 0) {
    await ghiKetQua(luu.id, `Số tiền không hợp lệ: ${String(amount)}`);
    return { status: 200, message: 'Đã ghi nhận, nhưng số tiền không hợp lệ.', eventId: luu.id };
  }

  try {
    const result = await confirmPayment({
      orderCode,
      amountVnd: amount,
      providerTxnRef: eventId,
      source: 'webhook',
      rawPayload: payload,
      occurredAt: new Date(),
      // Webhook không có người thực hiện — nhật ký ghi `actor_user_id = NULL`,
      // và đó là sự thật chứ không phải thiếu dữ liệu.
      actor: { actorUserId: null, actorEmail: null, actorPlatformRole: null },
    });

    await ghiKetQua(luu.id, null);
    return {
      status: 200,
      message: result.alreadyProcessed ? 'Đơn đã được ghi nhận trước đó.' : 'Đã ghi nhận thanh toán.',
      eventId: luu.id,
    };
  } catch (err) {
    /*
     * Vẫn trả 200. Đơn không tồn tại hay đã huỷ là chuyện GỬI LẠI KHÔNG SỬA
     * ĐƯỢC — trả 4xx/5xx chỉ khiến cổng gửi lại cùng một webhook đó mỗi vài
     * phút trong nhiều ngày. Lý do đã nằm trong cột `error` để người vận hành
     * đọc.
     */
    const message = err instanceof Error ? err.message : String(err);
    await ghiKetQua(luu.id, message.slice(0, 500));
    return { status: 200, message: 'Đã ghi nhận, nhưng không áp dụng được.', eventId: luu.id };
  }
}

/** Khoá bí mật của cổng, đã giải mã. `null` khi chưa cấu hình. */
async function docSecret(provider: PaymentProvider): Promise<string | null> {
  const [rows] = await mysqlPool.query<(RowDataPacket & { webhook_secret_sealed: string | null })[]>(
    `SELECT webhook_secret_sealed FROM payment_methods
      WHERE provider = ? AND deleted_at IS NULL AND is_active = 1
      ORDER BY sort_order ASC, id ASC LIMIT 1`,
    [provider],
  );

  const sealed = rows[0]?.webhook_secret_sealed ?? null;
  if (sealed === null || sealed === '') return null;

  try {
    return open(sealed);
  } catch {
    // Giải mã hỏng nghĩa là dữ liệu đã bị can thiệp hoặc khoá mã hoá đã đổi.
    // Coi như chưa cấu hình — KHÔNG bỏ qua bước kiểm chữ ký.
    return null;
  }
}

interface LuuInput {
  provider: PaymentProvider;
  eventId: string;
  signature: string;
  signatureValid: boolean;
  orderCode: string | null;
  payloadJson: unknown;
}

async function luuSuKien(input: LuuInput): Promise<{ id: number; trungLap: boolean }> {
  try {
    const [result] = await mysqlPool.query<ResultSetHeader>(
      `INSERT INTO payment_webhook_events
         (provider, event_id, signature, signature_valid, order_code, payload)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        input.provider,
        input.eventId,
        input.signature === '' ? null : input.signature.slice(0, 512),
        input.signatureValid ? 1 : 0,
        input.orderCode,
        JSON.stringify(input.payloadJson),
      ],
    );
    return { id: result.insertId, trungLap: false };
  } catch (err) {
    if ((err as { code?: string }).code !== 'ER_DUP_ENTRY') throw err;

    const [rows] = await mysqlPool.query<(RowDataPacket & { id: number })[]>(
      'SELECT id FROM payment_webhook_events WHERE provider = ? AND event_id = ? LIMIT 1',
      [input.provider, input.eventId],
    );
    return { id: Number(rows[0]?.id ?? 0), trungLap: true };
  }
}

async function ghiKetQua(id: number, error: string | null): Promise<void> {
  await mysqlPool.query(
    'UPDATE payment_webhook_events SET processed_at = NOW(3), error = ? WHERE id = ?',
    [error, id],
  );
}
