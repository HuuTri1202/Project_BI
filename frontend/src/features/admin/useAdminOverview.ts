import type { AdminOverviewDto } from '@bi/shared';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useAuth } from '../../auth/useAuth';
import { fetchOverview } from './api';
import { adminKeys } from './keys';

/**
 * Số liệu trang tổng quan (§3.2).
 *
 * `enabled` phòng trường hợp component render trước khi phiên kịp khôi phục:
 * khi đó `tenant` còn null, và bắn request lúc chưa có token chỉ tạo ra một 401
 * vô nghĩa rồi kéo theo interceptor đẩy người dùng về /login. Thực tế
 * `AdminRoute` đã chặn trước, nhưng điều kiện này khiến hook đúng độc lập với
 * việc ai gọi nó.
 */
export function useAdminOverview(): UseQueryResult<AdminOverviewDto> {
  const { tenant } = useAuth();
  const tenantId = tenant?.id ?? 0;

  return useQuery({
    queryKey: adminKeys.overview(tenantId),
    queryFn: fetchOverview,
    enabled: tenantId > 0,
  });
}
