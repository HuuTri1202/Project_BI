import type {
  DataModelColumnDto,
  DataModelDetailDto,
  DataModelDto,
  DataModelMeasureDto,
  DataModelRelationshipDto,
  ExplorerFieldsDto,
  ExplorerQueryDto,
  ExplorerResultDto,
  PageResult,
  SchemaListItemDto,
  SchemaSyncResultDto,
} from '@bi/shared';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { useWorkspace } from '../../workspace/useWorkspace';
import * as api from './api';
import { dataModelKeys } from './keys';

/**
 * Hook dữ liệu của tầng ngữ nghĩa (§10).
 *
 * Cùng luật dọn cache với phần còn lại: invalidate ở mức CAO NHẤT còn đúng.
 * Sửa một thước đo làm đổi tab Thước đo, tab Explorer (bộ chọn) LẪN kết quả
 * truy vấn đã chạy — nhắm đúng một khoá nghĩa là một trong ba chỗ hiện dữ liệu
 * cũ ngay sau khi người dùng tự tay đổi nó.
 */

export function useDataModels(
  query: Omit<api.DataModelListQuery, 'workspaceId'>,
): UseQueryResult<PageResult<DataModelDto>> {
  const { current } = useWorkspace();
  const workspaceId = current?.id ?? null;

  return useQuery({
    queryKey: dataModelKeys.list(workspaceId, query),
    queryFn: () => api.fetchDataModels({ ...query, workspaceId: workspaceId as number }),
    enabled: workspaceId !== null,
    placeholderData: keepPreviousData,
  });
}

export function useDataModel(id: number | null): UseQueryResult<DataModelDetailDto> {
  return useQuery({
    queryKey: dataModelKeys.detail(id ?? 0),
    queryFn: () => api.fetchDataModel(id as number),
    enabled: id !== null,
  });
}

/** Tab Schemas — đọc lại ClickHouse, nên đắt hơn `useDataModel`. */
export function useModelSchema(id: number | null): UseQueryResult<DataModelDetailDto> {
  return useQuery({
    queryKey: dataModelKeys.schema(id ?? 0),
    queryFn: () => api.fetchModelSchema(id as number),
    enabled: id !== null,
  });
}

/** Danh sách Schema — bảng ở tab Schemas (§8.3). */
export function useSchemas(id: number | null): UseQueryResult<SchemaListItemDto[]> {
  return useQuery({
    queryKey: dataModelKeys.schemas(id ?? 0),
    queryFn: () => api.fetchSchemas(id as number),
    enabled: id !== null,
  });
}

/** Field của một Schema — trang chi tiết (§8.3.1). */
export function useSchemaFields(
  id: number | null,
  schemaId: number | null,
): UseQueryResult<api.SchemaFieldsDto> {
  return useQuery({
    queryKey: dataModelKeys.schemaFields(id ?? 0, schemaId ?? 0),
    queryFn: () => api.fetchSchemaFields(id as number, schemaId as number),
    enabled: id !== null && schemaId !== null,
  });
}

export function useUpdateField(
  id: number,
  schemaId: number,
): UseMutationResult<
  DataModelColumnDto,
  unknown,
  { fieldId: number; input: Parameters<typeof api.updateField>[3] }
> {
  const invalidate = useInvalidateDataModel();
  return useMutation({
    mutationFn: ({ fieldId, input }) => api.updateField(id, schemaId, fieldId, input),
    onSuccess: invalidate,
  });
}

export function useAddDatasets(
  id: number,
): UseMutationResult<DataModelDetailDto, unknown, number[]> {
  const invalidate = useInvalidateDataModel();
  return useMutation({
    mutationFn: (datasetIds) => api.addDatasets(id, datasetIds),
    onSuccess: invalidate,
  });
}

export function useSyncSchema(
  id: number,
): UseMutationResult<SchemaSyncResultDto, unknown, number> {
  const invalidate = useInvalidateDataModel();
  return useMutation({
    mutationFn: (schemaId) => api.syncSchema(id, schemaId),
    onSuccess: invalidate,
  });
}

export function useMeasures(id: number | null): UseQueryResult<DataModelMeasureDto[]> {
  return useQuery({
    queryKey: dataModelKeys.measures(id ?? 0),
    queryFn: () => api.fetchMeasures(id as number),
    enabled: id !== null,
  });
}

export function useRelationships(
  id: number | null,
): UseQueryResult<DataModelRelationshipDto[]> {
  return useQuery({
    queryKey: dataModelKeys.relationships(id ?? 0),
    queryFn: () => api.fetchRelationships(id as number),
    enabled: id !== null,
  });
}

export function useExplorerFields(id: number | null): UseQueryResult<ExplorerFieldsDto> {
  return useQuery({
    queryKey: dataModelKeys.fields(id ?? 0),
    queryFn: () => api.fetchExplorerFields(id as number),
    enabled: id !== null,
  });
}

/**
 * Cube có đang chạy không.
 *
 * `retry: false` — khi Cube tắt thì nó tắt, và ba lần thử lại chỉ làm người
 * dùng chờ thêm sáu giây trước khi thấy đúng câu họ cần đọc.
 */
export function useExplorerStatus(id: number | null): UseQueryResult<api.ExplorerStatusDto> {
  return useQuery({
    queryKey: dataModelKeys.explorerStatus(id ?? 0),
    queryFn: () => api.fetchExplorerStatus(id as number),
    enabled: id !== null,
    retry: false,
    staleTime: 30_000,
  });
}

/**
 * Dọn mọi thứ một thay đổi mô hình có thể chạm tới.
 *
 * Quét cả cây `datamodels` chứ không nhắm từng khoá: bốn tab đọc bốn endpoint
 * khác nhau của cùng một mô hình, và gần như mọi thao tác ghi đều làm đổi ít
 * nhất hai trong bốn.
 */
export function useInvalidateDataModel(): () => Promise<void> {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: dataModelKeys.all });
  };
}

export function useCreateDataModel(): UseMutationResult<
  DataModelDto,
  unknown,
  Parameters<typeof api.createDataModel>[0]
> {
  const invalidate = useInvalidateDataModel();
  return useMutation({ mutationFn: api.createDataModel, onSuccess: invalidate });
}

export function useUpdateDataModel(
  id: number,
): UseMutationResult<DataModelDto, unknown, { name: string; description: string | null }> {
  const invalidate = useInvalidateDataModel();
  return useMutation({
    mutationFn: (input) => api.updateDataModel(id, input),
    onSuccess: invalidate,
  });
}

export function useDeleteDataModel(): UseMutationResult<void, unknown, number> {
  const invalidate = useInvalidateDataModel();
  return useMutation({ mutationFn: api.deleteDataModel, onSuccess: invalidate });
}

export function useSaveSchema(
  id: number,
): UseMutationResult<DataModelDetailDto, unknown, Parameters<typeof api.saveSchema>[1]> {
  const invalidate = useInvalidateDataModel();
  return useMutation({
    mutationFn: (input) => api.saveSchema(id, input),
    onSuccess: invalidate,
  });
}

export function useCreateMeasure(
  id: number,
): UseMutationResult<DataModelMeasureDto, unknown, Parameters<typeof api.createMeasure>[1]> {
  const invalidate = useInvalidateDataModel();
  return useMutation({
    mutationFn: (input) => api.createMeasure(id, input),
    onSuccess: invalidate,
  });
}

export function useUpdateMeasure(
  id: number,
): UseMutationResult<
  DataModelMeasureDto,
  unknown,
  { measureId: number; input: Parameters<typeof api.updateMeasure>[2] }
> {
  const invalidate = useInvalidateDataModel();
  return useMutation({
    mutationFn: ({ measureId, input }) => api.updateMeasure(id, measureId, input),
    onSuccess: invalidate,
  });
}

export function useDeleteMeasure(id: number): UseMutationResult<void, unknown, number> {
  const invalidate = useInvalidateDataModel();
  return useMutation({
    mutationFn: (measureId) => api.deleteMeasure(id, measureId),
    onSuccess: invalidate,
  });
}

export function useCreateRelationship(
  id: number,
): UseMutationResult<
  api.CreateRelationshipResult,
  unknown,
  Parameters<typeof api.createRelationship>[1]
> {
  const invalidate = useInvalidateDataModel();
  return useMutation({
    mutationFn: (input) => api.createRelationship(id, input),
    onSuccess: invalidate,
  });
}

export function useDeleteRelationship(id: number): UseMutationResult<void, unknown, number> {
  const invalidate = useInvalidateDataModel();
  return useMutation({
    mutationFn: (relId) => api.deleteRelationship(id, relId),
    onSuccess: invalidate,
  });
}

/**
 * Lưu vị trí canvas.
 *
 * CỐ Ý không invalidate: vị trí đã nằm trong state của canvas, và làm mới lại
 * cả cây sau mỗi lần thả chuột sẽ khiến các thẻ nhảy về giá trị server ngay
 * dưới con trỏ người dùng.
 */
export function useSaveLayout(
  id: number,
): UseMutationResult<void, unknown, Parameters<typeof api.saveLayout>[1]> {
  return useMutation({ mutationFn: (input) => api.saveLayout(id, input) });
}

export function useRunQuery(
  id: number,
): UseMutationResult<ExplorerResultDto, unknown, ExplorerQueryDto> {
  // `useMutation` chứ không `useQuery`: truy vấn chạy khi người dùng BẤM, không
  // phải khi họ vừa tích một ô. Mỗi lần tích một trường mà tự chạy là một lần
  // quét ClickHouse cho một câu hỏi chưa hoàn chỉnh.
  return useMutation({ mutationFn: (input) => api.runQuery(id, input) });
}
