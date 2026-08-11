/**
 * Query key của khu người dùng.
 *
 * KHÔNG gắn `tenantId` vào key: token chỉ mở đúng một tổ chức, và
 * `queryClient.clear()` trong `AuthProvider.clearSession` đã dọn sạch khi đổi
 * tài khoản. Thêm tenantId vào đây chỉ tạo ảo giác an toàn — dữ liệu tổ chức
 * khác không bao giờ tới được cache này.
 *
 * NGƯỢC LẠI, `workspaceId` BẮT BUỘC nằm trong key của mọi thứ thuộc về một
 * workspace. Thiếu nó, đổi workspace ở §4.6 sẽ hiện lại project của workspace cũ
 * cho tới lần refetch kế tiếp — người dùng nhìn thấy dữ liệu sai và tin nó.
 *
 * Cấu trúc lồng nhau để `invalidateQueries` gọi ở mức nào cũng cuốn theo mức
 * dưới: xoá một workspace thì huỷ luôn mọi danh sách project bên trong nó.
 */
export const tenantKeys = {
  all: ['tenant'] as const,

  home: (workspaceId: number | null) => [...tenantKeys.all, 'home', workspaceId] as const,

  /** Thông tin tổ chức đang mở — tên, slug. */
  tenant: () => [...tenantKeys.all, 'info'] as const,

  workspaces: () => [...tenantKeys.all, 'workspaces'] as const,

  projects: () => [...tenantKeys.all, 'projects'] as const,
  projectList: (workspaceId: number | null, query: unknown) =>
    [...tenantKeys.projects(), workspaceId, query] as const,

  members: () => [...tenantKeys.all, 'members'] as const,
  memberList: (query: unknown) => [...tenantKeys.members(), 'list', query] as const,
};
