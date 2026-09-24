import type { RowDataPacket } from 'mysql2';
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
  makeReport,
  makeTenant,
  makeUser,
  makeWorkspace,
  signTokenFor,
} from './helpers/fixtures';

/**
 * Thư mục báo cáo — §10.25, chạy trên MySQL thật.
 *
 * ═══ Bộ này canh những gì chỉ database mới trả lời được ════════════════════
 *
 * Phần hình dạng request đã có zod canh. Ở đây là bốn chuyện mà không một bài
 * test đơn vị nào chạm tới, vì cả bốn đều là hành vi của schema:
 *
 *   1. XOÁ THƯ MỤC KHÔNG XOÁ BÁO CÁO. Luật này nằm ở khoá ngoại `ON DELETE SET
 *      NULL`, không ở TypeScript — nên nó phải được kiểm ở nơi có khoá ngoại.
 *      Đây là ca quan trọng nhất của file: hỏng nó là người dùng mất việc.
 *   2. CÁCH LY TỔ CHỨC. Mã thư mục là khoá chính toàn bảng, nên một mã đoán
 *      đúng phải bị chặn bằng `tenant_id` trong WHERE.
 *   3. CÁCH LY WORKSPACE. Khoá ngoại KHÔNG buộc thư mục đích cùng workspace với
 *      báo cáo; thiếu câu kiểm ở route thì báo cáo biến mất khỏi mọi danh sách.
 *   4. CHUYỂN THƯ MỤC KHÔNG DẬP `updated_at`. Cột đó khai `ON UPDATE
 *      CURRENT_TIMESTAMP`, nên giữ được mốc cũ là nhờ một câu SQL cố ý.
 */

const app = createApp();

interface Fixture {
  tenantA: number;
  tenantB: number;
  wsA1: number;
  wsA2: number;
  wsB: number;
  tokenA: string;
  tokenB: string;
  /** Chỉ `report:read` — để kiểm viewer không tạo được thư mục. */
  tokenViewer: string;
}

let fx: Fixture;

beforeEach(async () => {
  await resetDatabase();

  const alice = await makeUser('alice@folders.vn', 'Alice');
  const bob = await makeUser('bob@folders.vn', 'Bob');
  const eve = await makeUser('eve@folders.vn', 'Eve');

  const tenantA = await makeTenant('Tổ chức A', 'to-chuc-a', alice);
  const tenantB = await makeTenant('Tổ chức B', 'to-chuc-b', bob);
  await makeMembership(alice, tenantA, 'admin');
  await makeMembership(eve, tenantA, 'viewer');
  await makeMembership(bob, tenantB, 'admin');
  await capGoiKhongGioiHan(tenantA, alice);
  await capGoiKhongGioiHan(tenantB, bob);

  fx = {
    tenantA,
    tenantB,
    wsA1: await makeWorkspace(tenantA, 'Chính', 'chinh'),
    wsA2: await makeWorkspace(tenantA, 'Phụ', 'phu'),
    wsB: await makeWorkspace(tenantB, 'Của B', 'cua-b'),
    tokenA: signTokenFor(alice, tenantA, 'admin'),
    tokenB: signTokenFor(bob, tenantB, 'admin'),
    tokenViewer: signTokenFor(eve, tenantA, 'viewer'),
  };
});

afterAll(async () => {
  await closeMysql();
  await closeRedis();
});

/** Tạo một thư mục qua API và trả về mã của nó. */
async function taoThuMuc(token: string, workspaceId: number, name: string): Promise<number> {
  const res = await request(app)
    .post('/api/v1/report-folders')
    .query({ workspaceId })
    .set(bearer(token))
    .send({ name });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

/** Chuyển một báo cáo, khẳng định thành công. */
async function chuyen(token: string, reportId: number, folderId: number | null): Promise<void> {
  await request(app)
    .patch(`/api/v1/reports/${reportId}/folder`)
    .set(bearer(token))
    .send({ folderId })
    .expect(200);
}

describe('POST /report-folders', () => {
  it('tạo xong đếm 0 báo cáo, và hiện ra ở danh sách', async () => {
    const id = await taoThuMuc(fx.tokenA, fx.wsA1, 'Bán hàng');

    const res = await request(app)
      .get('/api/v1/report-folders')
      .query({ workspaceId: fx.wsA1 })
      .set(bearer(fx.tokenA));

    expect(res.status).toBe(200);
    // Thư mục RỖNG phải hiện ra — xem ghi chú LEFT JOIN ở `listFolders`. Với
    // JOIN thường thì mảng này rỗng, và người vừa tạo thư mục bấm lần nữa.
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({ id, name: 'Bán hàng', itemCount: 0 });
  });

  it('trùng tên trong cùng workspace bị chặn', async () => {
    await taoThuMuc(fx.tokenA, fx.wsA1, 'Bán hàng');

    const res = await request(app)
      .post('/api/v1/report-folders')
      .query({ workspaceId: fx.wsA1 })
      .set(bearer(fx.tokenA))
      .send({ name: 'Bán hàng' });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('DuplicateName');
  });

  it('trùng tên ở workspace KHÁC thì được — hai nơi không liên quan gì nhau', async () => {
    await taoThuMuc(fx.tokenA, fx.wsA1, 'Bán hàng');
    await taoThuMuc(fx.tokenA, fx.wsA2, 'Bán hàng');
  });

  it('không cho đặt tên trùng chỗ chứa mặc định, kể cả khác hoa thường', async () => {
    for (const name of ['Chung', 'chung', '  CHUNG  ']) {
      const res = await request(app)
        .post('/api/v1/report-folders')
        .query({ workspaceId: fx.wsA1 })
        .set(bearer(fx.tokenA))
        .send({ name });
      // UNIQUE của database KHÔNG thấy va chạm nào ở đây, vì Chung không phải
      // một dòng. Chặn được là nhờ đúng luật zod — mất nó thì cột bên trái hiện
      // hai dòng cùng tên và không cách nào biết cái nào là cái nào.
      expect(res.status, `tên "${name}"`).toBe(400);
    }
  });

  it('viewer không tạo được thư mục', async () => {
    const res = await request(app)
      .post('/api/v1/report-folders')
      .query({ workspaceId: fx.wsA1 })
      .set(bearer(fx.tokenViewer))
      .send({ name: 'Của viewer' });

    expect(res.status).toBe(403);
  });
});

describe('Chung là folder_id IS NULL', () => {
  it('báo cáo tạo ra mà không nói gì thì nằm ở Chung', async () => {
    await makeReport(fx.tenantA, fx.wsA1, 'Báo cáo cũ');

    const res = await request(app)
      .get('/api/v1/reports')
      .query({ workspaceId: fx.wsA1 })
      .set(bearer(fx.tokenA));

    expect(res.status).toBe(200);
    expect(res.body.items[0]).toMatchObject({ folderId: null, folderName: null });
  });

  it('chungCount đếm đúng những báo cáo chưa xếp', async () => {
    await makeReport(fx.tenantA, fx.wsA1, 'Một');
    const hai = await makeReport(fx.tenantA, fx.wsA1, 'Hai');
    const id = await taoThuMuc(fx.tokenA, fx.wsA1, 'Bán hàng');
    await chuyen(fx.tokenA, hai, id);

    const res = await request(app)
      .get('/api/v1/report-folders')
      .query({ workspaceId: fx.wsA1 })
      .set(bearer(fx.tokenA));

    expect(res.body.chungCount).toBe(1);
    expect(res.body.items[0].itemCount).toBe(1);
  });

  it('lọc theo Chung là LỌC THẬT, không phải bỏ lọc', async () => {
    await makeReport(fx.tenantA, fx.wsA1, 'Ở Chung');
    const trong = await makeReport(fx.tenantA, fx.wsA1, 'Đã xếp');
    const id = await taoThuMuc(fx.tokenA, fx.wsA1, 'Bán hàng');
    await chuyen(fx.tokenA, trong, id);

    // Đây là ca canh `filter.folderId !== undefined` ở `buildWhere`. Viết thành
    // `if (filter.folderId)` thì nhánh này trả về CẢ HAI báo cáo.
    const chung = await request(app)
      .get('/api/v1/reports')
      .query({ workspaceId: fx.wsA1, folder: 'chung' })
      .set(bearer(fx.tokenA));
    expect(chung.body.items.map((r: { name: string }) => r.name)).toEqual(['Ở Chung']);

    const trongTM = await request(app)
      .get('/api/v1/reports')
      .query({ workspaceId: fx.wsA1, folder: String(id) })
      .set(bearer(fx.tokenA));
    expect(trongTM.body.items.map((r: { name: string }) => r.name)).toEqual(['Đã xếp']);

    // Không có tham số = mọi thư mục.
    const tatCa = await request(app)
      .get('/api/v1/reports')
      .query({ workspaceId: fx.wsA1 })
      .set(bearer(fx.tokenA));
    expect(tatCa.body.total).toBe(2);
  });
});

describe('Số đếm phải KHỚP danh sách', () => {
  /*
   * ═══ Lỗi người dùng báo, đo được trên dữ liệu thật ═══════════════════════
   *
   *   workspace "Không gian mặc định": danh sách hiện 4, cột thư mục đếm 12
   *   workspace "ABC":                 danh sách hiện 0, cột thư mục đếm 5
   *
   * Danh sách báo cáo GIẤU những báo cáo có nguồn (bộ dữ liệu / mô hình) đã bị
   * xoá mềm — chúng không vẽ được nữa nên không hiện. Nhưng câu đếm của cột thư
   * mục lại không giấu, vì nó đếm thẳng trên bảng `reports` mà không nối sang
   * nguồn. Hai bên dùng HAI định nghĩa khác nhau về "một báo cáo còn tồn tại".
   *
   * Cách sửa là một định nghĩa DUY NHẤT (`LIVE_REPORTS_SQL`), không phải sửa
   * riêng từng câu đếm — sửa riêng thì lần thêm một điều kiện nữa vào danh sách
   * sẽ lại lệch đúng như vậy.
   */
  async function xoaMemNguon(reportId: number): Promise<void> {
    await mysqlPool.query(
      `UPDATE datasets d
         JOIN reports r ON r.dataset_id = d.id
          SET d.deleted_at = NOW(3)
        WHERE r.id = ?`,
      [reportId],
    );
  }

  it('báo cáo có NGUỒN đã xoá không được tính vào Chung', async () => {
    await makeReport(fx.tenantA, fx.wsA1, 'Còn nguồn');
    const mocoi = await makeReport(fx.tenantA, fx.wsA1, 'Mất nguồn');
    await xoaMemNguon(mocoi);

    const ds = await request(app)
      .get('/api/v1/reports')
      .query({ workspaceId: fx.wsA1 })
      .set(bearer(fx.tokenA));
    const tm = await request(app)
      .get('/api/v1/report-folders')
      .query({ workspaceId: fx.wsA1 })
      .set(bearer(fx.tokenA));

    expect(ds.body.total).toBe(1);
    // Đây là con số in ngay cạnh chữ "Chung" trên cột bên trái. Lệch với danh
    // sách bên phải là người dùng đếm tay ra một con số khác con số hệ thống in.
    expect(tm.body.chungCount).toBe(ds.body.total);
  });

  it('báo cáo có NGUỒN đã xoá không được tính vào thư mục', async () => {
    const id = await taoThuMuc(fx.tokenA, fx.wsA1, 'Bán hàng');
    const song = await makeReport(fx.tenantA, fx.wsA1, 'Còn nguồn');
    const mocoi = await makeReport(fx.tenantA, fx.wsA1, 'Mất nguồn');
    await chuyen(fx.tokenA, song, id);
    await chuyen(fx.tokenA, mocoi, id);
    await xoaMemNguon(mocoi);

    const ds = await request(app)
      .get('/api/v1/reports')
      .query({ workspaceId: fx.wsA1, folder: String(id) })
      .set(bearer(fx.tokenA));
    const tm = await request(app)
      .get('/api/v1/report-folders')
      .query({ workspaceId: fx.wsA1 })
      .set(bearer(fx.tokenA));

    expect(ds.body.total).toBe(1);
    expect(tm.body.items[0].itemCount).toBe(ds.body.total);
  });

  it('thư mục mà MỌI báo cáo đều mất nguồn vẫn hiện ra, đếm 0', async () => {
    // Bẫy LEFT JOIN: nhét điều kiện "nguồn còn sống" vào WHERE thay vì vào phép
    // nối sẽ làm chính THƯ MỤC biến mất khỏi danh sách, không chỉ con số.
    const id = await taoThuMuc(fx.tokenA, fx.wsA1, 'Toàn mồ côi');
    const mocoi = await makeReport(fx.tenantA, fx.wsA1, 'Mất nguồn');
    await chuyen(fx.tokenA, mocoi, id);
    await xoaMemNguon(mocoi);

    const tm = await request(app)
      .get('/api/v1/report-folders')
      .query({ workspaceId: fx.wsA1 })
      .set(bearer(fx.tokenA));

    expect(tm.body.items).toHaveLength(1);
    expect(tm.body.items[0]).toMatchObject({ name: 'Toàn mồ côi', itemCount: 0 });
  });
});

describe('DELETE /report-folders/:id', () => {
  it('xoá thư mục KHÔNG xoá báo cáo — chúng quay về Chung', async () => {
    const baoCao = await makeReport(fx.tenantA, fx.wsA1, 'Doanh thu quý 1');
    const id = await taoThuMuc(fx.tokenA, fx.wsA1, 'Bán hàng');
    await chuyen(fx.tokenA, baoCao, id);

    await request(app).delete(`/api/v1/report-folders/${id}`).set(bearer(fx.tokenA)).expect(204);

    // Ca quan trọng nhất của file. `ON DELETE CASCADE` thay cho `SET NULL` làm
    // ca này đỏ — và ngoài đời thì làm người dùng mất báo cáo.
    const res = await request(app)
      .get('/api/v1/reports')
      .query({ workspaceId: fx.wsA1 })
      .set(bearer(fx.tokenA));

    expect(res.body.total).toBe(1);
    expect(res.body.items[0]).toMatchObject({ name: 'Doanh thu quý 1', folderId: null });
  });

  it('thư mục của tổ chức khác thì không xoá được', async () => {
    const id = await taoThuMuc(fx.tokenA, fx.wsA1, 'Bán hàng');

    await request(app).delete(`/api/v1/report-folders/${id}`).set(bearer(fx.tokenB)).expect(404);

    const [rows] = await mysqlPool.query<RowDataPacket[]>(
      'SELECT id FROM report_folders WHERE id = ?',
      [id],
    );
    expect(rows).toHaveLength(1);
  });
});

describe('PATCH /reports/:id/folder', () => {
  it('chuyển được cả hai chiều, và về Chung bằng folderId null', async () => {
    const baoCao = await makeReport(fx.tenantA, fx.wsA1, 'Kho hàng');
    const id = await taoThuMuc(fx.tokenA, fx.wsA1, 'Vận hành');

    const vao = await request(app)
      .patch(`/api/v1/reports/${baoCao}/folder`)
      .set(bearer(fx.tokenA))
      .send({ folderId: id });
    expect(vao.status).toBe(200);
    expect(vao.body).toMatchObject({ folderId: id, folderName: 'Vận hành' });

    const ra = await request(app)
      .patch(`/api/v1/reports/${baoCao}/folder`)
      .set(bearer(fx.tokenA))
      .send({ folderId: null });
    expect(ra.body).toMatchObject({ folderId: null, folderName: null });
  });

  it('thư mục của WORKSPACE khác bị từ chối', async () => {
    const baoCao = await makeReport(fx.tenantA, fx.wsA1, 'Kho hàng');
    // Cùng tổ chức, khác workspace — khoá ngoại KHÔNG chặn được chuyện này.
    const id = await taoThuMuc(fx.tokenA, fx.wsA2, 'Thư mục workspace khác');

    await request(app)
      .patch(`/api/v1/reports/${baoCao}/folder`)
      .set(bearer(fx.tokenA))
      .send({ folderId: id })
      .expect(404);

    // Lọt qua thì báo cáo biến mất khỏi mọi danh sách: tab Báo cáo lọc theo
    // workspace đang mở, và nó không còn thuộc workspace nào mở nó ra được.
    const res = await request(app)
      .get('/api/v1/reports')
      .query({ workspaceId: fx.wsA1 })
      .set(bearer(fx.tokenA));
    expect(res.body.items[0].folderId).toBeNull();
  });

  it('thư mục của TỔ CHỨC khác bị từ chối', async () => {
    const baoCao = await makeReport(fx.tenantA, fx.wsA1, 'Kho hàng');
    const cuaB = await taoThuMuc(fx.tokenB, fx.wsB, 'Của B');

    await request(app)
      .patch(`/api/v1/reports/${baoCao}/folder`)
      .set(bearer(fx.tokenA))
      .send({ folderId: cuaB })
      .expect(404);
  });

  it('không dập mốc "Cập nhật lần cuối" — xếp lại chỗ không phải là sửa', async () => {
    const baoCao = await makeReport(fx.tenantA, fx.wsA1, 'Kho hàng');
    const id = await taoThuMuc(fx.tokenA, fx.wsA1, 'Vận hành');

    // Đẩy mốc về quá khứ để phép so có gì để thấy.
    await mysqlPool.query('UPDATE reports SET updated_at = ? WHERE id = ?', [
      '2020-01-02 03:04:05.000',
      baoCao,
    ]);
    await chuyen(fx.tokenA, baoCao, id);

    const [rows] = await mysqlPool.query<(RowDataPacket & { updated_at: Date })[]>(
      'SELECT updated_at FROM reports WHERE id = ?',
      [baoCao],
    );
    // Mất `updated_at = updated_at` trong câu UPDATE là dòng này ra hôm nay, và
    // một buổi dọn dẹp sẽ xoá sạch lịch sử sửa thật của cả danh sách.
    expect(rows[0]?.updated_at.getFullYear()).toBe(2020);
  });

  it('viewer không chuyển được', async () => {
    const baoCao = await makeReport(fx.tenantA, fx.wsA1, 'Kho hàng');
    const id = await taoThuMuc(fx.tokenA, fx.wsA1, 'Vận hành');

    await request(app)
      .patch(`/api/v1/reports/${baoCao}/folder`)
      .set(bearer(fx.tokenViewer))
      .send({ folderId: id })
      .expect(403);
  });
});
