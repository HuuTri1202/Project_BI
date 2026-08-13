import { mysqlPool } from '../../config/mysql';
import * as datasetsRepo from '../../repositories/datasets';
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
