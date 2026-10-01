import type { TenantRole } from '@bi/shared';

/**
 * Phạm vi WORKSPACE của người gọi — migration 40.
 *
 * ═══ Vì sao đây là một KIỂU chứ không phải một câu `if` ở tầng service ══════
 *
 * Trước migration 40, mọi truy vấn chỉ mang `WHERE tenant_id = ?`, và đó là
 * toàn bộ ranh giới: ai ở trong tổ chức thì thấy mọi thứ của tổ chức. Giờ cần
 * một ranh giới thứ hai — người này thấy những workspace nào — và câu hỏi là
 * đặt nó ở đâu.
 *
 * Đặt ở tầng service (`if (!duocVao(ws)) throw ...` trước mỗi lần đọc) thì có
 * 26 chỗ gọi theo id phải nhớ thêm một dòng, và chỗ nào quên thì KHÔNG có gì
 * báo: endpoint vẫn trả 200, chỉ là trả dữ liệu của phòng ban khác. Đây đúng
 * loại lỗi mà `repositories/workspaces.ts` đã ghi lại cho IDOR cấp tổ chức —
 * và câu trả lời ở đó vẫn đúng ở đây: **chữ ký hàm là thứ duy nhất bắt được
 * lỗi này lúc biên dịch**.
 *
 * Nên các hàm đọc theo id và các hàm liệt kê đổi tham số `tenantId: number`
 * thành `scope: WorkspaceScope`. Mọi chỗ gọi cũ thành lỗi `tsc` cho tới khi
 * được xem lại từng cái một. Không chỗ nào lọt bằng cách bị quên.
 *
 * ═══ Vì sao điều kiện nằm TRONG câu SQL ════════════════════════════════════
 *
 * Cùng lập luận với `AND created_by = ?` của §8 và `WHERE tenant_id = ?` khắp
 * nơi: đọc rồi mới kiểm ở tầng trên luôn để hở một khe giữa lúc kiểm và lúc
 * dùng, và nó còn kéo về bộ nhớ đúng những dòng ta vừa quyết định là không
 * được xem. Điều kiện nằm trong câu lệnh thì không có khe nào.
 */
export interface WorkspaceScope {
  tenantId: number;
  userId: number;
  /**
   * `true` = thấy MỌI workspace của tổ chức, không cần dòng nào trong
   * `workspace_members`.
   *
   * Chỉ admin tổ chức. Lý do nằm ở migration 40: admin là người đi gán quyền,
   * nên không được tự khoá mình ra khỏi workspace cuối cùng. Giữ nó là một CỜ
   * TÍNH RA TỪ VAI TRÒ thay vì gieo dòng cho admin, để hạ quyền một admin
   * xuống creator là mất quyền ngay — chứ không để lại một đống dòng cũ.
   */
  allWorkspaces: boolean;
}

/**
 * Dựng phạm vi từ thông tin đã xác thực.
 *
 * MỘT hàm duy nhất tính `allWorkspaces`, để luật "admin thấy tất cả" nằm ở đúng
 * một chỗ. Rải `role === 'admin'` ra các repository là cách hai chỗ lệch nhau
 * ngày ai đó thêm một vai trò thứ tư.
 *
 * ⚠️ `role` phải là vai trò TƯƠI do `requireFreshMembership` đọc lại từ database,
 * không phải vai trò trong JWT — nó có thể đã cũ tới 7 ngày. Mọi route của
 * `v1Router` đều đã qua middleware đó, nên `req.auth.role` ở đây là tươi.
 */
export function scopeOfAuth(auth: {
  tenantId: number;
  userId: number;
  role: TenantRole;
}): WorkspaceScope {
  return {
    tenantId: auth.tenantId,
    userId: auth.userId,
    allWorkspaces: auth.role === 'admin',
  };
}

/**
 * Mảnh `AND ...` giới hạn theo workspace người gọi vào được, cùng tham số của nó.
 *
 * ─── `column` KHÔNG BAO GIỜ đến từ request ─────────────────────────────────
 *
 * Nó được nội suy thẳng vào câu SQL nên nó là một đường chèn lệnh nếu lấy từ
 * client. Mọi chỗ gọi truyền một chuỗi HẰNG viết trong mã nguồn (`'r.workspace_id'`),
 * và `assertColumn` bên dưới biến giả định đó thành một bảo đảm — rẻ, và nó
 * đứng vững kể cả khi người sau gọi hàm này với một giá trị đọc từ chỗ khác.
 *
 * ─── Vì sao EXISTS chứ không phải JOIN ─────────────────────────────────────
 *
 * JOIN sang `workspace_members` sẽ NHÂN số dòng nếu khoá duy nhất có ngày nào
 * đó nới ra (ví dụ thêm vai trò riêng từng workspace), và triệu chứng là báo
 * cáo hiện hai lần — không phải lỗi quyền, nên không ai đi tìm ở đây. EXISTS
 * trả về đúng một câu đúng/sai và không đụng tới số dòng.
 *
 * ─── Admin: chuỗi RỖNG, không phải `AND 1=1` ───────────────────────────────
 *
 * Câu SQL của admin không có thêm điều kiện nào, nên kế hoạch thực thi của nó
 * y hệt trước migration 40 — không có rủi ro hiệu năng nào mới cho chính những
 * người hay chạy các màn tổng hợp nặng nhất.
 */
export function workspaceFilter(
  scope: WorkspaceScope,
  column: string,
): { sql: string; params: number[] } {
  if (scope.allWorkspaces) return { sql: '', params: [] };

  assertColumn(column);
  return {
    sql: ` AND EXISTS (SELECT 1 FROM workspace_members wm
             WHERE wm.workspace_id = ${column} AND wm.user_id = ?)`,
    params: [scope.userId],
  };
}

/**
 * Chặn ngay tại nguồn nếu `column` không phải một định danh cột thuần.
 *
 * Cùng khuôn với `assertPositiveInt` của `buildDdl.ts` và `cubeName.ts`: biến
 * một giả định ("chỗ gọi luôn truyền hằng số") thành một bảo đảm, với giá là
 * một biểu thức chính quy.
 */
function assertColumn(column: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/.test(column)) {
    throw new Error(`Tên cột không hợp lệ cho bộ lọc workspace: ${column}`);
  }
}
