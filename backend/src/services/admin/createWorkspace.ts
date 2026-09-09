import { ADMIN_ERROR_CODES, type AdminWorkspaceDto } from '@bi/shared';
import type { ResultSetHeader } from 'mysql2';

import { mysqlPool } from '../../config/mysql';
import * as adminWorkspacesRepo from '../../repositories/adminWorkspaces';
import { HttpError } from '../../utils/httpError';
import { slugifyOrFallback } from '../auth/slug';
import { kiemHanMuc } from '../billing/limits';

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
  /*
   * Hạn mức gói — §11.2. Đặt ở SERVICE chứ không ở route, và TRƯỚC vòng lặp.
   *
   * Trước vòng lặp vì đây là chỗ duy nhất chạy đúng một lần: đặt bên trong thì
   * mỗi lần né slug là một lần đếm lại, và tất cả trừ lần đầu đều thừa.
   *
   * Ở service vì `provisionTenant` INSERT thẳng vào `workspaces` không qua hàm
   * này — nghĩa là đường tạo tổ chức KHÔNG bị chặn, đúng ý: tổ chức mới luôn ở 0
   * workspace và gói Free cho 1, nên chặn ở đó là chặn người vừa bấm Đăng ký.
   *
   * ⚠️ Kiểm bằng `mysqlPool`, không có khoá, nên có khe hở giữa kiểm và ghi: hai
   * request song song có thể cùng thấy "còn một chỗ" và tạo ra 6 workspace ở gói
   * 5. Chấp nhận có ý thức, ba lý do: độ lệch tối đa bằng số request song song
   * trừ một và nó TỰ KHÉP LẠI ở lần tạo kế tiếp; không tốn tài nguyên vật lý nào;
   * và bọc transaction quanh vòng `try/catch ER_DUP_ENTRY` dưới đây là loại tinh
   * tế mà người sửa sau sẽ viết sai. Dung lượng và thành viên thì KHÁC — chúng có
   * khoá, xem `commit.ts` và `createMember.ts`.
   */
  await kiemHanMuc(mysqlPool, input.tenantId, 'workspaces', new Date());

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
