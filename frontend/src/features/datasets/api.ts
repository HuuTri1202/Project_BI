import type {
  AnalyzeResultDto,
  ChartType,
  CommitDatasetsInput,
  CreateReportInput,
  CreateUploadResultDto,
  DatasetDetailDto,
  DatasetDto,
  DatasetStatus,
  PageResult,
  ReportConfigDto,
  ReportDataDto,
  ReportDto,
} from '@bi/shared';
import { apiClient } from '../../services/apiClient';

/**
 * Lời gọi HTTP của luồng bộ dữ liệu và báo cáo (§7).
 *
 * Cùng quy ước với `features/tenant/api.ts`: đường dẫn tương đối với
 * `VITE_API_BASE_URL`, token do interceptor tự gắn, không hàm nào nhận
 * `tenantId` (backend lấy từ token), và không hàm nào bắt lỗi — react-query cần
 * thấy Promise bị reject.
 *
 * ⚠️ `uploadUrl` trả về từ `createUpload` KHÔNG được gọi bằng `apiClient`. Nó trỏ
 * thẳng vào S3, và interceptor sẽ gắn `Authorization` của ta vào đó — S3 từ chối
 * vì header đó không nằm trong chữ ký. Việc PUT do Uppy lo, xem `useUppyS3.ts`.
 */

function clean(
  input: Record<string, string | number | undefined>,
): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== '') out[key] = value;
  }
  return out;
}

// ─── Bộ dữ liệu ──────────────────────────────────────────────────────────────

export interface DatasetListQuery {
  workspaceId: number;
  page: number;
  pageSize: number;
  q: string;
  status: DatasetStatus | '';
  sort: string;
  order: 'asc' | 'desc';
}

export async function fetchDatasets(query: DatasetListQuery): Promise<PageResult<DatasetDto>> {
  const { data } = await apiClient.get<PageResult<DatasetDto>>('/v1/datasets', {
    params: clean({ ...query }),
  });
  return data;
}

export async function fetchDataset(id: number): Promise<DatasetDetailDto> {
  const { data } = await apiClient.get<DatasetDetailDto>(`/v1/datasets/${id}`);
  return data;
}

export async function createUpload(input: {
  workspaceId: number;
  filename: string;
  fileSize: number;
}): Promise<CreateUploadResultDto> {
  const { data } = await apiClient.post<CreateUploadResultDto>('/v1/datasets/uploads', input);
  return data;
}

export async function analyzeDataset(id: number): Promise<AnalyzeResultDto> {
  const { data } = await apiClient.post<AnalyzeResultDto>(`/v1/datasets/${id}/analyze`);
  return data;
}

/**
 * Chốt các sheet đã tích và nạp dữ liệu.
 *
 * Trả về MỘT MẢNG: mỗi sheet được tích thành một bộ dữ liệu riêng (§7.5). Bản
 * ghi `pending` sinh ra lúc xin presigned URL được backend dùng lại cho sheet
 * đầu tiên, nên `id` truyền vào đây nằm trong kết quả.
 */
export async function commitDatasets(
  id: number,
  input: CommitDatasetsInput,
): Promise<DatasetDetailDto[]> {
  const { data } = await apiClient.post<DatasetDetailDto[]>(`/v1/datasets/${id}/commit`, input);
  return data;
}

export async function deleteDataset(id: number): Promise<void> {
  await apiClient.delete(`/v1/datasets/${id}`);
}

// ─── Báo cáo ─────────────────────────────────────────────────────────────────

export interface ReportListQuery {
  workspaceId: number;
  page: number;
  pageSize: number;
  q: string;
}

export async function fetchReports(query: ReportListQuery): Promise<PageResult<ReportDto>> {
  const { data } = await apiClient.get<PageResult<ReportDto>>('/v1/reports', {
    params: clean({ ...query }),
  });
  return data;
}

export async function fetchReport(id: number): Promise<ReportDto> {
  const { data } = await apiClient.get<ReportDto>(`/v1/reports/${id}`);
  return data;
}

export async function fetchReportData(id: number): Promise<ReportDataDto> {
  const { data } = await apiClient.get<ReportDataDto>(`/v1/reports/${id}/data`);
  return data;
}

/**
 * `config` tuỳ chọn — bỏ trống thì backend tự suy từ cột của bộ dữ liệu.
 *
 * Wizard tích nhiều sheet cùng lúc, mỗi sheet có bộ cột khác nhau, nên không có
 * một cấu hình chung nào đúng cho tất cả.
 */
export async function createReport(input: CreateReportInput): Promise<ReportDto> {
  const { data } = await apiClient.post<ReportDto>('/v1/reports', input);
  return data;
}

export async function updateReport(
  id: number,
  input: { name: string; chartType: ChartType; config: ReportConfigDto },
): Promise<ReportDto> {
  const { data } = await apiClient.patch<ReportDto>(`/v1/reports/${id}`, input);
  return data;
}

export async function deleteReport(id: number): Promise<void> {
  await apiClient.delete(`/v1/reports/${id}`);
}
