import type { RowDataPacket } from 'mysql2';
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app';
import { closeMysql, mysqlPool } from '../src/config/mysql';
import { closeRedis } from '../src/config/redis';
import { quetSepay } from '../src/services/billing/sepayPull';
import { resetDatabase } from './helpers/db';
import { bearer, makeMembership, makeTenant, makeUser, signTokenFor } from './helpers/fixtures';

/*
 * `env` đọc `process.env` rồi đóng băng ngay lúc import, nên token phải có mặt
 * TRƯỚC mọi import ở trên. `vi.hoisted` được vitest kéo lên đầu file.
 */
vi.hoisted(() => {
  process.env['SEPAY_API_TOKEN'] = 'token-sepay-gia-chi-dung-trong-test';
});

/**
 * §11.2 — tự đọc sao kê qua API Sepay, chạy trên database thật.
 *
 * Chỉ `fetch` là giả, và giả bằng ĐÚNG hình dạng Sepay trả về: `amount_in` là
 * chuỗi thập phân, nội dung chuyển khoản có chữ ngân hàng chèn trước mã đơn,
 * giờ giao dịch là giờ Việt Nam không kèm múi giờ. Toàn bộ phần còn lại —
 * khớp mã, `confirmPayment`, khoá UNIQUE, subscription — là code thật.
 *
 * Nội dung `O5CH7KHG55KQ-<mã>` chép từ một giao dịch thật đã về tài khoản.
 */

const app = createApp();

interface Fixture {
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

async function taoDon(): Promise<{ code: string; amount: number }> {
  const res = await request(app)
    .post('/api/v1/orders')
    .set(bearer(f.tokenUser))
    .send({ planId: f.planPro, paymentMethodId: f.methodId, cycle: 'monthly' })
    .expect(201);
  return { code: String(res.body.orderCode), amount: Number(res.body.amountVnd) };
}

async function trangThai(code: string): Promise<string | undefined> {
  const [rows] = await mysqlPool.query<(RowDataPacket & { status: string })[]>(
    'SELECT status FROM orders WHERE order_code = ?',
    [code],
  );
  return rows[0]?.status;
}

/** Sepay trả về danh sách này cho mọi lần gọi, cho tới khi đổi. */
function sepayTra(transactions: Record<string, string | null>[]): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(Response.json({ status: 200, error: null, transactions }))),
  );
}

function giaoDich(
  id: string,
  content: string,
  amountIn: string,
  amountOut = '0.00',
): Record<string, string | null> {
  return {
    id,
    transaction_date: '2026-09-15 10:58:00',
    amount_in: amountIn,
    amount_out: amountOut,
    transaction_content: content,
    reference_number: `FT${id}`,
  };
}

beforeEach(async () => {
  await resetDatabase();

  await mysqlPool.query(
    `UPDATE payment_methods
        SET bank_bin = '970436', bank_account_no = '1234567890', bank_account_name = 'CONG TY BI'
      WHERE code = 'vietqr_bank'`,
  );

  const tenantId = await makeTenant('Công ty Alpha', 'cong-ty-alpha');
  const userId = await makeUser('alice@alpha.test', 'Nguyễn Thị An');
  await makeMembership(userId, tenantId, 'admin');

  f = {
    tokenUser: signTokenFor(userId, tenantId, 'admin'),
    planPro: await idCua('plans', 'pro'),
    methodId: await idCua('payment_methods', 'vietqr_bank'),
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await Promise.allSettled([closeMysql(), closeRedis()]);
});

describe('§11.2 tự đọc sao kê Sepay', () => {
  it('tiền về -> đơn thành `paid`, ghi đúng giờ trên sao kê; khoản CHUYỂN ĐI ghi cùng mã bị bỏ qua', async () => {
    const don = await taoDon();
    sepayTra([
      // Chuyển ĐI có ghi mã đơn: `amount_in = "0.00"`, không được bật gói.
      giaoDich('90000001', `hoan tien ${don.code}`, '0.00', `${String(don.amount)}.00`),
      giaoDich('81887942', `O5CH7KHG55KQ-${don.code}`, `${String(don.amount)}.00`),
    ]);

    expect(await quetSepay()).toEqual({ doc: 2, apDung: 1 });
    expect(await trangThai(don.code)).toBe('paid');

    const [txns] = await mysqlPool.query<RowDataPacket[]>(
      'SELECT provider_txn_ref, status, amount_vnd, occurred_at FROM payment_transactions',
    );
    expect(txns).toHaveLength(1);
    expect(txns[0]?.['provider_txn_ref']).toBe('81887942');
    // 10:58 giờ Việt Nam = 03:58 UTC — dù máy chạy test ở múi giờ nào.
    expect((txns[0]?.['occurred_at'] as Date).toISOString()).toBe('2026-09-15T03:58:00.000Z');
  });

  it('quét lại khi khoản cũ vẫn trong danh sách: KHÔNG đếm lại, KHÔNG ghi lại', async () => {
    const dau = await taoDon();
    sepayTra([giaoDich('81887942', `O5CH7KHG55KQ-${dau.code}`, `${String(dau.amount)}.00`)]);
    await quetSepay();

    expect(await trangThai(dau.code)).toBe('paid');

    // Một đơn KHÁC đang chờ — lý do con quét tiếp tục chạy mỗi 5 giây, và khoản
    // đã ghi nhận ở trên quay lại trong mỗi lần đó. `doc: 1` bên dưới là bằng
    // chứng lần quét CÓ chạy, chứ không về sớm vì không có đơn nào chờ.
    const log = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const hai = await taoDon();
    expect(await trangThai(hai.code)).toBe('pending');

    expect(await quetSepay()).toEqual({ doc: 1, apDung: 0 });
    expect(await quetSepay()).toEqual({ doc: 1, apDung: 0 });

    const [txns] = await mysqlPool.query<RowDataPacket[]>('SELECT id FROM payment_transactions');
    expect(txns).toHaveLength(1);
    // Đã ghi nhận xong là chuyện bình thường, không phải lỗi để báo.
    expect(log).not.toHaveBeenCalled();
  });

  it('mã đơn không có trong database này: không ném, không kéo theo khoản khác, báo MỘT lần', async () => {
    const don = await taoDon();
    const log = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    sepayTra([
      // Máy dev khác dùng chung tài khoản ngân hàng: mã hợp lệ nhưng đơn không ở đây.
      giaoDich('70000001', 'CT DEN BIZZZZZZZZZZ', '2000.00'),
      giaoDich('70000002', `O5CH7KHG55KQ-${don.code}`, `${String(don.amount)}.00`),
    ]);

    expect(await quetSepay()).toEqual({ doc: 2, apDung: 1 });
    expect(await trangThai(don.code)).toBe('paid');

    // Khoản lạ quay lại mỗi vòng. Log mỗi vòng là 720 dòng một giờ. Cần một đơn
    // đang chờ để hai lần quét dưới CÓ chạy — `doc: 2` là bằng chứng.
    await taoDon();
    expect(await quetSepay()).toEqual({ doc: 2, apDung: 0 });
    expect(await quetSepay()).toEqual({ doc: 2, apDung: 0 });

    const baoKhoanLa = log.mock.calls.filter((c) => String(c[0]).includes('BIZZZZZZZZZZ'));
    expect(baoKhoanLa).toHaveLength(1);
    expect(String(baoKhoanLa[0]?.[0])).toContain('70000001');
  });
});
