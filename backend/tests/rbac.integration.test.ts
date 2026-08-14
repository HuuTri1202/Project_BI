import {
  ACTIONS,
  DEFAULT_POLICY,
  RESOURCES,
  matrixForRole,
  type Action,
  type Resource,
  type TenantRole,
} from '@bi/shared';
import type { RowDataPacket } from 'mysql2';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
import { enforce, permissionMatrixFor, resetEnforcer } from '../src/authz/enforcer';
import { closeMysql, mysqlPool } from '../src/config/mysql';
import { closeRedis } from '../src/config/redis';
import { resetDatabase } from './helpers/db';
import { bearer, makeMembership, makeTenant, makeUser, signTokenFor } from './helpers/fixtures';

/**
 * Test phân quyền RBAC bằng Casbin — §6.
 *
 * ─── Vì sao bộ này tồn tại tách khỏi `tenant.integration.test.ts` ───────────
 *
 * Bộ kia kiểm HÀNH VI của từng endpoint. Bộ này kiểm chính CƠ CHẾ quyết định:
 * model có khớp policy không, policy trong database có khớp bảng nguồn không,
 * và ma trận trả cho frontend có đúng bằng thứ backend dùng để chặn không.
 *
 * Ba câu hỏi đó không lộ ra qua bất kỳ một endpoint đơn lẻ nào, nhưng sai một
 * cái là sai toàn hệ thống.
 *
 * `resetDatabase` TRUNCATE các bảng nghiệp vụ nhưng KHÔNG đụng `casbin_rule` —
 * policy do migration gieo và phải sống qua mọi ca test, đúng như trên máy thật.
 */

const app = createApp();

interface Fixture {
  tenantA: number;
  tenantB: number;
  alice: number;
  bob: number;
  dave: number;
  tokenAlice: string;
  tokenBob: string;
  tokenDave: string;
}

let f: Fixture;

beforeEach(async () => {
  await resetDatabase();
  // Enforcer giữ policy trong bộ nhớ. Dựng lại để mỗi ca đọc đúng bảng hiện tại
  // — cần thiết cho ca "sửa policy lúc chạy" ở cuối file.
  resetEnforcer();

  const tenantA = await makeTenant('Công ty Alpha', 'cong-ty-alpha');
  const tenantB = await makeTenant('Công ty Beta', 'cong-ty-beta');

  const alice = await makeUser('alice@alpha.test', 'Nguyễn Thị An');
  const bob = await makeUser('bob@alpha.test', 'Trần Văn Bình');
  const dave = await makeUser('dave@alpha.test', 'Phạm Văn Dũng');

  await makeMembership(alice, tenantA, 'admin');
  await makeMembership(bob, tenantA, 'creator');
  await makeMembership(dave, tenantA, 'viewer');

  f = {
    tenantA,
    tenantB,
    alice,
    bob,
    dave,
    tokenAlice: signTokenFor(alice, tenantA, 'admin'),
    tokenBob: signTokenFor(bob, tenantA, 'creator'),
    tokenDave: signTokenFor(dave, tenantA, 'viewer'),
  };
});

afterAll(async () => {
  await closeMysql();
  await closeRedis();
});

// ─────────────────────────────────────────────────────────────────────────────

describe('§6.3 policy trong database khớp bảng nguồn', () => {
  /**
   * Migration 4 gieo policy bằng SQL viết tay, còn `DEFAULT_POLICY` trong
   * `@bi/shared` là cùng ma trận đó viết bằng TypeScript. Hai bản chép tay của
   * một sự thật — nên phải có thứ bắt được lúc chúng lệch nhau.
   *
   * Bản SQL là bản THẬT (nó nằm trong database). Bản TypeScript chỉ dùng làm giá
   * trị tạm cho giao diện. Ca này khẳng định chúng nói cùng một điều.
   */
  const ROLES: TenantRole[] = ['admin', 'creator', 'viewer'];

  it.each(ROLES)('vai trò %s: Casbin và DEFAULT_POLICY cho cùng ma trận', async (role) => {
    const fromCasbin = await permissionMatrixFor(role, f.tenantA);
    const fromSource = matrixForRole(role);

    for (const resource of RESOURCES) {
      expect(
        [...fromCasbin[resource]].sort(),
        `tài nguyên "${resource}" của vai trò "${role}"`,
      ).toEqual([...fromSource[resource]].sort());
    }
  });

  it('bảng casbin_rule có đúng số dòng p mà migration gieo', async () => {
    const [rows] = await mysqlPool.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS total FROM casbin_rule WHERE ptype = 'p'",
    );
    // 1 dòng admin (*,*) + 13 dòng creator + 7 dòng viewer = 21.
    // Số này khớp `DEFAULT_POLICY` vì hai bên là hai bản chép tay của cùng một
    // ma trận; lệch nhau nghĩa là ai đó sửa một bên mà quên bên kia.
    expect(Number(rows[0]?.['total'])).toBe(DEFAULT_POLICY.length);
  });
});

describe('§6.2 model — dấu sao và phạm vi tổ chức', () => {
  it('admin có mọi hành động trên mọi tài nguyên nhờ một dòng (*, *)', async () => {
    for (const resource of RESOURCES) {
      for (const action of ACTIONS) {
        expect(
          await enforce('admin', f.tenantA, resource, action),
          `admin phải được ${action} ${resource}`,
        ).toBe(true);
      }
    }
  });

  it('policy có domain "*" áp cho MỌI tổ chức', async () => {
    // Cùng một câu hỏi, hai tổ chức khác nhau, cùng kết quả. Đây là điều khiến
    // ta không phải gieo lại 21 dòng cho từng công ty mới đăng ký.
    expect(await enforce('creator', f.tenantA, 'report', 'modify')).toBe(true);
    expect(await enforce('creator', f.tenantB, 'report', 'modify')).toBe(true);
  });

  it('viewer chỉ có read, không có gì khác', async () => {
    const matrix = await permissionMatrixFor('viewer', f.tenantA);
    for (const resource of RESOURCES) {
      const actions = matrix[resource];
      expect(actions.every((a) => a === 'read'), `viewer không được ${actions.join(',')} ${resource}`).toBe(
        true,
      );
    }
  });

  it('creator sửa được nội dung nhưng không đụng tới cơ cấu tổ chức', async () => {
    expect(await enforce('creator', f.tenantA, 'report', 'modify')).toBe(true);
    expect(await enforce('creator', f.tenantA, 'chart', 'modify')).toBe(true);
    expect(await enforce('creator', f.tenantA, 'dataset', 'modify')).toBe(true);

    expect(await enforce('creator', f.tenantA, 'member', 'invite')).toBe(false);
    expect(await enforce('creator', f.tenantA, 'workspace', 'modify')).toBe(false);
    expect(await enforce('creator', f.tenantA, 'workspace', 'delete')).toBe(false);
  });

  it('tài nguyên hoặc hành động lạ -> từ chối, không nổ', async () => {
    // Mặc định an toàn: chuỗi không khớp dòng nào thì `some(allow)` là false.
    expect(await enforce('admin' as TenantRole, f.tenantA, 'khong-ton-tai' as Resource, 'read')).toBe(
      true, // admin có dòng (*, *) nên vẫn true — đúng ý, xem ghi chú DEFAULT_POLICY
    );
    expect(await enforce('viewer', f.tenantA, 'khong-ton-tai' as Resource, 'read')).toBe(false);
    expect(await enforce('viewer', f.tenantA, 'report', 'pha-huy' as Action)).toBe(false);
  });
});

describe('§6.8 GET /v1/permissions', () => {
  it('trả đúng ma trận của vai trò người gọi', async () => {
    const res = await request(app).get('/api/v1/permissions').set(bearer(f.tokenBob));

    expect(res.status).toBe(200);
    // Creator có `delete` trên `report` và `dataset` từ migration 6 (§7.8):
    // không xoá được thứ mình vừa tạo thì mỗi lần gõ nhầm tên là một bản ghi rác
    // nằm lại vĩnh viễn và phải đi nhờ Admin.
    expect(res.body.report.sort()).toEqual(['delete', 'modify', 'read']);
    expect(res.body.dataset.sort()).toEqual(['delete', 'modify', 'read']);
    // `datamodel` và `chart` cố ý KHÔNG có `delete`: chúng chưa có endpoint nào,
    // và cấp quyền trước khi có thứ để áp dụng là cách policy lệch dần khỏi thực
    // tế mà không ai nhận ra.
    expect(res.body.datamodel.sort()).toEqual(['modify', 'read']);
    expect(res.body.member).toEqual(['read']);
    expect(res.body.workspace).toEqual(['read']);
  });

  it('ba vai trò cho ba ma trận khác nhau', async () => {
    const [admin, creator, viewer] = await Promise.all([
      request(app).get('/api/v1/permissions').set(bearer(f.tokenAlice)),
      request(app).get('/api/v1/permissions').set(bearer(f.tokenBob)),
      request(app).get('/api/v1/permissions').set(bearer(f.tokenDave)),
    ]);

    expect(admin.body.member).toContain('invite');
    expect(creator.body.member).not.toContain('invite');
    expect(viewer.body.report).toEqual(['read']);
  });

  it('không token -> 401', async () => {
    expect((await request(app).get('/api/v1/permissions')).status).toBe(401);
  });

  it('KHÔNG nhận tham số để hỏi quyền của vai trò khác', async () => {
    // Vai trò lấy từ `req.auth`. Nếu endpoint nhận `?role=admin` thì nó thành
    // bản đồ đường đi cho người dò quyền.
    const res = await request(app)
      .get('/api/v1/permissions?role=admin')
      .set(bearer(f.tokenDave));

    expect(res.status).toBe(200);
    expect(res.body.member).toEqual(['read']);
  });
});

describe('§6.4 middleware authorize gác đúng endpoint', () => {
  /**
   * Ma trận ở trên là lý thuyết. Đây là bằng chứng nó THẬT SỰ được thi hành:
   * mỗi dòng là một endpoint có thật, bắn bằng token có thật.
   */
  it('creator tạo được project nhưng không mời được thành viên', async () => {
    const ws = await mysqlPool.query(
      'INSERT INTO workspaces (tenant_id, name, slug) VALUES (?, ?, ?)',
      [f.tenantA, 'Kinh doanh', 'kinh-doanh'],
    );
    const wsId = (ws[0] as { insertId: number }).insertId;

    expect(
      (
        await request(app)
          .post('/api/v1/projects')
          .set(bearer(f.tokenBob))
          .send({ workspaceId: wsId, name: 'Báo cáo doanh thu' })
      ).status,
    ).toBe(201);

    const denied = await request(app)
      .post('/api/v1/members')
      .set(bearer(f.tokenBob))
      .send({ email: 'x@alpha.test', fullName: 'Người Mới', role: 'viewer' });

    expect(denied.status).toBe(403);
    // Thông báo phải nêu đúng thao tác bị chặn, không phải một câu chung chung.
    expect(denied.body.message).toContain('mời người vào thành viên');
  });

  it('viewer bị chặn ở mọi thao tác ghi', async () => {
    const calls: [string, string][] = [
      ['post', '/api/v1/projects'],
      ['post', '/api/v1/workspaces'],
      ['post', '/api/v1/members'],
      ['delete', '/api/v1/members/1'],
    ];

    for (const [method, path] of calls) {
      const res = await request(app)
        [method as 'post' | 'delete'](path)
        .set(bearer(f.tokenDave))
        .send({});
      expect(res.status, `${method} ${path}`).toBe(403);
    }
  });
});

describe('§6.3 sửa policy lúc chạy, không cần deploy', () => {
  /**
   * Đây là điều `requireRole('admin')` viết trong mã nguồn KHÔNG làm được, và là
   * lý do thật sự để dùng Casbin thay vì một câu `if`.
   */
  it('thêm một dòng vào casbin_rule là creator mời được thành viên', async () => {
    expect(await enforce('creator', f.tenantA, 'member', 'invite')).toBe(false);

    await mysqlPool.query(
      "INSERT INTO casbin_rule (ptype, v0, v1, v2, v3) VALUES ('p', 'creator', '*', 'member', 'invite')",
    );
    resetEnforcer();

    try {
      expect(await enforce('creator', f.tenantA, 'member', 'invite')).toBe(true);

      // Và endpoint thật đổi hành vi theo, không phải chỉ hàm `enforce`.
      const res = await request(app)
        .post('/api/v1/members')
        .set(bearer(f.tokenBob))
        .send({ email: 'moi@alpha.test', fullName: 'Người Được Mời', role: 'viewer' });
      expect(res.status).toBe(201);
    } finally {
      // Dọn sạch: bảng này KHÔNG được `resetDatabase` truncate, nên dòng thêm ở
      // đây sẽ rò sang mọi ca chạy sau và làm chúng đỏ theo cách rất khó hiểu.
      await mysqlPool.query(
        "DELETE FROM casbin_rule WHERE ptype='p' AND v0='creator' AND v2='member' AND v3='invite'",
      );
      resetEnforcer();
    }
  });

  it('policy riêng cho MỘT tổ chức đè lên dòng dùng chung', async () => {
    // Cột domain tồn tại để làm được đúng việc này. Công ty B nới quyền cho
    // creator mà không ảnh hưởng công ty A.
    await mysqlPool.query(
      "INSERT INTO casbin_rule (ptype, v0, v1, v2, v3) VALUES ('p', 'creator', ?, 'workspace', 'modify')",
      [String(f.tenantB)],
    );
    resetEnforcer();

    try {
      expect(await enforce('creator', f.tenantB, 'workspace', 'modify')).toBe(true);
      expect(await enforce('creator', f.tenantA, 'workspace', 'modify')).toBe(false);
    } finally {
      await mysqlPool.query("DELETE FROM casbin_rule WHERE ptype='p' AND v1 = ?", [
        String(f.tenantB),
      ]);
      resetEnforcer();
    }
  });
});
