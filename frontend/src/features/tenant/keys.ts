/**
 * Query key của khu người dùng.
 *
 * KHÔNG gắn `tenantId` vào key: token chỉ mở đúng một tổ chức, và
 * `queryClient.clear()` trong `AuthProvider.clearSession` đã dọn sạch khi đổi
 * tài khoản. Thêm tenantId vào đây chỉ tạo ảo giác an toàn — dữ liệu tổ chức
 * khác không bao giờ tới được cache này.
 *
 * NGƯỢC LẠI, `workspaceId` BẮT BUỘC nằm trong key của mọi thứ thuộc về một
 * workspace. Thiếu nó, đổi workspace ở §4.6 sẽ hiện lại dữ liệu của workspace cũ
 * cho tới lần refetch kế tiếp — người dùng nhìn thấy dữ liệu sai và tin nó.
 *
 * Cấu trúc lồng nhau để `invalidateQueries` gọi ở mức nào cũng cuốn theo mức
 * dưới: xoá một workspace thì huỷ luôn mọi danh sách bên trong nó.
 */
export const tenantKeys = {
  all: ['tenant'] as const,

  home: (workspaceId: number | null) => [...tenantKeys.all, 'home', workspaceId] as const,

  /** Thông tin tổ chức đang mở — tên, slug. */
  tenant: () => [...tenantKeys.all, 'info'] as const,

  workspaces: () => [...tenantKeys.all, 'workspaces'] as const,

  members: () => [...tenantKeys.all, 'members'] as const,
  memberList: (query: unknown) => [...tenantKeys.members(), 'list', query] as const,

  connections: () => [...tenantKeys.all, 'connections'] as const,
  prerequisites: () => [...tenantKeys.connections(), 'prerequisites'] as const,
  /**
   * Danh sách bảng trong CSDL nguồn.
   *
   * Đây là truy vấn ĐI RA NGOÀI hệ thống — nó mở một kết nối thật tới máy chủ
   * của khách hàng. Nên nó có key riêng để `invalidate` sau khi đồng bộ (cờ
   * `imported` đổi), và tuyệt đối không nằm dưới `datasets()` — invalidate kho
   * dữ liệu sau mỗi thao tác nhỏ sẽ bắn một kết nối ra ngoài mỗi lần.
   */
  sourceTables: (connectionId: number | null) =>
    [...tenantKeys.connections(), 'tables', connectionId] as const,

  datasets: () => [...tenantKeys.all, 'datasets'] as const,
  datasetList: (query: unknown) => [...tenantKeys.datasets(), 'list', query] as const,
  dataset: (id: number | null) => [...tenantKeys.datasets(), 'detail', id] as const,

  /**
   * Xem trước dữ liệu — nằm NGOÀI `datasets()`, cùng lý do với `sourceTables`.
   *
   * Nó mở một kết nối thật tới CSDL của khách hàng. Đặt nó dưới `datasets()` thì
   * mọi thao tác đổi tên hay xoá trong kho đều `invalidate` trúng nó, và một
   * thao tác thuần nội bộ lại bắn một truy vấn ra máy chủ của người khác.
   */
  datasetPreview: (id: number | null) => [...tenantKeys.all, 'preview', id] as const,

  /**
   * Tiến độ nạp vào kho phân tích (§9) — cũng nằm NGOÀI `datasets()`.
   *
   * Lý do khác hai cái trên: key này là key DUY NHẤT trong dự án có polling. Đặt
   * nó dưới `datasets()` thì mỗi lần đổi tên hay xoá một bộ dữ liệu sẽ
   * `invalidate` trúng nó và khởi động lại một vòng hỏi-lại-mỗi-2-giây cho một
   * bộ dữ liệu người dùng thậm chí không mở.
   */
  datasetLoad: (id: number | null) => [...tenantKeys.all, 'load', id] as const,
  datasetLoadErrors: (id: number | null, query: unknown) =>
    [...tenantKeys.datasetLoad(id), 'errors', query] as const,
  /**
   * Dữ liệu ĐÃ NẠP trong kho.
   *
   * Nằm dưới `datasetLoad(id)` để một lần nạp mới tự cuốn theo nó — bảng cũ mà
   * còn hiện sau khi vừa nạp lại là đúng thứ khiến người ta nghi ngờ cả tính
   * năng.
   */
  warehousePreview: (id: number | null, query: unknown) =>
    [...tenantKeys.datasetLoad(id), 'rows', query] as const,
  /**
   * Cấu trúc bảng trong kho.
   *
   * Cũng nằm dưới `datasetLoad(id)`: nạp lại có thể đổi cả kiểu cột (đồng bộ lại
   * bảng nguồn rồi nạp, hoặc sửa lựa chọn kiểu ở §7), nên bảng cấu trúc phải hết
   * hạn cùng lúc với dữ liệu.
   */
  warehouseSchema: (id: number | null) => [...tenantKeys.datasetLoad(id), 'schema'] as const,
};
