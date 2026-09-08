import type { RowDataPacket } from 'mysql2';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
import { closeMysql, mysqlPool } from '../src/config/mysql';
import { closeRedis } from '../src/config/redis';
import { signPayload } from '../src/services/billing/webhookSignature';
import { seal } from '../src/services/connections/secretBox';
import { resetDatabase } from './helpers/db';
import { bearer, makeMembership, makeTenant, makeUser, signTokenFor } from './helpers/fixtures';

/**
 * §11 phần 3 — console vận hành, webhook, và luồng tiền vào.
 *
 * ═══ Vì sao bộ này tồn tại tách khỏi hai bộ kia ═══════════════════════════
 *
 * `billing.integration` kiểm ràng buộc của DATABASE; `billingApi.integration`
 * kiểm API của người dùng. Bộ này kiểm thứ chỉ lộ ra khi cả chuỗi chạy thật:
 * webhook về, tiền được ghi nhận, subscription đổi, nhật ký có dòng — và quan
 * trọng nhất, chuyện gì xảy ra khi CẢ HAI đường cùng ghi nhận một đơn.
 *
 * Kịch bản cuối là lý do chính của cả bộ. Nó sẽ xảy ra trong tuần đầu vận hành
 * và không lớp nào ở tầng ứng dụng chặn được.
 */

const app = createApp();

const WEBHOOK_SECRET = 'khoa-webhook-dung-cho-test-1234';

interface Fixture {
  tenantId: number;
  adminId: number;
  tokenSuper: string;
  tokenUser: string;
  planPro: number;
  methodId: number;
}

let f: Fixture;

async function idCua(bang: 'plans' | 'payment_methods', code: string): Promise<number> {
  const [rows] = await mysqlPool.query<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM ${bang} WHERE code = ?`,
    [code],
  );
  const row = rows[0];
  if (row === undefined) throw new Error(`Thiếu ${bang}.${code} — migration 30 chưa chạy?`);
  return Number(row.id);
}

/** Tạo đơn bằng API của người dùng, để luồng test đi đúng đường thật. */
async function taoDon(): Promise<{ code: string; amount: number }> {
  const res = await request(app)
    .post('/api/v1/orders')
    .set(bearer(f.tokenUser))
    .send({ planId: f.planPro, paymentMethodId: f.methodId, cycle: 'monthly' })
    .expect(201);
  return { code: String(res.body.orderCode), amount: Number(res.body.amountVnd) };
}

/**
 * Gửi webhook đã ký đúng.
 *
 * Trả về `request.Test` chứ KHÔNG phải `Promise<Response>`: `Test` là thenable
 * và còn nối được `.expect(200)`, còn bọc trong `async` là mất chuỗi đó.
 *
 * `send(raw)` với một CHUỖI, không phải object: supertest tự `JSON.stringify`
 * một object, và chuỗi nó dựng có thể khác chuỗi ta vừa ký — chữ ký sẽ không
 * khớp trong khi mọi thứ trông đúng. Ký trên đúng byte sẽ gửi đi là điều kiện
 * để bộ test này kiểm được thứ nó định kiểm.
 */
function guiWebhook(body: unknown, secret = WEBHOOK_SECRET): request.Test {
  const raw = JSON.stringify(body);
  return request(app)
    .post('/api/webhooks/bank_transfer')
    .set('content-type', 'application/json')
    .set('x-signature', signPayload(raw, secret))
    .send(raw);
}

beforeEach(async () => {
  await resetDatabase();

  // Cấu hình phương thức: số tài khoản để tạo được QR, khoá bí mật để verify
  // webhook. Migration cố ý để trống cả hai — đó là trạng thái của lần cài mới.
  await mysqlPool.query(
    `UPDATE payment_methods
        SET bank_bin = '970436', bank_account_no = '1234567890',
            bank_account_name = 'CONG TY BI', webhook_secret_sealed = ?
      WHERE code = 'vietqr_bank'`,
    [seal(WEBHOOK_SECRET)],
  );

  const tenantId = await makeTenant('Công ty Alpha', 'cong-ty-alpha');
  const adminId = await makeUser('ops@bi.test', 'Người vận hành', { platformRole: 'superadmin' });
  const userId = await makeUser('alice@alpha.test', 'Nguyễn Thị An');

  await makeMembership(adminId, tenantId, 'admin');
  await makeMembership(userId, tenantId, 'admin');

  f = {
    tenantId,
    adminId,
    tokenSuper: signTokenFor(adminId, tenantId, 'admin', 'superadmin'),
    tokenUser: signTokenFor(userId, tenantId, 'admin'),
    planPro: await idCua('plans', 'pro'),
    methodId: await idCua('payment_methods', 'vietqr_bank'),
  };
});

afterAll(async () => {
  await Promise.allSettled([closeMysql(), closeRedis()]);
});

// ─────────────────────────────────────────────────────────────────────────────

describe('§11 xác nhận thanh toán thủ công', () => {
  it('đơn thành `paid`, tổ chức nhận subscription, và có dòng nhật ký', async () => {
    const don = await taoDon();

    const res = await request(app)
      .post(`/api/admin/billing/orders/${don.code}/confirm`)
      .set(bearer(f.tokenSuper))
      .send({ providerTxnRef: 'FT24001', amountVnd: don.amount, reason: 'Đối chiếu sao kê 10/09' })
      .expect(200);

    expect(res.body.alreadyProcessed).toBe(false);
    expect(res.body.subscriptionId).toBeGreaterThan(0);

    // Đơn đã trả tiền.
    const trangThai = await request(app)
      .get(`/api/v1/orders/${don.code}/status`)
      .set(bearer(f.tokenUser))
      .expect(200);
    expect(trangThai.body.status).toBe('paid');
    expect(trangThai.body.paidAt).not.toBeNull();

    // Gói đã đổi — đây là thứ khách nhìn thấy.
    const billing = await request(app)
      .get('/api/v1/billing/me')
      .set(bearer(f.tokenUser))
      .expect(200);
    expect(billing.body.plan.code).toBe('pro');
    expect(billing.body.subscription.source).toBe('purchase');
    expect(billing.body.usage.workspaces.limit).toBe(5);

    // Nhật ký ghi ĐÚNG người, và giữ email dưới dạng ảnh chụp.
    const [logs] = await mysqlPool.query<RowDataPacket[]>(
      "SELECT actor_email, action, tenant_id, reason FROM audit_logs WHERE action = 'order.confirm_manual'",
    );
    expect(logs).toHaveLength(1);
    expect(logs[0]?.['actor_email']).toBe('ops@bi.test');
    expect(Number(logs[0]?.['tenant_id'])).toBe(f.tenantId);
    expect(logs[0]?.['reason']).toBe('Đối chiếu sao kê 10/09');
  });

  it('bấm xác nhận HAI LẦN không tạo hai subscription', async () => {
    const don = await taoDon();
    const body = { providerTxnRef: 'FT24002', amountVnd: don.amount };

    await request(app)
      .post(`/api/admin/billing/orders/${don.code}/confirm`)
      .set(bearer(f.tokenSuper))
      .send(body)
      .expect(200);

    const lai = await request(app)
      .post(`/api/admin/billing/orders/${don.code}/confirm`)
      .set(bearer(f.tokenSuper))
      .send(body)
      .expect(200);

    // 200 chứ không 409: người vận hành bấm hai lần là chuyện thường, và kết
    // quả họ muốn (đơn đã thanh toán) đã đạt được.
    expect(lai.body.alreadyProcessed).toBe(true);

    const [subs] = await mysqlPool.query<RowDataPacket[]>(
      'SELECT id FROM subscriptions WHERE tenant_id = ?',
      [f.tenantId],
    );
    expect(subs).toHaveLength(1);
  });

  it('thiếu số tham chiếu -> 400, không có ô để trống', async () => {
    // Trường này làm hai việc: khoá idempotency thật ở database, và sợi dây nối
    // một lần xác nhận tay về đúng một dòng sao kê khi có tranh chấp.
    const don = await taoDon();

    const res = await request(app)
      .post(`/api/admin/billing/orders/${don.code}/confirm`)
      .set(bearer(f.tokenSuper))
      .send({ amountVnd: don.amount })
      .expect(400);

    expect(res.body.error).toBe('ValidationError');
    expect(res.body.fields).toHaveProperty('providerTxnRef');
  });

  it('dùng LẠI số tham chiếu cho một đơn KHÁC -> 409 nói rõ', async () => {
    // Người vận hành chép nhầm một dòng sao kê sang đơn thứ hai. Nếu lọt thì
    // một khoản tiền được tính hai lần.
    const mot = await taoDon();
    await request(app)
      .post(`/api/admin/billing/orders/${mot.code}/confirm`)
      .set(bearer(f.tokenSuper))
      .send({ providerTxnRef: 'FT-TRUNG', amountVnd: mot.amount })
      .expect(200);

    // Đơn thứ hai: gói khác để không đụng luật "đã có đơn chờ cho gói này".
    const businessId = await idCua('plans', 'business');
    const hai = await request(app)
      .post('/api/v1/orders')
      .set(bearer(f.tokenUser))
      .send({ planId: businessId, paymentMethodId: f.methodId, cycle: 'monthly' })
      .expect(201);

    const res = await request(app)
      .post(`/api/admin/billing/orders/${String(hai.body.orderCode)}/confirm`)
      .set(bearer(f.tokenSuper))
      .send({ providerTxnRef: 'FT-TRUNG', amountVnd: 899000 })
      .expect(409);

    expect(res.body.error).toBe('TransactionDuplicate');
  });

  it('đơn HẾT HẠN vẫn ghi nhận được — tiền về muộn là chuyện thường', async () => {
    /*
     * Chuyển khoản ngân hàng mất vài phút tới vài giờ, còn hạn của đơn là 15
     * phút. Từ chối tiền đã vào tài khoản chỉ vì mã QR hết hiệu lực là cách
     * chắc chắn để có một khách hàng giận dữ và một khoản tiền không ai biết
     * thuộc về đâu.
     */
    const don = await taoDon();
    await mysqlPool.query(
      "UPDATE orders SET status = 'expired', expires_at = NOW(3) - INTERVAL 1 HOUR WHERE order_code = ?",
      [don.code],
    );

    const res = await request(app)
      .post(`/api/admin/billing/orders/${don.code}/confirm`)
      .set(bearer(f.tokenSuper))
      .send({ providerTxnRef: 'FT-MUON', amountVnd: don.amount })
      .expect(200);

    expect(res.body.alreadyProcessed).toBe(false);
  });

  it('đơn ĐÃ HUỶ thì KHÔNG tự bật gói — phải xử lý tay', async () => {
    // Khách huỷ rồi vẫn chuyển tiền. Câu trả lời đúng là hoàn tiền hoặc tạo đơn
    // mới, không phải lặng lẽ bật gói cho một đơn đã đóng sổ.
    const don = await taoDon();
    await request(app)
      .post(`/api/v1/orders/${don.code}/cancel`)
      .set(bearer(f.tokenUser))
      .expect(204);

    const res = await request(app)
      .post(`/api/admin/billing/orders/${don.code}/confirm`)
      .set(bearer(f.tokenSuper))
      .send({ providerTxnRef: 'FT-HUY', amountVnd: don.amount })
      .expect(409);

    expect(res.body.error).toBe('OrderStateInvalid');
  });

  it('gia hạn CỘNG DỒN ngày, và đóng gói cũ lại', async () => {
    const mot = await taoDon();
    await request(app)
      .post(`/api/admin/billing/orders/${mot.code}/confirm`)
      .set(bearer(f.tokenSuper))
      .send({ providerTxnRef: 'FT-L1', amountVnd: mot.amount })
      .expect(200);

    const hai = await taoDon();
    await request(app)
      .post(`/api/admin/billing/orders/${hai.code}/confirm`)
      .set(bearer(f.tokenSuper))
      .send({ providerTxnRef: 'FT-L2', amountVnd: hai.amount })
      .expect(200);

    const [subs] = await mysqlPool.query<RowDataPacket[]>(
      'SELECT status, carried_over_days FROM subscriptions WHERE tenant_id = ? ORDER BY id',
      [f.tenantId],
    );

    expect(subs).toHaveLength(2);
    // Dòng cũ bị thay thế, KHÔNG bị xoá — lịch sử phải giữ được.
    expect(subs[0]?.['status']).toBe('superseded');
    expect(subs[1]?.['status']).toBe('active');
    // Gói cũ còn ~30 ngày, được cộng sang. Không có nó thì khách mất trắng số
    // ngày họ đã trả tiền.
    expect(Number(subs[1]?.['carried_over_days'])).toBeGreaterThanOrEqual(29);
  });
});

describe('§11 webhook', () => {
  it('chữ ký ĐÚNG -> ghi nhận thanh toán và lưu payload', async () => {
    const don = await taoDon();

    const res = await guiWebhook({
      id: 'evt_001',
      orderCode: don.code,
      amount: don.amount,
    });
    expect(res.status).toBe(200);

    const trangThai = await request(app)
      .get(`/api/v1/orders/${don.code}/status`)
      .set(bearer(f.tokenUser))
      .expect(200);
    expect(trangThai.body.status).toBe('paid');

    const [events] = await mysqlPool.query<RowDataPacket[]>(
      'SELECT signature_valid, order_code, processed_at, error FROM payment_webhook_events',
    );
    expect(events).toHaveLength(1);
    expect(Number(events[0]?.['signature_valid'])).toBe(1);
    expect(events[0]?.['order_code']).toBe(don.code);
    expect(events[0]?.['error']).toBeNull();
  });

  it('chữ ký SAI -> 401, KHÔNG ghi nhận tiền, nhưng VẪN lưu sự kiện', async () => {
    /*
     * Lưu lại là điểm của ca này. Một webhook chữ ký sai là dấu hiệu duy nhất
     * cho thấy có người đang thử — vứt nó đi là vứt luôn bằng chứng đó.
     */
    const don = await taoDon();

    const res = await guiWebhook({ id: 'evt_gia', orderCode: don.code, amount: don.amount }, 'khoa-sai');
    expect(res.status).toBe(401);

    const trangThai = await request(app)
      .get(`/api/v1/orders/${don.code}/status`)
      .set(bearer(f.tokenUser))
      .expect(200);
    expect(trangThai.body.status).toBe('pending');

    const [events] = await mysqlPool.query<RowDataPacket[]>(
      'SELECT signature_valid, error FROM payment_webhook_events',
    );
    expect(events).toHaveLength(1);
    expect(Number(events[0]?.['signature_valid'])).toBe(0);
    expect(String(events[0]?.['error'])).toContain('Chữ ký');

    const [txns] = await mysqlPool.query<RowDataPacket[]>('SELECT id FROM payment_transactions');
    expect(txns).toHaveLength(0);
  });

  it('phát lại CÙNG sự kiện -> 200, không ghi nhận hai lần', async () => {
    const don = await taoDon();
    const body = { id: 'evt_lap', orderCode: don.code, amount: don.amount };

    await guiWebhook(body).expect(200);
    const lai = await guiWebhook(body);
    expect(lai.status).toBe(200);

    const [txns] = await mysqlPool.query<RowDataPacket[]>(
      "SELECT id FROM payment_transactions WHERE status = 'succeeded'",
    );
    expect(txns).toHaveLength(1);
  });

  it('WEBHOOK rồi ADMIN xác nhận tay -> chỉ MỘT lần ghi nhận', async () => {
    /*
     * ═══ Ca quan trọng nhất của cả §11 ═══════════════════════════════════
     *
     * Nó xảy ra như thế này, và nó SẼ xảy ra trong tuần đầu vận hành:
     *
     *   1. Khách chuyển tiền, webhook về, đơn thành `paid`.
     *   2. Quản trị viên chưa thấy webhook (hoặc không biết có webhook), mở sao
     *      kê ra và bấm "Xác nhận đã nhận tiền" với số tham chiếu ngân hàng.
     *   3. Hai mã tham chiếu HỢP LỆ khác nhau, cùng một đơn.
     *
     * Khoá `uq_payment_txn_provider_ref` KHÔNG chặn được — hai ref khác nhau.
     * Chỉ cột sinh `succeeded_order_id` cộng UNIQUE mới chặn, và đó là lý do
     * duy nhất nó tồn tại. Không có nó thì tổ chức nhận hai subscription và
     * khách được cộng gấp đôi số ngày.
     */
    const don = await taoDon();

    await guiWebhook({ id: 'evt_webhook', orderCode: don.code, amount: don.amount }).expect(200);

    const tay = await request(app)
      .post(`/api/admin/billing/orders/${don.code}/confirm`)
      .set(bearer(f.tokenSuper))
      .send({ providerTxnRef: 'FT-SAO-KE-KHAC', amountVnd: don.amount })
      .expect(200);

    expect(tay.body.alreadyProcessed).toBe(true);

    const [txns] = await mysqlPool.query<RowDataPacket[]>(
      "SELECT id FROM payment_transactions WHERE status = 'succeeded' AND direction = 'inbound'",
    );
    expect(txns).toHaveLength(1);

    const [subs] = await mysqlPool.query<RowDataPacket[]>(
      'SELECT id FROM subscriptions WHERE tenant_id = ?',
      [f.tenantId],
    );
    expect(subs).toHaveLength(1);
  });

  it('mã đơn LẪN trong nội dung chuyển khoản của ngân hàng vẫn tìm ra', async () => {
    // Ngân hàng chèn chữ quanh nội dung khách gõ. Không bóc được thì mọi webhook
    // của ngân hàng đều trượt.
    const don = await taoDon();

    await guiWebhook({
      id: 'evt_bank',
      content: `CT DEN:0011 ${don.code} GD 987654`,
      amount: don.amount,
    }).expect(200);

    const trangThai = await request(app)
      .get(`/api/v1/orders/${don.code}/status`)
      .set(bearer(f.tokenUser))
      .expect(200);
    expect(trangThai.body.status).toBe('paid');
  });

  it('mã đơn KHÔNG tồn tại -> 200 (không bắt cổng gửi lại), có ghi lý do', async () => {
    // Cổng coi mã lỗi là "gửi lại". Trả 500 nghĩa là nhận cùng webhook đó mỗi
    // vài phút trong nhiều ngày, và không lần nào khá hơn lần nào.
    const res = await guiWebhook({ id: 'evt_la', orderCode: 'BI0000000000', amount: 1000 });
    expect(res.status).toBe(200);

    const [events] = await mysqlPool.query<RowDataPacket[]>(
      'SELECT error FROM payment_webhook_events',
    );
    expect(String(events[0]?.['error'])).toContain('BI0000000000');
  });

  it('cổng không hợp lệ -> 400', async () => {
    await request(app)
      .post('/api/webhooks/khong-co-cong-nay')
      .set('content-type', 'application/json')
      .send('{}')
      .expect(400);
  });

  it('webhook KHÔNG cần token — nó không phải người dùng', async () => {
    // Ca này canh đúng một điều: nếu ai đó "dọn dẹp" bằng cách mount webhook
    // dưới `/api/v1`, mọi webhook thật sẽ nhận 401 và tiền ngừng được ghi nhận.
    const don = await taoDon();
    const res = await guiWebhook({ id: 'evt_no_token', orderCode: don.code, amount: don.amount });
    expect(res.status).toBe(200);
  });
});

describe('§11 quản lý gói và ghi đè thủ công', () => {
  it('đổi giá gói ghi lại giá CŨ trong nhật ký — thay cho plan_price_history', async () => {
    /*
     * Đề bài yêu cầu một bảng `plan_price_history`. Ta bỏ nó, vì nguồn chân lý
     * cho "đơn cũ giữ đúng giá" là ảnh chụp trong `orders`, còn vai trò sổ ghi
     * chép thì `audit_logs` đã làm. Ca này chứng minh vế thứ hai.
     */
    await request(app)
      .patch(`/api/admin/billing/plans/${f.planPro}`)
      .set(bearer(f.tokenSuper))
      .send({
        name: 'Chuyên nghiệp',
        priceVnd: 399000,
        durationDays: 30,
        maxWorkspaces: 5,
        maxReports: 50,
        maxMembers: 10,
        maxStorageBytes: 5368709120,
      })
      .expect(200);

    const [logs] = await mysqlPool.query<RowDataPacket[]>(
      `SELECT before_json->>'$.priceVnd' AS cu, after_json->>'$.priceVnd' AS moi
         FROM audit_logs WHERE action = 'plan.update'`,
    );
    expect(logs).toHaveLength(1);
    expect(logs[0]?.['cu']).toBe('299000');
    expect(logs[0]?.['moi']).toBe('399000');
  });

  it('mã gói TRÙNG -> 409 gắn đúng ô', async () => {
    const res = await request(app)
      .post('/api/admin/billing/plans')
      .set(bearer(f.tokenSuper))
      .send({
        code: 'pro',
        name: 'Trùng mã',
        priceVnd: 1000,
        durationDays: 30,
        maxWorkspaces: null,
        maxReports: null,
        maxMembers: null,
        maxStorageBytes: null,
      })
      .expect(409);

    expect(res.body.error).toBe('DuplicatePlanCode');
    expect(res.body.fields).toHaveProperty('code');
  });

  it('khoá bí mật webhook chỉ hiện BỐN ký tự cuối, không bao giờ hiện đủ', async () => {
    const res = await request(app)
      .get('/api/admin/billing/payment-methods')
      .set(bearer(f.tokenSuper))
      .expect(200);

    const method = res.body[0];
    expect(method.webhookSecretHint).toBe(WEBHOOK_SECRET.slice(-4));

    // Và không trường nào mang bí mật ra ngoài, dù dưới tên gì.
    const json = JSON.stringify(res.body);
    expect(json).not.toContain(WEBHOOK_SECRET);
    expect(json).not.toContain('sealed');
  });

  it('số tài khoản DÁN CÓ KHOẢNG TRẮNG vẫn lưu được', async () => {
    /*
     * Bản đầu kiểm bằng `/^\d{6,32}$/` và từ chối `"0011 0045 67890"` — đúng
     * cách người ta dán số tài khoản từ ứng dụng ngân hàng. Thông báo "chỉ gồm
     * chữ số" khi đó vừa chính xác vừa vô dụng: người vận hành nhìn vào ô của
     * mình thấy toàn chữ số và không hiểu hệ thống đang nói gì.
     *
     * Dấu cách và gạch ngang là cách CON NGƯỜI nhóm chữ số cho dễ đọc, không
     * phải một phần của số tài khoản.
     */
    const res = await request(app)
      .patch(`/api/admin/billing/payment-methods/${f.methodId}`)
      .set(bearer(f.tokenSuper))
      .send({ bankBin: '970 436', bankAccountNo: '0011 0045-67890' })
      .expect(200);

    expect(res.body.bankBin).toBe('970436');
    expect(res.body.bankAccountNo).toBe('0011004567890');
  });

  it('số tài khoản có CHỮ CÁI vẫn nhận — vài ngân hàng dùng tiền tố chữ', async () => {
    // Chuẩn EMVCo của VietQR nhận chuỗi chữ-số ở trường này, nên chặn chữ cái
    // là ta tự đặt ra một luật mà NAPAS không đặt.
    const res = await request(app)
      .patch(`/api/admin/billing/payment-methods/${f.methodId}`)
      .set(bearer(f.tokenSuper))
      .send({ bankAccountNo: 'VNM0011004567' })
      .expect(200);

    expect(res.body.bankAccountNo).toBe('VNM0011004567');
  });

  it('nhưng ký tự LẠ thì vẫn chặn — nó đi thẳng vào chuỗi mã QR', async () => {
    // Một ký tự lạ ở đây là một mã QR không ai quét được, và nó chỉ lộ ra khi
    // khách đã giơ điện thoại lên.
    const res = await request(app)
      .patch(`/api/admin/billing/payment-methods/${f.methodId}`)
      .set(bearer(f.tokenSuper))
      .send({ bankAccountNo: '0011;DROP/*' })
      .expect(400);

    expect(res.body.fields).toHaveProperty('bankAccountNo');
  });

  it('lưu lại Y HỆT giá trị đang có vẫn 200, không báo "không có thay đổi"', async () => {
    // Mở hộp thoại rồi bấm Lưu mà không sửa gì là thao tác bình thường. Nếu
    // `affectedRows === 0` bị hiểu là lỗi thì người dùng nhận một thông báo đỏ
    // cho một hành động hoàn toàn hợp lệ.
    const body = { bankAccountName: 'CONG TY GIONG NHAU' };
    await request(app)
      .patch(`/api/admin/billing/payment-methods/${f.methodId}`)
      .set(bearer(f.tokenSuper))
      .send(body)
      .expect(200);

    await request(app)
      .patch(`/api/admin/billing/payment-methods/${f.methodId}`)
      .set(bearer(f.tokenSuper))
      .send(body)
      .expect(200);
  });

  it('sửa tên phương thức KHÔNG xoá mất khoá bí mật', async () => {
    // Bắt gửi lại bí mật mỗi lần sửa nghĩa là ai muốn đổi một chữ cũng phải biết
    // khoá API — thứ mà người dựng cấu hình ban đầu có thể đã không chia sẻ.
    await request(app)
      .patch(`/api/admin/billing/payment-methods/${f.methodId}`)
      .set(bearer(f.tokenSuper))
      .send({ name: 'Chuyển khoản VietQR' })
      .expect(200);

    const res = await request(app)
      .get('/api/admin/billing/payment-methods')
      .set(bearer(f.tokenSuper))
      .expect(200);

    expect(res.body[0].name).toBe('Chuyển khoản VietQR');
    expect(res.body[0].webhookSecretHint).toBe(WEBHOOK_SECRET.slice(-4));
  });

  it('ghi đè gói thủ công cần LÝ DO, và tạo subscription không kèm đơn hàng', async () => {
    const thieu = await request(app)
      .post('/api/admin/billing/subscriptions/override')
      .set(bearer(f.tokenSuper))
      .send({ tenantId: f.tenantId, planId: f.planPro, durationDays: 365 })
      .expect(400);
    expect(thieu.body.fields).toHaveProperty('reason');

    const res = await request(app)
      .post('/api/admin/billing/subscriptions/override')
      .set(bearer(f.tokenSuper))
      .send({
        tenantId: f.tenantId,
        planId: f.planPro,
        durationDays: 365,
        reason: 'Khách ký hợp đồng riêng 12 tháng',
      })
      .expect(201);

    expect(res.body.subscriptionId).toBeGreaterThan(0);

    const billing = await request(app)
      .get('/api/v1/billing/me')
      .set(bearer(f.tokenUser))
      .expect(200);
    expect(billing.body.plan.code).toBe('pro');
    expect(billing.body.subscription.source).toBe('admin_override');

    // Không có đơn hàng nào được bịa ra — một đơn giả trong sổ cái là thứ đối
    // soát doanh thu sẽ đếm nhầm.
    const [orders] = await mysqlPool.query<RowDataPacket[]>('SELECT id FROM orders');
    expect(orders).toHaveLength(0);
  });

  it('danh sách đơn của console thấy MỌI tổ chức, kèm tên tổ chức', async () => {
    const don = await taoDon();

    const res = await request(app)
      .get('/api/admin/billing/orders')
      .set(bearer(f.tokenSuper))
      .expect(200);

    expect(res.body.total).toBe(1);
    expect(res.body.items[0].orderCode).toBe(don.code);
    expect(res.body.items[0].tenantName).toBe('Công ty Alpha');
  });
});
