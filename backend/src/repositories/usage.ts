import type { RowDataPacket } from 'mysql2';

import type { Db } from './db';

/**
 * Đo mức sử dụng của một tổ chức — §11.
 *
 * ═══ MỘT chỗ duy nhất, và đó là chủ ý ══════════════════════════════════════
 *
 * Bốn con số dưới đây được hỏi từ nhiều nơi: trang Billing, console vận hành, và
 * từ §11.2 là LỚP CHẶN hạn mức. Bản sai của câu tính dung lượng rất dễ viết và
 * trông hoàn toàn hợp lý (xem ghi chú ở `demDungLuong`), nên để nó lặp lại ở ba
 * nơi là bảo đảm sẽ có ba câu trả lời khác nhau cho cùng một tổ chức.
 *
 * ═══ Vì sao tách thành bốn hàm rời ═════════════════════════════════════════
 *
 * `fetchTenantUsage` chạy cả bốn câu đếm — đúng cho trang Billing, vốn vẽ cả bốn
 * thanh. Nhưng lớp chặn chỉ cần MỘT con số: kiểm hạn mức workspace không có lý
 * do gì để đếm cả báo cáo, thành viên và dung lượng, và nó chạy ở mỗi lần tạo.
 *
 * Nên bốn hàm rời là nguồn thật, còn `fetchTenantUsage` chỉ gộp chúng lại. Câu
 * SQL vẫn nằm đúng một chỗ cho mỗi con số.
 */

export interface TenantUsage {
  workspaces: number;
  reports: number;
  members: number;
  storageBytes: number;
}

/**
 * `SUM()` của MySQL trả về DECIMAL, mà pool không bật `decimalNumbers`.
 *
 * Nghĩa là nó về Node dưới dạng CHUỖI, và `usedBytes + newBytes` thành phép nối
 * chuỗi — `"5368709120" + "104857600"` cho ra `"5368709120104857600"`. Chạy
 * được, hiện ra màn hình được, và sai.
 *
 * `COUNT()` thì trả BIGINT và mysql2 cho ra number, nhưng vẫn đi qua hàm này để
 * không ai phải nhớ cái nào là cái nào.
 */
function toNumber(value: unknown): number {
  return Number(value ?? 0);
}

export async function demWorkspace(db: Db, tenantId: number): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>(
    'SELECT COUNT(*) AS n FROM workspaces WHERE tenant_id = ? AND deleted_at IS NULL',
    [tenantId],
  );
  return toNumber(rows[0]?.['n']);
}

export async function demBaoCao(db: Db, tenantId: number): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>(
    'SELECT COUNT(*) AS n FROM reports WHERE tenant_id = ? AND deleted_at IS NULL',
    [tenantId],
  );
  return toNumber(rows[0]?.['n']);
}

/**
 * Thành viên đang chiếm CHỖ trong tổ chức.
 *
 * `memberships` cố ý phân biệt ba trạng thái (migration 2), và hạn mức tính hai
 * trong ba:
 *
 *   is_active=1, removed_at=NULL      thành viên bình thường      ← đếm
 *   is_active=0, removed_at=NULL      bị khoá tạm, còn trong DS   ← ĐẾM
 *   is_active=0, removed_at=<lúc gỡ>  đã gỡ khỏi tổ chức          ← không đếm
 *
 * ═══ Vì sao ĐẾM CẢ người đang bị khoá ══════════════════════════════════════
 *
 * Không phải vì họ đang dùng gì — họ không đăng nhập được. Mà vì khoá là trạng
 * thái TẠM và đảo ngược bằng đúng một request: `PATCH /v1/members/:id/status`
 * với `isActive: true`.
 *
 * Nếu người bị khoá không chiếm chỗ thì tổ chức đầy chỗ chỉ cần khoá bớt vài
 * người, mời thêm người mới, rồi mở khoá lại — và hạn mức thành một gợi ý. Bịt
 * bằng cách gắn thêm một guard ở đường mở khoá thì được, nhưng đếm theo CHỖ làm
 * cho vấn đề biến mất thay vì phải canh: mở khoá không làm con số này đổi, nên
 * không có gì để lách.
 *
 * ═══ Và nó khớp đúng con số người dùng NHÌN THẤY ═══════════════════════════
 *
 * Bộ lọc này (`removed_at IS NULL` + `u.deleted_at IS NULL`) giống hệt
 * `buildWhere` của `adminMembers.ts:138-147` khi không lọc trạng thái — tức là
 * đúng tổng số dòng ở màn hình Thành viên. Hạn mức phải đếm đúng thứ khách đang
 * nhìn, nếu không thì "9/10 thành viên" trên màn hình mà mời người thứ 10 bị
 * chặn, và không ai giải thích được.
 *
 * ⚠️ `JOIN users` để loại tài khoản đã xoá mềm ở cấp nền tảng: một membership
 * trỏ tới người không đăng nhập được nữa thì không nên giữ chỗ của ai.
 *
 * ⚠️ Bỏ `removed_at IS NULL` thì người đã gỡ vẫn bị tính, và tổ chức chạm hạn
 * mức vì những người không còn ở đó — lỗi rất khó nhìn ra, vì danh sách thành
 * viên hiện ĐÚNG và chỉ con số hạn mức là sai.
 */
export async function demThanhVien(db: Db, tenantId: number): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS n
       FROM memberships m
       JOIN users u ON u.id = m.user_id
      WHERE m.tenant_id = ? AND m.removed_at IS NULL AND u.deleted_at IS NULL`,
    [tenantId],
  );
  return toNumber(rows[0]?.['n']);
}

/**
 * Dung lượng đang chiếm, đơn vị byte.
 *
 * ⚠️ KHÔNG được `SUM(file_size_bytes)` thẳng.
 *
 * Một file Excel nhiều sheet sinh ra NHIỀU dòng `datasets` dùng CHUNG một object
 * trên MinIO — `s3_key` cố ý không UNIQUE, xem migration 8. Cộng thẳng thì một
 * file 50MB ba sheet được tính thành 150MB, và khách bị báo vượt hạn mức vì một
 * phép cộng chứ không vì dữ liệu của họ.
 *
 * Nên gom theo OBJECT LƯU TRỮ trước rồi mới cộng.
 *
 * `COALESCE(s3_key, CONCAT('ds:', id))` xử lý bộ dữ liệu nguồn `connection`:
 * chúng không có `s3_key` và `file_size_bytes = 0` (nền tảng không giữ dòng nào
 * trên S3). Không có COALESCE thì mọi dataset nguồn connection gộp chung vào một
 * nhóm NULL — vô hại vì chúng đều bằng 0, nhưng chỉ đúng do may mắn, và sẽ sai
 * ngay ngày cột đó mang giá trị khác.
 *
 * `MAX` chứ không `AVG` hay lấy dòng đầu: ba sheet của cùng một file đều ghi
 * đúng kích thước file, nhưng MAX vẫn ra đúng nếu có dòng ghi 0.
 */
export async function demDungLuong(db: Db, tenantId: number): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(t.sz), 0) AS n
       FROM (
         SELECT COALESCE(s3_key, CONCAT('ds:', id)) AS k,
                MAX(file_size_bytes) AS sz
           FROM datasets
          WHERE tenant_id = ? AND deleted_at IS NULL
          GROUP BY k
       ) t`,
    [tenantId],
  );
  return toNumber(rows[0]?.['n']);
}

/**
 * Dung lượng ĐÃ ghi nhận cho một object lưu trữ.
 *
 * Dùng để tính phần THÊM THẬT khi commit: `demDungLuong` gom theo `s3_key`, nên
 * nếu khoá này đã có số byte thì số đó ĐÃ nằm trong tổng. Cộng thẳng kích thước
 * file vào lần commit thứ hai là tính đôi, và khách bị báo vượt hạn mức vì một
 * phép cộng chứ không vì dữ liệu của họ — đúng loại lỗi mà `demDungLuong` đã
 * cảnh báo một lần rồi.
 *
 * `MAX` chứ không `SUM`: nhiều sheet cùng một khoá đều ghi đúng kích thước file,
 * nên cộng chúng lại là dựng lại chính cái bẫy đó.
 */
export async function dungLuongDaGhi(db: Db, tenantId: number, s3Key: string): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT COALESCE(MAX(file_size_bytes), 0) AS n
       FROM datasets
      WHERE tenant_id = ? AND s3_key = ? AND deleted_at IS NULL`,
    [tenantId, s3Key],
  );
  return toNumber(rows[0]?.['n']);
}

/**
 * Cả bốn con số. Dùng cho trang Billing và console vận hành.
 *
 * Tuần tự chứ không `Promise.all`: pool chỉ có 10 connection, và tiết kiệm vài
 * mili-giây bằng cách chiếm gấp bốn connection là đổi chác sai chiều — cùng lập
 * luận đã ghi ở `buildBillingSummary` và `GET /admin/overview`.
 */
export async function fetchTenantUsage(db: Db, tenantId: number): Promise<TenantUsage> {
  return {
    workspaces: await demWorkspace(db, tenantId),
    reports: await demBaoCao(db, tenantId),
    members: await demThanhVien(db, tenantId),
    storageBytes: await demDungLuong(db, tenantId),
  };
}
