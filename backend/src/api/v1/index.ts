import {
  ADMIN_ERROR_CODES,
  DATASET_ERROR_CODES,
  REPORT_ERROR_CODES,
  WORKSPACE_ERROR_CODES,
  type ConnectionPrerequisitesDto,
  type CreateUploadResultDto,
  type DatasetColumnDto,
  type DatasetDetailDto,
  type FileExt,
  type HomeDataDto,
  type PermissionMatrixDto,
  type ReportConfigDto,
  type ReportDataDto,
  type TenantRole,
  type WorkspaceOptionDto,
} from '@bi/shared';
import { Router, type Request, type Response } from 'express';
import type { PoolConnection } from 'mysql2/promise';

import { permissionMatrixFor } from '../../authz/enforcer';
import { env } from '../../config/env';
import { mysqlPool } from '../../config/mysql';
import { withTransaction } from '../../db/tx';
import { authenticate, requireAuth } from '../../middleware/authenticate';
import { rateLimit } from '../../middleware/rateLimit';
import { authorize } from '../../middleware/authorize';
import { requireFreshMembership } from '../../middleware/requireFreshMembership';
import * as adminMembersRepo from '../../repositories/adminMembers';
import * as adminWorkspacesRepo from '../../repositories/adminWorkspaces';
import * as connectionsRepo from '../../repositories/connections';
import * as datasetsRepo from '../../repositories/datasets';
import type { Db } from '../../repositories/db';
import * as membershipsRepo from '../../repositories/memberships';
import * as projectsRepo from '../../repositories/projects';
import * as reportsRepo from '../../repositories/reports';
import * as tenantsRepo from '../../repositories/tenants';
import { createMember } from '../../services/admin/createMember';
import { createWorkspace } from '../../services/admin/createWorkspace';
import { resetMemberPassword } from '../../services/admin/resetMemberPassword';
import {
  createConnection,
  deleteConnection,
  listSourceTables,
  testConnection,
  testSavedConnection,
  updateConnection,
} from '../../services/connections/connectionService';
import { deleteDataset } from '../../services/connections/deleteDataset';
import { DEFAULT_PORTS, DEFAULT_SSL, REQUIRED_GRANTS } from '../../services/connections/drivers';
import { previewDataset } from '../../services/connections/previewDataset';
import { syncDatasets } from '../../services/connections/syncDatasets';
import { aggregate } from '../../services/dataset/aggregate';
import { analyzeDataset, clearAnalyzeCache } from '../../services/dataset/analyze';
import { commitDatasets } from '../../services/dataset/commit';
import {
  buildStorageKey,
  contentTypeOf,
  defaultDatasetName,
  extensionOf,
} from '../../services/dataset/storageKey';
import { storage } from '../../storage';
import { asyncHandler } from '../../utils/asyncHandler';
import { badRequest, HttpError, notFound } from '../../utils/httpError';
import { buildPageResult, resolveSortColumn } from '../../utils/pagination';
import {
  commitDatasetsBodySchema,
  createConnectionBodySchema,
  createMemberBodySchema,
  createProjectBodySchema,
  createReportBodySchema,
  createUploadBodySchema,
  createWorkspaceBodySchema,
  homeQuerySchema,
  idParamSchema,
  listDatasetsQuerySchema,
  listMembersQuerySchema,
  listProjectsQuerySchema,
  listReportsQuerySchema,
  renameDatasetBodySchema,
  setActiveBodySchema,
  syncBodySchema,
  testConnectionBodySchema,
  updateConnectionBodySchema,
  updateProjectBodySchema,
  updateReportBodySchema,
  updateRoleBodySchema,
  updateTenantBodySchema,
  updateWorkspaceBodySchema,
  userIdParamSchema,
} from './schemas';

/**
 * KHU NGƯỜI DÙNG — mọi thứ nằm trong PHẠM VI TỔ CHỨC đang mở.
 *
 * Khác hẳn `/api/admin`: console đó nhìn xuyên mọi tổ chức và chỉ `superadmin`
 * vào được. Ở đây, `superadmin` không có đặc quyền gì cả — muốn làm việc trong
 * một tổ chức thì phải có `membership` thật, đúng như ghi chú trong
 * `middleware/requireRole.ts`.
 *
 * ─── Ba lớp bảo vệ, đúng thứ tự này ──────────────────────────────────────────
 *
 *   authenticate            có token hợp lệ không              (401 nếu không)
 *   requireFreshMembership  DB có đồng ý phiên này còn sống    (401) — 1 truy vấn
 *   authorize(res, act)     vai trò được làm việc này không    (403) — 0 truy vấn
 *
 * Hai lớp đầu mount MỘT LẦN cho cả router, nên thêm route mới không thể quên.
 * Lớp thứ ba gắn cho từng route ghi, vì mỗi route hỏi một câu khác nhau.
 *
 * Thứ tự này bắt buộc: `authorize` đọc `req.auth.role`, mà giá trị đáng tin của
 * trường đó do `requireFreshMembership` ghi đè từ database. Đảo lại là chấm điểm
 * một vai trò có thể đã cũ tới 7 ngày (`JWT_EXPIRES_IN`).
 *
 * Đây mới là thực thi thật của §4.8 và §6.8. Việc ẩn menu ở frontend chỉ là
 * trải nghiệm — nó đọc cùng ma trận này qua `GET /v1/permissions`.
 */
export const v1Router = Router();

v1Router.get('/', (_req: Request, res: Response) => {
  res.json({ name: 'BI Platform API', version: 'v1' });
});

v1Router.use(authenticate, requireFreshMembership);

/*
 * ─── §6.4 Phân quyền bằng Casbin ─────────────────────────────────────────────
 *
 * Từ §6, các route ghi gác bằng `authorize(<tài nguyên>, <hành động>)` thay cho
 * `requireRole(<vai trò>)`. Khác biệt thật sự nằm ở chỗ câu trả lời ở đâu:
 *
 *   requireRole('admin')              luật nằm trong MÃ NGUỒN, đổi phải deploy
 *   authorize('member', 'invite')     luật nằm trong bảng `casbin_rule`
 *
 * `authorize` đọc `req.auth.role` — giá trị đã được `requireFreshMembership`
 * ghi đè từ database ở ngay trên, nên nó chấm điểm vai trò THẬT chứ không phải
 * claim trong token vốn có thể cũ tới 7 ngày.
 *
 * `authorize` KHÔNG kiểm `:id` thuộc tổ chức nào. Việc đó vẫn do
 * `WHERE tenant_id = ?` trong repository lo, và đó mới là thứ chặn đọc chéo tổ
 * chức. Xem ghi chú đầy đủ trong `middleware/authorize.ts`.
 */

// ─── §6.8 Ma trận quyền cho frontend ─────────────────────────────────────────

/**
 * Quyền hiệu lực của chính người gọi, trong tổ chức đang mở.
 *
 * Frontend dùng cái này để ẩn/hiện menu và nút. Trước §6 nó có một bảng chép tay
 * trong `shared/src/permissions.ts` — và bảng chép tay thì sớm muộn cũng lệch
 * khỏi policy thật. Lệch kiểu nào cũng tệ: hiện nút dẫn thẳng tới 403, hoặc
 * giấu mất chức năng người dùng có quyền dùng.
 *
 * KHÔNG nhận tham số nào. Vai trò và tổ chức lấy từ `req.auth` — cho client hỏi
 * "quyền của vai trò X là gì" thì endpoint này thành bản đồ đường đi cho người
 * dò quyền, và chẳng phục vụ nhu cầu thật nào cả.
 */
v1Router.get(
  '/permissions',
  asyncHandler(async (req, res) => {
    const { role, tenantId } = requireAuth(req);
    const body: PermissionMatrixDto = await permissionMatrixFor(role, tenantId);
    res.json(body);
  }),
);

// ─── Chọn workspace ──────────────────────────────────────────────────────────

/**
 * Xác định workspace đang thao tác, có kiểm tra quyền.
 *
 * MỌI endpoint nhận `workspaceId` từ client đều phải đi qua đây. Nhận thẳng id
 * rồi truy vấn là lỗ hổng IDOR: đổi số trên URL là đọc được dữ liệu của tổ chức
 * khác. `findOne` đã lọc `tenant_id` nên id lạ cho ra `null`, và ta trả 404 —
 * 403 sẽ xác nhận rằng id đó có tồn tại.
 *
 * `id` không truyền: chọn workspace ĐANG HOẠT ĐỘNG đầu tiên. Đó là trường hợp
 * người dùng mới đăng nhập trên máy lạ, trình duyệt chưa nhớ gì.
 *
 * `id` truyền nhưng workspace đang bị khoá: từ chối thay vì lặng lẽ chuyển sang
 * cái khác. Người dùng đang chủ động chọn nó; đổi ngầm sẽ khiến họ tưởng mình
 * đang xem workspace này trong khi thật ra là workspace kia.
 */
async function resolveWorkspace(
  db: Db,
  tenantId: number,
  id: number | undefined,
): Promise<WorkspaceOptionDto> {
  if (id !== undefined) {
    const found = await adminWorkspacesRepo.findOne(db, tenantId, id);
    if (!found) throw notFound('Không tìm thấy workspace này.');
    if (!found.isActive) {
      throw new HttpError(
        403,
        WORKSPACE_ERROR_CODES.WORKSPACE_LOCKED,
        'Workspace này đang bị quản trị hệ thống tạm khoá.',
      );
    }
    return { id: found.id, name: found.name, slug: found.slug, isActive: found.isActive };
  }

  const all = await adminWorkspacesRepo.listWithProjectCount(db, tenantId);
  const first = all.find((w) => w.isActive);
  if (!first) {
    // Tổ chức nào cũng được tạo kèm một workspace lúc đăng ký, nên tới đây nghĩa
    // là chúng đã bị xoá hoặc bị khoá hết. Báo bằng mã riêng để giao diện hướng
    // dẫn "tạo workspace mới" chứ không hiện màn hình lỗi chung chung.
    throw new HttpError(
      409,
      WORKSPACE_ERROR_CODES.NO_WORKSPACE,
      'Tổ chức chưa có workspace nào dùng được. Quản trị viên cần tạo một workspace.',
    );
  }
  return { id: first.id, name: first.name, slug: first.slug, isActive: first.isActive };
}

// ─── §4.3 Dữ liệu trang Home ─────────────────────────────────────────────────

const HOME_PROJECT_LIMIT = 12;

v1Router.get(
  '/home',
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    const { workspaceId } = homeQuerySchema.parse(req.query);

    const workspace = await resolveWorkspace(mysqlPool, tenantId, workspaceId);

    // Tuần tự chứ không `Promise.all`: pool chỉ có 10 connection, và chiếm gấp
    // đôi connection để tiết kiệm vài mili-giây trên trang mà MỌI người dùng mở
    // đầu tiên là đổi chác sai chiều.
    const projects = await projectsRepo.listRecent(
      mysqlPool,
      tenantId,
      workspace.id,
      HOME_PROJECT_LIMIT,
    );
    const members = await adminMembersRepo.countMembers(mysqlPool, tenantId, {
      status: 'active',
      sort: 'joinedAt',
      order: 'desc',
      page: 1,
      pageSize: 1,
    });

    const body: HomeDataDto = {
      workspace,
      projects,
      stats: { projects: projects.length, members },
    };
    res.json(body);
  }),
);

// ─── Project ─────────────────────────────────────────────────────────────────

v1Router.get(
  '/projects',
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    const query = listProjectsQuerySchema.parse(req.query);

    const sort = resolveSortColumn(query.sort, projectsRepo.PROJECT_SORT_KEYS, 'updatedAt');
    if (sort === null) {
      throw badRequest('Cột sắp xếp không hợp lệ.', {
        sort: `Chỉ nhận: ${projectsRepo.PROJECT_SORT_KEYS.join(', ')}`,
      });
    }

    // Kiểm quyền trên workspace TRƯỚC khi liệt kê project của nó.
    const workspace = await resolveWorkspace(mysqlPool, tenantId, query.workspaceId);

    res.json(
      await projectsRepo.listByWorkspace(mysqlPool, tenantId, {
        workspaceId: workspace.id,
        search: query.q,
        sort,
        order: query.order,
      }),
    );
  }),
);

v1Router.post(
  '/projects',
  authorize('project', 'modify'),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const body = createProjectBodySchema.parse(req.body);

    const workspace = await resolveWorkspace(mysqlPool, auth.tenantId, body.workspaceId);

    const id = await projectsRepo.createProject(mysqlPool, auth.tenantId, {
      workspaceId: workspace.id,
      name: body.name,
      description: body.description ?? null,
      createdBy: auth.userId,
    });

    res.status(201).json(await projectsRepo.findById(mysqlPool, auth.tenantId, id));
  }),
);

v1Router.patch(
  '/projects/:id',
  authorize('project', 'modify'),
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);
    const body = updateProjectBodySchema.parse(req.body);

    const affected = await projectsRepo.updateProject(mysqlPool, tenantId, id, {
      name: body.name,
      description: body.description ?? null,
    });
    if (affected === 0) throw notFound('Không tìm thấy project này.');

    res.json(await projectsRepo.findById(mysqlPool, tenantId, id));
  }),
);

v1Router.delete(
  '/projects/:id',
  authorize('project', 'delete'),
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);

    const affected = await projectsRepo.softDeleteProject(mysqlPool, tenantId, id);
    if (affected === 0) throw notFound('Không tìm thấy project này.');

    res.status(204).end();
  }),
);

// ─── §7 Bộ dữ liệu ───────────────────────────────────────────────────────────

/**
 * Lấy dataset và khoá lưu trữ của nó, đã kiểm thuộc về tổ chức người gọi.
 *
 * Mọi endpoint nhận `:id` đều phải đi qua đây. `findStorageKey` lọc
 * `tenant_id`, nên id của tổ chức khác cho ra `null` và ta trả 404 — 403 sẽ xác
 * nhận rằng id đó có tồn tại.
 */
async function requireDataset(
  tenantId: number,
  id: number,
): Promise<{ key: string; ext: FileExt }> {
  const found = await datasetsRepo.findStorageKey(mysqlPool, tenantId, id);
  if (!found) throw notFound('Không tìm thấy bộ dữ liệu này.');
  return found;
}

/**
 * §7.4 bước 1–2: cấp presigned URL để trình duyệt PUT thẳng lên S3.
 *
 * Bản ghi `datasets` được tạo NGAY ở đây với `status = 'pending'`, trước khi file
 * lên tới nơi. Lý do: `s3_key` phải tồn tại ở một nơi có thẩm quyền trước khi ta
 * đưa nó cho client, nếu không thì bước `analyze` chỉ còn cách tin vào khoá do
 * client gửi lại — đúng cái lỗ hổng mà việc server tự sinh khoá đang bịt.
 *
 * Cái giá: người dùng đóng wizard giữa chừng để lại một dòng `pending`. Danh sách
 * §7.8 lọc `status = 'ready'` nên họ không thấy rác. Dọn định kỳ những dòng
 * pending quá 24 giờ là việc còn NỢ.
 *
 * Rate limit chặt: mỗi lần gọi sinh ra một bản ghi và một tấm vé ghi vào bucket.
 */
v1Router.post(
  '/datasets/uploads',
  authorize('dataset', 'modify'),
  rateLimit({ bucket: 'dataset-upload', max: 60, windowSeconds: 600 }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const body = createUploadBodySchema.parse(req.body);

    const ext = extensionOf(body.filename);
    if (ext === null) {
      throw new HttpError(
        400,
        DATASET_ERROR_CODES.UNSUPPORTED_FORMAT,
        'Chỉ nhận file .csv hoặc .xlsx.',
      );
    }

    // Từ chối sớm dựa trên số client khai, để người dùng không phải chờ tải xong
    // 200MB rồi mới biết bị từ chối. Con số ĐÁNG TIN là `headObject` ở bước
    // `analyze`; đây chỉ là phép lịch sự.
    if (body.fileSize !== undefined && body.fileSize > env.UPLOAD_MAX_BYTES) {
      throw new HttpError(
        413,
        DATASET_ERROR_CODES.FILE_TOO_LARGE,
        `File vượt quá ${Math.round(env.UPLOAD_MAX_BYTES / 1_048_576)}MB.`,
      );
    }

    const workspace = await resolveWorkspace(mysqlPool, auth.tenantId, body.workspaceId);
    const s3Key = buildStorageKey(auth.tenantId, workspace.id, ext);

    const datasetId = await datasetsRepo.createFileDataset(mysqlPool, auth.tenantId, {
      workspaceId: workspace.id,
      name: defaultDatasetName(body.filename),
      originalFilename: body.filename,
      fileExt: ext,
      s3Key,
      createdBy: auth.userId,
    });

    const presigned = await storage.presignPut(
      s3Key,
      contentTypeOf(ext),
      env.UPLOAD_MAX_BYTES,
    );

    const result: CreateUploadResultDto = {
      datasetId,
      uploadUrl: presigned.url,
      expiresAt: presigned.expiresAt,
    };
    res.status(201).json(result);
  }),
);

/**
 * §7.5: đọc schema của file vừa tải lên. KHÔNG ghi gì.
 *
 * Là POST chứ không phải GET dù chỉ đọc: nó tải một file 50MB từ S3 và parse —
 * một thao tác đắt và có tác dụng phụ (ghi cache Redis). Để GET là mời trình
 * duyệt, proxy và thanh địa chỉ gọi lại nó bất cứ lúc nào.
 */
v1Router.post(
  '/datasets/:id/analyze',
  authorize('dataset', 'modify'),
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);

    const { key, ext } = await requireDataset(tenantId, id);

    try {
      const analyzed = await analyzeDataset(id, key, ext);
      res.json(analyzed.result);
    } catch (err) {
      // Ghi lý do vào bản ghi thay vì để nó biến mất. Người dùng bấm F5 xong sẽ
      // thấy dataset ở trạng thái `failed` kèm lời giải thích, thay vì một dòng
      // `pending` im lặng mà không ai biết đã có chuyện gì.
      if (err instanceof HttpError && err.status < 500) {
        await datasetsRepo.markFailed(mysqlPool, id, err.message);
      }
      throw err;
    }
  }),
);

/**
 * §7.5 → §7.6: chốt sheet và cột đã chọn, nạp dữ liệu vào database.
 */
/**
 * §7.5 → §7.6: chốt các sheet đã tích và nạp dữ liệu.
 *
 * MỖI SHEET thành một bộ dữ liệu riêng, nên phản hồi là một MẢNG. Bản ghi
 * `pending` sinh ra lúc xin presigned URL được dùng lại cho sheet đầu tiên.
 */
v1Router.post(
  '/datasets/:id/commit',
  authorize('dataset', 'modify'),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);
    const body = commitDatasetsBodySchema.parse(req.body);

    const staged = await datasetsRepo.findOne(mysqlPool, auth.tenantId, id);
    // `workspaceId` và `originalFilename` chỉ null với bộ dữ liệu nguồn
    // `connection`; `requireDataset` ngay dưới đây lọc đúng nguồn `file`, nhưng
    // kiểu vẫn cho phép null nên phải chốt ở đây thay vì ép kiểu.
    if (!staged || staged.workspaceId === null || staged.originalFilename === null) {
      throw notFound('Không tìm thấy bộ dữ liệu này.');
    }
    const { key, ext } = await requireDataset(auth.tenantId, id);

    const committed = await commitDatasets({
      datasetId: id,
      tenantId: auth.tenantId,
      workspaceId: staged.workspaceId,
      s3Key: key,
      ext,
      originalFilename: staged.originalFilename,
      createdBy: auth.userId,
      name: body.name,
      sheetNames: body.sheets,
    });

    const details: DatasetDetailDto[] = [];
    for (const item of committed) {
      details.push(await readDatasetDetail(auth.tenantId, item.id));
    }
    res.json(details);
  }),
);

/**
 * Bộ dữ liệu kèm cột.
 *
 * Dùng chung cho CẢ HAI nguồn — đó chính là lợi ích của việc gộp hai khái niệm
 * lại: route đọc chi tiết ở §8.5 và bước 3 của wizard §7 trả về cùng một hình
 * dạng, nên frontend chỉ có một `DatasetDetail` để hiển thị.
 */
async function readDatasetDetail(tenantId: number, id: number): Promise<DatasetDetailDto> {
  const dataset = await datasetsRepo.findOne(mysqlPool, tenantId, id);
  if (!dataset) throw notFound('Không tìm thấy bộ dữ liệu này.');
  return { ...dataset, columns: await datasetsRepo.listColumns(mysqlPool, id) };
}

// ─── §7.6 Báo cáo ────────────────────────────────────────────────────────────

/**
 * Kiểm cấu hình biểu đồ có trỏ vào cột CÓ THẬT không.
 *
 * zod chỉ kiểm được hình dạng — `dimension` là một chuỗi. Nhưng một chuỗi không
 * khớp cột nào sẽ cho ra biểu đồ toàn nhãn "(trống)", tức là một báo cáo trông
 * chạy được mà không có dữ liệu. Bắt ở đây, lúc tạo, thay vì để người dùng tự
 * đoán khi nhìn kết quả.
 */
function validateConfig(columns: readonly DatasetColumnDto[], config: ReportConfigDto): void {
  const names = new Set(columns.map((c) => c.fieldName));

  if (!names.has(config.dimension)) {
    throw badRequest('Cột dùng để nhóm không có trong bộ dữ liệu.', {
      'config.dimension': `Chỉ nhận: ${[...names].join(', ')}`,
    });
  }

  if (config.aggregate !== 'count') {
    if (config.measure === null) {
      throw badRequest('Hãy chọn cột để đo.', {
        'config.measure': 'Bắt buộc khi phép tổng hợp không phải là đếm dòng.',
      });
    }
    if (!names.has(config.measure)) {
      throw badRequest('Cột để đo không có trong bộ dữ liệu.', {
        'config.measure': `Chỉ nhận: ${[...names].join(', ')}`,
      });
    }
  }
}

/**
 * Tạo bản ghi báo cáo RỖNG, gắn với một bộ dữ liệu (§7.6).
 *
 * CỐ Ý không nhận loại biểu đồ hay cấu hình trục, và cố ý không tự suy chúng.
 * Wizard chỉ dựng cái vỏ; biểu đồ là việc người dùng làm trên trang Report.
 *
 * Bản trước của endpoint này tự đoán trục rồi tạo luôn một biểu đồ cột. Nó chạy
 * được, nhưng nó trả lời hộ một câu hỏi chưa ai đặt ra — và một cấu hình đoán
 * bừa trông y hệt một cấu hình người dùng đã chọn, nên không ai biết cái nào là
 * cái nào.
 */
v1Router.post(
  '/reports',
  authorize('report', 'modify'),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const body = createReportBodySchema.parse(req.body);

    const detail = await readDatasetDetail(auth.tenantId, body.datasetId);
    if (detail.status !== 'ready') {
      throw new HttpError(
        409,
        DATASET_ERROR_CODES.DATASET_NOT_READY,
        'Bộ dữ liệu chưa nhập xong nên chưa dựng báo cáo được.',
      );
    }

    // Bộ dữ liệu §8 tạo TRƯỚC khi hai phần được gộp chưa có workspace. Báo cáo
    // thì bắt buộc phải nằm trong một workspace, nên rơi về workspace đang mở của
    // người gọi — thà đặt vào chỗ họ đang đứng còn hơn từ chối tạo báo cáo trên
    // một bộ dữ liệu hoàn toàn hợp lệ.
    const workspaceId =
      detail.workspaceId ?? (await resolveWorkspace(mysqlPool, auth.tenantId, undefined)).id;

    const id = await reportsRepo.createReport(mysqlPool, auth.tenantId, {
      workspaceId,
      datasetId: body.datasetId,
      name: body.name,
      createdBy: auth.userId,
    });

    res.status(201).json(await reportsRepo.findById(mysqlPool, auth.tenantId, id));
  }),
);

v1Router.get(
  '/reports',
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    const query = listReportsQuerySchema.parse(req.query);

    const workspace = await resolveWorkspace(mysqlPool, tenantId, query.workspaceId);

    const filter: reportsRepo.ListReportsFilter = {
      workspaceId: workspace.id,
      search: query.q,
      page: query.page,
      pageSize: query.pageSize,
    };

    const total = await reportsRepo.countReports(mysqlPool, tenantId, filter);
    const items = total === 0 ? [] : await reportsRepo.listReports(mysqlPool, tenantId, filter);
    res.json(buildPageResult(items, total, query.page, query.pageSize));
  }),
);

v1Router.get(
  '/reports/:id',
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);

    const report = await reportsRepo.findById(mysqlPool, tenantId, id);
    if (!report) throw notFound('Không tìm thấy báo cáo này.');
    res.json(report);
  }),
);

/**
 * Dữ liệu ĐÃ TỔNG HỢP cho biểu đồ.
 *
 * Tách khỏi `GET /reports/:id` vì hai thứ có nhịp đổi khác nhau: metadata đọc
 * một lần khi mở trang, còn dữ liệu sẽ cần làm mới khi bộ dữ liệu được nạp lại.
 * Gộp làm một nghĩa là mỗi lần đổi tên báo cáo cũng kéo theo việc tổng hợp lại
 * 50.000 dòng.
 */
v1Router.get(
  '/reports/:id/data',
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);

    const report = await reportsRepo.findById(mysqlPool, tenantId, id);
    if (!report) throw notFound('Không tìm thấy báo cáo này.');

    // Báo cáo vừa được wizard tạo thì chưa có cấu hình — đó là trạng thái BÌNH
    // THƯỜNG, không phải hỏng. 409 kèm mã riêng để giao diện hiện lời mời dựng
    // biểu đồ thay vì màn hình lỗi.
    if (report.config === null) {
      throw new HttpError(
        409,
        REPORT_ERROR_CODES.REPORT_NOT_CONFIGURED,
        'Báo cáo chưa được dựng biểu đồ.',
      );
    }

    const columns = await datasetsRepo.listColumns(mysqlPool, report.datasetId);
    const rows = await datasetsRepo.readRows(mysqlPool, report.datasetId);

    const body: ReportDataDto = aggregate(rows, columns, report.config);
    res.json(body);
  }),
);

v1Router.patch(
  '/reports/:id',
  authorize('report', 'modify'),
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);
    const body = updateReportBodySchema.parse(req.body);

    const existing = await reportsRepo.findById(mysqlPool, tenantId, id);
    if (!existing) throw notFound('Không tìm thấy báo cáo này.');

    const columns = await datasetsRepo.listColumns(mysqlPool, existing.datasetId);
    validateConfig(columns, body.config);

    await reportsRepo.updateReport(mysqlPool, tenantId, id, {
      name: body.name,
      chartType: body.chartType,
      config: body.config,
    });

    res.json(await reportsRepo.findById(mysqlPool, tenantId, id));
  }),
);

v1Router.delete(
  '/reports/:id',
  authorize('report', 'delete'),
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);

    const affected = await reportsRepo.softDeleteReport(mysqlPool, tenantId, id);
    if (affected === 0) throw notFound('Không tìm thấy báo cáo này.');

    res.status(204).end();
  }),
);

// ─── §6.2 Tổ chức ────────────────────────────────────────────────────────────

/**
 * Thông tin tổ chức đang mở — MỌI vai trò đọc được.
 *
 * Tên tổ chức đã có sẵn trong phản hồi đăng nhập, nhưng bản đó là ẢNH CHỤP lúc
 * cấp token. Trang quản lý cần con số hiện tại, và cần nó tự làm mới sau khi đổi
 * tên — nên phải có một endpoint đọc riêng.
 */
v1Router.get(
  '/tenant',
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    const tenant = await tenantsRepo.findTenantById(tenantId);
    // Về lý thuyết không xảy ra: `requireFreshMembership` đã xác nhận tổ chức
    // còn sống ngay trước đó. Vẫn xử lý, vì "không thể xảy ra" mà gặp thì `null`
    // sẽ đi tiếp vào JSON và frontend hỏng ở một chỗ khác hẳn.
    if (!tenant) throw notFound('Không tìm thấy tổ chức này.');
    res.json(tenant);
  }),
);

/**
 * PATCH /api/v1/tenant — đổi tên tổ chức.
 *
 * KHÔNG có `:id` trên đường dẫn, và đó là chủ ý: tổ chức được sửa luôn là tổ
 * chức trong token. Nhận id từ client nghĩa là thêm một nơi phải nhớ kiểm tra
 * "id này có phải của bạn không", trong khi cách này thì câu hỏi đó không tồn
 * tại.
 *
 * `authorize('tenant', 'modify')` — Admin qua được nhờ dòng `(*, *)` trong
 * `casbin_rule`, Creator và Viewer nhận 403. Không cần thêm dòng policy nào.
 */
v1Router.patch(
  '/tenant',
  authorize('tenant', 'modify'),
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    const body = updateTenantBodySchema.parse(req.body);

    const affected = await tenantsRepo.renameTenant(tenantId, body.name);
    if (affected === 0) throw notFound('Không tìm thấy tổ chức này.');

    // Đọc lại rồi trả bản ghi đầy đủ thay vì 204: frontend phải cập nhật tên
    // trên topbar và trong bộ chuyển tổ chức ngay, và đọc lại từ DB là cách duy
    // nhất chắc chắn nó khớp thứ vừa được ghi (tên đã qua chuẩn hoá khoảng
    // trắng ở tầng schema).
    res.json(await tenantsRepo.findTenantById(tenantId));
  }),
);

// ─── §4.5 §4.6 Workspace ─────────────────────────────────────────────────────

/**
 * Danh sách workspace — MỌI vai trò đọc được.
 *
 * Bộ chuyển workspace (§4.6) nằm ở topbar của cả khu người dùng, nên viewer cũng
 * phải gọi được. Chỉ các thao tác GHI bên dưới mới đòi `admin`.
 */
v1Router.get(
  '/workspaces',
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    res.json(await adminWorkspacesRepo.listWithProjectCount(mysqlPool, tenantId));
  }),
);

v1Router.post(
  '/workspaces',
  authorize('workspace', 'modify'),
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

v1Router.patch(
  '/workspaces/:id',
  authorize('workspace', 'modify'),
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);
    const body = updateWorkspaceBodySchema.parse(req.body);

    const affected = await adminWorkspacesRepo.renameWorkspace(mysqlPool, tenantId, id, {
      name: body.name,
      description: body.description ?? null,
    });
    if (affected === 0) throw notFound('Không tìm thấy workspace này.');

    res.json(await adminWorkspacesRepo.findOne(mysqlPool, tenantId, id));
  }),
);

v1Router.delete(
  '/workspaces/:id',
  authorize('workspace', 'delete'),
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);

    await withTransaction(async (conn) => {
      const live = await adminWorkspacesRepo.countLiveProjects(conn, tenantId, id);
      if (live > 0) {
        // CHẶN thay vì xoá lan sang project. Xoá mềm dây chuyền, không có nút
        // hoàn tác, là cách nhanh nhất làm mất dashboard của người khác. Báo số
        // lượng để Admin biết mình đang định xoá cái gì.
        throw new HttpError(
          409,
          ADMIN_ERROR_CODES.WORKSPACE_NOT_EMPTY,
          `Workspace còn ${live} project đang hoạt động. Hãy chuyển hoặc xoá chúng trước.`,
        );
      }

      // Xoá cái cuối cùng là tự khoá cả tổ chức ra khỏi trang Home: `/home` sẽ
      // trả 409 NO_WORKSPACE cho mọi người, kể cả admin. Thoát ra được (màn §4.5
      // vẫn tạo mới được) nhưng đó là một hố mà không ai cố ý rơi vào.
      const total = await adminWorkspacesRepo.countLiveWorkspaces(conn, tenantId);
      if (total <= 1) {
        throw new HttpError(
          409,
          WORKSPACE_ERROR_CODES.LAST_WORKSPACE,
          'Đây là workspace cuối cùng của tổ chức. Hãy tạo một workspace khác trước.',
        );
      }

      const affected = await adminWorkspacesRepo.softDeleteWorkspace(conn, tenantId, id);
      if (affected === 0) throw notFound('Không tìm thấy workspace này.');
    });

    res.status(204).end();
  }),
);

// ─── §4.7 Thành viên ─────────────────────────────────────────────────────────

v1Router.get(
  '/members',
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    const query = listMembersQuerySchema.parse(req.query);

    const sort = resolveSortColumn(query.sort, adminMembersRepo.MEMBER_SORT_KEYS, 'joinedAt');
    if (sort === null) {
      throw badRequest('Cột sắp xếp không hợp lệ.', {
        sort: `Chỉ nhận: ${adminMembersRepo.MEMBER_SORT_KEYS.join(', ')}`,
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

    const total = await adminMembersRepo.countMembers(mysqlPool, tenantId, filter);
    const items = total === 0 ? [] : await adminMembersRepo.listMembers(mysqlPool, tenantId, filter);
    res.json(buildPageResult(items, total, query.page, query.pageSize));
  }),
);

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

v1Router.post(
  '/members',
  authorize('member', 'invite'),
  rateLimit({ bucket: 'tenant-invite', max: 20, windowSeconds: 600 }),
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    const body = createMemberBodySchema.parse(req.body);

    const result = await createMember({ tenantId, ...body });
    res.status(201).json(result);
  }),
);

/**
 * Cấp lại mật khẩu tạm — lối thoát cho "lỡ quên chép mật khẩu".
 *
 * ─── Vì sao gác bằng `invite` chứ không phải `modify` ───────────────────────
 *
 * `member:invite` là quyền đã cho phép TẠO tài khoản và ĐỌC mật khẩu tạm của nó.
 * Cấp lại chỉ là làm lại đúng việc đó, nên nó không mở thêm khả năng nào cho
 * người đã có `invite`.
 *
 * `member:modify` thì khác hẳn: nó là quyền đổi vai trò và khoá thành viên —
 * toàn những thao tác chỉ có tác dụng TRONG tổ chức này. Đặt lại mật khẩu thì
 * không: nó cho phép đăng nhập BẰNG tài khoản người khác. Gán nó vào `modify`
 * nghĩa là một policy kiểu "trưởng nhóm được sắp xếp vai trò" lặng lẽ kèm luôn
 * quyền chiếm tài khoản, mà người viết policy không hề định cho.
 *
 * ⚠️ Hạn chế đã biết: mật khẩu mới KHÔNG huỷ phiên đang mở của người đó. Token
 * ký rồi thì có giá trị tới hết `JWT_EXPIRES_IN` (7 ngày), và hệ thống chưa có
 * bảng thu hồi token. Nếu cần đá họ ra ngay thì khoá thành viên
 * (`PATCH /members/:userId/status`) — `requireFreshMembership` đọc lại database
 * mỗi request nên nó có hiệu lực tức thì.
 *
 * Rate limit riêng, chặt hơn `POST /members`: đây là thao tác hiếm (một lần cho
 * một lần lỡ tay), và một vòng lặp gọi nó sẽ đổi mật khẩu của cả tổ chức.
 */
v1Router.post(
  '/members/:userId/reset-password',
  authorize('member', 'invite'),
  rateLimit({ bucket: 'tenant-reset-password', max: 10, windowSeconds: 600 }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const { userId } = userIdParamSchema.parse(req.params);

    const result = await resetMemberPassword({
      tenantId: auth.tenantId,
      actorUserId: auth.userId,
      targetUserId: userId,
    });
    res.json(result);
  }),
);

v1Router.patch(
  '/members/:userId/role',
  authorize('member', 'modify'),
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

v1Router.patch(
  '/members/:userId/status',
  authorize('member', 'modify'),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const { userId } = userIdParamSchema.parse(req.params);
    const { isActive } = setActiveBodySchema.parse(req.body);

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

v1Router.delete(
  '/members/:userId',
  authorize('member', 'delete'),
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

// ─── §8 Kết nối CSDL ─────────────────────────────────────────────────────────

/*
 * Đây là nhóm endpoint DUY NHẤT trong hệ thống mở kết nối ra ngoài Internet
 * theo địa chỉ do người dùng khai. Ba lớp bảo vệ riêng, chồng lên ba lớp chung
 * của router:
 *
 *   resolveAndGuardHost   chặn SSRF — không cho trỏ vào mạng nội bộ
 *   secretBox             mật khẩu CSDL mã hoá AES-256-GCM, không bao giờ trả ra
 *   rateLimit             mỗi lần test là một kết nối TCP thật tới máy người khác
 *
 * Hạn mức đặt trên các endpoint CHẠM MẠNG, không đặt trên endpoint đọc database
 * của chính mình: `POST /test` không giới hạn là biến hệ thống này thành công cụ
 * quét cổng, và mỗi request lại tiêu một socket của ta lẫn của bên kia.
 */

const connectionProbeLimit = rateLimit({
  bucket: 'connection-probe',
  max: 30,
  windowSeconds: 300,
});

// Không bọc `asyncHandler`: handler này đồng bộ hoàn toàn (đọc hằng số + env),
// nên không có Promise nào để bắt lỗi.
v1Router.get('/connections/prerequisites', authorize('connection', 'read'), (_req, res) => {
  res.json({
    egressIp: env.EGRESS_IP,
    grants: REQUIRED_GRANTS,
    defaultPorts: DEFAULT_PORTS,
    defaultSsl: DEFAULT_SSL,
  } satisfies ConnectionPrerequisitesDto);
});

v1Router.get(
  '/connections',
  authorize('connection', 'read'),
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    res.json(await connectionsRepo.list(mysqlPool, tenantId));
  }),
);

/**
 * Thử kết nối CHƯA lưu — bước 3 của wizard.
 *
 * Trả 200 kể cả khi kết nối thất bại: `{ ok: false, message }` là câu trả lời
 * hợp lệ mà người dùng đang chờ đọc, không phải một sự cố của hệ thống ta. Trả
 * 4xx/5xx ở đây sẽ khiến `getApiError` phía frontend hiện "đã có lỗi xảy ra"
 * thay vì câu nói rõ phải sửa gì.
 */
v1Router.post(
  '/connections/test',
  authorize('connection', 'modify'),
  connectionProbeLimit,
  asyncHandler(async (req, res) => {
    const body = testConnectionBodySchema.parse(req.body);
    res.json(await testConnection(body));
  }),
);

v1Router.post(
  '/connections',
  authorize('connection', 'modify'),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const body = createConnectionBodySchema.parse(req.body);

    const id = await createConnection(auth.tenantId, auth.userId, body).catch((err: unknown) => {
      throw asDuplicateName(err);
    });

    res.status(201).json(await connectionsRepo.findOne(mysqlPool, auth.tenantId, id));
  }),
);

v1Router.patch(
  '/connections/:id',
  authorize('connection', 'modify'),
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);
    const body = updateConnectionBodySchema.parse(req.body);

    // Chuỗi rỗng và `undefined` đều nghĩa là GIỮ NGUYÊN mật khẩu. Gộp chúng ở
    // đây thay vì bắt frontend phải biết gửi cái nào — một ô input để trống trả
    // về `''`, và bắt nó tự đổi thành `undefined` là đặt bẫy cho lần sửa sau.
    await updateConnection(tenantId, id, {
      ...body,
      password: body.password ? body.password : null,
    }).catch((err: unknown) => {
      throw asDuplicateName(err);
    });

    res.json(await connectionsRepo.findOne(mysqlPool, tenantId, id));
  }),
);

v1Router.post(
  '/connections/:id/test',
  authorize('connection', 'modify'),
  connectionProbeLimit,
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);
    res.json(await testSavedConnection(tenantId, id));
  }),
);

v1Router.delete(
  '/connections/:id',
  authorize('connection', 'delete'),
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);

    await deleteConnection(tenantId, id);
    res.status(204).end();
  }),
);

/**
 * Bảng trong CSDL nguồn — nuôi hộp thoại chọn bảng.
 *
 * Gác bằng `dataset:modify` chứ không `connection:read`: đây là bước một của
 * thao tác đồng bộ, nên ai đồng bộ được thì xem được danh sách. Đảo lại sẽ
 * khiến `creator` mở được hộp thoại rồi bị chặn ở nút xác nhận.
 */
v1Router.get(
  '/connections/:id/tables',
  authorize('dataset', 'modify'),
  connectionProbeLimit,
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);
    res.json(await listSourceTables(tenantId, id));
  }),
);

v1Router.post(
  '/connections/:id/sync',
  authorize('dataset', 'modify'),
  connectionProbeLimit,
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);
    const { tables } = syncBodySchema.parse(req.body);

    res.json(await syncDatasets(tenantId, id, tables));
  }),
);

// ─── §8.5 Kho dữ liệu ────────────────────────────────────────────────────────

v1Router.get(
  '/datasets',
  authorize('dataset', 'read'),
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    const query = listDatasetsQuerySchema.parse(req.query);

    const sort = resolveSortColumn(query.sort, datasetsRepo.DATASET_SORT_KEYS, 'name');
    if (sort === null) {
      throw badRequest('Cột sắp xếp không hợp lệ.', {
        sort: `Chỉ nhận: ${datasetsRepo.DATASET_SORT_KEYS.join(', ')}`,
      });
    }

    const filter: datasetsRepo.DatasetFilter = {
      search: query.q,
      // Không có `workspaceId` trong query nghĩa là "cả tổ chức" chứ KHÔNG rơi về
      // workspace đang mở: kho dữ liệu §8 vốn ở phạm vi tổ chức, và những bộ dữ
      // liệu tạo trước khi gộp chưa gắn workspace nào — mặc định lọc theo
      // workspace sẽ làm chúng biến mất khỏi trang.
      workspaceId: query.workspaceId,
      source: query.source,
      status: query.status,
      connectionId: query.connectionId,
      sort,
      order: query.order,
      page: query.page,
      pageSize: query.pageSize,
    };

    const total = await datasetsRepo.count(mysqlPool, tenantId, filter);
    const items = total === 0 ? [] : await datasetsRepo.list(mysqlPool, tenantId, filter);
    res.json(buildPageResult(items, total, query.page, query.pageSize));
  }),
);

v1Router.get(
  '/datasets/:id',
  authorize('dataset', 'read'),
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);

    res.json(await readDatasetDetail(tenantId, id));
  }),
);

/**
 * Vài dòng đầu của bảng nguồn — tab "Dữ liệu" ở trang chi tiết.
 *
 * `dataset:read` chứ không `modify`: xem dữ liệu là việc của người phân tích,
 * mà `viewer` chính là vai trò đó. Gác bằng `modify` sẽ khiến người được mời vào
 * để ĐỌC báo cáo lại không xem nổi dữ liệu nằm dưới báo cáo ấy.
 *
 * Có `connectionProbeLimit` vì mỗi lần gọi là một kết nối TCP thật tới máy chủ
 * của khách hàng — cùng lý do với `POST /test` và `GET /tables`. Đây là endpoint
 * `read` DUY NHẤT bị giới hạn, và nó xứng đáng: một vòng lặp bấm F5 trên trang
 * này là một vòng lặp mở kết nối vào CSDL của người khác.
 */
v1Router.get(
  '/datasets/:id/preview',
  authorize('dataset', 'read'),
  connectionProbeLimit,
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);
    res.json(await previewDataset(tenantId, id));
  }),
);

v1Router.patch(
  '/datasets/:id',
  authorize('dataset', 'modify'),
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);
    const { name } = renameDatasetBodySchema.parse(req.body);

    const affected = await datasetsRepo.rename(mysqlPool, tenantId, id, name);
    if (affected === 0) throw notFound('Không tìm thấy tập dữ liệu này.');

    res.json(await datasetsRepo.findOne(mysqlPool, tenantId, id));
  }),
);

v1Router.delete(
  '/datasets/:id',
  authorize('dataset', 'delete'),
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);

    // Chặn khi còn báo cáo dựng trên nó, thay vì xoá lan sang. Xoá mềm dây
    // chuyền không có nút hoàn tác là cách nhanh nhất làm mất báo cáo của người
    // khác — cùng lý do với `DELETE /workspaces/:id` ở trên.
    const live = await datasetsRepo.countLiveReports(mysqlPool, id);
    if (live > 0) {
      throw new HttpError(
        409,
        ADMIN_ERROR_CODES.WORKSPACE_NOT_EMPTY,
        `Còn ${live} báo cáo đang dùng bộ dữ liệu này. Hãy xoá chúng trước.`,
      );
    }

    await deleteDataset(tenantId, id);

    // File trên S3 GIỮ NGUYÊN: đây là xoá mềm, và xoá object thật thì thao tác
    // này không hoàn tác được nữa dù bản ghi vẫn còn. Dọn file của những dataset
    // đã xoá quá hạn là việc của job dọn dẹp, cùng chỗ với việc dọn `pending`.
    // Một file nhiều sheet còn sinh ra nhiều dataset trỏ chung một object.
    await clearAnalyzeCache(id);
    res.status(204).end();
  }),
);

/**
 * Trùng tên kết nối trong cùng tổ chức -> 409 gắn đúng ô `name`.
 *
 * Bắt ở ràng buộc UNIQUE chứ không SELECT kiểm trước: giữa SELECT và INSERT
 * luôn có khe hở cho hai request đồng thời, và ràng buộc mới là thứ thật sự
 * chặn. Lỗi khác thì trả nguyên vẹn cho `errorHandler`.
 */
function asDuplicateName(err: unknown): unknown {
  if (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: string }).code === 'ER_DUP_ENTRY' &&
    String((err as { message?: string }).message ?? '').includes('uq_connections_tenant_name')
  ) {
    return new HttpError(409, 'DuplicateName', 'Tổ chức đã có một kết nối trùng tên.', {
      name: 'Tên này đã được dùng',
    });
  }
  return err;
}
