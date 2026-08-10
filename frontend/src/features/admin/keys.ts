/**
 * Query key của console hệ thống.
 *
 * KHÔNG gắn `tenantId` như bản trước: console này nhìn xuyên mọi tổ chức, dữ
 * liệu của nó không thuộc về tổ chức nào cả. Việc dọn cache khi đổi tài khoản
 * đã do `queryClient.clear()` trong `AuthProvider.clearSession` lo.
 *
 * Cấu trúc lồng nhau để `invalidateQueries` gọi ở mức nào cũng cuốn theo mức
 * dưới — khoá một tenant thì huỷ toàn bộ các trang danh sách đang cache, không
 * cần biết đang ở trang mấy với bộ lọc gì.
 */
export const adminKeys = {
  all: ['admin'] as const,
  overview: () => [...adminKeys.all, 'overview'] as const,

  tenants: () => [...adminKeys.all, 'tenants'] as const,
  tenantList: (query: unknown) => [...adminKeys.tenants(), 'list', query] as const,
  tenantDetail: (id: number) => [...adminKeys.tenants(), 'detail', id] as const,

  users: () => [...adminKeys.all, 'users'] as const,
  userList: (query: unknown) => [...adminKeys.users(), 'list', query] as const,

  workspaces: () => [...adminKeys.all, 'workspaces'] as const,
  workspaceList: (query: unknown) => [...adminKeys.workspaces(), 'list', query] as const,
};
