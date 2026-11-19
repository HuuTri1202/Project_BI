import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app';
import { closeMysql, mysqlPool } from '../src/config/mysql';
import { closeRedis } from '../src/config/redis';
import type { Thu } from '../src/services/mail/mailer';
import { chayMotLich } from '../src/services/report/lichGui';
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
 * Gửi báo cáo định kỳ qua email — mong muốn D6.
 *
 * ═══ Bộ này canh gì, và vì sao KHÔNG canh phép tính giờ ════════════════════
 *
 * `lanKeTiep.test.ts` canh phép tính mốc kế tiếp bằng 13 ca thuần, đọc ra thành
 * câu được. Ở đây là bốn thứ chỉ chỗ này mới thấy:
 *
 *   1. LUẬT NGƯỜI NHẬN — chỉ thành viên đang hoạt động của tổ chức. Đây là
 *      quyết định an toàn quan trọng nhất của D6: nhận địa chỉ tuỳ ý là biến hệ
 *      thống thành trạm chuyển thư miễn phí cho bất kỳ ai có tài khoản.
 *   2. QUYỀN — `report:modify`, vì đặt một lịch là một quyết định về báo cáo.
 *   3. Luật chéo của `tanSuat`: "hằng tuần" phải có `thu`.
 *   4. Vòng chạy thật: `chayMotLich` gửi đúng số lá thư, nội dung có SỐ, và
 *      ĐẨY MỐC trước khi gửi (nếu không thì một lần gửi chậm thành một trận thư
 *      trùng).
 */

const hopThu = vi.hoisted(() => ({ thu: [] as Thu[], nem: false }));

vi.mock('../src/services/mail/mailer', () => ({
  guiMail: (thu: Thu): Promise<void> => {
    if (hopThu.nem) return Promise.reject(new Error('SMTP từ chối'));
    hopThu.thu.push(thu);
    return Promise.resolve();
  },
  cheDoMail: () => 'log' as const,
  resetMailer: () => undefined,
}));

const app = createApp();

interface Fixture {
  tenantA: number;
  tokenA: string;
  tokenViewer: string;
  emailAlice: string;
  emailEve: string;
  baoCao: number;
}

let fx: Fixture;

beforeEach(async () => {
  await resetDatabase();
  hopThu.thu = [];
  hopThu.nem = false;

  const emailAlice = 'alice@lich.vn';
  const emailEve = 'eve@lich.vn';
  const alice = await makeUser(emailAlice, 'Alice');
  const eve = await makeUser(emailEve, 'Eve');

  const tenantA = await makeTenant('To chuc Lich', 'to-chuc-lich', alice);
  await makeMembership(alice, tenantA, 'admin');
  await makeMembership(eve, tenantA, 'viewer');
  await capGoiKhongGioiHan(tenantA, alice);

  const wsA = await makeWorkspace(tenantA, 'Chinh', 'chinh-lich');

  const [mh] = await mysqlPool.query<ResultSetHeader>(
    'INSERT INTO datamodels (tenant_id, workspace_id, name) VALUES (?, ?, ?)',
    [tenantA, wsA, 'Mo hinh lich'],
  );
  const canvas = JSON.stringify({
    pages: [
      {
        id: 'p1',
        name: 'Trang 1',
        visuals: [
          {
            id: 'o1',
            chartType: 'bar',
            title: 'Doanh thu theo khu vuc',
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
    [tenantA, wsA, mh.insertId, 'Bao cao tuan', canvas],
  );

  fx = {
    tenantA,
    tokenA: signTokenFor(alice, tenantA, 'admin'),
    tokenViewer: signTokenFor(eve, tenantA, 'viewer'),
    emailAlice,
    emailEve,
    baoCao: bc.insertId,
  };
});

afterAll(async () => {
  await closeMysql();
  await closeRedis();
});

const duong = (): string => `/api/v1/reports/${String(fx.baoCao)}/schedules`;

async function taoLich(body: Record<string, unknown>): Promise<request.Response> {
  return request(app).post(duong()).set(bearer(fx.tokenA)).send(body);
}

describe('người nhận chỉ được là THÀNH VIÊN của tổ chức', () => {
  /**
   * ⚠️ Ca quan trọng nhất của file. Nhận địa chỉ tuỳ ý nghĩa là bất kỳ ai có một
   * tài khoản dùng thử cũng đặt được một lịch "hằng ngày 8 giờ" gửi tới hộp thư
   * bất kỳ — máy chủ SMTP của ta gửi thư thay họ, kèm uy tín tên miền của ta.
   */
  it('địa chỉ ngoài tổ chức -> 400, nói đích danh và chỉ đường đi đúng', async () => {
    const res = await taoLich({
      tanSuat: 'hang-tuan',
      gio: 8,
      thu: 1,
      nguoiNhan: [fx.emailAlice, 'nguoi.la@gmail.com'],
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('RecipientNotMember');
    // Nói ĐÍCH DANH: một câu "có địa chỉ không hợp lệ" làm người dùng thử lại
    // từng dòng một.
    expect(res.body.message).toContain('nguoi.la@gmail.com');
    // Và chỉ đường đi đúng cho người ngoài tổ chức — mong muốn D5.
    expect(res.body.message).toContain('Chia sẻ bằng liên kết');
  });

  it('thành viên đang hoạt động -> tạo được', async () => {
    const res = await taoLich({
      tanSuat: 'hang-tuan',
      gio: 8,
      thu: 1,
      nguoiNhan: [fx.emailAlice, fx.emailEve],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.nguoiNhan).toEqual([fx.emailAlice, fx.emailEve]);
  });

  it('thành viên đã bị gỡ -> không còn gửi được cho họ', async () => {
    await mysqlPool.query(
      'UPDATE memberships SET removed_at = CURRENT_TIMESTAMP(3) WHERE tenant_id = ? AND role = ?',
      [fx.tenantA, 'viewer'],
    );

    const res = await taoLich({
      tanSuat: 'hang-ngay',
      gio: 8,
      nguoiNhan: [fx.emailEve],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('RecipientNotMember');
  });
});

describe('quyền và luật chéo', () => {
  it('viewer KHÔNG đặt được lịch', async () => {
    const res = await request(app)
      .post(duong())
      .set(bearer(fx.tokenViewer))
      .send({ tanSuat: 'hang-ngay', gio: 8, nguoiNhan: [fx.emailEve] });
    expect(res.status).toBe(403);
  });

  it('hằng tuần mà KHÔNG chọn thứ -> 400, không im lặng rơi về thứ Hai', async () => {
    // Im lặng rơi về Thứ Hai là người dùng chọn Thứ Sáu rồi nhận thư thứ Hai mà
    // không hiểu vì sao.
    const res = await taoLich({ tanSuat: 'hang-tuan', gio: 8, nguoiNhan: [fx.emailAlice] });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('Hãy chọn thứ');
  });

  it('hằng tháng mà KHÔNG chọn ngày -> 400', async () => {
    const res = await taoLich({ tanSuat: 'hang-thang', gio: 8, nguoiNhan: [fx.emailAlice] });
    expect(res.status).toBe(400);
  });

  it('ngày 31 bị từ chối — trần là 28, xem NGAY_TRONG_THANG_MAX', async () => {
    const res = await taoLich({
      tanSuat: 'hang-thang',
      gio: 8,
      ngay: 31,
      nguoiNhan: [fx.emailAlice],
    });
    expect(res.status).toBe(400);
  });

  it('bật/tắt và xoá được, và id của tổ chức khác thì 404', async () => {
    const tao = await taoLich({ tanSuat: 'hang-ngay', gio: 8, nguoiNhan: [fx.emailAlice] });
    const id = tao.body.id as number;

    await request(app)
      .patch(`${duong()}/${String(id)}`)
      .set(bearer(fx.tokenA))
      .send({ isActive: false })
      .expect(204);

    const sau = await request(app).get(duong()).set(bearer(fx.tokenA)).expect(200);
    expect(sau.body.items[0].isActive).toBe(false);

    await request(app)
      .delete(`${duong()}/${String(id)}`)
      .set(bearer(fx.tokenA))
      .expect(204);
    await request(app)
      .delete(`${duong()}/${String(id)}`)
      .set(bearer(fx.tokenA))
      .expect(404);
  });
});

describe('chayMotLich — một lượt gửi thật', () => {
  async function docLich(id: number): Promise<RowDataPacket> {
    const [rows] = await mysqlPool.query<RowDataPacket[]>(
      'SELECT * FROM report_schedules WHERE id = ?',
      [id],
    );
    return rows[0] as RowDataPacket;
  }

  it('gửi MỘT thư cho MỖI người nhận, và thư mang tên báo cáo', async () => {
    const tao = await taoLich({
      tanSuat: 'hang-ngay',
      gio: 8,
      nguoiNhan: [fx.emailAlice, fx.emailEve],
    });
    const id = tao.body.id as number;

    await chayMotLich({
      id,
      tenantId: fx.tenantA,
      reportId: fx.baoCao,
      createdBy: 1,
      tanSuat: 'hang-ngay',
      gio: 8,
      thu: null,
      ngay: null,
      nguoiNhan: [fx.emailAlice, fx.emailEve],
      isActive: true,
      nextRunAt: new Date(),
      lastSentAt: null,
      lastError: null,
    });

    /*
     * Hai lá, không phải một lá hai người nhận: gộp thì mọi người thấy địa chỉ
     * của nhau — một quyết định của người tạo lịch, không phải của ta — và một
     * địa chỉ hỏng làm cả lá thư bị trả về.
     */
    expect(hopThu.thu).toHaveLength(2);
    expect(hopThu.thu.map((t) => t.to).sort()).toEqual([fx.emailAlice, fx.emailEve].sort());
    expect(hopThu.thu[0]?.subject).toContain('Bao cao tuan');
    // Bản chữ thuần BẮT BUỘC có: nhiều hộp thư doanh nghiệp chặn HTML.
    expect(hopThu.thu[0]?.text).toContain('Bao cao tuan');
    expect(hopThu.thu[0]?.text).toContain('Doanh thu theo khu vuc');
    // Và một đường dẫn để ai muốn xem hình thì mở báo cáo.
    expect(hopThu.thu[0]?.text).toContain('/reports/');
  });

  it('ĐẨY MỐC trước khi gửi, nên một lần gửi chậm không thành trận thư trùng', async () => {
    const tao = await taoLich({ tanSuat: 'hang-ngay', gio: 8, nguoiNhan: [fx.emailAlice] });
    const id = tao.body.id as number;
    const truoc = (await docLich(id))['next_run_at'] as Date;

    // Đặt mốc về quá khứ để lịch "tới hạn".
    await mysqlPool.query('UPDATE report_schedules SET next_run_at = ? WHERE id = ?', [
      new Date(Date.now() - 60_000),
      id,
    ]);

    await chayMotLich({
      id,
      tenantId: fx.tenantA,
      reportId: fx.baoCao,
      createdBy: 1,
      tanSuat: 'hang-ngay',
      gio: 8,
      thu: null,
      ngay: null,
      nguoiNhan: [fx.emailAlice],
      isActive: true,
      nextRunAt: new Date(Date.now() - 60_000),
      lastSentAt: null,
      lastError: null,
    });

    const sau = await docLich(id);
    const moc = sau['next_run_at'] as Date;
    expect(moc.getTime(), 'mốc kế tiếp phải ở TƯƠNG LAI').toBeGreaterThan(Date.now());
    expect(moc.getTime()).toBe(truoc.getTime());
    expect(sau['last_sent_at']).not.toBeNull();
    expect(sau['last_error']).toBeNull();
  });

  it('SMTP hỏng -> ghi lý do vào last_error, không ném ra ngoài vòng lặp', async () => {
    // Một nhịp hỏng không được làm chết vòng lặp, và người dùng cần đọc được
    // vì sao họ không nhận thư.
    hopThu.nem = true;
    const tao = await taoLich({ tanSuat: 'hang-ngay', gio: 8, nguoiNhan: [fx.emailAlice] });
    const id = tao.body.id as number;

    await chayMotLich({
      id,
      tenantId: fx.tenantA,
      reportId: fx.baoCao,
      createdBy: 1,
      tanSuat: 'hang-ngay',
      gio: 8,
      thu: null,
      ngay: null,
      nguoiNhan: [fx.emailAlice],
      isActive: true,
      nextRunAt: new Date(),
      lastSentAt: null,
      lastError: null,
    });

    const sau = await docLich(id);
    expect(String(sau['last_error'])).toContain('SMTP từ chối');
    expect(String(sau['last_error'])).toContain(fx.emailAlice);
  });
});
