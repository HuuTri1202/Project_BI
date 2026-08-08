import {
  ADMIN_ERROR_CODES,
  TENANT_ROLE_LABELS,
  type AdminOverviewDto,
  type TenantRole,
} from '@bi/shared';
import { Router } from 'express';
import type { PoolConnection } from 'mysql2/promise';

import { mysqlPool } from '../../config/mysql';
import { withTransaction } from '../../db/tx';
import { authenticate, requireAuth } from '../../middleware/authenticate';
import { rateLimit } from '../../middleware/rateLimit';
import { requireFreshAdmin } from '../../middleware/requireFreshAdmin';
import { requireRole } from '../../middleware/requireRole';
import * as adminMembersRepo from '../../repositories/adminMembers';
import { MEMBER_SORT_KEYS } from '../../repositories/adminMembers';
import * as statsRepo from '../../repositories/adminStats';
import * as adminWorkspacesRepo from '../../repositories/adminWorkspaces';
import * as membershipsRepo from '../../repositories/memberships';
import { createMember } from '../../services/admin/createMember';
import { createWorkspace } from '../../services/admin/createWorkspace';
import { asyncHandler } from '../../utils/asyncHandler';
import { badRequest, HttpError, notFound } from '../../utils/httpError';
import { buildPageResult, resolveSortColumn } from '../../utils/pagination';
import {
  createUserBodySchema,
  createWorkspaceBodySchema,
  listUsersQuerySchema,
  updateRoleBodySchema,
  updateStatusBodySchema,
  updateWorkspaceBodySchema,
  userIdParamSchema,
  workspaceIdParamSchema,
} from './schemas';

/**
 * Khu quản trị của MỘT tổ chức (§3.2 – §3.6).
 *
 * ─── Vì sao `/api/admin` chứ không phải `/api/v1/admin` ──────────────────────
 *
 * `/api/v1` là data plane của sản phẩm BI — docblock của nó liệt kê `/projects`,
 * `/datasets`, `/query`, tức là những endpoint mà công cụ biểu đồ bên ngoài sẽ
 * gọi và cần đánh phiên bản. `/api/auth` là session plane. Khu quản trị tổ chức
 * là anh em với auth, không phải một tài nguyên của API truy vấn.
 *
 * Đánh đổi: không có đoạn version. Thay đổi phá vỡ tương thích sẽ thành
 * `/api/admin/v2` hoặc chuyển xuống dưới `/api/v1/admin`. Chấp nhận được vì
 * frontend và backend trong repo này luôn deploy cùng nhau.
 *
 * ─── Ba lớp bảo vệ, đúng thứ tự này ──────────────────────────────────────────
 *
 *   authenticate      có token hợp lệ không                (401 nếu không)
 *   requireRole       token TỰ XƯNG là admin không          (403) — 0 truy vấn
 *   requireFreshAdmin DATABASE có đồng ý không              (401/403) — 1 truy vấn
 *
 * Lớp giữa là bộ lọc rẻ tiền: token của viewer bị chặn mà không chạm MySQL.
 * Lớp cuối mới là lớp đáng tin, vì claim trong token có thể đã cũ tới 7 ngày.
 * Mount ở đây MỘT LẦN cho cả router, để thêm route mới không thể quên guard.
 */
export const adminRouter = Router();

adminRouter.use(authenticate, requireRole('admin'), requireFreshAdmin);

/** Số ngày của biểu đồ trên trang tổng quan. */
const OVERVIEW_RANGE_DAYS = 30;

/** Thứ tự hiển thị vai trò: quyền cao trước. Không dùng thứ tự của ENUM vì đó
 *  là chi tiết lưu trữ, đổi được mà không ai để ý. */
const TENANT_ROLE_ORDER: readonly TenantRole[] = ['admin', 'creator', 'viewer'];

/**
 * GET /api/admin/overview — §3.2
 *
 * Hai truy vấn, chạy TUẦN TỰ chứ không `Promise.all`: pool chỉ có 10 connection,
 * và tiết kiệm nửa mili-giây bằng cách chiếm gấp đôi connection là đổi chác sai
 * chiều trên chính trang mà mọi admin mở đầu tiên.
 */
adminRouter.get(
  '/overview',
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);

    const counts = await statsRepo.fetchOverviewCounts(mysqlPool, tenantId);
    const newMembersDaily = await statsRepo.fetchNewMembersDaily(
      mysqlPool,
      tenantId,
      OVERVIEW_RANGE_DAYS,
    );

    const { roleCounts, ...cards } = counts;

    const body: AdminOverviewDto = {
      ...cards,
      // Luôn trả đủ ba vai trò theo thứ tự cố định, kể cả khi count = 0: biểu đồ
      // giữ nguyên trục và bảng màu, không nhảy chỗ khi một vai trò từ 0 lên 1.
      roleBreakdown: TENANT_ROLE_ORDER.map((role) => ({
        role,
        label: TENANT_ROLE_LABELS[role],
        count: roleCounts[role],
      })),
      newMembersDaily,
      rangeDays: OVERVIEW_RANGE_DAYS,
    };
    res.json(body);
  }),
);

// ─── §3.3 Danh sách người dùng ───────────────────────────────────────────────

adminRouter.get(
  '/users',
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    const query = listUsersQuerySchema.parse(req.query);

    // `resolveSortColumn` trả null khi giá trị nằm ngoài whitelist. Đây là chốt
    // chặn SQL injection: `ORDER BY` không tham số hoá được bằng dấu `?`, nên
    // chuỗi từ query string tuyệt đối không được đi thẳng vào câu lệnh.
    const sort = resolveSortColumn(query.sort, MEMBER_SORT_KEYS, 'fullName');
    if (sort === null) {
      throw badRequest('Cột sắp xếp không hợp lệ.', {
        sort: `Chỉ nhận: ${MEMBER_SORT_KEYS.join(', ')}`,
      });
    }

    const filter: adminMembersRepo.ListMembersFilter = {
      search: query.q,
      role: query.role,
      status: query.status,
      sort,
      order: query.order,
      page: query.page,
      pageSize: query.pageSize,
    };

    // Đếm trước để biết có cần lấy dữ liệu không: trang 5 của một bộ lọc chỉ ra
    // 3 kết quả thì câu SELECT thứ hai chắc chắn rỗng.
    const total = await adminMembersRepo.countMembers(mysqlPool, tenantId, filter);
    const items =
      total === 0 ? [] : await adminMembersRepo.listMembers(mysqlPool, tenantId, filter);

    res.json(buildPageResult(items, total, query.page, query.pageSize));
  }),
);

// ─── §3.4 Quản lý người dùng ─────────────────────────────────────────────────

/**
 * Chặn tự sửa chính mình.
 *
 * Áp dụng đồng nhất cho đổi vai trò, khoá và gỡ. Không thao tác nào trong ba
 * cái đó từng là chủ ý, và luật "admin cuối cùng" không đỡ được trường hợp tổ
 * chức có hai admin mà một người bấm nhầm vào dòng của chính mình.
 */
function refuseSelf(actorId: number, targetId: number): void {
  if (actorId === targetId) {
    throw new HttpError(
      403,
      ADMIN_ERROR_CODES.CANNOT_MODIFY_SELF,
      'Không thể tự thay đổi vai trò hoặc trạng thái của chính mình.',
    );
  }
}

/**
 * Chặn thao tác làm tổ chức mất sạch quản trị viên.
 *
 * PHẢI gọi bên trong transaction: `countActiveAdminsForUpdate` khoá các dòng
 * admin bằng `FOR UPDATE`, buộc request thứ hai xếp hàng. Đọc trên pool thì hai
 * admin hạ quyền nhau cùng lúc đều thấy "còn 2" và đều thành công.
 */
async function refuseLastAdmin(
  conn: PoolConnection,
  tenantId: number,
  currentRole: TenantRole,
): Promise<void> {
  if (currentRole !== 'admin') return;

  const remaining = await membershipsRepo.countActiveAdminsForUpdate(conn, tenantId);
  if (remaining < 2) {
    throw new HttpError(
      409,
      ADMIN_ERROR_CODES.LAST_ADMIN,
      'Đây là quản trị viên cuối cùng của tổ chức. Hãy chỉ định người khác trước.',
    );
  }
}

adminRouter.post(
  '/users',
  rateLimit({ bucket: 'admin-invite', max: 20, windowSeconds: 600 }),
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    const body = createUserBodySchema.parse(req.body);

    const result = await createMember({ tenantId, ...body });
    res.status(201).json(result);
  }),
);

adminRouter.patch(
  '/users/:userId/role',
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const { userId } = userIdParamSchema.parse(req.params);
    const { role } = updateRoleBodySchema.parse(req.body);

    refuseSelf(auth.userId, userId);

    const updated = await withTransaction(async (conn) => {
      const member = await adminMembersRepo.lockMemberForUpdate(conn, auth.tenantId, userId);
      // Không có dòng nào -> 404 chứ KHÔNG phải 403. Id của tổ chức khác cho ra
      // đúng kết quả này, và 404 không xác nhận rằng id đó có tồn tại.
      if (!member || member.removed) throw notFound('Không tìm thấy thành viên này.');
      if (member.role === role) return false;

      await refuseLastAdmin(conn, auth.tenantId, member.role);
      await adminMembersRepo.updateMemberRole(conn, auth.tenantId, userId, role);
      return true;
    });

    if (!updated) {
      res.status(204).end();
      return;
    }
    res.json(await adminMembersRepo.findMember(mysqlPool, auth.tenantId, userId));
  }),
);

adminRouter.patch(
  '/users/:userId/status',
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const { userId } = userIdParamSchema.parse(req.params);
    const { isActive } = updateStatusBodySchema.parse(req.body);

    refuseSelf(auth.userId, userId);

    await withTransaction(async (conn) => {
      const member = await adminMembersRepo.lockMemberForUpdate(conn, auth.tenantId, userId);
      if (!member || member.removed) throw notFound('Không tìm thấy thành viên này.');
      if (member.isActive === isActive) return;

      // Khoá một admin cũng làm tổ chức mất người quản trị, y như hạ quyền.
      if (!isActive) await refuseLastAdmin(conn, auth.tenantId, member.role);

      // Đổi `memberships.is_active`, TUYỆT ĐỐI không đụng `users.is_active`:
      // cột đó là toàn cục, sửa nó là khoá người ta khỏi MỌI tổ chức khác và
      // khỏi cả việc đăng nhập — quyền mà Admin của một tổ chức không được có.
      await adminMembersRepo.updateMemberActive(conn, auth.tenantId, userId, isActive);
    });

    res.json(await adminMembersRepo.findMember(mysqlPool, auth.tenantId, userId));
  }),
);

adminRouter.delete(
  '/users/:userId',
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const { userId } = userIdParamSchema.parse(req.params);

    refuseSelf(auth.userId, userId);

    await withTransaction(async (conn) => {
      const member = await adminMembersRepo.lockMemberForUpdate(conn, auth.tenantId, userId);
      if (!member || member.removed) throw notFound('Không tìm thấy thành viên này.');

      await refuseLastAdmin(conn, auth.tenantId, member.role);
      // Chỉ gỡ khỏi TỔ CHỨC. Bản ghi `users` giữ nguyên: email là định danh toàn
      // cục, người này có thể đang làm ở tổ chức khác.
      await adminMembersRepo.removeMember(conn, auth.tenantId, userId);
    });

    res.status(204).end();
  }),
);

// ─── §3.5 Workspace ──────────────────────────────────────────────────────────

adminRouter.get(
  '/workspaces',
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    res.json(await adminWorkspacesRepo.listWithProjectCount(mysqlPool, tenantId));
  }),
);

adminRouter.post(
  '/workspaces',
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const body = createWorkspaceBodySchema.parse(req.body);

    const created = await createWorkspace({
      tenantId: auth.tenantId,
      name: body.name,
      description: body.description,
      createdBy: auth.userId,
    });
    res.status(201).json(created);
  }),
);

adminRouter.patch(
  '/workspaces/:id',
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    const { id } = workspaceIdParamSchema.parse(req.params);
    const body = updateWorkspaceBodySchema.parse(req.body);

    const affected = await adminWorkspacesRepo.renameWorkspace(mysqlPool, tenantId, id, {
      name: body.name,
      description: body.description ?? null,
    });
    if (affected === 0) throw notFound('Không tìm thấy workspace này.');

    res.json(await adminWorkspacesRepo.findOne(mysqlPool, tenantId, id));
  }),
);

adminRouter.delete(
  '/workspaces/:id',
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    const { id } = workspaceIdParamSchema.parse(req.params);

    await withTransaction(async (conn) => {
      const live = await adminWorkspacesRepo.countLiveProjects(conn, tenantId, id);
      if (live > 0) {
        // CHẶN thay vì xoá lan sang project. Xoá mềm dây chuyền qua một bảng
        // chưa có repository, chưa có test và không có nút hoàn tác là cách
        // nhanh nhất làm mất dashboard của người khác. Báo số lượng để Admin
        // biết mình đang định xoá cái gì.
        throw new HttpError(
          409,
          ADMIN_ERROR_CODES.WORKSPACE_NOT_EMPTY,
          `Workspace còn ${live} project đang hoạt động. Hãy chuyển hoặc xoá chúng trước.`,
        );
      }

      const affected = await adminWorkspacesRepo.softDeleteWorkspace(conn, tenantId, id);
      if (affected === 0) throw notFound('Không tìm thấy workspace này.');
    });

    res.status(204).end();
  }),
);
