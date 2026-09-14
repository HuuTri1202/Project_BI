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
  measures: (id: number) => [...dataModelKeys.all, 'measures', id] as const,
  relationships: (id: number) => [...dataModelKeys.all, 'relationships', id] as const,
  fields: (id: number) => [...dataModelKeys.all, 'fields', id] as const,
  explorerStatus: (id: number) => [...dataModelKeys.all, 'explorer-status', id] as const,
  /**
   * Số liệu xem trước của trình dựng biểu đồ (§10.9).
   *
   * `body` chỉ được chứa những thứ ĐỔI SỐ LIỆU — chiều, thước đo, trần nhóm,
   * loại biểu đồ. Nhét cả bảng màu và các công tắc trình bày vào đây nghĩa là
   * mỗi lần người dùng đổi màu là một lượt quét ClickHouse cho đúng con số vừa
   * quét xong. Xem `ModelReportPreviewInput`.
   */
  /**
   * `page` là một PHẦN của khoá, không phải một tham số phụ.
   *
   * Trang 1 và trang 2 là hai câu trả lời khác nhau cho cùng một cấu hình. Bỏ
   * nó ra ngoài khoá thì bấm ‹ › là một lần TRÚNG cache: không request, không
   * lỗi, biểu đồ đứng yên — hai cái nút không làm gì cả.
   */
  reportPreview: (id: number, body: unknown, page = 0) =>
    [...dataModelKeys.all, 'report-preview', id, body, page] as const,
};
