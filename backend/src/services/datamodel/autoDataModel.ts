import { mysqlPool } from '../../config/mysql';
import * as adminWorkspacesRepo from '../../repositories/adminWorkspaces';
import * as datamodelsRepo from '../../repositories/datamodels';
import * as datasetsRepo from '../../repositories/datasets';
import { createDataModel } from './createDataModel';
import { regenerateTenant } from './cubeSchemaService';

/**
 * Tự sinh mô hình dữ liệu ngay sau khi một bộ dữ liệu nạp xong (§10).
 *
 * ─── Vì sao tự động, khác với §10.2 ─────────────────────────────────────────
 *
 * §10.2 mô tả luồng thủ công: bấm "+ Create DataModel", đặt tên, chọn bộ dữ
 * liệu. Luồng đó VẪN CÒN và là cách duy nhất dựng mô hình NHIỀU BẢNG — thứ mà
 * tab Quan hệ cần để có gì mà nối.
 *
 * Nhưng với bộ dữ liệu đơn lẻ, bắt bấm thêm ba bước là đặt một cánh cửa ở giữa
 * "dữ liệu đã sẵn sàng" và "hỏi được nó". Người dùng tải file lên, thấy nó nạp
 * xong, rồi vẫn phải đi tạo thêm một thứ nữa mới xem được — không có câu trả
 * lời hợp lý nào cho "tại sao phải bấm thêm".
 *
 * Nên: nạp xong -> có ngay một mô hình dùng được. Đúng lập luận mà `autoLoad.ts`
 * của §9 đã dùng khi bỏ nút "nạp" thủ công.
 *
 * ─── Bốn luật, cả bốn đều nhằm: KHÔNG được làm hỏng việc gọi nó ─────────────
 *
 * Hàm này chạy ở đuôi vòng lặp nạp, sau khi việc nạp ĐÃ THÀNH CÔNG. Nên:
 *
 *   1. KHÔNG ném lỗi ra ngoài. Sinh mô hình hỏng thì việc nạp vẫn phải tính là
 *      xong — vì nó đã xong. Người dùng tạo tay được, không mất gì.
 *   2. KHÔNG tạo trùng. Bộ dữ liệu đã nằm trong một mô hình nào đó thì bỏ qua:
 *      nạp lại một bảng là chuyện thường, và mỗi lần nạp lại đẻ thêm một mô
 *      hình là cách biến danh sách thành rác sau một tuần.
 *   3. KHÔNG đụng mô hình người dùng tự dựng. Luật 2 lo việc đó: một bộ dữ liệu
 *      đã được đưa vào mô hình nhiều bảng sẽ không sinh thêm mô hình riêng.
 *   4. Bộ dữ liệu nguồn `connection` KHÔNG có workspace (kho §8 ở phạm vi tổ
 *      chức), mà mô hình thì bắt buộc thuộc một workspace. Rơi về workspace
 *      đang hoạt động đầu tiên — xem ghi chú ở chỗ gọi.
 */

export async function ensureAutoDataModel(
  tenantId: number,
  datasetId: number,
  createdBy: number | null,
): Promise<void> {
  try {
    // Luật 2: đã có mô hình nào chứa bộ này thì thôi.
    if (await datamodelsRepo.countModelsUsingDataset(mysqlPool, tenantId, datasetId)) return;

    const dataset = await datasetsRepo.findOne(mysqlPool, tenantId, datasetId);
    if (dataset === null || dataset.loadStatus !== 'loaded') return;

    // Luật 4. `resolveWorkspace` nằm ở tầng route nên không dùng lại được ở
    // đây; lặp lại đúng phần cần: workspace đang hoạt động đầu tiên.
    let workspaceId = dataset.workspaceId;
    if (workspaceId === null) {
      const all = await adminWorkspacesRepo.listWithProjectCount(mysqlPool, tenantId);
      const first = all.find((w) => w.isActive);
      if (first === undefined) return;
      workspaceId = first.id;
    }

    // Người đứng tên, hoặc `null`.
    //
    // ⚠️ KHÔNG được `return` khi không tìm ra ai: bộ dữ liệu đồng bộ từ CSDL
    // (§8) không ghi `created_by` bao giờ, nên một câu chặn ở đây sẽ lặng lẽ tắt
    // toàn bộ luồng CSDL — không lỗi, không log, chỉ là mô hình không bao giờ
    // xuất hiện. Đó đúng là lỗi bản đầu đã mắc, và nó chỉ lộ ra khi chạy thật
    // cả hai luồng cạnh nhau rồi thấy một bên có mô hình còn bên kia không.
    //
    // Cột `created_by` cho phép NULL (`ON DELETE SET NULL`), nên `null` là một
    // giá trị hợp lệ chứ không phải một thiếu sót cần chặn.
    const owner = createdBy ?? (await datasetsRepo.findCreatorId(mysqlPool, tenantId, datasetId));

    await createDataModel({
      tenantId,
      workspaceId,
      // Tên = tên bộ dữ liệu. Người dùng đổi được ở trang mô hình, và một cái
      // tên họ đã tự đặt cho bộ dữ liệu thì đúng hơn bất cứ thứ gì ta bịa ra.
      name: dataset.name,
      description: 'Tự tạo khi bộ dữ liệu được nạp vào kho phân tích.',
      datasetIds: [datasetId],
      createdBy: owner,
    });

    await regenerateTenant(tenantId);
    console.log(`[datamodel] đã tự tạo mô hình cho dataset ${datasetId}`);
  } catch (err) {
    // Luật 1.
    console.error(`[datamodel] không tự tạo được mô hình cho dataset ${datasetId}:`, err);
  }
}
