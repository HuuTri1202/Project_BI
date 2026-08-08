/**
 * Query key của khu quản trị.
 *
 * MỌI key đều bắt đầu bằng `tenantId`, kể cả khi hiện tại một phiên chỉ mở được
 * đúng một tổ chức. Lý do: `memberships[]` đã được backend trả về sẵn cho tính
 * năng đổi tổ chức, và ngày thêm tính năng đó, cache không gắn tenant sẽ phục vụ
 * dữ liệu của tổ chức cũ cho tổ chức mới. Sửa key sau khi bug xảy ra thì tốn
 * đúng chừng này công, chỉ khác là đã lộ dữ liệu rồi.
 *
 * Cấu trúc lồng nhau (`all` ⊃ `users` ⊃ `usersList`) để `invalidateQueries` gọi
 * ở mức nào cũng cuốn theo mức dưới — đổi vai trò một người thì huỷ toàn bộ các
 * trang danh sách đang cache, không cần biết đang ở trang mấy với bộ lọc gì.
 */
export const adminKeys = {
  all: (tenantId: number) => ['admin', tenantId] as const,
  overview: (tenantId: number) => [...adminKeys.all(tenantId), 'overview'] as const,
  users: (tenantId: number) => [...adminKeys.all(tenantId), 'users'] as const,
  usersList: (tenantId: number, query: unknown) =>
    [...adminKeys.users(tenantId), query] as const,
  workspaces: (tenantId: number) => [...adminKeys.all(tenantId), 'workspaces'] as const,
};
