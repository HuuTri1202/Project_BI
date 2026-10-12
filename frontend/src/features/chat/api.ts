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
