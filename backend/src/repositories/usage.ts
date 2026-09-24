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

/**
 * Báo cáo chiếm chỗ = báo cáo người dùng còn THẤY và còn xoá được.
 *
 * Tới bản này câu đếm chỉ lọc `reports.deleted_at`. Nhưng xoá mềm một mô hình,
 * một bộ dữ liệu hay một workspace KHÔNG xoá báo cáo dựng trên nó — chỉ làm nó
 * biến khỏi danh sách (xem `buildWhere` ở `repositories/reports.ts`). Đo trên
 * máy dev: một tổ chức bị tính 11 báo cáo mà danh sách hiện 3; tổ chức seed bị
 * tính 5 mà hiện 0. Khi hạn mức được chặn thật, tổ chức Miễn phí đó không tạo
 * nổi một báo cáo nào và không có gì trên màn hình để xoá cho bớt.
 *
 * Nên điều kiện ở đây là ĐÚNG bộ điều kiện của danh sách, thêm workspace. Cùng
 * mẹo `LEFT JOIN` + `IS NULL`: báo cáo dựng trên mô hình không có dòng
 * `datasets`, `d.deleted_at` ra NULL và vế đó tự bỏ qua.
 */
export async function demBaoCao(db: Db, tenantId: number): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS n
       FROM reports r
       JOIN workspaces w ON w.id = r.workspace_id
       LEFT JOIN datasets d ON d.id = r.dataset_id
       LEFT JOIN datamodels dm ON dm.id = r.datamodel_id
      WHERE r.tenant_id = ?
        AND r.deleted_at IS NULL
        AND w.deleted_at IS NULL
        AND d.deleted_at IS NULL
        AND dm.deleted_at IS NULL`,
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
 * Dung lượng đang chiếm, đơn vị byte — chỗ trong KHO, không phải kích thước FILE.
 *
 * ═══ Đo cái gì, và vì sao đổi ══════════════════════════════════════════════
 *
 * Tới migration 38 câu này cộng `file_size_bytes`. Đo trên máy dev thì không tổ
 * chức nào được tính đúng: bộ dữ liệu nguồn `connection` không có file nên tiêu
 * đúng 0 byte hạn mức dù đồng bộ bao nhiêu dòng cũng được, còn file thì bị tính
 * cả phần sẽ được nén đi (7,82 MB tính cho 4,65 MB thật). Hạn mức của gói nói về
 * chỗ dữ liệu CHIẾM, nên nó đo đúng chỗ đó — xem
 * `services/ingest/warehouseSize.ts`.
 *
 * ═══ Cộng THẲNG, và cái bẫy cũ biến mất ════════════════════════════════════
 *
 * Bản cũ phải gom theo `s3_key` trước khi cộng, vì một file Excel nhiều sheet
 * sinh nhiều dòng `datasets` dùng chung một object trên MinIO (migration 8) —
 * cộng thẳng là tính một file 50MB ba sheet thành 150MB.
 *
 * Trong kho thì mỗi bộ dữ liệu có bảng `raw_t{tenant}_d{dataset}` của RIÊNG nó,
 * không bộ nào dùng chung với bộ nào. Nên phép cộng ở đây không có gì để tính
 * đôi, và cái bẫy ấy biến mất thay vì phải canh bằng một câu GROUP BY.
 *
 * ⚠️ `deleted_at IS NULL` — bộ đã xoá mềm KHÔNG tính, dù bảng của nó còn nằm
 * trên đĩa. Lý do đầy đủ ở `warehouseSize.ts`: "xoá bớt bộ dữ liệu cũ" là lối
 * thoát duy nhất khỏi hạn mức, nên nó phải làm con số giảm thật.
 */
export async function demDungLuong(db: Db, tenantId: number): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT COALESCE(SUM(warehouse_bytes), 0) AS n
       FROM datasets
      WHERE tenant_id = ? AND deleted_at IS NULL`,
    [tenantId],
  );
  return toNumber(rows[0]?.['n']);
}

/**
 * Dung lượng ĐÃ ghi nhận cho một bộ dữ liệu.
 *
 * Dùng để tính phần THÊM THẬT khi nạp lại: bảng mới THAY bảng cũ (`EXCHANGE
 * TABLES` ở `loadDataset`), nên chỗ cũ được trả lại. Cộng nguyên kích thước bảng
 * mới vào tổng đang có là tính đôi chính bộ dữ liệu ấy, và một lần nạp lại
 * không đổi gì cũng đủ đẩy tổ chức "vượt" hạn mức.
 */
export async function dungLuongDaGhi(db: Db, tenantId: number, datasetId: number): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT COALESCE(warehouse_bytes, 0) AS n
       FROM datasets
      WHERE tenant_id = ? AND id = ? AND deleted_at IS NULL`,
    [tenantId, datasetId],
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
