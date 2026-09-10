import { createHash } from 'node:crypto';

import { PAYMENT_PROVIDERS, type PaymentProvider } from '@bi/shared';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

import { mysqlPool } from '../../config/mysql';
import { open } from '../connections/secretBox';
import { isOrderCode } from './orderCode';
import { confirmPayment } from './confirmPayment';
import { verifySignature, verifyToken } from './webhookSignature';

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

/**
 * Cách một cổng chứng minh mình là mình.
 *
 * ⚠️ HAI kiểu, không phải một — và đây là thứ làm hỏng cả đường tự động nếu bỏ
 * qua. Các dịch vụ ĐỌC SAO KÊ ngân hàng ở Việt Nam (Sepay, Casso) KHÔNG ký HMAC
 * trên thân request; chúng gửi một token dùng chung trong header
 * (`Authorization: Apikey <key>`, `Secure-Token: <key>`). Viết sẵn mỗi HMAC rồi
 * chờ tới ngày cắm dịch vụ thật mới phát hiện là mất cả buổi đi tìm lỗi ở khoá
 * bí mật.
 */
export type XacThuc =
  | { kieu: 'hmac'; header: string }
  | { kieu: 'token'; header: string; boTienTo?: string };

/** Một giao dịch đã bóc khỏi payload. Một webhook có thể mang nhiều. */
export interface GiaoDich {
  /** Id để chống xử lý lại. Rỗng thì người gọi băm thân request. */
  eventId: string | null;
  orderCode: string | null;
  /** Số tiền, đơn vị ĐỒNG. `null` khi payload không nói. */
  amount: number | null;
  /** Tiền VÀO. Giao dịch chuyển đi bị bỏ qua, không phải bị coi là lỗi. */
  vao: boolean;
}

export interface WebhookAdapter {
  /** Có thể có nhiều cách; hợp lệ khi MỘT cách qua được. */
  xacThuc: XacThuc[];
  /** Bóc mọi giao dịch trong payload đã parse. Mảng rỗng = không có gì để làm. */
  bocGiaoDich: (payload: Record<string, unknown>) => GiaoDich[];
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
const ORDER_CODE_PATHS = [
  'orderCode',
  'order_code',
  'data.orderCode',
  'data.order_code',
  // Dịch vụ đọc sao kê đẩy NỘI DUNG CHUYỂN KHOẢN vào đây; mã đơn nằm lẫn trong
  // đó và `timMaDon` bóc ra bằng regex.
  'description',
  'content',
  'data.description',
  'data.content',
];

const AMOUNT_PATHS = ['amount', 'data.amount', 'transferAmount', 'data.transferAmount'];

const EVENT_ID_PATHS = [
  'id',
  'eventId',
  'event_id',
  'data.id',
  'referenceCode',
  'data.referenceCode',
  // Casso gọi mã giao dịch ngân hàng là `tid`.
  'tid',
];

/** Bóc một giao dịch từ một object phẳng — dùng cho cả phần tử của mảng. */
function motGiaoDich(o: Record<string, unknown>): GiaoDich {
  const amount = firstNumber(o, AMOUNT_PATHS);

  /*
   * Tiền vào hay tiền ra, ba cách nói và ba dịch vụ:
   *
   *   Sepay  `transferType: 'in' | 'out'`
   *   Casso  không có cờ — SỐ TIỀN ÂM là tiền chuyển đi
   *   khác   không nói gì; số dương thì coi là tiền vào
   *
   * ⚠️ Không có bước này thì mọi khoản người vận hành CHUYỂN ĐI cũng được đem đi
   * khớp mã đơn, và một lần chuyển khoản có ghi nhầm mã đơn trong nội dung sẽ
   * kích hoạt gói cho khách mà không ai trả tiền.
   */
  const loai = firstString(o, ['transferType', 'data.transferType']);
  const vao = loai !== null ? loai.toLowerCase() === 'in' : amount === null || amount > 0;

  return {
    eventId: firstString(o, EVENT_ID_PATHS),
    orderCode: firstString(o, ORDER_CODE_PATHS),
    amount: amount === null ? null : Math.abs(amount),
    vao,
  };
}

/**
 * Khuôn cho dịch vụ ĐỌC SAO KÊ ngân hàng (Sepay, Casso) — §11.2.
 *
 * Nhận cả hai hình dạng vì chúng chỉ khác nhau ở lớp bọc:
 *
 *   Sepay  một giao dịch phẳng ở gốc payload
 *   Casso  `{ error: 0, data: [ ...nhiều giao dịch... ] }`
 *
 * ─── Vì sao nhận NHIỀU cách xác thực cùng lúc ─────────────────────────────
 *
 * Cả ba đều so với CÙNG một khoá bí mật, và phải có ít nhất một cách qua được.
 * Nhận cả ba không nới lỏng gì — kẻ không có khoá vẫn không qua được cách nào —
 * nhưng nó khiến việc đổi từ Sepay sang Casso là đổi cấu hình ở phía dịch vụ,
 * không phải sửa code rồi triển khai lại giữa lúc đang mất webhook.
 */
const SAO_KE: WebhookAdapter = {
  xacThuc: [
    { kieu: 'token', header: 'authorization', boTienTo: 'Apikey ' },
    { kieu: 'token', header: 'secure-token' },
    { kieu: 'hmac', header: 'x-signature' },
  ],
  bocGiaoDich: (p) => {
    const data = p['data'];
    if (Array.isArray(data)) {
      return data
        .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
        .map(motGiaoDich);
    }
    return [motGiaoDich(p)];
  },
};

/**
 * Khuôn chung cho các cổng chưa có adapter riêng.
 *
 * Cố ý không viết sẵn adapter cho PayOS/MoMo: code chưa bao giờ đối diện một
 * payload thật là code trông đúng và sai ở những chỗ không đoán được.
 */
const GENERIC: WebhookAdapter = {
  xacThuc: [{ kieu: 'hmac', header: 'x-signature' }],
  bocGiaoDich: (p) => [motGiaoDich(p)],
};

export function adapterFor(provider: PaymentProvider): WebhookAdapter {
  // Chuyển khoản ngân hàng là đường mà dịch vụ đọc sao kê báo về — xem `SAO_KE`.
  return provider === 'bank_transfer' || provider === 'sepay' ? SAO_KE : GENERIC;
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
  const bamThan = createHash('sha256').update(input.rawBody).digest('hex');

  let payload: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = JSON.parse(rawText);
    if (typeof parsed === 'object' && parsed !== null) payload = parsed as Record<string, unknown>;
  } catch {
    payload = null;
  }

  const secret = await docSecret(input.provider);
  const { hopLe, chuoiDaGui } = kiemXacThuc(adapter, input, secret);

  /*
   * ─── LƯU TRƯỚC, luôn luôn ────────────────────────────────────────────────
   *
   * Nhánh hỏng lưu MỘT dòng khoá theo băm thân request. Chỉ khi mọi thứ hợp lệ
   * ta mới tách ra nhiều dòng theo từng giao dịch — xem vòng lặp dưới.
   */
  async function luuHong(loi: string, status: number, message: string): Promise<WebhookOutcome> {
    const luu = await luuSuKien({
      provider: input.provider,
      eventId: bamThan,
      signature: chuoiDaGui,
      signatureValid: hopLe,
      orderCode: null,
      payloadJson: payload === null ? { _raw: rawText.slice(0, 4000) } : payload,
    });
    if (!luu.trungLap) await ghiKetQua(luu.id, loi);
    return { status, message, eventId: luu.id };
  }

  if (secret === null) {
    return luuHong(
      'Phương thức thanh toán chưa cấu hình khoá bí mật webhook.',
      401,
      'Chưa cấu hình khoá bí mật cho cổng này.',
    );
  }

  if (!hopLe) {
    return luuHong('Chữ ký hoặc token không khớp.', 401, 'Chữ ký không hợp lệ.');
  }

  if (payload === null) {
    return luuHong(
      'Thân request không phải JSON hợp lệ.',
      200,
      'Đã ghi nhận, nhưng thân request không đọc được.',
    );
  }

  const giaoDichs = adapter.bocGiaoDich(payload);
  if (giaoDichs.length === 0) {
    return luuHong(
      'Payload không chứa giao dịch nào.',
      200,
      'Đã ghi nhận, nhưng không có giao dịch nào trong payload.',
    );
  }

  // ─── Từng giao dịch một, mỗi cái một dòng sự kiện riêng ──────────────────
  let apDung = 0;
  let boQua = 0;
  let suKienDau: number | null = null;

  for (const [i, gd] of giaoDichs.entries()) {
    const orderCode = timMaDon(gd.orderCode);

    /*
     * `event_id` là NOT NULL, và khi dịch vụ không cấp thì ta băm thân request
     * kèm CHỈ SỐ trong mảng.
     *
     * Chỉ số là phần bắt buộc: hai giao dịch trong cùng một webhook mà dùng
     * chung một `event_id` thì `uq_webhook_event` sẽ nuốt mất giao dịch thứ hai
     * và coi nó là bản gửi lại — một khoản tiền có thật biến mất không dấu vết.
     */
    const eventId = gd.eventId ?? `${bamThan}:${i}`;

    const luu = await luuSuKien({
      provider: input.provider,
      eventId,
      signature: chuoiDaGui,
      signatureValid: true,
      orderCode,
      payloadJson: payload,
    });
    suKienDau ??= luu.id;

    if (luu.trungLap) {
      boQua += 1;
      continue;
    }

    if (!gd.vao) {
      await ghiKetQua(luu.id, 'Giao dịch chuyển ĐI, bỏ qua.');
      boQua += 1;
      continue;
    }

    if (orderCode === null) {
      await ghiKetQua(luu.id, 'Không tìm thấy mã đơn trong nội dung chuyển khoản.');
      boQua += 1;
      continue;
    }

    const amount = gd.amount;
    if (amount === null || !Number.isInteger(amount) || amount <= 0) {
      await ghiKetQua(luu.id, `Số tiền không hợp lệ: ${String(amount)}`);
      boQua += 1;
      continue;
    }

    try {
      await confirmPayment({
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
      apDung += 1;
    } catch (err) {
      /*
       * Vẫn không ném ra ngoài. Đơn không tồn tại hay đã huỷ là chuyện GỬI LẠI
       * KHÔNG SỬA ĐƯỢC, và một giao dịch hỏng không được kéo theo những giao
       * dịch khác trong cùng lô. Lý do nằm ở cột `error` cho người vận hành đọc.
       */
      const message = err instanceof Error ? err.message : String(err);
      await ghiKetQua(luu.id, message.slice(0, 500));
      boQua += 1;
    }
  }

  return {
    status: 200,
    message: `Đã nhận ${giaoDichs.length} giao dịch: áp dụng ${apDung}, bỏ qua ${boQua}.`,
    eventId: suKienDau,
  };
}

/**
 * Thử mọi cách xác thực adapter khai. Hợp lệ khi MỘT cách qua được.
 *
 * Trả kèm chuỗi đã gửi để lưu vào `payment_webhook_events.signature` — với chữ
 * ký sai thì đó chính là bằng chứng cần giữ.
 */
function kiemXacThuc(
  adapter: WebhookAdapter,
  input: WebhookInput,
  secret: string | null,
): { hopLe: boolean; chuoiDaGui: string } {
  let chuoiDaGui = '';

  for (const cach of adapter.xacThuc) {
    const gui = headerOf(input.headers, cach.header);
    if (gui === '') continue;
    // Giữ chuỗi ĐẦU TIÊN có mặt, kể cả khi nó sai — không có nó thì cột
    // `signature` trống trơn đúng lúc cần điều tra nhất.
    if (chuoiDaGui === '') chuoiDaGui = gui;
    if (secret === null) continue;

    const qua =
      cach.kieu === 'hmac'
        ? verifySignature({ rawBody: input.rawBody, signature: gui, secret })
        : verifyToken(gui, secret, cach.boTienTo);

    if (qua) return { hopLe: true, chuoiDaGui: gui };
  }

  return { hopLe: false, chuoiDaGui };
}

/**
 * Khoá bí mật của cổng, đã giải mã. `null` khi chưa cấu hình.
 *
 * Xuất ra vì bộ GIẢ LẬP cần nó để ký payload đúng cách rồi đi qua chính
 * `handleWebhook` — nếu nó có đường riêng bỏ qua bước xác thực thì thứ được demo
 * không còn là thứ sẽ chạy khi cắm dịch vụ thật.
 */
export async function docSecret(provider: PaymentProvider): Promise<string | null> {
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
