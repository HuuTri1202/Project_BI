import { CONNECTION_ERROR_CODES, type SyncResultDto } from '@bi/shared';
import type { RowDataPacket } from 'mysql2';

import { withTransaction } from '../../db/tx';
import * as datasetsRepo from '../../repositories/datasets';
import { HttpError } from '../../utils/httpError';
import { driverFor, type TableRef, type TableSchema } from './drivers';
import { explainConnectionError } from './explainError';
import { requireSecret, toConfigFromSecret } from './connectionService';

/**
 * Đồng bộ schema từ CSDL nguồn vào kho dữ liệu (§8.7).
 *
 * ─── Ba luật quyết định hành vi, và lý do của từng cái ──────────────────────
 *
 * 1. **Chỉ đụng những bảng ĐƯỢC CHỌN.** Bảng không nằm trong `refs` thì không
 *    được đọc, không được sửa, không được xoá. Người dùng tích 3 bảng thì đúng
 *    3 bảng thay đổi — không có tác dụng phụ nào ngoài tầm nhìn của họ.
 *
 * 2. **KHÔNG BAO GIỜ xoá dataset vì lần quét này không thấy bảng.** Nghe hợp lý
 *    ("bảng biến mất thì dọn dataset") nhưng nó biến mọi sự cố tạm thời thành
 *    mất dữ liệu hàng loạt: quyền SELECT vừa bị thu hẹp, tài khoản đổi schema
 *    mặc định, hay đơn giản là người dùng gõ nhầm tên database — bất kỳ cái nào
 *    cũng khiến danh sách trả về rỗng, và cách làm "hợp lý" kia sẽ xoá sạch kho.
 *    Dataset chỉ biến mất khi có người bấm nút Xoá.
 *
 * 3. **Một bảng hỏng không kéo cả mẻ.** Bảng bị thu hồi quyền giữa chừng thì ghi
 *    vào `failed` kèm lý do, những bảng còn lại vẫn xong. Ném lỗi cho cả mẻ
 *    nghĩa là một bảng rác chặn vĩnh viễn việc đồng bộ 200 bảng tốt.
 *
 * ─── Vì sao đọc schema NGOÀI transaction ────────────────────────────────────
 *
 * `describeTables` đi qua mạng tới máy chủ của khách hàng và có thể mất vài
 * giây. Giữ một transaction MySQL mở suốt quãng đó là giữ khoá và giữ một trong
 * mười connection của pool để chờ một hệ thống ta không kiểm soát. Đọc xong hẳn
 * rồi mới mở transaction ghi.
 */
export async function syncDatasets(
  tenantId: number,
  connectionId: number,
  refs: TableRef[],
): Promise<SyncResultDto> {
  if (refs.length === 0) {
    return { added: [], updated: [], unchanged: [], failed: [] };
  }

  const secret = await requireSecret(tenantId, connectionId);
  const cfg = await toConfigFromSecret(secret);

  let schemas: TableSchema[];
  try {
    schemas = await driverFor(secret.kind).describeTables(cfg, refs);
  } catch (err) {
    // Cả mẻ hỏng vì không mở được kết nối — khác hẳn "một bảng hỏng". 502 vì
    // lỗi nằm ở hệ thống thượng nguồn, không phải ở request của người dùng.
    throw new HttpError(
      502,
      CONNECTION_ERROR_CODES.CONNECTION_FAILED,
      explainConnectionError(err, secret.kind, secret.useSsl),
    );
  }

  const found = new Map(schemas.map((s) => [key(s.schema, s.table), s]));
  const result: SyncResultDto = { added: [], updated: [], unchanged: [], failed: [] };

  await withTransaction(async (conn) => {
    for (const ref of refs) {
      const label = key(ref.schema, ref.table);
      const schema = found.get(label);

      if (!schema) {
        // Bảng có trong danh sách chọn nhưng không mô tả được: vừa bị xoá, vừa
        // bị đổi tên, hoặc tài khoản không còn quyền đọc nó. Xem luật 2.
        result.failed.push({
          table: label,
          reason: 'Không đọc được cấu trúc bảng — có thể bảng đã bị xoá hoặc thiếu quyền.',
        });
        continue;
      }

      const before = await currentColumnCount(conn, tenantId, connectionId, ref);

      const { id, isNew } = await datasetsRepo.upsert(conn, tenantId, {
        connectionId,
        sourceSchema: schema.schema,
        sourceTable: schema.table,
        // Tên hiển thị ban đầu = tên bảng. Nhánh UPDATE của `upsert` cố ý không
        // ghi đè tên, nên đổi tên ở mục 8.9 sống qua mọi lần đồng bộ sau.
        name: schema.table,
        columnCount: schema.columns.length,
      });

      await datasetsRepo.replaceColumns(conn, id, schema.columns);

      if (isNew) result.added.push(label);
      else if (before !== schema.columns.length) result.updated.push(label);
      else result.unchanged.push(label);
    }
  });

  return result;
}

/**
 * Số cột đang lưu, đọc TRƯỚC khi ghi đè.
 *
 * Dùng để phân biệt "cập nhật" với "không đổi" trong bảng tổng kết. So bằng số
 * cột là phép xấp xỉ — đổi KIỂU một cột mà giữ nguyên số lượng sẽ bị xếp nhầm
 * vào "không đổi". So từng cột thì chính xác hơn nhưng phải đọc toàn bộ
 * `dataset_columns` của mọi bảng trước khi ghi, và con số này chỉ để hiển thị
 * chứ không quyết định hành vi nào cả. Ghi ra đây để người sau biết đó là lựa
 * chọn, không phải sơ suất.
 */
async function currentColumnCount(
  conn: Parameters<typeof datasetsRepo.upsert>[0],
  tenantId: number,
  connectionId: number,
  ref: TableRef,
): Promise<number | null> {
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT column_count FROM datasets
      WHERE tenant_id = ? AND connection_id = ? AND source_schema = ? AND source_table = ?
      LIMIT 1`,
    [tenantId, connectionId, ref.schema, ref.table],
  );
  const row = rows[0];
  return row ? Number(row['column_count']) : null;
}

function key(schema: string, table: string): string {
  return `${schema}.${table}`;
}
