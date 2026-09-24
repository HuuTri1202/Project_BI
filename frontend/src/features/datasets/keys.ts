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
   * Thư mục báo cáo — §10.25.
   *
   * Nằm DƯỚI `reports()` để một lần dọn danh sách báo cáo dọn luôn cả nó: số
   * báo cáo in cạnh mỗi thư mục đổi theo đúng những thao tác làm đổi danh sách
   * (tạo, xoá, chuyển). Tách ra một nhánh riêng nghĩa là mỗi chỗ gọi phải nhớ
   * dọn hai thứ, và chỗ quên sẽ hiện một con số cũ ngay cạnh danh sách mới.
   */
  reportFolders: (workspaceId: number | null) =>
    [...datasetKeys.reports(), 'folders', workspaceId] as const,
  /**
   * Dữ liệu đã tổng hợp, tách khỏi metadata của báo cáo.
   *
   * Hai thứ có nhịp đổi khác nhau: đổi tên báo cáo không làm số liệu đổi, còn
   * nạp lại bộ dữ liệu thì ngược lại. Gộp chung một key nghĩa là mỗi lần đổi tên
   * cũng kéo theo việc tổng hợp lại toàn bộ dòng.
   */
  /**
   * Tiền tố của MỌI trang nhóm một báo cáo — để dọn cache sau khi lưu.
   *
   * react-query so khoá theo TIỀN TỐ, nên dọn bằng `reportData(id, 0)` chỉ dọn
   * đúng trang đầu và để lại số cũ ở mọi trang khác. Có một hàm riêng cho việc
   * này thay vì viết tay cái mảng ở chỗ gọi: viết tay là chỗ duy nhất trong
   * codebase biết cấu trúc khoá mà không đi qua file này.
   */
  reportDataAll: (id: number) => [...datasetKeys.reports(), 'data', id] as const,
  reportData: (id: number, page = 0) => [...datasetKeys.reportDataAll(id), page] as const,

  /**
   * Số liệu của MỘT ô ở một trang nhóm — §10.12.
   *
   * `page` nằm trong khoá vì trang 1 và trang 2 là hai câu trả lời khác nhau;
   * bỏ nó ra là bấm ‹ › trúng cache và biểu đồ đứng yên. Nó cũng có nghĩa là
   * lật đi lật lại giữa hai trang chỉ tốn một lượt cho mỗi trang.
   */
  reportVisualData: (id: number, visualId: string, page: number) =>
    [...datasetKeys.reports(), 'visual-data', id, visualId, page] as const,

  /**
   * Số liệu của MỌI ô trên một khung — §10.10.
   *
   * Khoá RIÊNG, không dùng chung với `reportData`: hai bên trả về hai hình dạng
   * khác nhau (`ReportDataDto` với `ReportCanvasDataDto`), và dùng chung một
   * khoá nghĩa là dữ liệu của bên này rơi vào cache của bên kia rồi trình vẽ đọc
   * ra `undefined` ở một chỗ cách rất xa.
   */
  /** Tiền tố của MỌI trang báo cáo — cùng lý do với `reportDataAll`. */
  reportCanvasDataAll: (id: number) => [...datasetKeys.reports(), 'canvas-data', id] as const,
  reportCanvasData: (id: number, pageId: string | null) =>
    [...datasetKeys.reportCanvasDataAll(id), pageId] as const,
};
