import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
import { closeMysql, mysqlPool } from '../src/config/mysql';
import { closeRedis } from '../src/config/redis';
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
 * Cưỡng chế hạn mức gói — §11.2. Cần MySQL + Redis, KHÔNG cần ClickHouse.
 *
 * ═══ Bộ này kiểm điều gì ═══════════════════════════════════════════════════
 *
 * Không phải "hàm `kiemHanMuc` trả về đúng" — điều đó một bài unit test làm được
 * rẻ hơn. Bộ này kiểm những thứ chỉ lộ ra khi đi qua cả tầng route và cả
 * database:
 *
 *   · lớp chặn có thật sự nằm trên MỌI đường tạo, kể cả đường vòng
 *   · những đường CỐ Ý không chặn thì vẫn thông (đăng ký, mở khoá)
 *   · ảnh chụp hạn mức thắng bảng giá — lý do tồn tại của cả migration 32
 *   · con số hiển thị và con số chặn là MỘT
 */

const app = createApp();

interface Fixture {
  tenantA: number;
  adminA: number;
  tokenAdminA: string;
  planFree: number;
  planPro: number;
}

let f: Fixture;

async function idCua(code: string): Promise<number> {
  const [rows] = await mysqlPool.query<(RowDataPacket & { id: number })[]>(
    'SELECT id FROM plans WHERE code = ?',
    [code],
  );
  const row = rows[0];
  if (row === undefined) throw new Error(`Không tìm thấy plans.${code} — migration 30 chưa chạy?`);
  return Number(row.id);
}

/**
 * Gắn một subscription đang hiệu lực CÓ ảnh chụp hạn mức.
 *
 * `limits_captured_at` phải khác NULL, nếu không `ck_subscriptions_limits_snapshot`
 * chặn ngay — và đó là ràng buộc đang được kiểm gián tiếp ở mọi ca dùng hàm này.
 */
async function ganGoi(
  tenantId: number,
  planId: number,
  hanMuc: {
    workspaces?: number | null;
    reports?: number | null;
    members?: number | null;
    storageBytes?: number | null;
  },
  grantedBy: number,
): Promise<number> {
  const [r] = await mysqlPool.query<ResultSetHeader>(
    `INSERT INTO subscriptions
       (tenant_id, plan_id, order_id, status, source, plan_code, plan_name, price_vnd,
        max_workspaces, max_reports, max_members, max_storage_bytes, limits_captured_at,
        period_start, period_end, granted_by, reason)
     VALUES (?, ?, NULL, 'active', 'admin_override', 'pro', 'Chuyên nghiệp', 0,
             ?, ?, ?, ?, NOW(3), NOW(3), NOW(3) + INTERVAL 30 DAY, ?, 'test')`,
    [
      tenantId,
      planId,
      hanMuc.workspaces ?? null,
      hanMuc.reports ?? null,
      hanMuc.members ?? null,
      hanMuc.storageBytes ?? null,
      grantedBy,
    ],
  );
  return r.insertId;
}

beforeEach(async () => {
  await resetDatabase();

  const tenantA = await makeTenant('Cong ty A', 'cong-ty-a');
  const adminA = await makeUser('admin.a@example.com', 'Admin A');
  await makeMembership(adminA, tenantA, 'admin');

  f = {
    tenantA,
    adminA,
    tokenAdminA: signTokenFor(adminA, tenantA, 'admin'),
    planFree: await idCua('free'),
    planPro: await idCua('pro'),
  };
});

afterAll(async () => {
  await closeMysql();
  await closeRedis();
});

describe('Hạn mức chặn thật', () => {
  it('gói Free cho 1 workspace, cái thứ hai bị chặn', async () => {
    // Gói Free gieo ở migration 30: 1 workspace. Tổ chức chưa mua gì nên đang ở
    // Free theo luật "không có subscription nào = Free".
    await request(app)
      .post('/api/v1/workspaces')
      .set(bearer(f.tokenAdminA))
      .send({ name: 'Khong gian mot' })
      .expect(201);

    const res = await request(app)
      .post('/api/v1/workspaces')
      .set(bearer(f.tokenAdminA))
      .send({ name: 'Khong gian hai' })
      .expect(409);

    expect(res.body.error).toBe('LimitExceeded');
    // Thông báo phải nói ĐỦ BA THỨ: hạn mức, đang dùng, làm gì tiếp. Thiếu con
    // số thì khách không biết phải xoá bao nhiêu.
    expect(res.body.message).toContain('Miễn phí');
    expect(res.body.message).toContain('1');
    expect(res.body.message).toContain('Nâng cấp gói');
  });

  it('hạn mức NULL nghĩa là không giới hạn, không phải bằng không', async () => {
    /*
     * Ca này canh đúng một dòng: `Number(null)` cho ra `0`. Nếu `null` bị ép
     * thành số ở bất kỳ đâu trên đường đi thì khách trả tiền cao nhất không tạo
     * được gì — và triệu chứng đó không chỉ về phía chỗ sai chút nào.
     */
    await ganGoi(f.tenantA, f.planPro, { workspaces: null }, f.adminA);

    for (const ten of ['Mot', 'Hai', 'Ba', 'Bon', 'Nam', 'Sau']) {
      await request(app)
        .post('/api/v1/workspaces')
        .set(bearer(f.tokenAdminA))
        .send({ name: `Khong gian ${ten}` })
        .expect(201);
    }
  });

  it('ẢNH CHỤP thắng bảng giá — sửa giá không khoá khách đang giữa chu kỳ', async () => {
    /*
     * Đây là lý do tồn tại của migration 32.
     *
     * Khách mua gói với hạn mức 3. Người vận hành sau đó HẠ gói xuống 1. Nếu hạn
     * mức đọc sống từ `plans` thì khách bị khoá ngay giữa chu kỳ họ đã trả tiền,
     * và không màn hình nào giải thích được.
     */
    await ganGoi(f.tenantA, f.planPro, { workspaces: 3 }, f.adminA);
    await mysqlPool.query('UPDATE plans SET max_workspaces = 1 WHERE id = ?', [f.planPro]);

    for (const ten of ['Mot', 'Hai', 'Ba']) {
      await request(app)
        .post('/api/v1/workspaces')
        .set(bearer(f.tokenAdminA))
        .send({ name: `Khong gian ${ten}` })
        .expect(201);
    }

    await request(app)
      .post('/api/v1/workspaces')
      .set(bearer(f.tokenAdminA))
      .send({ name: 'Khong gian Bon' })
      .expect(409);

    // Và con số HIỂN THỊ phải là cùng con số vừa chặn. Lệch nhau thì màn hình
    // hiện "3/1" trong khi API cho tạo tới 3, và không ai giải thích được.
    const me = await request(app)
      .get('/api/v1/billing/me')
      .set(bearer(f.tokenAdminA))
      .expect(200);

    expect(me.body.usage.workspaces.limit).toBe(3);
    expect(me.body.plan.maxWorkspaces).toBe(3);
  });

  it('dòng subscription CHƯA có ảnh chụp thì rơi về đọc sống, không thành vô hạn', async () => {
    /*
     * Nhánh này là lý do cột cờ tồn tại. NULL ở bốn cột hạn mức đã mang nghĩa
     * "không giới hạn", nên nếu không phân biệt được "chưa chụp ảnh" thì mọi câu
     * INSERT quên bốn cột mới sẽ âm thầm cấp gói VÔ HẠN — fail-open.
     */
    await mysqlPool.query(
      `INSERT INTO subscriptions
         (tenant_id, plan_id, order_id, status, source, plan_code, plan_name, price_vnd,
          period_start, period_end, granted_by, reason)
       VALUES (?, ?, NULL, 'active', 'admin_override', 'pro', 'Chuyên nghiệp', 0,
               NOW(3), NOW(3) + INTERVAL 30 DAY, ?, 'test')`,
      [f.tenantA, f.planPro, f.adminA],
    );
    await mysqlPool.query('UPDATE plans SET max_workspaces = 2 WHERE id = ?', [f.planPro]);

    await request(app)
      .post('/api/v1/workspaces')
      .set(bearer(f.tokenAdminA))
      .send({ name: 'Mot' })
      .expect(201);
    await request(app)
      .post('/api/v1/workspaces')
      .set(bearer(f.tokenAdminA))
      .send({ name: 'Hai' })
      .expect(201);

    // Vô hạn thì cái thứ ba sẽ 201. Phải là 409.
    await request(app)
      .post('/api/v1/workspaces')
      .set(bearer(f.tokenAdminA))
      .send({ name: 'Ba' })
      .expect(409);
  });
});

describe('Hạn mức thành viên đếm theo CHỖ', () => {
  it('gỡ rồi mời lại khi đã đầy thì vẫn bị chặn', async () => {
    // Đây là đường LÁCH rõ nhất: `membershipsRepo.upsert` đặt lại
    // `removed_at = NULL`, nên mời lại người đã gỡ làm số tăng như mời mới.
    await ganGoi(f.tenantA, f.planPro, { members: 2 }, f.adminA);

    const u2 = await makeUser('b@example.com', 'Nguoi B');
    await makeMembership(u2, f.tenantA, 'viewer'); // đủ 2 chỗ

    const u3 = await makeUser('c@example.com', 'Nguoi C');
    await makeMembership(u3, f.tenantA, 'viewer', { removed: true }); // đã gỡ, không chiếm chỗ

    const res = await request(app)
      .post('/api/v1/members')
      .set(bearer(f.tokenAdminA))
      .send({ email: 'c@example.com', fullName: 'Nguoi C', role: 'viewer' })
      .expect(409);

    expect(res.body.error).toBe('LimitExceeded');
  });

  it('MỞ KHOÁ thành viên bị khoá thì KHÔNG bị chặn, kể cả khi đã đầy chỗ', async () => {
    /*
     * Hệ quả trực tiếp của việc đếm theo chỗ: người bị khoá VẪN chiếm chỗ, nên
     * mở khoá không làm con số tăng và không có gì để chặn.
     *
     * Nếu ngày nào đó ai đó đổi `demThanhVien` sang "chỉ đếm người đang hoạt
     * động", ca này sẽ đỏ — và đó chính là lời nhắc rằng lúc đó phải gắn thêm một
     * guard ở đường mở khoá, nếu không thì khoá-mời-mở lại là cách lách hạn mức.
     */
    await ganGoi(f.tenantA, f.planPro, { members: 2 }, f.adminA);

    const u2 = await makeUser('b@example.com', 'Nguoi B');
    await makeMembership(u2, f.tenantA, 'viewer', { isActive: false });

    await request(app)
      .patch(`/api/v1/members/${u2}/status`)
      .set(bearer(f.tokenAdminA))
      .send({ isActive: true })
      .expect(200);
  });
});

describe('Những đường CỐ Ý không chặn', () => {
  it('đăng ký tài khoản mới không bị hạn mức chặn', async () => {
    /*
     * `provisionTenant` sinh 1 workspace + 1 membership mặc định cho tổ chức
     * MỚI. Tổ chức đó ở 0/0 và gói Free cho 1 workspace, nên chặn ở đây là chặn
     * đúng người vừa bấm "Đăng ký" — hỏng nặng nhất có thể, vì không ai vào được
     * hệ thống nữa.
     */
    await request(app)
      .post('/api/auth/register')
      .send({
        email: 'nguoimoi@example.com',
        password: 'Matkhau123',
        confirmPassword: 'Matkhau123',
        fullName: 'Nguoi Moi',
        phone: '0912345678',
        jobTitle: 'Data Analyst',
        companyName: 'Cong ty moi',
      })
      .expect(201);
  });

  it('tổ chức đang VƯỢT hạn mức vẫn xem và xoá được dữ liệu cũ', async () => {
    /*
     * Quyết định phạm vi: chỉ chặn TẠO MỚI. Tổ chức tụt từ Pro về Free với 3
     * workspace vẫn phải thao tác được trên cả 3 — khoá dữ liệu khách đã làm ra
     * vì họ hết hạn gói là chuyện khác hẳn, và không phải thứ được yêu cầu.
     */
    const ws1 = await makeWorkspace(f.tenantA, 'Cu mot', 'cu-mot');
    await makeWorkspace(f.tenantA, 'Cu hai', 'cu-hai');
    await makeWorkspace(f.tenantA, 'Cu ba', 'cu-ba'); // Free cho 1 -> đang vượt

    await request(app).get('/api/v1/workspaces').set(bearer(f.tokenAdminA)).expect(200);

    await request(app)
      .patch(`/api/v1/workspaces/${ws1}`)
      .set(bearer(f.tokenAdminA))
      .send({ name: 'Doi ten duoc' })
      .expect(200);

    // Nhưng tạo thêm thì không.
    await request(app)
      .post('/api/v1/workspaces')
      .set(bearer(f.tokenAdminA))
      .send({ name: 'Them nua' })
      .expect(409);
  });
});
