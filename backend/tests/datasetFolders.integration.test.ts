import { CHUNG } from '@bi/shared';
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
 * Thư mục bộ dữ liệu — §7.9.
 *
 * ═══ Bộ này canh gì ════════════════════════════════════════════════════════
 *
 * Không phải "CRUD chạy được" — điều đó một lần bấm tay cũng thấy. Bộ này canh
 * những chỗ hỏng mà KHÔNG ném lỗi nào, và tất cả đều đã xảy ra thật ở tab Báo
 * cáo trước khi có bộ test tương đương:
 *
 *   1. Con số cạnh thư mục lệch khỏi danh sách. Đếm thẳng trên `datasets` là
 *      cách dễ viết nhất và nó tính cả bản ghi `pending` lẫn bộ của kết nối đã
 *      xoá mềm — những thứ danh sách không hiện.
 *   2. Thư mục RỖNG biến mất. Một điều kiện lọc đặt nhầm vào `WHERE` thay vì
 *      trong bảng con là đủ: `LEFT JOIN` thoái hoá thành `INNER`.
 *   3. `null` (Chung) bị gộp với `undefined` (mọi thư mục). Cả hai đều falsy.
 *   4. Đồng bộ lại lôi bảng ra khỏi thư mục người dùng vừa xếp vào.
 *   5. Bộ dữ liệu lọt vào thư mục của workspace KHÁC rồi biến mất khỏi mọi màn
 *      hình — kể cả Chung.
 */

const app = createApp();

interface Fixture {
  tenantA: number;
  tenantB: number;
  alice: number;
  workspaceA: number;
  workspaceA2: number;
  workspaceB: number;
  tokenAlice: string;
  tokenDave: string;
  tokenCarol: string;
}

let f: Fixture;

beforeEach(async () => {
  await resetDatabase();

  const tenantA = await makeTenant('Công ty Alpha', 'cong-ty-alpha');
  const tenantB = await makeTenant('Công ty Beta', 'cong-ty-beta');
  const alice = await makeUser('alice@alpha.test', 'Nguyễn Thị An');
  const dave = await makeUser('dave@alpha.test', 'Phạm Văn Dũng');
  const carol = await makeUser('carol@beta.test', 'Lê Thị Cúc');

  await makeMembership(alice, tenantA, 'admin');
  await makeMembership(dave, tenantA, 'viewer');
  await makeMembership(carol, tenantB, 'admin');

  await capGoiKhongGioiHan(tenantA, alice);
  await capGoiKhongGioiHan(tenantB, carol);

  f = {
    tenantA,
    tenantB,
    alice,
    workspaceA: await makeWorkspace(tenantA, 'Kinh doanh', 'kinh-doanh'),
    workspaceA2: await makeWorkspace(tenantA, 'Kho vận', 'kho-van'),
    workspaceB: await makeWorkspace(tenantB, 'Kế toán', 'ke-toan'),
    tokenAlice: signTokenFor(alice, tenantA, 'admin'),
    tokenDave: signTokenFor(dave, tenantA, 'viewer'),
    tokenCarol: signTokenFor(carol, tenantB, 'admin'),
  };
});

afterAll(async () => {
  await closeMysql();
  await closeRedis();
});

/* ─── Tiện ích ────────────────────────────────────────────────────────────── */

async function taoThuMuc(name: string, workspaceId?: number, token?: string): Promise<number> {
  const res = await request(app)
    .post('/api/v1/dataset-folders')
    .query({ workspaceId: workspaceId ?? f.workspaceA })
    .set(bearer(token ?? f.tokenAlice))
    .send({ name });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

/**
 * Một bộ dữ liệu nguồn `file`, ghi thẳng bằng SQL.
 *
 * Đi thẳng vào bảng chứ không qua wizard: luồng tải file cần MinIO và một file
 * thật, mà bộ này không kiểm luồng đó — nó kiểm chỗ ĐỨNG của bộ dữ liệu.
 */
async function moBoDuLieu(opts: {
  name: string;
  workspaceId?: number;
  folderId?: number | null;
  status?: 'ready' | 'pending' | 'failed';
  connectionId?: number;
  deleted?: boolean;
}): Promise<number> {
  const [r] = await mysqlPool.query<ResultSetHeader>(
    `INSERT INTO datasets
       (tenant_id, workspace_id, folder_id, source, name, status, connection_id, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ${opts.deleted === true ? 'NOW(3)' : 'NULL'})`,
    [
      f.tenantA,
      opts.workspaceId ?? f.workspaceA,
      opts.folderId ?? null,
      opts.connectionId === undefined ? 'file' : 'connection',
      opts.name,
      opts.status ?? 'ready',
      opts.connectionId ?? null,
    ],
  );
  return r.insertId;
}

/** Danh sách thư mục + số của Chung, đúng thứ cột bên trái vẽ. */
async function docThuMuc(
  workspaceId?: number,
): Promise<{ items: { id: number; name: string; itemCount: number }[]; chungCount: number }> {
  const res = await request(app)
    .get('/api/v1/dataset-folders')
    .query({ workspaceId: workspaceId ?? f.workspaceA })
    .set(bearer(f.tokenAlice))
    .expect(200);
  return res.body;
}

/** Danh sách bộ dữ liệu như trang Kho dữ liệu hỏi nó. */
async function docDanhSach(query: Record<string, string | number>): Promise<{
  total: number;
  items: { id: number; name: string; folderId: number | null; folderName: string | null }[];
}> {
  const res = await request(app)
    .get('/api/v1/datasets')
    .query({ workspaceId: f.workspaceA, ...query })
    .set(bearer(f.tokenAlice))
    .expect(200);
  return res.body;
}

/* ─── Ca ──────────────────────────────────────────────────────────────────── */

describe('Tạo, đổi tên, xoá thư mục', () => {
  it('thư mục mới rỗng và hiện ra ngay — kể cả khi chưa có gì bên trong', async () => {
    // Thư mục rỗng mà không hiện thì người vừa tạo đi tìm không ra, tạo lần
    // nữa, và lần đó đâm vào UNIQUE với một câu lỗi họ không hiểu.
    const id = await taoThuMuc('Bán hàng');

    const tm = await docThuMuc();
    expect(tm.items).toHaveLength(1);
    expect(tm.items[0]).toMatchObject({ id, name: 'Bán hàng', itemCount: 0 });
  });

  it('trùng tên trong cùng workspace -> 409, khác workspace thì không sao', async () => {
    await taoThuMuc('Bán hàng');

    const trung = await request(app)
      .post('/api/v1/dataset-folders')
      .query({ workspaceId: f.workspaceA })
      .set(bearer(f.tokenAlice))
      .send({ name: 'Bán hàng' })
      .expect(409);
    expect(trung.body.error).toBe('DuplicateName');

    // Workspace khác là một tủ hồ sơ khác; hai cái tên giống nhau không liên
    // quan gì tới nhau.
    await taoThuMuc('Bán hàng', f.workspaceA2);
  });

  it(`không đặt tên thư mục là "${CHUNG}" — UNIQUE không thấy va chạm nào`, async () => {
    /*
     * Chung không phải một bản ghi, nên database không có gì để chặn. Để lọt
     * thì cột bên trái hiện HAI dòng "Chung" — một ảo, một thật — và không có
     * cách nào nhìn ra cái nào là cái nào.
     */
    for (const ten of [CHUNG, 'chung', 'CHUNG', '  Chung  ']) {
      const res = await request(app)
        .post('/api/v1/dataset-folders')
        .query({ workspaceId: f.workspaceA })
        .set(bearer(f.tokenAlice))
        .send({ name: ten });
      expect(res.status, `tên "${ten}"`).toBe(400);
      // Câu giải thích đi kèm ĐÚNG Ô nhập, không nằm ở thông báo chung: hộp
      // thoại đặt tên hiện nó ngay dưới ô, chỗ người dùng đang nhìn.
      expect(String(res.body.fields?.name ?? '')).toContain(CHUNG);
    }
  });

  it('đổi tên giữ nguyên bộ dữ liệu bên trong', async () => {
    const id = await taoThuMuc('Bán hàng');
    await moBoDuLieu({ name: 'Đơn hàng', folderId: id });

    await request(app)
      .patch(`/api/v1/dataset-folders/${String(id)}`)
      .set(bearer(f.tokenAlice))
      .send({ name: 'Kinh doanh' })
      .expect(200);

    const tm = await docThuMuc();
    expect(tm.items[0]).toMatchObject({ name: 'Kinh doanh', itemCount: 1 });
  });

  it('XOÁ thư mục KHÔNG xoá bộ dữ liệu — chúng về Chung', async () => {
    /*
     * Đây là điều khoản đắt nhất của cả tính năng: xoá một thư mục không được
     * phép làm mất dữ liệu. Luật nằm ở khoá ngoại `ON DELETE SET NULL` của
     * migration 39, không ở service — nên nó còn đúng với mọi đường xoá thêm
     * về sau.
     */
    const id = await taoThuMuc('Bán hàng');
    const ds = await moBoDuLieu({ name: 'Đơn hàng', folderId: id });

    await request(app)
      .delete(`/api/v1/dataset-folders/${String(id)}`)
      .set(bearer(f.tokenAlice))
      .expect(204);

    const sau = await docDanhSach({ folder: 'chung' });
    expect(sau.items.map((d) => d.id)).toContain(ds);
    expect(sau.items[0]?.folderId).toBeNull();
  });

  it('thư mục của tổ chức khác -> 404, không phải 403', async () => {
    const cuaB = await taoThuMuc('Kế toán', f.workspaceB, f.tokenCarol);

    await request(app)
      .patch(`/api/v1/dataset-folders/${String(cuaB)}`)
      .set(bearer(f.tokenAlice))
      .send({ name: 'Đổi trộm' })
      .expect(404);
    await request(app)
      .delete(`/api/v1/dataset-folders/${String(cuaB)}`)
      .set(bearer(f.tokenAlice))
      .expect(404);
  });

  it('viewer bị chặn ở CẢ đọc lẫn ghi — đúng như với chính Kho dữ liệu', async () => {
    /*
     * Viewer CỐ Ý không có `dataset:read` (xem `rbac.ts`): họ xem báo cáo, không
     * xem kho. Cột thư mục gác bằng đúng ô quyền của danh sách nó đứng cạnh —
     * lỏng hơn một nấc là để viewer đọc được tên mọi thư mục dữ liệu của tổ
     * chức qua một endpoint mà không màn hình nào của họ gọi tới.
     */
    const id = await taoThuMuc('Bán hàng');
    const ds = await moBoDuLieu({ name: 'Đơn hàng' });

    await request(app)
      .get('/api/v1/dataset-folders')
      .query({ workspaceId: f.workspaceA })
      .set(bearer(f.tokenDave))
      .expect(403);

    await request(app)
      .post('/api/v1/dataset-folders')
      .query({ workspaceId: f.workspaceA })
      .set(bearer(f.tokenDave))
      .send({ name: 'Của viewer' })
      .expect(403);

    await request(app)
      .patch(`/api/v1/datasets/${String(ds)}/folder`)
      .set(bearer(f.tokenDave))
      .send({ folderId: id })
      .expect(403);
  });
});

describe('Chỗ đứng của một bộ dữ liệu', () => {
  it('không chọn gì thì vào Chung, và Chung đếm đúng', async () => {
    await moBoDuLieu({ name: 'Đơn hàng' });
    await moBoDuLieu({ name: 'Khách hàng' });

    const tm = await docThuMuc();
    expect(tm.chungCount).toBe(2);

    const ds = await docDanhSach({ folder: 'chung' });
    expect(ds.total).toBe(2);
    expect(ds.items.every((d) => d.folderId === null)).toBe(true);
  });

  it('chuyển sang thư mục rồi chuyển về Chung', async () => {
    const id = await taoThuMuc('Bán hàng');
    const ds = await moBoDuLieu({ name: 'Đơn hàng' });

    const vao = await request(app)
      .patch(`/api/v1/datasets/${String(ds)}/folder`)
      .set(bearer(f.tokenAlice))
      .send({ folderId: id })
      .expect(200);
    // Phản hồi mang sẵn tên thư mục: danh sách in nó ngay dưới tên bộ dữ liệu,
    // nên bắt frontend tra bảng thứ hai chỉ để hiện một dòng chữ là thừa.
    expect(vao.body).toMatchObject({ folderId: id, folderName: 'Bán hàng' });

    const ve = await request(app)
      .patch(`/api/v1/datasets/${String(ds)}/folder`)
      .set(bearer(f.tokenAlice))
      .send({ folderId: null })
      .expect(200);
    expect(ve.body).toMatchObject({ folderId: null, folderName: null });
  });

  it('chuyển vào thư mục của WORKSPACE KHÁC -> 404', async () => {
    /*
     * Khoá ngoại chỉ buộc được "thư mục có tồn tại". Thiếu vế "cùng workspace"
     * thì bộ dữ liệu lọt sang thư mục của workspace khác và BIẾN MẤT khỏi mọi
     * màn hình: Kho dữ liệu lọc theo workspace đang mở, nên không chỗ nào hiện
     * nó ra nữa, kể cả Chung.
     */
    const cuaWsKhac = await taoThuMuc('Kho vận', f.workspaceA2);
    const ds = await moBoDuLieu({ name: 'Đơn hàng', workspaceId: f.workspaceA });

    await request(app)
      .patch(`/api/v1/datasets/${String(ds)}/folder`)
      .set(bearer(f.tokenAlice))
      .send({ folderId: cuaWsKhac })
      .expect(404);

    const ds2 = await docDanhSach({ folder: 'chung' });
    expect(ds2.items.map((d) => d.id)).toContain(ds);
  });

  it('chuyển thư mục KHÔNG dập mốc "Cập nhật lần cuối"', async () => {
    /*
     * `updated_at` khai `ON UPDATE CURRENT_TIMESTAMP(3)`, nên một câu UPDATE
     * bình thường sẽ dập nó. Nhưng cột đó hiện ra với tên "Cập nhật lần cuối"
     * và người đọc hiểu là "lần cuối dữ liệu được làm mới" — xếp lại mười bộ
     * vào thư mục không phải là đồng bộ lại mười bộ.
     */
    const id = await taoThuMuc('Bán hàng');
    const ds = await moBoDuLieu({ name: 'Đơn hàng' });
    await mysqlPool.query('UPDATE datasets SET updated_at = ? WHERE id = ?', [
      '2020-01-01 00:00:00.000',
      ds,
    ]);

    await request(app)
      .patch(`/api/v1/datasets/${String(ds)}/folder`)
      .set(bearer(f.tokenAlice))
      .send({ folderId: id })
      .expect(200);

    const [rows] = await mysqlPool.query<RowDataPacket[]>(
      "SELECT DATE_FORMAT(updated_at, '%Y') AS y FROM datasets WHERE id = ?",
      [ds],
    );
    expect(rows[0]?.['y']).toBe('2020');
  });
});

describe('Bộ lọc thư mục — BA trạng thái, không phải hai', () => {
  it('vắng mặt = mọi thư mục; `chung` = chưa xếp; số = đúng thư mục đó', async () => {
    // `null` và `undefined` đều falsy, nên `if (folderId)` gộp "Chung" thành
    // "tất cả" — và không có lỗi nào để lần ra.
    const id = await taoThuMuc('Bán hàng');
    await moBoDuLieu({ name: 'Trong thư mục', folderId: id });
    await moBoDuLieu({ name: 'Ở Chung' });

    expect((await docDanhSach({})).total).toBe(2);
    expect((await docDanhSach({ folder: 'chung' })).total).toBe(1);
    expect((await docDanhSach({ folder: String(id) })).total).toBe(1);
    expect((await docDanhSach({ folder: String(id) })).items[0]?.name).toBe('Trong thư mục');
  });

  it('giá trị rác rơi về "mọi thư mục", không phải 400', async () => {
    await moBoDuLieu({ name: 'Đơn hàng' });
    // Một link cũ bị cắt hay một tham số gõ tay không được làm trắng cả trang.
    for (const rac of ['abc', '0', '-3']) {
      expect((await docDanhSach({ folder: rac })).total, rac).toBe(1);
    }
  });
});

describe('Con số cạnh thư mục KHỚP danh sách', () => {
  it('bản ghi `pending` và bộ đã xoá mềm không được tính', async () => {
    /*
     * Đếm thẳng trên bảng `datasets` là cách dễ viết nhất và nó sai: bản ghi
     * `pending` là rác của những lần đóng wizard giữa chừng, và bộ đã xoá mềm
     * thì người dùng không thấy. Cả hai đều lọt vào một phép COUNT ngây thơ.
     */
    const id = await taoThuMuc('Bán hàng');
    await moBoDuLieu({ name: 'Thật', folderId: id });
    await moBoDuLieu({ name: 'Bỏ dở', folderId: id, status: 'pending' });
    await moBoDuLieu({ name: 'Đã xoá', folderId: id, deleted: true });

    const tm = await docThuMuc();
    const ds = await docDanhSach({ folder: String(id) });

    expect(tm.items[0]?.itemCount).toBe(1);
    expect(tm.items[0]?.itemCount).toBe(ds.total);
  });

  it('thư mục toàn bộ dữ liệu KHÔNG hiện vẫn phải xuất hiện, với số 0', async () => {
    /*
     * Ca then chốt của `LEFT JOIN`. Nếu điều kiện "còn sống" bị nhét vào
     * `WHERE` thay vì nằm trong bảng con, LEFT JOIN thoái hoá thành INNER và cả
     * THƯ MỤC biến mất — không chỉ sai con số.
     */
    const id = await taoThuMuc('Toàn rác');
    await moBoDuLieu({ name: 'Bỏ dở', folderId: id, status: 'pending' });

    const tm = await docThuMuc();
    expect(tm.items).toHaveLength(1);
    expect(tm.items[0]).toMatchObject({ name: 'Toàn rác', itemCount: 0 });
  });

  it('Chung đếm đúng bằng số dòng danh sách Chung trả về', async () => {
    const id = await taoThuMuc('Bán hàng');
    await moBoDuLieu({ name: 'A' });
    await moBoDuLieu({ name: 'B' });
    await moBoDuLieu({ name: 'C', folderId: id });
    await moBoDuLieu({ name: 'Rác', status: 'pending' });

    const tm = await docThuMuc();
    const ds = await docDanhSach({ folder: 'chung' });
    expect(tm.chungCount).toBe(ds.total);
    expect(tm.chungCount).toBe(2);
  });

  it('thư mục của workspace khác không lọt vào danh sách', async () => {
    await taoThuMuc('Của Kinh doanh', f.workspaceA);
    await taoThuMuc('Của Kho vận', f.workspaceA2);

    const tm = await docThuMuc(f.workspaceA);
    expect(tm.items.map((x) => x.name)).toEqual(['Của Kinh doanh']);
  });
});
