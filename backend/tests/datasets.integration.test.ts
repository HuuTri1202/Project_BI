import type { RowDataPacket } from 'mysql2';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
import { env } from '../src/config/env';
import { closeMysql, mysqlPool } from '../src/config/mysql';
import { closeRedis } from '../src/config/redis';
import { open } from '../src/services/connections/secretBox';
import { resetDatabase } from './helpers/db';
import { bearer, makeMembership, makeTenant, makeUser, signTokenFor } from './helpers/fixtures';

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

  /** Mọi vai trò đọc được. */
  const READ_ROUTES: [Method, string][] = [['get', '/api/v1/datasets']];

  /** Admin HOẶC creator — viewer bị chặn. */
  const EDITOR_ROUTES: [Method, string][] = [
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

  /** CHỈ admin tổ chức. */
  const ADMIN_ROUTES: [Method, string][] = [
    ['get', '/api/v1/connections'],
    ['get', '/api/v1/connections/prerequisites'],
    ['post', '/api/v1/connections'],
    ['post', '/api/v1/connections/test'],
    ['patch', '/api/v1/connections/1'],
    ['post', '/api/v1/connections/1/test'],
    ['delete', '/api/v1/connections/1'],
  ];

  it.each([...READ_ROUTES, ...EDITOR_ROUTES, ...ADMIN_ROUTES])(
    'không token: %s %s -> 401',
    async (method, path) => {
      expect((await request(app)[method](path)).status).toBe(401);
    },
  );

  it.each([...EDITOR_ROUTES, ...ADMIN_ROUTES])('viewer: %s %s -> 403', async (method, path) => {
    const res = await request(app)[method](path).set(bearer(f.tokenDave)).send({});
    expect(res.status).toBe(403);
  });

  it.each(ADMIN_ROUTES)('creator: %s %s -> 403', async (method, path) => {
    const res = await request(app)[method](path).set(bearer(f.tokenBob)).send({});
    expect(res.status).toBe(403);
  });

  it.each(READ_ROUTES)('viewer ĐỌC được: %s %s -> 200', async (method, path) => {
    expect((await request(app)[method](path).set(bearer(f.tokenDave))).status).toBe(200);
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

  it('viewer XEM ĐƯỢC, và dataset của tổ chức khác thì 404', async () => {
    const datasetId = await makeDataset();

    // Viewer là vai trò của người đọc báo cáo. Chặn họ xem dữ liệu nằm dưới báo
    // cáo là chặn đúng việc họ được mời vào để làm.
    expect(
      (await request(app).get(`/api/v1/datasets/${datasetId}/preview`).set(bearer(f.tokenDave)))
        .status,
    ).toBe(200);

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
    const table = { schema: env.MYSQL_DATABASE, table: 'projects' };
    await sync(id, [table]);

    const before = await request(app).get('/api/v1/datasets').set(bearer(f.tokenAlice));
    const datasetId = before.body.items[0].id as number;
    const beforeCount = before.body.items[0].columnCount as number;

    await mysqlPool.query('ALTER TABLE projects ADD COLUMN test_cot_moi VARCHAR(10) NULL');
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
      await mysqlPool.query('ALTER TABLE projects DROP COLUMN test_cot_moi');
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

  it('creator đồng bộ VÀ xoá được dataset, nhưng không đụng được kết nối', async () => {
    const id = await makeConnection(f.tokenAlice);

    expect((await sync(id, TABLES, f.tokenBob)).status).toBe(200);

    const list = await request(app).get('/api/v1/datasets').set(bearer(f.tokenBob));
    const datasetId = list.body.items[0].id as number;

    // §7.8: creator trở lên tạo/xoá được bộ dữ liệu. Xoá ở đây là xoá MỀM và
    // đồng bộ lại hồi sinh đúng bản ghi cũ, nên nó không phải thao tác một
    // chiều. Xem chú thích ở `EDITOR_ROUTES` phía trên.
    expect(
      (await request(app).delete(`/api/v1/datasets/${datasetId}`).set(bearer(f.tokenBob))).status,
    ).toBe(204);

    // Ranh giới THẬT của creator nằm ở kết nối: mật khẩu CSDL của khách hàng là
    // việc của admin, và xoá kết nối kéo theo mọi bộ dữ liệu dựng trên nó.
    expect(
      (await request(app).delete(`/api/v1/connections/${id}`).set(bearer(f.tokenBob))).status,
    ).toBe(403);
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
