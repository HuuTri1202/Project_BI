import { companyNameRule, emailRule, fullNameRule, JOB_TITLES } from '@bi/shared';
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
  databaseName: z.string().trim().min(1, 'Vui lòng nhập tên database').max(255),
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

// ─── Kho dữ liệu (§8.5) ──────────────────────────────────────────────────────

export const listDatasetsQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(100).optional(),
  connectionId: z.coerce.number().int().positive().optional(),
  sort: z.string().optional(),
});

export const renameDatasetBodySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Tên không được để trống')
    .max(255)
    .transform((v) => v.replace(/\s+/g, ' ')),
});
