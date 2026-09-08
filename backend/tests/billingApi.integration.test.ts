import type { RowDataPacket } from 'mysql2';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
import { closeMysql, mysqlPool } from '../src/config/mysql';
import { closeRedis } from '../src/config/redis';
import { crc16 } from '../src/services/billing/vietqr';
import { resetDatabase } from './helpers/db';
import {
  bearer,
  makeMembership,
  makeTenant,
  makeUser,
  makeWorkspace,
  signTokenFor,
} from './helpers/fixtures';

/**
 * API người dùng của §11 — cần MySQL + Redis, KHÔNG cần ClickHouse.
 *
 * Bộ `billing.integration.test.ts` kiểm những bất biến do DATABASE giữ; bộ này
 * kiểm những thứ chỉ lộ ra khi đi qua cả tầng route: phân quyền, cách ly tổ
 * chức, và những câu trả lời mà một người dùng thật sẽ nhận.
 *
 * ⚠️ Số tài khoản nhận tiền được điền TRONG `beforeEach`, không lấy từ dữ liệu
 * gieo. Migration cố ý để trống ba cột đó (số tài khoản là dữ liệu vận hành
 * thật, không thuộc mã nguồn), nên mọi ca cần tạo đơn phải tự cấu hình — đúng
 * như người vận hành sẽ phải làm ở lần cài đầu tiên.
 */

const app = createApp();

interface Fixture {
  tenantA: number;
  tenantB: number;
  adminA: number;
  tokenAdminA: string;
  tokenCreatorA: string;
  tokenViewerA: string;
  tokenAdminB: string;
  planPro: number;
  planFree: number;
  methodId: number;
}

let f: Fixture;

/** Điền thông tin ngân hàng để phương thức chuyển khoản dùng được. */
async function cauHinhChuyenKhoan(): Promise<void> {
  await mysqlPool.query(
    `UPDATE payment_methods
        SET bank_bin = '970436', bank_account_no = '1234567890',
            bank_account_name = 'CONG TY BI'
      WHERE code = 'vietqr_bank'`,
  );
}

async function idCua(bang: 'plans' | 'payment_methods', code: string): Promise<number> {
  const [rows] = await mysqlPool.query<(RowDataPacket & { id: number })[]>(
    `SELECT id FROM ${bang} WHERE code = ?`,
    [code],
  );
  const row = rows[0];
  if (row === undefined) throw new Error(`Không tìm thấy ${bang}.${code} — migration 30 chưa chạy?`);
  return Number(row.id);
}

beforeEach(async () => {
  await resetDatabase();
  await cauHinhChuyenKhoan();

  const tenantA = await makeTenant('Công ty Alpha', 'cong-ty-alpha');
  const tenantB = await makeTenant('Công ty Beta', 'cong-ty-beta');

  const adminA = await makeUser('alice@alpha.test', 'Nguyễn Thị An');
  const creatorA = await makeUser('bob@alpha.test', 'Trần Văn Bình');
  const viewerA = await makeUser('dave@alpha.test', 'Phạm Văn Dũng');
  const adminB = await makeUser('carol@beta.test', 'Lê Thị Cúc');

  await makeMembership(adminA, tenantA, 'admin');
  await makeMembership(creatorA, tenantA, 'creator');
  await makeMembership(viewerA, tenantA, 'viewer');
  await makeMembership(adminB, tenantB, 'admin');

  f = {
    tenantA,
    tenantB,
    adminA,
    tokenAdminA: signTokenFor(adminA, tenantA, 'admin'),
    tokenCreatorA: signTokenFor(creatorA, tenantA, 'creator'),
    tokenViewerA: signTokenFor(viewerA, tenantA, 'viewer'),
    tokenAdminB: signTokenFor(adminB, tenantB, 'admin'),
    planPro: await idCua('plans', 'pro'),
    planFree: await idCua('plans', 'free'),
    methodId: await idCua('payment_methods', 'vietqr_bank'),
  };
});

afterAll(async () => {
  await Promise.allSettled([closeMysql(), closeRedis()]);
});

/** Tạo đơn qua API và trả về thân phản hồi. */
async function taoDon(token: string, planId?: number): Promise<Record<string, unknown>> {
  const res = await request(app)
    .post('/api/v1/orders')
    .set(bearer(token))
    .send({ planId: planId ?? f.planPro, paymentMethodId: f.methodId, cycle: 'monthly' })
    .expect(201);
  return res.body as Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('§11 phân quyền', () => {
  it('viewer và creator KHÔNG xem được gì về thanh toán', async () => {
    // `billing` cố ý chỉ thuộc về vai trò `admin` của tổ chức (nhận từ dòng
    // `(*, *)` trong DEFAULT_POLICY). Mua gói và xem hoá đơn là việc của người
    // quản trị tổ chức, không phải của người dựng báo cáo.
    for (const token of [f.tokenCreatorA, f.tokenViewerA]) {
      await request(app).get('/api/v1/billing/me').set(bearer(token)).expect(403);
      await request(app).get('/api/v1/plans').set(bearer(token)).expect(403);
      await request(app).get('/api/v1/orders').set(bearer(token)).expect(403);
    }
  });

  it('creator KHÔNG tạo được đơn', async () => {
    await request(app)
      .post('/api/v1/orders')
      .set(bearer(f.tokenCreatorA))
      .send({ planId: f.planPro, paymentMethodId: f.methodId, cycle: 'monthly' })
      .expect(403);
  });

  it('không token -> 401', async () => {
    await request(app).get('/api/v1/billing/me').expect(401);
  });
});

describe('§11 cách ly tổ chức', () => {
  it('đơn của tổ chức khác -> 404, KHÔNG phải 403', async () => {
    // 403 là một lời xác nhận rằng mã đó có tồn tại. Mã đơn tuy khó đoán nhưng
    // nó hiện trên màn hình và trong sao kê, nên không được coi là bí mật —
    // `WHERE tenant_id = ?` mới là thứ chặn.
    const don = await taoDon(f.tokenAdminA);

    await request(app)
      .get(`/api/v1/orders/${String(don['orderCode'])}`)
      .set(bearer(f.tokenAdminB))
      .expect(404);

    await request(app)
      .get(`/api/v1/orders/${String(don['orderCode'])}/status`)
      .set(bearer(f.tokenAdminB))
      .expect(404);
  });

  it('danh sách đơn chỉ thấy đơn của mình', async () => {
    await taoDon(f.tokenAdminA);

    const res = await request(app).get('/api/v1/orders').set(bearer(f.tokenAdminB)).expect(200);
    expect(res.body.items).toHaveLength(0);
    expect(res.body.total).toBe(0);
  });

  it('không huỷ được đơn của tổ chức khác', async () => {
    const don = await taoDon(f.tokenAdminA);

    await request(app)
      .post(`/api/v1/orders/${String(don['orderCode'])}/cancel`)
      .set(bearer(f.tokenAdminB))
      .expect(404);

    // Và đơn thật vẫn còn nguyên trạng thái.
    const con = await request(app)
      .get(`/api/v1/orders/${String(don['orderCode'])}`)
      .set(bearer(f.tokenAdminA))
      .expect(200);
    expect(con.body.status).toBe('pending');
  });
});

describe('§11 bảng giá và trang Billing', () => {
  it('trả về ba gói theo đúng thứ tự người vận hành đã sắp', async () => {
    const res = await request(app).get('/api/v1/plans').set(bearer(f.tokenAdminA)).expect(200);
    expect(res.body.map((p: { code: string }) => p.code)).toEqual(['free', 'pro', 'business']);
  });

  it('hạn mức "không giới hạn" đi ra ngoài là NULL, không phải 0', async () => {
    // Đổi thành 0 ở tầng DTO là biến gói đắt nhất thành gói không làm được gì,
    // và giao diện sẽ vẽ một thanh mức sử dụng đầy 100% cho khách trả nhiều
    // tiền nhất.
    const res = await request(app).get('/api/v1/plans').set(bearer(f.tokenAdminA)).expect(200);
    const business = res.body.find((p: { code: string }) => p.code === 'business');
    expect(business.maxWorkspaces).toBeNull();
    expect(business.maxReports).toBeNull();
  });

  it('tổ chức chưa mua gì -> gói Free và subscription NULL', async () => {
    // `subscription: null` là câu trả lời BÌNH THƯỜNG, không phải lỗi hay
    // trạng thái đang tải. Hệ thống cố ý không chèn dòng Free mồi.
    const res = await request(app).get('/api/v1/billing/me').set(bearer(f.tokenAdminA)).expect(200);

    expect(res.body.subscription).toBeNull();
    expect(res.body.plan.code).toBe('free');
    expect(res.body.usage.workspaces.limit).toBe(1);
  });

  it('mức sử dụng đếm đúng và số về dạng SỐ, không phải chuỗi', async () => {
    /*
     * `SUM()` của MySQL trả DECIMAL, mà pool không bật `decimalNumbers` — nên
     * nó về Node dưới dạng CHUỖI và `used + them` thành phép nối chuỗi. Ca này
     * canh đúng chỗ đó: nếu ai bỏ `Number()` trong `repositories/usage.ts` thì
     * `toBe(0)` đỏ ngay vì `'0' !== 0`.
     */
    await makeWorkspace(f.tenantA, 'Kinh doanh', 'kinh-doanh');
    await makeWorkspace(f.tenantA, 'Kế toán', 'ke-toan');

    const res = await request(app).get('/api/v1/billing/me').set(bearer(f.tokenAdminA)).expect(200);

    expect(res.body.usage.workspaces.used).toBe(2);
    expect(typeof res.body.usage.storageBytes.used).toBe('number');
    expect(res.body.usage.storageBytes.used).toBe(0);
  });
});

describe('§11 tạo đơn', () => {
  it('đơn mới mang mã đúng khuôn, hạn 15 phút và mã QR quét được', async () => {
    const truoc = Date.now();
    const don = await taoDon(f.tokenAdminA);

    expect(don['orderCode']).toMatch(/^BI[0-9A-Z]{10}$/);
    expect(don['status']).toBe('pending');
    expect(don['amountVnd']).toBe(299000);

    const han = new Date(String(don['expiresAt'])).getTime();
    // Cho phép lệch vài giây vì thời gian chạy request.
    expect(han - truoc).toBeGreaterThan(14 * 60_000);
    expect(han - truoc).toBeLessThan(16 * 60_000);

    // Mã QR có thật, đúng chuẩn, và mang đúng nội dung chuyển khoản.
    const qr = String(don['qrPayload']);
    expect(qr.startsWith('000201010212')).toBe(true);
    expect(qr).toContain(String(don['orderCode']));
    expect(qr).toContain('5406299000');
    // CRC phải khớp — nếu không thì ứng dụng ngân hàng từ chối mã.
    expect(qr.slice(-4)).toBe(crc16(qr.slice(0, -4)));
  });

  it('đơn CHỐT CỨNG giá, nên đổi bảng giá KHÔNG làm đổi đơn cũ', async () => {
    /*
     * Đây là thứ thay cho bảng `plan_price_history`: nguồn chân lý cho "đơn cũ
     * giữ đúng giá" là ảnh chụp trong chính đơn, không phải một bảng lịch sử
     * song song.
     */
    const don = await taoDon(f.tokenAdminA);
    await mysqlPool.query("UPDATE plans SET price_vnd = 499000, name = 'Pro mới' WHERE code = 'pro'");

    const doc = await request(app)
      .get(`/api/v1/orders/${String(don['orderCode'])}`)
      .set(bearer(f.tokenAdminA))
      .expect(200);

    expect(doc.body.amountVnd).toBe(299000);
    expect(doc.body.planName).toBe('Chuyên nghiệp');
  });

  it('chu kỳ NĂM trả 10 tháng và dùng 12 — một chỗ tính duy nhất', async () => {
    const res = await request(app)
      .post('/api/v1/orders')
      .set(bearer(f.tokenAdminA))
      .send({ planId: f.planPro, paymentMethodId: f.methodId, cycle: 'yearly' })
      .expect(201);

    expect(res.body.amountVnd).toBe(299000 * 10);
    expect(res.body.planDurationDays).toBe(30 * 12);
  });

  it('bấm hai lần trả về CÙNG một đơn, không đẻ ra hai mã QR', async () => {
    // Người dùng bấm "Nâng cấp" hai lần hoặc mở hai tab là chuyện thường. Hai
    // mã QR cùng chờ tiền cho một lần mua là thứ người vận hành phải gỡ tay khi
    // tiền về với mã của đơn kia.
    const mot = await taoDon(f.tokenAdminA);
    const hai = await taoDon(f.tokenAdminA);

    expect(hai['orderCode']).toBe(mot['orderCode']);

    const [rows] = await mysqlPool.query<RowDataPacket[]>(
      'SELECT COUNT(*) AS n FROM orders WHERE tenant_id = ?',
      [f.tenantA],
    );
    expect(Number(rows[0]?.['n'])).toBe(1);
  });

  it('KHÔNG mua được gói miễn phí', async () => {
    // Lọt qua thì `tinhChuKy` ném ở tận tầng dưới với một câu chẳng nói gì về
    // việc người dùng vừa làm.
    const res = await request(app)
      .post('/api/v1/orders')
      .set(bearer(f.tokenAdminA))
      .send({ planId: f.planFree, paymentMethodId: f.methodId, cycle: 'monthly' })
      .expect(400);

    expect(res.body.message).toContain('miễn phí');
  });

  it('gói bị ẩn khỏi bảng giá thì không mua được nữa', async () => {
    await mysqlPool.query("UPDATE plans SET is_public = 0 WHERE code = 'pro'");

    const res = await request(app)
      .post('/api/v1/orders')
      .set(bearer(f.tokenAdminA))
      .send({ planId: f.planPro, paymentMethodId: f.methodId, cycle: 'monthly' })
      .expect(404);

    expect(res.body.error).toBe('PlanUnavailable');
  });

  it('phương thức CHƯA cấu hình -> 409 nói rõ ai phải sửa', async () => {
    /*
     * Đây KHÔNG phải trường hợp hiếm: migration cố ý gieo `vietqr_bank` với số
     * tài khoản để trống, nên đây là trạng thái của mọi lần cài mới. Thông báo
     * phải nói ra việc phải làm, nếu không khách nhận một lỗi 500 và không ai
     * biết đi hỏi ai.
     */
    await mysqlPool.query("UPDATE payment_methods SET bank_account_no = NULL WHERE code = 'vietqr_bank'");

    const res = await request(app)
      .post('/api/v1/orders')
      .set(bearer(f.tokenAdminA))
      .send({ planId: f.planPro, paymentMethodId: f.methodId, cycle: 'monthly' })
      .expect(409);

    expect(res.body.error).toBe('PaymentMethodNotConfigured');
    expect(res.body.message).toContain('quản trị viên');
  });

  it('phương thức đã TẮT -> 400', async () => {
    await mysqlPool.query("UPDATE payment_methods SET is_active = 0 WHERE code = 'vietqr_bank'");

    const res = await request(app)
      .post('/api/v1/orders')
      .set(bearer(f.tokenAdminA))
      .send({ planId: f.planPro, paymentMethodId: f.methodId, cycle: 'monthly' })
      .expect(400);

    expect(res.body.error).toBe('PaymentMethodUnavailable');
  });

  it('client KHÔNG tự đặt được số tiền', async () => {
    // Trường `amountVnd` trong body bị bỏ qua hoàn toàn — số tiền do backend
    // tính từ giá gói. Nhận nó từ client là cho người ta tự đặt giá cho mình.
    const res = await request(app)
      .post('/api/v1/orders')
      .set(bearer(f.tokenAdminA))
      .send({ planId: f.planPro, paymentMethodId: f.methodId, cycle: 'monthly', amountVnd: 1000 })
      .expect(201);

    expect(res.body.amountVnd).toBe(299000);
  });

  it('body thiếu trường -> 400 kèm map lỗi theo trường', async () => {
    const res = await request(app)
      .post('/api/v1/orders')
      .set(bearer(f.tokenAdminA))
      .send({ planId: f.planPro })
      .expect(400);

    expect(res.body.error).toBe('ValidationError');
    expect(res.body.fields).toHaveProperty('paymentMethodId');
  });
});

describe('§11 vòng đời đơn', () => {
  it('mã đơn sai khuôn bị chặn TRƯỚC khi chạm database', async () => {
    // Kiểm khuôn ở tầng route để một tham số rác không đi tới repository, và để
    // thông báo lỗi nói đúng chuyện gì sai.
    for (const rac of ['abc', 'BI-123', "BI' OR 1=1 --", 'BI0123456I89']) {
      await request(app)
        .get(`/api/v1/orders/${encodeURIComponent(rac)}`)
        .set(bearer(f.tokenAdminA))
        .expect(400);
    }
  });

  it('đơn quá hạn tự chuyển sang `expired` ngay khi ĐỌC, không đợi cron', async () => {
    /*
     * Con cron chạy mỗi vài phút. Chỉ dựa vào nó thì đơn vừa hết hạn ba giây
     * vẫn hiện "đang chờ thanh toán", và người dùng ngồi đợi một mã QR không
     * còn tác dụng.
     *
     * Đẩy `expires_at` về quá khứ bằng SQL là cách duy nhất kiểm được chuyện
     * này mà không phải chờ 15 phút thật.
     */
    const don = await taoDon(f.tokenAdminA);
    await mysqlPool.query(
      'UPDATE orders SET expires_at = NOW(3) - INTERVAL 1 MINUTE WHERE order_code = ?',
      [don['orderCode']],
    );

    const res = await request(app)
      .get(`/api/v1/orders/${String(don['orderCode'])}/status`)
      .set(bearer(f.tokenAdminA))
      .expect(200);

    expect(res.body.status).toBe('expired');
  });

  it('endpoint /status nhẹ: chỉ bốn trường, không mang mã QR', async () => {
    // Nó được gọi mỗi ba giây trên mọi màn hình thanh toán đang mở. Trả cả
    // chuỗi QR ở đây là vài trăm byte nhân với tần suất đó.
    const don = await taoDon(f.tokenAdminA);

    const res = await request(app)
      .get(`/api/v1/orders/${String(don['orderCode'])}/status`)
      .set(bearer(f.tokenAdminA))
      .expect(200);

    expect(Object.keys(res.body).sort()).toEqual(['expiresAt', 'orderCode', 'paidAt', 'status']);
  });

  it('huỷ đơn đang chờ -> `cancelled`, KHÔNG phải `failed`', async () => {
    // Khách đổi ý khác cổng thanh toán từ chối. Gộp hai thứ làm mọi thống kê
    // tỷ lệ thất bại thành vô nghĩa.
    const don = await taoDon(f.tokenAdminA);

    await request(app)
      .post(`/api/v1/orders/${String(don['orderCode'])}/cancel`)
      .set(bearer(f.tokenAdminA))
      .expect(204);

    const res = await request(app)
      .get(`/api/v1/orders/${String(don['orderCode'])}/status`)
      .set(bearer(f.tokenAdminA))
      .expect(200);
    expect(res.body.status).toBe('cancelled');
  });

  it('huỷ đơn ĐÃ THANH TOÁN -> 409, không mất dấu tiền', async () => {
    // Một đơn đã trả tiền mà huỷ được là đường ngắn nhất tới việc mất dấu một
    // khoản đã vào tài khoản.
    const don = await taoDon(f.tokenAdminA);
    await mysqlPool.query(
      "UPDATE orders SET status = 'paid', paid_at = NOW(3) WHERE order_code = ?",
      [don['orderCode']],
    );

    const res = await request(app)
      .post(`/api/v1/orders/${String(don['orderCode'])}/cancel`)
      .set(bearer(f.tokenAdminA))
      .expect(409);

    expect(res.body.error).toBe('OrderStateInvalid');
  });

  it('huỷ rồi thì tạo đơn mới được — đơn cũ không chặn đường', async () => {
    const cu = await taoDon(f.tokenAdminA);
    await request(app)
      .post(`/api/v1/orders/${String(cu['orderCode'])}/cancel`)
      .set(bearer(f.tokenAdminA))
      .expect(204);

    const moi = await taoDon(f.tokenAdminA);
    expect(moi['orderCode']).not.toBe(cu['orderCode']);
  });

  it('lọc và phân trang danh sách đơn', async () => {
    const don = await taoDon(f.tokenAdminA);
    await request(app)
      .post(`/api/v1/orders/${String(don['orderCode'])}/cancel`)
      .set(bearer(f.tokenAdminA))
      .expect(204);
    await taoDon(f.tokenAdminA);

    const tatCa = await request(app).get('/api/v1/orders').set(bearer(f.tokenAdminA)).expect(200);
    expect(tatCa.body.total).toBe(2);

    const dangCho = await request(app)
      .get('/api/v1/orders?status=pending')
      .set(bearer(f.tokenAdminA))
      .expect(200);
    expect(dangCho.body.total).toBe(1);
    expect(dangCho.body.items[0].status).toBe('pending');
  });

  it('sắp xếp theo cột không hợp lệ -> 400 kèm danh sách cột nhận được', async () => {
    const res = await request(app)
      .get('/api/v1/orders?sort=; DROP TABLE orders')
      .set(bearer(f.tokenAdminA))
      .expect(400);

    expect(res.body.fields.sort).toContain('createdAt');
  });
});

describe('§11 gói đang hiệu lực', () => {
  it('có subscription thì trang Billing đọc hạn mức của gói ĐÓ', async () => {
    const don = await taoDon(f.tokenAdminA);
    const [rows] = await mysqlPool.query<(RowDataPacket & { id: number })[]>(
      'SELECT id FROM orders WHERE order_code = ?',
      [don['orderCode']],
    );

    await mysqlPool.query(
      `INSERT INTO subscriptions
         (tenant_id, plan_id, order_id, plan_code, plan_name, price_vnd,
          period_start, period_end)
       VALUES (?, ?, ?, 'pro', 'Chuyên nghiệp', 299000,
               NOW(3), NOW(3) + INTERVAL 30 DAY)`,
      [f.tenantA, f.planPro, rows[0]?.id],
    );

    const res = await request(app).get('/api/v1/billing/me').set(bearer(f.tokenAdminA)).expect(200);

    expect(res.body.plan.code).toBe('pro');
    expect(res.body.subscription.planCode).toBe('pro');
    expect(res.body.usage.workspaces.limit).toBe(5);
  });

  it('subscription HẾT HẠN thì rơi về Free, kể cả khi cron chưa chạy', async () => {
    /*
     * Cột `status` vẫn là `active` cho tới lúc con cron đổi nó. Nếu
     * `findActiveSubscription` chỉ lọc theo `status` thì hạn mức của khách phụ
     * thuộc vào việc cron có chạy đúng giờ không — và một gói hết hạn từ hôm
     * qua vẫn cho họ hạn mức Pro.
     */
    const don = await taoDon(f.tokenAdminA);
    const [rows] = await mysqlPool.query<(RowDataPacket & { id: number })[]>(
      'SELECT id FROM orders WHERE order_code = ?',
      [don['orderCode']],
    );

    await mysqlPool.query(
      `INSERT INTO subscriptions
         (tenant_id, plan_id, order_id, status, plan_code, plan_name, price_vnd,
          period_start, period_end)
       VALUES (?, ?, ?, 'active', 'pro', 'Chuyên nghiệp', 299000,
               NOW(3) - INTERVAL 40 DAY, NOW(3) - INTERVAL 10 DAY)`,
      [f.tenantA, f.planPro, rows[0]?.id],
    );

    const res = await request(app).get('/api/v1/billing/me').set(bearer(f.tokenAdminA)).expect(200);

    expect(res.body.plan.code).toBe('free');
    expect(res.body.subscription).toBeNull();
  });
});
