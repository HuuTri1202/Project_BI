import { usePermissions } from '../../../auth/usePermissions';

/**
 * Trang Kết nối sống ở ĐÂU, theo vai trò người đang xem.
 *
 *   admin    /organization/connections   — một tab của "Quản lý tổ chức"
 *   creator  /connections                — mục riêng trên sidebar
 *
 * ─── Vì sao hai chỗ, không phải một ────────────────────────────────────────
 *
 * Vì với hai vai trò thì nó là hai thứ khác nhau. Kết nối admin dựng thuộc về
 * TỔ CHỨC (`visibility = 'shared'`) nên nó đúng là một mục cấu hình tổ chức,
 * nằm cạnh Workspace và Thành viên. Kết nối creator dựng là của RIÊNG họ, và
 * xếp nó dưới cái tên "Quản lý tổ chức" vừa sai nghĩa vừa kéo cả mục đó lên
 * sidebar của người không quản trị gì cả.
 *
 * ─── Vì sao là MỘT hàm chứ không phải mỗi nơi tự đoán ──────────────────────
 *
 * Bốn chỗ cần biết đường dẫn này: danh sách (nút Thêm/Sửa), wizard (quay về sau
 * khi lưu và khi bấm Huỷ), hộp thoại Đồng bộ (câu chỉ dẫn khi chưa có kết nối
 * nào), và bảng route. Mỗi chỗ tự viết `role === 'admin' ? … : …` là bốn bản
 * chép tay của một luật, và chỗ quên sửa sẽ ném người dùng sang một URL mà
 * chính vai trò của họ bị chặn — tức là một vòng 403 ngay sau khi lưu thành
 * công.
 */
export interface ConnectionsPlacement {
  /** Tiền tố đường dẫn của danh sách và wizard. */
  base: string;
  /**
   * Trang có ĐỨNG MỘT MÌNH không, hay nằm trong khung "Quản lý tổ chức".
   *
   * Quyết định `ConnectionsPage` có tự vẽ tiêu đề hay không. Nằm trong khung thì
   * khung đã có tiêu đề "Quản lý tổ chức" và một thanh tab; vẽ thêm một tiêu đề
   * nữa là hai tầng đầu trang chồng nhau. Đứng một mình mà không vẽ thì trang mở
   * ra bắt đầu thẳng bằng một dòng mô tả, không có gì nói người dùng đang ở đâu —
   * đúng cái nhìn thấy khi chụp màn hình lần đầu.
   */
  standalone: boolean;
}

export function useConnectionsBase(): ConnectionsPlacement {
  const { manageOrgConnections } = usePermissions();
  return manageOrgConnections
    ? { base: '/organization/connections', standalone: false }
    : { base: '/connections', standalone: true };
}
