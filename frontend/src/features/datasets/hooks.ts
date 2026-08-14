import { REPORT_ERROR_CODES, type PageResult, type ReportDto } from '@bi/shared';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { getApiError } from '../../services/apiClient';
import { useWorkspace } from '../../workspace/useWorkspace';
import { tenantKeys } from '../tenant/keys';
import * as api from './api';
import { datasetKeys } from './keys';

/**
 * Hook dữ liệu của bộ dữ liệu và báo cáo (§7).
 *
 * Cùng luật dọn cache với `features/tenant/hooks.ts`: invalidate ở mức CAO NHẤT
 * còn đúng, không phải mức hẹp nhất. Tạo một báo cáo làm đổi cả danh sách báo
 * cáo LẪN khối "Báo cáo gần đây" trên trang Home — nhắm đúng một key nghĩa là
 * chỗ kia hiện dữ liệu cũ ngay sau khi người dùng tự tay tạo ra thứ làm nó đổi.
 */

/**
 * Dọn mọi thứ mà một thay đổi bộ dữ liệu có thể chạm tới.
 *
 * Xuất ra ngoài để wizard gọi sau khi nhập xong: nút "Xem bộ dữ liệu" đưa thẳng
 * sang Kho dữ liệu, và nếu cache chưa được dọn thì người dùng nhìn vào một danh
 * sách KHÔNG có thứ họ vừa tạo — rồi tin rằng việc nhập đã hỏng.
 *
 * Dọn cả `tenantKeys`: trang Kho dữ liệu dùng chung cho hai nguồn nên danh sách
 * của nó nằm dưới key của `features/tenant`, không phải key ở đây.
 */
export function useInvalidateDatasets(): () => Promise<void> {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: datasetKeys.all });
    await queryClient.invalidateQueries({ queryKey: datasetKeys.reports() });
    await queryClient.invalidateQueries({
      queryKey: tenantKeys.all,
      predicate: (q) => q.queryKey[1] === 'datasets',
    });
  };
}

// ─── Báo cáo ─────────────────────────────────────────────────────────────────

export function useReports(
  query: Omit<api.ReportListQuery, 'workspaceId'>,
): UseQueryResult<PageResult<ReportDto>> {
  const { current } = useWorkspace();
  const workspaceId = current?.id ?? null;

  return useQuery({
    queryKey: datasetKeys.reportList(workspaceId, query),
    queryFn: () => api.fetchReports({ ...query, workspaceId: workspaceId as number }),
    enabled: workspaceId !== null,
    placeholderData: keepPreviousData,
  });
}

export function useReport(id: number | null) {
  return useQuery({
    queryKey: datasetKeys.report(id ?? 0),
    queryFn: () => api.fetchReport(id as number),
    enabled: id !== null,
  });
}

export function useReportData(id: number | null) {
  return useQuery({
    queryKey: datasetKeys.reportData(id ?? 0),
    queryFn: () => api.fetchReportData(id as number),
    enabled: id !== null,
    /**
     * Hỏi lại khi bộ dữ liệu ĐANG được nạp vào kho phân tích.
     *
     * Từ khi §7.6 gom nhóm bằng ClickHouse, một báo cáo vừa tạo trên file vừa
     * tải lên sẽ nhận 409 `DatasetNotLoaded` trong vài giây đầu — trạng thái
     * bình thường, không phải hỏng. Không hỏi lại thì người dùng phải tự F5 mà
     * không có gì bảo họ nên làm vậy.
     *
     * Dạng hàm để TỰ DỪNG: chỉ lặp đúng mã lỗi này, mọi lỗi khác dừng ngay —
     * hỏi lại mãi một lỗi thật là giấu nó đi sau một vòng quay vô tận.
     */
    refetchInterval: (query) =>
      getApiError(query.state.error).error === REPORT_ERROR_CODES.DATASET_NOT_LOADED ? 3_000 : false,
    retry: false,
  });
}

/** Dọn cả danh sách báo cáo lẫn trang Home (khối "Báo cáo gần đây"). */
function useInvalidateReports(): () => Promise<void> {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: datasetKeys.reports() });
    await queryClient.invalidateQueries({
      queryKey: tenantKeys.all,
      predicate: (q) => q.queryKey[1] === 'home',
    });
  };
}

export function useCreateReport(): UseMutationResult<
  ReportDto,
  unknown,
  Parameters<typeof api.createReport>[0]
> {
  const invalidate = useInvalidateReports();
  return useMutation({
    mutationFn: api.createReport,
    onSuccess: invalidate,
  });
}

export function useDeleteReport(): UseMutationResult<void, unknown, number> {
  const invalidate = useInvalidateReports();
  return useMutation({
    mutationFn: api.deleteReport,
    onSuccess: invalidate,
  });
}
