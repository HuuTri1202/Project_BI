import {
  AGGREGATES,
  BILLING_CYCLES,
  CANVAS_COLUMNS,
  CANVAS_MAX_ANNOTATIONS,
  CANVAS_MAX_PAGES,
  CANVAS_MAX_VISUALS,
  CANVAS_MIN_H,
  CANVAS_MIN_W,
  CHART_PALETTES_ALL,
  CHART_SORTS,
  CHART_TYPES,
  COLUMN_ROLES,
  ORDER_STATUSES,
  DATAMODEL_NAME_MAX,
  DATASET_NAME_MAX,
  DATASET_SOURCES,
  DATASET_STATUSES,
  GROUP_PICKS,
  LOAD_STATUSES,
  MAX_GROUP_PAGE,
  MEASURE_AGGS,
  MEASURE_FORMATS,
  MEASURE_NAME_MAX,
  MEASURE_OPS,
  RELATIONSHIP_KINDS,
  PAGE_NAME_MAX,
  REPORT_NAME_MAX,
  reportAnnotationSchema,
  TIME_GRANULARITIES,
  VISUAL_TITLE_MAX,
  companyNameRule,
  emailRule,
  fullNameRule,
  JOB_TITLES,
} from '@bi/shared';
import { z } from 'zod';
import { ORDER_CODE_PATTERN } from '../../services/billing/orderCode';
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

// ─── Bộ dữ liệu, nguồn FILE (§7) ─────────────────────────────────────────────

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
  // Trần 100: quá số này thì biểu đồ thành một hàng rào không đọc được. Nhánh
  // bộ dữ liệu gộp phần vượt vào "Khác" nên không mất thông tin tổng; nhánh mô
  // hình chia trang (§10.15).
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

/**
 * Tuỳ chọn TRÌNH BÀY của biểu đồ — §10.9.
 *
 * Backend KHÔNG đọc khối này: nó không đi vào truy vấn Cube, nó chỉ được lưu
 * rồi trả lại nguyên vẹn cho trình vẽ. Vẫn phải kiểm hình dạng, vì thứ lọt qua
 * đây sẽ nằm trong cột `config` mãi mãi — và một `palette: 'DROP TABLE'` tuy vô
 * hại với SQL (nó là JSON) nhưng sẽ làm Vega từ chối vẽ, ở một màn hình cách
 * chỗ gây lỗi rất xa.
 *
 * `.strict()` để một trường viết sai chính tả bị TỪ CHỐI thay vì được lưu im
 * lặng rồi không bao giờ có tác dụng.
 */
export const reportChartOptionsSchema = z
  .object({
    stacked: z.boolean().optional(),
    showLegend: z.boolean().optional(),
    showValues: z.boolean().optional(),
    sort: z.enum(CHART_SORTS).optional(),
    // `_ALL` chứ không `CHART_PALETTES`: danh sách sau là những bảng màu bộ
    // chọn còn MỜI, còn ở đây phải nhận cả những bảng màu đã lưu trong báo cáo
    // cũ. Hẹp lại là mọi báo cáo cũ mở ra được, sửa được, nhưng bấm Lưu thì 400.
    palette: z.enum(CHART_PALETTES_ALL).optional(),
  })
  .strict();

/**
 * Báo cáo dựng trên MÔ HÌNH — §10.8.
 *
 * Toàn ID, không một tên cột nào — cùng luật với `explorerQueryBodySchema`.
 * Backend tra hai ID này trong phạm vi mô hình đã lọc theo tổ chức rồi tự dựng
 * tên cube, nên một ID bịa ra rơi vào `FIELD_UNKNOWN` chứ không trỏ sang được
 * mô hình của người khác.
 *
 * KHÔNG có `aggregate`: phép gộp thuộc về định nghĩa của thước đo. Xem
 * `ReportModelConfigDto`.
 */
export const reportModelConfigSchema = z.object({
  dimensionId: z.coerce.number().int().positive(),
  measureId: z.coerce.number().int().positive(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  /**
   * Đọc bảng xếp hạng từ đầu nào — xem `GROUP_PICKS`.
   *
   * Ở TRONG `config` chứ không trong `options`, vì nó đổi SỐ LIỆU: nó đổi câu
   * hỏi gửi xuống Cube. Nhầm sang `options` là nó không vào khoá cache và đổi
   * lựa chọn sẽ trả về đúng câu trả lời cũ.
   *
   * Trình dựng suy nó ra từ `options.sort` (§10.15) và vẫn gửi lên đây. Schema
   * KHÔNG `.strict()`, nên một client cũ còn gửi kèm `overflow` chỉ bị bỏ qua
   * chứ không nhận 400.
   */
  pick: z.enum(GROUP_PICKS).optional(),
  /**
   * Chiều thứ hai — tách chuỗi (§10.9). Router kiểm nó có thật trong mô hình và
   * kiểm nó KHÁC chiều chính; zod chỉ lo hình dạng.
   *
   * `.nullish()` chứ không `.optional()`: trình dựng gửi `null` khi người dùng
   * gỡ chiều ra khỏi ô Nhóm màu, và một `undefined` ở đó sẽ bị `JSON.stringify`
   * xoá khỏi thân request — cùng ý nghĩa nhưng hai hình dạng, nên nhận cả hai.
   */
  seriesDimensionId: z.coerce.number().int().positive().nullish(),
  /**
   * Đổi phép gộp riêng cho biểu đồ này — cùng cơ chế `measureAggs` của Explorer.
   *
   * Ở TRONG `config` chứ không trong `options`, cùng lý do với `pick`: nó đổi
   * SỐ LIỆU. Nhầm sang `options` thì nó không vào khoá cache và đổi phép tính sẽ
   * trả về đúng câu trả lời cũ.
   *
   * zod chỉ lo hình dạng. Việc phép này có hợp lệ với thước đo đó không do
   * `assertChartConfigAgainst` kiểm, vì chỉ ở đó mới biết `availableAggs`.
   *
   * `.nullish()` vì trình dựng gửi `null` khi người dùng chọn lại "theo mô hình".
   */
  measureAgg: z.enum(MEASURE_AGGS).nullish(),
  options: reportChartOptionsSchema.optional(),
});

/**
 * Sửa báo cáo đã dựng trên mô hình — §10.9.
 *
 * Không nhận `datamodelId`: báo cáo đã gắn với một mô hình từ lúc tạo, và cho
 * client khai lại là mở đường chuyển một báo cáo sang mô hình khác qua một
 * endpoint không hề nói rằng nó làm việc đó. Đổi nguồn thì tạo báo cáo mới.
 */
export const updateModelReportBodySchema = z.object({
  name: z.string().trim().min(1, 'Tên báo cáo không được để trống').max(REPORT_NAME_MAX),
  chartType: z.enum(CHART_TYPES),
  config: reportModelConfigSchema,
});

/**
 * Xem trước số liệu trong trình dựng — §10.9.
 *
 * Không có `name`: chưa có báo cáo nào để đặt tên. Đó cũng là điểm khác duy
 * nhất so với `updateModelReportBodySchema`, và là lý do nó không dùng lại
 * `.omit()` — hai schema tình cờ giống nhau ở hai trường không có nghĩa là một
 * cái phái sinh từ cái kia, và ràng chúng vào nhau sẽ khiến việc thêm một
 * trường vào thân request lưu kéo theo cả thân request xem trước.
 */
export const modelReportPreviewBodySchema = z.object({
  chartType: z.enum(CHART_TYPES),
  config: reportModelConfigSchema,
  /**
   * Trang nhóm đang xem — §10.12.
   *
   * Ở NGOÀI `config` một cách cố ý, dù nó có đổi số liệu. `config` là thứ được
   * LƯU vào báo cáo, còn trang đang xem là chỗ người đọc đang đứng trong một
   * lượt xem. Nhét vào trong nghĩa là bấm ‹ › một cái rồi bấm Lưu sẽ ghi lại
   * "báo cáo này mở ra ở trang 4".
   *
   * Service tự bỏ qua nó khi cấu hình không chia trang — xem `pageOf`.
   */
  page: z.coerce.number().int().min(0).max(MAX_GROUP_PAGE).optional(),
});

/**
 * Ngược `createReportBodySchema`: nhận LUÔN biểu đồ.
 *
 * Không mâu thuẫn với lý do nhánh kia từ chối. Ở luồng file, hệ thống chưa biết
 * cột nào đáng vẽ nên nó không đoán. Ở đây chính người dùng vừa chọn chiều và
 * thước đo trong hộp thoại, nên không có gì để đoán cả.
 */
export const createModelReportBodySchema = z.object({
  datamodelId: z.coerce.number().int().positive(),
  name: z.string().trim().min(1, 'Tên báo cáo không được để trống').max(REPORT_NAME_MAX),
  chartType: z.enum(CHART_TYPES),
  config: reportModelConfigSchema,
});

/**
 * Một ô trên khung — §10.10.
 *
 * Toạ độ được KẸP ở đây chứ không ở tầng đọc: `x + w` vượt quá số cột cho ra
 * một ô tràn khỏi khung ở mọi màn hình, và `w = 0` cho một ô vô hình mà người
 * dùng không bấm được để xoá. Kẹp lúc ghi nghĩa là dữ liệu trong database luôn
 * vẽ được, không phải sửa lại ở từng nơi đọc.
 *
 * `y` KHÔNG có trần: khung cuộn dọc, nên hàng thứ 300 vẫn là một vị trí hợp lệ.
 * `.max(500)` chỉ để một số vô lý không đẩy thanh cuộn đi hàng vạn pixel.
 *
 * ⚠️ `.strict()` — cùng lý do với `reportChartOptionsSchema`: một trường viết
 * sai chính tả phải bị từ chối, không phải được lưu rồi im lặng vô tác dụng.
 */
export const reportVisualSchema = z
  .object({
    /**
     * Khoá do trình duyệt sinh. Giới hạn ký tự vì chuỗi này quay lại trong
     * `ReportVisualDataDto.visualId` và được dùng làm khoá React — một chuỗi
     * dài vô hạn hay chứa ký tự lạ không có ích gì ngoài việc làm log khó đọc.
     */
    id: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .regex(/^[A-Za-z0-9_-]+$/, 'Mã ô chỉ nhận chữ, số, gạch ngang và gạch dưới'),
    chartType: z.enum(CHART_TYPES),
    config: reportModelConfigSchema,
    title: z.string().trim().max(VISUAL_TITLE_MAX).optional(),
    x: z.coerce
      .number()
      .int()
      .min(0)
      .max(CANVAS_COLUMNS - 1),
    y: z.coerce.number().int().min(0).max(500),
    w: z.coerce.number().int().min(CANVAS_MIN_W).max(CANVAS_COLUMNS),
    h: z.coerce.number().int().min(CANVAS_MIN_H).max(60),
  })
  .strict()
  // Kẹp bề rộng vào trong khung thay vì từ chối: một ô ở cột 9 rộng 6 là chuyện
  // kéo thả bình thường sinh ra, và trả lỗi cho nó nghĩa là người dùng mất cả
  // lần lưu vì một ô thò ra ngoài mép.
  .transform((v) => ({ ...v, w: Math.min(v.w, CANVAS_COLUMNS - v.x) }));

/**
 * Khung — §10.10.
 *
 * `id` phải DUY NHẤT trong một khung. Trùng nhau thì `GET /reports/:id/
 * canvas-data` trả hai bản ghi cùng khoá và trình vẽ ghép số liệu vào nhầm ô —
 * biểu đồ đúng hình, sai số. Đây là loại lỗi không ai nhìn ra bằng mắt, nên nó
 * bị chặn ở cửa.
 */
/**
 * Một TRANG — §10.12.
 *
 * `visuals` KHÔNG có `.min(1)`: một trang vừa thêm chưa có ô nào, và người ta
 * hay bấm Lưu ngay lúc đó. Từ chối nó nghĩa là trang vừa tạo biến mất mà không
 * có thông báo nào — luật "ít nhất một ô" áp cho cả KHUNG, ở ngay dưới.
 */
export const reportPageSchema = z
  .object({
    id: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .regex(/^[A-Za-z0-9_-]+$/, 'Mã trang chỉ nhận chữ, số, gạch ngang và gạch dưới'),
    name: z.string().trim().min(1, 'Tên trang không được để trống').max(PAGE_NAME_MAX),
    visuals: z
      .array(reportVisualSchema)
      .max(CANVAS_MAX_VISUALS, `Một trang tối đa ${CANVAS_MAX_VISUALS} biểu đồ`),
    /**
     * Văn bản, đường kẻ, hình — §10.18. Luật của từng cái nằm ở `@bi/shared`.
     *
     * `.default([])`: một tab mở từ trước lúc triển khai gửi trang KHÔNG có
     * trường này, và câu trả lời cho nó phải là "đã lưu", không phải 400.
     *
     * Trần riêng, không cộng vào `CANVAS_MAX_VISUALS`: trần kia là chi phí
     * truy vấn, còn chú thích không tốn một truy vấn nào.
     */
    annotations: z
      .array(reportAnnotationSchema)
      .max(CANVAS_MAX_ANNOTATIONS, `Một trang tối đa ${CANVAS_MAX_ANNOTATIONS} chú thích`)
      .default([]),
  })
  .strict();

/**
 * Khung — §10.10, thành nhiều TRANG ở §10.12.
 *
 * `id` của ô phải duy nhất trên CẢ KHUNG, không chỉ trong một trang. Trùng nhau
 * thì `GET /reports/:id/canvas-data` trả hai bản ghi cùng khoá và trình vẽ ghép
 * số liệu vào nhầm ô — biểu đồ đúng hình, sai số. Đây là loại lỗi không ai nhìn
 * ra bằng mắt, nên nó bị chặn ở cửa. Duy nhất theo trang thì không đủ: chuyển ô
 * sang trang khác là một thao tác bình thường, và nó sẽ mang mã cũ đi theo.
 *
 * ⚠️ Hình dạng CŨ (`{ visuals: [...] }`) vẫn được nhận và quy về một trang.
 * Không phải để chiều một client tưởng tượng: một tab đang mở từ trước lúc
 * triển khai vẫn gửi hình dạng đó, và câu trả lời cho nó phải là "đã lưu", chứ
 * không phải một lỗi 400 làm mất khung người ta vừa dựng.
 */
export const reportCanvasSchema = z.preprocess(
  (raw) => {
    if (raw === null || typeof raw !== 'object') return raw;
    const obj = raw as { pages?: unknown; visuals?: unknown };
    if (obj.pages !== undefined || !Array.isArray(obj.visuals)) return raw;
    return { pages: [{ id: 'p1', name: 'Trang 1', visuals: obj.visuals }] };
  },
  z.object({
    pages: z
      .array(reportPageSchema)
      .min(1, 'Báo cáo phải có ít nhất một trang')
      .max(CANVAS_MAX_PAGES, `Một báo cáo tối đa ${CANVAS_MAX_PAGES} trang`)
      .refine(
        (list) => list.reduce((sum, p) => sum + p.visuals.length, 0) > 0,
        'Khung phải có ít nhất một biểu đồ',
      )
      .refine(
        (list) => new Set(list.map((p) => p.id)).size === list.length,
        'Hai trang trong cùng một báo cáo không được trùng mã',
      )
      .refine((list) => {
        // Chú thích và biểu đồ dùng CHUNG một không gian mã: cả hai làm khoá
        // React trên cùng một lưới, và trình dựng chọn phần tử theo mã mà không
        // hỏi nó là loại gì. Trùng nhau thì bấm vào hộp văn bản lại mở bảng cấu
        // hình của một biểu đồ.
        const ids = list.flatMap((p) => [
          ...p.visuals.map((v) => v.id),
          ...p.annotations.map((a) => a.id),
        ]);
        return new Set(ids).size === ids.length;
      }, 'Hai ô trong cùng một báo cáo không được trùng mã'),
  }),
);

export const createCanvasReportBodySchema = z.object({
  datamodelId: z.coerce.number().int().positive(),
  name: z.string().trim().min(1, 'Tên báo cáo không được để trống').max(REPORT_NAME_MAX),
  canvas: reportCanvasSchema,
});

/** Không nhận `datamodelId` — cùng lý do với `updateModelReportBodySchema`. */
export const updateCanvasReportBodySchema = z.object({
  name: z.string().trim().min(1, 'Tên báo cáo không được để trống').max(REPORT_NAME_MAX),
  canvas: reportCanvasSchema,
});

/**
 * Trang nhóm cho một lần ĐỌC số liệu — `?page=` trên các endpoint báo cáo.
 *
 * Kẹp bằng `.max` chứ không để tự do: `offset` đi thẳng vào truy vấn Cube, và
 * một `?page=99999999` là một lượt quét ClickHouse bỏ qua mười tỉ dòng.
 */
export const reportPageQuerySchema = z.object({
  page: z.coerce.number().int().min(0).max(MAX_GROUP_PAGE).optional(),
});

/** Trang NÀO của khung được tính số liệu — xem `GET /reports/:id/canvas-data`. */
export const canvasDataQuerySchema = reportPageQuerySchema.extend({
  pageId: z.string().trim().max(40).optional(),
});

export const visualIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
  visualId: z.string().trim().min(1).max(40),
});

export const listReportsQuerySchema = paginationSchema.extend({
  workspaceId: z.coerce.number().int().positive(),
  q: z.string().trim().max(100).optional(),
});

// ─── Kết nối CSDL (§8) ───────────────────────────────────────────────────────

/**
 * Host của CSDL nguồn.
 *
 * Chỉ kiểm HÌNH DẠNG ở đây — có phải tên miền hoặc IP hay không. Việc nó có trỏ
 * vào mạng nội bộ hay không thuộc về `resolveAndGuardHost`, vì câu trả lời đó
 * cần DNS và cần biết môi trường đang chạy. Trộn hai loại kiểm tra vào một chỗ
 * sẽ khiến zod phải làm việc bất đồng bộ và thông báo lỗi mất ngữ cảnh.
 */
const hostRule = z
  .string()
  .trim()
  .min(1, 'Vui lòng nhập địa chỉ máy chủ')
  .max(255)
  .regex(/^[a-zA-Z0-9._:[\]-]+$/, 'Địa chỉ chỉ gồm chữ, số và các ký tự . - : [ ]');

const connectionFields = {
  name: z
    .string()
    .trim()
    .min(1, 'Vui lòng đặt tên cho kết nối')
    .max(255)
    .transform((v) => v.replace(/\s+/g, ' ')),
  kind: z.enum(['mysql', 'clickhouse']),
  host: hostRule,
  port: z.coerce.number().int().min(1).max(65535),
  /**
   * `z.boolean()` chứ KHÔNG `z.coerce.boolean()`.
   *
   * `coerce` gọi `Boolean(v)`, mà `Boolean('false')` là `true` — nên một client
   * gửi chuỗi `"false"` sẽ bật SSL lên. Ở đây body luôn là JSON thật nên kiểu
   * boolean gốc là đủ, và cái gì không phải boolean thì đáng bị từ chối thẳng.
   */
  useSsl: z.boolean().optional().default(false),
  /**
   * Rỗng = "mọi database", KHÔNG phải thiếu dữ liệu.
   *
   * Bỏ `.min(1)` là chủ ý. Trước đây trường này bắt buộc, và gõ sai một chữ
   * (`defualt`) cho ra một kết nối lưu được, test xanh, nhưng hộp thoại Đồng bộ
   * rỗng không rõ lý do — vì `test()` chỉ đọc phiên bản server chứ không đụng
   * tới database. Giờ người dùng CHỌN từ danh sách máy chủ trả về, và "tất cả"
   * là một lựa chọn hợp lệ trong danh sách đó.
   */
  databaseName: z.string().trim().max(255),
  username: z.string().trim().min(1, 'Vui lòng nhập tên đăng nhập').max(255),
};

/** Thử kết nối chưa lưu — bắt buộc có mật khẩu vì chưa có gì để giữ nguyên. */
export const testConnectionBodySchema = z.object({
  ...connectionFields,
  // KHÔNG `.trim()`: khoảng trắng đầu/cuối là ký tự hợp lệ trong mật khẩu, và
  // cắt nó đi sẽ khiến kết nối thất bại vì một lý do người dùng không nhìn thấy.
  password: z.string().min(1, 'Vui lòng nhập mật khẩu').max(512),
});

export const createConnectionBodySchema = testConnectionBodySchema;

/**
 * Sửa kết nối — mật khẩu TUỲ CHỌN.
 *
 * Để trống nghĩa là giữ nguyên mật khẩu đang lưu. Bắt buộc nhập lại nghĩa là
 * admin muốn đổi mỗi cái tên cũng phải biết mật khẩu CSDL — thứ mà người dựng
 * kết nối ban đầu có thể đã không chia sẻ cho họ.
 */
export const updateConnectionBodySchema = z.object({
  ...connectionFields,
  password: z.string().max(512).optional(),
});

/**
 * Danh sách bảng cần đồng bộ.
 *
 * Tối đa 500 bảng một lần: đây là request đồng bộ, và một CSDL có 5000 bảng sẽ
 * treo request tới lúc timeout rồi không đồng bộ được gì cả. Chặn sớm và nói rõ
 * tốt hơn là để người dùng chờ 30 giây rồi nhận một lỗi mạng.
 */
export const syncBodySchema = z.object({
  /**
   * Workspace nhận những bảng đồng bộ về.
   *
   * `optional()` để những lời gọi cũ không gãy — bỏ trống thì `resolveWorkspace`
   * chọn workspace đầu tiên. Giao diện LUÔN gửi workspace đang mở.
   */
  workspaceId: z.coerce.number().int().positive().optional(),
  tables: z
    .array(
      z.object({
        schema: z.string().trim().min(1).max(255),
        table: z.string().trim().min(1).max(255),
      }),
    )
    .min(1, 'Chọn ít nhất một bảng để đồng bộ')
    .max(500, 'Chọn tối đa 500 bảng mỗi lần đồng bộ'),
});

// ─── Kho dữ liệu — chung cho CẢ HAI nguồn ────────────────────────────────────

/**
 * Danh sách bộ dữ liệu.
 *
 * Một schema cho cả hai nguồn, vì chỉ còn MỘT trang danh sách. Mọi bộ lọc đều
 * tuỳ chọn:
 *
 *   workspaceId  bỏ trống = cả tổ chức. Giao diện LUÔN gửi workspace đang mở —
 *                mỗi workspace quản lý kho riêng. Nhánh "cả tổ chức" giữ lại
 *                cho công cụ nội bộ và cho việc giải thích một danh sách rỗng.
 *                (Từ migration 11 mọi dataset đều có workspace, nên nhánh này
 *                không còn là cách duy nhất để thấy dữ liệu cũ nữa.)
 *   source       lọc riêng "từ file" hoặc "từ CSDL".
 *   connectionId chỉ có nghĩa với nguồn `connection`.
 *   status       bỏ trống = chỉ `ready`, xem `where()` trong repository.
 */
export const listDatasetsQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(100).optional(),
  workspaceId: z.coerce.number().int().positive().optional(),
  source: z.enum(DATASET_SOURCES).optional(),
  connectionId: z.coerce.number().int().positive().optional(),
  status: z.enum(DATASET_STATUSES).optional(),
  /**
   * Lọc theo trạng thái NẠP VÀO KHO (§9), khác hẳn `status` ở trên vốn nói về
   * việc phân tích file (§7). Bộ chọn bộ dữ liệu của §10.2 dùng nó để chỉ chào
   * những bộ đã `loaded` — bộ chưa nạp thì chưa có bảng nào trong ClickHouse để
   * dựng mô hình lên.
   */
  loadStatus: z.enum(LOAD_STATUSES).optional(),
  sort: z.string().optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
});

// ─── Mô hình dữ liệu (§10) ───────────────────────────────────────────────────

export const listDataModelsQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(100).optional(),
  workspaceId: z.coerce.number().int().positive().optional(),
  sort: z.string().optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
});

const dataModelName = z
  .string()
  .trim()
  .min(1, 'Tên mô hình không được để trống')
  .max(DATAMODEL_NAME_MAX);

/**
 * Trần 20 bộ dữ liệu mỗi mô hình.
 *
 * Không phải con số tuỳ tiện: mỗi bộ là một cube trong file schema, và Cube
 * biên dịch lại cả ngữ cảnh mỗi lần mô hình đổi. Quan trọng hơn, một mô hình 20
 * bảng đã vượt xa thứ canvas quan hệ hiện được cho người đọc hiểu.
 */
export const createDataModelBodySchema = z.object({
  workspaceId: z.coerce.number().int().positive().optional(),
  name: dataModelName,
  description: z.string().trim().max(500).optional(),
  datasetIds: z
    .array(z.coerce.number().int().positive())
    .min(1, 'Hãy chọn ít nhất một bộ dữ liệu')
    .max(20, 'Mỗi mô hình nhận tối đa 20 bộ dữ liệu'),
});

export const updateDataModelBodySchema = z.object({
  name: dataModelName,
  description: z.string().trim().max(500).nullable().optional(),
});

export const addDatasetsBodySchema = z.object({
  datasetIds: z.array(z.coerce.number().int().positive()).min(1).max(20),
});

export const saveSchemaBodySchema = z.object({
  columns: z
    .array(
      z.object({
        columnId: z.coerce.number().int().positive(),
        alias: z.string().trim().max(255).nullable(),
        role: z.enum(COLUMN_ROLES),
        // `.optional().nullable()` chứ không `.nullish()` gộp một chỗ: ba
        // trạng thái ở đây mang ba nghĩa khác nhau — vắng mặt là "đừng đụng
        // tới", `null` là "bỏ thước đo của cột này", còn một phép là "đặt nó".
        measureAgg: z.enum(MEASURE_AGGS).nullable().optional(),
      }),
    )
    .min(1)
    .max(500),
});

/**
 * Thước đo TÍNH TOÁN — §10.6.
 *
 * Không có ô nào nhận biểu thức dạng chữ: hai vế là ID và phép nằm trong ENUM.
 * Xem ghi chú ở migration 13 về lý do.
 */
export const createFormulaMeasureBodySchema = z.object({
  name: z.string().trim().min(1).max(MEASURE_NAME_MAX),
  leftId: z.coerce.number().int().positive(),
  op: z.enum(MEASURE_OPS),
  rightId: z.coerce.number().int().positive(),
  format: z.enum(MEASURE_FORMATS),
});

/**
 * Thước đo GỘP TRÊN BIỂU THỨC DÒNG — §10.6.
 *
 * Trông giống `createFormulaMeasureBodySchema` nhưng hai vế là ID CỘT chứ không
 * phải ID thước đo, và `agg` ở đây mang nghĩa thật — nó là phép gộp áp lên kết
 * quả biểu thức. Hai schema riêng chứ không một schema có trường tuỳ chọn:
 * trộn lại thì không còn ràng buộc nào để zod chặn, và mã đọc phải tự nhớ
 * trường nào đi với `kind` nào.
 *
 * Vẫn không có ô nào nhận biểu thức dạng chữ — hai vế là ID, phép nằm trong
 * ENUM. Cùng nguyên tắc đã ghi ở migration 13.
 */
export const createRowExprMeasureBodySchema = z.object({
  name: z.string().trim().min(1).max(MEASURE_NAME_MAX),
  agg: z.enum(MEASURE_AGGS),
  leftColumnId: z.coerce.number().int().positive(),
  op: z.enum(MEASURE_OPS),
  rightColumnId: z.coerce.number().int().positive(),
  format: z.enum(MEASURE_FORMATS),
});

/**
 * Sửa một BẢNG trong mô hình — §10.3.
 *
 * Cả ba trường đều `optional()`: hộp thoại "Đặt khoá chính" chỉ gửi
 * `primaryColumnId`, còn hộp thoại "Sửa" chỉ gửi tên và mô tả. Bắt gửi đủ cả ba
 * sẽ khiến một hộp thoại vô tình xoá trắng thứ hộp thoại kia vừa lưu.
 *
 * `nullable()` mang nghĩa XOÁ TRỐNG, khác hẳn `undefined` là "không đụng tới" —
 * đó là cách gỡ khoá chính đã đặt.
 */
export const updateModelDatasetBodySchema = z.object({
  displayName: z.string().trim().max(255).nullable().optional(),
  description: z.string().trim().max(500).nullable().optional(),
  primaryColumnId: z.coerce.number().int().positive().nullable().optional(),
});

export const saveLayoutBodySchema = z.object({
  positions: z
    .array(
      z.object({
        id: z.coerce.number().int().positive(),
        // Toạ độ âm hợp lệ: người dùng kéo thẻ ra ngoài mép trái là chuyện
        // thường, và ép về 0 sẽ dồn mọi thẻ vào một chỗ. Trần để chặn một giá
        // trị vô lý đẩy thẻ ra khỏi tầm nhìn vĩnh viễn.
        x: z.coerce.number().int().min(-10_000).max(10_000),
        y: z.coerce.number().int().min(-10_000).max(10_000),
      }),
    )
    .max(50),
});

export const createMeasureBodySchema = z.object({
  datamodelDatasetId: z.coerce.number().int().positive(),
  name: z.string().trim().min(1, 'Tên thước đo không được để trống').max(MEASURE_NAME_MAX),
  agg: z.enum(MEASURE_AGGS),
  columnId: z.coerce.number().int().positive().optional(),
});

export const updateMeasureBodySchema = createMeasureBodySchema.omit({
  datamodelDatasetId: true,
});

export const createRelationshipBodySchema = z.object({
  leftId: z.coerce.number().int().positive(),
  leftColumnId: z.coerce.number().int().positive(),
  rightId: z.coerce.number().int().positive(),
  rightColumnId: z.coerce.number().int().positive(),
  kind: z.enum(RELATIONSHIP_KINDS),
});

/**
 * Câu hỏi gửi tới Explorer — §10.7.
 *
 * ⚠️ TOÀN BỘ là id. Không một tên cube, tên bảng hay tên cột nào đi từ trình
 * duyệt xuống. Express tra id trong phạm vi mô hình đã lọc theo tổ chức rồi TỰ
 * DỰNG tên cube — cùng nguyên tắc `aggregateWarehouse` đang dùng: chuỗi đi vào
 * truy vấn lấy từ database của ta, không phải từ body request.
 */
export const explorerQueryBodySchema = z
  .object({
    dimensionIds: z.array(z.coerce.number().int().positive()).max(20).default([]),
    measureIds: z.array(z.coerce.number().int().positive()).max(20).default([]),
    timeDimension: z
      .object({
        dimensionId: z.coerce.number().int().positive(),
        granularity: z.enum(TIME_GRANULARITIES),
      })
      .optional(),
    limit: z.coerce.number().int().positive().max(5000).optional(),
    /*
     * Đổi phép gộp cho riêng truy vấn này — §10.7.
     *
     * Vẫn TOÀN ID: `agg` là một giá trị trong `MEASURE_AGGS`, tức từ vựng của
     * ta chứ không phải chuỗi tự do, và Express còn đối chiếu tiếp với các phép
     * mà cột đó thật sự nhận trước khi dựng tên cube.
     *
     * Trần bằng `measureIds`: nhiều hơn thế là những id không được chọn, và
     * chúng bị bỏ qua chứ không có tác dụng gì.
     */
    measureAggs: z
      .array(
        z.object({
          id: z.coerce.number().int().positive(),
          agg: z.enum(MEASURE_AGGS),
        }),
      )
      .max(20)
      .optional(),
  })
  .refine((q) => q.dimensionIds.length + q.measureIds.length > 0, {
    message: 'Hãy chọn ít nhất một chiều hoặc một thước đo',
    path: ['dimensionIds'],
  });

// ─── Gói dịch vụ & thanh toán (§11) ──────────────────────────────────────────

/**
 * Tạo đơn mua gói.
 *
 * CỐ Ý không nhận `amount`. Số tiền do backend tính từ giá gói và chu kỳ, rồi
 * chốt cứng vào đơn — nhận nó từ client là cho người ta tự đặt giá cho chính
 * mình, và lớp kiểm duy nhất sẽ là một câu `if` ai đó có thể quên.
 *
 * Cũng không nhận `orderCode`: mã do server sinh, cùng lập luận với khoá lưu
 * trữ của §7 (`createUploadBodySchema`).
 */
export const createOrderBodySchema = z.object({
  planId: z.coerce.number().int().positive(),
  paymentMethodId: z.coerce.number().int().positive(),
  cycle: z.enum(BILLING_CYCLES),
});

/**
 * Mã đơn trên URL.
 *
 * Kiểm KHUÔN ngay ở đây thay vì để repository nhận một chuỗi tuỳ ý: một tham số
 * rác bị chặn trước khi chạm database, và thông báo lỗi nói đúng chuyện gì sai.
 * `ORDER_CODE_PATTERN` là nguồn duy nhất của khuôn đó — xem `orderCode.ts`.
 */
export const orderCodeParamSchema = z.object({
  code: z.string().regex(ORDER_CODE_PATTERN, 'Mã đơn hàng không đúng định dạng'),
});

export const listOrdersQuerySchema = paginationSchema.extend({
  status: z.enum(ORDER_STATUSES).optional(),
  sort: z.string().optional(),
});

/** Dòng lỗi của lần nạp gần nhất (§9.8). Chỉ cần phân trang, không có bộ lọc. */
export const listLoadErrorsQuerySchema = paginationSchema;

export const renameDatasetBodySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Tên không được để trống')
    .max(255)
    .transform((v) => v.replace(/\s+/g, ' ')),
});
