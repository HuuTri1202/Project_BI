import type {
  AnalyzeResultDto,
  ChartType,
  CommitDatasetsInput,
  CreateCanvasReportInput,
  CreateModelReportInput,
  CreateReportInput,
  CreateUploadResultDto,
  DatasetDetailDto,
  PageResult,
  ReportCanvasDataDto,
  ReportConfigDto,
  ReportDataDto,
  ReportDto,
  UpdateCanvasReportInput,
  UpdateModelReportInput,
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
//
// Chỉ luồng TẢI FILE nằm ở đây. Danh sách, chi tiết và xoá bộ dữ liệu dùng chung
// với nguồn `connection` nên sống ở `features/tenant/api.ts` — một trang Kho dữ
// liệu, một bộ hàm gọi API.

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

export async function fetchReportData(id: number, page = 0): Promise<ReportDataDto> {
  const { data } = await apiClient.get<ReportDataDto>(`/v1/reports/${id}/data`, {
    // Không gửi `page=0`: mọi báo cáo không chia trang sẽ mang thêm một tham số
    // vô nghĩa trong log truy cập, và một tham số vô nghĩa ở khắp nơi là một
    // tham số không ai để ý khi nó bắt đầu có nghĩa.
    ...(page > 0 ? { params: { page } } : {}),
  });
  return data;
}

/**
 * Số liệu của MỘT ô ở một TRANG NHÓM — §10.12, cho hai cái nút ‹ ›.
 *
 * Đường riêng thay vì gọi lại `report-preview`: endpoint kia gác `datamodel:read`
 * mà viewer không có, nên hai cái nút sẽ chết ở đúng người cần chúng nhất.
 */
export async function fetchReportVisualData(
  id: number,
  visualId: string,
  page: number,
): Promise<ReportDataDto> {
  const { data } = await apiClient.get<ReportDataDto>(
    `/v1/reports/${id}/visuals/${encodeURIComponent(visualId)}/data`,
    { params: { page } },
  );
  return data;
}

/**
 * Tạo báo cáo RỖNG — chỉ tên và bộ dữ liệu.
 *
 * Không nhận loại biểu đồ hay cấu hình trục: biểu đồ là việc người dùng dựng
 * trên trang Report, không phải thứ wizard đoán hộ.
 */
export async function createReport(input: CreateReportInput): Promise<ReportDto> {
  const { data } = await apiClient.post<ReportDto>('/v1/reports', input);
  return data;
}

/**
 * Tạo báo cáo trên MÔ HÌNH — §10.8. Ngược cái trên: ra đời là đã có biểu đồ.
 *
 * `config` toàn ID. Không một tên cột nào rời trình duyệt, cùng luật với
 * `runQuery` của Explorer.
 */
export async function createModelReport(input: CreateModelReportInput): Promise<ReportDto> {
  const { data } = await apiClient.post<ReportDto>('/v1/reports/from-datamodel', input);
  return data;
}

export async function updateReport(
  id: number,
  input: { name: string; chartType: ChartType; config: ReportConfigDto },
): Promise<ReportDto> {
  const { data } = await apiClient.patch<ReportDto>(`/v1/reports/${id}`, input);
  return data;
}

/**
 * Sửa báo cáo dựng trên MÔ HÌNH — §10.9.
 *
 * Đường riêng vì `config` là hình dạng khác hẳn: toàn ID thay cho tên cột. Gửi
 * nhầm sang `updateReport` thì backend đọc ra một cấu hình rỗng và báo cáo mất
 * biểu đồ — nên hai vế đều chặn, xem chú thích ở hai route.
 */
export async function updateModelReport(
  id: number,
  input: UpdateModelReportInput,
): Promise<ReportDto> {
  const { data } = await apiClient.patch<ReportDto>(`/v1/reports/${id}/from-datamodel`, input);
  return data;
}

/**
 * Số liệu của mọi ô trên MỘT TRANG — một request, xem route cùng tên.
 *
 * `pageId === null` nghĩa là "trang đầu", và backend cũng rơi về đó khi mã trang
 * không còn tồn tại — trang vừa bị người khác xoá thì rơi về đầu chứ không phải
 * ra một màn hình lỗi.
 */
export async function fetchReportCanvasData(
  id: number,
  pageId: string | null,
): Promise<ReportCanvasDataDto> {
  const { data } = await apiClient.get<ReportCanvasDataDto>(`/v1/reports/${id}/canvas-data`, {
    ...(pageId === null ? {} : { params: { pageId } }),
  });
  return data;
}

/** Tạo báo cáo NHIỀU biểu đồ — §10.10. */
export async function createCanvasReport(input: CreateCanvasReportInput): Promise<ReportDto> {
  const { data } = await apiClient.post<ReportDto>('/v1/reports/canvas', input);
  return data;
}

/**
 * Lưu một khung — §10.10.
 *
 * ⚠️ Cũng là đường CHUYỂN ĐỔI: gọi nó trên một báo cáo một-biểu-đồ sẽ biến nó
 * thành báo cáo nhiều biểu đồ, và không có đường ngược lại. Xem route cùng tên.
 */
export async function updateCanvasReport(
  id: number,
  input: UpdateCanvasReportInput,
): Promise<ReportDto> {
  const { data } = await apiClient.patch<ReportDto>(`/v1/reports/${id}/canvas`, input);
  return data;
}

export async function deleteReport(id: number): Promise<void> {
  await apiClient.delete(`/v1/reports/${id}`);
}
