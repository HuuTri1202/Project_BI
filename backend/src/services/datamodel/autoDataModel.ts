import type { DatasetDto } from '@bi/shared';

import { mysqlPool } from '../../config/mysql';
import * as datamodelsRepo from '../../repositories/datamodels';
import * as datasetsRepo from '../../repositories/datasets';
import { addDatasets, createDataModel } from './createDataModel';
import { regenerateTenant } from './cubeSchemaService';

/**
 * Tự sinh mô hình dữ liệu ngay sau khi một bộ dữ liệu nạp xong (§10).
 *
 * ─── Vì sao tự động, khác với §10.2 ─────────────────────────────────────────
 *
 * §10.2 mô tả luồng thủ công: bấm "+ Create DataModel", đặt tên, chọn bộ dữ
 * liệu. Luồng đó VẪN CÒN và là cách duy nhất gom những bảng KHÔNG cùng nguồn
 * vào một mô hình.
 *
 * Nhưng bắt bấm thêm ba bước là đặt một cánh cửa ở giữa "dữ liệu đã sẵn sàng"
 * và "hỏi được nó". Người dùng tải file lên, thấy nó nạp xong, rồi vẫn phải đi
 * tạo thêm một thứ nữa mới xem được — không có câu trả lời hợp lý nào cho "tại
 * sao phải bấm thêm". Nên: nạp xong -> có ngay một mô hình dùng được. Đúng lập
 * luận mà `autoLoad.ts` của §9 đã dùng khi bỏ nút "nạp" thủ công.
 *
 * ─── Đơn vị gom nhóm là LẦN TẢI, không phải từng bảng ───────────────────────
 *
 * Bản trước tạo một mô hình cho MỖI bộ dữ liệu, vì hàm này chạy ở đuôi mỗi lần
 * nạp mà mỗi lần nạp là một bộ. Hệ quả: một workbook ba sheet ra ba mô hình một
 * bảng, rời nhau, tab Quan hệ không có gì để nối.
 *
 * Đó không phải suy đoán — đo trên dữ liệu thật của tổ chức 4 sau ba ngày dùng:
 *
 *     mô hình TỰ SINH      15 cái, KHÔNG cái nào quá 1 bảng, 12 cái bị xoá
 *     mô hình người tự dựng 9 cái, đều 2–3 bảng
 *
 * Tức là cứ mỗi lần tải file, người dùng lại bỏ ba mô hình máy sinh rồi tự dựng
 * bằng tay đúng cái lẽ ra phải được sinh ra. Lập luận "đừng đặt thêm cánh cửa"
 * vẫn đúng — nó chỉ áp dụng cho LẦN TẢI, không phải cho từng sheet.
 *
 * Khoá gom nhóm dựng hoàn toàn từ thứ hệ thống giữ, không từ chuỗi người dùng
 * đặt (xem `batchOf`). Với file đó là `s3_key`: ba sheet của một workbook dùng
 * chung đúng một object trong MinIO, nên "cùng một lần tải" là một sự thật đọc
 * được chứ không phải một phép đoán theo tên.
 *
 * ─── Các lần nạp chạy TUẦN TỰ, và luật này dựa vào điều đó ──────────────────
 *
 * Vòng lặp nền nhặt mỗi lúc một job (§9.6), nên sheet 1 nạp xong hẳn rồi sheet 2
 * mới bắt đầu. Vì thế luật là "chưa có thì TẠO, có rồi thì THÊM VÀO": sheet đầu
 * dựng mô hình, các sheet sau nhập vào chính nó. Không có hai bộ dữ liệu cùng
 * chạy tới đây một lúc, nên khoảng giữa `findAutoModelByBatch` và `create`
 * không cần khoá.
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
 *   3. KHÔNG đụng mô hình người dùng tự dựng. Hai lớp lo việc đó: luật 2, và
 *      `auto_batch_key` — chỉ mô hình do chính hàm này tạo mới mang khoá, nên
 *      `findAutoModelByBatch` không bao giờ trả về mô hình của người dùng.
 *   4. Mô hình sinh ra nằm ĐÚNG workspace của bộ dữ liệu.
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

    // Luật 4. Trước migration 11 chỗ này còn một nhánh dự phòng "workspace hoạt
    // động đầu tiên" cho những bộ dữ liệu chưa gắn workspace. Nhánh đó giờ không
    // tới được — `datasets.workspace_id` là `NOT NULL`.
    const workspaceId = dataset.workspaceId;

    // Người đứng tên, hoặc `null`.
    //
    // ⚠️ KHÔNG được `return` khi không tìm ra ai: bộ dữ liệu đồng bộ từ CSDL
    // (§8) không ghi `created_by` bao giờ, nên một câu chặn ở đây sẽ lặng lẽ tắt
    // toàn bộ luồng CSDL — không lỗi, không log, chỉ là mô hình không bao giờ
    // xuất hiện. Đó đúng là lỗi bản đầu đã mắc, và nó chỉ lộ ra khi chạy thật
    // cả hai luồng cạnh nhau rồi thấy một bên có mô hình còn bên kia không.
    const owner = createdBy ?? (await datasetsRepo.findCreatorId(mysqlPool, tenantId, datasetId));

    const batch = await batchOf(tenantId, dataset);

    if (batch !== null) {
      const existing = await datamodelsRepo.findAutoModelByBatch(
        mysqlPool,
        tenantId,
        workspaceId,
        batch.key,
      );

      if (existing !== null) {
        await addDatasets(tenantId, existing.id, [datasetId], owner);
        await regenerateTenant(tenantId);
        console.log(`[datamodel] đã thêm dataset ${datasetId} vào mô hình ${existing.id}`);
        return;
      }
    }

    await createDataModel({
      tenantId,
      workspaceId,
      // Tên của cả LẦN TẢI, không phải của một sheet: "Global-Superstore" chứ
      // không phải "Global-Superstore · Orders". Người dùng đổi được ở trang mô
      // hình. Không xác định được lần tải thì lùi về tên bộ dữ liệu — vẫn đúng
      // hơn bất cứ thứ gì ta bịa ra.
      name: batch?.name ?? dataset.name,
      description: 'Tự tạo khi bộ dữ liệu được nạp vào kho phân tích.',
      autoBatchKey: batch?.key ?? null,
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

interface Batch {
  /** Lưu vào `datamodels.auto_batch_key`. Xem migration 19. */
  key: string;
  /** Tên đặt cho mô hình nếu đây là bảng đầu tiên của nhóm. */
  name: string;
}

/**
 * Bộ dữ liệu này thuộc "lần tải" nào.
 *
 * ⚠️ Khoá dựng từ ID và đường dẫn do HỆ THỐNG sinh, không từ chuỗi người dùng
 * đặt. Gom theo `original_filename` nghe tự nhiên hơn, nhưng hai người tải hai
 * file khác nhau cùng tên `bao-cao.xlsx` sẽ bị nhập làm một — và họ không có
 * cách nào tách ra.
 *
 * Trả `null` khi không xác định được. Khi đó luồng lùi về hành vi cũ: một bộ dữ
 * liệu, một mô hình, không mang khoá — mất phần gom nhóm chứ không hỏng gì.
 */
async function batchOf(tenantId: number, dataset: DatasetDto): Promise<Batch | null> {
  if (dataset.source === 'file') {
    // `s3_key` cố ý KHÔNG nằm trong `DatasetDto` (xem `shared/src/data.ts`), nên
    // hỏi riêng thay vì nới DTO ra chỉ để dùng ở đây.
    const file = await datasetsRepo.findStorageKey(mysqlPool, tenantId, dataset.id);
    if (file === null) return null;

    return {
      key: `file:${file.key}`,
      name: baseName(dataset.originalFilename) ?? dataset.name,
    };
  }

  // Nguồn CSDL không có "lần tải" nào cả — đồng bộ lại cùng một schema là chuyện
  // xảy ra hàng tuần, và mỗi lần lại đẻ một mô hình mới thì đúng vấn đề cũ. Nên
  // nhóm theo KẾT NỐI + SCHEMA: đó là ranh giới mà người dùng vốn đã nghĩ theo
  // ("CSDL bán hàng của tôi"), và các bảng trong cùng một schema là những bảng
  // có khả năng nối được với nhau nhất.
  if (dataset.connectionId === null || dataset.sourceSchema === null) return null;

  return {
    key: `conn:${dataset.connectionId}:${dataset.sourceSchema}`,
    name: dataset.sourceSchema,
  };
}

/** `Global-Superstore.xlsx` -> `Global-Superstore`. */
function baseName(filename: string | null): string | null {
  if (filename === null) return null;
  const trimmed = filename.trim();
  if (trimmed === '') return null;

  const dot = trimmed.lastIndexOf('.');
  // `dot > 0` chứ không phải `>= 0`: một file tên `.gitignore` không có phần mở
  // rộng để bỏ, và cắt ở vị trí 0 sẽ ra chuỗi rỗng.
  return dot > 0 ? trimmed.slice(0, dot) : trimmed;
}
