import { ADMIN_ERROR_CODES, type AdminWorkspaceDto } from '@bi/shared';
import type { ResultSetHeader } from 'mysql2';

import { mysqlPool } from '../../config/mysql';
import * as adminWorkspacesRepo from '../../repositories/adminWorkspaces';
import { HttpError } from '../../utils/httpError';
import { slugifyOrFallback } from '../auth/slug';

export interface CreateWorkspaceInput {
  tenantId: number;
  name: string;
  description?: string | undefined;
  createdBy: number;
}

/**
 * Tạo workspace, tự né trùng slug — cùng cách `insertTenant` đang làm.
 *
 * `uq_workspaces_tenant_slug` chỉ duy nhất TRONG một tổ chức, nên hai công ty
 * cùng đặt tên "Kinh doanh" là bình thường; chỉ trùng trong cùng một tổ chức mới
 * phải né. Thử lần lượt `kinh-doanh`, `kinh-doanh-2`…
 *
 * Bắt `ER_DUP_ENTRY` rồi thử tiếp, thay vì SELECT kiểm tra trước: giữa SELECT và
 * INSERT luôn có khe hở cho hai request đồng thời, và ràng buộc UNIQUE mới là
 * thứ thật sự chặn.
 *
 * Lưu ý ràng buộc đó tính CẢ dòng đã xoá mềm — đó là lý do
 * `softDeleteWorkspace` đổi slug lúc xoá, nếu không thì tên cũ bị giữ vĩnh viễn
 * và mọi lần tạo lại đều phải mang hậu tố.
 */
export async function createWorkspace(input: CreateWorkspaceInput): Promise<AdminWorkspaceDto> {
  const base = slugifyOrFallback(input.name, 'khong-gian');

  for (let attempt = 1; attempt <= 20; attempt += 1) {
    const slug = attempt === 1 ? base : `${base}-${attempt}`;
    try {
      const [result] = await mysqlPool.query<ResultSetHeader>(
        `INSERT INTO workspaces (tenant_id, name, slug, description, created_by)
         VALUES (?, ?, ?, ?, ?)`,
        [input.tenantId, input.name, slug, input.description ?? null, input.createdBy],
      );

      const created = await adminWorkspacesRepo.findOne(mysqlPool, input.tenantId, result.insertId);
      if (!created) throw new Error('Vừa tạo workspace xong nhưng đọc lại không thấy');
      return created;
    } catch (err) {
      if (!isDuplicateSlug(err)) throw err;
      // Trùng slug -> thử hậu tố kế tiếp.
    }
  }

  throw new HttpError(
    409,
    ADMIN_ERROR_CODES.WORKSPACE_SLUG_EXHAUSTED,
    'Không tạo được định danh cho workspace. Thử đổi tên khác.',
  );
}

function isDuplicateSlug(err: unknown): boolean {
  if (!(err instanceof Error) || !('errno' in err)) return false;
  const { errno } = err as Error & { errno?: number };
  return errno === 1062 && err.message.includes('uq_workspaces_tenant_slug');
}
