import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { closeMysql, mysqlPool } from '../src/config/mysql';
import { closeRedis } from '../src/config/redis';
import { resetDatabase } from './helpers/db';
import { makeTenant, makeUser } from './helpers/fixtures';

/**
 * §11 — những bất biến do CHÍNH DATABASE giữ.
 *
 * ═══ Vì sao bộ test này tồn tại ═════════════════════════════════════════════
 *
 * Mọi khẳng định dưới đây đều là chuyện KHÔNG có bài test đơn vị nào thay thế
 * được, vì thứ đang được kiểm không phải một hàm — nó là một ràng buộc của
 * InnoDB. Cụ thể hơn: mỗi ca ở đây tương ứng với một khe hở mà một câu `if`
 * trong tầng dịch vụ KHÔNG đóng nổi.
 *
 * Ca nặng nhất là "một đơn được trả tiền hai lần". Nó xảy ra như sau, và nó sẽ
 * xảy ra trong tuần đầu vận hành:
 *
 *   1. Khách chuyển tiền, webhook của cổng về, đơn thành `paid`.
 *   2. Quản trị viên chưa thấy webhook (hoặc không biết có webhook), mở sao kê
 *      ra và bấm "Xác nhận đã nhận tiền".
 *   3. Hai `provider_txn_ref` khác nhau, cùng một đơn -> tổ chức nhận HAI
 *      subscription, và khách được cộng gấp đôi số ngày.
 *
 * Không ràng buộc nào ở tầng ứng dụng chặn được, vì hai đường đi là hai hàm
 * khác nhau chạy ở hai thời điểm khác nhau. Cột sinh `succeeded_order_id` cộng
 * một khoá UNIQUE thì chặn được, tuyệt đối.
 *
 * ─── Vì sao dùng SQL thô chứ không gọi API ─────────────────────────────────
 *
 * Vì đây chính là điều cần kiểm: kể cả khi có ai đó viết một đường ghi MỚI mà
 * quên hết mọi câu kiểm của tầng dịch vụ, database vẫn phải nói không. Đi qua
 * API sẽ kiểm nhầm sang lớp bên trên và để lọt đúng loại lỗi này.
 *
 * ─── `plans` và `payment_methods` được GIEO LẠI trước mỗi ca ───────────────
 *
 * `resetDatabase()` dọn chúng rồi chèn lại đúng ba gói và một phương thức của
 * migration 30 (`reseedBillingCatalog`). Nên các ca dưới đây đọc thẳng gói
 * `pro` mà không phải tự dựng, và một ca sửa bảng giá không làm hỏng ca sau.
 */

interface Fixture {
  tenantId: number;
  userId: number;
  planId: number;
  methodId: number;
  orderId: number;
}

let f: Fixture;

/** Đơn hàng dựng thẳng bằng SQL — bộ test này kiểm database, không kiểm API. */
async function makeOrder(
  tenantId: number,
  planId: number,
  methodId: number,
  orderCode: string,
): Promise<number> {
  const [result] = await mysqlPool.query<ResultSetHeader>(
    `INSERT INTO orders
       (tenant_id, order_code, plan_id, payment_method_id, amount_vnd,
        plan_code, plan_name, plan_duration_days, expires_at)
     VALUES (?, ?, ?, ?, 299000, 'pro', 'Chuyên nghiệp', 30,
             NOW(3) + INTERVAL 15 MINUTE)`,
    [tenantId, orderCode, planId, methodId],
  );
  return result.insertId;
}

/** Ném ra lỗi MySQL để bài test đọc `code` — `expect().rejects` mất mã lỗi. */
async function loiKhiChay(sql: string, params: unknown[]): Promise<string> {
  try {
    await mysqlPool.query(sql, params);
    return 'KHÔNG NÉM LỖI';
  } catch (err) {
    return (err as { code?: string }).code ?? 'KHÔNG CÓ MÃ';
  }
}

beforeEach(async () => {
  await resetDatabase();

  const tenantId = await makeTenant('Công ty Alpha', 'cong-ty-alpha');
  const userId = await makeUser('alice@alpha.test', 'Nguyễn Thị An');

  const [plans] = await mysqlPool.query<(RowDataPacket & { id: number })[]>(
    "SELECT id FROM plans WHERE code = 'pro'",
  );
  const [methods] = await mysqlPool.query<(RowDataPacket & { id: number })[]>(
    "SELECT id FROM payment_methods WHERE code = 'vietqr_bank'",
  );

  // Nếu hai câu này rỗng thì migration 30 chưa chạy trên database test, hoặc ai
  // đó vừa thêm `plans` vào danh sách TRUNCATE của `resetDatabase`. Nói ra ngay
  // ở đây, vì triệu chứng ở dưới sẽ là một lỗi khoá ngoại chẳng liên quan gì.
  expect(plans[0], 'gói "pro" gieo từ migration 30 phải còn trong database test').toBeDefined();
  expect(methods[0], 'phương thức "vietqr_bank" phải còn trong database test').toBeDefined();

  const planId = Number(plans[0]?.id);
  const methodId = Number(methods[0]?.id);
  const orderId = await makeOrder(tenantId, planId, methodId, 'BITEST00001');

  f = { tenantId, userId, planId, methodId, orderId };
});

afterAll(async () => {
  await Promise.allSettled([closeMysql(), closeRedis()]);
});

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bốn ca dưới đây canh bản CHÉP TAY trong `reseedBillingCatalog()` khớp với
 * `INSERT IGNORE INTO plans` của migration 30.
 *
 * Chép tay là chủ ý: migration đã đẩy lên remote thì đóng băng, nên không
 * import được từ đó, và một hằng số dùng chung sẽ khiến sửa hằng số ấy âm thầm
 * đổi nghĩa của một migration đã chạy trên máy người khác. Đổi lại, hai bản
 * lệch nhau phải làm ĐỎ ở đây — đó là việc của khối này.
 */
describe('§11 danh mục gói và phương thức', () => {
  it('có đúng ba gói, và Free là gói 0 đồng', async () => {
    const [rows] = await mysqlPool.query<(RowDataPacket & { code: string; price_vnd: number })[]>(
      'SELECT code, price_vnd FROM plans ORDER BY sort_order',
    );
    expect(rows.map((r) => r.code)).toEqual(['free', 'pro', 'business']);
    expect(Number(rows[0]?.price_vnd)).toBe(0);
  });

  it('gói Business có hạn mức NULL, KHÔNG phải 0', async () => {
    // `0` mang hai nghĩa đối nghịch trong cùng một cột — "không giới hạn" và
    // "không được tạo cái nào". Gieo nhầm thành 0 biến gói đắt nhất thành gói
    // không làm được gì, và không có gì trên màn hình giải thích nổi.
    const [rows] = await mysqlPool.query<RowDataPacket[]>(
      "SELECT max_workspaces, max_reports, max_members FROM plans WHERE code = 'business'",
    );
    expect(rows[0]?.['max_workspaces']).toBeNull();
    expect(rows[0]?.['max_reports']).toBeNull();
    expect(rows[0]?.['max_members']).toBeNull();
  });

  it('phương thức chuyển khoản KHÔNG mang sẵn số tài khoản', async () => {
    // Cố ý để trống. Một số tài khoản mẫu nằm trong mã nguồn là mầm cho đúng
    // một ngày: migration chạy trên production, không ai để ý, và khách chuyển
    // tiền vào tài khoản của người khác.
    const [rows] = await mysqlPool.query<RowDataPacket[]>(
      "SELECT bank_bin, bank_account_no, bank_account_name FROM payment_methods WHERE code = 'vietqr_bank'",
    );
    expect(rows[0]?.['bank_bin']).toBeNull();
    expect(rows[0]?.['bank_account_no']).toBeNull();
    expect(rows[0]?.['bank_account_name']).toBeNull();
  });

  it('tiền về Node dưới dạng SỐ, không phải chuỗi', async () => {
    /*
     * Ca một dòng, chặn một lỗi cả nghìn dòng.
     *
     * Pool không bật `decimalNumbers`, nên nếu ai đó đổi `price_vnd` sang
     * DECIMAL thì mysql2 trả về chuỗi, và `a + b` thành phép NỐI CHUỖI:
     * `"299000" + "199000"` = `"299000199000"`. Chạy được, hiện ra màn hình
     * được, và sai — đúng loại lỗi không ai phát hiện cho tới lúc đối soát.
     */
    const [rows] = await mysqlPool.query<RowDataPacket[]>(
      "SELECT price_vnd FROM plans WHERE code = 'pro'",
    );
    expect(typeof rows[0]?.['price_vnd']).toBe('number');
    expect(rows[0]?.['price_vnd']).toBe(299000);
  });
});

describe('§11 idempotency thanh toán — do DATABASE giữ, không do tầng dịch vụ', () => {
  const INSERT_TXN = `INSERT INTO payment_transactions
      (tenant_id, order_id, payment_method_id, provider, provider_txn_ref,
       status, amount_vnd, source, confirmed_by)
    VALUES (?, ?, ?, 'bank_transfer', ?, ?, 299000, ?, ?)`;

  it('cùng một sự kiện gửi hai lần -> chỉ ghi được một dòng', async () => {
    await mysqlPool.query(INSERT_TXN, [
      f.tenantId, f.orderId, f.methodId, 'FT24001', 'succeeded', 'webhook', null,
    ]);

    const code = await loiKhiChay(INSERT_TXN, [
      f.tenantId, f.orderId, f.methodId, 'FT24001', 'succeeded', 'webhook', null,
    ]);
    expect(code).toBe('ER_DUP_ENTRY');
  });

  it('MỘT ĐƠN không thể được trả tiền hai lần, kể cả với hai số tham chiếu KHÁC NHAU', async () => {
    // Đây là ca quan trọng nhất của cả bộ. Xem docblock đầu file: webhook về
    // rồi quản trị viên cũng bấm xác nhận tay là kịch bản có thật, và khoá
    // `(provider, provider_txn_ref)` một mình KHÔNG chặn nổi vì hai đường ghi
    // mang hai mã tham chiếu hợp lệ khác nhau.
    await mysqlPool.query(INSERT_TXN, [
      f.tenantId, f.orderId, f.methodId, 'FT-WEBHOOK', 'succeeded', 'webhook', null,
    ]);

    const code = await loiKhiChay(INSERT_TXN, [
      f.tenantId, f.orderId, f.methodId, 'FT-THU-CONG', 'succeeded', 'manual', f.userId,
    ]);
    expect(code).toBe('ER_DUP_ENTRY');
  });

  it('nhưng một giao dịch THẤT BẠI thì không chiếm chỗ — vẫn thử lại được', async () => {
    // Cột sinh chỉ nhận `succeeded` + `inbound`, nên một lần trả tiền hỏng
    // không được phép khoá đơn lại vĩnh viễn. Không có ca này thì một webhook
    // báo `failed` sẽ biến đơn thành không bao giờ thanh toán được nữa.
    await mysqlPool.query(INSERT_TXN, [
      f.tenantId, f.orderId, f.methodId, 'FT-HONG', 'failed', 'webhook', null,
    ]);

    const code = await loiKhiChay(INSERT_TXN, [
      f.tenantId, f.orderId, f.methodId, 'FT-LAI', 'succeeded', 'webhook', null,
    ]);
    expect(code).toBe('KHÔNG NÉM LỖI');
  });

  it('xác nhận TAY mà không có người chịu trách nhiệm -> bị từ chối', async () => {
    const code = await loiKhiChay(INSERT_TXN, [
      f.tenantId, f.orderId, f.methodId, 'FT-VO-CHU', 'succeeded', 'manual', null,
    ]);
    expect(code).toBe('ER_CHECK_CONSTRAINT_VIOLATED');
  });

  it('số tham chiếu RỖNG bị từ chối, vì chuỗi rỗng lọt qua NOT NULL rồi phá vỡ UNIQUE', async () => {
    const code = await loiKhiChay(INSERT_TXN, [
      f.tenantId, f.orderId, f.methodId, '', 'succeeded', 'webhook', null,
    ]);
    expect(code).toBe('ER_CHECK_CONSTRAINT_VIOLATED');
  });
});

describe('§11 mỗi tổ chức tối đa MỘT gói đang hiệu lực', () => {
  const INSERT_SUB = `INSERT INTO subscriptions
      (tenant_id, plan_id, order_id, status, plan_code, plan_name, price_vnd,
       period_start, period_end)
    VALUES (?, ?, ?, ?, 'pro', 'Chuyên nghiệp', 299000,
            NOW(3), NOW(3) + INTERVAL 30 DAY)`;

  it('hai dòng active cùng tổ chức -> bị từ chối', async () => {
    await mysqlPool.query(INSERT_SUB, [f.tenantId, f.planId, f.orderId, 'active']);

    const orderId2 = await makeOrder(f.tenantId, f.planId, f.methodId, 'BITEST00002');
    const code = await loiKhiChay(INSERT_SUB, [f.tenantId, f.planId, orderId2, 'active']);
    expect(code).toBe('ER_DUP_ENTRY');
  });

  it('nhưng nhiều dòng ĐÃ KẾT THÚC thì thoải mái — lịch sử phải giữ được', async () => {
    // NULL không bao giờ đụng NULL trong một UNIQUE, nên mọi dòng không phải
    // `active` tự rơi khỏi ràng buộc. Không có ca này thì lần gia hạn thứ hai
    // của một tổ chức sẽ hỏng, và triệu chứng là một lỗi trùng khoá không nói
    // gì về nguyên nhân.
    await mysqlPool.query(INSERT_SUB, [f.tenantId, f.planId, f.orderId, 'superseded']);

    const orderId2 = await makeOrder(f.tenantId, f.planId, f.methodId, 'BITEST00002');
    const code = await loiKhiChay(INSERT_SUB, [f.tenantId, f.planId, orderId2, 'expired']);
    expect(code).toBe('KHÔNG NÉM LỖI');
  });

  it('ghi đè thủ công KHÔNG có lý do -> bị từ chối', async () => {
    // Đề bài yêu cầu "admin ghi đè gói, có lý do và audit log". Ép ở database
    // chứ không ở zod: yêu cầu này sẽ sống lâu hơn bất kỳ handler nào, và nó là
    // thứ đầu tiên kiểm toán sẽ hỏi tới.
    const code = await loiKhiChay(
      `INSERT INTO subscriptions
         (tenant_id, plan_id, order_id, source, plan_code, plan_name, price_vnd,
          period_start, period_end)
       VALUES (?, ?, NULL, 'admin_override', 'pro', 'X', 0,
               NOW(3), NOW(3) + INTERVAL 30 DAY)`,
      [f.tenantId, f.planId],
    );
    expect(code).toBe('ER_CHECK_CONSTRAINT_VIOLATED');
  });

  it('ghi đè thủ công CÓ người cấp và lý do -> chấp nhận, dù không có đơn hàng nào', async () => {
    /*
     * Ca này canh một chi tiết tinh tế của InnoDB, không phải canh nghiệp vụ.
     *
     * `fk_subscriptions_order` là khoá ngoại GHÉP `(tenant_id, order_id)`, và
     * `order_id` ở đây là NULL. InnoDB dùng ngữ nghĩa MATCH SIMPLE: chỉ cần một
     * cột trong khoá là NULL thì ràng buộc coi như thoả. Nếu ai đó "sửa cho
     * chặt" bằng cách đổi `order_id` thành NOT NULL thì luồng ghi đè thủ công
     * chết ngay, và ca này là thứ nói ra điều đó.
     */
    const code = await loiKhiChay(
      `INSERT INTO subscriptions
         (tenant_id, plan_id, order_id, source, granted_by, reason,
          plan_code, plan_name, price_vnd, period_start, period_end)
       VALUES (?, ?, NULL, 'admin_override', ?, 'Khách ký hợp đồng riêng',
               'business', 'Doanh nghiệp', 0, NOW(3), NOW(3) + INTERVAL 365 DAY)`,
      [f.tenantId, f.planId, f.userId],
    );
    expect(code).toBe('KHÔNG NÉM LỖI');
  });

  it('chu kỳ kết thúc TRƯỚC khi bắt đầu -> bị từ chối', async () => {
    const code = await loiKhiChay(
      `INSERT INTO subscriptions
         (tenant_id, plan_id, order_id, plan_code, plan_name, price_vnd,
          period_start, period_end)
       VALUES (?, ?, ?, 'pro', 'X', 299000, NOW(3), NOW(3) - INTERVAL 1 DAY)`,
      [f.tenantId, f.planId, f.orderId],
    );
    expect(code).toBe('ER_CHECK_CONSTRAINT_VIOLATED');
  });
});

describe('§11 đơn hàng', () => {
  it('mã đơn trùng nhau -> bị từ chối, và đó là thứ vòng thử lại dựa vào', async () => {
    // `order_code` sinh ngẫu nhiên 56 bit nên va chạm là chuyện lý thuyết, và
    // tầng dịch vụ bắt `ER_DUP_ENTRY` rồi sinh mã khác. Tính duy nhất phải do
    // DATABASE bảo đảm chứ không do một câu SELECT kiểm trước — hai request
    // song song đi qua câu SELECT đó cùng lúc là chuyện bình thường.
    const code = await loiKhiChay(
      `INSERT INTO orders
         (tenant_id, order_code, plan_id, payment_method_id, amount_vnd,
          plan_code, plan_name, plan_duration_days, expires_at)
       VALUES (?, 'BITEST00001', ?, ?, 299000, 'pro', 'X', 30,
               NOW(3) + INTERVAL 15 MINUTE)`,
      [f.tenantId, f.planId, f.methodId],
    );
    expect(code).toBe('ER_DUP_ENTRY');
  });

  it('đơn `paid` mà không có thời điểm trả tiền -> bị từ chối', async () => {
    // Hai đường xác nhận (webhook và thủ công) là hai hàm khác nhau; không hàm
    // nào một mình giữ được bất biến này.
    const code = await loiKhiChay('UPDATE orders SET status = ? WHERE id = ?', [
      'paid',
      f.orderId,
    ]);
    expect(code).toBe('ER_CHECK_CONSTRAINT_VIOLATED');
  });

  it('số tiền vượt trần -> bị từ chối ngay tại INSERT', async () => {
    // Trần không phải để chống tràn số mà để bắt lỗi nhân sai đơn vị — nhân
    // 1000 lặp lại là lỗi kinh điển khi làm việc với VND. Không có nó thì một
    // đơn 299 tỷ đồng nằm im chờ quản trị viên duyệt.
    const code = await loiKhiChay(
      `INSERT INTO orders
         (tenant_id, order_code, plan_id, payment_method_id, amount_vnd,
          plan_code, plan_name, plan_duration_days, expires_at)
       VALUES (?, 'BITEST99999', ?, ?, 299000000000, 'pro', 'X', 30,
               NOW(3) + INTERVAL 15 MINUTE)`,
      [f.tenantId, f.planId, f.methodId],
    );
    expect(code).toBe('ER_CHECK_CONSTRAINT_VIOLATED');
  });

  it('gói đang có đơn hàng thì KHÔNG xoá cứng được', async () => {
    // RESTRICT là thứ biến lời hứa "đơn cũ giữ đúng giá" thành khả thi: ảnh
    // chụp trong `orders` vẫn còn, và dòng `plans` mà nó trỏ tới cũng vậy. Xoá
    // mềm bằng `deleted_at` + `is_public = 0` là đường duy nhất.
    const code = await loiKhiChay('DELETE FROM plans WHERE id = ?', [f.planId]);
    expect(code).toBe('ER_ROW_IS_REFERENCED_2');
  });
});

describe('§11 nhật ký kiểm toán', () => {
  it('ghi được hành động của superadmin KHÔNG thuộc tổ chức nào', async () => {
    // `tenant_id` NULL là trường hợp thật, không phải phòng xa: superadmin đổi
    // giá gói Pro thì hành động đó không nằm trong tổ chức nào cả.
    const code = await loiKhiChay(
      `INSERT INTO audit_logs
         (tenant_id, actor_user_id, actor_email, actor_platform_role,
          action, entity_type, entity_id, before_json, after_json)
       VALUES (NULL, ?, 'ops@bi.test', 'superadmin',
               'plan.update', 'plan', ?, ?, ?)`,
      [f.userId, f.planId, JSON.stringify({ priceVnd: 299000 }), JSON.stringify({ priceVnd: 349000 })],
    );
    expect(code).toBe('KHÔNG NÉM LỖI');
  });

  it('SỐNG SÓT khi tổ chức bị xoá — nhật ký không có khoá ngoại', async () => {
    /*
     * Đây là toàn bộ lý do bảng này không có khoá ngoại nào.
     *
     * `ON DELETE CASCADE` sẽ khiến việc xoá một tổ chức phi tang luôn bằng
     * chứng về những gì đã làm với nó — chính xác điều mà một nhật ký kiểm toán
     * tồn tại để ngăn. `RESTRICT` thì không bao giờ dọn được dữ liệu.
     */
    const tenantTam = await makeTenant('Công ty Beta', 'cong-ty-beta');
    await mysqlPool.query(
      `INSERT INTO audit_logs (tenant_id, actor_email, action, entity_type, entity_id)
       VALUES (?, 'admin@beta.test', 'subscription.admin_override', 'subscription', 1)`,
      [tenantTam],
    );

    await mysqlPool.query('DELETE FROM tenants WHERE id = ?', [tenantTam]);

    const [rows] = await mysqlPool.query<RowDataPacket[]>(
      'SELECT actor_email, action FROM audit_logs WHERE tenant_id = ?',
      [tenantTam],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.['actor_email']).toBe('admin@beta.test');
  });
});

describe('§11 webhook', () => {
  it('phát lại NGUYÊN VĂN một sự kiện cũ bị chặn ngay tại INSERT', async () => {
    // Chặn trước khi dòng code xử lý đầu tiên chạy. Đây là lý do `event_id` là
    // NOT NULL và mặc định bằng sha256(raw body) khi cổng không cấp id sự kiện
    // — để NULL thì hỏng hẳn, vì MySQL cho phép nhiều NULL trong một UNIQUE.
    const sql = `INSERT INTO payment_webhook_events
        (provider, event_id, signature_valid, order_code, payload)
      VALUES ('payos', 'evt_abc123', 1, 'BITEST00001', ?)`;
    await mysqlPool.query(sql, [JSON.stringify({ ok: true })]);

    const code = await loiKhiChay(sql, [JSON.stringify({ ok: true })]);
    expect(code).toBe('ER_DUP_ENTRY');
  });

  it('webhook CHỮ KÝ SAI vẫn được lưu, và không cần đơn hàng nào có thật', async () => {
    // Vứt nó đi là vứt luôn bằng chứng duy nhất rằng có người đang thử. Và
    // `order_code` trỏ vào hư không phải ghi được — đó chính là dấu hiệu của
    // một lần dò tìm hoặc một lỗi cấu hình.
    const code = await loiKhiChay(
      `INSERT INTO payment_webhook_events
         (provider, event_id, signature, signature_valid, order_code, payload, error)
       VALUES ('sepay', 'evt_gia_mao', 'chu-ky-sai', 0, 'BIKHONGCO01', ?, 'chữ ký không khớp')`,
      [JSON.stringify({ amount: 1 })],
    );
    expect(code).toBe('KHÔNG NÉM LỖI');
  });
});
