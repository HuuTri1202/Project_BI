import type { ResultSetHeader, RowDataPacket } from 'mysql2';

import type { Db } from './db';

/**
 * Ai vào được workspace nào — migration 40.
 *
 * ═══ Bảng này KHÔNG nói về vai trò ════════════════════════════════════════
 *
 * `memberships.role` nói người này được LÀM GÌ; bảng này nói họ làm được việc
 * đó Ở ĐÂU. Hai trục tách bạch, và nhầm chúng vào nhau là cách sinh ra câu
 * "viewer thì chặn bớt dữ liệu đi" — một câu nghe hợp lý nhưng sai: vai trò
 * giới hạn HÀNH ĐỘNG, không giới hạn DỮ LIỆU.
 *
 * ═══ Admin không có dòng ở đây ════════════════════════════════════════════
 *
 * Xem ghi chú dài ở migration 40. Tóm tắt: quyền của admin là một CỜ tính ra từ
 * vai trò (`WorkspaceScope.allWorkspaces`), không phải dữ liệu gieo sẵn — nhờ
 * vậy hạ quyền một admin là mất quyền ngay, không để lại dòng cũ.
 *
 * Hệ quả phải nhớ khi đọc hàm bên dưới: `listWorkspaceIds` của một admin trả về
 * MẢNG RỖNG, và mảng rỗng đó KHÔNG có nghĩa "không vào được gì". Mọi chỗ quyết
 * định phải hỏi `scope.allWorkspaces` trước — đó là lý do `workspaceFilter` tồn
 * tại và là đường duy nhất nên dùng để lọc.
 */

interface IdRow extends RowDataPacket {
  workspace_id: number;
}

/** Những workspace một người được gán — KHÔNG kể luật admin. Xem ghi chú đầu file. */
export async function listWorkspaceIds(
  db: Db,
  tenantId: number,
  userId: number,
): Promise<number[]> {
  const [rows] = await db.query<IdRow[]>(
    `SELECT workspace_id FROM workspace_members
      WHERE tenant_id = ? AND user_id = ?
      ORDER BY workspace_id`,
    [tenantId, userId],
  );
  return rows.map((r) => Number(r.workspace_id));
}

interface MemberIdRow extends RowDataPacket {
  workspace_id: number;
  user_id: number;
}

/**
 * Bảng gán của NHIỀU người trong một lượt — cho danh sách Thành viên.
 *
 * Hỏi một lần cho cả trang thay vì một lần mỗi dòng: một trang 50 thành viên
 * mà hỏi từng người là 50 vòng tới database cho một cái bảng. Cùng lập luận với
 * việc nạp chỉ mục mô hình một lần cho cả khung ở §10.14.
 */
export async function mapWorkspaceIds(
  db: Db,
  tenantId: number,
  userIds: readonly number[],
): Promise<Map<number, number[]>> {
  const map = new Map<number, number[]>();
  if (userIds.length === 0) return map;

  const [rows] = await db.query<MemberIdRow[]>(
    `SELECT workspace_id, user_id FROM workspace_members
      WHERE tenant_id = ? AND user_id IN (${userIds.map(() => '?').join(', ')})
      ORDER BY workspace_id`,
    [tenantId, ...userIds],
  );

  for (const row of rows) {
    const userId = Number(row.user_id);
    const list = map.get(userId) ?? [];
    list.push(Number(row.workspace_id));
    map.set(userId, list);
  }
  return map;
}

/** Người này có vào được workspace này không — KHÔNG kể luật admin. */
export async function isMember(
  db: Db,
  tenantId: number,
  userId: number,
  workspaceId: number,
): Promise<boolean> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT 1 FROM workspace_members
      WHERE tenant_id = ? AND user_id = ? AND workspace_id = ? LIMIT 1`,
    [tenantId, userId, workspaceId],
  );
  return rows.length > 0;
}

/**
 * Đặt LẠI toàn bộ danh sách workspace của một người.
 *
 * ─── Vì sao THAY CẢ BỘ chứ không phải thêm/bớt từng cái ────────────────────
 *
 * Giao diện là một danh sách có ô tích: người dùng nhìn thấy trạng thái cuối
 * cùng họ muốn, không nhìn thấy từng thao tác. Gửi lên "thêm cái này, bỏ cái
 * kia" nghĩa là giao diện phải tự tính hiệu, và hai tab mở cùng lúc sẽ tính ra
 * hai cái hiệu khác nhau trên cùng một trạng thái gốc — cái sau ghi đè cái
 * trước theo kiểu không ai đoán được.
 *
 * Gửi cả bộ thì thao tác là IDEMPOTENT: lưu hai lần cho ra cùng một kết quả.
 *
 * ⚠️ PHẢI gọi trong một transaction. Xoá xong mà chèn hỏng thì người đó mất
 * sạch quyền — và đó là trạng thái không ai nhìn thấy cho tới khi họ đăng nhập
 * và không thấy workspace nào.
 */
export async function replaceForUser(
  db: Db,
  tenantId: number,
  userId: number,
  workspaceIds: readonly number[],
  grantedBy: number | null,
): Promise<void> {
  await db.query<ResultSetHeader>(
    `DELETE FROM workspace_members WHERE tenant_id = ? AND user_id = ?`,
    [tenantId, userId],
  );

  if (workspaceIds.length === 0) return;

  const values = workspaceIds.map(() => '(?, ?, ?, ?)').join(', ');
  const params = workspaceIds.flatMap((wsId) => [tenantId, wsId, userId, grantedBy]);

  /*
   * Khoá ngoại ghép `(tenant_id, workspace_id)` là thứ chặn một id workspace
   * của tổ chức KHÁC lọt vào đây — và nó chặn ở tầng database, nên đúng kể cả
   * khi tầng trên quên kiểm. Lỗi khoá ngoại nổi lên thành 500, chấp nhận được
   * cho một ca chỉ xảy ra khi có người sửa request bằng tay.
   */
  await db.query<ResultSetHeader>(
    `INSERT INTO workspace_members (tenant_id, workspace_id, user_id, created_by)
     VALUES ${values}`,
    params,
  );
}

/**
 * Gán một người vào một workspace — dùng khi vừa tạo workspace.
 *
 * `INSERT IGNORE` vì gán lại không phải lỗi: người tạo workspace có thể đã được
 * gán sẵn bởi một đường khác, và ném lỗi ở đó sẽ làm hỏng việc tạo workspace vì
 * một chuyện không ai quan tâm.
 */
export async function grant(
  db: Db,
  tenantId: number,
  workspaceId: number,
  userId: number,
  grantedBy: number | null,
): Promise<void> {
  await db.query<ResultSetHeader>(
    `INSERT IGNORE INTO workspace_members (tenant_id, workspace_id, user_id, created_by)
     VALUES (?, ?, ?, ?)`,
    [tenantId, workspaceId, userId, grantedBy],
  );
}
