import type { PageResult } from '@bi/shared';
import { z } from 'zod';

export const MAX_PAGE_SIZE = 100;

/**
 * `PageResult` đã chuyển sang `@bi/shared` để frontend dùng đúng một kiểu với
 * backend. Re-export ở đây để những chỗ đang import từ file này không phải sửa,
 * và để người đọc thấy ngay nó nằm ở đâu.
 */
export type { PageResult };

/** Schema phân trang dùng chung cho danh sách user (§3.3) và workspace (§3.5). */
export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).default(20),
  order: z.enum(['asc', 'desc']).default('desc'),
});

/**
 * Đối chiếu tên cột sắp xếp với danh sách cho phép.
 *
 * BẮT BUỘC dùng hàm này, không được ghép thẳng `req.query.sort` vào SQL:
 * `ORDER BY` không tham số hoá được bằng dấu `?`, nên nội suy chuỗi từ query
 * string là lỗ hổng SQL injection kinh điển.
 *
 * Trả về `null` khi giá trị không hợp lệ để nơi gọi tự quyết định báo lỗi.
 */
export function resolveSortColumn<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T | null {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') return null;
  return (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

export function buildPageResult<T>(
  items: T[],
  total: number,
  page: number,
  pageSize: number,
): PageResult<T> {
  return {
    items,
    page,
    pageSize,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
  };
}
