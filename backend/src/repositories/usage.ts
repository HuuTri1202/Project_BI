import type { RowDataPacket } from 'mysql2';

import type { Db } from './db';

/**
 * Đo mức sử dụng của một tổ chức — §11.
 *
 * ═══ MỘT chỗ duy nhất, và đó là chủ ý ══════════════════════════════════════
 *
 * Ba con số dưới đây sẽ được hỏi từ nhiều nơi: trang Billing, console vận hành,
 * và ngày nào đó là một lớp chặn hạn mức. Bản sai của câu tính dung lượng rất
 * dễ viết và trông hoàn toàn hợp lý (xem ghi chú ở `storageBytes`), nên để nó
 * lặp lại ở ba nơi là bảo đảm sẽ có ba câu trả lời khác nhau cho cùng một tổ
 * chức.
 */

export interface TenantUsage {
  workspaces: number;
  reports: number;
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

export async function fetchTenantUsage(db: Db, tenantId: number): Promise<TenantUsage> {
  const [wsRows] = await db.query<RowDataPacket[]>(
    'SELECT COUNT(*) AS n FROM workspaces WHERE tenant_id = ? AND deleted_at IS NULL',
    [tenantId],
  );

  const [reportRows] = await db.query<RowDataPacket[]>(
    'SELECT COUNT(*) AS n FROM reports WHERE tenant_id = ? AND deleted_at IS NULL',
    [tenantId],
  );

  /*
   * ⚠️ Dung lượng: KHÔNG được `SUM(file_size_bytes)` thẳng.
   *
   * Một file Excel nhiều sheet sinh ra NHIỀU dòng `datasets` dùng CHUNG một
   * object trên MinIO — `s3_key` cố ý không UNIQUE, xem migration 8. Cộng thẳng
   * thì một file 50MB ba sheet được tính thành 150MB, và khách bị báo vượt hạn
   * mức vì một phép cộng chứ không vì dữ liệu của họ.
   *
   * Nên gom theo OBJECT LƯU TRỮ trước rồi mới cộng.
   *
   * `COALESCE(s3_key, CONCAT('ds:', id))` xử lý bộ dữ liệu nguồn `connection`:
   * chúng không có `s3_key` và `file_size_bytes = 0` (nền tảng không giữ dòng
   * nào trên S3). Không có COALESCE thì mọi dataset nguồn connection gộp chung
   * vào một nhóm NULL — vô hại vì chúng đều bằng 0, nhưng chỉ đúng do may mắn,
   * và sẽ sai ngay ngày cột đó mang giá trị khác.
   *
   * `MAX` chứ không `AVG` hay lấy dòng đầu: ba sheet của cùng một file đều ghi
   * đúng kích thước file, nhưng MAX vẫn ra đúng nếu có dòng ghi 0.
   */
  const [storageRows] = await db.query<RowDataPacket[]>(
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

  return {
    workspaces: toNumber(wsRows[0]?.['n']),
    reports: toNumber(reportRows[0]?.['n']),
    storageBytes: toNumber(storageRows[0]?.['n']),
  };
}
