/**
 * Query key của bộ dữ liệu và báo cáo (§7).
 *
 * Cùng luật với `features/tenant/keys.ts`: KHÔNG gắn `tenantId` (token chỉ mở
 * một tổ chức, và `queryClient.clear()` dọn sạch khi đổi tài khoản), nhưng
 * `workspaceId` BẮT BUỘC có mặt trong mọi thứ thuộc về một workspace — thiếu nó,
 * đổi workspace sẽ hiện lại bộ dữ liệu của workspace cũ cho tới lần refetch kế
 * tiếp, và người dùng tin vào dữ liệu sai.
 */
export const datasetKeys = {
  all: ['datasets'] as const,

  list: (workspaceId: number | null, query: unknown) =>
    [...datasetKeys.all, 'list', workspaceId, query] as const,

  detail: (id: number) => [...datasetKeys.all, 'detail', id] as const,

  reports: () => ['reports'] as const,
  reportList: (workspaceId: number | null, query: unknown) =>
    [...datasetKeys.reports(), 'list', workspaceId, query] as const,
  report: (id: number) => [...datasetKeys.reports(), 'detail', id] as const,
  /**
   * Dữ liệu đã tổng hợp, tách khỏi metadata của báo cáo.
   *
   * Hai thứ có nhịp đổi khác nhau: đổi tên báo cáo không làm số liệu đổi, còn
   * nạp lại bộ dữ liệu thì ngược lại. Gộp chung một key nghĩa là mỗi lần đổi tên
   * cũng kéo theo việc tổng hợp lại toàn bộ dòng.
   */
  reportData: (id: number) => [...datasetKeys.reports(), 'data', id] as const,
};
