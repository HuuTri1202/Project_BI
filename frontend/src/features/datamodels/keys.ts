/**
 * Khoá cache react-query của tầng ngữ nghĩa (§10).
 *
 * Cùng hai luật cứng với `features/tenant/keys.ts`:
 *
 *   - KHÔNG BAO GIỜ đưa `tenantId` vào khoá. Một token mở đúng một tổ chức, và
 *     đổi phiên thì `queryClient.clear()` dọn sạch.
 *   - `workspaceId` BẮT BUỘC có trong khoá của mọi thứ thuộc phạm vi workspace.
 *     Thiếu nó thì đổi workspace vẫn hiện dữ liệu của workspace trước.
 *
 * `detail`, `schema`, `measures`… không mang `workspaceId` vì chúng đã được
 * khoá theo id mô hình, mà một mô hình chỉ thuộc đúng một workspace — cùng lý
 * do `datasetKeys.detail` không mang nó.
 */
export const dataModelKeys = {
  all: ['datamodels'] as const,
  list: (workspaceId: number | null, query: unknown) =>
    [...dataModelKeys.all, 'list', workspaceId, query] as const,
  detail: (id: number) => [...dataModelKeys.all, 'detail', id] as const,
  schema: (id: number) => [...dataModelKeys.all, 'schema', id] as const,
  schemas: (id: number) => [...dataModelKeys.all, 'schemas', id] as const,
  schemaFields: (id: number, schemaId: number) =>
    [...dataModelKeys.all, 'schema-fields', id, schemaId] as const,
  measures: (id: number) => [...dataModelKeys.all, 'measures', id] as const,
  relationships: (id: number) => [...dataModelKeys.all, 'relationships', id] as const,
  fields: (id: number) => [...dataModelKeys.all, 'fields', id] as const,
  explorerStatus: (id: number) => [...dataModelKeys.all, 'explorer-status', id] as const,
};
