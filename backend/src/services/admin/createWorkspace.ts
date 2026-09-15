import { ADMIN_ERROR_CODES, type AdminWorkspaceDto } from '@bi/shared';
import type { ResultSetHeader } from 'mysql2';

import { mysqlPool } from '../../config/mysql';
import * as adminWorkspacesRepo from '../../repositories/adminWorkspaces';
import { HttpError } from '../../utils/httpError';
import { slugifyOrFallback } from '../auth/slug';
import { trongHanMuc } from '../billing/limits';

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

  /*
   * Hạn mức gói — §11.2. Đặt ở SERVICE chứ không ở route.
   *
   * Ở service vì `provisionTenant` INSERT thẳng vào `workspaces` không qua hàm
   * này — nghĩa là đường tạo tổ chức KHÔNG bị chặn, đúng ý: tổ chức mới luôn ở 0
   * workspace và gói Free cho 1, nên chặn ở đó là chặn người vừa bấm Đăng ký.
   *
   * Khoá, kiểm và cả vòng né slug nằm trong CÙNG một transaction (`trongHanMuc`).
   * Bản trước kiểm trên pool và chấp nhận khe hở "tự khép lại ở lần sau"; đo
   * được năm request cùng lúc ở hạn mức 2 tạo cả năm workspace — tức hạn mức
   * không chặn gì cả khi người ta bấm nhanh.
   *
   * Vòng `try/catch ER_DUP_ENTRY` vẫn đúng trong transaction: InnoDB chỉ huỷ CÂU
   * lệnh trùng khoá, không huỷ cả transaction, nên lần thử kế tiếp chạy tiếp trên
   * cùng connection và cùng khoá. Kiểm chỉ chạy một lần, trước vòng lặp.
   */
  const id = await trongHanMuc(input.tenantId, 'workspaces', async (conn) => {
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      const slug = attempt === 1 ? base : `${base}-${attempt}`;
      try {
        const [result] = await conn.query<ResultSetHeader>(
          `INSERT INTO workspaces (tenant_id, name, slug, description, created_by)
           VALUES (?, ?, ?, ?, ?)`,
          [input.tenantId, input.name, slug, input.description ?? null, input.createdBy],
        );
        return result.insertId;
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
  });

  // Đọc lại SAU khi commit, trên pool: trong transaction thì connection khác
  // chưa thấy dòng mới, và `findOne` là repository đọc bình thường.
  const created = await adminWorkspacesRepo.findOne(mysqlPool, input.tenantId, id);
  if (!created) throw new Error('Vừa tạo workspace xong nhưng đọc lại không thấy');
  return created;
}

function isDuplicateSlug(err: unknown): boolean {
  if (!(err instanceof Error) || !('errno' in err)) return false;
  const { errno } = err as Error & { errno?: number };
  return errno === 1062 && err.message.includes('uq_workspaces_tenant_slug');
}
