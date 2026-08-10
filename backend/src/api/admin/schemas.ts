import { z } from 'zod';
import { TENANT_SORT_KEYS, USER_SORT_KEYS } from '../../repositories/platform';
import { paginationSchema } from '../../utils/pagination';

/**
 * Schema request của console hệ thống.
 *
 * Ở BACKEND chứ không phải `@bi/shared`, vì `paginationSchema` dùng
 * `z.coerce.number()` — query string luôn là chuỗi nên buộc phải ép kiểu, mà ép
 * kiểu là transform, và luật ghi trong `shared/src/auth.ts` là schema dùng chung
 * chỉ được validate chứ không transform.
 *
 * Router gọi `.parse()` rồi để `ZodError` bay lên; `errorHandler` có nhánh riêng
 * đổi nó thành 400 kèm map lỗi theo trường.
 *
 * `sort` cố ý để `z.string()` chứ không phải `z.enum(...)`: việc đối chiếu
 * whitelist giao cho `resolveSortColumn` để có thông báo lỗi do ta viết, và để
 * giữ đúng MỘT chỗ quyết định cột nào được đi vào `ORDER BY`.
 */

const statusFilter = z.enum(['active', 'locked']).optional();

export const listTenantsQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(100).optional(),
  status: statusFilter,
  sort: z.string().optional(),
});

export const listUsersQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(100).optional(),
  tenantId: z.coerce.number().int().positive().optional(),
  status: statusFilter,
  platformRole: z.enum(['superadmin', 'user']).optional(),
  sort: z.string().optional(),
});

export const listWorkspacesQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(100).optional(),
  tenantId: z.coerce.number().int().positive().optional(),
  status: statusFilter,
});

export const setActiveBodySchema = z.object({
  isActive: z.boolean(),
});

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

/** Chỉ để nhắc rằng hai danh sách whitelist phải khớp nhau; không dùng lúc chạy. */
export const SORT_KEYS_FOR_DOCS = { TENANT_SORT_KEYS, USER_SORT_KEYS };
