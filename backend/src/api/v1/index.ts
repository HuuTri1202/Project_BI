import {
  ADMIN_ERROR_CODES,
  allVisuals,
  MAX_FOLDERS,
  parseFolderFilter,
  APP_NAME,
  BILLING_ERROR_CODES,
  CHART_SERIES_SUPPORT,
  CHART_TYPE_LABELS,
  DATAMODEL_ERROR_CODES,
  DATASET_ERROR_CODES,
  MEASURE_AGG_LABELS,
  ORDER_STATUS_LABELS,
  REPORT_ERROR_CODES,
  WORKSPACE_ERROR_CODES,
  type ChartType,
  type ReportModelConfigDto,
  type ConnectionPrerequisitesDto,
  type CreateUploadResultDto,
  type DataModelColumnDto,
  type DataModelDetailDto,
  type PrimaryKeyWarningDto,
  type DataModelDto,
  type DatasetColumnDto,
  type DatasetDetailDto,
  type FileExt,
  type HomeDataDto,
  type PermissionMatrixDto,
  type ReportConfigDto,
  type ReportCanvasDataDto,
  type ReportDataDto,
  type ReportPageDto,
  type ReportVisualDataDto,
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
import * as billingRepo from '../../repositories/billing';
import * as connectionsRepo from '../../repositories/connections';
import * as datamodelsRepo from '../../repositories/datamodels';
import * as datasetFoldersRepo from '../../repositories/datasetFolders';
import * as datasetsRepo from '../../repositories/datasets';
import type { Db } from '../../repositories/db';
import * as membershipsRepo from '../../repositories/memberships';
import * as reportFoldersRepo from '../../repositories/reportFolders';
import * as reportsRepo from '../../repositories/reports';
import * as tenantsRepo from '../../repositories/tenants';
import { createMember } from '../../services/admin/createMember';
import { createWorkspace } from '../../services/admin/createWorkspace';
import { resetMemberPassword } from '../../services/admin/resetMemberPassword';
import {
  createConnection,
  deleteConnection,
  listDatabases,
  listSavedDatabases,
  listSourceTables,
  testConnection,
  testSavedConnection,
  updateConnection,
} from '../../services/connections/connectionService';
import { createOrder } from '../../services/billing/createOrder';
import { buildBillingSummary, buildTenantPlan } from '../../services/billing/entitlements';
import { kiemHanMuc, trongHanMuc } from '../../services/billing/limits';
import { isQrKey } from '../../services/billing/qrImage';
import { deleteDataset } from '../../services/connections/deleteDataset';
import { DEFAULT_PORTS, DEFAULT_SSL, REQUIRED_GRANTS } from '../../services/connections/drivers';
import { previewDataset } from '../../services/connections/previewDataset';
import { syncDatasets } from '../../services/connections/syncDatasets';
import {
  getLoadStatus,
  listLoadErrors,
  previewWarehouse,
  queueLoad,
  warehouseSchema,
} from '../../services/ingest/loadService';
import { chTableName } from '../../services/ingest/buildDdl';
import { cubeTypeOf } from '../../services/datamodel/classifyColumn';
import { addDatasets, createDataModel } from '../../services/datamodel/createDataModel';
import { pingCube } from '../../services/datamodel/cubeClient';
import { regenerateTenant } from '../../services/datamodel/cubeSchemaService';
import {
  explainExplorerQuery,
  explorerFields,
  runExplorerQuery,
} from '../../services/datamodel/explorer';
import { checkPrimaryKey } from '../../services/datamodel/primaryKeyCheck';
import { createRelationship } from '../../services/datamodel/relationships';
import {
  applyColumnMeasures,
  assertAggFitsColumn,
  createFormulaMeasure,
  createRowExprMeasure,
  deleteMeasure,
} from '../../services/datamodel/measures';
import { aggregateFromModel } from '../../services/datamodel/modelReportData';
import { loadModelContext } from '../../services/datamodel/explorer';
import { aggregateInWarehouse } from '../../services/dataset/aggregateWarehouse';
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
import { buildPageResult, paginationSchema, resolveSortColumn } from '../../utils/pagination';
import {
  addDatasetsBodySchema,
  commitDatasetsBodySchema,
  createDatasetFolderBodySchema,
  moveDatasetBodySchema,
  moveDatasetsBodySchema,
  renameDatasetFolderBodySchema,
  createConnectionBodySchema,
  createDataModelBodySchema,
  createMeasureBodySchema,
  createMemberBodySchema,
  canvasDataQuerySchema,
  createCanvasReportBodySchema,
  createModelReportBodySchema,
  createOrderBodySchema,
  createRelationshipBodySchema,
  createReportBodySchema,
  createReportFolderBodySchema,
  createUploadBodySchema,
  createWorkspaceBodySchema,
  explorerQueryBodySchema,
  homeQuerySchema,
  idParamSchema,
  listDataModelsQuerySchema,
  listDatasetsQuerySchema,
  listLoadErrorsQuerySchema,
  listMembersQuerySchema,
  listOrdersQuerySchema,
  listReportsQuerySchema,
  moveReportBodySchema,
  renameReportFolderBodySchema,
  workspaceScopeQuerySchema,
  orderCodeParamSchema,
  renameDatasetBodySchema,
  saveLayoutBodySchema,
  createFormulaMeasureBodySchema,
  createRowExprMeasureBodySchema,
  saveSchemaBodySchema,
  setActiveBodySchema,
  syncBodySchema,
  testConnectionBodySchema,
  updateConnectionBodySchema,
  updateDataModelBodySchema,
  updateMeasureBodySchema,
  modelReportPreviewBodySchema,
  updateModelDatasetBodySchema,
  reportPageQuerySchema,
  updateCanvasReportBodySchema,
  visualIdParamSchema,
  updateModelReportBodySchema,
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
  res.json({ name: `${APP_NAME} API`, version: 'v1' });
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

  const all = await adminWorkspacesRepo.listWithReportCount(db, tenantId);
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

/**
 * Trần số báo cáo liệt kê trên trang Home.
 *
 * Trang chủ là bản tóm tắt, không phải trang danh sách: quá chừng này thì nó
 * thành một danh sách dài mà không có ô tìm kiếm lẫn phân trang.
 */
const HOME_REPORT_LIMIT = 12;

v1Router.get(
  '/home',
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    const { workspaceId } = homeQuerySchema.parse(req.query);

    const workspace = await resolveWorkspace(mysqlPool, tenantId, workspaceId);

    // Tuần tự chứ không `Promise.all`: pool chỉ có 10 connection, và chiếm gấp
    // đôi connection để tiết kiệm vài mili-giây trên trang mà MỌI người dùng mở
    // đầu tiên là đổi chác sai chiều.
    const reports = await reportsRepo.listRecent(
      mysqlPool,
      tenantId,
      workspace.id,
      HOME_REPORT_LIMIT,
    );
    // Đếm RIÊNG chứ không lấy `reports.length`: danh sách trên đã bị cắt ở trần,
    // nên dùng độ dài của nó làm thống kê sẽ đứng im ở 12 dù workspace có 300
    // báo cáo — một con số sai mà trông hoàn toàn hợp lý.
    const reportTotal = await reportsRepo.countReports(mysqlPool, tenantId, {
      workspaceId: workspace.id,
      page: 1,
      pageSize: 1,
    });
    const members = await adminMembersRepo.countMembers(mysqlPool, tenantId, {
      status: 'active',
      sort: 'joinedAt',
      order: 'desc',
      page: 1,
      pageSize: 1,
    });

    const body: HomeDataDto = {
      workspace,
      reports,
      stats: { reports: reportTotal, members },
    };
    res.json(body);
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

    /*
     * Hạn mức DUNG LƯỢNG của gói — §11.2. Cùng chỗ, cùng khuôn, cùng mục đích
     * với khối 413 ngay trên: từ chối trước khi khách tải file lên.
     *
     * `them = 0` — chỉ chặn tổ chức ĐÃ đầy kho. Từ migration 38 hạn mức đo chỗ
     * dữ liệu chiếm trong KHO, mà kích thước file không nói lên được chỗ ấy: kho
     * nén lại 2–5 lần trên dữ liệu thật. Lấy `body.fileSize` làm phần thêm là từ
     * chối những file thật ra vẫn vừa — và nó lại còn là con số do CLIENT khai.
     * Lớp chặn thật nằm ở `loadDataset`, nơi bảng đã nạp xong và đo được.
     */
    await kiemHanMuc(mysqlPool, auth.tenantId, 'storageBytes', new Date(), 0);

    const workspace = await resolveWorkspace(mysqlPool, auth.tenantId, body.workspaceId);
    const s3Key = buildStorageKey(auth.tenantId, workspace.id, body.filename, ext);

    // §7.9 — thư mục ghi vào bản ghi `pending` NGAY từ đây, không đợi tới lúc
    // chốt sheet: nếu người dùng bỏ dở wizard thì bản ghi rác ấy vẫn nằm đúng
    // chỗ, và `commit` chỉ việc đọc lại nó cho mọi sheet còn lại.
    const folderId = await thuMucDichDataset(auth.tenantId, workspace.id, body.folderId);

    const datasetId = await datasetsRepo.createFileDataset(mysqlPool, auth.tenantId, {
      workspaceId: workspace.id,
      folderId,
      name: defaultDatasetName(body.filename),
      originalFilename: body.filename,
      fileExt: ext,
      s3Key,
      createdBy: auth.userId,
    });

    const presigned = await storage.presignPut(s3Key, contentTypeOf(ext), env.UPLOAD_MAX_BYTES);

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
    // `originalFilename` chỉ null với bộ dữ liệu nguồn `connection`;
    // `requireDataset` ngay dưới đây lọc đúng nguồn `file`, nhưng kiểu vẫn cho
    // phép null nên phải chốt ở đây thay vì ép kiểu.
    if (!staged || staged.originalFilename === null) {
      throw notFound('Không tìm thấy bộ dữ liệu này.');
    }
    const { key, ext } = await requireDataset(auth.tenantId, id);

    const committed = await commitDatasets({
      datasetId: id,
      tenantId: auth.tenantId,
      workspaceId: staged.workspaceId,
      // Thư mục đã được chốt lúc xin chỗ tải lên; mọi sheet của cùng một file
      // đi theo nó. Đọc lại từ bản ghi `pending` chứ không nhận lại từ client:
      // client không có gì mới để nói ở bước này, và nhận lại là mở một đường
      // thứ hai để sheet đầu và những sheet sau rơi vào hai thư mục khác nhau.
      folderId: staged.folderId,
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

  /*
   * Khoá lưu trữ đi kèm bản CHI TIẾT, không đi kèm danh sách.
   *
   * Trang chi tiết là nơi người ta hỏi "tệp này nằm đâu trong bucket" — thường
   * là lúc đối chiếu với giao diện MinIO. Danh sách hai mươi dòng thì không, và
   * hai mươi chuỗi UUID trong mỗi lần tải trang là chỗ trả cho một câu hỏi
   * không ai đặt ở đó.
   *
   * `findStorageKey` đã lọc `source = 'file'`, nên nguồn `connection` ra `null`
   * mà không cần thêm nhánh nào ở đây.
   */
  const luuTru = await datasetsRepo.findStorageKey(mysqlPool, tenantId, id);

  return {
    ...dataset,
    columns: await datasetsRepo.listColumns(mysqlPool, id),
    file: luuTru === null ? null : { bucket: env.S3_BUCKET, key: luuTru.key },
  };
}

/**
 * Mô hình dữ liệu đầy đủ — bảng, cột, thước đo, quan hệ (§10).
 *
 * MỘT payload cho cả bốn tab thay vì bốn endpoint. Ba trong bốn tab cần biết
 * danh sách bảng và cột (Schemas hiện chúng, Quan hệ vẽ chúng, Thước đo chọn
 * trong chúng), nên tách ra chỉ khiến mỗi lần đổi tab là một vòng mạng cho dữ
 * liệu vừa tải xong. Bốn truy vấn ở đây đều là dò chỉ mục.
 *
 * `chType` trả về là giá trị ĐÃ LƯU, không phải giá trị đọc lại từ ClickHouse.
 * Route `/schema` mới là nơi đối chiếu hai bên và báo cột nào đã đổi kiểu — mở
 * một tab không đáng một vòng gọi sang ClickHouse cho mỗi bảng.
 */
async function readDataModelDetail(tenantId: number, id: number): Promise<DataModelDetailDto> {
  const model = await requireDataModel(tenantId, id);

  const [datasetRows, columnRows, measures, relationships] = await Promise.all([
    datamodelsRepo.listDatasets(mysqlPool, tenantId, id),
    datamodelsRepo.listColumns(mysqlPool, tenantId, id),
    datamodelsRepo.listMeasures(mysqlPool, tenantId, id),
    datamodelsRepo.listRelationships(mysqlPool, tenantId, id),
  ]);

  const columnsByDataset = new Map<number, DataModelColumnDto[]>();
  for (const row of columnRows) {
    const list = columnsByDataset.get(row.datamodel_dataset_id) ?? [];
    list.push({
      id: Number(row.id),
      columnName: row.column_name,
      alias: row.alias,
      role: row.role,
      chType: row.ch_type,
      cubeType: cubeTypeOf(row.ch_type),
      ordinal: Number(row.ordinal),
      // Chỉ `/schema` mới trả lời được câu này, vì nó đòi đọc lại ClickHouse.
      typeChanged: false,
    });
    columnsByDataset.set(row.datamodel_dataset_id, list);
  }

  return {
    ...model,
    datasets: datasetRows.map((row) => ({
      id: Number(row.id),
      datasetId: Number(row.dataset_id),
      datasetName: row.dataset_name,
      displayName: row.display_name,
      description: row.description,
      primaryColumnId: row.primary_column_id === null ? null : Number(row.primary_column_id),
      primaryColumnName: row.primary_column_name,
      chTable: chTableName(tenantId, Number(row.dataset_id)),
      canvasX: Number(row.canvas_x),
      canvasY: Number(row.canvas_y),
      columns: columnsByDataset.get(Number(row.id)) ?? [],
    })),
    measures,
    relationships,
  };
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
/**
 * Thư mục đích của một báo cáo — §10.25. Trả về `null` nghĩa là Chung.
 *
 * ⚠️ Kiểm CẢ hai điều, và điều thứ hai mới là điều dễ quên: thư mục có tồn tại
 * trong tổ chức này không, và nó có nằm đúng WORKSPACE của báo cáo không. Khoá
 * ngoại chỉ buộc được vế thứ nhất. Thiếu vế thứ hai thì báo cáo lọt vào một thư
 * mục của workspace khác và BIẾN MẤT khỏi mọi danh sách — tab Báo cáo lọc theo
 * workspace đang mở, nên không màn hình nào còn hiện nó ra, kể cả Chung.
 *
 * `undefined` và `null` cùng cho ra `null`: lúc tạo, "không nói gì" và "chọn
 * Chung" là một. Đường CHUYỂN thì không nhận `undefined` — xem
 * `moveReportBodySchema`.
 */
async function thuMucDich(
  tenantId: number,
  workspaceId: number,
  folderId: number | null | undefined,
): Promise<number | null> {
  if (folderId === undefined || folderId === null) return null;

  const folder = await reportFoldersRepo.findFolder(mysqlPool, tenantId, folderId);
  if (folder === null || folder.workspaceId !== workspaceId) {
    throw notFound('Không tìm thấy thư mục này.');
  }
  return folder.id;
}

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

    // Hạn mức gói — §11.2. Kiểm và ghi trong CÙNG một khoá, xem `trongHanMuc`.
    // Gắn ở ROUTE vì không có tầng service ở giữa: repository thuần không mang
    // luật nghiệp vụ.
    const folderId = await thuMucDich(auth.tenantId, workspaceId, body.folderId);

    const id = await trongHanMuc(auth.tenantId, 'reports', (conn) =>
      reportsRepo.createReport(conn, auth.tenantId, {
        workspaceId,
        folderId,
        datasetId: body.datasetId,
        name: body.name,
        createdBy: auth.userId,
      }),
    );

    res.status(201).json(await reportsRepo.findById(mysqlPool, auth.tenantId, id));
  }),
);

/**
 * Tạo báo cáo dựng trên MÔ HÌNH — §10.8.
 *
 * Đường riêng chứ không nhồi vào `POST /reports`: thân request khác hẳn (ID
 * chiều/thước đo thay cho tên cột), và quan trọng hơn là nó tạo ra một báo cáo
 * ĐÃ có biểu đồ. Gộp làm một thì thân request thành một union mà zod báo lỗi
 * theo kiểu "không khớp nhánh nào", vô ích cho người dùng.
 *
 * Kiểm chiều và thước đo NGAY tại đây, bằng chính `explorerFields` — tức là
 * cùng `indexModel` mà `runExplorerQuery` sẽ dùng lúc vẽ, nên không có chuyện
 * hai đường kiểm lệch nhau.
 *
 * Không hoãn tới lúc vẽ, vì báo cáo là thứ được LƯU LẠI: một ID sai lọt vào đây
 * sẽ nằm im trong database và chỉ lộ ra khi ai đó mở báo cáo, lúc đó thành một
 * bản ghi hỏng vĩnh viễn — chưa có màn sửa cấu hình để chọn lại. Explorer thì
 * ngược lại, ở đó người dùng chỉ việc chọn lại rồi bấm Chạy.
 */
/**
 * Kiểm một cấu hình biểu đồ trên mô hình — dùng chung cho TẠO, SỬA và XEM TRƯỚC.
 *
 * Một chỗ duy nhất, vì ba đường này phải nhận và từ chối đúng những thứ giống
 * nhau. Lệch một luật thôi là trình dựng cho xem trước một biểu đồ rồi từ chối
 * lưu nó — người dùng thấy thứ mình vừa dựng bị chối mà không hiểu vì sao.
 *
 * Kiểm bằng chính `explorerFields`, tức cùng `indexModel` mà `runExplorerQuery`
 * sẽ dùng lúc vẽ. Không có đường nào kiểm bằng một bảng khác.
 */
async function assertModelChartConfig(
  tenantId: number,
  dataModelId: number,
  chartType: ChartType,
  config: ReportModelConfigDto,
): Promise<void> {
  assertChartConfigAgainst(await explorerFields(tenantId, dataModelId), chartType, config);
}

/**
 * Một ô dùng trường mà mô hình không còn — mô hình đã được sửa sau khi trình
 * dựng đọc bảng trường.
 *
 * Mã `FIELD_UNKNOWN`, không phải `BadRequest` chung: trình dựng dựa vào mã
 * này để tự đọc lại bảng trường (§10.19), nên câu "chọn trường khác" bên dưới
 * đúng cả khi người sửa mô hình là một đồng nghiệp trên máy khác.
 *
 * ⚠️ KHÔNG khuyên "tải lại trang" như trước. Mọi đường tới đây — xem trước và
 * lưu — đều đi ra từ trình dựng, nơi tải lại trang là bỏ cả khung chưa lưu. Từ
 * khi nút "Sửa mô hình" mở trang mô hình ở tab bên cạnh, sửa mô hình giữa lúc
 * dựng là đường đi CHÍNH chứ không còn là chuyện hiếm.
 */
function fieldGone(what: string): HttpError {
  return new HttpError(
    400,
    DATAMODEL_ERROR_CODES.FIELD_UNKNOWN,
    `${what} không còn trong mô hình — mô hình vừa được sửa. Hãy chọn trường khác ở cột Mô hình dữ liệu.`,
  );
}

/**
 * Cùng bộ luật, nhưng nhận SẴN bảng trường thay vì tự đi lấy.
 *
 * Tách ra vì một khung §10.10 có tới 12 ô, và mỗi lần gọi `explorerFields` là
 * một lần dựng lại chỉ mục của cả mô hình. Mười hai lần dựng cho một lần bấm
 * Lưu là chi phí không đổi lấy điều gì — cả 12 ô đều thuộc CÙNG một mô hình.
 */
function assertChartConfigAgainst(
  fields: Awaited<ReturnType<typeof explorerFields>>,
  chartType: ChartType,
  config: ReportModelConfigDto,
): void {
  if (!fields.dimensions.some((f) => f.id === config.dimensionId)) {
    throw fieldGone('Chiều đã chọn');
  }
  const measure = fields.measures.find((f) => f.id === config.measureId);
  if (measure === undefined) {
    throw fieldGone('Thước đo đã chọn');
  }

  /*
   * Phép gộp chọn lại phải nằm trong `availableAggs` của CHÍNH thước đo đó.
   *
   * Không kiểm ở đây thì lỗi vẫn nổ, nhưng nổ ở tận Cube với câu "member not
   * found" — một câu chỉ có nghĩa với người biết cơ chế sinh schema, và nó tới
   * lúc XEM chứ không lúc LƯU. Tức là báo cáo lưu được, rồi hỏng.
   *
   * Bằng chính phép mà mô hình khai thì luôn hợp lệ, kể cả khi `availableAggs`
   * rỗng (thước đo công thức, thước đo đếm dòng): khi đó nó không phải một phép
   * CHỌN LẠI mà chỉ là viết lại thứ đã có.
   */
  const agg = config.measureAgg ?? null;
  if (agg !== null && agg !== measure.agg && !(measure.availableAggs ?? []).includes(agg)) {
    throw badRequest(
      `Thước đo "${measure.label}" không nhận phép gộp "${MEASURE_AGG_LABELS[agg]}". ` +
        'Hãy chọn lại phép tính cho ô Giá trị.',
    );
  }

  const series = config.seriesDimensionId ?? null;
  const support = CHART_SERIES_SUPPORT[chartType];

  if (series !== null) {
    if (support === 'no') {
      throw badRequest(
        `${CHART_TYPE_LABELS[chartType]} không tách được theo chiều thứ hai — nó đã dùng màu để phân từng phần.`,
      );
    }
    if (series === config.dimensionId) {
      // Cùng một chiều ở hai ô cho ra một chuỗi trên mỗi nhóm, tức là một biểu
      // đồ trông y hệt biểu đồ một chuỗi nhưng tốn gấp đôi truy vấn — và một
      // chú giải liệt kê lại đúng các nhãn đã có trên trục ngang.
      throw badRequest('Chiều nhóm màu phải khác chiều trên trục. Hãy chọn một chiều khác.');
    }
    if (!fields.dimensions.some((f) => f.id === series)) {
      throw fieldGone('Chiều nhóm màu');
    }
  } else if (support === 'required') {
    throw badRequest(
      `${CHART_TYPE_LABELS[chartType]} cần hai chiều: một cho trục và một cho nhóm màu.`,
    );
  }
}

v1Router.post(
  '/reports/from-datamodel',
  authorize('report', 'modify'),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const body = createModelReportBodySchema.parse(req.body);

    // Tra mô hình TRONG phạm vi tổ chức. Đây là chỗ chặn một id của tổ chức
    // khác, và nó phải đứng trước mọi thứ khác.
    const model = await datamodelsRepo.findOne(mysqlPool, auth.tenantId, body.datamodelId);
    if (!model) throw notFound('Không tìm thấy mô hình dữ liệu này.');

    await assertModelChartConfig(auth.tenantId, model.id, body.chartType, body.config);

    // Hạn mức gói — §11.2. Đặt SAU hai câu kiểm chiều/thước đo: lỗi cụ thể hơn
    // thì nói trước, và người chọn nhầm trường không nên nhận thông báo "hết hạn
    // mức" cho một việc họ chưa làm sai. Kiểm và ghi trong cùng một khoá.
    const folderId = await thuMucDich(auth.tenantId, model.workspaceId, body.folderId);

    const id = await trongHanMuc(auth.tenantId, 'reports', (conn) =>
      reportsRepo.createModelReport(conn, auth.tenantId, {
        // Báo cáo nằm cùng workspace với mô hình. Khác nhánh bộ dữ liệu — ở đó
        // bộ dữ liệu §8 có thể chưa thuộc workspace nào nên phải rơi về workspace
        // đang mở; mô hình thì luôn có.
        workspaceId: model.workspaceId,
        folderId,
        datamodelId: model.id,
        name: body.name,
        chartType: body.chartType,
        config: body.config,
        createdBy: auth.userId,
      }),
    );

    res.status(201).json(await reportsRepo.findById(mysqlPool, auth.tenantId, id));
  }),
);

/**
 * Tạo báo cáo NHIỀU biểu đồ — §10.10.
 *
 * Đường thứ ba tạo báo cáo, và lý do nó không gộp vào hai đường kia giống hệt
 * lý do `from-datamodel` không gộp vào `POST /reports`: thân request khác hình
 * dạng. Ở đây không có `chartType` lẫn `config` ở cấp ngoài — chúng nằm trong
 * từng ô, vì mỗi ô là một biểu đồ độc lập.
 *
 * Cả 12 ô kiểm bằng MỘT bảng trường: chúng cùng thuộc một mô hình, nên dựng chỉ
 * mục 12 lần là trả giá cho đúng một thứ đã có sẵn.
 */
v1Router.post(
  '/reports/canvas',
  authorize('report', 'modify'),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const body = createCanvasReportBodySchema.parse(req.body);

    const model = await datamodelsRepo.findOne(mysqlPool, auth.tenantId, body.datamodelId);
    if (!model) throw notFound('Không tìm thấy mô hình dữ liệu này.');

    const fields = await explorerFields(auth.tenantId, model.id);
    for (const visual of allVisuals(body.canvas)) {
      assertChartConfigAgainst(fields, visual.chartType, visual.config);
    }

    // Hạn mức gói — §11.2. Tới bản này đường này KHÔNG kiểm gì, mà nó lại là
    // đường duy nhất trình dựng gọi: gói Miễn phí tạo được báo cáo thứ tư qua
    // giao diện. Cùng khoá với hai đường kia — xem `trongHanMuc`.
    const folderId = await thuMucDich(auth.tenantId, model.workspaceId, body.folderId);

    const id = await trongHanMuc(auth.tenantId, 'reports', (conn) =>
      reportsRepo.createCanvasReport(conn, auth.tenantId, {
        workspaceId: model.workspaceId,
        folderId,
        datamodelId: model.id,
        name: body.name,
        canvas: body.canvas,
        createdBy: auth.userId,
      }),
    );

    res.status(201).json(await reportsRepo.findById(mysqlPool, auth.tenantId, id));
  }),
);

/*
 * Ba đường ĐỌC báo cáo dưới đây gác bằng `authorize('report', 'read')`.
 *
 * Trước đây chúng không gác gì cả — cứ là thành viên của tổ chức là đọc được.
 * Vô hại chừng nào cả ba vai trò đều có `report:read`, nhưng nó biến dòng
 * policy ấy thành đồ trang trí: bỏ nó khỏi `casbin_rule` cũng không đổi được
 * gì. Từ lúc `report:read` là quyền nội dung DUY NHẤT của viewer, nó phải là
 * một quyền thật, có chỗ để mất đi.
 */
v1Router.get(
  '/reports',
  authorize('report', 'read'),
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    const query = listReportsQuerySchema.parse(req.query);

    const workspace = await resolveWorkspace(mysqlPool, tenantId, query.workspaceId);

    const filter: reportsRepo.ListReportsFilter = {
      workspaceId: workspace.id,
      search: query.q,
      // `parseFolderFilter` dùng CHUNG với frontend — xem `listReportsQuerySchema`.
      folderId: parseFolderFilter(query.folder),
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
  authorize('report', 'read'),
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
  authorize('report', 'read'),
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);

    const report = await reportsRepo.findById(mysqlPool, tenantId, id);
    if (!report) throw notFound('Không tìm thấy báo cáo này.');

    // Báo cáo vừa được wizard tạo thì chưa có cấu hình — đó là trạng thái BÌNH
    // THƯỜNG, không phải hỏng. 409 kèm mã riêng để giao diện hiện lời mời dựng
    // biểu đồ thay vì màn hình lỗi.
    if (report.config === null && report.modelConfig === null) {
      throw new HttpError(
        409,
        REPORT_ERROR_CODES.REPORT_NOT_CONFIGURED,
        'Báo cáo chưa được dựng biểu đồ.',
      );
    }

    // Báo cáo trên MÔ HÌNH đi đường khác hẳn: câu lệnh do Cube sinh, nên nó
    // thừa hưởng cả phép nối lẫn thước đo tính toán của tầng ngữ nghĩa (§10.8).
    //
    // ⚠️ Gọi THẲNG service, cố ý không thêm `authorize('datamodel', 'read')`.
    // Viewer không còn quyền đó (migration 26) nhưng vẫn phải xem được biểu đồ:
    // họ đọc một lát cắt do người khác chọn, không phải mở mô hình ra hỏi tiếp.
    // Thêm guard đó vào đây là làm trắng mọi báo cáo trên mô hình của viewer.
    if (report.source === 'datamodel') {
      if (report.datamodelId === null || report.modelConfig === null) {
        throw notFound('Mô hình dữ liệu của báo cáo này không còn tồn tại.');
      }
      res.json(
        await aggregateFromModel(
          tenantId,
          requireAuth(req).userId,
          report.datamodelId,
          report.modelConfig,
          reportPageQuerySchema.parse(req.query).page ?? 0,
        ),
      );
      return;
    }

    if (report.datasetId === null || report.config === null) {
      throw notFound('Bộ dữ liệu của báo cáo này không còn tồn tại.');
    }

    // Gom nhóm trong ClickHouse, KHÔNG đọc `dataset_rows` lên RAM nữa.
    //
    // Bảng đó giờ chỉ giữ một MẪU để xem trước, nên tổng hợp trên nó sẽ cho ra
    // một biểu đồ trông hoàn toàn hợp lý mà sai số liệu — kiểu hỏng tệ nhất
    // trong BI. Xem `aggregateWarehouse.ts`.
    const dataset = await datasetsRepo.findOne(mysqlPool, tenantId, report.datasetId);
    if (!dataset) throw notFound('Bộ dữ liệu của báo cáo này không còn tồn tại.');

    const columns = await datasetsRepo.listColumns(mysqlPool, report.datasetId);

    const body: ReportDataDto = await aggregateInWarehouse(
      tenantId,
      dataset,
      columns,
      report.config,
    );
    res.json(body);
  }),
);

/**
 * Số liệu cho MỌI ô của một khung — §10.10.
 *
 * ─── Vì sao một request chứ không phải mỗi ô một request ───────────────────
 *
 * Trình duyệt không biết trước khung có mấy ô, nên "mỗi ô một request" nghĩa là
 * một vòng đọc báo cáo rồi mới bắn tiếp n request — hai lượt khứ hồi trước khi
 * thấy biểu đồ đầu tiên. Gộp lại còn một, và backend chạy song song.
 *
 * ─── Ô hỏng KHÔNG làm hỏng cả khung ────────────────────────────────────────
 *
 * `Promise.allSettled` chứ không `Promise.all`: một ô trỏ vào thước đo vừa bị
 * xoá sẽ ném lỗi, và `Promise.all` biến lỗi đó thành một request 500 — bảy ô
 * còn lại hoàn toàn đọc được cũng biến mất theo. Ở đây ô hỏng tự mang câu lỗi
 * của nó, và trình vẽ hiện câu đó bên trong đúng ô ấy.
 *
 * ─── Đúng MỘT trang mỗi lần, không phải cả báo cáo ─────────────────────────
 *
 * `?pageId=` chọn trang; vắng mặt hoặc trỏ vào một trang đã bị xoá thì lấy
 * trang đầu. Tính cả mười trang trong một lượt sẽ là mười hai mươi truy vấn
 * Cube cho một màn hình hiện được một trang — cùng lập luận đã đặt ra
 * `CANVAS_MAX_VISUALS`, chỉ ở một tầng cao hơn.
 *
 * Không 404 khi `pageId` lạ: nó xảy ra thật khi hai người mở cùng một báo cáo
 * và một người xoá một trang. Rơi về trang đầu là thứ người kia hiểu được ngay;
 * một màn hình lỗi thì không.
 *
 * ⚠️ Gọi THẲNG service, không thêm `authorize('datamodel', 'read')` — cùng lý do
 * đã ghi ở `GET /reports/:id/data`: viewer không có ô quyền đó nhưng vẫn phải
 * xem được báo cáo người khác dựng cho họ.
 */
v1Router.get(
  '/reports/:id/canvas-data',
  authorize('report', 'read'),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);
    const query = canvasDataQuerySchema.parse(req.query);

    const report = await reportsRepo.findById(mysqlPool, auth.tenantId, id);
    if (!report) throw notFound('Không tìm thấy báo cáo này.');

    if (report.canvas === null || report.datamodelId === null) {
      throw new HttpError(
        409,
        REPORT_ERROR_CODES.REPORT_NOT_CONFIGURED,
        'Báo cáo này không phải khung nhiều biểu đồ.',
      );
    }

    const datamodelId = report.datamodelId;
    const page: ReportPageDto | undefined =
      report.canvas.pages.find((p) => p.id === query.pageId) ?? report.canvas.pages[0];
    const cells = page?.visuals ?? [];

    /*
     * Chỉ mục mô hình nạp MỘT lần cho cả trang — §10.14.
     *
     * Trước bản này mỗi ô tự nạp: `findOne` + ba truy vấn danh sách + một truy
     * vấn `schemaVersion`. Mười hai ô là 60 vòng MySQL cho một thứ không đổi
     * giữa chúng, và pool 10 kết nối biến chúng thành một hàng đợi.
     *
     * Nạp TRƯỚC `Promise.allSettled` chứ không để ô đầu tiên nạp hộ: các ô chạy
     * song song, nên cả mười hai đều xuất phát trước khi ô nào kịp nạp xong.
     */
    const ctx = await loadModelContext(auth.tenantId, datamodelId);

    const settled = await Promise.allSettled(
      cells.map((visual) =>
        aggregateFromModel(auth.tenantId, auth.userId, datamodelId, visual.config, 0, ctx),
      ),
    );

    const visuals: ReportVisualDataDto[] = cells.map((visual, index) => {
      const outcome = settled[index];
      if (outcome !== undefined && outcome.status === 'fulfilled') {
        return { visualId: visual.id, data: outcome.value };
      }
      const reason = outcome?.status === 'rejected' ? outcome.reason : undefined;
      return {
        visualId: visual.id,
        data: null,
        // Câu chữ của lỗi nghiệp vụ (`HttpError` mang câu tiếng Việt) đi thẳng
        // ra. Lỗi không lường trước thì KHÔNG: thông điệp của nó là chi tiết nội
        // bộ, và một ô biểu đồ không phải chỗ để rò rỉ chúng.
        error:
          reason instanceof HttpError
            ? reason.message
            : 'Không đọc được số liệu cho ô này. Thử mở lại báo cáo.',
      };
    });

    const body: ReportCanvasDataDto = { visuals };
    res.json(body);
  }),
);

/**
 * Số liệu của MỘT ô, ở một TRANG NHÓM cụ thể — §10.12.
 *
 * ─── Vì sao nó không dùng lại `/report-preview` ────────────────────────────
 *
 * Endpoint kia gác `datamodel:read`, và viewer không có ô quyền đó (migration
 * 26). Cho hai cái nút ‹ › gọi nó nghĩa là chúng chỉ chạy cho người sửa được
 * báo cáo — tức là hỏng ở đúng chỗ chúng có ích nhất, một người CHỈ ĐỌC đang
 * cần xem hết dữ liệu.
 *
 * Nó cũng nhận ÍT hơn hẳn: chỉ một mã ô, không nhận cấu hình nào từ client.
 * Cấu hình đọc từ chính báo cáo đã lưu, nên bấm sang trang 3 không phải là một
 * đường lén gửi lên một cấu hình khác.
 *
 * ─── Vì sao không gộp vào `canvas-data` ────────────────────────────────────
 *
 * Vì lật trang một ô không có lý do gì bắt mười một ô kia quét lại ClickHouse.
 */
v1Router.get(
  '/reports/:id/visuals/:visualId/data',
  authorize('report', 'read'),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const { id, visualId } = visualIdParamSchema.parse(req.params);
    const { page } = reportPageQuerySchema.parse(req.query);

    const report = await reportsRepo.findById(mysqlPool, auth.tenantId, id);
    if (!report) throw notFound('Không tìm thấy báo cáo này.');

    if (report.canvas === null || report.datamodelId === null) {
      throw new HttpError(
        409,
        REPORT_ERROR_CODES.REPORT_NOT_CONFIGURED,
        'Báo cáo này không phải khung nhiều biểu đồ.',
      );
    }

    const visual = allVisuals(report.canvas).find((v) => v.id === visualId);
    if (visual === undefined) throw notFound('Ô này không còn trong báo cáo.');

    const body: ReportDataDto = await aggregateFromModel(
      auth.tenantId,
      auth.userId,
      report.datamodelId,
      visual.config,
      page ?? 0,
    );
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

    // Thân request ở đây mang cấu hình dạng TÊN CỘT, vốn chỉ có nghĩa với báo
    // cáo dựng trên bộ dữ liệu. Nhận nó cho một báo cáo trên mô hình sẽ ghi đè
    // `config` bằng một hình dạng mà `parseModelConfig` đọc ra `null` — báo cáo
    // trở lại trạng thái "chưa có biểu đồ" và không có đường nào dựng lại.
    if (existing.source === 'datamodel' || existing.datasetId === null) {
      throw badRequest(
        'Báo cáo dựng trên mô hình dữ liệu sửa ở đường riêng: PATCH /reports/:id/from-datamodel.',
      );
    }

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

/**
 * Sửa một báo cáo dựng trên MÔ HÌNH — §10.9.
 *
 * Cho tới trước bản này, báo cáo trên mô hình là thứ chỉ tạo được chứ không sửa
 * được: `PATCH /reports/:id` từ chối thẳng nó, với lời khuyên "hãy tạo báo cáo
 * mới". Lời khuyên đó chấp nhận được khi việc tạo chỉ tốn một hộp thoại năm ô;
 * nó không còn chấp nhận được khi người dùng vừa dựng xong một biểu đồ trong
 * trình dựng và chỉ muốn đổi bảng màu.
 *
 * KHÔNG nhận `datamodelId`: nguồn của báo cáo cố định từ lúc tạo. Xem
 * `updateModelReportBodySchema`.
 */
v1Router.patch(
  '/reports/:id/from-datamodel',
  authorize('report', 'modify'),
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);
    const body = updateModelReportBodySchema.parse(req.body);

    const existing = await reportsRepo.findById(mysqlPool, tenantId, id);
    if (!existing) throw notFound('Không tìm thấy báo cáo này.');

    // Ngược chiều với nhánh kia, và cũng cùng lý do: ghi cấu hình dạng ID lên
    // một báo cáo dựng trên bộ dữ liệu sẽ làm `parseConfig` đọc ra `null`, tức
    // xoá trắng biểu đồ mà không báo gì.
    if (existing.source !== 'datamodel' || existing.datamodelId === null) {
      throw badRequest(
        'Báo cáo này dựng trên bộ dữ liệu, không phải mô hình. Sửa nó ở PATCH /reports/:id.',
      );
    }

    await assertModelChartConfig(tenantId, existing.datamodelId, body.chartType, body.config);

    await reportsRepo.updateModelReport(mysqlPool, tenantId, id, {
      name: body.name,
      chartType: body.chartType,
      config: body.config,
    });

    res.json(await reportsRepo.findById(mysqlPool, tenantId, id));
  }),
);

/**
 * Sửa một báo cáo NHIỀU biểu đồ — §10.10.
 *
 * ⚠️ Đây cũng là đường CHUYỂN ĐỔI: gọi nó trên một báo cáo một-biểu-đồ sẽ ghi
 * cột `canvas` và biến nó thành báo cáo nhiều biểu đồ. Cố ý, và đó là cách một
 * báo cáo dựng ở §10.9 thêm được ô thứ hai mà không phải tạo lại từ đầu.
 *
 * Chuyển đổi này MỘT CHIỀU — không có đường ngược. Không mất gì: ô đầu tiên
 * mang đúng cấu hình cũ, và `updateCanvasReport` vẫn chép nó vào
 * `chart_type`/`config` nên mọi thứ đọc hai cột đó vẫn đọc ra biểu đồ cũ.
 */
v1Router.patch(
  '/reports/:id/canvas',
  authorize('report', 'modify'),
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);
    const body = updateCanvasReportBodySchema.parse(req.body);

    const existing = await reportsRepo.findById(mysqlPool, tenantId, id);
    if (!existing) throw notFound('Không tìm thấy báo cáo này.');

    if (existing.source !== 'datamodel' || existing.datamodelId === null) {
      throw badRequest(
        'Báo cáo này dựng trên bộ dữ liệu, không phải mô hình. Sửa nó ở PATCH /reports/:id.',
      );
    }

    const fields = await explorerFields(tenantId, existing.datamodelId);
    for (const visual of allVisuals(body.canvas)) {
      assertChartConfigAgainst(fields, visual.chartType, visual.config);
    }

    await reportsRepo.updateCanvasReport(mysqlPool, tenantId, id, {
      name: body.name,
      canvas: body.canvas,
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

/**
 * Chuyển một báo cáo sang thư mục khác — §10.25.
 *
 * ĐƯỜNG RIÊNG, không nhồi `folderId` vào `PATCH /reports/:id`, và lý do rất cụ
 * thể: đường đó TỪ CHỐI thẳng báo cáo dựng trên mô hình ("sửa ở đường riêng:
 * PATCH /reports/:id/from-datamodel"). Mà báo cáo trên mô hình là loại người
 * dùng tạo nhiều nhất từ §10.10. Nhét vào đó nghĩa là xếp thư mục được cho
 * đúng loại báo cáo cũ, còn loại mới thì không.
 *
 * Gác bằng `report:modify` chứ không phải `delete`: xếp lại chỗ đứng không làm
 * mất gì, và viewer thì vẫn không được đụng.
 */
v1Router.patch(
  '/reports/:id/folder',
  authorize('report', 'modify'),
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);
    const body = moveReportBodySchema.parse(req.body);

    // Đọc báo cáo TRƯỚC: cần workspace của nó để kiểm thư mục đích cùng chỗ, và
    // cũng là chỗ trả 404 cho một mã của tổ chức khác.
    const report = await reportsRepo.findById(mysqlPool, tenantId, id);
    if (report === null) throw notFound('Không tìm thấy báo cáo này.');

    const folderId = await thuMucDich(tenantId, report.workspaceId, body.folderId);

    await reportsRepo.moveReport(mysqlPool, tenantId, id, folderId);
    res.json(await reportsRepo.findById(mysqlPool, tenantId, id));
  }),
);

/* ─── Thư mục báo cáo — §10.25 ─────────────────────────────────────────────── */

/**
 * Danh sách thư mục của một workspace, kèm số báo cáo trong từng cái.
 *
 * KHÔNG trả về "Chung" như một phần tử: nó không phải một bản ghi (xem
 * `reportFolder.ts`), và bịa ra một phần tử mã `0` ở đây là mời client đối xử
 * với nó như một thư mục thật rồi gửi `folderId: 0` lên đường chuyển. Số báo
 * cáo của Chung đi riêng ở `chungCount`, đúng như bản chất của nó.
 */
v1Router.get(
  '/report-folders',
  authorize('report', 'read'),
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    const query = workspaceScopeQuerySchema.parse(req.query);
    const workspace = await resolveWorkspace(mysqlPool, tenantId, query.workspaceId);

    const [items, chungCount] = await Promise.all([
      reportFoldersRepo.listFolders(mysqlPool, tenantId, workspace.id),
      reportFoldersRepo.countChung(mysqlPool, tenantId, workspace.id),
    ]);

    res.json({ items, chungCount });
  }),
);

v1Router.post(
  '/report-folders',
  authorize('report', 'modify'),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const query = workspaceScopeQuerySchema.parse(req.query);
    const body = createReportFolderBodySchema.parse(req.body);
    const workspace = await resolveWorkspace(mysqlPool, auth.tenantId, query.workspaceId);

    const dang = await reportFoldersRepo.countFolders(mysqlPool, auth.tenantId, workspace.id);
    if (dang >= MAX_FOLDERS) {
      throw new HttpError(
        409,
        'TooManyFolders',
        `Mỗi workspace tối đa ${String(MAX_FOLDERS)} thư mục.`,
      );
    }

    /*
     * Bắt ER_DUP_ENTRY thay vì SELECT kiểm trước — cùng lập luận với
     * `asDuplicateMeasureName`: giữa một câu SELECT và câu INSERT luôn có khe
     * hở cho hai request đồng thời, và người dùng bấm hai lần vì lần đầu chưa
     * thấy gì xảy ra là chuyện thường.
     */
    let id: number;
    try {
      id = await reportFoldersRepo.createFolder(mysqlPool, auth.tenantId, {
        workspaceId: workspace.id,
        name: body.name,
        createdBy: auth.userId,
      });
    } catch (err) {
      if (reportFoldersRepo.isDuplicateFolderName(err)) {
        throw new HttpError(409, 'DuplicateName', 'Workspace đã có một thư mục trùng tên.', {
          name: 'Tên này đã được dùng',
        });
      }
      throw err;
    }

    const items = await reportFoldersRepo.listFolders(mysqlPool, auth.tenantId, workspace.id);
    const created = items.find((f) => f.id === id);
    res.status(201).json(created ?? { id, workspaceId: workspace.id, name: body.name });
  }),
);

v1Router.patch(
  '/report-folders/:id',
  authorize('report', 'modify'),
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);
    const body = renameReportFolderBodySchema.parse(req.body);

    const folder = await reportFoldersRepo.findFolder(mysqlPool, tenantId, id);
    if (folder === null) throw notFound('Không tìm thấy thư mục này.');

    try {
      await reportFoldersRepo.renameFolder(mysqlPool, tenantId, id, body.name);
    } catch (err) {
      if (reportFoldersRepo.isDuplicateFolderName(err)) {
        throw new HttpError(409, 'DuplicateName', 'Workspace đã có một thư mục trùng tên.', {
          name: 'Tên này đã được dùng',
        });
      }
      throw err;
    }

    const items = await reportFoldersRepo.listFolders(mysqlPool, tenantId, folder.workspaceId);
    res.json(items.find((f) => f.id === id));
  }),
);

/**
 * Xoá một thư mục. Báo cáo bên trong KHÔNG mất — chúng về Chung.
 *
 * `report:modify` chứ không phải `report:delete`, và đó không phải sơ suất:
 * không một báo cáo nào bị xoá ở đây. Khoá ngoại `ON DELETE SET NULL` của
 * migration 37 là thứ bảo đảm điều đó, chứ không phải một câu UPDATE viết thêm
 * ở chỗ này — luật nằm dưới database thì nó còn đúng với mọi đường xoá về sau.
 */
v1Router.delete(
  '/report-folders/:id',
  authorize('report', 'modify'),
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);

    const affected = await reportFoldersRepo.deleteFolder(mysqlPool, tenantId, id);
    if (affected === 0) throw notFound('Không tìm thấy thư mục này.');

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
    res.json(await adminWorkspacesRepo.listWithReportCount(mysqlPool, tenantId));
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
      // CHẶN thay vì xoá lan sang nội dung bên trong. Xoá mềm dây chuyền,
      // không có nút hoàn tác, là cách nhanh nhất làm mất dashboard của người
      // khác. Báo số lượng để Admin biết mình đang định xoá cái gì.
      //
      // Trước khi bỏ project, chỗ này đếm project. Đổi sang đếm BÁO CÁO và BỘ
      // DỮ LIỆU chứ không bỏ hẳn: cái lưới an toàn này không liên quan gì tới
      // project, nó chỉ tình cờ đo bằng project.
      const live = await adminWorkspacesRepo.countLiveContent(conn, tenantId, id);
      if (live.reports > 0 || live.datasets > 0) {
        const parts = [
          live.reports > 0 ? `${live.reports} báo cáo` : null,
          live.datasets > 0 ? `${live.datasets} bộ dữ liệu` : null,
        ].filter((x): x is string => x !== null);
        throw new HttpError(
          409,
          ADMIN_ERROR_CODES.WORKSPACE_NOT_EMPTY,
          `Workspace còn ${parts.join(' và ')}. Hãy chuyển hoặc xoá chúng trước.`,
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

      // Dọn nốt những lần tải file bỏ dở — đúng những dòng mà `countLiveContent`
      // vừa cố ý không tính. Để lại thì chúng trỏ vào một workspace đã xoá và
      // vẫn vô hình như cũ.
      await adminWorkspacesRepo.softDeleteUnfinishedDatasets(conn, tenantId, id);
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
    const items =
      total === 0 ? [] : await adminMembersRepo.listMembers(mysqlPool, tenantId, filter);
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

/**
 * Người gọi, ở dạng mà tầng repository dùng để giới hạn phạm vi (migration 28).
 *
 * MỘT hàm duy nhất dựng object này, và nó đọc từ `req.auth` chứ không từ body
 * hay query. `requireFreshMembership` đã ghi đè `role` bằng vai trò đọc lại từ
 * database ngay trước đó, nên `auth.role` ở đây là vai trò THẬT — không phải
 * vai trò lúc đăng nhập, vốn có thể đã cũ tới 7 ngày.
 *
 * Nhận `req` chứ không nhận `auth` đã bóc sẵn: nơi gọi viết `viewerOf(req)` là
 * xong, không phải nhớ bóc `userId` và `role` rồi ghép lại — mà ghép tay thì sẽ
 * có chỗ ghép nhầm `tenantId` vào `userId`, và hai số đó cùng kiểu nên không có
 * gì bắt được.
 */
function viewerOf(req: Request): connectionsRepo.ConnectionViewer {
  const auth = requireAuth(req);
  return { userId: auth.userId, role: auth.role };
}

/** `list` nhận `(db, tenantId, viewer)` — trải ra để nơi gọi khỏi lặp `requireAuth`. */
function scopeOf(req: Request): [number, connectionsRepo.ConnectionViewer] {
  return [requireAuth(req).tenantId, viewerOf(req)];
}

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
    res.json(await connectionsRepo.list(mysqlPool, ...scopeOf(req)));
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

/**
 * Database mà bộ thông tin vừa gõ nhìn thấy — nuôi bộ chọn ở bước 2 của wizard.
 *
 * `connection:modify` chứ không `connection:read`: đây là một thao tác MỞ KẾT NỐI
 * THẬT tới máy chủ của khách hàng bằng thông tin client vừa gửi lên, cùng hạng
 * với `/connections/test`, nên nó dùng chung cả quyền lẫn `connectionProbeLimit`.
 * Gác bằng quyền đọc sẽ biến nó thành một cổng dò cổng mạng cho bất kỳ ai xem
 * được danh sách kết nối.
 */
v1Router.post(
  '/connections/databases',
  authorize('connection', 'modify'),
  connectionProbeLimit,
  asyncHandler(async (req, res) => {
    const body = testConnectionBodySchema.parse(req.body);
    res.json(await listDatabases(body));
  }),
);

v1Router.post(
  '/connections',
  authorize('connection', 'modify'),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const body = createConnectionBodySchema.parse(req.body);

    const id = await createConnection(auth.tenantId, auth.userId, auth.role, body).catch(
      (err: unknown) => {
        throw asDuplicateName(err);
      },
    );

    res
      .status(201)
      .json(await connectionsRepo.findOne(mysqlPool, auth.tenantId, id, viewerOf(req)));
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
    await updateConnection(
      tenantId,
      id,
      { ...body, password: body.password ? body.password : null },
      viewerOf(req),
    ).catch((err: unknown) => {
      throw asDuplicateName(err);
    });

    res.json(await connectionsRepo.findOne(mysqlPool, tenantId, id, viewerOf(req)));
  }),
);

v1Router.post(
  '/connections/:id/test',
  authorize('connection', 'modify'),
  connectionProbeLimit,
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);
    res.json(await testSavedConnection(tenantId, id, viewerOf(req)));
  }),
);

/**
 * Như `/connections/databases` nhưng cho kết nối ĐÃ lưu.
 *
 * Tồn tại vì form sửa để trống ô mật khẩu (nghĩa là "giữ nguyên"), nên đường
 * dùng thông tin chưa lưu không có mật khẩu để mà thử. `GET` vì nó chỉ đọc và
 * không nhận body nào.
 */
v1Router.get(
  '/connections/:id/databases',
  authorize('connection', 'modify'),
  connectionProbeLimit,
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);
    res.json(await listSavedDatabases(tenantId, id, viewerOf(req)));
  }),
);

v1Router.delete(
  '/connections/:id',
  authorize('connection', 'delete'),
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);

    await deleteConnection(tenantId, id, viewerOf(req));
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
    res.json(await listSourceTables(tenantId, id, viewerOf(req)));
  }),
);

v1Router.post(
  '/connections/:id/sync',
  authorize('dataset', 'modify'),
  connectionProbeLimit,
  asyncHandler(async (req, res) => {
    const { tenantId, userId } = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);
    const body = syncBodySchema.parse(req.body);

    // Bảng đồng bộ về thuộc workspace người dùng đang mở, không phải "cả tổ
    // chức" như bản đầu. Kết nối vẫn là tài sản chung — chỉ những bảng lấy ra
    // từ nó mới thuộc về một workspace.
    const workspace = await resolveWorkspace(mysqlPool, tenantId, body.workspaceId);
    // §7.9 — thư mục đang mở lúc bấm "Đồng bộ từ CSDL". Chỉ áp cho bảng MỚI.
    const folderId = await thuMucDichDataset(tenantId, workspace.id, body.folderId);

    res.json(
      await syncDatasets(tenantId, id, body.tables, workspace.id, folderId, userId, viewerOf(req)),
    );
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
      // §7.9. Ba trạng thái, và phép dịch nằm ở @bi/shared để URL của frontend
      // và cách backend đọc nó không bao giờ lệch nhau.
      folderId: parseFolderFilter(query.folder),
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

/* ─── Thư mục bộ dữ liệu — §7.9 ───────────────────────────────────────────── */

/**
 * Thư mục đích của một bộ dữ liệu. Trả về `null` nghĩa là Chung.
 *
 * Bản sinh đôi của `thuMucDich` bên báo cáo, và hai vế kiểm giống hệt: thư mục
 * có tồn tại trong tổ chức này không, và nó có nằm đúng WORKSPACE không. Khoá
 * ngoại chỉ buộc được vế thứ nhất. Thiếu vế thứ hai thì bộ dữ liệu lọt vào một
 * thư mục của workspace khác và BIẾN MẤT khỏi mọi danh sách — Kho dữ liệu lọc
 * theo workspace đang mở, nên không màn hình nào còn hiện nó ra, kể cả Chung.
 *
 * KHÔNG gộp với `thuMucDich` thành một hàm nhận thêm tham số "loại": hai hàm
 * tra hai BẢNG khác nhau, và một tham số chọn bảng là đúng thứ sẽ bị truyền
 * nhầm ở một nơi gọi nào đó rồi cho ra một lỗi 404 không ai hiểu nổi.
 */
async function thuMucDichDataset(
  tenantId: number,
  workspaceId: number,
  folderId: number | null | undefined,
): Promise<number | null> {
  if (folderId === undefined || folderId === null) return null;

  const folder = await datasetFoldersRepo.findFolder(mysqlPool, tenantId, folderId);
  if (folder === null || folder.workspaceId !== workspaceId) {
    throw notFound('Không tìm thấy thư mục này.');
  }
  return folder.id;
}

/**
 * Chuyển một bộ dữ liệu sang thư mục khác — §7.9.
 *
 * Gác bằng `dataset:modify` chứ không phải `delete`: xếp lại chỗ đứng không làm
 * mất gì, và viewer thì vẫn không được đụng.
 */
v1Router.patch(
  '/datasets/:id/folder',
  authorize('dataset', 'modify'),
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);
    const body = moveDatasetBodySchema.parse(req.body);

    // Đọc TRƯỚC: cần workspace của nó để kiểm thư mục đích cùng chỗ, và cũng là
    // chỗ trả 404 cho một mã của tổ chức khác.
    const dataset = await datasetsRepo.findOne(mysqlPool, tenantId, id);
    if (dataset === null) throw notFound('Không tìm thấy bộ dữ liệu này.');

    const folderId = await thuMucDichDataset(tenantId, dataset.workspaceId, body.folderId);

    await datasetsRepo.moveDataset(mysqlPool, tenantId, id, folderId);
    res.json(await datasetsRepo.findOne(mysqlPool, tenantId, id));
  }),
);

/**
 * Chuyển CẢ MỘT NHÓM bộ dữ liệu sang cùng một thư mục — §7.9.
 *
 * ─── Vì sao một đường riêng chứ không phải gọi đường trên nhiều lượt ────────
 *
 * Kho dữ liệu cho tích nhiều dòng rồi xếp một lượt. Làm việc đó bằng hai mươi
 * request là chấp nhận trước một trạng thái nửa vời: lượt thứ bảy hỏng thì sáu
 * bộ đã sang chỗ mới, mười ba bộ còn ở chỗ cũ, và người dùng nhìn một hộp lỗi
 * không nói được bộ nào là bộ nào — trong khi danh sách vừa sắp xếp lại ngay
 * dưới mắt họ. Ở đây tất cả nằm trong MỘT câu UPDATE, nên chỉ có hai kết cục và
 * cả hai đều đọc ra được từ màn hình.
 *
 * ⚠️ Đường này phải đứng TRƯỚC `PATCH /datasets/:id` (khai phía dưới trong
 * file), nếu không Express đọc "folder" thành một mã và `idParamSchema` trả 400
 * cho mọi lượt chuyển nhóm. `datasetFolders.integration.test.ts` canh đúng chỗ
 * này, nên đảo thứ tự sẽ làm test đỏ chứ không lặng lẽ hỏng.
 *
 * Gác bằng `dataset:modify`, cùng ô quyền với đường chuyển một bộ: xếp lại chỗ
 * đứng không làm mất gì.
 */
v1Router.patch(
  '/datasets/folder',
  authorize('dataset', 'modify'),
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    const body = moveDatasetsBodySchema.parse(req.body);

    /*
     * Đọc TRƯỚC, và đọc cả nhóm bằng một câu.
     *
     * Hai việc cần câu này: chặn mã của tổ chức khác (hoặc mã đã xoá) lọt vào
     * câu UPDATE, và biết workspace để kiểm thư mục đích. Thiếu vế thứ hai thì
     * cả nhóm lọt vào thư mục của workspace khác và BIẾN MẤT khỏi mọi màn hình,
     * kể cả Chung — đúng cái bẫy `thuMucDichDataset` được viết ra để chặn.
     */
    const rows = await datasetsRepo.findWorkspaceOfMany(mysqlPool, tenantId, body.ids);
    if (rows.length !== body.ids.length) {
      // Nói ra CON SỐ. Lựa chọn ở Kho dữ liệu sống qua việc đổi trang và đổi bộ
      // lọc, nên một bộ bị người khác xoá trong lúc đó là chuyện thật — và
      // "không tìm thấy bộ dữ liệu này" (số ít) sẽ khiến người dùng đi tìm
      // nhầm một dòng đang nằm ngay trước mắt.
      throw notFound(
        `Có ${String(body.ids.length - rows.length)} bộ dữ liệu không còn tồn tại. Bỏ chọn rồi chọn lại.`,
      );
    }

    // `ids` tối thiểu một phần tử và số bản ghi vừa khớp với nó, nên `rows`
    // không rỗng — nhánh `undefined` chỉ có mặt để khỏi phải ép kiểu.
    const workspaceId = rows[0]?.workspaceId;
    if (workspaceId === undefined) throw notFound('Không tìm thấy bộ dữ liệu nào.');

    if (rows.some((r) => r.workspaceId !== workspaceId)) {
      /*
       * Không gộp được: thư mục thuộc về đúng một workspace, nên "chuyển cả
       * nhóm vào thư mục X" không có nghĩa khi nhóm trải trên nhiều workspace.
       * Màn hình chỉ bày ra bộ dữ liệu của workspace đang mở, nên tới được đây
       * nghĩa là lựa chọn còn sót lại từ trước lúc đổi workspace.
       */
      throw badRequest(
        'Nhóm đang chọn nằm ở nhiều không gian làm việc khác nhau. Bỏ chọn rồi chọn lại trong một không gian.',
      );
    }

    const folderId = await thuMucDichDataset(tenantId, workspaceId, body.folderId);

    const moved = await datasetsRepo.moveDatasets(mysqlPool, tenantId, body.ids, folderId);
    res.json({ moved });
  }),
);

/**
 * Danh sách thư mục của một workspace, kèm số bộ dữ liệu trong từng cái.
 *
 * KHÔNG trả về "Chung" như một phần tử: nó không phải một bản ghi (xem
 * `folder.ts`), và bịa ra một phần tử mã `0` ở đây là mời client đối xử với nó
 * như một thư mục thật rồi gửi `folderId: 0` lên đường chuyển. Số của Chung đi
 * riêng ở `chungCount`, đúng như bản chất của nó.
 */
v1Router.get(
  '/dataset-folders',
  authorize('dataset', 'read'),
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    const query = workspaceScopeQuerySchema.parse(req.query);
    const workspace = await resolveWorkspace(mysqlPool, tenantId, query.workspaceId);

    const [items, chungCount] = await Promise.all([
      datasetFoldersRepo.listFolders(mysqlPool, tenantId, workspace.id),
      datasetFoldersRepo.countChung(mysqlPool, tenantId, workspace.id),
    ]);

    res.json({ items, chungCount });
  }),
);

v1Router.post(
  '/dataset-folders',
  authorize('dataset', 'modify'),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const query = workspaceScopeQuerySchema.parse(req.query);
    const body = createDatasetFolderBodySchema.parse(req.body);
    const workspace = await resolveWorkspace(mysqlPool, auth.tenantId, query.workspaceId);

    const dang = await datasetFoldersRepo.countFolders(mysqlPool, auth.tenantId, workspace.id);
    if (dang >= MAX_FOLDERS) {
      throw new HttpError(
        409,
        'TooManyFolders',
        `Mỗi workspace tối đa ${String(MAX_FOLDERS)} thư mục.`,
      );
    }

    /*
     * Bắt ER_DUP_ENTRY thay vì SELECT kiểm trước: giữa một câu SELECT và câu
     * INSERT luôn có khe hở cho hai request đồng thời, và người dùng bấm hai
     * lần vì lần đầu chưa thấy gì xảy ra là chuyện thường.
     */
    let id: number;
    try {
      id = await datasetFoldersRepo.createFolder(mysqlPool, auth.tenantId, {
        workspaceId: workspace.id,
        name: body.name,
        createdBy: auth.userId,
      });
    } catch (err) {
      if (datasetFoldersRepo.isDuplicateFolderName(err)) {
        throw new HttpError(409, 'DuplicateName', 'Workspace đã có một thư mục trùng tên.', {
          name: 'Tên này đã được dùng',
        });
      }
      throw err;
    }

    const items = await datasetFoldersRepo.listFolders(mysqlPool, auth.tenantId, workspace.id);
    const created = items.find((f) => f.id === id);
    res.status(201).json(created ?? { id, workspaceId: workspace.id, name: body.name });
  }),
);

v1Router.patch(
  '/dataset-folders/:id',
  authorize('dataset', 'modify'),
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);
    const body = renameDatasetFolderBodySchema.parse(req.body);

    const folder = await datasetFoldersRepo.findFolder(mysqlPool, tenantId, id);
    if (folder === null) throw notFound('Không tìm thấy thư mục này.');

    try {
      await datasetFoldersRepo.renameFolder(mysqlPool, tenantId, id, body.name);
    } catch (err) {
      if (datasetFoldersRepo.isDuplicateFolderName(err)) {
        throw new HttpError(409, 'DuplicateName', 'Workspace đã có một thư mục trùng tên.', {
          name: 'Tên này đã được dùng',
        });
      }
      throw err;
    }

    const items = await datasetFoldersRepo.listFolders(mysqlPool, tenantId, folder.workspaceId);
    res.json(items.find((f) => f.id === id));
  }),
);

/**
 * Xoá một thư mục. Bộ dữ liệu bên trong KHÔNG mất — chúng về Chung.
 *
 * `dataset:modify` chứ không phải `dataset:delete`, và đó không phải sơ suất:
 * không một bộ dữ liệu nào bị xoá ở đây. Khoá ngoại `ON DELETE SET NULL` của
 * migration 39 là thứ bảo đảm điều đó, chứ không phải một câu UPDATE viết thêm
 * ở chỗ này — luật nằm dưới database thì nó còn đúng với mọi đường xoá về sau.
 */
v1Router.delete(
  '/dataset-folders/:id',
  authorize('dataset', 'modify'),
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);

    const affected = await datasetFoldersRepo.deleteFolder(mysqlPool, tenantId, id);
    if (affected === 0) throw notFound('Không tìm thấy thư mục này.');

    res.status(204).end();
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

/**
 * Nạp bộ dữ liệu vào kho phân tích ClickHouse (§9.7).
 *
 * `dataset:modify` chứ không phải một quyền mới: nạp là một thao tác TRÊN bộ dữ
 * liệu, và `creator` đã có quyền đó từ migration 4. Thêm một cặp resource/action
 * chỉ để diễn đạt lại điều đã đúng sẽ làm bảng chính sách phình ra mà không đổi
 * ai làm được gì.
 *
 * Trả về NGAY sau khi xếp hàng — nạp 50.000 dòng mất nhiều phút, và một request
 * treo ngần ấy sẽ bị proxy cắt giữa chừng, để lại một lần nạp không ai biết đã
 * xong hay chưa.
 *
 * KHÔNG gắn `connectionProbeLimit`: endpoint này không mở kết nối tới CSDL của
 * khách hàng trong request (vòng lặp nền mới làm việc đó), và câu 409 khi đã có
 * job chưa xong tự nó đã là một cái phanh.
 */
v1Router.post(
  '/datasets/:id/load',
  authorize('dataset', 'modify'),
  asyncHandler(async (req, res) => {
    const { tenantId, userId } = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);

    res.status(202).json(await queueLoad(tenantId, id, userId));
  }),
);

/**
 * Tiến độ lần nạp gần nhất (§9.6) — giao diện hỏi lại 2 giây một lần khi còn chạy.
 *
 * `dataset:read`, cùng lý do với `/preview`: người được mời vào để ĐỌC báo cáo
 * phải hiểu được vì sao số liệu đang cũ.
 */
v1Router.get(
  '/datasets/:id/load',
  authorize('dataset', 'read'),
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);

    res.json(await getLoadStatus(tenantId, id));
  }),
);

/**
 * Một trang dữ liệu của bảng TRONG KHO — để đối chiếu với tab "Dữ liệu".
 *
 * Không gắn `connectionProbeLimit`: khác `/preview`, endpoint này đọc kho của
 * CHÍNH TA chứ không mở kết nối nào tới máy chủ của khách hàng. Cũng vì thế nó
 * phân trang được thoải mái — mỗi lần bấm "Sau" không đụng gì tới hạ tầng của
 * khách hàng.
 */
v1Router.get(
  '/datasets/:id/load/preview',
  authorize('dataset', 'read'),
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);
    const { page, pageSize } = paginationSchema.parse(req.query);

    res.json(await previewWarehouse(tenantId, id, page, pageSize));
  }),
);

/**
 * Cấu trúc bảng TRONG KHO, đọc từ `system.columns`.
 *
 * Tách khỏi `/load` (tiến độ nạp) vì hai thứ đổi theo nhịp hoàn toàn khác nhau:
 * tiến độ được hỏi lại mỗi 2 giây trong lúc nạp, còn cấu trúc chỉ đổi khi nạp
 * xong. Gộp chung thì mỗi nhịp polling kéo theo một câu truy vấn `system.columns`
 * không ai cần.
 */
v1Router.get(
  '/datasets/:id/load/schema',
  authorize('dataset', 'read'),
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);

    res.json(await warehouseSchema(tenantId, id));
  }),
);

/** Những ô không ép được kiểu trong lần nạp gần nhất (§9.8). */
v1Router.get(
  '/datasets/:id/load/errors',
  authorize('dataset', 'read'),
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);
    const query = listLoadErrorsQuerySchema.parse(req.query);

    const { items, total } = await listLoadErrors(tenantId, id, query.page, query.pageSize);
    res.json(buildPageResult(items, total, query.page, query.pageSize));
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

// ─── §10 Mô hình dữ liệu ─────────────────────────────────────────────────────
//
// Tầng ngữ nghĩa dựng trên kho §9: mô hình không chứa dữ liệu, chỉ chứa lời mô
// tả về những bảng `raw_*` đã nằm sẵn trong ClickHouse. Express đọc mô tả đó để
// SINH RA file cube schema cho Cube.js.
//
// Không route nào ở đây gọi Cube — kể cả route ghi. Sinh file chỉ là ghi đĩa,
// nên người dùng dựng được cả một mô hình khi Cube đang tắt, và nó sẽ chạy ngay
// lúc họ bật Cube lên. Chỉ Explorer (§10.7) mới thật sự cần Cube đang sống.

/**
 * Chốt rằng mô hình tồn tại và thuộc tổ chức người gọi.
 *
 * 404 chứ không 403 cho id của tổ chức khác — cùng quy ước với phần còn lại của
 * router: `findOne` đã lọc `tenant_id` nên id lạ cho ra `null`, và 403 sẽ xác
 * nhận rằng id đó có tồn tại.
 */
async function requireDataModel(tenantId: number, id: number): Promise<DataModelDto> {
  const found = await datamodelsRepo.findOne(mysqlPool, tenantId, id);
  if (!found) throw notFound('Không tìm thấy mô hình dữ liệu này.');
  return found;
}

v1Router.get(
  '/datamodels',
  authorize('datamodel', 'read'),
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    const query = listDataModelsQuerySchema.parse(req.query);

    const sort = resolveSortColumn(query.sort, datamodelsRepo.DATAMODEL_SORT_KEYS, 'updatedAt');
    if (sort === null) {
      throw badRequest('Cột sắp xếp không hợp lệ.', {
        sort: `Chỉ nhận: ${datamodelsRepo.DATAMODEL_SORT_KEYS.join(', ')}`,
      });
    }

    // Thiếu `workspaceId` nghĩa là CẢ TỔ CHỨC — xem ghi chú ở `DataModelFilter`
    // và ở `GET /datasets`, hai chỗ theo cùng một luật. Có gửi thì vẫn giải
    // nghĩa qua `resolveWorkspace` để giữ nguyên lỗi 403 khi workspace bị khoá.
    const workspaceId =
      query.workspaceId === undefined
        ? undefined
        : (await resolveWorkspace(mysqlPool, tenantId, query.workspaceId)).id;

    const filter: datamodelsRepo.DataModelFilter = {
      workspaceId,
      search: query.q,
      sort,
      order: query.order,
      page: query.page,
      pageSize: query.pageSize,
    };

    const total = await datamodelsRepo.count(mysqlPool, tenantId, filter);
    const items = total === 0 ? [] : await datamodelsRepo.list(mysqlPool, tenantId, filter);
    res.json(buildPageResult(items, total, query.page, query.pageSize));
  }),
);

/**
 * §10.2 — tạo mô hình từ một hoặc nhiều bộ dữ liệu.
 *
 * Cấu trúc cột đọc từ CLICKHOUSE chứ không suy từ `dataset_columns`: bảng đó mô
 * tả NGUỒN, còn mô hình dựng trên KHO, và hai thứ đó không giống nhau. Xem
 * `createDataModel.ts`.
 */
v1Router.post(
  '/datamodels',
  authorize('datamodel', 'modify'),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const body = createDataModelBodySchema.parse(req.body);

    const workspace = await resolveWorkspace(mysqlPool, auth.tenantId, body.workspaceId);

    // Trùng id trong danh sách gửi lên sẽ đâm vào UNIQUE (datamodel_id,
    // dataset_id) và cho ra lỗi 500 khó hiểu. Lọc trước, im lặng — người dùng
    // tích hai lần cùng một ô là chuyện của giao diện, không đáng một thông báo.
    const datasetIds = [...new Set(body.datasetIds)];

    const id = await createDataModel({
      tenantId: auth.tenantId,
      workspaceId: workspace.id,
      name: body.name,
      description: body.description ?? null,
      datasetIds,
      createdBy: auth.userId,
    });

    // SAU khi transaction đã commit, không phải bên trong — file trên đĩa mà bị
    // rollback thì Cube đọc một mô hình database không có.
    await regenerateTenant(auth.tenantId);

    res.status(201).json(await datamodelsRepo.findOne(mysqlPool, auth.tenantId, id));
  }),
);

v1Router.get(
  '/datamodels/:id',
  authorize('datamodel', 'read'),
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);
    res.json(await readDataModelDetail(tenantId, id));
  }),
);

v1Router.patch(
  '/datamodels/:id',
  authorize('datamodel', 'modify'),
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);
    const body = updateDataModelBodySchema.parse(req.body);

    const affected = await datamodelsRepo.update(mysqlPool, tenantId, id, {
      name: body.name,
      description: body.description ?? null,
    });
    if (affected === 0) throw notFound('Không tìm thấy mô hình dữ liệu này.');

    // Đổi tên cũng phải sinh lại: tên bảng và alias đi vào `title:` của file cube.
    await regenerateTenant(tenantId);

    res.json(await datamodelsRepo.findOne(mysqlPool, tenantId, id));
  }),
);

v1Router.delete(
  '/datamodels/:id',
  authorize('datamodel', 'delete'),
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);

    const affected = await datamodelsRepo.softDelete(mysqlPool, tenantId, id);
    if (affected === 0) throw notFound('Không tìm thấy mô hình dữ liệu này.');

    // `regenerateTenant` làm việc theo lối đối chiếu, nên file của mô hình vừa
    // xoá biến mất mà không cần một đường xoá file riêng để mà quên gọi.
    await regenerateTenant(tenantId);

    res.status(204).end();
  }),
);

v1Router.post(
  '/datamodels/:id/datasets',
  authorize('datamodel', 'modify'),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);
    const body = addDatasetsBodySchema.parse(req.body);

    await requireDataModel(auth.tenantId, id);
    await addDatasets(auth.tenantId, id, [...new Set(body.datasetIds)], auth.userId);
    await regenerateTenant(auth.tenantId);

    res.json(await readDataModelDetail(auth.tenantId, id));
  }),
);

/**
 * Sửa mô tả của một BẢNG trong mô hình — §10.3: tên hiển thị, mô tả, khoá chính.
 *
 * Trả kèm CẢNH BÁO chứ không chặn khi cột khoá có giá trị trùng. Xem
 * `primaryKeyCheck.ts` — cùng lý lẽ với cảnh báo lúc lưu quan hệ.
 */
v1Router.patch(
  '/datamodels/:id/datasets/:refId',
  authorize('datamodel', 'modify'),
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);
    const refId = Number(req.params['refId']);
    if (!Number.isInteger(refId) || refId <= 0) throw badRequest('Mã không hợp lệ.');

    const body = updateModelDatasetBodySchema.parse(req.body);
    await requireDataModel(tenantId, id);

    const dataset = (await datamodelsRepo.listDatasets(mysqlPool, tenantId, id)).find(
      (row) => Number(row.id) === refId,
    );
    if (dataset === undefined) throw notFound('Bộ dữ liệu này không có trong mô hình.');

    // Cột khoá phải thuộc ĐÚNG bảng này. Đây là chỗ giữ cách ly tổ chức cho
    // `primary_column_id`, vì khoá ngoại của nó chỉ có một cột — xem migration 12.
    let primaryColumnName: string | null = null;
    if (body.primaryColumnId !== null && body.primaryColumnId !== undefined) {
      const column = await datamodelsRepo.findColumnInDataset(
        mysqlPool,
        tenantId,
        id,
        refId,
        body.primaryColumnId,
      );
      if (column === null) throw badRequest('Cột khoá chính không thuộc bảng này.');
      primaryColumnName = column.columnName;
    }

    /*
     * `undefined` = KHÔNG ĐỤNG TỚI, `null` = xoá trống.
     *
     * Hai hộp thoại gửi hai tập trường khác nhau ("Đặt khoá chính" chỉ gửi
     * `primaryColumnId`; "Sửa" chỉ gửi tên và mô tả). Ghi đè cả ba bằng giá trị
     * nhận được sẽ khiến hộp thoại này lặng lẽ xoá trắng thứ hộp thoại kia vừa
     * lưu — một lỗi không có thông báo nào và chỉ lộ ra khi người dùng quay lại
     * nhìn.
     */
    const keep = <T>(sent: T | undefined, current: T): T => (sent === undefined ? current : sent);
    const blankToNull = (value: string | null): string | null =>
      value === null || value.trim() === '' ? null : value;

    await datamodelsRepo.updateDataset(mysqlPool, tenantId, id, refId, {
      displayName: blankToNull(keep(body.displayName, dataset.display_name)),
      description: blankToNull(keep(body.description, dataset.description)),
      primaryColumnId: keep(
        body.primaryColumnId,
        dataset.primary_column_id === null ? null : Number(dataset.primary_column_id),
      ),
    });

    await datamodelsRepo.touch(mysqlPool, tenantId, id);
    // Tên hiển thị đi vào `title:` của file cube, nên phải sinh lại.
    await regenerateTenant(tenantId);

    // Đối chiếu với dữ liệu THẬT trong kho. Kho tắt hoặc bảng chưa nạp thì bỏ
    // qua phần cảnh báo — không để một lần kiểm không chạy được làm hỏng cả thao
    // tác lưu, vì cảnh báo là thông tin thêm chứ không phải điều kiện.
    let warning: PrimaryKeyWarningDto | null = null;
    if (primaryColumnName !== null) {
      try {
        warning = await checkPrimaryKey(tenantId, Number(dataset.dataset_id), primaryColumnName);
      } catch {
        warning = null;
      }
    }

    res.json({ dataModel: await readDataModelDetail(tenantId, id), warning });
  }),
);

v1Router.delete(
  '/datamodels/:id/datasets/:refId',
  authorize('datamodel', 'modify'),
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);
    const refId = Number(req.params['refId']);
    if (!Number.isInteger(refId) || refId <= 0) throw badRequest('Mã không hợp lệ.');

    await requireDataModel(tenantId, id);

    // Xoá CỨNG: cascade kéo theo cột, thước đo và quan hệ trỏ vào bộ dữ liệu
    // này. Xoá mềm sẽ để lại thước đo mồ côi mà bộ sinh schema vẫn đem đi sinh,
    // trỏ vào một cube không còn tồn tại.
    const affected = await datamodelsRepo.removeDataset(mysqlPool, tenantId, refId);
    if (affected === 0) throw notFound('Bộ dữ liệu này không có trong mô hình.');

    await datamodelsRepo.touch(mysqlPool, tenantId, id);
    await regenerateTenant(tenantId);
    res.status(204).end();
  }),
);

/**
 * Vị trí thẻ trên canvas.
 *
 * CỐ Ý không gọi `touch`: kéo một cái hộp không phải thay đổi ngữ nghĩa, và bắt
 * Cube biên dịch lại schema vì chuyện đó là phí. Đây là route ghi DUY NHẤT của
 * §10 không đụng tới `updated_at`.
 */
v1Router.patch(
  '/datamodels/:id/layout',
  authorize('datamodel', 'modify'),
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);
    const body = saveLayoutBodySchema.parse(req.body);

    await requireDataModel(tenantId, id);
    await datamodelsRepo.saveLayout(mysqlPool, tenantId, body.positions);
    res.status(204).end();
  }),
);

/**
 * §10.3 — cấu trúc THẬT của kho, đối chiếu với những gì mô hình đang khai.
 *
 * Đọc lại `system.columns` cho từng bảng thay vì tin `ch_type` đã lưu. Nạp lại
 * một bộ dữ liệu có thể biến `Int64` thành `String`, và khi đó một thước đo
 * `sum()` dựng trên cột đó đang chạy trên văn bản — giao diện phải nói ra chứ
 * không để người dùng tự phát hiện qua một con số lạ.
 *
 * Đây là route DUY NHẤT của §10 gọi sang ClickHouse cho mỗi bảng, nên nó nằm
 * riêng chứ không gộp vào `GET /datamodels/:id` vốn được gọi mỗi lần đổi tab.
 */
v1Router.get(
  '/datamodels/:id/schema',
  authorize('datamodel', 'read'),
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);
    res.json(await readModelSchema(tenantId, id));
  }),
);

v1Router.patch(
  '/datamodels/:id/schema',
  authorize('datamodel', 'modify'),
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);
    const body = saveSchemaBodySchema.parse(req.body);
    const auth = requireAuth(req);

    await requireDataModel(tenantId, id);

    // Cột và thước đo đi trong CÙNG một giao dịch: đổi tên hiển thị của cột
    // cũng đổi tên thước đo dựng trên nó, nên lưu được nửa này mà hỏng nửa kia
    // để lại một thước đo mang tên cũ của một cột đã đổi tên.
    await withTransaction(async (conn) => {
      for (const column of body.columns) {
        const affected = await datamodelsRepo.updateColumn(conn, tenantId, id, {
          columnId: column.columnId,
          // Alias trùng tên cột gốc thì lưu `null`: giữ `null` nghĩa là cột đổi
          // tên ở nguồn sẽ kéo theo nhãn hiển thị, thay vì đóng băng một bản chép.
          alias: column.alias === null || column.alias === '' ? null : column.alias,
          role: column.role,
        });
        // Id không thuộc mô hình này -> 0 dòng. Từ chối cả lô thay vì lưu một
        // phần: người dùng bấm Lưu một lần và phải nhận một kết quả duy nhất.
        if (affected === 0) throw badRequest('Có cột không thuộc mô hình này.');
      }

      // Chỉ những cột CÓ nói gì về thước đo. Vắng mặt `measureAgg` nghĩa là
      // "đừng đụng tới", khác hẳn `null` nghĩa là "bỏ đi".
      await applyColumnMeasures(
        conn,
        tenantId,
        id,
        auth.userId,
        body.columns
          .filter((c) => c.measureAgg !== undefined)
          .map((c) => ({ columnId: c.columnId, measureAgg: c.measureAgg ?? null })),
      );
    });

    await datamodelsRepo.touch(mysqlPool, tenantId, id);
    await regenerateTenant(tenantId);

    res.json(await readModelSchema(tenantId, id));
  }),
);

// ─── §10.6 Thước đo ──────────────────────────────────────────────────────────

v1Router.get(
  '/datamodels/:id/measures',
  authorize('datamodel', 'read'),
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);
    await requireDataModel(tenantId, id);
    res.json(await datamodelsRepo.listMeasures(mysqlPool, tenantId, id));
  }),
);

/**
 * `count` là đếm DÒNG, nên nó KHÔNG có cột.
 *
 * Ràng buộc này cưỡng chế ở đây chứ không bằng CHECK trong database: MySQL 8 có
 * hỗ trợ CHECK nhưng thông báo lỗi của nó không dịch được sang một câu người
 * dùng đọc hiểu.
 */
function validateMeasure(agg: string, columnId: number | undefined): number | null {
  if (agg === 'count') {
    if (columnId !== undefined) {
      throw badRequest('Phép đếm dòng không cần chọn cột.', {
        columnId: 'Bỏ trống khi phép tính là "Đếm dòng"',
      });
    }
    return null;
  }

  if (columnId === undefined) {
    throw badRequest('Hãy chọn cột để đo.', {
      columnId: 'Bắt buộc khi phép tính không phải "Đếm dòng"',
    });
  }
  return columnId;
}

v1Router.post(
  '/datamodels/:id/measures',
  authorize('datamodel', 'modify'),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);
    const body = createMeasureBodySchema.parse(req.body);

    await requireDataModel(auth.tenantId, id);
    const columnId = validateMeasure(body.agg, body.columnId);

    // Cột phải THUỘC mô hình này, và kiểu của nó phải nhận được phép gộp.
    //
    // `createMeasure` chỉ chèn một dòng, nó không tra gì cả — nên không có đoạn
    // này thì một `columnId` của mô hình khác đi thẳng vào bảng, và file cube
    // sinh ra tham chiếu một cột không có trong cube đó. Cùng lúc, đây là chỗ
    // duy nhất còn lại tạo được `sum` trên cột chữ.
    if (columnId !== null) {
      const column = (await datamodelsRepo.listColumns(mysqlPool, auth.tenantId, id)).find(
        (c) => Number(c.id) === columnId,
      );
      if (column === undefined) throw badRequest('Cột này không thuộc mô hình đang mở.');
      assertAggFitsColumn(column, body.agg);
    }

    try {
      const measureId = await datamodelsRepo.createMeasure(mysqlPool, auth.tenantId, {
        dataModelId: id,
        datamodelDatasetId: body.datamodelDatasetId,
        columnId,
        name: body.name,
        agg: body.agg,
        createdBy: auth.userId,
      });
      await datamodelsRepo.touch(mysqlPool, auth.tenantId, id);
      await regenerateTenant(auth.tenantId);

      const created = (await datamodelsRepo.listMeasures(mysqlPool, auth.tenantId, id)).find(
        (m) => m.id === measureId,
      );
      res.status(201).json(created);
    } catch (err) {
      throw asDuplicateMeasureName(err);
    }
  }),
);

v1Router.patch(
  '/datamodels/:id/measures/:measureId',
  authorize('datamodel', 'modify'),
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);
    const measureId = Number(req.params['measureId']);
    if (!Number.isInteger(measureId) || measureId <= 0) throw badRequest('Mã không hợp lệ.');

    const body = updateMeasureBodySchema.parse(req.body);
    await requireDataModel(tenantId, id);
    const columnId = validateMeasure(body.agg, body.columnId);

    try {
      const affected = await datamodelsRepo.updateMeasure(mysqlPool, tenantId, id, measureId, {
        name: body.name,
        agg: body.agg,
        columnId,
      });
      if (affected === 0) throw notFound('Không tìm thấy thước đo này.');

      await datamodelsRepo.touch(mysqlPool, tenantId, id);
      await regenerateTenant(tenantId);

      res.json(
        (await datamodelsRepo.listMeasures(mysqlPool, tenantId, id)).find(
          (m) => m.id === measureId,
        ),
      );
    } catch (err) {
      throw asDuplicateMeasureName(err);
    }
  }),
);

v1Router.delete(
  '/datamodels/:id/measures/:measureId',
  authorize('datamodel', 'modify'),
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);
    const measureId = Number(req.params['measureId']);
    if (!Number.isInteger(measureId) || measureId <= 0) throw badRequest('Mã không hợp lệ.');

    await requireDataModel(tenantId, id);
    // Qua `deleteMeasure` chứ không gọi thẳng repo: nó chặn việc xoá một thước
    // đo đang là vế của công thức khác, thứ sẽ làm Cube hỏng biên dịch và kéo
    // sập cả tab Explorer.
    const affected = await deleteMeasure(tenantId, id, measureId);
    if (affected === 0) throw notFound('Không tìm thấy thước đo này.');

    await datamodelsRepo.touch(mysqlPool, tenantId, id);
    await regenerateTenant(tenantId);
    res.status(204).end();
  }),
);

/**
 * §10.6 — thước đo TÍNH TOÁN.
 *
 * Route riêng chứ không thêm nhánh vào `POST /measures`: hai loại thước đo nhận
 * hai bộ đầu vào không giao nhau (một bên là bảng + cột + phép gộp, một bên là
 * hai id + phép + định dạng). Gộp lại sẽ thành một schema toàn trường tuỳ chọn,
 * và mọi ràng buộc phải tự kiểm bằng tay thay vì để zod chặn.
 */
v1Router.post(
  '/datamodels/:id/measures/formula',
  authorize('datamodel', 'modify'),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);
    const body = createFormulaMeasureBodySchema.parse(req.body);

    await requireDataModel(auth.tenantId, id);

    // Bọc như hai route thước đo thường: câu kiểm trùng tên trong `services`
    // chạy TRƯỚC lệnh ghi, nên hai request đồng thời vẫn lọt qua được cả hai và
    // để ràng buộc UNIQUE bắt. Không bọc thì khe hở đó ra HTTP 500.
    try {
      const measureId = await createFormulaMeasure(auth.tenantId, id, auth.userId, body);

      await datamodelsRepo.touch(mysqlPool, auth.tenantId, id);
      await regenerateTenant(auth.tenantId);

      res
        .status(201)
        .json(
          (await datamodelsRepo.listMeasures(mysqlPool, auth.tenantId, id)).find(
            (m) => m.id === measureId,
          ),
        );
    } catch (err) {
      throw asDuplicateMeasureName(err);
    }
  }),
);

/**
 * Thước đo gộp trên BIỂU THỨC DÒNG — `sum(Số lượng × Đơn giá)`.
 *
 * Route thứ ba chứ không thêm nhánh vào hai route trên, cùng lý lẽ: ba loại
 * thước đo nhận ba bộ đầu vào không giao nhau. Ở đây là hai ID CỘT, một phép
 * nối và một phép gộp — khác hẳn `formula` vốn nhận hai ID THƯỚC ĐO.
 */
v1Router.post(
  '/datamodels/:id/measures/row-expr',
  authorize('datamodel', 'modify'),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);
    const body = createRowExprMeasureBodySchema.parse(req.body);

    await requireDataModel(auth.tenantId, id);

    try {
      const measureId = await createRowExprMeasure(auth.tenantId, id, auth.userId, body);

      await datamodelsRepo.touch(mysqlPool, auth.tenantId, id);
      await regenerateTenant(auth.tenantId);

      res
        .status(201)
        .json(
          (await datamodelsRepo.listMeasures(mysqlPool, auth.tenantId, id)).find(
            (m) => m.id === measureId,
          ),
        );
    } catch (err) {
      throw asDuplicateMeasureName(err);
    }
  }),
);

// ─── §10.4, §10.5 Quan hệ ────────────────────────────────────────────────────

v1Router.get(
  '/datamodels/:id/relationships',
  authorize('datamodel', 'read'),
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);
    await requireDataModel(tenantId, id);
    res.json(await datamodelsRepo.listRelationships(mysqlPool, tenantId, id));
  }),
);

v1Router.post(
  '/datamodels/:id/relationships',
  authorize('datamodel', 'modify'),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);
    const body = createRelationshipBodySchema.parse(req.body);

    await requireDataModel(auth.tenantId, id);
    const result = await createRelationship(auth.tenantId, id, auth.userId, body);
    await regenerateTenant(auth.tenantId);

    // Trả kèm CẢNH BÁO chứ không chỉ bản ghi: khoá trùng ở phía "một" làm mọi
    // phép tổng sau khi nối lớn hơn sự thật, và không ai phát hiện được điều đó
    // từ con số. Giao diện phải hiện nó ngay lúc lưu.
    res.status(201).json(result);
  }),
);

v1Router.delete(
  '/datamodels/:id/relationships/:relId',
  authorize('datamodel', 'modify'),
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);
    const relId = Number(req.params['relId']);
    if (!Number.isInteger(relId) || relId <= 0) throw badRequest('Mã không hợp lệ.');

    await requireDataModel(tenantId, id);
    const affected = await datamodelsRepo.softDeleteRelationship(mysqlPool, tenantId, id, relId);
    if (affected === 0) throw notFound('Không tìm thấy quan hệ này.');

    await datamodelsRepo.touch(mysqlPool, tenantId, id);
    await regenerateTenant(tenantId);
    res.status(204).end();
  }),
);

/**
 * Trùng tên thước đo trong cùng mô hình -> 409 gắn đúng ô `name`.
 *
 * Bắt ở ràng buộc UNIQUE chứ không SELECT kiểm trước — cùng lý do với
 * `asDuplicateName` của kết nối: giữa SELECT và INSERT luôn có khe hở cho hai
 * request đồng thời.
 */
function asDuplicateMeasureName(err: unknown): unknown {
  if (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: string }).code === 'ER_DUP_ENTRY' &&
    String((err as { message?: string }).message ?? '').includes('uq_datamodel_measures')
  ) {
    return new HttpError(409, 'DuplicateName', 'Mô hình đã có một thước đo trùng tên.', {
      name: 'Tên này đã được dùng',
    });
  }
  return err;
}

/**
 * Mô hình kèm cấu trúc ĐỌC LẠI từ ClickHouse — §10.3.
 *
 * Khác `readDataModelDetail` ở đúng một chỗ, và đó là chỗ quan trọng: hàm này
 * hỏi kho, còn hàm kia đọc `ch_type` đã lưu. So hai bên là cách duy nhất phát
 * hiện một bộ dữ liệu được nạp lại đã làm đổi kiểu cột — và khi kiểu đổi thì
 * một thước đo `sum()` có thể đang chạy trên văn bản.
 *
 * Kiểu mới được ĐỒNG BỘ vào `ch_type` ngay tại đây, nên lần mở sau không còn
 * báo lệch nữa. Người dùng thấy cảnh báo đúng một lần, ở đúng lúc nó có nghĩa.
 */
async function readModelSchema(tenantId: number, id: number): Promise<DataModelDetailDto> {
  const detail = await readDataModelDetail(tenantId, id);

  for (const dataset of detail.datasets) {
    let live;
    try {
      live = await warehouseSchema(tenantId, dataset.datasetId);
    } catch {
      // Bảng chưa nạp hoặc kho đang tắt. Không làm hỏng cả trang vì một bảng —
      // giữ nguyên thông tin đã lưu và đi tiếp.
      continue;
    }

    const liveTypes = new Map(live.columns.map((c) => [c.name, c.type]));

    for (const column of dataset.columns) {
      const actual = liveTypes.get(column.columnName);
      if (actual === undefined || actual === column.chType) continue;

      column.typeChanged = true;
      column.chType = actual;
      column.cubeType = cubeTypeOf(actual);
      await datamodelsRepo.syncColumnType(mysqlPool, tenantId, column.id, actual);
    }
  }

  return detail;
}

/** Bộ chọn của Explorer — §10.7. Một request thay cho việc ghép hai nguồn. */
v1Router.get(
  '/datamodels/:id/fields',
  authorize('datamodel', 'read'),
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);
    res.json(await explorerFields(tenantId, id));
  }),
);

/**
 * Cube.js có đang chạy không — §10.7.
 *
 * Tách khỏi truy vấn để tab Explorer nói được "chạy lệnh này" NGAY khi mở, thay
 * vì bắt người dùng chọn trường rồi bấm Chạy mới biết Cube đang tắt.
 *
 * Ba tab còn lại (Schemas, Quan hệ, Thước đo) KHÔNG cần Cube — chúng chỉ đọc
 * MySQL và ClickHouse. Giao diện phải nói ra điều đó, vì "cái gì vẫn dùng được"
 * đáng giá đúng bằng "lệnh nào phải chạy".
 */
v1Router.get(
  '/datamodels/:id/explorer-status',
  authorize('datamodel', 'read'),
  asyncHandler(async (req, res) => {
    const { tenantId } = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);
    await requireDataModel(tenantId, id);

    res.json({
      cubeReady: await pingCube(),
      command: 'npm run infra:up:bi',
    });
  }),
);

/**
 * §10.7 — truy vấn qua Cube.js.
 *
 * `datamodel:read`, không phải `modify`: hỏi dữ liệu là việc của người phân
 * tích, mà `viewer` chính là vai trò đó. Gác bằng `modify` sẽ khiến người được
 * mời vào để ĐỌC báo cáo lại không tự khám phá được dữ liệu nằm dưới nó.
 *
 * Đặt dưới `/datamodels/:id/` chứ không phải `POST /v1/query` ở gốc như README
 * dự kiến: mọi truy vấn đều thuộc về đúng một mô hình, và có `:id` trên đường
 * dẫn nghĩa là quyền sở hữu được kiểm trước khi đọc body.
 */
v1Router.post(
  '/datamodels/:id/query',
  authorize('datamodel', 'read'),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);
    const body = explorerQueryBodySchema.parse(req.body);

    res.json(await runExplorerQuery(auth.tenantId, auth.userId, id, body));
  }),
);

/**
 * §10.7 — câu lệnh Cube SẼ chạy cho truy vấn này, không chạy nó.
 *
 * Cùng quyền `datamodel:read` với chính truy vấn đó: nó không lộ thêm dữ liệu
 * nào, chỉ lộ tên bảng vật lý và tên cột của mô hình người dùng đang mở — đúng
 * những thứ tab Schemas đã hiện sẵn ở cột "Bảng vật lý".
 *
 * Nhận CÙNG body với `/query` để hai đường không thể lệch nhau: câu lệnh hiện ra
 * phải là câu lệnh thật, nếu không màn này còn hại hơn không có.
 */
v1Router.post(
  '/datamodels/:id/query/sql',
  authorize('datamodel', 'read'),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);
    const body = explorerQueryBodySchema.parse(req.body);

    res.json(await explainExplorerQuery(auth.tenantId, auth.userId, id, body));
  }),
);

// ─── §11 Gói dịch vụ & thanh toán ────────────────────────────────────────────

/**
 * Bảng giá.
 *
 * Gác `billing:read` chứ không để công khai: hạn mức của từng gói là thông tin
 * thương mại, và trang này chỉ có nghĩa với người đã đăng nhập. Ngày nào cần
 * một trang giá công khai cho khách chưa có tài khoản thì đó là một route khác
 * ở ngoài `/v1`, không phải nới quyền route này.
 *
 * KHÔNG phân trang: ba gói, và một bảng giá phải nhìn thấy hết trong một màn.
 */
v1Router.get(
  '/plans',
  authorize('billing', 'read'),
  asyncHandler(async (_req, res) => {
    res.json(await billingRepo.listPublicPlans(mysqlPool));
  }),
);

/** Phương thức thanh toán đang bật. Giao diện Checkout đọc cái này. */
v1Router.get(
  '/payment-methods',
  authorize('billing', 'read'),
  asyncHandler(async (_req, res) => {
    res.json(await billingRepo.listActivePaymentMethods(mysqlPool));
  }),
);

/**
 * Ảnh mã QR TĨNH của một phương thức (MoMo) — §11 mục 3.2.
 *
 * ─── Vì sao ảnh đi qua Express thay vì một URL công khai ───────────────────
 *
 * MinIO nằm trong mạng Docker nội bộ và cố ý KHÔNG publish ra ngoài, nên trình
 * duyệt không nói chuyện với nó được. Còn presigned GET thì đưa ra một URL sống
 * vài phút mà ai cầm cũng mở được — với một ảnh QR nhận tiền thì không có lý do
 * gì để nới ra như vậy.
 *
 * Ảnh nặng vài chục KB và tải một lần cho mỗi lần mở màn thanh toán. Cho nó đi
 * qua Node là cái giá đúng để đổi lấy việc nó vẫn nằm sau lớp xác thực.
 *
 * ⚠️ Khoá lấy từ DATABASE, không từ URL. Nhận khoá từ client là cho người ta
 * đọc bất kỳ object nào trong bucket — kể cả file dữ liệu của tổ chức khác.
 */
v1Router.get(
  '/payment-methods/:id/qr',
  authorize('billing', 'read'),
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);

    const key = await billingRepo.qrObjectKey(mysqlPool, id);
    if (key === null) throw notFound('Phương thức này không có mã QR tĩnh.');

    // Chuỗi trong database phải đúng khuôn ta tự sinh. Một giá trị lạ ở đó
    // nghĩa là dữ liệu đã bị can thiệp, và mang nó đi đọc object là đúng thứ
    // ta vừa từ chối làm với tham số URL.
    if (!isQrKey(key)) throw notFound('Mã QR của phương thức này không đọc được.');

    const bytes = await storage.getObject(key);

    res.setHeader('Content-Type', key.endsWith('.png') ? 'image/png' : 'image/jpeg');
    // Ảnh gắn với một KHOÁ bất biến (uuid mới mỗi lần tải lên), nên cache lâu
    // là an toàn: đổi ảnh nghĩa là đổi khoá, và trình duyệt sẽ hỏi lại vì DTO
    // trả về một đường dẫn... trỏ tới cùng id. Nên `private` + thời hạn ngắn:
    // đủ để không tải lại mỗi giây khi người dùng chờ thanh toán, đủ ngắn để
    // người vận hành đổi ảnh xong thấy hiệu lực trong vòng vài phút.
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(bytes);
  }),
);

/**
 * Toàn bộ trang Billing trong MỘT lần gọi: gói, hạn dùng, mức sử dụng.
 *
 * Gộp ba thứ thay vì ba endpoint vì chúng luôn hiện cùng nhau và luôn phải nhất
 * quán với nhau — ba lần gọi rời nghĩa là ba ảnh chụp ở ba thời điểm, và thanh
 * mức sử dụng có thể vẽ theo hạn mức của một gói vừa đổi.
 */
v1Router.get(
  '/billing/me',
  authorize('billing', 'read'),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    res.json(await buildBillingSummary(mysqlPool, auth.tenantId, new Date()));
  }),
);

/**
 * Gói của tổ chức đang mở, như MỌI THÀNH VIÊN thấy — kể cả creator và viewer.
 *
 * Gói gắn với tổ chức: quản trị viên mua thì mọi thành viên cùng được hưởng hạn
 * mức đó. Nhưng tới bản này chỉ admin THẤY điều đó — `/billing/me` gác bằng
 * `billing:read`, và huy hiệu gói ẩn với người còn lại. Một creator ở tổ chức
 * gói Doanh nghiệp nhìn sidebar không thấy gói nào, và không biết vì sao lúc tạo
 * báo cáo thứ tư ở không gian cá nhân thì bị chặn còn ở công ty thì không.
 *
 * KHÔNG gác `billing:read` — đó là quyền QUẢN LÝ thanh toán. Đây chỉ trả thứ
 * thành viên cần để biết mình được làm gì: tên gói, hạn dùng, mức sử dụng. Giá,
 * lịch sử đơn và nguồn cấp gói vẫn chỉ ở `/billing/me`.
 */
v1Router.get(
  '/billing/plan',
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    res.json(await buildTenantPlan(mysqlPool, auth.tenantId, new Date()));
  }),
);

v1Router.get(
  '/billing/subscriptions',
  authorize('billing', 'read'),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    // Trần 50: đây là lịch sử để đọc, không phải dữ liệu để phân trang. Một tổ
    // chức mua hằng tháng suốt bốn năm cũng chưa chạm tới.
    res.json(await billingRepo.listSubscriptionHistory(mysqlPool, auth.tenantId, 50));
  }),
);

/**
 * Tạo đơn — §11.
 *
 * `billing:modify` chứ không `read`: đây là thao tác cam kết tiền bạc. Chỉ vai
 * trò `admin` của tổ chức có ô này (xem `DEFAULT_POLICY`), đúng ý — creator
 * không nên tự mua gói cho công ty.
 *
 * Giới hạn nhịp vì mỗi lần gọi sinh một mã QR và một dòng chờ thanh toán. Bó
 * theo IP như mọi bộ giới hạn khác của repo; 20 đơn trong 10 phút là rộng rãi
 * cho người dùng thật và chật cho một vòng lặp.
 */
v1Router.post(
  '/orders',
  authorize('billing', 'modify'),
  rateLimit({ bucket: 'billing-order', max: 20, windowSeconds: 600 }),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const body = createOrderBodySchema.parse(req.body);

    const order = await createOrder({
      tenantId: auth.tenantId,
      userId: auth.userId,
      planId: body.planId,
      paymentMethodId: body.paymentMethodId,
      cycle: body.cycle,
    });

    res.status(201).json(order);
  }),
);

v1Router.get(
  '/orders',
  authorize('billing', 'read'),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const query = listOrdersQuerySchema.parse(req.query);

    const sort = resolveSortColumn(query.sort, billingRepo.ORDER_SORT_KEYS, 'createdAt');
    if (sort === null) {
      throw badRequest('Cột sắp xếp không hợp lệ.', {
        sort: `Chỉ nhận: ${billingRepo.ORDER_SORT_KEYS.join(', ')}`,
      });
    }

    // Kiểm lười trước khi đọc: con cron chạy mỗi vài phút, nên không có dòng
    // này thì danh sách hiện "đang chờ thanh toán" cho một đơn đã quá hạn.
    await billingRepo.expireOverdueOrders(mysqlPool, new Date(), auth.tenantId);

    const filter: billingRepo.OrderFilter = {
      status: query.status,
      sort,
      order: query.order,
      page: query.page,
      pageSize: query.pageSize,
    };

    const total = await billingRepo.countOrders(mysqlPool, auth.tenantId, filter);
    const items = await billingRepo.listOrders(mysqlPool, auth.tenantId, filter);

    res.json(buildPageResult(items, total, query.page, query.pageSize));
  }),
);

v1Router.get(
  '/orders/:code',
  authorize('billing', 'read'),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const { code } = orderCodeParamSchema.parse(req.params);

    await billingRepo.expireOverdueOrders(mysqlPool, new Date(), auth.tenantId);

    const order = await billingRepo.findOrderByCode(mysqlPool, auth.tenantId, code);
    // 404 cho đơn của tổ chức khác, KHÔNG phải 403 — cùng quy ước với cả repo.
    // 403 là một lời xác nhận rằng mã đó có tồn tại.
    if (order === null) {
      throw new HttpError(404, BILLING_ERROR_CODES.ORDER_NOT_FOUND, 'Không tìm thấy đơn hàng này.');
    }

    res.json(order);
  }),
);

/**
 * Endpoint dành riêng cho việc HỎI LẠI mỗi ba giây.
 *
 * ─── Vì sao không dùng luôn `GET /orders/:code` ─────────────────────────────
 *
 * Vì cái kia JOIN sang `payment_methods` và trả về cả chuỗi QR — vài trăm byte
 * mỗi lần, nhân với một request mỗi ba giây, nhân với số người đang mở màn hình
 * thanh toán. Ở đây chỉ cần đúng một câu hỏi: trả tiền xong chưa.
 *
 * Giao diện dừng hỏi khi trạng thái rời khỏi `ORDER_STATUSES_LIVE` — danh sách
 * đó ở `@bi/shared` để hai bên không bao giờ nói hai đằng.
 */
v1Router.get(
  '/orders/:code/status',
  authorize('billing', 'read'),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const { code } = orderCodeParamSchema.parse(req.params);

    await billingRepo.expireOverdueOrders(mysqlPool, new Date(), auth.tenantId);

    const order = await billingRepo.findOrderByCode(mysqlPool, auth.tenantId, code);
    if (order === null) {
      throw new HttpError(404, BILLING_ERROR_CODES.ORDER_NOT_FOUND, 'Không tìm thấy đơn hàng này.');
    }

    res.json({
      orderCode: order.orderCode,
      status: order.status,
      paidAt: order.paidAt,
      expiresAt: order.expiresAt,
    });
  }),
);

/**
 * Khách tự huỷ đơn còn đang chờ.
 *
 * `cancelled` chứ không `failed` — hai chuyện khác hẳn nhau, xem ghi chú ở
 * `ORDER_STATUSES`. Chỉ huỷ được đơn `pending`: một đơn đã trả tiền mà huỷ được
 * là đường ngắn nhất tới việc mất dấu một khoản tiền đã vào tài khoản.
 */
v1Router.post(
  '/orders/:code/cancel',
  authorize('billing', 'modify'),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const { code } = orderCodeParamSchema.parse(req.params);

    const affected = await billingRepo.cancelOrder(mysqlPool, auth.tenantId, code);
    if (affected === 0) {
      // Không phân biệt "không có đơn" với "đơn không còn chờ": cả hai đều dẫn
      // tới cùng một việc người dùng phải làm là tải lại danh sách.
      const order = await billingRepo.findOrderByCode(mysqlPool, auth.tenantId, code);
      throw order === null
        ? new HttpError(404, BILLING_ERROR_CODES.ORDER_NOT_FOUND, 'Không tìm thấy đơn hàng này.')
        : new HttpError(
            409,
            BILLING_ERROR_CODES.ORDER_STATE_INVALID,
            `Đơn này đang ở trạng thái "${ORDER_STATUS_LABELS[order.status]}" nên không huỷ được.`,
          );
    }

    res.status(204).end();
  }),
);

/**
 * §10.9 — số liệu XEM TRƯỚC cho trình dựng biểu đồ.
 *
 * ═══ Vì sao không để trình dựng gọi thẳng `/query` ══════════════════════════
 *
 * Nó gọi được: `/query` trả về đủ chiều, thước đo và số. Nhưng hình dạng trả về
 * là một ma trận cột × dòng, còn `GET /reports/:id/data` trả về `ReportDataDto`
 * — nhãn, giá trị, chuỗi, cờ đã cắt. Hai hình dạng nghĩa là hai hàm dựng spec
 * Vega ở frontend, và chúng sẽ trôi khỏi nhau: biểu đồ xem trước đẹp, biểu đồ
 * đã lưu lệch một chi tiết mà không ai ngờ tới cho tới khi bấm Lưu.
 *
 * Endpoint này gọi ĐÚNG `aggregateFromModel` mà báo cáo đã lưu sẽ gọi. Nên thứ
 * người dùng thấy trong trình dựng là thứ họ sẽ thấy sau khi lưu — kể cả dòng
 * "Khác", kể cả thứ tự nhóm, kể cả cách một ô trống được đặt tên.
 *
 * Quyền `datamodel:read` chứ không phải `report:modify`: nó không tạo ra gì cả,
 * nó chỉ đọc mô hình theo một cách khác. Ai mở được tab Explorer thì xem trước
 * được biểu đồ trên cùng dữ liệu đó.
 */
v1Router.post(
  '/datamodels/:id/report-preview',
  authorize('datamodel', 'read'),
  asyncHandler(async (req, res) => {
    const auth = requireAuth(req);
    const { id } = idParamSchema.parse(req.params);
    const body = modelReportPreviewBodySchema.parse(req.body);

    // Kiểm y hệt lúc lưu. Xem trước một cấu hình mà nút Lưu sẽ từ chối là cách
    // chắc chắn nhất để người dùng mất lòng tin vào cả hai nút.
    await assertModelChartConfig(auth.tenantId, id, body.chartType, body.config);

    const data: ReportDataDto = await aggregateFromModel(
      auth.tenantId,
      auth.userId,
      id,
      body.config,
      body.page ?? 0,
    );
    res.json(data);
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
    String((err as { message?: string }).message ?? '').includes('uq_connections_scope_name')
  ) {
    /*
     * Tên chỉ mục đổi ở migration 28 — `uq_connections_tenant_name` thành
     * `uq_connections_scope_name`. Quên sửa chuỗi này thì mọi lần trùng tên rơi
     * xuống bộ xử lý lỗi chung và người dùng nhận "có lỗi phía máy chủ" thay vì
     * một câu chỉ đúng ô cần sửa.
     *
     * Câu chữ cũng đổi theo, vì phạm vi trùng đã khác: tên nay chỉ phải là duy
     * nhất TRONG kho chung, hoặc TRONG những kết nối riêng của chính người đó.
     * Nói "tổ chức đã có một kết nối trùng tên" với một creator vừa gõ trùng
     * tên của chính mình là chỉ họ đi tìm ở sai chỗ.
     */
    return new HttpError(409, 'DuplicateName', 'Bạn đã có một kết nối trùng tên.', {
      name: 'Tên này đã được dùng',
    });
  }
  return err;
}
