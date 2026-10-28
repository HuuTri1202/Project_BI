import { useQuery } from '@tanstack/react-query';

import { apiClient } from '../../services/apiClient';

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
