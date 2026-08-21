import type { RowDataPacket } from 'mysql2';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
import { env } from '../src/config/env';
import { closeMysql, mysqlPool } from '../src/config/mysql';
import { closeRedis } from '../src/config/redis';
import { open } from '../src/services/connections/secretBox';
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
 * Test tích hợp §8 — Kết nối CSDL & Kho dữ liệu.
 *
 * ─── CSDL "của khách hàng" ở đây là gì ──────────────────────────────────────
 *
 * Chính container `bi-mysql` đang chạy bộ test này, trỏ vào database
 * `bi_platform_test`. Nghe vòng vo nhưng đó là lựa chọn có chủ đích: nó cho
 * luồng đồng bộ chạy trên một CSDL THẬT với schema THẬT (`users`, `tenants`,
 * `datasets`…) mà không cần dựng thêm container nào, nên bộ test này chạy được
 * ở bất kỳ đâu `npm run test:integration` chạy được.
 *
 * Đánh đổi: chỉ nhánh MySQL được kiểm tự động. ClickHouse phải thử tay — ghi ra
 * đây chứ không để người đọc tưởng cả hai loại đều có test.
 *
 * ─── Bộ này canh hai nhóm chuyện khác hẳn nhau ──────────────────────────────
 *
 *   Nhóm 1: mật khẩu CSDL có thật sự được bảo vệ không.
 *   Nhóm 2: đồng bộ có làm hỏng dữ liệu đang có không.
 *
 * Nhóm 1 nặng hơn mọi thứ trước đó trong dự án: mật khẩu ở đây mở được cả một
 * CSDL nằm NGOÀI hệ thống này.
 */

const app = createApp();

/** Thông tin để nối tới chính database test, đóng vai "CSDL của khách hàng". */
const SOURCE = {
  kind: 'mysql' as const,
  host: env.MYSQL_HOST,
  port: env.MYSQL_PORT,
  databaseName: env.MYSQL_DATABASE,
  username: env.MYSQL_USER,
  password: env.MYSQL_PASSWORD,
};

interface Fixture {
  tenantA: number;
  tenantB: number;
  /**
   * Mỗi tổ chức PHẢI có workspace.
   *
   * Trước đây fixture này không tạo workspace nào, và luồng đồng bộ vẫn chạy vì
   * nó ghi `workspace_id = NULL`. Đó là một trạng thái không tồn tại ngoài đời:
   * mọi tổ chức đều được tạo kèm một workspace lúc đăng ký. Từ migration 11 thì
   * dataset bắt buộc thuộc một workspace, nên fixture phải mô tả đúng thực tế.
   */
  workspaceA: number;
  workspaceA2: number;
  workspaceB: number;
  alice: number;
  tokenAlice: string;
  tokenBob: string;
  tokenDave: string;
  tokenCarol: string;
}

let f: Fixture;

beforeEach(async () => {
  await resetDatabase();

  const tenantA = await makeTenant('Công ty Alpha', 'cong-ty-alpha');
  const tenantB = await makeTenant('Công ty Beta', 'cong-ty-beta');

  const alice = await makeUser('alice@alpha.test', 'Nguyễn Thị An');
  const bob = await makeUser('bob@alpha.test', 'Trần Văn Bình');
  const dave = await makeUser('dave@alpha.test', 'Phạm Văn Dũng');
  const carol = await makeUser('carol@beta.test', 'Lê Thị Cúc');

  await makeMembership(alice, tenantA, 'admin');
  await makeMembership(bob, tenantA, 'creator');
  await makeMembership(dave, tenantA, 'viewer');
  await makeMembership(carol, tenantB, 'admin');

  f = {
    tenantA,
    tenantB,
    // `Kinh doanh` được tạo trước nên nó là workspace mặc định mà
    // `resolveWorkspace` chọn khi request không nói rõ.
    workspaceA: await makeWorkspace(tenantA, 'Kinh doanh', 'kinh-doanh'),
    workspaceA2: await makeWorkspace(tenantA, 'Kho vận', 'kho-van'),
    workspaceB: await makeWorkspace(tenantB, 'Kế toán', 'ke-toan'),
    alice,
    tokenAlice: signTokenFor(alice, tenantA, 'admin'),
    tokenBob: signTokenFor(bob, tenantA, 'creator'),
    tokenDave: signTokenFor(dave, tenantA, 'viewer'),
    tokenCarol: signTokenFor(carol, tenantB, 'admin'),
  };
});

afterAll(async () => {
  await closeMysql();
  await closeRedis();
});

/** Tạo một kết nối trỏ tới database test và trả về id. */
async function makeConnection(token: string, name = 'CSDL sản xuất'): Promise<number> {
  const res = await request(app)
    .post('/api/v1/connections')
    .set(bearer(token))
    .send({ ...SOURCE, name });

  expect(res.status).toBe(201);
  return res.body.id as number;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('bảng route §8 — mọi endpoint đều có guard', () => {
  type Method = 'get' | 'post' | 'patch' | 'delete';

  /**
   * Admin HOẶC creator — viewer bị chặn.
   *
   * `GET /api/v1/datasets` nằm ở đây từ migration 26. Trước đó nó có bảng
   * `READ_ROUTES` riêng với chú thích "mọi vai trò đọc được" — câu đó nay sai:
   * viewer đọc báo cáo, không đọc kho.
   *
   * ─── Không còn bảng `ADMIN_ROUTES` nào ở §8 (migration 28) ───────────────
   *
   * Nó từng giữ bảy đường ghi kết nối. Creator nay dựng được kết nối RIÊNG của
   * mình, nên cả bảy đều phải cho họ qua cổng Casbin, và bảng kia rỗng nên bị
   * xoá hẳn thay vì để lại một mảng trống.
   *
   * ⚠️ Qua được CỔNG không phải là sửa được MỌI DÒNG. Casbin chấm điểm trên tài
   * nguyên; ranh giới "kết nối nào" nằm trong câu SQL của `update`/`softDelete`
   * và có hẳn một nhóm ca riêng ở dưới canh nó — `describe('phạm vi kết nối
   * riêng')`. Đọc bảng này mà bỏ nhóm đó là đọc ra một lỗ hổng không có thật.
   */
  const EDITOR_ROUTES: [Method, string][] = [
    ['get', '/api/v1/datasets'],
    /*
     * Hai đường ĐỌC kết nối chuyển từ nhóm chỉ-admin sang đây ở migration 27.
     *
     * Đồng bộ bảng đã luôn là việc của creator (`dataset:modify`), nhưng bước
     * chọn XEM đồng bộ từ kết nối nào lại nằm sau `connection:read`. Thiếu nó,
     * hộp thoại mở ra với một ô chọn rỗng và không lời giải thích.
     *
     */
    ['get', '/api/v1/connections'],
    ['get', '/api/v1/connections/prerequisites'],
    /*
     * Và mọi đường GHI kết nối, từ migration 28 — creator dựng kết nối riêng.
     *
     * Hai đường liệt kê database cùng hạng với `/test`: chúng MỞ KẾT NỐI THẬT
     * ra ngoài, nên gác bằng `connection:modify` chứ không phải quyền đọc.
     */
    ['post', '/api/v1/connections'],
    ['post', '/api/v1/connections/test'],
    ['post', '/api/v1/connections/databases'],
    ['get', '/api/v1/connections/1/databases'],
    ['patch', '/api/v1/connections/1'],
    ['post', '/api/v1/connections/1/test'],
    ['delete', '/api/v1/connections/1'],
    ['get', '/api/v1/connections/1/tables'],
    ['post', '/api/v1/connections/1/sync'],
    ['patch', '/api/v1/datasets/1'],
    /*
     * Xoá bộ dữ liệu CHUYỂN từ nhóm admin sang đây khi §7 và §8 được gộp.
     *
     * Hai mục ra hai luật khác nhau cho cùng một thao tác: §8 để xoá cho riêng
     * admin, §7.8 nói "Creator trở lên mới tạo/xoá". Một bảng `datasets` thì
     * chỉ có MỘT policy `dataset:delete` — không có cách nào cho creator xoá bộ
     * dữ liệu từ file mà vẫn cấm họ xoá bộ dữ liệu từ CSDL, vì Casbin chấm điểm
     * trên tài nguyên chứ không trên từng dòng.
     *
     * Chọn luật của §7.8 vì nó nới rộng chứ không siết lại, và vì xoá ở đây là
     * xoá MỀM: đồng bộ lại bảng đó hồi sinh bộ dữ liệu với nguyên id cũ (xem
     * `deleteDataset`), nên thao tác này không một chiều như tên gọi gợi ý.
     */
    ['delete', '/api/v1/datasets/1'],
  ];

  it.each(EDITOR_ROUTES)(
    'không token: %s %s -> 401',
    async (method, path) => {
      expect((await request(app)[method](path)).status).toBe(401);
    },
  );

  it.each(EDITOR_ROUTES)('viewer: %s %s -> 403', async (method, path) => {
    const res = await request(app)[method](path).set(bearer(f.tokenDave)).send({});
    expect(res.status).toBe(403);
  });

  it('creator ĐỌC được Kho dữ liệu — migration 26 chỉ nhắm viewer', async () => {
    // Câu `DELETE` của migration 26 lọc theo `v0 = 'viewer'`. Quên ràng buộc đó
    // là quét sạch `dataset:read` của creator, và triệu chứng sẽ là "creator
    // bỗng dưng không mở được Kho dữ liệu" — không ai nối được về một dòng SQL
    // trong migration nếu không có ca này.
    expect((await request(app).get('/api/v1/datasets').set(bearer(f.tokenBob))).status).toBe(200);
  });

  /**
   * Migration 27 — creator chọn được kết nối để đồng bộ.
   *
   * Bảng 403 ở trên không thay được ca này: nó chỉ khẳng định viewer bị chặn,
   * và điều đó đúng cả trước lẫn sau migration 27. Thứ hỏng trước đây là
   * creator, và chỉ một ca hỏi thẳng creator mới giữ được nó.
   */
  it('creator mở được danh sách kết nối, và nó RỖNG khi họ chưa tự dựng cái nào', async () => {
    // Kết nối này do ADMIN dựng. Creator có `connection:read` nên vào được
    // endpoint — 200, không phải 403 — nhưng không thấy dòng nào, vì họ chỉ
    // thấy kết nối của chính mình.
    await makeConnection(f.tokenAlice);

    const ds = await request(app).get('/api/v1/connections').set(bearer(f.tokenBob));
    expect(ds.status).toBe(200);
    expect(ds.body).toHaveLength(0);

    // Phân biệt hai thứ dễ lẫn: 200-rỗng nghĩa là "bạn chưa có kết nối nào",
    // còn 403 nghĩa là "vai trò của bạn không được xem". Giao diện hiện hai câu
    // khác hẳn nhau cho hai trạng thái đó.
    const cuaAdmin = await request(app).get('/api/v1/connections').set(bearer(f.tokenAlice));
    expect(cuaAdmin.body).toHaveLength(1);
    expect(JSON.stringify(cuaAdmin.body)).not.toContain(SOURCE.password);
  });
});

/**
 * Kết nối RIÊNG của người tạo — migration 28.
 *
 * ═══ Vì sao nhóm này tồn tại tách hẳn khỏi bảng route ════════════════════════
 *
 * Bảng route ở trên chỉ hỏi được "vai trò này qua cổng Casbin không". Từ
 * migration 28, câu trả lời cho creator là CÓ trên cả bảy đường ghi kết nối —
 * nên bảng đó không còn phát hiện được gì về ranh giới thật.
 *
 * Ranh giới thật là "kết nối NÀO", và nó nằm trong mệnh đề `AND created_by = ?
 * AND visibility = 'private'` của `update`/`softDelete`/`findSecret`. Một lần
 * refactor xoá mệnh đề đó đi sẽ để mọi ca ở trên xanh nguyên, trong khi creator
 * sửa được kho chung của tổ chức và rút được dữ liệu qua kết nối riêng của
 * người khác. Đây là nhóm ca duy nhất đứng giữa.
 */
describe('phạm vi kết nối riêng', () => {
  /** Kết nối do CREATOR tạo — phải thành `private`, của riêng họ. */
  async function makePrivate(token: string, name: string): Promise<number> {
    const res = await request(app)
      .post('/api/v1/connections')
      .set(bearer(token))
      .send({ ...SOURCE, name });
    expect(res.status).toBe(201);
    return res.body.id as number;
  }

  it('admin tạo -> dùng chung; creator tạo -> riêng', async () => {
    // Phạm vi do VAI TRÒ người tạo quyết định, và được ghi thành cột thật. Đây
    // là ca giữ cho quyết định đó không lặng lẽ đảo chiều.
    const cuaAdmin = await makeConnection(f.tokenAlice, 'Kho chung');
    const cuaCreator = await makePrivate(f.tokenBob, 'Máy của Bình');

    const list = await request(app).get('/api/v1/connections').set(bearer(f.tokenAlice));
    const byId = new Map<number, { visibility: string; ownerName: string | null }>(
      list.body.map((c: { id: number; visibility: string; ownerName: string | null }) => [
        c.id,
        { visibility: c.visibility, ownerName: c.ownerName },
      ]),
    );

    expect(byId.get(cuaAdmin)?.visibility).toBe('shared');
    expect(byId.get(cuaCreator)?.visibility).toBe('private');
    // Admin thấy kết nối riêng của người khác KÈM tên chủ — không có nhãn đó
    // thì danh sách của admin là một đống không phân biệt được ai chịu trách
    // nhiệm cho dòng nào.
    expect(byId.get(cuaCreator)?.ownerName).toBe('Trần Văn Bình');
  });

  it('creator KHÔNG thấy kết nối riêng của creator khác', async () => {
    // Người thứ hai cùng vai trò, cùng tổ chức. Đây là ca mà `whereVisible`
    // sinh ra để canh: cùng vai trò thì Casbin cho điểm y hệt nhau, nên nếu
    // ranh giới này hỏng thì không có lớp nào khác bắt được.
    const eve = await makeUser('eve@alpha.test', 'Đỗ Thị Ế');
    await makeMembership(eve, f.tenantA, 'creator');
    const tokenEve = signTokenFor(eve, f.tenantA, 'creator');

    const cuaToChuc = await makeConnection(f.tokenAlice, 'CSDL của công ty');
    const cuaBinh = await makePrivate(f.tokenBob, 'Máy của Bình');
    const cuaEve = await makePrivate(tokenEve, 'Máy của Ế');

    const thay = await request(app).get('/api/v1/connections').set(bearer(tokenEve));
    const ids = thay.body.map((c: { id: number }) => c.id);

    expect(ids).toEqual([cuaEve]); // ĐÚNG một dòng: của chính Ế
    expect(ids).not.toContain(cuaBinh); // của creator khác thì không
    // Và cả kết nối do ADMIN dựng cũng không. Đây là vế bị cắt sau khi quyết
    // định "creator không dùng chung với admin": thông tin đăng nhập của admin
    // mở được cả CSDL nguồn, và mượn được nó là mượn cả quyền đọc đi kèm — trên
    // những bảng mà admin chưa từng chọn đồng bộ.
    expect(ids).not.toContain(cuaToChuc);

    // Và không đi vòng được bằng cách gõ thẳng id. Bốn đường dưới đây đều đi
    // qua `findSecret`, tức là đều cần mật khẩu để mở kết nối thật.
    for (const [method, path] of [
      ['get', `/api/v1/connections/${cuaBinh}/tables`],
      ['get', `/api/v1/connections/${cuaBinh}/databases`],
      ['post', `/api/v1/connections/${cuaBinh}/test`],
    ] as ['get' | 'post', string][]) {
      const res = await request(app)[method](path).set(bearer(tokenEve)).send({});
      expect(res.status, `${method} ${path}`).toBe(404);
    }

    // Đường nguy hiểm nhất: `/sync` gác bằng `dataset:modify` — ô mà Eve CÓ —
    // rồi nhận connectionId thẳng từ URL. Thiếu `viewer` ở `syncDatasets` là
    // Eve rút được dữ liệu từ CSDL riêng của Bình mà không lớp nào chặn.
    const sync = await request(app)
      .post(`/api/v1/connections/${cuaBinh}/sync`)
      .set(bearer(tokenEve))
      .send({ tables: [{ schema: 'bi_platform_test', table: 'users' }] });
    expect(sync.status).toBe(404);
  });

  it('creator KHÔNG sửa/xoá được kết nối của tổ chức, dù Casbin đã cho qua cổng', async () => {
    const cuaToChuc = await makeConnection(f.tokenAlice, 'CSDL của công ty');

    // 404 chứ không 403, và đó là chủ ý: 403 xác nhận id có thật. Cùng quy ước
    // với mọi chỗ khác trong dự án.
    const sua = await request(app)
      .patch(`/api/v1/connections/${cuaToChuc}`)
      .set(bearer(f.tokenBob))
      .send({ ...SOURCE, name: 'Bị chiếm' });
    expect(sua.status).toBe(404);

    const xoa = await request(app)
      .delete(`/api/v1/connections/${cuaToChuc}`)
      .set(bearer(f.tokenBob));
    expect(xoa.status).toBe(404);

    // Và nó còn nguyên — không phải "báo lỗi nhưng vẫn ghi".
    const con = await request(app).get('/api/v1/connections').set(bearer(f.tokenAlice));
    expect(con.body.find((c: { id: number }) => c.id === cuaToChuc)?.name).toBe(
      'CSDL của công ty',
    );
  });

  /**
   * Người TỪNG là admin, dựng kết nối cho kho chung, rồi bị hạ xuống creator.
   *
   * `created_by` vẫn trỏ vào họ, nên một mệnh đề chỉ có `AND created_by = ?` sẽ
   * cho họ tiếp tục sửa kho chung của tổ chức — và trên màn hình nó vẫn là một
   * dòng "Dùng chung" bình thường, không ai nhìn ra.
   *
   * Đây là ca DUY NHẤT chạm tới vế `visibility = 'private'` trong `whereOwned`.
   * Ca "creator không sửa được kho chung" ở trên KHÔNG thay được: ở đó người
   * gọi vốn không phải người tạo, nên `created_by = ?` một mình đã chặn rồi.
   * Tôi đã thử gỡ vế ấy ra và ca kia vẫn xanh — nên nếu thiếu ca này thì cả một
   * ràng buộc nằm đó không có gì canh.
   */
  it('bị hạ từ admin xuống creator thì MẤT quyền sửa kết nối tổ chức mình từng dựng', async () => {
    const chung = await makeConnection(f.tokenAlice, 'CSDL của công ty');

    // Hạ vai trò trong DATABASE, giữ nguyên token. `requireFreshMembership` đọc
    // lại vai trò mỗi request nên token cũ không cứu được — cùng cơ chế mà bài
    // "token ghi admin nhưng DB đã hạ xuống viewer" đang dựa vào.
    await mysqlPool.query('UPDATE memberships SET role = ? WHERE user_id = ? AND tenant_id = ?', [
      'creator',
      f.alice,
      f.tenantA,
    ]);

    const sua = await request(app)
      .patch(`/api/v1/connections/${chung}`)
      .set(bearer(f.tokenAlice))
      .send({ ...SOURCE, name: 'Vẫn sửa được?' });
    expect(sua.status).toBe(404);

    // Vẫn THẤY nó, nhưng vì `created_by` là chính họ — không phải vì nó "dùng
    // chung". Mất quyền sửa, không mất quyền đọc.
    const list = await request(app).get('/api/v1/connections').set(bearer(f.tokenAlice));
    const row = list.body.find((c: { id: number }) => c.id === chung);
    expect(row?.name).toBe('CSDL của công ty');
    expect(row?.canManage).toBe(false);
  });

  it('creator sửa và xoá được kết nối CỦA MÌNH', async () => {
    const cua = await makePrivate(f.tokenBob, 'Máy của Bình');

    const sua = await request(app)
      .patch(`/api/v1/connections/${cua}`)
      .set(bearer(f.tokenBob))
      .send({ ...SOURCE, name: 'Máy của Bình (đổi tên)' });
    expect(sua.status).toBe(200);
    expect(sua.body.name).toBe('Máy của Bình (đổi tên)');
    // `canManage` là thứ quyết định nút Sửa/Xoá có hiện không. Nó phải khớp với
    // câu SQL vừa cho qua ở trên; lệch nhau thì người dùng thấy nút bấm vào ra
    // 404, hoặc không thấy nút cho thứ họ sửa được.
    expect(sua.body.canManage).toBe(true);

    expect((await request(app).delete(`/api/v1/connections/${cua}`).set(bearer(f.tokenBob))).status)
      .toBe(204);
  });

  it('hai creator đặt TRÙNG TÊN kết nối riêng — không ai chặn ai', async () => {
    /*
     * Khoá `uq_connections_tenant_name (tenant_id, name)` cũ sẽ làm người thứ
     * hai nhận lỗi trùng tên về một bản ghi họ KHÔNG NHÌN THẤY — đúng hình dạng
     * của V-09, một bức tường không cửa. Migration 28 đổi sang khoá theo phạm
     * vi, và ca này là thứ giữ nó.
     */
    const eve = await makeUser('eve@alpha.test', 'Đỗ Thị Ế');
    await makeMembership(eve, f.tenantA, 'creator');
    const tokenEve = signTokenFor(eve, f.tenantA, 'creator');

    await makePrivate(f.tokenBob, 'Local');
    await makePrivate(tokenEve, 'Local');

    // Nhưng TRONG phạm vi một người thì tên vẫn phải là duy nhất — nới hết thì
    // chính người đó có hai dòng cùng tên và không phân biệt nổi.
    const lai = await request(app)
      .post('/api/v1/connections')
      .set(bearer(f.tokenBob))
      .send({ ...SOURCE, name: 'Local' });
    expect(lai.status).toBe(409);
  });

  it('xoá rồi thì TÊN được trả lại', async () => {
    // Khoá mới dùng cột sinh `IF(deleted_at IS NULL, …, NULL)` — cùng thủ thuật
    // migration 24. Không có nó thì mỗi lần gõ nhầm tên là mất tên đó vĩnh viễn.
    const cua = await makePrivate(f.tokenBob, 'Gõ nhầm');
    expect((await request(app).delete(`/api/v1/connections/${cua}`).set(bearer(f.tokenBob))).status)
      .toBe(204);

    await makePrivate(f.tokenBob, 'Gõ nhầm');
  });
});

describe('mật khẩu CSDL nguồn', () => {
  /**
   * Nhóm quan trọng nhất của cả mục này. Mật khẩu ở đây không phải để đăng nhập
   * vào hệ thống ta — nó mở được cả một CSDL nằm NGOÀI, thuộc về khách hàng.
   */

  it('KHÔNG xuất hiện trong bất kỳ phản hồi nào', async () => {
    const id = await makeConnection(f.tokenAlice);

    const responses = [
      await request(app).get('/api/v1/connections').set(bearer(f.tokenAlice)),
      await request(app)
        .post('/api/v1/connections')
        .set(bearer(f.tokenAlice))
        .send({ ...SOURCE, name: 'Kết nối thứ hai' }),
      await request(app)
        .patch(`/api/v1/connections/${id}`)
        .set(bearer(f.tokenAlice))
        .send({ ...SOURCE, name: 'Đổi tên' }),
    ];

    // Soi chuỗi JSON thô, không soi từng trường: một trường mới thêm sau này mà
    // vô tình mang mật khẩu theo cũng bị bắt.
    for (const res of responses) {
      expect(JSON.stringify(res.body)).not.toContain(SOURCE.password);
      expect(JSON.stringify(res.body)).not.toContain('password');
    }
  });

  it('lưu xuống DB dưới dạng MÃ HOÁ, và giải mã ra đúng bản gốc', async () => {
    const id = await makeConnection(f.tokenAlice);

    const [rows] = await mysqlPool.query<RowDataPacket[]>(
      'SELECT password_cipher FROM connections WHERE id = ?',
      [id],
    );
    const cipher = String(rows[0]?.['password_cipher']);

    // Ba khẳng định, thiếu cái nào cũng lọt một kiểu hỏng khác nhau:
    expect(cipher).not.toBe(SOURCE.password); // không lưu thô
    expect(cipher).not.toContain(SOURCE.password); // không lưu thô có bọc
    expect(cipher.startsWith('v1.')).toBe(true); // đúng định dạng có phiên bản
    expect(open(cipher)).toBe(SOURCE.password); // và vẫn dùng lại được
  });

  it('sửa kết nối mà bỏ trống mật khẩu thì GIỮ NGUYÊN mật khẩu cũ', async () => {
    const id = await makeConnection(f.tokenAlice);

    const res = await request(app)
      .patch(`/api/v1/connections/${id}`)
      .set(bearer(f.tokenAlice))
      .send({ ...SOURCE, password: '', name: 'Tên mới' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Tên mới');

    // Bắt admin nhập lại mật khẩu chỉ để đổi cái tên là bắt họ biết một thứ mà
    // người dựng kết nối ban đầu có thể đã không chia sẻ.
    const [rows] = await mysqlPool.query<RowDataPacket[]>(
      'SELECT password_cipher FROM connections WHERE id = ?',
      [id],
    );
    expect(open(String(rows[0]?.['password_cipher']))).toBe(SOURCE.password);
  });
});

describe('cờ SSL', () => {
  /**
   * Cờ này quyết định driver mở socket thường hay bắt tay TLS. Nó đi qua sáu
   * chặng — zod, service, repository, cột TINYINT, DTO, rồi về giao diện — và
   * rơi ở bất kỳ chặng nào cũng cho ra cùng một triệu chứng: người dùng tick ô,
   * lưu, rồi kết nối vẫn hỏng y như lúc chưa tick.
   */

  it('bật lên thì lưu lại và trả về đúng như đã gửi', async () => {
    const created = await request(app)
      .post('/api/v1/connections')
      .set(bearer(f.tokenAlice))
      .send({ ...SOURCE, name: 'Có SSL', useSsl: true });

    expect(created.status).toBe(201);
    // `true` chứ không phải `1`: TINYINT(1) về tay driver là số, và trả thẳng
    // con số đó ra JSON sẽ khiến mọi phép `=== false` phía frontend trượt.
    expect(created.body.useSsl).toBe(true);

    const list = await request(app).get('/api/v1/connections').set(bearer(f.tokenAlice));
    expect(list.body[0].useSsl).toBe(true);
  });

  it('không gửi thì mặc định TẮT', async () => {
    const res = await request(app)
      .post('/api/v1/connections')
      .set(bearer(f.tokenAlice))
      .send({ ...SOURCE, name: 'Không SSL' });

    expect(res.body.useSsl).toBe(false);
  });

  it('tắt được sau khi đã bật', async () => {
    const created = await request(app)
      .post('/api/v1/connections')
      .set(bearer(f.tokenAlice))
      .send({ ...SOURCE, name: 'Đổi ý', useSsl: true });

    const res = await request(app)
      .patch(`/api/v1/connections/${created.body.id}`)
      .set(bearer(f.tokenAlice))
      .send({ ...SOURCE, name: 'Đổi ý', useSsl: false });

    expect(res.status).toBe(200);
    expect(res.body.useSsl).toBe(false);
  });
});

describe('loại CSDL', () => {
  it('từ chối loại đã bị gỡ khỏi hệ thống', async () => {
    const res = await request(app)
      .post('/api/v1/connections')
      .set(bearer(f.tokenAlice))
      .send({ ...SOURCE, kind: 'postgres', name: 'Postgres' });

    // 400 chứ không phải 500: `kind` không hợp lệ là lỗi đầu vào, và zod phải
    // chặn nó TRƯỚC khi `driverFor` đi tra một khoá không tồn tại.
    expect(res.status).toBe(400);
  });
});

describe('kiểm tra kết nối (§8.3)', () => {
  it('thông tin đúng -> ok kèm phiên bản máy chủ', async () => {
    const res = await request(app)
      .post('/api/v1/connections/test')
      .set(bearer(f.tokenAlice))
      .send({ ...SOURCE, name: 'Thử' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.serverVersion).toBe('string');
  });

  it('sai mật khẩu -> 200 kèm lý do đọc được, KHÔNG phải 500', async () => {
    const res = await request(app)
      .post('/api/v1/connections/test')
      .set(bearer(f.tokenAlice))
      .send({ ...SOURCE, name: 'Thử', password: 'sai-hoan-toan' });

    // Thất bại ở đây là một KẾT QUẢ người dùng đang chờ đọc, không phải sự cố.
    // Trả 5xx sẽ khiến giao diện hiện "đã có lỗi xảy ra" thay vì câu chỉ ra
    // phải sửa gì.
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.message).toMatch(/mật khẩu|đăng nhập/i);
    // Và tuyệt đối không phơi chi tiết nội bộ của thư viện ra màn hình.
    expect(res.body.message).not.toMatch(/ER_|errno|stack/i);
  });

  it('cổng không có ai nghe -> báo đúng là bị từ chối', async () => {
    const res = await request(app)
      .post('/api/v1/connections/test')
      .set(bearer(f.tokenAlice))
      .send({ ...SOURCE, name: 'Thử', port: 59999 });

    expect(res.body.ok).toBe(false);
    expect(res.body.message).toMatch(/từ chối|cổng|thời gian chờ/i);
  });

  it('ghi lại kết quả để danh sách biết kết nối nào đang hỏng', async () => {
    const id = await makeConnection(f.tokenAlice);

    await request(app).post(`/api/v1/connections/${id}/test`).set(bearer(f.tokenAlice));
    const ok = await request(app).get('/api/v1/connections').set(bearer(f.tokenAlice));
    expect(ok.body[0].lastTestedAt).not.toBeNull();
    expect(ok.body[0].lastTestError).toBeNull();

    // Đổi sang mật khẩu sai rồi thử lại -> hai cột phải đảo chiều.
    await request(app)
      .patch(`/api/v1/connections/${id}`)
      .set(bearer(f.tokenAlice))
      .send({ ...SOURCE, name: 'CSDL sản xuất', password: 'sai' });
    await request(app).post(`/api/v1/connections/${id}/test`).set(bearer(f.tokenAlice));

    const bad = await request(app).get('/api/v1/connections').set(bearer(f.tokenAlice));
    expect(bad.body[0].lastTestedAt).toBeNull();
    expect(typeof bad.body[0].lastTestError).toBe('string');
  });
});

describe('chọn database (§8.2)', () => {
  it('liệt kê được database THẬT kèm số bảng', async () => {
    const res = await request(app)
      .post('/api/v1/connections/databases')
      .set(bearer(f.tokenAlice))
      .send({ ...SOURCE, name: 'Thử' });

    expect(res.status).toBe(200);

    const found = (res.body as { name: string; tableCount: number }[]).find(
      (d) => d.name === env.MYSQL_DATABASE,
    );
    expect(found).toBeDefined();
    // Số bảng phải là số THẬT, không phải 0 hay undefined: đây là con số biến
    // "chọn nhầm database" thành thứ nhìn thấy được ngay tại chỗ chọn.
    expect(found?.tableCount).toBeGreaterThan(0);

    // Schema hệ thống phải bị loại — không ai muốn đồng bộ `performance_schema`.
    const names = (res.body as { name: string }[]).map((d) => d.name);
    expect(names).not.toContain('information_schema');
    expect(names).not.toContain('mysql');
  });

  it('KHÔNG tự lọc theo database đang chọn — kể cả khi tên đó sai bét', async () => {
    // Đây là toàn bộ lý do endpoint này tồn tại: người dùng gõ sai tên database
    // thì vẫn phải lấy được danh sách để chọn lại. Tự khoá vào cái đang chọn là
    // hỏng đúng lúc cần nhất.
    const res = await request(app)
      .post('/api/v1/connections/databases')
      .set(bearer(f.tokenAlice))
      .send({ ...SOURCE, name: 'Thử', databaseName: 'khong_he_ton_tai' });

    expect(res.status).toBe(200);
    expect((res.body as unknown[]).length).toBeGreaterThan(0);
  });

  it('kết nối ĐÃ lưu liệt kê được mà không cần gửi lại mật khẩu', async () => {
    const id = await makeConnection(f.tokenAlice);

    const res = await request(app)
      .get(`/api/v1/connections/${id}/databases`)
      .set(bearer(f.tokenAlice));

    expect(res.status).toBe(200);
    expect((res.body as { name: string }[]).map((d) => d.name)).toContain(env.MYSQL_DATABASE);
  });

  it('kết nối của tổ chức khác -> 404, KHÔNG phải 403', async () => {
    const id = await makeConnection(f.tokenAlice);

    const res = await request(app)
      .get(`/api/v1/connections/${id}/databases`)
      .set(bearer(f.tokenCarol));

    // 403 là xác nhận id đó có tồn tại — cùng luật với mọi endpoint khác.
    expect(res.status).toBe(404);
  });

  it('không nối được -> 502, KHÁC hẳn `/test` trả 200 kèm ok:false', async () => {
    const res = await request(app)
      .post('/api/v1/connections/databases')
      .set(bearer(f.tokenAlice))
      .send({ ...SOURCE, name: 'Thử', port: 59999 });

    // Một mảng rỗng vì lỗi mạng trông y hệt một máy chủ không có database nào.
    // Phải là lỗi thật để giao diện không hiện một danh sách rỗng đáng tin.
    expect(res.status).toBe(502);
    expect(res.body.message).toMatch(/từ chối|cổng|thời gian chờ/i);
  });
});

describe('database để trống = mọi database', () => {
  it('lưu được kết nối không khai database', async () => {
    const res = await request(app)
      .post('/api/v1/connections')
      .set(bearer(f.tokenAlice))
      .send({ ...SOURCE, name: 'Mọi database', databaseName: '' });

    expect(res.status).toBe(201);
    expect(res.body.databaseName).toBe('');
  });

  it('kiểm tra kết nối vẫn xanh khi không khai database', async () => {
    // mysql2 gửi chuỗi rỗng đi như `USE ''` và máy chủ từ chối bắt tay, nên phép
    // quy đổi sang `undefined` trong `connectionOptions` là thứ bài này canh.
    const res = await request(app)
      .post('/api/v1/connections/test')
      .set(bearer(f.tokenAlice))
      .send({ ...SOURCE, name: 'Thử', databaseName: '' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('liệt kê bảng của NHIỀU database, không chỉ một', async () => {
    const scoped = await makeConnection(f.tokenAlice, 'Một database');
    const all = await request(app)
      .post('/api/v1/connections')
      .set(bearer(f.tokenAlice))
      .send({ ...SOURCE, name: 'Mọi database', databaseName: '' });

    const one = await request(app)
      .get(`/api/v1/connections/${scoped}/tables`)
      .set(bearer(f.tokenAlice));
    const many = await request(app)
      .get(`/api/v1/connections/${all.body.id}/tables`)
      .set(bearer(f.tokenAlice));

    expect(one.status).toBe(200);
    expect(many.status).toBe(200);

    // Kết nối thu hẹp chỉ thấy đúng một schema; kết nối mở thấy nhiều hơn.
    const oneSchemas = new Set((one.body as { schema: string }[]).map((t) => t.schema));
    const manySchemas = new Set((many.body as { schema: string }[]).map((t) => t.schema));

    expect([...oneSchemas]).toEqual([env.MYSQL_DATABASE]);
    expect(manySchemas.size).toBeGreaterThan(1);
    expect(manySchemas).toContain(env.MYSQL_DATABASE);
    // Và vẫn không được lôi schema hệ thống vào.
    expect(manySchemas).not.toContain('information_schema');
  });
});

describe('cách ly tổ chức', () => {
  it('không thấy kết nối của tổ chức khác', async () => {
    await makeConnection(f.tokenAlice);

    const res = await request(app).get('/api/v1/connections').set(bearer(f.tokenCarol));
    expect(res.body).toHaveLength(0);
  });

  it('kết nối của tổ chức khác -> 404, KHÔNG phải 403', async () => {
    const id = await makeConnection(f.tokenAlice);

    // 403 là xác nhận rằng id đó có tồn tại — chính là thông tin ta không muốn
    // cho. 404 khiến việc dò id trở nên vô nghĩa.
    for (const res of [
      await request(app).post(`/api/v1/connections/${id}/test`).set(bearer(f.tokenCarol)),
      await request(app).get(`/api/v1/connections/${id}/tables`).set(bearer(f.tokenCarol)),
      await request(app).delete(`/api/v1/connections/${id}`).set(bearer(f.tokenCarol)),
    ]) {
      expect(res.status).toBe(404);
    }
  });

  it('dataset của tổ chức khác -> 404', async () => {
    const id = await makeConnection(f.tokenAlice);
    await request(app)
      .post(`/api/v1/connections/${id}/sync`)
      .set(bearer(f.tokenAlice))
      .send({ tables: [{ schema: env.MYSQL_DATABASE, table: 'users' }] });

    const mine = await request(app).get('/api/v1/datasets').set(bearer(f.tokenAlice));
    const datasetId = mine.body.items[0].id as number;

    expect(
      (await request(app).get(`/api/v1/datasets/${datasetId}`).set(bearer(f.tokenCarol))).status,
    ).toBe(404);
    expect(
      (await request(app).delete(`/api/v1/datasets/${datasetId}`).set(bearer(f.tokenCarol)))
        .status,
    ).toBe(404);
  });

  /**
   * Cách ly theo WORKSPACE, không chỉ theo tổ chức.
   *
   * Mỗi workspace quản lý kho riêng — bảng đồng bộ về ở workspace này không
   * được hiện ở workspace khác. Trước migration 11, `syncDatasets` ghi
   * `workspace_id = NULL` cho MỌI bảng đồng bộ, nên chúng hiện ở khắp nơi.
   */
  it('bảng đồng bộ ở workspace này KHÔNG hiện ở workspace khác', async () => {
    const id = await makeConnection(f.tokenAlice);
    await request(app)
      .post(`/api/v1/connections/${id}/sync`)
      .set(bearer(f.tokenAlice))
      .send({
        workspaceId: f.workspaceA,
        tables: [{ schema: env.MYSQL_DATABASE, table: 'users' }],
      });

    const trongA = await request(app)
      .get('/api/v1/datasets')
      .query({ workspaceId: f.workspaceA })
      .set(bearer(f.tokenAlice));
    const trongA2 = await request(app)
      .get('/api/v1/datasets')
      .query({ workspaceId: f.workspaceA2 })
      .set(bearer(f.tokenAlice));

    expect(trongA.body.items.map((d: { name: string }) => d.name)).toEqual(['users']);
    expect(trongA2.body.items).toEqual([]);
  });

  /**
   * Hai workspace đồng bộ CÙNG một bảng nguồn thì mỗi bên có dòng riêng.
   *
   * Đây là thứ `uq_datasets_source` cũ không cho phép: khoá chỉ gồm (tenant,
   * connection, schema, table) nên bảng `users` chỉ tồn tại được ở đúng một
   * workspace trong cả tổ chức, và workspace thứ hai sẽ CƯỚP dòng của workspace
   * thứ nhất thay vì tạo bản của mình.
   */
  it('hai workspace cùng đồng bộ một bảng nguồn -> hai dataset riêng', async () => {
    const id = await makeConnection(f.tokenAlice);
    const table = [{ schema: env.MYSQL_DATABASE, table: 'users' }];

    for (const workspaceId of [f.workspaceA, f.workspaceA2]) {
      const res = await request(app)
        .post(`/api/v1/connections/${id}/sync`)
        .set(bearer(f.tokenAlice))
        .send({ workspaceId, tables: table });
      // Cả hai lần đều là THÊM MỚI, không phải "không đổi" — nếu lần hai báo
      // không đổi nghĩa là nó vừa ghi đè lên dòng của workspace kia.
      expect(res.body.added).toEqual([`${env.MYSQL_DATABASE}.users`]);
    }

    const a = await request(app)
      .get('/api/v1/datasets')
      .query({ workspaceId: f.workspaceA })
      .set(bearer(f.tokenAlice));
    const a2 = await request(app)
      .get('/api/v1/datasets')
      .query({ workspaceId: f.workspaceA2 })
      .set(bearer(f.tokenAlice));

    expect(a.body.items).toHaveLength(1);
    expect(a2.body.items).toHaveLength(1);
    expect(a.body.items[0].id).not.toBe(a2.body.items[0].id);
  });
});

describe('xem trước dữ liệu', () => {
  /**
   * Endpoint DUY NHẤT trong hệ thống đọc dữ liệu THẬT của khách hàng. Bốn thứ
   * phải đúng, và ba trong số đó là chuyện bảo mật chứ không phải hiển thị.
   */

  /** Đồng bộ bảng `tenants` rồi trả về id dataset của nó. */
  async function makeDataset(): Promise<number> {
    const connectionId = await makeConnection(f.tokenAlice);
    await request(app)
      .post(`/api/v1/connections/${connectionId}/sync`)
      .set(bearer(f.tokenAlice))
      .send({ tables: [{ schema: env.MYSQL_DATABASE, table: 'tenants' }] });

    const list = await request(app).get('/api/v1/datasets').set(bearer(f.tokenAlice));
    return list.body.items[0].id as number;
  }

  it('trả về đúng cột và dòng thật của bảng nguồn', async () => {
    const datasetId = await makeDataset();

    const res = await request(app)
      .get(`/api/v1/datasets/${datasetId}/preview`)
      .set(bearer(f.tokenAlice));

    expect(res.status).toBe(200);
    expect(res.body.columns).toContain('name');
    expect(res.body.columns).toContain('slug');
    // `beforeEach` đã tạo hai tổ chức, nên bảng chắc chắn có dòng.
    expect(res.body.rows.length).toBeGreaterThan(0);
    // Mỗi dòng là MẢNG theo đúng thứ tự cột, không phải object — thứ tự cột của
    // bảng nguồn là thông tin thật và object thì không giữ được nó.
    expect(Array.isArray(res.body.rows[0])).toBe(true);
    expect(res.body.rows[0]).toHaveLength(res.body.columns.length);
  });

  it('giữ NULL là null, không biến thành chuỗi "null"', async () => {
    const datasetId = await makeDataset();

    const res = await request(app)
      .get(`/api/v1/datasets/${datasetId}/preview`)
      .set(bearer(f.tokenAlice));

    // `tenants.owner_user_id` NULL với tổ chức thật. Chuỗi "null" và giá trị
    // null trông giống nhau trên màn hình nhưng khác hẳn khi dựng mô hình:
    // một bên là "không có giá trị", bên kia là một giá trị bốn ký tự.
    const owner = res.body.columns.indexOf('owner_user_id');
    expect(owner).toBeGreaterThanOrEqual(0);
    const values = (res.body.rows as unknown[][]).map((row) => row[owner]);
    expect(values).toContain(null);
    expect(values).not.toContain('null');
  });

  it('không quá số dòng backend cho phép', async () => {
    const datasetId = await makeDataset();

    const res = await request(app)
      .get(`/api/v1/datasets/${datasetId}/preview`)
      .set(bearer(f.tokenAlice));

    // Client KHÔNG chọn được số dòng. Thử ép cũng phải bị bỏ qua — nếu không,
    // một `limit` khổng lồ sẽ kéo cả bảng của khách hàng vào bộ nhớ Node.
    const forced = await request(app)
      .get(`/api/v1/datasets/${datasetId}/preview?limit=999999`)
      .set(bearer(f.tokenAlice));

    expect(res.body.limit).toBe(100);
    expect(forced.body.limit).toBe(100);
    expect(res.body.rows.length).toBeLessThanOrEqual(100);
  });

  it('viewer BỊ CHẶN, và dataset của tổ chức khác thì 404', async () => {
    const datasetId = await makeDataset();

    /*
     * Ca này ĐẢO CHIỀU ở migration 26, và lý lẽ cũ đáng được ghi lại nguyên văn
     * vì nó nghe rất xuôi: "viewer là vai trò của người đọc báo cáo; chặn họ xem
     * dữ liệu nằm dưới báo cáo là chặn đúng việc họ được mời vào để làm."
     *
     * Chỗ sai nằm ở chữ "nằm dưới". Xem trước KHÔNG trả về dữ liệu của báo cáo
     * — nó trả về dòng thô của cả bảng, đủ mọi cột, kể cả những cột không biểu
     * đồ nào chạm tới. Một báo cáo doanh thu theo tháng dựng trên bảng nhân sự
     * thì "thứ nằm dưới" nó có cả cột lương.
     *
     * Việc viewer được mời vào để làm vẫn chạy nguyên: `GET /reports/:id/data`
     * không đi qua `authorize('dataset', 'read')`.
     */
    expect(
      (await request(app).get(`/api/v1/datasets/${datasetId}/preview`).set(bearer(f.tokenDave)))
        .status,
    ).toBe(403);

    expect(
      (await request(app).get(`/api/v1/datasets/${datasetId}/preview`).set(bearer(f.tokenCarol)))
        .status,
    ).toBe(404);

    expect((await request(app).get(`/api/v1/datasets/${datasetId}/preview`)).status).toBe(401);
  });
});

describe('đồng bộ (§8.6, §8.7)', () => {
  const TABLES = [
    { schema: env.MYSQL_DATABASE, table: 'users' },
    { schema: env.MYSQL_DATABASE, table: 'tenants' },
  ];

  const sync = (id: number, tables = TABLES, token = f.tokenAlice) =>
    request(app).post(`/api/v1/connections/${id}/sync`).set(bearer(token)).send({ tables });

  it('liệt kê bảng nguồn và đánh dấu cái đã nhập', async () => {
    const id = await makeConnection(f.tokenAlice);

    const before = await request(app)
      .get(`/api/v1/connections/${id}/tables`)
      .set(bearer(f.tokenAlice));
    expect(before.status).toBe(200);
    expect(before.body.length).toBeGreaterThan(0);
    expect(before.body.every((t: { imported: boolean }) => !t.imported)).toBe(true);

    await sync(id);

    // Cờ `imported` chính là cơ chế nhớ lựa chọn giữa hai lần đồng bộ — hộp
    // thoại tích sẵn những bảng này, không cần cột nào lưu trữ.
    const after = await request(app)
      .get(`/api/v1/connections/${id}/tables`)
      .set(bearer(f.tokenAlice));
    const users = after.body.find((t: { table: string }) => t.table === 'users');
    expect(users.imported).toBe(true);
  });

  it('tạo dataset kèm đúng số cột', async () => {
    const id = await makeConnection(f.tokenAlice);
    const res = await sync(id);

    expect(res.status).toBe(200);
    expect(res.body.added).toHaveLength(2);
    expect(res.body.failed).toHaveLength(0);

    const list = await request(app).get('/api/v1/datasets').set(bearer(f.tokenAlice));
    expect(list.body.total).toBe(2);

    const detail = await request(app)
      .get(`/api/v1/datasets/${list.body.items[0].id}`)
      .set(bearer(f.tokenAlice));
    expect(detail.body.columns.length).toBeGreaterThan(0);
    expect(detail.body.columnCount).toBe(detail.body.columns.length);
    // Thứ tự cột phải giữ đúng như trong CSDL nguồn.
    expect(detail.body.columns[0].ordinal).toBe(1);
  });

  it('đồng bộ LẦN HAI không nhân đôi, và báo "không đổi"', async () => {
    const id = await makeConnection(f.tokenAlice);
    await sync(id);

    const again = await sync(id);
    expect(again.body.added).toHaveLength(0);
    expect(again.body.unchanged).toHaveLength(2);

    // Thiếu ràng buộc UNIQUE thì mỗi lần bấm Đồng bộ là kho dữ liệu nhân đôi.
    const list = await request(app).get('/api/v1/datasets').set(bearer(f.tokenAlice));
    expect(list.body.total).toBe(2);
  });

  it('bảng nguồn thêm cột -> lần đồng bộ sau cập nhật, không tạo bản mới', async () => {
    const id = await makeConnection(f.tokenAlice);
    // Bảng nguồn chỉ cần là MỘT bảng có thật trong `bi_platform`; nội dung của
    // nó không liên quan tới điều đang kiểm. Trước đây là `projects`, nay bảng
    // đó không còn (migration 17).
    const table = { schema: env.MYSQL_DATABASE, table: 'workspaces' };
    await sync(id, [table]);

    const before = await request(app).get('/api/v1/datasets').set(bearer(f.tokenAlice));
    const datasetId = before.body.items[0].id as number;
    const beforeCount = before.body.items[0].columnCount as number;

    await mysqlPool.query('ALTER TABLE workspaces ADD COLUMN test_cot_moi VARCHAR(10) NULL');
    try {
      const res = await sync(id, [table]);
      expect(res.body.updated).toHaveLength(1);
      expect(res.body.added).toHaveLength(0);

      const after = await request(app)
        .get(`/api/v1/datasets/${datasetId}`)
        .set(bearer(f.tokenAlice));
      expect(after.body.columnCount).toBe(beforeCount + 1);
      expect(after.body.columns.map((c: { name: string }) => c.name)).toContain('test_cot_moi');
    } finally {
      await mysqlPool.query('ALTER TABLE workspaces DROP COLUMN test_cot_moi');
    }
  });

  it('bảng nguồn biến mất -> dataset VẪN CÒN, chỉ báo lỗi bảng đó', async () => {
    const id = await makeConnection(f.tokenAlice);
    await sync(id);

    const res = await sync(id, [
      ...TABLES,
      { schema: env.MYSQL_DATABASE, table: 'bang_khong_ton_tai' },
    ]);

    expect(res.body.failed).toHaveLength(1);
    expect(res.body.failed[0].table).toContain('bang_khong_ton_tai');

    // Luật quan trọng nhất của cả service: một bảng hỏng KHÔNG kéo cả mẻ, và
    // "lần quét này không thấy" KHÔNG BAO GIỜ có nghĩa là xoá.
    expect(res.body.unchanged).toHaveLength(2);
    const list = await request(app).get('/api/v1/datasets').set(bearer(f.tokenAlice));
    expect(list.body.total).toBe(2);
  });

  it('đổi tên dataset sống qua lần đồng bộ sau', async () => {
    const id = await makeConnection(f.tokenAlice);
    await sync(id, [{ schema: env.MYSQL_DATABASE, table: 'users' }]);

    const list = await request(app).get('/api/v1/datasets').set(bearer(f.tokenAlice));
    const datasetId = list.body.items[0].id as number;

    await request(app)
      .patch(`/api/v1/datasets/${datasetId}`)
      .set(bearer(f.tokenAlice))
      .send({ name: 'Danh sách người dùng' });

    await sync(id, [{ schema: env.MYSQL_DATABASE, table: 'users' }]);

    // Đồng bộ định kỳ mà xoá mất công sức đặt tên của người dùng là kiểu hỏng
    // họ chỉ phát hiện sau khi đã đặt tên cho vài chục dataset.
    const after = await request(app)
      .get(`/api/v1/datasets/${datasetId}`)
      .set(bearer(f.tokenAlice));
    expect(after.body.name).toBe('Danh sách người dùng');
    expect(after.body.sourceTable).toBe('users');
  });

  it('creator đồng bộ và xoá dataset qua kết nối CỦA MÌNH', async () => {
    /*
     * Kết nối do CHÍNH creator dựng — không phải của admin nữa.
     *
     * Ca này từng đồng bộ qua kết nối của admin, và nó chạy được vì creator khi
     * đó nhìn thấy kho của tổ chức. Sau khi cắt vế đó, đường ấy trả 404, và
     * đường đúng là creator tự khai CSDL của mình.
     */
    const id = await makeConnection(f.tokenBob, 'Máy của Bình');

    expect((await sync(id, TABLES, f.tokenBob)).status).toBe(200);

    const list = await request(app).get('/api/v1/datasets').set(bearer(f.tokenBob));
    const datasetId = list.body.items[0].id as number;

    // §7.8: creator trở lên tạo/xoá được bộ dữ liệu. Xoá ở đây là xoá MỀM và
    // đồng bộ lại hồi sinh đúng bản ghi cũ, nên nó không phải thao tác một
    // chiều. Xem chú thích ở `EDITOR_ROUTES` phía trên.
    expect(
      (await request(app).delete(`/api/v1/datasets/${datasetId}`).set(bearer(f.tokenBob))).status,
    ).toBe(204);
  });

  it('creator KHÔNG đồng bộ được qua kết nối của tổ chức', async () => {
    /*
     * Mặt còn lại, và là chỗ đáng canh nhất của cả quyết định này.
     *
     * `/sync` gác bằng `dataset:modify` — ô mà creator CÓ — rồi nhận
     * `connectionId` thẳng từ URL. Nếu `findSecret` không lọc theo phạm vi thì
     * creator gõ đúng id là rút được dữ liệu bằng thông tin đăng nhập của
     * admin, trên những bảng mà admin chưa từng chọn đồng bộ. Danh sách rỗng ở
     * giao diện KHÔNG chặn được điều đó — nó chỉ giấu id đi.
     *
     * 404 chứ không 403: ở tầng này "không phải của bạn" và "không tồn tại"
     * phải cho ra cùng một câu.
     */
    const cuaAdmin = await makeConnection(f.tokenAlice);

    expect((await sync(cuaAdmin, TABLES, f.tokenBob)).status).toBe(404);

    // Và cũng không xoá được nó. Xoá kết nối kéo theo mọi bộ dữ liệu dựng trên
    // nó, của cả tổ chức.
    expect(
      (await request(app).delete(`/api/v1/connections/${cuaAdmin}`).set(bearer(f.tokenBob))).status,
    ).toBe(404);
  });

  it('danh sách bảng rỗng -> 400, không phải một lần đồng bộ không làm gì', async () => {
    const id = await makeConnection(f.tokenAlice);
    expect((await sync(id, [])).status).toBe(400);
  });
});

describe('xoá', () => {
  it('xoá kết nối còn dataset -> 409 kèm số lượng', async () => {
    const id = await makeConnection(f.tokenAlice);
    await request(app)
      .post(`/api/v1/connections/${id}/sync`)
      .set(bearer(f.tokenAlice))
      .send({ tables: [{ schema: env.MYSQL_DATABASE, table: 'users' }] });

    const res = await request(app).delete(`/api/v1/connections/${id}`).set(bearer(f.tokenAlice));
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('ConnectionInUse');
    // Nói rõ còn bao nhiêu phải dọn, thay vì chỉ "không xoá được".
    expect(res.body.message).toContain('1');
  });

  it('dọn hết dataset rồi thì xoá được', async () => {
    const id = await makeConnection(f.tokenAlice);
    await request(app)
      .post(`/api/v1/connections/${id}/sync`)
      .set(bearer(f.tokenAlice))
      .send({ tables: [{ schema: env.MYSQL_DATABASE, table: 'users' }] });

    const list = await request(app).get('/api/v1/datasets').set(bearer(f.tokenAlice));
    await request(app)
      .delete(`/api/v1/datasets/${list.body.items[0].id}`)
      .set(bearer(f.tokenAlice));

    expect(
      (await request(app).delete(`/api/v1/connections/${id}`).set(bearer(f.tokenAlice))).status,
    ).toBe(204);
  });

  it('xoá dataset rồi đồng bộ lại thì HỒI SINH đúng bản ghi cũ', async () => {
    const id = await makeConnection(f.tokenAlice);
    const table = [{ schema: env.MYSQL_DATABASE, table: 'users' }];
    await request(app)
      .post(`/api/v1/connections/${id}/sync`)
      .set(bearer(f.tokenAlice))
      .send({ tables: table });

    const before = await request(app).get('/api/v1/datasets').set(bearer(f.tokenAlice));
    const datasetId = before.body.items[0].id as number;

    await request(app).delete(`/api/v1/datasets/${datasetId}`).set(bearer(f.tokenAlice));
    expect(
      (await request(app).get('/api/v1/datasets').set(bearer(f.tokenAlice))).body.total,
    ).toBe(0);

    await request(app)
      .post(`/api/v1/connections/${id}/sync`)
      .set(bearer(f.tokenAlice))
      .send({ tables: table });

    // GIỮ NGUYÊN id: xoá mềm + `deleted_at = NULL` trong nhánh upsert. Xoá cứng
    // thì lần đồng bộ sau tạo id mới và mọi thứ trỏ tới dataset cũ đứt hẳn.
    const after = await request(app).get('/api/v1/datasets').set(bearer(f.tokenAlice));
    expect(after.body.total).toBe(1);
    expect(after.body.items[0].id).toBe(datasetId);
  });
});

describe('chặn SSRF', () => {
  /**
   * `ALLOW_PRIVATE_DB_HOSTS` mặc định BẬT ở môi trường test (NODE_ENV != production),
   * và cả bộ test này dựa vào đó để nối tới MySQL trên localhost. Nên ở đây chỉ
   * kiểm được nhánh "định dạng host sai" — nhánh chặn IP nội bộ phải thử tay với
   * cờ tắt.
   *
   * Ghi ra chứ không giấu: đây là lỗ hổng che phủ thật của bộ test, không phải
   * một luật không tồn tại.
   */
  it('tên miền không phân giải được -> 400 kèm lý do, không phải 500', async () => {
    const res = await request(app)
      .post('/api/v1/connections/test')
      .set(bearer(f.tokenAlice))
      .send({ ...SOURCE, name: 'Thử', host: 'khong-ton-tai.invalid' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/không phân giải|địa chỉ/i);
  });

  it('host có ký tự lạ bị chặn ngay ở tầng schema', async () => {
    for (const host of ['localhost;DROP', 'a b', 'http://x.com']) {
      const res = await request(app)
        .post('/api/v1/connections/test')
        .set(bearer(f.tokenAlice))
        .send({ ...SOURCE, name: 'Thử', host });
      expect(res.status).toBe(400);
    }
  });
});

describe('danh sách kho dữ liệu (§8.5)', () => {
  it('sort ngoài whitelist -> 400, không đi vào ORDER BY', async () => {
    const res = await request(app)
      .get('/api/v1/datasets')
      .query({ sort: 'password_hash' })
      .set(bearer(f.tokenAlice));

    expect(res.status).toBe(400);
  });

  it('trùng tên kết nối trong cùng tổ chức -> 409', async () => {
    await makeConnection(f.tokenAlice, 'Kho chung');
    const res = await request(app)
      .post('/api/v1/connections')
      .set(bearer(f.tokenAlice))
      .send({ ...SOURCE, name: 'Kho chung' });

    expect(res.status).toBe(409);
    expect(res.body.fields?.name).toBeDefined();
  });

  it('hai tổ chức khác nhau đặt trùng tên kết nối là chuyện bình thường', async () => {
    await makeConnection(f.tokenAlice, 'CSDL chính');
    expect((await makeConnection(f.tokenCarol, 'CSDL chính')) > 0).toBe(true);
  });
});
