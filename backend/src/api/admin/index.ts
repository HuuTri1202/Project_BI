import {
  PLATFORM_ERROR_CODES,
  type PlatformRole,
  type PlatformOverviewDto,
  type PlatformTenantDetailDto,
} from '@bi/shared';
import { Router } from 'express';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';

import { getEnforcer, resetEnforcer } from '../../authz/enforcer';
import { mysqlPool } from '../../config/mysql';
import { withTransaction } from '../../db/tx';
import { authenticate, requireAuth } from '../../middleware/authenticate';
import { requireFreshAdmin } from '../../middleware/requireFreshAdmin';
import { requirePlatformRole } from '../../middleware/requireRole';
import * as billingRepo from '../../repositories/billing';
import * as platformRepo from '../../repositories/platform';
import { AUDIT_ACTIONS, actorEmailOf, actorFrom, writeAudit } from '../../services/audit/log';
import { confirmPayment } from '../../services/billing/confirmPayment';
import { isOrderCode } from '../../services/billing/orderCode';
import { tinhChuKy } from '../../services/billing/period';
import { buildQrKey, parseQrDataUrl } from '../../services/billing/qrImage';
import { seal } from '../../services/connections/secretBox';
import { storage } from '../../storage';
import { asyncHandler } from '../../utils/asyncHandler';
import { badRequest, HttpError, notFound } from '../../utils/httpError';
import { buildPageResult, resolveSortColumn } from '../../utils/pagination';
import {
  confirmOrderBodySchema,
  createPlanBodySchema,
  idParamSchema,
  listAdminOrdersQuerySchema,
  listTenantsQuerySchema,
  listUsersQuerySchema,
  listWorkspacesQuerySchema,
  overrideSubscriptionBodySchema,
  setActiveBodySchema,
  updatePaymentMethodBodySchema,
  updatePlanBodySchema,
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

// ─── Phân quyền (§6.3) ───────────────────────────────────────────────────────

/**
 * Nạp lại ma trận quyền từ bảng `casbin_rule`.
 *
 * ─── Vì sao endpoint này cần tồn tại ────────────────────────────────────────
 *
 * Enforcer giữ policy trong BỘ NHỚ, nạp một lần lúc khởi động (xem
 * `authz/enforcer.ts` để biết vì sao thế là đúng). Hệ quả: sửa `casbin_rule`
 * bằng SQL xong thì tiến trình đang chạy vẫn dùng bản cũ.
 *
 * Không có nút này thì lời hứa "policy nằm trong database nên đổi không cần
 * deploy" chỉ đúng một nửa — vẫn phải restart tiến trình, mà restart production
 * chính là thứ ta muốn tránh.
 *
 * Đặt ở console hệ thống chứ không phải `/api/v1`: policy áp cho MỌI tổ chức,
 * nên chỉ `superadmin` được chạm. Một admin tổ chức nạp lại policy toàn nền
 * tảng là chuyện không có lý do gì để cho phép.
 *
 * ⚠️ Nhiều tiến trình (pm2 cluster, nhiều pod) thì mỗi tiến trình giữ một bản
 * sao riêng, và một lần gọi chỉ nạp lại ĐÚNG tiến trình nhận request. Triển khai
 * nhiều bản phải phát tín hiệu qua Redis pub/sub. Ghi vào nợ kỹ thuật.
 */
adminRouter.post(
  '/authz/reload',
  asyncHandler(async (_req, res) => {
    resetEnforcer();
    // Dựng lại NGAY thay vì để request kế tiếp gánh: nếu bảng đang hỏng, ta muốn
    // biết ở đây, trong phản hồi của chính thao tác vừa gọi.
    const enforcer = await getEnforcer();
    res.json({ rules: (await enforcer.getPolicy()).length });
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
      kind: query.kind,
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
      kind: query.kind,
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

// ─── §11 Gói dịch vụ & thanh toán ────────────────────────────────────────────
//
// Cả khối gác bởi ba lớp đã mount ở đầu router — `authenticate +
// requirePlatformRole('superadmin') + requireFreshAdmin`. KHÔNG đi qua Casbin,
// và đó là đúng: Casbin trả lời "vai trò trong MỘT tổ chức", còn những endpoint
// dưới đây thao tác trên bảng giá và đơn hàng của MỌI tổ chức.
//
// ⚠️ Thêm route ở đây thì phải thêm dòng vào bảng `ROUTES` của
// `admin.integration.test.ts` — bài test đó khẳng định mọi endpoint đều trả 401
// khi không token và 403 với người thường, và nó chạy theo BẢNG chứ không viết
// tay từng ca, nên route quên gắn guard sẽ không tự lộ ra.

/** Bảng giá đầy đủ, KỂ CẢ gói đã ẩn — console phải thấy thứ nó quản. */
adminRouter.get(
  '/billing/plans',
  asyncHandler(async (_req, res) => {
    res.json(await billingRepo.listAllPlans(mysqlPool));
  }),
);

adminRouter.post(
  '/billing/plans',
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const body = createPlanBodySchema.parse(req.body);

    let id: number;
    try {
      id = await billingRepo.insertPlan(mysqlPool, { ...body, description: body.description ?? null });
    } catch (err) {
      // Bắt ở ràng buộc UNIQUE chứ không SELECT kiểm trước: giữa SELECT và
      // INSERT luôn có khe hở cho hai request đồng thời.
      if ((err as { code?: string }).code === 'ER_DUP_ENTRY') {
        throw new HttpError(409, 'DuplicatePlanCode', 'Mã gói này đã được dùng.', {
          code: 'Mã này đã tồn tại',
        });
      }
      throw err;
    }

    await writeAudit(mysqlPool, {
      ...actorFrom(req),
      // `null`: đổi bảng giá ảnh hưởng MỌI tổ chức nên không quy về tổ chức nào.
      tenantId: null,
      actorUserId: auth.userId,
      actorEmail: await actorEmailOf(mysqlPool, auth.userId),
      actorPlatformRole: 'superadmin',
      action: AUDIT_ACTIONS.PLAN_CREATE,
      entityType: 'plan',
      entityId: id,
      after: body,
    });

    res.status(201).json(await billingRepo.findPlanById(mysqlPool, id));
  }),
);

adminRouter.patch(
  '/billing/plans/:id',
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);
    const body = updatePlanBodySchema.parse(req.body);

    /*
     * Chụp trạng thái TRƯỚC để ghi vào nhật ký.
     *
     * Đây là thứ thay cho bảng `plan_price_history` mà đề bài yêu cầu: màn hình
     * "lịch sử giá gói Pro" là một câu query trên `before_json->>'$.priceVnd'`.
     * Một cuốn sổ thay vì hai — hai cuốn ghi cùng một sự kiện sẽ lệch nhau ở
     * đúng chỗ không ai kiểm.
     */
    const before = await billingRepo.findPlanById(mysqlPool, id);
    if (before === null) throw notFound('Không tìm thấy gói dịch vụ này.');

    const affected = await billingRepo.updatePlan(mysqlPool, id, {
      ...body,
      description: body.description ?? null,
    });
    if (affected === 0) throw notFound('Không tìm thấy gói dịch vụ này.');

    await writeAudit(mysqlPool, {
      ...actorFrom(req),
      tenantId: null,
      actorUserId: auth.userId,
      actorEmail: await actorEmailOf(mysqlPool, auth.userId),
      actorPlatformRole: 'superadmin',
      action: AUDIT_ACTIONS.PLAN_UPDATE,
      entityType: 'plan',
      entityId: id,
      before,
      after: body,
    });

    res.json(await billingRepo.findPlanById(mysqlPool, id));
  }),
);

adminRouter.delete(
  '/billing/plans/:id',
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);

    const before = await billingRepo.findPlanById(mysqlPool, id);
    // Xoá MỀM. Xoá cứng không làm được vì `fk_orders_plan` là RESTRICT — cố ý,
    // để ảnh chụp trong đơn cũ vẫn trỏ tới một dòng có thật.
    const affected = await billingRepo.softDeletePlan(mysqlPool, id);
    if (affected === 0) throw notFound('Không tìm thấy gói dịch vụ này.');

    await writeAudit(mysqlPool, {
      ...actorFrom(req),
      tenantId: null,
      actorUserId: auth.userId,
      actorEmail: await actorEmailOf(mysqlPool, auth.userId),
      actorPlatformRole: 'superadmin',
      action: AUDIT_ACTIONS.PLAN_DELETE,
      entityType: 'plan',
      entityId: id,
      before,
    });

    res.status(204).end();
  }),
);

/**
 * Phương thức thanh toán, kèm GỢI Ý bốn ký tự cuối của khoá bí mật.
 *
 * ⚠️ `PaymentMethodDto` không có trường nào chứa bí mật, và không được có. Bốn
 * ký tự cuối đi ra dưới một trường RIÊNG, tính tại đây — đủ để người vận hành
 * nhận ra khoá họ vừa dán, không đủ để dựng lại nó.
 */
adminRouter.get(
  '/billing/payment-methods',
  asyncHandler(async (_req, res) => {
    const methods = await billingRepo.listAllPaymentMethods(mysqlPool);

    // Tuần tự chứ không `Promise.all`: mỗi lần gọi là một truy vấn cộng một lần
    // giải mã AES, và danh sách này có đúng vài dòng. Chiếm bốn connection của
    // pool 10 để tiết kiệm vài mili-giây là đổi chác sai chiều.
    const out = [];
    for (const m of methods) {
      out.push({ ...m, webhookSecretHint: await billingRepo.paymentSecretHint(mysqlPool, m.id) });
    }

    res.json(out);
  }),
);

adminRouter.patch(
  '/billing/payment-methods/:id',
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);
    const body = updatePaymentMethodBodySchema.parse(req.body);

    const before = await billingRepo.findPaymentMethodById(mysqlPool, id);
    if (before === null) throw notFound('Không tìm thấy phương thức thanh toán này.');

    /*
     * Mã hoá bí mật NGAY tại đây, trước khi xuống repository.
     *
     * `seal()` dùng lại nguyên vẹn từ §8 (`services/connections/secretBox.ts`) —
     * AES-256-GCM với tiền tố phiên bản `v1.`. Repository cố ý không biết gì về
     * mã hoá: nó nhận chuỗi đã seal, nên không có đường nào ghi nhầm bản rõ
     * xuống cột đó.
     *
     * Ba trạng thái: vắng mặt = giữ nguyên, `null` = xoá khoá, chuỗi = đặt mới.
     */
    const sealed =
      body.webhookSecret === undefined
        ? undefined
        : body.webhookSecret === null
          ? null
          : seal(body.webhookSecret);

    /*
     * Ảnh QR tĩnh — tải lên MinIO TRƯỚC khi ghi database.
     *
     * Thứ tự đó là chủ ý: ghi trước rồi tải lên mà tải hỏng sẽ để lại một bản
     * ghi trỏ vào một object không tồn tại, và màn hình thanh toán của khách
     * hiện một ô ảnh vỡ. Ngược lại thì cùng lắm là một object mồ côi trong
     * bucket — vô hại, và dọn được.
     *
     * Khoá MỚI mỗi lần, không ghi đè khoá cũ: ảnh đang hiện trên màn hình khách
     * không bị đổi giữa chừng bởi một lần lưu nửa vời.
     */
    let qrKey: string | null | undefined;
    if (body.staticQrImage === null) {
      qrKey = null;
    } else if (body.staticQrImage !== undefined) {
      const parsed = parseQrDataUrl(body.staticQrImage);
      if (!parsed.ok) throw badRequest(parsed.reason, { staticQrImage: parsed.reason });

      qrKey = buildQrKey(parsed.image.ext);
      await storage.putObject(qrKey, parsed.image.bytes, parsed.image.contentType);
    }

    // Khoá cũ, để xoá SAU khi bản ghi đã trỏ sang ảnh mới.
    const khoaCu = qrKey === undefined ? null : await billingRepo.qrObjectKey(mysqlPool, id);

    const affected = await billingRepo.updatePaymentMethod(mysqlPool, id, {
      name: body.name,
      instructions: body.instructions,
      bankBin: body.bankBin,
      bankAccountNo: body.bankAccountNo,
      bankAccountName: body.bankAccountName,
      ...(sealed === undefined ? {} : { webhookSecretSealed: sealed }),
      ...(qrKey === undefined ? {} : { staticQrKey: qrKey }),
      isActive: body.isActive,
      sortOrder: body.sortOrder,
    });
    if (affected === 0) throw badRequest('Không có thay đổi nào để lưu.');

    /*
     * Xoá ảnh cũ SAU khi bản ghi đã trỏ đi chỗ khác, và nuốt lỗi.
     *
     * Một object mồ côi trong bucket là rác vài chục KB. Một lần xoá hỏng làm
     * đổ cả request nghĩa là người vận hành nhận lỗi 500 cho một thao tác đã
     * thành công — họ sẽ bấm lại, và lần này ảnh mới đã lưu rồi.
     */
    if (khoaCu !== null && khoaCu !== qrKey) {
      void storage.deleteObject(khoaCu).catch((err: unknown) => {
        console.warn('[billing] không xoá được ảnh QR cũ:', khoaCu, err);
      });
    }

    await writeAudit(mysqlPool, {
      ...actorFrom(req),
      tenantId: null,
      actorUserId: auth.userId,
      actorEmail: await actorEmailOf(mysqlPool, auth.userId),
      actorPlatformRole: 'superadmin',
      action: AUDIT_ACTIONS.PAYMENT_METHOD_UPDATE,
      entityType: 'payment_method',
      entityId: id,
      before,
      // ⚠️ KHÔNG ghi `webhookSecret` vào nhật ký. Nhật ký là bảng đọc được bởi
      // mọi superadmin và không bao giờ bị xoá — ghi bí mật vào đó là tự huỷ
      // toàn bộ công mã hoá ở trên.
      after: { ...body, webhookSecret: body.webhookSecret === undefined ? undefined : '***' },
    });

    res.json(await billingRepo.findPaymentMethodById(mysqlPool, id));
  }),
);

/** Đơn hàng của MỌI tổ chức. */
adminRouter.get(
  '/billing/orders',
  asyncHandler(async (req, res) => {
    const query = listAdminOrdersQuerySchema.parse(req.query);

    const sort = resolveSortColumn(query.sort, billingRepo.ORDER_SORT_KEYS, 'createdAt');
    if (sort === null) {
      throw badRequest('Cột sắp xếp không hợp lệ.', {
        sort: `Chỉ nhận: ${billingRepo.ORDER_SORT_KEYS.join(', ')}`,
      });
    }

    // Cho hết hạn trước khi đọc, giống mọi đường đọc đơn khác — không thì danh
    // sách của người vận hành hiện "đang chờ" cho những đơn đã chết.
    await billingRepo.expireOverdueOrders(mysqlPool, new Date());

    const filter: billingRepo.AdminOrderFilter = {
      status: query.status,
      tenantId: query.tenantId,
      provider: query.provider,
      search: query.q,
      sort,
      order: query.order,
      page: query.page,
      pageSize: query.pageSize,
    };

    const total = await billingRepo.countAdminOrders(mysqlPool, filter);
    const items = await billingRepo.listAdminOrders(mysqlPool, filter);

    res.json(buildPageResult(items, total, query.page, query.pageSize));
  }),
);

/**
 * Xác nhận đã nhận tiền — §11 mục 3.3.
 *
 * Đi qua CÙNG `confirmPayment` với webhook. Đó là điều kiện để bất biến "một
 * đơn chỉ được trả tiền một lần" có nghĩa: hai đường ghi riêng nghĩa là hai bản
 * kiểm tra, và chúng sẽ lệch nhau ở lần sửa đầu tiên.
 *
 * Trả 200 kèm `alreadyProcessed` thay vì 409 khi đơn đã được ghi nhận: người
 * vận hành bấm hai lần, hoặc bấm sau khi webhook vừa về, là chuyện thường — và
 * kết quả họ muốn (đơn đã thanh toán) đã đạt được.
 */
adminRouter.post(
  '/billing/orders/:code/confirm',
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const code = String(req.params['code'] ?? '');
    if (!isOrderCode(code)) throw badRequest('Mã đơn hàng không đúng định dạng.');

    const body = confirmOrderBodySchema.parse(req.body);

    const result = await confirmPayment({
      orderCode: code,
      amountVnd: body.amountVnd,
      providerTxnRef: body.providerTxnRef,
      source: 'manual',
      // `ck_payment_txn_manual_has_actor` ở database cưỡng chế lần nữa: một xác
      // nhận tay không có người chịu trách nhiệm là thứ không được tồn tại.
      confirmedBy: auth.userId,
      reason: body.reason ?? null,
      actor: {
        ...actorFrom(req),
        actorUserId: auth.userId,
        actorEmail: await actorEmailOf(mysqlPool, auth.userId),
        actorPlatformRole: 'superadmin',
      },
    });

    res.json(result);
  }),
);

/**
 * Gán gói thủ công cho một tổ chức — khách ký hợp đồng riêng.
 *
 * KHÔNG đi qua `confirmPayment`: ở đây không có đơn hàng và không có tiền nào
 * đổi chủ, nên ép nó vào cùng đường sẽ phải bịa ra một đơn giả để thoả khoá
 * ngoại — và một đơn giả trong sổ cái là thứ đối soát doanh thu sẽ đếm nhầm.
 *
 * `ck_subscriptions_override_has_reason` và `ck_subscriptions_purchase_has_order`
 * ở database giữ cho hai loại subscription không lẫn vào nhau.
 */
adminRouter.post(
  '/billing/subscriptions/override',
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const body = overrideSubscriptionBodySchema.parse(req.body);

    const plan = await billingRepo.findPlanById(mysqlPool, body.planId);
    if (plan === null) throw notFound('Không tìm thấy gói dịch vụ này.');

    const result = await withTransaction(async (conn) => {
      const now = new Date();

      const [current] = await conn.query<(RowDataPacket & { id: number; period_end: Date })[]>(
        "SELECT id, period_end FROM subscriptions WHERE tenant_id = ? AND status = 'active' FOR UPDATE",
        [body.tenantId],
      );
      const dangChay = current[0];

      // Đóng dòng cũ TRƯỚC. `uq_subscriptions_one_active` sẽ chặn nếu làm ngược
      // — và đó là điều tốt, nhưng thứ tự đúng thì không cần tới nó.
      if (dangChay !== undefined) {
        await conn.query(
          "UPDATE subscriptions SET status = 'superseded', ended_at = ? WHERE id = ?",
          [now, dangChay.id],
        );
      }

      const chuKy = tinhChuKy({
        now,
        currentPeriodEnd: dangChay?.period_end ?? null,
        durationDays: body.durationDays,
      });

      const [inserted] = await conn.query<ResultSetHeader>(
        `INSERT INTO subscriptions
           (tenant_id, plan_id, order_id, status, source, plan_code, plan_name, price_vnd,
            period_start, period_end, carried_over_days, previous_subscription_id,
            granted_by, reason)
         VALUES (?, ?, NULL, 'active', 'admin_override', ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
        [
          body.tenantId,
          plan.id,
          plan.code,
          plan.name,
          chuKy.periodStart,
          chuKy.periodEnd,
          chuKy.carriedOverDays,
          dangChay?.id ?? null,
          auth.userId,
          body.reason,
        ],
      );

      await writeAudit(conn, {
        ...actorFrom(req),
        // CÓ `tenantId`: hành động của superadmin nhưng ĐỐI TƯỢNG nằm trong một
        // tổ chức cụ thể, và cột này mô tả đối tượng.
        tenantId: body.tenantId,
        actorUserId: auth.userId,
        actorEmail: await actorEmailOf(mysqlPool, auth.userId),
        actorPlatformRole: 'superadmin',
        action: AUDIT_ACTIONS.SUBSCRIPTION_OVERRIDE,
        entityType: 'subscription',
        entityId: inserted.insertId,
        before: dangChay === undefined ? null : { subscriptionId: dangChay.id },
        after: { planCode: plan.code, durationDays: body.durationDays },
        reason: body.reason,
      });

      return inserted.insertId;
    });

    res.status(201).json({ subscriptionId: result });
  }),
);
