import { mysqlPool } from '../../config/mysql';
import * as datasetsRepo from '../../repositories/datasets';
import { dropDatasetTables } from '../ingest/dropTables';
import { notFound } from '../../utils/httpError';

/**
 * Xoá một dataset khỏi kho (§8.9).
 *
 * Xoá MỀM: `deleted_at` chứ không `DELETE`. Hai lý do —
 *
 *   - Đồng bộ lại chính bảng đó sẽ hồi sinh dataset với NGUYÊN id cũ (nhánh
 *     `deleted_at = NULL` trong `datasets.upsert`), nên mọi thứ trỏ tới nó vẫn
 *     còn nguyên. Xoá cứng thì lần đồng bộ sau tạo một id mới và mối liên kết
 *     đứt vĩnh viễn.
 *   - `dataset_columns` CASCADE theo dataset. Xoá cứng là mất luôn ảnh chụp
 *     schema — thứ duy nhất còn lại nếu CSDL nguồn đã ngừng hoạt động.
 */
export async function deleteDataset(tenantId: number, id: number): Promise<void> {
  await assertNotInUse(tenantId, id);

  const affected = await datasetsRepo.softDelete(mysqlPool, tenantId, id);
  if (affected === 0) throw notFound('Không tìm thấy tập dữ liệu này.');

  await dropWarehouseTable(tenantId, id);
}

/**
 * Trả lại chỗ trong kho phân tích (§9).
 *
 * Bảng `raw_*` là DẪN XUẤT chứ không phải bản gốc — nguồn để dựng lại nó
 * (`dataset_rows`, file trong MinIO, hay chính CSDL khách hàng) đều sống sót qua
 * lần xoá mềm này. Nên giữ lại bảng không bảo vệ được gì, chỉ chiếm đĩa: mỗi
 * vòng xoá-rồi-tải-lại một file để lại một bản sao đầy đủ, vì tải file luôn sinh
 * id MỚI (`uq_datasets_source` không chặn được các cột NULL của nguồn `file`).
 *
 * ─── Toàn bộ khối này KHÔNG ĐƯỢC ném ───────────────────────────────────────
 *
 * Dòng MySQL đã xoá mềm xong ở trên. Ném ra từ đây là trả lỗi cho một thao tác
 * ĐÃ thành công, và người dùng bấm xoá lại sẽ nhận 404 — vừa sai vừa khó hiểu.
 * Tệ hơn: nó buộc "xoá được một dòng trong MySQL" vào "ClickHouse phải đang
 * sống", hai thứ vốn không liên quan.
 *
 * Nên đây là nỗ lực TỐT NHẤT CÓ THỂ, và `sweepOrphanTables` trong runner là lưới
 * hứng — nó suy tên bảng từ id chứ không đọc `ch_table`, nên dọn được cả những
 * bảng mà bước này bỏ lỡ.
 *
 * Dọn cờ TRƯỚC, drop SAU: nếu tiến trình chết giữa hai bước thì kết quả là một
 * bảng mồ côi (janitor xử lý được), chứ không phải một bộ dữ liệu khoe "đã nạp
 * 50.000 dòng" trỏ vào bảng đã biến mất (không ai xử lý được).
 */
async function dropWarehouseTable(tenantId: number, id: number): Promise<void> {
  try {
    await datasetsRepo.clearLoadState(mysqlPool, id);
    await dropDatasetTables(tenantId, id);
  } catch (err) {
    console.error(`[ingest] không dọn được kho cho bộ dữ liệu ${id}:`, err);
  }
}

/**
 * Mục 8.10 — chặn xoá dataset đang được mô hình dữ liệu sử dụng.
 *
 * ⚠️ CHƯA LÀM ĐƯỢC, và đây là nợ có chủ đích chứ không phải quên.
 *
 * Bảng `datamodels` chưa tồn tại — nó thuộc Section 09. Không có gì để đếm, nên
 * hàm này hiện là no-op. Cố ý giữ nó lại với đúng chữ ký cuối cùng thay vì bỏ
 * hẳn, vì hai lý do:
 *
 *   1. Chỗ cắm đã nằm đúng vị trí trong luồng xoá. Đến Section 09 chỉ cần điền
 *      thân hàm; không phải đi tìm xem nên chặn ở đâu giữa route và repository.
 *   2. Nó ghi lại rằng luật này TỒN TẠI trong yêu cầu. Xoá hàm đi thì mục 8.10
 *      biến mất khỏi mã nguồn và chỉ còn trong một file tài liệu không ai đọc.
 *
 * Khi có bảng thật, thân hàm là: đếm `datamodels` còn sống trỏ tới dataset này,
 * `> 0` thì ném 409 kèm số lượng và tên vài mô hình đầu — cùng khuôn với
 * `deleteConnection`.
 */
function assertNotInUse(_tenantId: number, _datasetId: number): Promise<void> {
  return Promise.resolve();
}
