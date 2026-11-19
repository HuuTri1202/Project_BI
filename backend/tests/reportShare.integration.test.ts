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
 * Liên kết xem báo cáo cho người KHÔNG có tài khoản — mong muốn D5.
 *
 * ═══ Vì sao bộ này tồn tại, và vì sao nó là bộ TÍCH HỢP ════════════════════
 *
 * Đây là bề mặt KHÔNG XÁC THỰC đầu tiên của hệ thống. Mọi route khác đứng sau
 * `authenticate` + `requireFreshMembership`, nên câu "người này được xem gì"
 * luôn có một phiên để trả lời. Ở đây không có phiên nào — toàn bộ phạm vi đến
 * từ một dòng trong database, và một lỗi ở đó không phải một ô biểu đồ sai mà là
 * số liệu của một tổ chức nằm trên internet.
 *
 * Nên bộ này đi ĐƯỜNG HTTP THẬT qua chính `createApp()`: thứ phải kiểm là bề
 * mặt (router nào, guard nào, DTO nào ra ngoài), và một bài test gọi service
 * trực tiếp thì bỏ qua đúng phần đó.
 *
 * ⚠️ Báo cáo ở đây có khung RỖNG ô (`visuals: []`) một cách có chủ ý. Nhờ vậy
 * `soLieuTrangKhung` đi hết đường của nó mà không cần ClickHouse hay Cube —
 * `loadModelContext` chỉ đọc MySQL. Phần tính số liệu đã có bộ riêng; bộ này nói
 * về QUYỀN và VÒNG ĐỜI của liên kết.
 */

const app = createApp();

interface Fixture {
  tenantA: number;
  tokenA: string;
  tokenViewer: string;
  tokenB: string;
  baoCaoKhung: number;
  baoCaoThuong: number;
}

let fx: Fixture;

/** Báo cáo dạng KHUNG: cần một mô hình dữ liệu để `canvas` được đọc ra. */
async function taoBaoCaoKhung(tenantId: number, workspaceId: number): Promise<number> {
  const [mh] = await mysqlPool.query<ResultSetHeader>(
    'INSERT INTO datamodels (tenant_id, workspace_id, name) VALUES (?, ?, ?)',
    [tenantId, workspaceId, 'Mo hinh chia se'],
  );
  /*
   * MỘT ô, không phải khung rỗng.
   *
   * Bản đầu của bộ này dùng `visuals: []` để khỏi cần ClickHouse — và đỏ 5 ca,
   * vì `parseCanvas` CỐ Ý trả `null` cho một khung không còn ô nào ở bất kỳ
   * trang nào ("một khung không còn ô nào thì không phải một khung"). Đó là
   * hành vi đúng, và bài test phải chịu nó.
   *
   * Có một ô thì đường đi vẫn không cần Cube: `soLieuTrangKhung` dùng
   * `allSettled`, nên ô không đọc được số liệu chỉ mang theo câu lỗi của RIÊNG
   * nó, còn phản hồi vẫn là 200. Đúng thứ bộ này muốn kiểm — bề mặt, không phải
   * số liệu.
   */
  const canvas = JSON.stringify({
    pages: [
      {
        id: 'p1',
        name: 'Trang 1',
        visuals: [
          {
            id: 'o1',
            chartType: 'bar',
            config: { dimensionId: 1, measureId: 2 },
            x: 0,
            y: 0,
            w: 6,
            h: 7,
          },
        ],
      },
    ],
  });
  const [bc] = await mysqlPool.query<ResultSetHeader>(
    `INSERT INTO reports (tenant_id, workspace_id, datamodel_id, name, canvas)
     VALUES (?, ?, ?, ?, ?)`,
    [tenantId, workspaceId, mh.insertId, 'Doanh thu chia se', canvas],
  );
  return bc.insertId;
}

/** Báo cáo dựng trên BỘ DỮ LIỆU — dạng chưa chia sẻ được, xem ghi chú ở route. */
async function taoBaoCaoThuong(tenantId: number, workspaceId: number): Promise<number> {
  const [ds] = await mysqlPool.query<ResultSetHeader>(
    `INSERT INTO datasets (tenant_id, workspace_id, source, name, status, load_status)
     VALUES (?, ?, 'file', 'bo-du-lieu', 'ready', 'idle')`,
    [tenantId, workspaceId],
  );
  const [bc] = await mysqlPool.query<ResultSetHeader>(
    'INSERT INTO reports (tenant_id, workspace_id, dataset_id, name) VALUES (?, ?, ?, ?)',
    [tenantId, workspaceId, ds.insertId, 'Bao cao thuong'],
  );
  return bc.insertId;
}

beforeEach(async () => {
  await resetDatabase();

  const alice = await makeUser('alice@share.vn', 'Alice');
  const eve = await makeUser('eve@share.vn', 'Eve');
  const bob = await makeUser('bob@share.vn', 'Bob');

  const tenantA = await makeTenant('To chuc A', 'to-chuc-a-share', alice);
  const tenantB = await makeTenant('To chuc B', 'to-chuc-b-share', bob);
  await makeMembership(alice, tenantA, 'admin');
  await makeMembership(eve, tenantA, 'viewer');
  await makeMembership(bob, tenantB, 'admin');
  await capGoiKhongGioiHan(tenantA, alice);
  await capGoiKhongGioiHan(tenantB, bob);

  const wsA = await makeWorkspace(tenantA, 'Chinh', 'chinh-share');

  fx = {
    tenantA,
    tokenA: signTokenFor(alice, tenantA, 'admin'),
    tokenViewer: signTokenFor(eve, tenantA, 'viewer'),
    tokenB: signTokenFor(bob, tenantB, 'admin'),
    baoCaoKhung: await taoBaoCaoKhung(tenantA, wsA),
    baoCaoThuong: await taoBaoCaoThuong(tenantA, wsA),
  };
});

afterAll(async () => {
  await closeMysql();
  await closeRedis();
});

/** Tạo liên kết qua API và trả về chuỗi bí mật lấy từ URL. */
async function taoLienKet(soNgay: number | null = 7): Promise<{ id: number; chuoi: string }> {
  const res = await request(app)
    .post(`/api/v1/reports/${String(fx.baoCaoKhung)}/shares`)
    .set(bearer(fx.tokenA))
    .send({ soNgay });
  expect(res.status, JSON.stringify(res.body)).toBe(201);

  const url = res.body.url as string;
  return { id: res.body.share.id as number, chuoi: url.slice(url.lastIndexOf('/') + 1) };
}

describe('tạo liên kết là quyền SỬA, không phải quyền ĐỌC', () => {
  /**
   * Mở một báo cáo ra cho cả internet là một quyết định VỀ báo cáo đó, không
   * phải một cách xem nó. Viewer đọc được báo cáo (đó là việc của họ) nhưng
   * không được quyết định ai khác cũng đọc được.
   */
  it('viewer KHÔNG tạo được liên kết', async () => {
    const res = await request(app)
      .post(`/api/v1/reports/${String(fx.baoCaoKhung)}/shares`)
      .set(bearer(fx.tokenViewer))
      .send({ soNgay: 7 });

    expect(res.status).toBe(403);
  });

  it('người của tổ chức KHÁC nhận 404, không phải 403', async () => {
    // 403 là một lời xác nhận rằng mã báo cáo đó có tồn tại.
    const res = await request(app)
      .post(`/api/v1/reports/${String(fx.baoCaoKhung)}/shares`)
      .set(bearer(fx.tokenB))
      .send({ soNgay: 7 });

    expect(res.status).toBe(404);
  });

  it('database chỉ giữ BĂM, không giữ chuỗi', async () => {
    const { chuoi } = await taoLienKet();

    const [rows] = await mysqlPool.query<RowDataPacket[]>(
      'SELECT token_hash FROM report_shares WHERE tenant_id = ?',
      [fx.tenantA],
    );
    const bam = String(rows[0]?.['token_hash']);
    expect(bam).toHaveLength(64);
    // Một bản dump database KHÔNG cho ai mở được báo cáo nào.
    expect(bam).not.toContain(chuoi);
    expect(chuoi).toHaveLength(43);
  });
});

describe('đường công khai', () => {
  it('mở được báo cáo, và KHÔNG rò cấu trúc nội bộ của tổ chức', async () => {
    const { chuoi } = await taoLienKet();

    const res = await request(app).get(`/api/public/reports/${chuoi}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.name).toBe('Doanh thu chia se');
    expect(res.body.tenantName).toBe('To chuc A');
    expect(res.body.pageId).toBe('p1');

    /*
     * ⚠️ Khẳng định quan trọng nhất của cả file: DTO ra ngoài không mang
     * `datamodelId`, `workspaceId`, `folderName`, `creatorName`, `datasetId`.
     * Người nhận liên kết không có lý do gì để thấy cấu trúc nội bộ của tổ
     * chức, và `ReportDto` thì mang tất cả những thứ đó.
     */
    for (const khoa of [
      'datamodelId',
      'workspaceId',
      'folderName',
      'creatorName',
      'datasetId',
      'id',
    ]) {
      expect(res.body[khoa], `DTO công khai không được mang "${khoa}"`).toBeUndefined();
    }
  });

  it('KHÔNG cần và KHÔNG nhận token nào', async () => {
    const { chuoi } = await taoLienKet();
    // Không có header Authorization — đó là cả điểm của tính năng này.
    await request(app).get(`/api/public/reports/${chuoi}`).expect(200);
  });

  it('chuỗi sai định dạng -> 400, không tới database', async () => {
    await request(app).get('/api/public/reports/qua-ngan').expect(400);
  });

  it('chuỗi đúng định dạng nhưng không tồn tại -> 404', async () => {
    const res = await request(app).get(`/api/public/reports/${'a'.repeat(43)}`);
    expect(res.status).toBe(404);
    // Câu lỗi KHÔNG nói gì về báo cáo nào cả.
    expect(res.body.message).not.toContain('Doanh thu');
  });

  it('đếm lượt mở, và không lưu gì về người xem', async () => {
    const { chuoi, id } = await taoLienKet();
    await request(app).get(`/api/public/reports/${chuoi}`).expect(200);
    await request(app).get(`/api/public/reports/${chuoi}`).expect(200);

    // Đếm lượt chạy ngoài luồng trả lời (`void`), nên chờ nó bằng cách hỏi lại
    // cho tới khi thấy — không bằng một `setTimeout` đoán bừa.
    await expect
      .poll(async () => {
        const [rows] = await mysqlPool.query<RowDataPacket[]>(
          'SELECT view_count FROM report_shares WHERE id = ?',
          [id],
        );
        return Number(rows[0]?.['view_count'] ?? 0);
      })
      .toBe(2);
  });

  it('báo cáo dựng trên bộ dữ liệu -> 409 và nói rõ, không 500', async () => {
    const res = await request(app)
      .post(`/api/v1/reports/${String(fx.baoCaoThuong)}/shares`)
      .set(bearer(fx.tokenA))
      .send({ soNgay: 7 });
    expect(res.status).toBe(201);
    const url = res.body.url as string;

    const mo = await request(app).get(`/api/public/reports/${url.slice(url.lastIndexOf('/') + 1)}`);
    expect(mo.status).toBe(409);
    expect(mo.body.error).toBe('ShareNotSupported');
  });
});

describe('vòng đời của liên kết', () => {
  const duongXoa = (id: number): string =>
    `/api/v1/reports/${String(fx.baoCaoKhung)}/shares/${String(id)}`;

  it('thu hồi -> 410 kèm lý do, không phải 404', async () => {
    const { chuoi, id } = await taoLienKet();
    await request(app).get(`/api/public/reports/${chuoi}`).expect(200);

    await request(app).delete(duongXoa(id)).set(bearer(fx.tokenA)).expect(204);

    const res = await request(app).get(`/api/public/reports/${chuoi}`);
    // 410 chứ không 404: người kế toán cần biết nên nhờ gửi lại, chứ không phải
    // ngồi đoán xem mình gõ sai đường dẫn.
    expect(res.status).toBe(410);
    expect(res.body.error).toBe('ShareRevoked');
  });

  it('thu hồi hai lần -> 404 ở lần thứ hai', async () => {
    const { id } = await taoLienKet();
    await request(app).delete(duongXoa(id)).set(bearer(fx.tokenA)).expect(204);
    await request(app).delete(duongXoa(id)).set(bearer(fx.tokenA)).expect(404);
  });

  it('hết hạn -> 410, và hạn tính từ số NGÀY người tạo chọn', async () => {
    const { chuoi, id } = await taoLienKet(1);

    const [rows] = await mysqlPool.query<RowDataPacket[]>(
      'SELECT expires_at FROM report_shares WHERE id = ?',
      [id],
    );
    const han = rows[0]?.['expires_at'] as Date;
    const gio = (han.getTime() - Date.now()) / 3_600_000;
    expect(gio).toBeGreaterThan(23);
    expect(gio).toBeLessThan(25);

    // Đẩy hạn về quá khứ thay vì chờ một ngày.
    await mysqlPool.query('UPDATE report_shares SET expires_at = ? WHERE id = ?', [
      new Date(Date.now() - 1000),
      id,
    ]);

    const res = await request(app).get(`/api/public/reports/${chuoi}`);
    expect(res.status).toBe(410);
    expect(res.body.error).toBe('ShareExpired');
  });

  it('liên kết VĨNH VIỄN được, nhưng phải nói ra tường minh', async () => {
    const { chuoi, id } = await taoLienKet(null);
    await request(app).get(`/api/public/reports/${chuoi}`).expect(200);

    const [rows] = await mysqlPool.query<RowDataPacket[]>(
      'SELECT expires_at FROM report_shares WHERE id = ?',
      [id],
    );
    expect(rows[0]?.['expires_at']).toBeNull();
  });

  it('xoá báo cáo là mọi liên kết tới nó mất theo', async () => {
    const { chuoi } = await taoLienKet();

    // Xoá CỨNG để kiểm khoá ngoại ON DELETE CASCADE của migration 45.
    await mysqlPool.query('DELETE FROM reports WHERE id = ?', [fx.baoCaoKhung]);

    const [rows] = await mysqlPool.query<RowDataPacket[]>(
      'SELECT COUNT(*) AS n FROM report_shares WHERE tenant_id = ?',
      [fx.tenantA],
    );
    expect(Number(rows[0]?.['n'])).toBe(0);
    await request(app).get(`/api/public/reports/${chuoi}`).expect(404);
  });

  it('danh sách liên kết hiện cả cái đã thu hồi, và KHÔNG có chuỗi nào', async () => {
    const { id } = await taoLienKet();
    await request(app).delete(duongXoa(id)).set(bearer(fx.tokenA)).expect(204);
    await taoLienKet();

    const res = await request(app)
      .get(`/api/v1/reports/${String(fx.baoCaoKhung)}/shares`)
      .set(bearer(fx.tokenA))
      .expect(200);

    const items = res.body.items as { id: number; revokedAt: string | null; url?: string }[];
    expect(items).toHaveLength(2);
    expect(items.filter((i) => i.revokedAt !== null)).toHaveLength(1);
    // Chuỗi chỉ tồn tại ở phản hồi của lần TẠO — database giữ băm.
    for (const i of items) expect(i.url).toBeUndefined();
  });
});
