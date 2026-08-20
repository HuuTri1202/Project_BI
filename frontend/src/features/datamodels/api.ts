import type {
  CreateDataModelInput,
  CreateFormulaMeasureInput,
  CreateRowExprMeasureInput,
  CreateRelationshipInput,
  DataModelDetailDto,
  DataModelDto,
  DataModelMeasureDto,
  DataModelRelationshipDto,
  ExplorerFieldsDto,
  ExplorerQueryDto,
  ExplorerResultDto,
  ExplorerSqlDto,
  PageResult,
  PrimaryKeyWarningDto,
  RelationshipWarningDto,
  SaveLayoutInput,
  SaveSchemaInput,
} from '@bi/shared';
import { apiClient } from '../../services/apiClient';

/**
 * Lời gọi HTTP của tầng ngữ nghĩa (§10).
 *
 * Cùng quy ước với `features/tenant/api.ts`: đường dẫn tương đối với
 * `VITE_API_BASE_URL`, token do interceptor tự gắn, không hàm nào nhận
 * `tenantId` (backend lấy từ token), và không hàm nào bắt lỗi — react-query cần
 * thấy Promise bị reject.
 *
 * ⚠️ KHÔNG có hàm nào gọi thẳng Cube.js. Trình duyệt không biết cổng 4100 tồn
 * tại, và cũng không bao giờ thấy một tên cube — nó gửi ID, Express dựng tên.
 * Xem `services/datamodel/explorer.ts` phía backend.
 */

function clean(input: Record<string, string | number | undefined>): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== '') out[key] = value;
  }
  return out;
}

export interface DataModelListQuery {
  /** Bỏ trống = cả tổ chức. Xem ghi chú ở `useDataModels` và ở backend. */
  workspaceId?: number;
  page: number;
  pageSize: number;
  q: string;
  sort: string;
  order: 'asc' | 'desc';
}

export async function fetchDataModels(
  query: DataModelListQuery,
): Promise<PageResult<DataModelDto>> {
  const { data } = await apiClient.get<PageResult<DataModelDto>>('/v1/datamodels', {
    params: clean({ ...query }),
  });
  return data;
}

export async function fetchDataModel(id: number): Promise<DataModelDetailDto> {
  const { data } = await apiClient.get<DataModelDetailDto>(`/v1/datamodels/${id}`);
  return data;
}

/**
 * Cấu trúc ĐỌC LẠI từ ClickHouse — §10.3.
 *
 * Khác `fetchDataModel` ở chỗ nó hỏi kho, nên nó phát hiện được cột đã đổi kiểu
 * sau một lần nạp lại. Đắt hơn, nên chỉ tab Schemas gọi.
 */
export async function fetchModelSchema(id: number): Promise<DataModelDetailDto> {
  const { data } = await apiClient.get<DataModelDetailDto>(`/v1/datamodels/${id}/schema`);
  return data;
}

export async function createDataModel(input: CreateDataModelInput): Promise<DataModelDto> {
  const { data } = await apiClient.post<DataModelDto>('/v1/datamodels', input);
  return data;
}

export async function updateDataModel(
  id: number,
  input: { name: string; description: string | null },
): Promise<DataModelDto> {
  const { data } = await apiClient.patch<DataModelDto>(`/v1/datamodels/${id}`, input);
  return data;
}

export async function deleteDataModel(id: number): Promise<void> {
  await apiClient.delete(`/v1/datamodels/${id}`);
}

export async function addDatasets(id: number, datasetIds: number[]): Promise<DataModelDetailDto> {
  const { data } = await apiClient.post<DataModelDetailDto>(`/v1/datamodels/${id}/datasets`, {
    datasetIds,
  });
  return data;
}

export async function removeDataset(id: number, refId: number): Promise<void> {
  await apiClient.delete(`/v1/datamodels/${id}/datasets/${refId}`);
}

/**
 * Sửa một BẢNG trong mô hình — tên hiển thị, mô tả, khoá chính.
 *
 * Trường nào KHÔNG gửi thì backend giữ nguyên. Nhờ vậy hộp thoại "Đặt khoá
 * chính" chỉ cần gửi `primaryColumnId` mà không xoá mất mô tả người dùng đã
 * viết, và ngược lại.
 */
export interface UpdateModelDatasetInput {
  displayName?: string | null;
  description?: string | null;
  primaryColumnId?: number | null;
}

export interface UpdateModelDatasetResult {
  dataModel: DataModelDetailDto;
  /** `null` khi không đặt khoá chính, hoặc khi kho không kiểm được. */
  warning: PrimaryKeyWarningDto | null;
}

export async function updateModelDataset(
  id: number,
  refId: number,
  input: UpdateModelDatasetInput,
): Promise<UpdateModelDatasetResult> {
  const { data } = await apiClient.patch<UpdateModelDatasetResult>(
    `/v1/datamodels/${id}/datasets/${refId}`,
    input,
  );
  return data;
}

export async function saveSchema(
  id: number,
  input: SaveSchemaInput,
): Promise<DataModelDetailDto> {
  const { data } = await apiClient.patch<DataModelDetailDto>(`/v1/datamodels/${id}/schema`, input);
  return data;
}

export async function saveLayout(id: number, input: SaveLayoutInput): Promise<void> {
  await apiClient.patch(`/v1/datamodels/${id}/layout`, input);
}

// ─── Thước đo ────────────────────────────────────────────────────────────────

export async function fetchMeasures(id: number): Promise<DataModelMeasureDto[]> {
  const { data } = await apiClient.get<DataModelMeasureDto[]>(`/v1/datamodels/${id}/measures`);
  return data;
}

/*
 * `POST /measures` và `PATCH /measures/:id` KHÔNG có bản bọc ở đây: thước đo
 * dựng-trên-cột đi qua `saveSchema`, cùng một lần ghi với vai trò và tên hiển
 * thị của cột. Xem ghi chú ở `hooks.ts`.
 */

/** Thước đo TÍNH TOÁN — §10.6. Hai vế là ID, không phải chuỗi công thức. */
export async function createFormulaMeasure(
  id: number,
  input: CreateFormulaMeasureInput,
): Promise<DataModelMeasureDto> {
  const { data } = await apiClient.post<DataModelMeasureDto>(
    `/v1/datamodels/${id}/measures/formula`,
    input,
  );
  return data;
}

export async function createRowExprMeasure(
  id: number,
  input: CreateRowExprMeasureInput,
): Promise<DataModelMeasureDto> {
  const { data } = await apiClient.post<DataModelMeasureDto>(
    `/v1/datamodels/${id}/measures/row-expr`,
    input,
  );
  return data;
}

export async function deleteMeasure(id: number, measureId: number): Promise<void> {
  await apiClient.delete(`/v1/datamodels/${id}/measures/${measureId}`);
}

// ─── Quan hệ ─────────────────────────────────────────────────────────────────

export async function fetchRelationships(id: number): Promise<DataModelRelationshipDto[]> {
  const { data } = await apiClient.get<DataModelRelationshipDto[]>(
    `/v1/datamodels/${id}/relationships`,
  );
  return data;
}

/** Trả kèm CẢNH BÁO khoá trùng — giao diện phải hiện nó, xem `relationships.ts`. */
export interface CreateRelationshipResult {
  relationship: DataModelRelationshipDto;
  warning: RelationshipWarningDto;
}

export async function createRelationship(
  id: number,
  input: CreateRelationshipInput,
): Promise<CreateRelationshipResult> {
  const { data } = await apiClient.post<CreateRelationshipResult>(
    `/v1/datamodels/${id}/relationships`,
    input,
  );
  return data;
}

export async function deleteRelationship(id: number, relId: number): Promise<void> {
  await apiClient.delete(`/v1/datamodels/${id}/relationships/${relId}`);
}

// ─── Explorer ────────────────────────────────────────────────────────────────

export interface ExplorerStatusDto {
  cubeReady: boolean;
  /** Lệnh phải chạy khi Cube chưa bật. Từ backend để hai bên không lệch nhau. */
  command: string;
}

export async function fetchExplorerStatus(id: number): Promise<ExplorerStatusDto> {
  const { data } = await apiClient.get<ExplorerStatusDto>(
    `/v1/datamodels/${id}/explorer-status`,
  );
  return data;
}

export async function fetchExplorerFields(id: number): Promise<ExplorerFieldsDto> {
  const { data } = await apiClient.get<ExplorerFieldsDto>(`/v1/datamodels/${id}/fields`);
  return data;
}

export async function runQuery(
  id: number,
  input: ExplorerQueryDto,
): Promise<ExplorerResultDto> {
  const { data } = await apiClient.post<ExplorerResultDto>(`/v1/datamodels/${id}/query`, input);
  return data;
}

/** Câu lệnh Cube sẽ chạy cho lựa chọn này — không chạy nó. */
export async function querySql(id: number, input: ExplorerQueryDto): Promise<ExplorerSqlDto> {
  const { data } = await apiClient.post<ExplorerSqlDto>(`/v1/datamodels/${id}/query/sql`, input);
  return data;
}
