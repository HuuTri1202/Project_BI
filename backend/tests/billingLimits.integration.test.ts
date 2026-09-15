import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
import { closeMysql, mysqlPool } from '../src/config/mysql';
import { closeRedis } from '../src/config/redis';
import { resetDatabase } from './helpers/db';
import {
  bearer,
  capGoiKhongGioiHan,
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

/** Một bộ dữ liệu đã nạp xong trong một workspace mới — chỉ MySQL, không cần kho. */
async function datasetSan(
  tenantId: number,
  slug: string,
): Promise<{ workspaceId: number; datasetId: number }> {
  const workspaceId = await makeWorkspace(tenantId, slug, slug);
  const [ds] = await mysqlPool.query<ResultSetHeader>(
    `INSERT INTO datasets
       (tenant_id, source, workspace_id, name, original_filename, file_ext,
        status, load_status, column_count, row_count)
     VALUES (?, 'file', ?, 'don-hang', 'don-hang.csv', 'csv', 'ready', 'loaded', 2, 10)`,
    [tenantId, workspaceId],
  );
  return { workspaceId, datasetId: ds.insertId };
}

async function demBaoCao(tenantId: number): Promise<number> {
  const [rows] = await mysqlPool.query<(RowDataPacket & { n: number })[]>(
    'SELECT COUNT(*) AS n FROM reports WHERE tenant_id = ? AND deleted_at IS NULL',
    [tenantId],
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * Hạn mức BÁO CÁO trên cả ba đường tạo — §11.2, siết lại.
 *
 * ═══ Lỗi đã có thật ════════════════════════════════════════════════════════
 *
 * `POST /reports` và `POST /reports/from-datamodel` có kiểm, còn
 * `POST /reports/canvas` thì KHÔNG — và đó lại là đường DUY NHẤT trình dựng gọi
 * tới. Gói Miễn phí (3 báo cáo) tạo được báo cáo thứ tư, thứ năm… qua giao diện;
 * tổ chức seed trên máy dev đang ở Miễn phí với 5 báo cáo.
 *
 * Hai đường có kiểm thì kiểm trên pool rồi ghi trên một connection khác, không
 * khoá: N request cùng lúc cùng thấy "còn một chỗ".
 */
describe('Hạn mức báo cáo', () => {
  interface MoHinh {
    token: string;
    modelId: number;
    datasetId: number;
    dimensionId: number;
    measureId: number;
  }

  let soMoHinh = 0;

  /** Một mô hình tối thiểu dựng được báo cáo — mỗi lần gọi một workspace riêng. */
  async function moHinh(tenantId: number, token: string): Promise<MoHinh> {
    soMoHinh += 1;
    const { workspaceId, datasetId } = await datasetSan(
      tenantId,
      `kho-mo-hinh-${String(soMoHinh)}`,
    );
    const [m] = await mysqlPool.query<ResultSetHeader>(
      'INSERT INTO datamodels (tenant_id, workspace_id, name) VALUES (?, ?, ?)',
      [tenantId, workspaceId, 'Mo hinh'],
    );
    const [ref] = await mysqlPool.query<ResultSetHeader>(
      'INSERT INTO datamodel_datasets (tenant_id, datamodel_id, dataset_id) VALUES (?, ?, ?)',
      [tenantId, m.insertId, datasetId],
    );
    const [col] = await mysqlPool.query<ResultSetHeader>(
      `INSERT INTO datamodel_columns
         (tenant_id, datamodel_dataset_id, column_name, role, ch_type, ordinal)
       VALUES (?, ?, 'khu_vuc', 'dimension', 'Nullable(String)', 0)`,
      [tenantId, ref.insertId],
    );
    const thuocDo = await request(app)
      .post(`/api/v1/datamodels/${String(m.insertId)}/measures`)
      .set(bearer(token))
      .send({ datamodelDatasetId: ref.insertId, name: 'So dong', agg: 'count' })
      .expect(201);

    return {
      token,
      modelId: m.insertId,
      datasetId,
      dimensionId: col.insertId,
      measureId: thuocDo.body.id as number,
    };
  }

  /** Ba đường tạo báo cáo mà API mở ra. */
  const DUONG_TAO = {
    canvas: (mh: MoHinh, name: string) =>
      request(app)
        .post('/api/v1/reports/canvas')
        .set(bearer(mh.token))
        .send({
          datamodelId: mh.modelId,
          name,
          canvas: {
            visuals: [
              {
                id: 'a',
                chartType: 'bar',
                config: { dimensionId: mh.dimensionId, measureId: mh.measureId, limit: 10 },
                x: 0,
                y: 0,
                w: 6,
                h: 6,
              },
            ],
          },
        }),
    'from-datamodel': (mh: MoHinh, name: string) =>
      request(app)
        .post('/api/v1/reports/from-datamodel')
        .set(bearer(mh.token))
        .send({
          datamodelId: mh.modelId,
          name,
          chartType: 'bar',
          config: { dimensionId: mh.dimensionId, measureId: mh.measureId, limit: 10 },
        }),
    dataset: (mh: MoHinh, name: string) =>
      request(app)
        .post('/api/v1/reports')
        .set(bearer(mh.token))
        .send({ datasetId: mh.datasetId, name }),
  };

  for (const [ten, tao] of Object.entries(DUONG_TAO)) {
    it(`gói Miễn phí cho 3 báo cáo, cái thứ tư bị chặn — đường ${ten}`, async () => {
      const mh = await moHinh(f.tenantA, f.tokenAdminA);

      for (const so of [1, 2, 3]) {
        const res = await tao(mh, `Bao cao ${String(so)}`);
        expect(res.status, JSON.stringify(res.body)).toBe(201);
      }

      const thuTu = await tao(mh, 'Bao cao 4');
      expect(thuTu.status).toBe(409);
      expect(thuTu.body.error).toBe('LimitExceeded');
      expect(thuTu.body.message).toContain('Miễn phí');
      expect(thuTu.body.message).toContain('3 báo cáo');
      expect(await demBaoCao(f.tenantA)).toBe(3);
    });
  }

  it('tạo SONG SONG khi còn đúng một chỗ: một cái qua, mọi cái còn lại bị chặn', async () => {
    const mh = await moHinh(f.tenantA, f.tokenAdminA);
    await DUONG_TAO.canvas(mh, 'Mot').expect(201);
    await DUONG_TAO.canvas(mh, 'Hai').expect(201);

    // Trộn cả ba đường: khoá phải là MỘT cho cả tổ chức, không phải một cho
    // mỗi route.
    const ketQua = await Promise.all([
      DUONG_TAO.canvas(mh, 'Song song 1'),
      DUONG_TAO['from-datamodel'](mh, 'Song song 2'),
      DUONG_TAO.dataset(mh, 'Song song 3'),
      DUONG_TAO.canvas(mh, 'Song song 4'),
      DUONG_TAO['from-datamodel'](mh, 'Song song 5'),
      DUONG_TAO.canvas(mh, 'Song song 6'),
    ]);

    expect(ketQua.map((r) => r.status).sort()).toEqual([201, 409, 409, 409, 409, 409]);
    expect(await demBaoCao(f.tenantA)).toBe(3);
  });

  it('gói Chuyên nghiệp cho 50: cái thứ 51 bị chặn', async () => {
    const mh = await moHinh(f.tenantA, f.tokenAdminA);
    await ganGoi(f.tenantA, f.planPro, { reports: 50 }, f.adminA);
    for (let so = 1; so <= 49; so += 1) {
      await mysqlPool.query(
        `INSERT INTO reports (tenant_id, workspace_id, dataset_id, name, created_by)
         SELECT tenant_id, workspace_id, id, ?, ? FROM datasets WHERE id = ?`,
        [`Co san ${String(so)}`, f.adminA, mh.datasetId],
      );
    }
    expect(await demBaoCao(f.tenantA)).toBe(49);

    await DUONG_TAO.canvas(mh, 'Thu 50').expect(201);
    const res = await DUONG_TAO.canvas(mh, 'Thu 51').expect(409);
    expect(res.body.message).toContain('50 báo cáo');
  });

  it('gói Doanh nghiệp không giới hạn báo cáo', async () => {
    const mh = await moHinh(f.tenantA, f.tokenAdminA);
    await capGoiKhongGioiHan(f.tenantA, f.adminA);
    for (const so of [1, 2, 3, 4, 5]) {
      await DUONG_TAO.canvas(mh, `Bao cao ${String(so)}`).expect(201);
    }
  });

  it('báo cáo nằm trong workspace ĐÃ XOÁ không chiếm chỗ', async () => {
    // Quản trị hệ thống xoá mềm một workspace thì báo cáo trong đó biến khỏi
    // mọi danh sách. Vẫn đếm chúng là chặn khách vì những thứ họ không còn thấy
    // và không còn xoá được.
    const mh = await moHinh(f.tenantA, f.tokenAdminA);
    const cu = await datasetSan(f.tenantA, 'da-xoa');
    for (const so of [1, 2, 3]) {
      await mysqlPool.query(
        `INSERT INTO reports (tenant_id, workspace_id, dataset_id, name, created_by)
         VALUES (?, ?, ?, ?, ?)`,
        [f.tenantA, cu.workspaceId, cu.datasetId, `Cu ${String(so)}`, f.adminA],
      );
    }
    await mysqlPool.query('UPDATE workspaces SET deleted_at = NOW(3) WHERE id = ?', [
      cu.workspaceId,
    ]);

    await DUONG_TAO.canvas(mh, 'Moi').expect(201);
  });

  it('báo cáo trên mô hình ĐÃ XOÁ không chiếm chỗ, và số hiển thị khớp số chặn', async () => {
    // Máy dev: tổ chức seed bị tính 5 báo cáo mà danh sách hiện 0 — cả năm nằm
    // trên mô hình đã xoá.
    const cu = await moHinh(f.tenantA, f.tokenAdminA);
    for (const so of [1, 2, 3]) {
      await DUONG_TAO.canvas(cu, `Tren mo hinh cu ${String(so)}`).expect(201);
    }
    await mysqlPool.query('UPDATE datamodels SET deleted_at = NOW(3) WHERE id = ?', [cu.modelId]);

    const me = await request(app)
      .get('/api/v1/billing/plan')
      .set(bearer(f.tokenAdminA))
      .expect(200);
    expect(me.body.usage.reports).toEqual({ used: 0, limit: 3 });

    const moi = await moHinh(f.tenantA, f.tokenAdminA);
    await DUONG_TAO.canvas(moi, 'Moi').expect(201);
  });
});

describe('Hạn mức workspace có khoá', () => {
  it('tạo SONG SONG không vượt được hạn mức', async () => {
    await ganGoi(f.tenantA, f.planPro, { workspaces: 2 }, f.adminA);
    await makeWorkspace(f.tenantA, 'Co san', 'co-san');

    const ketQua = await Promise.all(
      ['A', 'B', 'C', 'D', 'E'].map((ten) =>
        request(app)
          .post('/api/v1/workspaces')
          .set(bearer(f.tokenAdminA))
          .send({ name: `Song song ${ten}` }),
      ),
    );

    expect(ketQua.map((r) => r.status).sort()).toEqual([201, 409, 409, 409, 409]);
    const [rows] = await mysqlPool.query<(RowDataPacket & { n: number })[]>(
      'SELECT COUNT(*) AS n FROM workspaces WHERE tenant_id = ? AND deleted_at IS NULL',
      [f.tenantA],
    );
    expect(Number(rows[0]?.n)).toBe(2);
  });
});

/**
 * Thành viên dùng CHUNG gói của tổ chức — kể cả người không quản lý thanh toán.
 *
 * Gói gắn với tổ chức, nên creator và viewer vốn được hưởng hạn mức của gói mà
 * quản trị viên mua. Cái thiếu là họ không THẤY điều đó: huy hiệu gói chỉ hiện
 * cho admin, và `GET /billing/me` trả 403 cho họ.
 */
describe('Thành viên dùng chung gói của tổ chức', () => {
  it('creator của tổ chức trả phí tạo vượt được hạn mức gói Miễn phí', async () => {
    const creator = await makeUser('creator@example.com', 'Nguoi Tao');
    await makeMembership(creator, f.tenantA, 'creator');
    await capGoiKhongGioiHan(f.tenantA, f.adminA);
    const { datasetId } = await datasetSan(f.tenantA, 'kho');

    const tokenCreator = signTokenFor(creator, f.tenantA, 'creator');
    for (const ten of ['Mot', 'Hai', 'Ba', 'Bon']) {
      await request(app)
        .post('/api/v1/reports')
        .set(bearer(tokenCreator))
        .send({ datasetId, name: ten })
        .expect(201);
    }
  });

  it('creator của tổ chức Miễn phí bị chặn ở báo cáo thứ tư như admin', async () => {
    const creator = await makeUser('creator@example.com', 'Nguoi Tao');
    await makeMembership(creator, f.tenantA, 'creator');
    const { datasetId } = await datasetSan(f.tenantA, 'kho');

    const tokenCreator = signTokenFor(creator, f.tenantA, 'creator');
    for (const ten of ['Mot', 'Hai', 'Ba']) {
      await request(app)
        .post('/api/v1/reports')
        .set(bearer(tokenCreator))
        .send({ datasetId, name: ten })
        .expect(201);
    }
    await request(app)
      .post('/api/v1/reports')
      .set(bearer(tokenCreator))
      .send({ datasetId, name: 'Bon' })
      .expect(409);
  });

  it('mọi vai trò đọc được gói đang hiệu lực của tổ chức', async () => {
    await capGoiKhongGioiHan(f.tenantA, f.adminA);

    for (const role of ['admin', 'creator', 'viewer'] as const) {
      const u = role === 'admin' ? f.adminA : await makeUser(`${role}@example.com`, role);
      if (role !== 'admin') await makeMembership(u, f.tenantA, role);

      const res = await request(app)
        .get('/api/v1/billing/plan')
        .set(bearer(signTokenFor(u, f.tenantA, role)))
        .expect(200);

      expect(res.body).toMatchObject({
        planCode: 'business',
        planName: 'Doanh nghiệp',
        isPaid: true,
      });
      expect(res.body.usage.reports).toEqual({ used: 0, limit: null });
      expect(res.body.periodEnd).toEqual(expect.any(String));
      // Chỉ thứ thành viên cần để biết mình được làm gì — không giá, không lịch
      // sử đơn, không nguồn cấp gói.
      expect(Object.keys(res.body).sort()).toEqual([
        'isPaid',
        'periodEnd',
        'planCode',
        'planName',
        'usage',
      ]);
    }
  });

  it('tổ chức chưa mua gì thì mọi thành viên thấy Miễn phí và hạn mức của nó', async () => {
    const viewer = await makeUser('viewer@example.com', 'Nguoi Xem');
    await makeMembership(viewer, f.tenantA, 'viewer');

    const res = await request(app)
      .get('/api/v1/billing/plan')
      .set(bearer(signTokenFor(viewer, f.tenantA, 'viewer')))
      .expect(200);

    expect(res.body).toMatchObject({ planCode: 'free', isPaid: false, periodEnd: null });
    expect(res.body.usage.reports).toEqual({ used: 0, limit: 3 });
  });
});
