import { mysqlPool } from '../../config/mysql';
import * as loadsRepo from '../../repositories/datasetLoads';
import * as datasetsRepo from '../../repositories/datasets';

/**
 * Tự xếp hàng nạp ngay sau khi một bộ dữ liệu vừa có dữ liệu mới (§9.7).
 *
 * ─── Vì sao TỰ ĐỘNG chứ không đợi người dùng bấm ────────────────────────────
 *
 * Bản đầu của §9 chỉ có nút bấm tay, và đó là một bước thừa đặt sai chỗ: người
 * dùng vừa tải file lên xong, thấy dữ liệu hiện ra ở tab "Dữ liệu", rồi vẫn phải
 * đi tìm một nút nữa mới dùng được nó để phân tích. Không có câu trả lời hợp lý
 * nào cho "tại sao lại phải bấm thêm" — nạp vào kho không phải một lựa chọn của
 * người dùng, nó là bước còn thiếu để thứ họ vừa tải lên trở nên có ích.
 *
 * Nên: tải file xong -> tự nạp. Đồng bộ bảng xong -> tự nạp. Nút bấm tay vẫn
 * còn, nhưng giờ nó mang đúng nghĩa "nạp LẠI" chứ không phải "kích hoạt lần đầu".
 *
 * ─── Ba luật, và cả ba đều nhằm một điều: KHÔNG được làm hỏng việc gọi nó ───
 *
 * Hàm này chạy ở đuôi luồng tải file và luồng đồng bộ. Cả hai luồng đó đã THÀNH
 * CÔNG trước khi tới đây, nên:
 *
 *   1. KHÔNG ném lỗi ra ngoài. ClickHouse tắt thì việc tải file vẫn phải báo
 *      thành công — vì nó ĐÃ thành công. Lần nạp sẽ hiện `failed` ở tab Kho phân
 *      tích kèm lý do, đúng chỗ người dùng đi tìm.
 *   2. KHÔNG ping ClickHouse. Ping là việc của endpoint bấm tay, nơi người dùng
 *      đang ngồi chờ một câu trả lời. Ở đây thêm một vòng đi mạng vào đường tải
 *      file chỉ để biết trước một điều mà vòng lặp nền sẽ tự phát hiện.
 *   3. KHÔNG xếp trùng. Bộ dữ liệu đang có việc chưa xong thì bỏ qua — hai lần
 *      nạp liên tiếp cho cùng một bảng là công toi, vì lần sau ghi đè lần trước.
 */
export async function queueAutoLoad(
  tenantId: number,
  datasetIds: readonly number[],
  triggeredBy: number | null,
): Promise<void> {
  for (const datasetId of datasetIds) {
    try {
      if (await loadsRepo.hasPendingRun(mysqlPool, tenantId, datasetId)) continue;

      await loadsRepo.enqueue(mysqlPool, tenantId, datasetId, triggeredBy);
      await datasetsRepo.markLoadStatus(mysqlPool, datasetId, 'queued');
    } catch (err) {
      // Ghi log rồi đi tiếp sang bộ dữ liệu kế. Một lần đồng bộ 20 bảng không
      // được hỏng vì bảng thứ 7 xếp hàng không thành.
      console.error(`[ingest] không xếp hàng nạp được cho dataset ${datasetId}:`, err);
    }
  }
}
