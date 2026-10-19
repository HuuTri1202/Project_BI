import type { ExplorerQueryDto } from '@bi/shared';

import { apiClient } from '../../services/apiClient';

/**
 * Nhờ backend viết lại câu trả lời cho mượt hơn.
 *
 * ═══ Vì sao KHÔNG có `hooks.ts` và `keys.ts` như các tính năng khác ════════
 *
 * Bộ ba `api`/`hooks`/`keys` tồn tại cho dữ liệu CÓ CACHE: cùng một khoá, nhiều
 * nơi đọc, cần `invalidate` khi có thay đổi. Ở đây không có gì trong số đó —
 * mỗi câu hỏi là một lần gọi, không ai đọc lại, và kết quả cũ không bao giờ
 * đúng cho câu hỏi sau. Thêm một khoá truy vấn cho nó là thêm một thứ phải nhớ
 * xoá.
 *
 * ═══ Vì sao câu trả lời KHÔNG chờ lời gọi này ══════════════════════════════
 *
 * Câu mẫu đã tính xong ngay trên máy, trước khi gọi. Nên khung hiện nó LẬP TỨC
 * rồi mới thay bằng bản viết lại nếu bản đó về. Người dùng không bao giờ phải
 * nhìn một vòng xoay để đọc một con số máy họ đã có.
 *
 * Nó cũng là lý do mọi kiểu hỏng ở đây đều vô hại: không khoá, mất mạng, hết
 * lượt — câu mẫu đang hiện vẫn ở đó. Xem `services/chat/dienDat.ts` bên backend.
 */
export async function dienDatLai(input: {
  cauHoi: string;
  cau: string;
  so: string[];
}): Promise<string> {
  const { data } = await apiClient.post<{ cau: string }>('/v1/chat/dien-dat', input);
  return data.cau;
}

/**
 * Nhờ mô hình chọn xem câu hỏi ứng với nhãn dữ kiện nào.
 *
 * Chỉ gọi khi phép so từ khoá ở máy đã trượt — nên nó không nằm trên đường đi
 * của câu hỏi bình thường, và không tốn gì khi khung đã tự trả lời được.
 *
 * Gửi đi CHỈ CÓ NHÃN, không có giá trị nào: mô hình chọn trường, nó không cần
 * thấy số liệu để làm việc đó. Xem `services/chat/hieuY.ts` bên backend.
 */
export async function hieuCauHoi(input: {
  cauHoi: string;
  nhan: string[];
}): Promise<{ chon: number | null; daHoi: boolean }> {
  const { data } = await apiClient.post<{ chon: number | null; daHoi: boolean }>(
    '/v1/chat/hieu-y',
    input,
  );
  return data;
}

/**
 * Nhờ mô hình ĐẶT MỘT CÂU HỎI MỚI trên một mô hình dữ liệu.
 *
 * Đường CUỐI của khung, và là đường duy nhất tự chạy một truy vấn mới trên kho
 * — nên nó cũng là đường duy nhất gác bằng `authorize('datamodel', 'read')`.
 * `viewer` nhận 403, và khung quay về trả lời bằng thứ đang hiện trên màn hình.
 *
 * Gửi đi CHỈ CÓ CÂU HỎI. Danh sách trường do backend tự nạp từ mô hình trên
 * đường dẫn: cho client quyết "mô hình được thấy những trường nào" là một cái
 * cửa không có lý do gì để mở. Xem `services/chat/hoiTrenMoHinh.ts`.
 */
export interface HoiTrenMoHinhKetQua {
  cau: string | null;
  so: string[];
  hieuLa: string | null;
  daHoi: boolean;
  /** Form đã chạy — gửi lại ở lượt sau để hỏi tiếp. */
  truyVan: ExplorerQueryDto | null;
}

export async function hoiTrenMoHinh(
  moHinhId: number,
  cauHoi: string,
  /**
   * Lượt hỏi trước, để hiểu được "còn tháng 4 thì sao".
   *
   * Backend kiểm lại form này từ đầu bằng đúng `explorerQueryBodySchema` mà
   * Explorer dùng — nó là một thân request như mọi thân request khác, không
   * phải một thứ được tin vì "backend vừa tự dựng ra nó ở lượt trước".
   */
  boiCanh?: { cauHoi: string; truyVan: ExplorerQueryDto },
): Promise<HoiTrenMoHinhKetQua> {
  const { data } = await apiClient.post<HoiTrenMoHinhKetQua>(
    `/v1/datamodels/${String(moHinhId)}/chat/cau-hoi`,
    boiCanh === undefined ? { cauHoi } : { cauHoi, boiCanh },
  );
  return data;
}
