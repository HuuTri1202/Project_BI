import {
  AGGREGATES,
  CHART_TYPES,
  DATASET_NAME_MAX,
  DATASET_STATUSES,
  REPORT_NAME_MAX,
  companyNameRule,
  emailRule,
  fullNameRule,
  JOB_TITLES,
} from '@bi/shared';
import { z } from 'zod';
import { paginationSchema } from '../../utils/pagination';

/**
 * Schema request của KHU NGƯỜI DÙNG (Section 04).
 *
 * Ở BACKEND chứ không phải `@bi/shared`, vì `paginationSchema` dùng
 * `z.coerce.number()` — query string luôn là chuỗi nên buộc phải ép kiểu, mà ép
 * kiểu là transform, và luật ghi trong `shared/src/auth.ts` là schema dùng chung
 * chỉ được validate chứ không transform (nếu không thì kiểu input/output của zod
 * lệch nhau và `zodResolver` bắt phải khai `useForm<Input, Ctx, Output>`).
 *
 * Router gọi `.parse()` rồi để `ZodError` bay lên; `errorHandler` có nhánh riêng
 * đổi nó thành 400 kèm map lỗi theo trường.
 *
 * `sort` cố ý để `z.string()` chứ không phải `z.enum(...)`: việc đối chiếu
 * whitelist giao cho `resolveSortColumn` để có thông báo lỗi do ta viết, và để
 * giữ đúng MỘT chỗ quyết định cột nào được đi vào `ORDER BY`.
 */

const tenantRole = z.enum(['admin', 'creator', 'viewer']);

/**
 * Tham số id trên URL.
 *
 * Ép sang số ngay ở đây để mọi so sánh phía sau đúng kiểu — `'3' === 3` là false,
 * và luật chống-tự-sửa-mình dựa vào đúng phép so sánh đó. Lỗi im lặng, và im
 * lặng ở chỗ nguy hiểm nhất.
 */
export const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const userIdParamSchema = z.object({
  userId: z.coerce.number().int().positive(),
});

// ─── Home (§4.3) ─────────────────────────────────────────────────────────────

/**
 * `workspaceId` TUỲ CHỌN.
 *
 * Lần đầu vào hệ thống, trình duyệt chưa nhớ workspace nào cả. Bắt buộc tham số
 * này nghĩa là frontend phải gọi `/workspaces` trước rồi mới gọi được `/home` —
 * hai vòng mạng nối tiếp trên đúng màn hình đầu tiên sau đăng nhập. Thiếu thì
 * backend tự chọn workspace đầu tiên và trả lại nó trong `HomeDataDto.workspace`.
 */
export const homeQuerySchema = z.object({
  workspaceId: z.coerce.number().int().positive().optional(),
});

// ─── Project ─────────────────────────────────────────────────────────────────

export const listProjectsQuerySchema = z.object({
  workspaceId: z.coerce.number().int().positive(),
  q: z.string().trim().max(100).optional(),
  sort: z.string().optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export const createProjectBodySchema = z.object({
  workspaceId: z.coerce.number().int().positive(),
  name: z.string().trim().min(1, 'Tên project không được để trống').max(255),
  description: z.string().trim().max(500).optional(),
});

export const updateProjectBodySchema = z.object({
  name: z.string().trim().min(1, 'Tên project không được để trống').max(255),
  description: z.string().trim().max(500).optional(),
});

// ─── Tổ chức ─────────────────────────────────────────────────────────────────

/**
 * Đổi tên tổ chức.
 *
 * CHỈ có `name`. Không nhận `slug`: xem ghi chú ở `renameTenant`. Không nhận
 * `id` — tổ chức được sửa luôn là tổ chức trong token, và cho client tự khai id
 * là mở đúng cánh cửa mà mọi lớp cách ly tổ chức đang đóng.
 */
export const updateTenantBodySchema = z.object({
  name: companyNameRule.transform((v) => v.trim().replace(/\s+/g, ' ')),
});

// ─── Workspace (§4.5) ────────────────────────────────────────────────────────

/** Tên workspace dùng lại luật tên công ty: cùng ràng buộc, cùng thông báo. */
export const createWorkspaceBodySchema = z.object({
  name: companyNameRule.transform((v) => v.trim().replace(/\s+/g, ' ')),
  description: z.string().trim().max(500).optional(),
});

export const updateWorkspaceBodySchema = createWorkspaceBodySchema;

// ─── Thành viên (§4.7) ───────────────────────────────────────────────────────

export const listMembersQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(100).optional(),
  role: tenantRole.optional(),
  status: z.enum(['active', 'locked', 'removed']).optional(),
  sort: z.string().optional(),
});

/**
 * Tạo thành viên (§4.7).
 *
 * Cố ý KHÔNG nhận mật khẩu: Admin không được đặt mật khẩu hộ người khác. Hệ
 * thống sinh mật khẩu tạm, trả về đúng một lần, và bắt người dùng đổi ngay lần
 * đăng nhập đầu (`must_change_password`).
 *
 * `jobTitle` tuỳ chọn vì tài khoản do Admin tạo không đi qua form đăng ký.
 */
export const createMemberBodySchema = z.object({
  email: emailRule.transform((v) => v.trim().toLowerCase()),
  fullName: fullNameRule.transform((v) => v.trim().replace(/\s+/g, ' ')),
  role: tenantRole,
  jobTitle: z.enum(JOB_TITLES).optional(),
});

export const updateRoleBodySchema = z.object({
  role: tenantRole,
});

export const setActiveBodySchema = z.object({
  isActive: z.boolean(),
});

// ─── Bộ dữ liệu (§7) ─────────────────────────────────────────────────────────

/**
 * Xin presigned URL.
 *
 * CỐ Ý không có trường `key`. Khoá lưu trữ do server sinh (xem
 * `services/dataset/storageKey.ts`): presigned URL là một tấm vé ghi vào đúng
 * khoá đó trong 15 phút, nên nhận khoá từ client là cho người ta ghi đè file của
 * tổ chức khác — và việc ghi đó diễn ra thẳng giữa trình duyệt và S3, không lớp
 * middleware nào nhìn thấy.
 *
 * `fileSize` client khai chỉ dùng để từ chối SỚM cho đỡ tốn một lần upload vô
 * ích. Con số đáng tin là `headObject` sau khi file đã lên tới nơi.
 */
export const createUploadBodySchema = z.object({
  workspaceId: z.coerce.number().int().positive(),
  filename: z.string().trim().min(1, 'Thiếu tên file').max(255),
  fileSize: z.coerce.number().int().nonnegative().optional(),
});

/**
 * Chốt các sheet đã tích (§7.5).
 *
 * Cố ý KHÔNG có danh sách cột: bản cập nhật của §7.5 bỏ hẳn bước chọn cột — mọi
 * cột đều được nhập, kiểu do hệ thống suy luận.
 *
 * Trần 50 sheet: một file Excel hợp lệ có thể có hàng trăm sheet, và mỗi sheet
 * là một bộ dữ liệu cùng một lần nạp dòng. Không có trần thì một request tạo ra
 * hàng trăm bảng dữ liệu trong một transaction.
 */
export const commitDatasetsBodySchema = z.object({
  name: z.string().trim().min(1, 'Tên bộ dữ liệu không được để trống').max(DATASET_NAME_MAX),
  sheets: z
    .array(z.string().min(1))
    .min(1, 'Hãy chọn ít nhất một sheet')
    .max(50, 'Chọn tối đa 50 sheet một lần'),
});

export const listDatasetsQuerySchema = paginationSchema.extend({
  workspaceId: z.coerce.number().int().positive(),
  q: z.string().trim().max(100).optional(),
  status: z.enum(DATASET_STATUSES).optional(),
  sort: z.string().optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
});

// ─── Báo cáo (§7.6) ──────────────────────────────────────────────────────────

/**
 * Cấu hình biểu đồ.
 *
 * `dimension` và `measure` là TÊN FIELD người dùng đặt ở bước 2, không phải id
 * cột — vì đó cũng là khoá trong các document JSON của `dataset_rows`. Router
 * kiểm chúng có thật trong danh sách cột hay không; zod chỉ lo hình dạng.
 *
 * `measure` cho phép `null` vì phép `count` không cần cột nào để đo.
 */
export const reportConfigSchema = z.object({
  dimension: z.string().trim().min(1, 'Hãy chọn cột để nhóm'),
  measure: z.string().trim().min(1).nullable().default(null),
  aggregate: z.enum(AGGREGATES).default('count'),
  // Trần 100: quá số này thì biểu đồ thành một hàng rào không đọc được, và phần
  // vượt đã được gộp vào "Khác" nên không mất thông tin tổng.
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * Tạo báo cáo RỖNG — chỉ có tên và bộ dữ liệu (§7.6).
 *
 * CỐ Ý không nhận `chartType` hay `config`, kể cả tuỳ chọn. Wizard dựng cái vỏ;
 * biểu đồ là việc người dùng làm trên trang Report qua `PATCH /reports/:id`.
 * Cho phép gửi kèm ở đây sẽ mở lại đúng cánh cửa vừa đóng: một cấu hình đoán
 * bừa trông y hệt một cấu hình người dùng đã chọn.
 */
export const createReportBodySchema = z.object({
  datasetId: z.coerce.number().int().positive(),
  name: z.string().trim().min(1, 'Tên báo cáo không được để trống').max(REPORT_NAME_MAX),
});

export const updateReportBodySchema = z.object({
  name: z.string().trim().min(1, 'Tên báo cáo không được để trống').max(REPORT_NAME_MAX),
  chartType: z.enum(CHART_TYPES),
  config: reportConfigSchema,
});

export const listReportsQuerySchema = paginationSchema.extend({
  workspaceId: z.coerce.number().int().positive(),
  q: z.string().trim().max(100).optional(),
});
