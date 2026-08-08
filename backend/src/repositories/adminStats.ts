import type { DailyCountPoint, TenantRole } from '@bi/shared';
import type { RowDataPacket } from 'mysql2';
import type { Db } from './db';

/** Số liệu cho bốn thẻ KPI + biểu đồ phân bổ vai trò của trang tổng quan (§3.2). */
export interface OverviewCounts {
  totalMembers: number;
  admins: number;
  lockedMembers: number;
  workspaces: number;
  roleCounts: Record<TenantRole, number>;
}

interface CountsRow extends RowDataPacket {
  total_members: number | null;
  admins: number | null;
  locked_members: number | null;
  workspaces: number | null;
  role_admin: number | null;
  role_creator: number | null;
  role_viewer: number | null;
}

/**
 * Bốn con số trong MỘT câu, một vòng đi về.
 *
 * Vì sao không `Promise.all` bốn câu COUNT: pool chỉ có `connectionLimit: 10`.
 * Bắn song song bốn câu là chiếm 4/10 connection của cả ứng dụng để tiết kiệm
 * cỡ nửa mili-giây — và trang tổng quan là thứ mọi admin mở đầu tiên, nên đó
 * đúng là lúc không nên bóp cổ pool.
 *
 * `SUM(<biểu thức boolean>)` thay cho nhiều COUNT: MySQL trả 1/0 cho biểu thức
 * so sánh, nên một lần quét memberships của một tổ chức là ra cả ba số. Riêng
 * workspaces nằm ở bảng khác nên phải là truy vấn con, nhưng nó đi theo
 * `idx_workspaces_tenant_deleted` nên gần như không tốn gì.
 *
 * BẪY: `SUM` trên tập rỗng trả về NULL chứ không phải 0. Một tổ chức chưa có ai
 * (không xảy ra qua luồng đăng ký, nhưng xảy ra được nếu dọn dữ liệu tay) sẽ cho
 * `null` và mọi phép tính phía sau thành NaN. Vì vậy có `?? 0`.
 */
export async function fetchOverviewCounts(db: Db, tenantId: number): Promise<OverviewCounts> {
  const [rows] = await db.query<CountsRow[]>(
    `SELECT
       SUM(m.removed_at IS NULL)                                          AS total_members,
       SUM(m.removed_at IS NULL AND m.role = 'admin' AND m.is_active = 1) AS admins,
       SUM(m.removed_at IS NULL AND (m.is_active = 0 OR u.is_active = 0)) AS locked_members,
       SUM(m.removed_at IS NULL AND m.role = 'admin')                     AS role_admin,
       SUM(m.removed_at IS NULL AND m.role = 'creator')                   AS role_creator,
       SUM(m.removed_at IS NULL AND m.role = 'viewer')                    AS role_viewer,
       (SELECT COUNT(*) FROM workspaces w
         WHERE w.tenant_id = ? AND w.deleted_at IS NULL)                  AS workspaces
     FROM memberships m
     JOIN users u ON u.id = m.user_id AND u.deleted_at IS NULL
    WHERE m.tenant_id = ?`,
    [tenantId, tenantId],
  );

  const row = rows[0];
  return {
    totalMembers: Number(row?.total_members ?? 0),
    admins: Number(row?.admins ?? 0),
    lockedMembers: Number(row?.locked_members ?? 0),
    workspaces: Number(row?.workspaces ?? 0),
    // Ba con số này KHÁC `admins` ở trên: `admins` chỉ đếm quản trị viên còn
    // hoạt động (dùng cho thẻ KPI và luật admin-cuối-cùng), còn đây là phân bổ
    // vai trò của MỌI người còn trong tổ chức, kể cả người đang bị khoá — biểu
    // đồ cơ cấu nhân sự mà bỏ người bị khoá ra thì tổng không khớp thẻ "Tổng
    // người dùng" và trông như lỗi.
    roleCounts: {
      admin: Number(row?.role_admin ?? 0),
      creator: Number(row?.role_creator ?? 0),
      viewer: Number(row?.role_viewer ?? 0),
    },
  };
}

interface DailyRow extends RowDataPacket {
  d: string;
  c: number;
}

/**
 * Thành viên mới theo ngày, trong `rangeDays` ngày gần nhất.
 *
 * Đây là chuỗi thời gian DUY NHẤT mà schema hiện tại đỡ được một cách trung
 * thực: không có bảng sự kiện, không có audit log, và `users.last_login_at` bị
 * ghi đè mỗi lần đăng nhập nên không phải lịch sử. Thứ duy nhất biến thiên theo
 * thời gian là các cột `created_at`.
 *
 * `DATE()` chạy theo `time_zone` của session, mà `config/mysql.ts` ghim mọi
 * connection về `+00:00` — nên đây là NGÀY UTC. Giao diện phải ghi rõ điều đó
 * hoặc quy đổi nhất quán, không được lẳng lặng hiển thị như giờ địa phương.
 *
 * Ngày không có ai vào thì MySQL không trả dòng nào; việc lấp đầy làm ở
 * `fillDailyGaps` bên dưới — dùng recursive CTE để lấp trong SQL thì tốn công
 * đọc hơn nhiều so với một vòng lặp JavaScript.
 */
export async function fetchNewMembersDaily(
  db: Db,
  tenantId: number,
  rangeDays: number,
): Promise<DailyCountPoint[]> {
  const since = new Date(Date.now() - rangeDays * 86_400_000);
  const [rows] = await db.query<DailyRow[]>(
    `SELECT DATE(m.created_at) AS d, COUNT(*) AS c
       FROM memberships m
      WHERE m.tenant_id = ? AND m.created_at >= ?
      GROUP BY d
      ORDER BY d`,
    [tenantId, since],
  );

  // Cột DATE trả về chuỗi 'YYYY-MM-DD' nhờ `dateStrings: ['DATE']` trong
  // config/mysql.ts — không cần định dạng lại, và cũng không bị đổi múi giờ.
  const found = new Map(rows.map((row) => [String(row.d), Number(row.c)]));
  return fillDailyGaps(found, rangeDays);
}

/**
 * Lấp những ngày không có dữ liệu bằng 0.
 *
 * Không lấp thì biểu đồ đường sẽ nối thẳng qua khoảng trống, khiến "hai tuần
 * không có ai vào" trông giống "tăng đều" — sai lệch theo hướng có lợi, đúng
 * kiểu dễ bị tin.
 */
export function fillDailyGaps(counts: Map<string, number>, rangeDays: number): DailyCountPoint[] {
  const points: DailyCountPoint[] = [];
  const today = Date.now();

  for (let i = rangeDays - 1; i >= 0; i--) {
    const date = new Date(today - i * 86_400_000).toISOString().slice(0, 10);
    points.push({ date, count: counts.get(date) ?? 0 });
  }
  return points;
}
