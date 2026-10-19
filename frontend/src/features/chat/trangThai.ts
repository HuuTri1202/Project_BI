import { useQuery } from '@tanstack/react-query';

import { apiClient } from '../../services/apiClient';

/**
 * Khung đang có mô hình ngôn ngữ để nhờ, hay đang chạy thuần ngoại tuyến.
 *
 * ═══ Vì sao người dùng CẦN biết chuyện này ════════════════════════════════
 *
 * Khung cố ý không bao giờ hỏng vì lớp mô hình: chưa có khoá, sai khoá, hết
 * lượt, mất mạng — tất cả ra cùng một kết quả là câu mẫu. Thiết kế đó đúng, và
 * nó làm một chuyện khác trở nên vô hình: cùng một câu hỏi, có mô hình thì
 * được hiểu, không có thì nhận "tôi chưa hiểu". Người dùng không biết mình
 * đang ở trạng thái nào sẽ kết luận là khung lúc được lúc không.
 *
 * ⚠️ `true` nghĩa là ĐÃ CẤU HÌNH, không phải "đang gọi được". Hết lượt thì vẫn
 * `true`. Biết chắc thì phải gọi thật, mà một lượt gọi cho mỗi lần mở khung là
 * cái giá vô lý. Trạng thái "đang không gọi được" được nói ra ở chỗ khác: từng
 * câu trả lời tự khai ai dựng ra nó.
 *
 * `staleTime: Infinity` — biến môi trường không đổi giữa chừng. `tsx watch`
 * còn không nạp lại `.env` mà không khởi động lại backend, nên hỏi lại nhiều
 * lần là tốn request cho một câu trả lời không bao giờ khác.
 */
export function useCoMoHinh(dangMo: boolean): boolean {
  const { data } = useQuery({
    queryKey: ['chat', 'trang-thai'],
    queryFn: async () => {
      const { data: d } = await apiClient.get<{ coMoHinh: boolean }>('/v1/chat/trang-thai');
      return d;
    },
    enabled: dangMo,
    staleTime: Infinity,
  });

  // Chưa biết thì coi như KHÔNG có. Hứa thừa rồi rút lại khi dữ liệu về là một
  // nhãn nhấp nháy; hứa thiếu rồi hiện thêm thì không ai thấy có gì sai.
  return data?.coMoHinh ?? false;
}
