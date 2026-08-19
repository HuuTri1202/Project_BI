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
 *
 * ═══ Xoá KHÔNG đụng tới ClickHouse ══════════════════════════════════════════
 *
 * Bản trước drop luôn bảng `raw_*`, với lập luận: bảng đó là DẪN XUẤT, dựng lại
 * được từ `dataset_rows` / file trong MinIO / chính CSDL khách hàng, nên giữ nó
 * chỉ tốn đĩa.
 *
 * Lập luận đó đúng về mặt lý thuyết nhưng sai về hậu quả. "Dựng lại được" không
 * có nghĩa là "dựng lại dễ": với nguồn `file`, tải lại luôn sinh một id MỚI
 * (`uq_datasets_source` không ràng buộc được các cột NULL của nguồn file), nên
 * bộ dữ liệu cũ KHÔNG hồi sinh — người dùng phải tải lại file, nạp lại, rồi
 * dựng lại mô hình trỏ vào id mới. Một thao tác mang tên "xoá mềm" mà hậu quả
 * thì không hoàn tác được.
 *
 * Nên từ nay xoá dataset là một thao tác THUẦN MySQL: đúng một cột `deleted_at`.
 * Cả `load_status`, `ch_table`, `loaded_row_count` lẫn bảng trong kho đều giữ
 * nguyên, nên khôi phục là gỡ đúng cột đó ra và mọi thứ chạy lại ngay.
 *
 * Cái giá, ghi ra chứ không giấu: bảng trong kho KHÔNG bao giờ tự được thu hồi
 * nữa. Xoá rồi tải lại cùng một file mười lần để lại mười bảng đầy đủ trong
 * ClickHouse. Janitor giờ chỉ dọn bảng của dataset đã biến mất KHỎI MySQL (xem
 * `sweepOrphanTables`), và điều đó gần như chỉ xảy ra khi một tổ chức bị xoá
 * cứng.
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
