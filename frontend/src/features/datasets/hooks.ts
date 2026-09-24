import {
  REPORT_ERROR_CODES,
  type PageResult,
  type ReportDto,
  type ReportFolderDto,
} from '@bi/shared';
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
import { billingKeys } from '../billing/keys';
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

export function useReportData(id: number | null, page = 0) {
  return useQuery({
    queryKey: datasetKeys.reportData(id ?? 0, page),
    queryFn: () => api.fetchReportData(id as number, page),
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
     *
     * ⚠️ Phải hỏi `error !== null` TRƯỚC. react-query gọi hàm này ở mọi lần
     * query đổi trạng thái — kể cả khi thành công, kể cả khi query đang tắt —
     * và lúc đó `state.error` là `null`. `getApiError(null)` rơi vào nhánh
     * "không phải AxiosError" và in ra console câu "nhiều khả năng là bug ở
     * frontend". Không có bug nào cả, nhưng mỗi lần mở một báo cáo là console
     * lại đỏ vài dòng — và một cảnh báo kêu oan vài lần thì lần nó kêu đúng
     * cũng không ai đọc nữa.
     */
    refetchInterval: (query) =>
      query.state.error !== null &&
      getApiError(query.state.error).error === REPORT_ERROR_CODES.DATASET_NOT_LOADED
        ? 3_000
        : false,
    retry: false,
  });
}

/**
 * Số liệu của mọi ô trên một khung — §10.10.
 *
 * KHÔNG có `refetchInterval` như `useReportData`. Vòng hỏi lại ở đó tồn tại cho
 * `DatasetNotLoaded`, một trạng thái chỉ nhánh BỘ DỮ LIỆU đi qua; khung thì luôn
 * dựng trên mô hình, nơi số liệu sẵn sàng ngay khi Cube trả lời.
 *
 * `retry: false` vì lỗi ở đây gần như luôn là lỗi cấu hình (một ô trỏ vào thước
 * đo đã xoá), và hỏi lại ba lần chỉ làm người dùng chờ lâu hơn để đọc cùng một
 * câu. Ô hỏng lẻ tẻ thì đã được backend trả về kèm `error` riêng, không ném lỗi
 * cho cả request.
 */
export function useReportCanvasData(id: number | null, pageId: string | null = null) {
  return useQuery({
    queryKey: datasetKeys.reportCanvasData(id ?? 0, pageId),
    queryFn: () => api.fetchReportCanvasData(id as number, pageId),
    enabled: id !== null,
    retry: false,
  });
}

/**
 * Số liệu của MỘT ô ở một trang nhóm — §10.12.
 *
 * `page = 0` KHÔNG đi qua đây: trang đầu của mọi ô đã về cùng `canvas-data`
 * trong một request. Gọi thêm ở đây là hỏi lại đúng thứ vừa nhận.
 *
 * `placeholderData` giữ biểu đồ trang trước trên màn hình trong lúc trang sau
 * đang tính. Không có nó thì mỗi cú bấm ‹ › làm ô trắng một nhịp, và bấm nhanh
 * vài lần thì cả khung nhấp nháy.
 */
export function useReportVisualData(id: number | null, visualId: string, page: number) {
  return useQuery({
    queryKey: datasetKeys.reportVisualData(id ?? 0, visualId, page),
    queryFn: () => api.fetchReportVisualData(id as number, visualId, page),
    enabled: id !== null && page > 0,
    retry: false,
    placeholderData: keepPreviousData,
  });
}

/**
 * Dọn cả danh sách báo cáo, trang Home (khối "Báo cáo gần đây") và MỨC SỬ DỤNG
 * của gói.
 *
 * Mức sử dụng vì nút "Tạo báo cáo" báo trước khi tổ chức đã chạm hạn mức (xem
 * `useHetHanMuc`). Không dọn thì xoá một báo cáo xong nút vẫn nói "đã đủ 3/3",
 * và tạo xong cái thứ ba nút vẫn mời tạo tiếp.
 */
function useInvalidateReports(): () => Promise<void> {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: datasetKeys.reports() });
    await queryClient.invalidateQueries({
      queryKey: tenantKeys.all,
      predicate: (q) => q.queryKey[1] === 'home',
    });
    await queryClient.invalidateQueries({ queryKey: billingKeys.tenantPlan() });
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

/** Tạo báo cáo trên mô hình — §10.8. Cùng cơ chế dọn cache với nhánh bộ dữ liệu. */
export function useCreateModelReport(): UseMutationResult<
  ReportDto,
  unknown,
  Parameters<typeof api.createModelReport>[0]
> {
  const invalidate = useInvalidateReports();
  return useMutation({
    mutationFn: api.createModelReport,
    onSuccess: invalidate,
  });
}

/**
 * Sửa báo cáo trên mô hình — §10.9.
 *
 * Dọn thêm `reportData` của chính báo cáo đó, khác hai hook trên. Lý do: tạo
 * mới thì chưa ai từng đọc số liệu của nó, còn sửa thì cache đang giữ số liệu
 * tính bằng CẤU HÌNH CŨ. Không dọn thì bấm Lưu xong quay về trang Report sẽ
 * thấy đúng biểu đồ vừa bỏ đi, và F5 mới ra biểu đồ mới — người dùng kết luận
 * là nút Lưu không ăn.
 */
export function useUpdateModelReport(): UseMutationResult<
  ReportDto,
  unknown,
  { id: number; input: Parameters<typeof api.updateModelReport>[1] }
> {
  const invalidate = useInvalidateReports();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }) => api.updateModelReport(id, input),
    onSuccess: async (report) => {
      await queryClient.invalidateQueries({ queryKey: datasetKeys.reportData(report.id) });
      await invalidate();
    },
  });
}

export function useCreateCanvasReport(): UseMutationResult<
  ReportDto,
  unknown,
  Parameters<typeof api.createCanvasReport>[0]
> {
  const invalidate = useInvalidateReports();
  return useMutation({
    mutationFn: api.createCanvasReport,
    onSuccess: invalidate,
  });
}

/**
 * Dọn thêm `reportCanvasData` VÀ `reportData` của chính báo cáo đó.
 *
 * Cả hai, không phải một. `reportCanvasData` thì hiển nhiên. Còn `reportData`
 * là vì `updateCanvasReport` cũng ghi lại `chart_type`/`config` theo ô đầu tiên
 * — không dọn thì một báo cáo vừa chuyển từ một-biểu-đồ sang khung vẫn còn số
 * liệu cũ nằm trong cache dưới khoá kia.
 */
export function useUpdateCanvasReport(): UseMutationResult<
  ReportDto,
  unknown,
  { id: number; input: Parameters<typeof api.updateCanvasReport>[1] }
> {
  const invalidate = useInvalidateReports();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }) => api.updateCanvasReport(id, input),
    onSuccess: async (report) => {
      await queryClient.invalidateQueries({
        queryKey: datasetKeys.reportCanvasDataAll(report.id),
      });
      await queryClient.invalidateQueries({ queryKey: datasetKeys.reportDataAll(report.id) });
      await invalidate();
    },
  });
}

export function useDeleteReport(): UseMutationResult<void, unknown, number> {
  const invalidate = useInvalidateReports();
  return useMutation({
    mutationFn: api.deleteReport,
    onSuccess: invalidate,
  });
}

/* ─── Thư mục báo cáo — §10.25 ─────────────────────────────────────────────── */

/**
 * Thư mục của workspace đang mở, kèm số báo cáo trong từng cái.
 *
 * `enabled` theo `workspaceId` giống `useReports`: chưa biết workspace thì chưa
 * có câu hỏi nào để hỏi, và gọi bừa với `null` trả về 400.
 */
export function useReportFolders(): UseQueryResult<api.ReportFolderList> {
  const { current } = useWorkspace();
  const workspaceId = current?.id ?? null;
  return useQuery({
    queryKey: datasetKeys.reportFolders(workspaceId),
    queryFn: () => api.fetchReportFolders(workspaceId as number),
    enabled: workspaceId !== null,
  });
}

export function useCreateReportFolder(): UseMutationResult<ReportFolderDto, unknown, string> {
  const { current } = useWorkspace();
  const workspaceId = current?.id ?? null;
  const invalidate = useInvalidateReports();
  return useMutation({
    mutationFn: (name: string) =>
      api.createReportFolder({ workspaceId: workspaceId as number, name }),
    onSuccess: invalidate,
  });
}

export function useRenameReportFolder(): UseMutationResult<
  ReportFolderDto,
  unknown,
  { id: number; name: string }
> {
  const invalidate = useInvalidateReports();
  return useMutation({
    mutationFn: ({ id, name }) => api.renameReportFolder(id, name),
    onSuccess: invalidate,
  });
}

export function useDeleteReportFolder(): UseMutationResult<void, unknown, number> {
  const invalidate = useInvalidateReports();
  return useMutation({
    mutationFn: api.deleteReportFolder,
    onSuccess: invalidate,
  });
}

/**
 * Chuyển một báo cáo sang thư mục khác.
 *
 * `useInvalidateReports` là đủ và cố ý: nó dọn cả danh sách LẪN số đếm của từng
 * thư mục (xem `datasetKeys.reportFolders`). Không dọn số liệu của báo cáo —
 * chuyển thư mục không đổi một con số nào bên trong nó.
 */
export function useMoveReport(): UseMutationResult<
  ReportDto,
  unknown,
  { id: number; folderId: number | null }
> {
  const invalidate = useInvalidateReports();
  return useMutation({
    mutationFn: ({ id, folderId }) => api.moveReport(id, folderId),
    onSuccess: invalidate,
  });
}
