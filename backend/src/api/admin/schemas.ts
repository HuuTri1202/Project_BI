import { companyNameRule, emailRule, fullNameRule, JOB_TITLES } from '@bi/shared';
import { z } from 'zod';
import { MEMBER_SORT_KEYS } from '../../repositories/adminMembers';
import { paginationSchema } from '../../utils/pagination';

/**
 * Schema request của khu quản trị.
 *
 * Ở BACKEND chứ không phải `@bi/shared`, vì `paginationSchema` dùng
 * `z.coerce.number()` — query string luôn là chuỗi nên buộc phải ép kiểu, mà ép
 * kiểu là transform, và luật ghi trong `shared/src/auth.ts` là schema dùng chung
 * chỉ được validate chứ không transform (nếu không thì kiểu input/output của zod
 * lệch nhau và `zodResolver` bắt phải khai `useForm<Input, Ctx, Output>`).
 *
 * Router gọi `.parse()` rồi để `ZodError` bay lên; `errorHandler` có nhánh riêng
 * đổi nó thành 400 kèm map lỗi theo trường.
 */

/**
 * `sort` cố ý để `z.string()` chứ không phải `z.enum(MEMBER_SORT_KEYS)`.
 *
 * Việc đối chiếu whitelist giao cho `resolveSortColumn` để có thông báo lỗi do
 * ta viết ("Cột sắp xếp không hợp lệ"), thay vì chuỗi mặc định của zod vốn liệt
 * kê toàn bộ giá trị hợp lệ ra ngoài. Quan trọng hơn: nó giữ đúng một chỗ duy
 * nhất quyết định cột nào được phép đi vào `ORDER BY`.
 */
export const listUsersQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(100).optional(),
  role: z.enum(['admin', 'creator', 'viewer']).optional(),
  status: z.enum(['active', 'locked', 'removed']).optional(),
  sort: z.string().optional(),
});

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

/** Chỉ để nhắc rằng hai danh sách phải khớp nhau; không dùng lúc chạy. */
export const SORT_KEYS_FOR_DOCS = MEMBER_SORT_KEYS;

/**
 * Tạo thành viên (§3.4).
 *
 * Cố ý KHÔNG nhận mật khẩu: Admin không được đặt mật khẩu hộ người khác. Hệ
 * thống sinh mật khẩu tạm, trả về đúng một lần, và bắt người dùng đổi ngay lần
 * đăng nhập đầu (`must_change_password`).
 *
 * `jobTitle` tuỳ chọn vì tài khoản do Admin tạo không đi qua form đăng ký.
 */
export const createUserBodySchema = z.object({
  email: emailRule.transform((v) => v.trim().toLowerCase()),
  fullName: fullNameRule.transform((v) => v.trim().replace(/\s+/g, ' ')),
  role: z.enum(['admin', 'creator', 'viewer']),
  jobTitle: z.enum(JOB_TITLES).optional(),
});

export const updateRoleBodySchema = z.object({
  role: z.enum(['admin', 'creator', 'viewer']),
});

export const updateStatusBodySchema = z.object({
  isActive: z.boolean(),
});

/**
 * `:userId` trên URL.
 *
 * Ép sang số ở đây để mọi repository nhận đúng kiểu — truyền chuỗi '3' xuống
 * MySQL vẫn chạy (nó tự ép), nhưng so sánh `targetUserId === auth.userId` trong
 * luật chống-tự-sửa-mình sẽ luôn false vì '3' !== 3. Lỗi im lặng, và đúng ở chỗ
 * nguy hiểm nhất.
 */
export const userIdParamSchema = z.object({
  userId: z.coerce.number().int().positive(),
});

export const workspaceIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

/** Tên workspace dùng lại luật tên công ty: cùng ràng buộc, cùng thông báo. */
export const createWorkspaceBodySchema = z.object({
  name: companyNameRule.transform((v) => v.trim().replace(/\s+/g, ' ')),
  description: z.string().trim().max(500).optional(),
});

export const updateWorkspaceBodySchema = createWorkspaceBodySchema;
