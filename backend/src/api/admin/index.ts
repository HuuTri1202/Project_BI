import {
  PLATFORM_ERROR_CODES,
  type PlatformRole,
  type PlatformOverviewDto,
  type PlatformTenantDetailDto,
} from '@bi/shared';
import { Router } from 'express';

import { mysqlPool } from '../../config/mysql';
import { withTransaction } from '../../db/tx';
import { authenticate, requireAuth } from '../../middleware/authenticate';
import { requireFreshAdmin } from '../../middleware/requireFreshAdmin';
import { requirePlatformRole } from '../../middleware/requireRole';
import * as platformRepo from '../../repositories/platform';
import { asyncHandler } from '../../utils/asyncHandler';
import { badRequest, HttpError, notFound } from '../../utils/httpError';
import { buildPageResult, resolveSortColumn } from '../../utils/pagination';
import {
  idParamSchema,
  listTenantsQuerySchema,
  listUsersQuerySchema,
  listWorkspacesQuerySchema,
  setActiveBodySchema,
} from './schemas';

/**
 * CONSOLE HỆ THỐNG — chỉ dành cho `superadmin`.
 *
 * Đây là công cụ vận hành nền tảng: nhìn thấy TẤT CẢ tổ chức, tất cả người dùng,
 * tất cả workspace. Khác hẳn khu quản trị của một tổ chức (mà hiện chưa xây) —
 * nơi một admin công ty chỉ thấy người của công ty mình.
 *
 * ─── Ba lớp bảo vệ, đúng thứ tự này ──────────────────────────────────────────
 *
 *   authenticate        có token hợp lệ không                 (401 nếu không)
 *   requirePlatformRole token TỰ XƯNG là superadmin không      (403) — 0 truy vấn
 *   requireFreshAdmin   DATABASE có đồng ý không               (401/403) — 1 truy vấn
 *
 * Lớp giữa là bộ lọc rẻ tiền: token người thường bị chặn mà không chạm MySQL.
 * Lớp cuối mới là lớp đáng tin, vì claim trong token có thể đã cũ tới 7 ngày.
 * Mount MỘT LẦN cho cả router, để thêm route mới không thể quên guard.
 *
 * Gác bằng trục NỀN TẢNG (`users.role`), KHÔNG phải `memberships.role`: luồng
 * đăng ký cấp `admin` cho người tự lập tổ chức của mình, nên gác bằng trục tổ
 * chức nghĩa là ai đăng ký cũng vào được console vận hành.
 */
export const adminRouter = Router();

adminRouter.use(authenticate, requirePlatformRole('superadmin'), requireFreshAdmin);

const GROWTH_RANGE_DAYS = 30;

// ─── Tổng quan hệ thống ──────────────────────────────────────────────────────

adminRouter.get(
  '/overview',
  asyncHandler(async (_req, res) => {
    // Tuần tự chứ không `Promise.all`: pool chỉ có 10 connection, và tiết kiệm
    // nửa mili-giây bằng cách chiếm gấp đôi connection là đổi chác sai chiều
    // trên chính trang mà mọi superadmin mở đầu tiên.
    const counts = await platformRepo.fetchOverviewCounts(mysqlPool);
    const growth = await platformRepo.fetchGrowth(mysqlPool, GROWTH_RANGE_DAYS);

    const body: PlatformOverviewDto = { ...counts, growth, rangeDays: GROWTH_RANGE_DAYS };
    res.json(body);
  }),
);

// ─── Quản lý Tenant ──────────────────────────────────────────────────────────

adminRouter.get(
  '/tenants',
  asyncHandler(async (req, res) => {
    const query = listTenantsQuerySchema.parse(req.query);

    const sort = resolveSortColumn(query.sort, platformRepo.TENANT_SORT_KEYS, 'createdAt');
    if (sort === null) {
      throw badRequest('Cột sắp xếp không hợp lệ.', {
        sort: `Chỉ nhận: ${platformRepo.TENANT_SORT_KEYS.join(', ')}`,
      });
    }

    const filter: platformRepo.TenantFilter = {
      search: query.q,
      status: query.status,
      sort,
      order: query.order,
      page: query.page,
      pageSize: query.pageSize,
    };

    const total = await platformRepo.countTenants(mysqlPool, filter);
    const items = total === 0 ? [] : await platformRepo.listTenants(mysqlPool, filter);
    res.json(buildPageResult(items, total, query.page, query.pageSize));
  }),
);

adminRouter.get(
  '/tenants/:id',
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);

    const tenant = await platformRepo.findTenant(mysqlPool, id);
    if (!tenant) throw notFound('Không tìm thấy tổ chức này.');

    const body: PlatformTenantDetailDto = {
      tenant,
      members: await platformRepo.listTenantMembers(mysqlPool, id),
      workspaces: await platformRepo.listWorkspacesOfTenant(mysqlPool, id),
    };
    res.json(body);
  }),
);

adminRouter.patch(
  '/tenants/:id/status',
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);
    const { isActive } = setActiveBodySchema.parse(req.body);

    // Khoá chính tổ chức mình đang mở là tự cắt đường về: mọi truy vấn
    // membership đều lọc `t.is_active = 1`, nên request kế tiếp sẽ nhận 401 và
    // không ai mở khoá lại được từ giao diện.
    if (!isActive && id === auth.tenantId) {
      throw new HttpError(
        403,
        PLATFORM_ERROR_CODES.CANNOT_MODIFY_SELF,
        'Không thể khoá chính tổ chức bạn đang đăng nhập.',
      );
    }

    const affected = await platformRepo.setTenantActive(mysqlPool, id, isActive);
    if (affected === 0) throw notFound('Không tìm thấy tổ chức này.');

    res.json(await platformRepo.findTenant(mysqlPool, id));
  }),
);

adminRouter.delete(
  '/tenants/:id',
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);

    if (id === auth.tenantId) {
      throw new HttpError(
        403,
        PLATFORM_ERROR_CODES.CANNOT_MODIFY_SELF,
        'Không thể xoá chính tổ chức bạn đang đăng nhập.',
      );
    }

    await withTransaction(async (conn) => {
      const live = await platformRepo.countLiveWorkspacesOfTenant(conn, id);
      if (live > 0) {
        // CHẶN thay vì xoá lan sang workspace và project bên dưới. Xoá mềm dây
        // chuyền qua hai tầng, không có nút hoàn tác, là cách nhanh nhất làm mất
        // dữ liệu của cả một công ty. Báo số lượng để superadmin biết mình đang
        // định xoá cái gì.
        throw new HttpError(
          409,
          PLATFORM_ERROR_CODES.TENANT_NOT_EMPTY,
          `Tổ chức còn ${live} workspace. Hãy xoá chúng trước.`,
        );
      }

      const affected = await platformRepo.softDeleteTenant(conn, id);
      if (affected === 0) throw notFound('Không tìm thấy tổ chức này.');
    });

    res.status(204).end();
  }),
);

// ─── Quản lý User toàn hệ thống ──────────────────────────────────────────────

adminRouter.get(
  '/users',
  asyncHandler(async (req, res) => {
    const query = listUsersQuerySchema.parse(req.query);

    const sort = resolveSortColumn(query.sort, platformRepo.USER_SORT_KEYS, 'createdAt');
    if (sort === null) {
      throw badRequest('Cột sắp xếp không hợp lệ.', {
        sort: `Chỉ nhận: ${platformRepo.USER_SORT_KEYS.join(', ')}`,
      });
    }

    const filter: platformRepo.UserFilter = {
      search: query.q,
      tenantId: query.tenantId,
      status: query.status,
      platformRole: query.platformRole,
      sort,
      order: query.order,
      page: query.page,
      pageSize: query.pageSize,
    };

    const total = await platformRepo.countUsers(mysqlPool, filter);
    const items = total === 0 ? [] : await platformRepo.listUsers(mysqlPool, filter);
    res.json(buildPageResult(items, total, query.page, query.pageSize));
  }),
);

/**
 * Chặn thao tác lên chính mình.
 *
 * Không thao tác nào trong số này từng là chủ ý, và tự khoá tài khoản superadmin
 * đang dùng là tự nhốt mình ra ngoài — không còn đường nào mở lại từ giao diện.
 */
function refuseSelf(actorId: number, targetId: number): void {
  if (actorId === targetId) {
    throw new HttpError(
      403,
      PLATFORM_ERROR_CODES.CANNOT_MODIFY_SELF,
      'Không thể khoá hoặc xoá chính tài khoản đang đăng nhập.',
    );
  }
}

/**
 * Chặn thao tác làm hệ thống mất sạch quản trị viên.
 *
 * PHẢI gọi trong transaction: `countActiveSuperadmins` khoá các dòng bằng
 * `FOR UPDATE`, buộc request thứ hai xếp hàng. Đọc trên pool thì hai người khoá
 * nhau cùng lúc đều thấy "còn 2" và đều thành công.
 *
 * Câu hỏi đúng là "SAU thao tác này còn ai không", chứ không phải "bây giờ còn
 * mấy người". Hai câu đó chỉ trùng nhau khi mục tiêu đang hoạt động. Xoá một
 * superadmin ĐÃ BỊ KHOÁ không làm giảm số người còn hoạt động, nên đếm gộp nó
 * vào sẽ chặn luôn thao tác dọn dẹp hoàn toàn hợp lệ — và chặn đúng lúc chỉ còn
 * một người, tức là đúng lúc người ta cần dọn nhất.
 */
async function refuseLastSuperadmin(
  conn: Parameters<Parameters<typeof withTransaction>[0]>[0],
  target: { platformRole: PlatformRole; isActive: boolean },
): Promise<void> {
  if (target.platformRole !== 'superadmin') return;

  const active = await platformRepo.countActiveSuperadmins(conn);
  const remainingAfter = active - (target.isActive ? 1 : 0);
  if (remainingAfter < 1) {
    throw new HttpError(
      409,
      PLATFORM_ERROR_CODES.LAST_SUPERADMIN,
      'Đây là quản trị viên hệ thống cuối cùng. Hãy chỉ định người khác trước.',
    );
  }
}

adminRouter.patch(
  '/users/:id/status',
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);
    const { isActive } = setActiveBodySchema.parse(req.body);

    refuseSelf(auth.userId, id);

    await withTransaction(async (conn) => {
      const target = await platformRepo.findUserForUpdate(conn, id);
      if (!target) throw notFound('Không tìm thấy người dùng này.');
      if (!isActive) await refuseLastSuperadmin(conn, target);

      // Đổi `users.is_active` — phạm vi TOÀN HỆ THỐNG. Người này sẽ không đăng
      // nhập được vào bất kỳ tổ chức nào.
      await platformRepo.setUserActive(conn, id, isActive);
    });

    res.json({ id, isActive });
  }),
);

adminRouter.delete(
  '/users/:id',
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);

    refuseSelf(auth.userId, id);

    await withTransaction(async (conn) => {
      const target = await platformRepo.findUserForUpdate(conn, id);
      if (!target) throw notFound('Không tìm thấy người dùng này.');
      await refuseLastSuperadmin(conn, target);

      await platformRepo.softDeleteUser(conn, id);
    });

    res.status(204).end();
  }),
);

// ─── Quản lý Workspace toàn hệ thống ─────────────────────────────────────────

adminRouter.get(
  '/workspaces',
  asyncHandler(async (req, res) => {
    const query = listWorkspacesQuerySchema.parse(req.query);

    const filter: platformRepo.WorkspaceFilter = {
      search: query.q,
      tenantId: query.tenantId,
      status: query.status,
      page: query.page,
      pageSize: query.pageSize,
    };

    const total = await platformRepo.countWorkspaces(mysqlPool, filter);
    const items = total === 0 ? [] : await platformRepo.listWorkspaces(mysqlPool, filter);
    res.json(buildPageResult(items, total, query.page, query.pageSize));
  }),
);

adminRouter.patch(
  '/workspaces/:id/status',
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const { isActive } = setActiveBodySchema.parse(req.body);

    const affected = await platformRepo.setWorkspaceActive(mysqlPool, id, isActive);
    if (affected === 0) throw notFound('Không tìm thấy workspace này.');

    res.json({ id, isActive });
  }),
);

adminRouter.delete(
  '/workspaces/:id',
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);

    const affected = await platformRepo.softDeleteWorkspace(mysqlPool, id);
    if (affected === 0) throw notFound('Không tìm thấy workspace này.');

    res.status(204).end();
  }),
);
