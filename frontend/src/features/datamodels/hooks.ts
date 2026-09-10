import type {
  CreateFormulaMeasureInput,
  CreateRowExprMeasureInput,
  DataModelDetailDto,
  DataModelDto,
  DataModelMeasureDto,
  DataModelRelationshipDto,
  ExplorerFieldsDto,
  ExplorerQueryDto,
  ExplorerResultDto,
  ExplorerSqlDto,
  PageResult,
  ReportDataDto,
} from '@bi/shared';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useMemo } from 'react';

import { readSnapshot, snapshotIdOf, writeSnapshot } from '../../services/querySnapshots';
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

/**
 * Danh sách mô hình của workspace ĐANG MỞ.
 *
 * Mô hình thuộc về một workspace và chỉ hiện trong workspace đó — cách ly là có
 * chủ đích, không phải tác dụng phụ.
 *
 * ⚠️ Điều đó CHỈ đúng nếu đường tạo mô hình gửi `workspaceId` tường minh. Bỏ
 * trống thì backend rơi vào `resolveWorkspace(undefined)`, nhánh này chọn
 * workspace đầu tiên theo TÊN, và mô hình rơi vào một workspace khác chỗ người
 * dùng đang đứng — nó biến mất khỏi danh sách ngay lập tức, trông hệt như dữ
 * liệu không được lưu. Xem `CreateDataModelModal`.
 */
export function useDataModels(
  query: Omit<api.DataModelListQuery, 'workspaceId'>,
  /**
   * `enabled: false` để HOÃN request cho tới lúc thật sự cần.
   *
   * Dùng ở hộp thoại chọn mô hình: nó nằm sẵn trong cây từ lúc trang chủ mở
   * ra, nên không có cờ này thì mọi lượt ghé trang chủ đều kéo về một danh sách
   * mà phần lớn không ai mở.
   */
  options?: { enabled?: boolean },
): UseQueryResult<PageResult<DataModelDto>> {
  const { current } = useWorkspace();
  const workspaceId = current?.id ?? null;

  return useQuery({
    queryKey: dataModelKeys.list(workspaceId, query),
    queryFn: () => api.fetchDataModels({ ...query, workspaceId: workspaceId as number }),
    enabled: workspaceId !== null && options?.enabled !== false,
    placeholderData: keepPreviousData,
  });
}

/**
 * Mô hình của CẢ tổ chức — chỉ dùng để giải thích một danh sách rỗng.
 *
 * Khi workspace đang mở không có mô hình nào, câu hỏi duy nhất người dùng cần
 * trả lời là "vậy mấy cái tôi vừa làm đâu rồi". Một khung rỗng im lặng khiến họ
 * kết luận là mất dữ liệu; đếm được số mô hình nằm ở workspace khác thì khung
 * rỗng nói ra được chỗ cần tới.
 *
 * `enabled` để nó KHÔNG chạy ở trường hợp thường: danh sách có mô hình thì
 * không có gì cần giải thích, và một request thừa mỗi lần mở trang là cái giá
 * vô lý cho một dòng chữ hiếm khi hiện.
 */
export function useDataModelsElsewhere(enabled: boolean): UseQueryResult<PageResult<DataModelDto>> {
  const query = { page: 1, pageSize: 100, q: '', sort: 'updatedAt', order: 'desc' as const };
  return useQuery({
    queryKey: dataModelKeys.list(null, query),
    queryFn: () => api.fetchDataModels(query),
    enabled,
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

export function useMeasures(id: number | null): UseQueryResult<DataModelMeasureDto[]> {
  return useQuery({
    queryKey: dataModelKeys.measures(id ?? 0),
    queryFn: () => api.fetchMeasures(id as number),
    enabled: id !== null,
  });
}

export function useRelationships(id: number | null): UseQueryResult<DataModelRelationshipDto[]> {
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
 * Số liệu xem trước của trình dựng biểu đồ — §10.9.
 *
 * ═══ Vì sao là QUERY, trong khi Explorer dùng MUTATION ══════════════════════
 *
 * Explorer bắt bấm "Chạy truy vấn" vì ở đó người dùng tích dần nhiều trường rồi
 * mới hỏi một lần — tự chạy sau mỗi ô tích là một lượt quét ClickHouse cho một
 * câu hỏi chưa hoàn chỉnh.
 *
 * Trình dựng thì ngược lại: một chiều và một thước đo là ĐỦ để có biểu đồ, và
 * mỗi lần đổi là một câu hỏi trọn vẹn. Bắt bấm thêm một nút ở đó là chèn một
 * bước vào giữa "kéo thả" và "thấy kết quả" — đúng khoảnh khắc mà cả màn hình
 * này tồn tại để rút ngắn.
 *
 * Khoá cache chỉ mang thứ đổi số liệu, nên đổi bảng màu không tốn vòng mạng
 * nào, và quay lại một cấu hình vừa xem thì hiện ra ngay từ cache.
 *
 * `retry: false`: lỗi hay gặp nhất ở đây là 400 "chiều không còn trong mô hình"
 * — thử lại ba lần không đổi được gì ngoài việc giữ người dùng chờ.
 *
 * ═══ Mở một báo cáo ĐÃ LƯU thì vẽ NGAY ══════════════════════════════════════
 *
 * Cache của react-query nằm trong bộ nhớ của tab: F5, hay mở lại sau khi đóng
 * trình duyệt, là mất sạch. Nên trước bản này, mở một báo cáo đã lưu luôn bắt
 * đầu bằng "Đang tính…" và vài giây chờ — để rồi vẽ ra ĐÚNG cái biểu đồ lần
 * trước. Chậm nhất là lần đầu sau khi Cube khởi động hoặc sau khi mô hình đổi:
 * đo được 4.638 ms, so với 49–175 ms khi Cube đã biên dịch xong schema.
 *
 * `querySnapshots` giữ câu trả lời cuối trên đĩa và nạp lại qua `initialData`.
 * Không phải để KHỎI hỏi — `initialDataUpdatedAt` mang đúng lúc con số được
 * tính, nên `staleTime` vẫn bắn một lượt làm mới ngay khi mở. Người dùng thấy
 * biểu đồ ở khung hình đầu tiên, con số đúng tới sau, và ô tự nói "đang cập
 * nhật…" trong lúc chờ.
 *
 * Ảnh chụp KHÔNG che được lỗi: `isError` vẫn thắng ở `CanvasBoard`, nên Cube
 * chết là ô hiện câu lỗi chứ không phải một biểu đồ cũ trông như còn sống.
 */
export function useModelReportPreview(
  id: number | null,
  input: api.ModelReportPreviewInput | null,
): UseQueryResult<ReportDataDto> {
  const page = input?.page ?? 0;
  const queryKey = dataModelKeys.reportPreview(id ?? 0, input?.config ?? null, page);
  // `localStorage` là I/O đồng bộ. Đọc một lần cho mỗi khoá chứ không phải mỗi
  // lần render — một ô đang được kéo re-render vài chục lần một giây.
  const snapshotId = snapshotIdOf(queryKey);
  /*
   * CHỈ chụp trang đầu.
   *
   * Ảnh chụp tồn tại để "mở một báo cáo đã lưu là thấy biểu đồ ngay", và một
   * báo cáo mở ra bao giờ cũng ở trang đầu. Chụp cả những trang người dùng lật
   * qua là lấy chỗ của những báo cáo KHÁC trong một ngân sách 40 mục — đổi một
   * thứ có ích lấy một thứ không ai đợi.
   */
  const cacheable = page === 0;
  const saved = useMemo(
    () => (cacheable ? readSnapshot<ReportDataDto>(snapshotId) : null),
    [cacheable, snapshotId],
  );

  return useQuery({
    /*
     * Khoá theo `config`, KHÔNG theo cả `input`.
     *
     * `chartType` vẫn đi trong thân request — backend kiểm nó, và đó là lớp
     * chặn cuối. Nhưng nó không đổi được SỐ LIỆU: trang tự quy chiều thứ hai về
     * `null` cho loại không nhận nó, và tự chặn hẳn truy vấn với loại bắt buộc
     * phải có mà chưa có. Nên hai loại biểu đồ với cùng một `config` luôn nhận
     * về cùng một câu trả lời.
     *
     * Để `chartType` vào khoá thì lướt thử tám loại là tám lượt quét ClickHouse
     * cho đúng một con số — đúng thứ khiến người dùng ngại bấm thử.
     */
    queryKey,
    queryFn: async () => {
      const data = await api.previewModelReport(id as number, input as api.ModelReportPreviewInput);
      writeSnapshot(snapshotId, data);
      return data;
    },
    enabled: id !== null && input !== null,
    retry: false,
    // Trải ra chứ không đặt `initialData: saved?.data`: `undefined` cho
    // `initialData` là hợp lệ và có nghĩa "không có", nhưng nó vẫn đi kèm một
    // `initialDataUpdatedAt` — query sẽ tưởng mình đang giữ dữ liệu cũ.
    ...(saved === null ? {} : { initialData: saved.data, initialDataUpdatedAt: saved.at }),
    // Giữ biểu đồ CŨ trên màn hình trong lúc nạp cấu hình mới. Không có nó thì
    // mỗi lần thả một trường, khung biểu đồ trắng xoá rồi mới vẽ lại — nhấp
    // nháy đúng vào lúc người dùng đang so sánh trước và sau.
    placeholderData: keepPreviousData,
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

/**
 * Thêm bảng vào mô hình đã có — §10.2.
 *
 * Endpoint tồn tại từ đầu nhưng không có đường nào gọi tới: mô hình chỉ nhận
 * bảng đúng một lần lúc tạo, và sau đó muốn thêm một bảng thì phải xoá cả mô
 * hình rồi dựng lại từ đầu, mất sạch alias, thước đo và quan hệ đã khai.
 */
export function useAddDatasets(
  id: number,
): UseMutationResult<DataModelDetailDto, unknown, number[]> {
  const invalidate = useInvalidateDataModel();
  return useMutation({
    mutationFn: (datasetIds) => api.addDatasets(id, datasetIds),
    onSuccess: invalidate,
  });
}

/** Sửa tên hiển thị / mô tả / khoá chính của một bảng trong mô hình — §10.3. */
export function useUpdateModelDataset(
  id: number,
): UseMutationResult<
  api.UpdateModelDatasetResult,
  unknown,
  { refId: number; input: api.UpdateModelDatasetInput }
> {
  const invalidate = useInvalidateDataModel();
  return useMutation({
    mutationFn: ({ refId, input }) => api.updateModelDataset(id, refId, input),
    onSuccess: invalidate,
  });
}

export function useRemoveDataset(id: number): UseMutationResult<void, unknown, number> {
  const invalidate = useInvalidateDataModel();
  return useMutation({
    mutationFn: (refId) => api.removeDataset(id, refId),
    onSuccess: invalidate,
  });
}

/*
 * Không có `useCreateMeasure`/`useUpdateMeasure` ở đây, và đó là có chủ đích.
 *
 * Thước đo dựng-trên-cột được khai ở tab Schemas, đi chung nút "Lưu thay đổi"
 * với tên hiển thị và vai trò — tức là qua `useSaveSchema`, một lần ghi cho cả
 * bảng. Hai hook tạo/sửa từng thước đo là tàn dư của tab Measures đã bỏ; giữ
 * lại thì lần sau có người gọi chúng và ghi đè mất phần cột trong cùng lần lưu.
 *
 * Endpoint phía backend thì VẪN CÒN: nó là đường duy nhất tạo một thước đo
 * `count` cho mô hình dựng trước migration 14, và nó có test tích hợp.
 */

/**
 * Tạo thước đo TÍNH TOÁN — §10.6.
 *
 * Quét cả cây `datamodels` như mọi thao tác ghi khác ở đây: một thước đo mới
 * làm đổi bộ đếm trên đầu trang, danh sách thước đo, VÀ bộ chọn của Explorer.
 */
export function useCreateFormulaMeasure(
  id: number,
): UseMutationResult<DataModelMeasureDto, unknown, CreateFormulaMeasureInput> {
  const invalidate = useInvalidateDataModel();
  return useMutation({
    mutationFn: (input) => api.createFormulaMeasure(id, input),
    onSuccess: invalidate,
  });
}

export function useCreateRowExprMeasure(
  id: number,
): UseMutationResult<DataModelMeasureDto, unknown, CreateRowExprMeasureInput> {
  const invalidate = useInvalidateDataModel();
  return useMutation({
    mutationFn: (input) => api.createRowExprMeasure(id, input),
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

/**
 * Câu lệnh SQL của một truy vấn.
 *
 * Cũng là `useMutation` như `useRunQuery`, và vì cùng một lý do: nó gọi sang
 * Cube, nên chỉ chạy khi người dùng MỞ khối xem câu lệnh — không phải mỗi lần
 * họ tích thêm một ô.
 */
export function useQuerySql(
  id: number,
): UseMutationResult<ExplorerSqlDto, unknown, ExplorerQueryDto> {
  return useMutation({ mutationFn: (input) => api.querySql(id, input) });
}
