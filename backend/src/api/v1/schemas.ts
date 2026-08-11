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
