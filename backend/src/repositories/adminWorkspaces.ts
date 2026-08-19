import type { AdminWorkspaceDto } from '@bi/shared';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import type { Db } from './db';

/**
 * Thao tác workspace trong PHẠM VI MỘT TỔ CHỨC (§4.5, §4.6).
 *
 * Tách khỏi `repositories/workspaces.ts` vì file đó phục vụ luồng đăng ký và
 * seed — nó chỉ đọc/tạo, và cố ý không có hàm nào sửa hay xoá. Các hàm ở đây
 * cần transaction và cần `Db` truyền vào, nên trộn chung sẽ thành hai quy ước
 * chữ ký trong một file.
 *
 * Cũng khác hẳn `repositories/platform.ts`: file đó nhìn xuyên mọi tổ chức cho
 * console vận hành. Ở đây `tenantId` luôn đứng ngay sau executor và mọi câu lệnh
 * đều lọc theo nó.
 *
 * ─── Vì sao trả về cả workspace đang bị khoá ────────────────────────────────
 *
 * Migration 3 thêm `workspaces.is_active` cho console hệ thống: superadmin tạm
 * ngừng được một workspace mà không xoá. Nếu ở đây lọc `is_active = 1`, workspace
 * bị khoá sẽ BIẾN MẤT khỏi màn quản lý của admin tổ chức — họ thấy dữ liệu tự
 * dưng hụt đi mà không có lời giải thích nào. Nên trả về đủ kèm cờ `isActive`, để
 * giao diện nói thẳng "đang bị khoá bởi quản trị hệ thống". Riêng bộ chuyển
 * workspace (§4.6) mới là chỗ loại chúng ra.
 */

interface WorkspaceListRow extends RowDataPacket {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  is_active: number;
  created_at: Date;
  report_count: number;
}

/*
 * Đếm bằng CÂU CON, không phải `LEFT JOIN` + `GROUP BY`.
 *
 * Bản trước đếm project bằng phép nối, và phải kéo theo một hằng `GROUP_BY`
 * liệt kê lại mọi cột — thêm một cột vào danh sách là phải nhớ sửa hai chỗ.
 * Câu con giữ nguyên "một workspace một dòng" nên không cần gộp nhóm gì cả.
 */
const SELECT_LIST = `SELECT w.id, w.name, w.slug, w.description, w.is_active, w.created_at,
            (SELECT COUNT(*) FROM reports r
              WHERE r.workspace_id = w.id
                AND r.tenant_id = w.tenant_id
                AND r.deleted_at IS NULL) AS report_count
       FROM workspaces w`;

function toDto(row: WorkspaceListRow): AdminWorkspaceDto {
  return {
    id: Number(row.id),
    name: row.name,
    slug: row.slug,
    description: row.description,
    isActive: row.is_active === 1,
    reportCount: Number(row.report_count),
    createdAt: row.created_at.toISOString(),
  };
}

/**
 * Danh sách workspace kèm số BÁO CÁO còn sống.
 *
 * Một câu chứ không phải đếm từng cái trong vòng lặp: mười workspace là mười
 * vòng đi về database, và đó đúng là kiểu N+1 lặng lẽ trở thành vấn đề khi dữ
 * liệu lớn dần mà không ai để ý.
 */
export async function listWithReportCount(
  db: Db,
  tenantId: number,
): Promise<AdminWorkspaceDto[]> {
  const [rows] = await db.query<WorkspaceListRow[]>(
    `${SELECT_LIST}
      WHERE w.tenant_id = ? AND w.deleted_at IS NULL
      ORDER BY w.name ASC`,
    [tenantId],
  );
  return rows.map(toDto);
}

export async function findOne(
  db: Db,
  tenantId: number,
  id: number,
): Promise<AdminWorkspaceDto | null> {
  const [rows] = await db.query<WorkspaceListRow[]>(
    `${SELECT_LIST}
      WHERE w.tenant_id = ? AND w.id = ? AND w.deleted_at IS NULL
      LIMIT 1`,
    [tenantId, id],
  );
  const row = rows[0];
  return row ? toDto(row) : null;
}

/**
 * Đổi tên và mô tả. CỐ Ý KHÔNG đụng tới `slug`.
 *
 * Slug là định danh trong URL. Đổi tên workspace mà viết lại slug là làm hỏng
 * mọi đường dẫn đã được lưu, chia sẻ, hay đánh dấu — một thao tác nghe vô hại
 * ("sửa lỗi chính tả cái tên") lại phá link của cả nhóm. Muốn đổi slug thì phải
 * là một hành động riêng, có cảnh báo riêng.
 */
export async function renameWorkspace(
  db: Db,
  tenantId: number,
  id: number,
  input: { name: string; description: string | null },
): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    `UPDATE workspaces SET name = ?, description = ?
      WHERE tenant_id = ? AND id = ? AND deleted_at IS NULL`,
    [input.name, input.description, tenantId, id],
  );
  return result.affectedRows;
}

/**
 * Số NỘI DUNG còn sống trong workspace — dùng để chặn xoá workspace không rỗng.
 *
 * Trước khi bỏ project, hàm này đếm project. Nay nó đếm báo cáo và bộ dữ liệu,
 * tức là đúng hai thứ người dùng sẽ mất đường vào nếu workspace biến mất. Không
 * đếm mô hình dữ liệu: mô hình không chứa số liệu, và nó luôn đi kèm ít nhất
 * một bộ dữ liệu vốn đã được đếm ở đây.
 */
export async function countLiveContent(
  db: Db,
  tenantId: number,
  id: number,
): Promise<{ reports: number; datasets: number }> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT
       (SELECT COUNT(*) FROM reports
         WHERE tenant_id = ? AND workspace_id = ? AND deleted_at IS NULL) AS reports,
       (SELECT COUNT(*) FROM datasets
         WHERE tenant_id = ? AND workspace_id = ? AND deleted_at IS NULL) AS datasets`,
    [tenantId, id, tenantId, id],
  );
  return {
    reports: Number(rows[0]?.['reports'] ?? 0),
    datasets: Number(rows[0]?.['datasets'] ?? 0),
  };
}

/** Số workspace còn sống — dùng để chặn xoá cái CUỐI CÙNG của tổ chức. */
export async function countLiveWorkspaces(db: Db, tenantId: number): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>(
    'SELECT COUNT(*) AS total FROM workspaces WHERE tenant_id = ? AND deleted_at IS NULL',
    [tenantId],
  );
  return Number(rows[0]?.['total'] ?? 0);
}

/**
 * Xoá mềm, ĐỒNG THỜI giải phóng slug.
 *
 * `uq_workspaces_tenant_slug` tính cả những dòng đã xoá mềm, nên nếu chỉ đặt
 * `deleted_at` thì slug cũ bị giữ vĩnh viễn: xoá "Kinh doanh" rồi tạo lại sẽ ra
 * `kinh-doanh-2`, xoá tiếp lại ra `kinh-doanh-3`, không bao giờ về lại được tên
 * sạch. Đổi slug thành `<cũ>-del-<id>` trả lại tên cho lần tạo sau.
 *
 * `LEFT(slug, 80)` vì cột chỉ có 100 ký tự và hậu tố cần chỗ.
 */
export async function softDeleteWorkspace(db: Db, tenantId: number, id: number): Promise<number> {
  const [result] = await db.query<ResultSetHeader>(
    `UPDATE workspaces
        SET deleted_at = CURRENT_TIMESTAMP(3),
            slug = CONCAT(LEFT(slug, 80), '-del-', id)
      WHERE tenant_id = ? AND id = ? AND deleted_at IS NULL`,
    [tenantId, id],
  );
  return result.affectedRows;
}
