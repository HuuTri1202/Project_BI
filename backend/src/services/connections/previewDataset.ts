import {
  CONNECTION_ERROR_CODES,
  type DatasetCellValue,
  type DatasetPreviewDto,
} from '@bi/shared';

import { mysqlPool } from '../../config/mysql';
import * as datasetsRepo from '../../repositories/datasets';
import { HttpError, notFound } from '../../utils/httpError';
import { requireSecret, toConfigFromSecret } from './connectionService';
import { driverFor, PREVIEW_ROW_LIMIT } from './drivers';
import { explainConnectionError } from './explainError';

/**
 * Đọc vài dòng đầu của bảng nguồn để người dùng NHÌN được dữ liệu.
 *
 * ─── Vì sao đọc trực tiếp thay vì nhập về kho ───────────────────────────────
 *
 * Nền tảng này cố ý không giữ bản sao dữ liệu của khách hàng — `syncDatasets`
 * chỉ chép CẤU TRÚC. Giữ nguyên nguyên tắc đó ở đây có ba hệ quả đáng đánh đổi:
 *
 *   - Dữ liệu hiện ra luôn là dữ liệu THẬT lúc này, không phải ảnh chụp từ lần
 *     đồng bộ trước. Một bảng vừa được sửa thì người dùng thấy ngay bản sửa.
 *   - Không phát sinh nghĩa vụ lưu trữ: không tốn đĩa, không phải thiết kế đồng
 *     bộ tăng dần, và quan trọng nhất là dữ liệu nhạy cảm của khách hàng không
 *     nằm lại trong hệ thống ta thêm một bản nữa.
 *   - Đổi lại, KHÔNG có tổng số dòng. `COUNT(*)` trên bảng vài chục triệu dòng
 *     là một lần quét toàn bảng trên máy chủ của khách hàng, mỗi lần mở trang.
 *     Cái giá đó lớn hơn nhiều so với giá trị của con số hiển thị.
 *
 * ─── Vì sao `ref` lấy từ database của ta, không lấy từ request ──────────────
 *
 * Client chỉ gửi được một `datasetId`. Tên schema và tên bảng đọc ra từ bảng
 * `datasets` — nơi chúng được `describeTables` ghi vào. Nhận tên bảng thẳng từ
 * request sẽ biến endpoint này thành một cửa đọc mọi bảng trong CSDL của khách
 * hàng, kể cả bảng họ cố ý không đồng bộ.
 */
export async function previewDataset(
  tenantId: number,
  datasetId: number,
): Promise<DatasetPreviewDto> {
  const dataset = await datasetsRepo.findOne(mysqlPool, tenantId, datasetId);
  // 404 chứ không 403 cho id của tổ chức khác — cùng quy ước với phần còn lại.
  if (!dataset) throw notFound('Không tìm thấy tập dữ liệu này.');

  // Nguồn `file` (§7) đã nằm sẵn trong kho của ta, không có CSDL nào để hỏi.
  if (dataset.source === 'file') return previewFileRows(datasetId);

  if (dataset.connectionId === null || dataset.sourceSchema === null || dataset.sourceTable === null) {
    throw notFound('Không tìm thấy tập dữ liệu này.');
  }

  // `'system'`: `connectionId` lấy từ chính dòng dataset đã lọc theo tổ chức,
  // không phải từ URL. Xem `ConnectionScope`.
  const secret = await requireSecret(tenantId, dataset.connectionId, 'system');
  const cfg = await toConfigFromSecret(secret);

  try {
    const preview = await driverFor(secret.kind).previewRows(
      cfg,
      { schema: dataset.sourceSchema, table: dataset.sourceTable },
      PREVIEW_ROW_LIMIT,
    );
    return { ...preview, limit: PREVIEW_ROW_LIMIT };
  } catch (err) {
    // 502: lỗi nằm ở hệ thống thượng nguồn, không phải ở request. Bảng có thể
    // đã bị xoá hoặc tài khoản vừa bị thu quyền SELECT — cả hai đều là chuyện
    // của CSDL nguồn và người dùng cần đọc đúng lý do.
    throw new HttpError(
      502,
      CONNECTION_ERROR_CODES.CONNECTION_FAILED,
      explainConnectionError(err, secret.kind, secret.useSsl),
    );
  }
}

/**
 * Xem trước bộ dữ liệu nguồn `file` — đọc từ `dataset_rows` của chính ta.
 *
 * Ngược hẳn với nhánh `connection` ở trên: ở đây nền tảng GIỮ dữ liệu, vì file
 * người dùng tải lên thì không còn nguồn nào khác để hỏi lại.
 *
 * Thứ tự cột lấy từ `dataset_columns` chứ không từ khoá của object JSON — MySQL
 * không giữ thứ tự chèn khoá trong cột JSON, nên đọc theo khoá sẽ cho ra một
 * bảng có cột xáo trộn so với file gốc.
 *
 * ⚠️ Khoá của document là `fieldName`, KHÔNG phải `name` — xem `buildRows` trong
 * `services/dataset/commit.ts`. Hai tên này trùng nhau với file có tiêu đề vốn
 * đã sạch, nên tra nhầm bằng `name` vẫn chạy đúng ở phần lớn trường hợp và chỉ
 * hỏng khi `defaultFieldName()` phải chuẩn hoá: `doanh_thu` → `Doanh thu`, cột
 * không tiêu đề → `Cột 1`, hai cột trùng tên → `… (2)`. Khi đó cả bảng ra NULL
 * mà không có lỗi nào — nên phải tra đúng một khoá duy nhất ở mọi nơi.
 */
export async function previewFileRows(datasetId: number): Promise<DatasetPreviewDto> {
  const columns = await datasetsRepo.listColumns(mysqlPool, datasetId);
  const rows = await datasetsRepo.readRows(mysqlPool, datasetId, PREVIEW_ROW_LIMIT);

  const keys = columns.map((c) => c.fieldName ?? c.name);
  return {
    columns: keys,
    rows: rows.map((row) => keys.map((key) => toCell(row[key]))),
    limit: PREVIEW_ROW_LIMIT,
  };
}

function toCell(value: unknown): DatasetCellValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
    return value;
  }
  return String(value);
}
