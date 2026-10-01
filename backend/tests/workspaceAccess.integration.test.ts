import type { ResultSetHeader } from 'mysql2';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
import { closeMysql, mysqlPool } from '../src/config/mysql';
import { closeRedis } from '../src/config/redis';
import { resetDatabase } from './helpers/db';
import {
  bearer,
  capGoiKhongGioiHan,
  grantWorkspace,
  makeMembership,
  makeReport,
  makeTenant,
  makeUser,
  makeWorkspace,
  revokeWorkspace,
  signTokenFor,
} from './helpers/fixtures';

/**
 * Ranh giới WORKSPACE trong một tổ chức — migration 40.
 *
 * ═══ Tình huống thật bộ này dựng lại ═══════════════════════════════════════
 *
 * Một công ty có hai phòng ban, mỗi phòng một workspace: Nhân sự và Kinh doanh.
 * Mời một nhân viên nhân sự vào hệ thống thì họ phải thấy workspace Nhân sự, và
 * KHÔNG thấy workspace Kinh doanh — kể cả khi gõ thẳng id lên thanh địa chỉ.
 *
 * Trước migration 40, `memberships` chỉ nói "người này ở tổ chức nào, vai trò
 * gì", nên mọi thành viên thấy mọi workspace. Vai trò `viewer` không đỡ được:
 * nó giới hạn HÀNH ĐỘNG (không sửa, không xoá) chứ không giới hạn DỮ LIỆU — và
 * đọc được bảng lương của phòng khác vẫn là đọc được bảng lương của phòng khác.
 *
 * ═══ Bộ này canh gì ════════════════════════════════════════════════════════
 *
 * Không phải "danh sách lọc đúng" — chỉ lọc danh sách là lớp sơn. Mỗi ca dưới
 * đây đi vào một CỬA KHÁC nhau dẫn tới cùng dữ liệu đó, vì chặn cửa chính mà
 * quên cửa sau thì không có gì báo: endpoint vẫn trả 200, chỉ là trả dữ liệu
 * của phòng ban khác.
 *
 *   1. Danh sách workspace          — cửa người dùng nhìn thấy
 *   2. Mở thẳng theo id             — gõ số lên URL
 *   3. Chọn workspace cho một màn   — `?workspaceId=` trên mọi màn danh sách
 *   4. Báo cáo / bộ dữ liệu / mô hình theo id — ba cửa sau sâu nhất
 *   5. Admin                        — phải KHÔNG bị chặn, nếu không là tự khoá
 *   6. Gán quyền qua API            — và hai luật của chính nó
 */

const app = createApp();

interface Fixture {
  tenantId: number;
  wsNhanSu: number;
  wsKinhDoanh: number;
  /** Quản trị viên tổ chức — thấy mọi workspace, không có dòng phân quyền nào. */
  tokenAdmin: string;
  /** Nhân viên nhân sự — CHỈ được vào `wsNhanSu`. */
  tokenHr: string;
  hrUserId: number;
  /** Báo cáo nằm trong workspace Kinh doanh — thứ nhân sự không được thấy. */
  reportKinhDoanh: number;
  datasetKinhDoanh: number;
  modelKinhDoanh: number;
}

let f: Fixture;

async function makeDataModel(tenantId: number, workspaceId: number, name: string): Promise<number> {
  const [r] = await mysqlPool.query<ResultSetHeader>(
    'INSERT INTO datamodels (tenant_id, workspace_id, name) VALUES (?, ?, ?)',
    [tenantId, workspaceId, name],
  );
  return r.insertId;
}

beforeEach(async () => {
  await resetDatabase();

  const tenantId = await makeTenant('Công ty Hai Phòng', 'cong-ty-hai-phong');
  const admin = await makeUser('admin@hai-phong.test', 'Trần Thị Quản');
  const hr = await makeUser('hr@hai-phong.test', 'Nguyễn Văn Nhân');

  await makeMembership(admin, tenantId, 'admin');
  await makeMembership(hr, tenantId, 'creator');
  await capGoiKhongGioiHan(tenantId, admin);

  // `makeWorkspace` mở cho mọi thành viên không-phải-admin — đúng điều migration
  // 40 làm với dữ liệu đang có. Ca này cần SIẾT lại, nên gỡ ngay bên dưới.
  const wsNhanSu = await makeWorkspace(tenantId, 'Nhân sự', 'nhan-su');
  const wsKinhDoanh = await makeWorkspace(tenantId, 'Kinh doanh', 'kinh-doanh');
  await revokeWorkspace(wsKinhDoanh, hr);

  const reportKinhDoanh = await makeReport(tenantId, wsKinhDoanh, 'Doanh thu quý 4');
  const [ds] = await mysqlPool.query<ResultSetHeader>(
    `INSERT INTO datasets (tenant_id, workspace_id, name, source, status, load_status)
     VALUES (?, ?, 'Đơn hàng', 'file', 'ready', 'loaded')`,
    [tenantId, wsKinhDoanh],
  );
  const modelKinhDoanh = await makeDataModel(tenantId, wsKinhDoanh, 'Mô hình Kinh doanh');

  f = {
    tenantId,
    wsNhanSu,
    wsKinhDoanh,
    tokenAdmin: signTokenFor(admin, tenantId, 'admin'),
    tokenHr: signTokenFor(hr, tenantId, 'creator'),
    hrUserId: hr,
    reportKinhDoanh,
    datasetKinhDoanh: ds.insertId,
    modelKinhDoanh,
  };
});

afterAll(async () => {
  await closeMysql();
  await closeRedis();
});

describe('Nhân viên chỉ thấy workspace của phòng mình', () => {
  it('danh sách workspace CHỈ có phòng của họ', async () => {
    const res = await request(app).get('/api/v1/workspaces').set(bearer(f.tokenHr));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(f.wsNhanSu);
  });

  it('mở thẳng workspace phòng khác theo id -> 404, KHÔNG phải 403', async () => {
    /*
     * 404 là cố ý. 403 trả lời rằng workspace số đó CÓ TỒN TẠI, và đếm số trên
     * thanh địa chỉ là đủ để dò ra tổ chức này có mấy phòng ban — một rò rỉ nhỏ
     * nhưng không cần thiết. Cùng quy ước đã dùng cho ranh giới tổ chức.
     */
    const res = await request(app)
      .get(`/api/v1/workspaces/${String(f.wsKinhDoanh)}`)
      .set(bearer(f.tokenHr));

    expect(res.status).toBe(404);
  });

  it('`?workspaceId=` trỏ sang phòng khác -> 404 ở MỌI màn danh sách', async () => {
    // Đây là cửa mà một người sửa URL sẽ thử đầu tiên, và nó có mặt trên nhiều
    // màn. Tất cả đi qua `resolveWorkspace`, nên kiểm vài cái đại diện là đủ để
    // bắt được việc ai đó bỏ qua chỗ thắt ấy.
    for (const path of ['/api/v1/reports', '/api/v1/datasets', '/api/v1/datamodels']) {
      const res = await request(app)
        .get(path)
        .query({ workspaceId: f.wsKinhDoanh })
        .set(bearer(f.tokenHr));

      expect(res.status, path).toBe(404);
    }
  });
});

describe('Cửa sau: mở thẳng theo id của từng loại dữ liệu', () => {
  /*
   * Ba ca này là phần quan trọng nhất của cả bộ.
   *
   * Lọc danh sách workspace là thứ nhìn thấy được và dễ tin là đã xong. Nhưng
   * `GET /reports/:id` không nhận `workspaceId` nào cả — nó chỉ nhận một con số
   * — nên nếu câu truy vấn đằng sau chỉ lọc `tenant_id` thì mọi báo cáo của
   * công ty vẫn mở được bằng cách đổi số, và không màn hình nào lộ ra điều đó.
   */
  it('báo cáo của phòng khác -> 404', async () => {
    const res = await request(app)
      .get(`/api/v1/reports/${String(f.reportKinhDoanh)}`)
      .set(bearer(f.tokenHr));

    expect(res.status).toBe(404);
  });

  it('bộ dữ liệu của phòng khác -> 404', async () => {
    const res = await request(app)
      .get(`/api/v1/datasets/${String(f.datasetKinhDoanh)}`)
      .set(bearer(f.tokenHr));

    expect(res.status).toBe(404);
  });

  it('mô hình dữ liệu của phòng khác -> 404', async () => {
    const res = await request(app)
      .get(`/api/v1/datamodels/${String(f.modelKinhDoanh)}`)
      .set(bearer(f.tokenHr));

    expect(res.status).toBe(404);
  });

  it('nhưng dữ liệu trong CHÍNH phòng mình thì vẫn mở bình thường', async () => {
    // Ca đối chứng. Thiếu nó thì một bộ lọc chặn SẠCH mọi thứ cũng cho ba ca
    // trên màu xanh — và tính năng hỏng hoàn toàn mà bộ test vẫn báo tốt.
    const reportNhanSu = await makeReport(f.tenantId, f.wsNhanSu, 'Nhân sự theo tháng');

    const res = await request(app)
      .get(`/api/v1/reports/${String(reportNhanSu)}`)
      .set(bearer(f.tokenHr));

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(reportNhanSu);
  });
});

describe('Quản trị viên tổ chức KHÔNG bị ranh giới này chặn', () => {
  /*
   * Admin không có dòng nào trong `workspace_members` — quyền của họ là một CỜ
   * tính ra từ vai trò. Nếu bộ lọc quên hỏi cái cờ đó thì admin thành người bị
   * khoá chặt nhất trong tổ chức, và chính họ là người phải đi mở khoá cho
   * người khác.
   */
  it('thấy CẢ HAI workspace dù không được gán dòng nào', async () => {
    const res = await request(app).get('/api/v1/workspaces').set(bearer(f.tokenAdmin));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it('mở được báo cáo của mọi phòng', async () => {
    const res = await request(app)
      .get(`/api/v1/reports/${String(f.reportKinhDoanh)}`)
      .set(bearer(f.tokenAdmin));

    expect(res.status).toBe(200);
  });
});

describe('Gán workspace cho thành viên', () => {
  it('gán thêm phòng Kinh doanh thì người đó thấy ngay, không cần đăng nhập lại', async () => {
    /*
     * "Không cần đăng nhập lại" là một tính chất thật, không phải tiện lợi: vai
     * trò và phạm vi đều đọc lại từ database ở MỖI request
     * (`requireFreshMembership`), nên không có trạng thái nào trong token để mà
     * cũ. Nếu ngày nào đó ai đó nhét danh sách workspace vào JWT cho nhanh thì
     * ca này đỏ, và đó đúng là điều cần báo.
     */
    const truoc = await request(app).get('/api/v1/workspaces').set(bearer(f.tokenHr));
    expect(truoc.body).toHaveLength(1);

    const gan = await request(app)
      .put(`/api/v1/members/${String(f.hrUserId)}/workspaces`)
      .set(bearer(f.tokenAdmin))
      .send({ workspaceIds: [f.wsNhanSu, f.wsKinhDoanh] });
    expect(gan.status).toBe(200);

    const sau = await request(app).get('/api/v1/workspaces').set(bearer(f.tokenHr));
    expect(sau.body).toHaveLength(2);
  });

  it('gửi CẢ BỘ nên gỡ bớt cũng là một lần lưu', async () => {
    await request(app)
      .put(`/api/v1/members/${String(f.hrUserId)}/workspaces`)
      .set(bearer(f.tokenAdmin))
      .send({ workspaceIds: [] });

    const res = await request(app).get('/api/v1/workspaces').set(bearer(f.tokenHr));
    expect(res.body).toHaveLength(0);
  });

  it('lưu HAI LẦN cùng một danh sách cho ra cùng kết quả', async () => {
    // Idempotent: giao diện gửi trạng thái cuối cùng, nên bấm Lưu hai lần (hoặc
    // hai tab cùng lưu) không được sinh dòng thứ hai rồi đâm vào khoá duy nhất.
    const body = { workspaceIds: [f.wsNhanSu, f.wsKinhDoanh] };
    const lan1 = await request(app)
      .put(`/api/v1/members/${String(f.hrUserId)}/workspaces`)
      .set(bearer(f.tokenAdmin))
      .send(body);
    const lan2 = await request(app)
      .put(`/api/v1/members/${String(f.hrUserId)}/workspaces`)
      .set(bearer(f.tokenAdmin))
      .send(body);

    expect(lan1.status).toBe(200);
    expect(lan2.status).toBe(200);
    expect(lan2.body.workspaceIds).toEqual(body.workspaceIds);
  });

  it('gán cho một ADMIN bị từ chối kèm lý do, không im lặng chấp nhận', async () => {
    /*
     * Im lặng nhận rồi không đổi gì là tệ hơn từ chối: người gán tin rằng mình
     * vừa siết quyền ai đó, trong khi admin vẫn thấy mọi workspace. Câu trả lời
     * phải chỉ ra việc THẬT SỰ cần làm — hạ vai trò xuống trước.
     */
    const adminKhac = await makeUser('admin2@hai-phong.test', 'Lê Văn Hai');
    await makeMembership(adminKhac, f.tenantId, 'admin');

    const res = await request(app)
      .put(`/api/v1/members/${String(adminKhac)}/workspaces`)
      .set(bearer(f.tokenAdmin))
      .send({ workspaceIds: [f.wsNhanSu] });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('vai trò');
  });

  it('workspace của tổ chức KHÁC bị từ chối, không lặng lẽ ghi vào', async () => {
    const tenantKhac = await makeTenant('Công ty Lạ', 'cong-ty-la');
    const nguoiLa = await makeUser('ai@la.test', 'Người Lạ');
    await makeMembership(nguoiLa, tenantKhac, 'admin');
    const wsLa = await makeWorkspace(tenantKhac, 'Phòng Lạ', 'phong-la');

    const res = await request(app)
      .put(`/api/v1/members/${String(f.hrUserId)}/workspaces`)
      .set(bearer(f.tokenAdmin))
      .send({ workspaceIds: [wsLa] });

    expect(res.status).toBe(404);

    // Và không có dòng nào lọt xuống database — transaction phải nguyên vẹn.
    const con = await request(app).get('/api/v1/workspaces').set(bearer(f.tokenHr));
    expect(con.body).toHaveLength(1);
    expect(con.body[0].id).toBe(f.wsNhanSu);
  });

  it('người CHƯA được gán workspace nào nhận câu nói rõ phải làm gì', async () => {
    /*
     * Trước migration 40, mã lỗi này nghĩa là "tổ chức chưa tạo workspace nào".
     * Giờ nó còn nghĩa thứ hai, phổ biến hơn hẳn: tổ chức có đủ workspace nhưng
     * người này chưa được thêm vào cái nào. Câu cũ sẽ dẫn họ đi tạo workspace
     * mới — việc họ không có quyền làm, và cũng không phải việc cần làm.
     */
    await request(app)
      .put(`/api/v1/members/${String(f.hrUserId)}/workspaces`)
      .set(bearer(f.tokenAdmin))
      .send({ workspaceIds: [] });

    // `/home` là route gọi `resolveWorkspace` KHÔNG kèm id — tức là nhánh "chọn
    // hộ workspace đầu tiên", đúng chỗ luật này nổi lên. Các màn danh sách đòi
    // `workspaceId` nên chúng dừng ở 400 trước khi tới đây.
    const res = await request(app).get('/api/v1/home').set(bearer(f.tokenHr));

    expect(res.status).toBe(409);
    expect(res.body.message).toContain('quản trị viên');
  });

  it('người tạo workspace mới vào được ngay workspace đó', async () => {
    // Thiếu dòng gán lúc tạo thì creator bấm "Tạo workspace", thấy báo thành
    // công, rồi không mở được chính thứ mình vừa tạo.
    await grantWorkspace(f.tenantId, f.wsKinhDoanh, f.hrUserId);

    const tao = await request(app)
      .post('/api/v1/workspaces')
      .set(bearer(f.tokenAdmin))
      .send({ name: 'Kế toán' });
    expect(tao.status).toBe(201);

    const res = await request(app).get('/api/v1/workspaces').set(bearer(f.tokenHr));
    // HR được gán hai phòng; workspace Kế toán vừa tạo KHÔNG tự mở cho họ.
    expect(res.body).toHaveLength(2);
    expect(res.body.map((w: { name: string }) => w.name)).not.toContain('Kế toán');
  });
});

describe('Tài khoản MỚI vẫn có workspace mặc định, và THẤY được nó', () => {
  /*
   * ═══ Vì sao bộ này phải đi qua API chứ không đọc database ═════════════════
   *
   * `provisionTenant` vẫn tạo "Không gian mặc định" cho mọi tổ chức mới, và
   * `tenant.integration.test.ts` đã khẳng định dòng đó CÓ trong `workspaces`.
   * Nhưng từ migration 40, "có trong bảng" và "người đó thấy được" là hai chuyện
   * khác nhau: `workspaceFilter` đòi một dòng `workspace_members`, mà
   * `provisionTenant` không ghi dòng nào.
   *
   * Nên một bài test đọc thẳng database sẽ VẪN XANH trong khi người vừa đăng ký
   * mở hệ thống ra và nhận 409 NoWorkspace — đúng kiểu hỏng mà bộ test tạo cảm
   * giác đã được phủ. Ba ca dưới đây đi bằng cửa người dùng thật đi.
   *
   * Thứ đỡ cho họ là vai trò: người lập tổ chức là `admin` (FOUNDER_ROLE), và
   * admin bỏ qua `workspaceFilter` bằng cờ. Đó là một suy luận bắc cầu qua hai
   * file, nên nó cần một bài test giữ lại — không phải một câu chú thích.
   */
  it('tự đăng ký: thấy ngay "Không gian mặc định" của tổ chức mình vừa lập', async () => {
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

    const dangNhap = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nguoimoi@example.com', password: 'Matkhau123' })
      .expect(200);
    const token = dangNhap.body.token as string;

    const ds = await request(app).get('/api/v1/workspaces').set(bearer(token)).expect(200);
    expect(ds.body).toHaveLength(1);
    expect(ds.body[0].name).toBe('Không gian mặc định');

    // Cửa thật sự quan trọng: trang chủ gọi `resolveWorkspace`, và đây là chỗ
    // người vừa đăng ký sẽ gặp 409 nếu ranh giới mới khoá họ ra ngoài.
    await request(app).get('/api/v1/home').set(bearer(token)).expect(200);
  });

  it('được tổ chức khác MỜI vào: không gian riêng của họ vẫn mở được', async () => {
    /*
     * `createMember` cấp cho người mới HAI tổ chức: tổ chức được mời (vai trò do
     * admin chọn) và không gian riêng của chính họ, nơi họ là `admin`. Không gian
     * riêng đó cũng đi qua `provisionTenant`, nên cũng không có dòng
     * `workspace_members` nào.
     */
    const moi = await request(app)
      .post('/api/v1/members')
      .set(bearer(f.tokenAdmin))
      .send({ email: 'nhanvienmoi@example.com', fullName: 'Nhan Vien Moi', role: 'viewer' });
    expect(moi.status).toBe(201);

    const userId = moi.body.user.userId as number;
    const [rows] = await mysqlPool.query<(ResultSetHeader & { id: number })[]>(
      'SELECT id FROM tenants WHERE owner_user_id = ?',
      [userId],
    );
    const tenantRieng = rows[0]?.id;
    expect(tenantRieng).toBeDefined();

    const token = signTokenFor(userId, Number(tenantRieng), 'admin');
    const ds = await request(app).get('/api/v1/workspaces').set(bearer(token)).expect(200);
    expect(ds.body).toHaveLength(1);
    expect(ds.body[0].name).toBe('Không gian mặc định');
  });

  it('nhưng trong tổ chức ĐƯỢC MỜI thì chưa thấy gì — đúng như thiết kế', async () => {
    /*
     * Ca đối chứng, và nó nói ra cái giá của tính năng này: người được mời với
     * vai trò `viewer`/`creator` KHÔNG tự động thấy workspace nào của tổ chức
     * mời họ. Admin phải gán bằng hộp thoại "Workspace".
     *
     * Đó chính là điều đã yêu cầu — thêm nhân viên nhân sự thì họ chỉ thấy phòng
     * Nhân sự — nhưng nó cũng có nghĩa là bỏ bước gán thì người mới mở ra một
     * màn hình trống. Ca này tồn tại để ai sửa chỗ này biết mình đang đánh đổi
     * cái gì, chứ không phải để khen hành vi đó là tiện.
     */
    const moi = await request(app)
      .post('/api/v1/members')
      .set(bearer(f.tokenAdmin))
      .send({ email: 'chuaganws@example.com', fullName: 'Chua Gan Ws', role: 'viewer' });
    expect(moi.status).toBe(201);

    const token = signTokenFor(moi.body.user.userId as number, f.tenantId, 'viewer');

    const ds = await request(app).get('/api/v1/workspaces').set(bearer(token)).expect(200);
    expect(ds.body).toHaveLength(0);

    const home = await request(app).get('/api/v1/home').set(bearer(token));
    expect(home.status).toBe(409);
    expect(home.body.message).toContain('quản trị viên');
  });
});
