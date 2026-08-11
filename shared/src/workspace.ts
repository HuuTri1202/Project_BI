import type { AdminWorkspaceDto } from './admin';

/**
 * Hợp đồng dữ liệu của KHU NGƯỜI DÙNG (Section 04).
 *
 * Chỉ chứa kiểu, không chứa schema zod — cùng lý do đã ghi ở đầu `admin.ts`:
 * schema phân trang buộc phải `z.coerce`, tức là transform, mà schema dùng chung
 * phải thuần validate. Schema request ở lại backend.
 */

export interface ProjectDto {
  id: number;
  workspaceId: number;
  name: string;
  description: string | null;
  createdBy: number | null;
  /** NULL khi người tạo đã bị xoá (`ON DELETE SET NULL`). Hiện "Không rõ". */
  creatorName: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Workspace như bộ chuyển (§4.6) nhìn thấy.
 *
 * Cố ý là một tập con của `AdminWorkspaceDto` chứ không phải kiểu riêng: dropdown
 * chọn workspace chỉ cần đúng chừng này, và khai lại một interface độc lập là mở
 * đường cho hai định nghĩa lệch nhau. `Pick` khiến việc đổi tên trường ở một chỗ
 * làm hỏng biên dịch ở chỗ kia — đúng thứ ta muốn.
 */
export type WorkspaceOptionDto = Pick<AdminWorkspaceDto, 'id' | 'name' | 'slug' | 'isActive'>;

/**
 * Dữ liệu trang Home (§4.3) — một request cho cả trang.
 *
 * Gộp thay vì để frontend gọi ba lần: trang này là màn hình đầu tiên sau khi đăng
 * nhập, và ba vòng đi về mạng nối tiếp nhau là ba lần trang nhảy chỗ trước mắt
 * người dùng.
 *
 * `workspace` được trả lại nguyên vẹn dù frontend đã biết nó: id gửi lên có thể
 * bị backend từ chối (đã xoá, thuộc tổ chức khác, đang bị khoá) và khi đó backend
 * chọn giúp một cái khác. Không trả về thì frontend không có cách nào biết mình
 * đang xem workspace nào.
 */
export interface HomeDataDto {
  workspace: WorkspaceOptionDto;
  projects: ProjectDto[];
  stats: {
    projects: number;
    /** Thành viên còn trong tổ chức. Phạm vi TỔ CHỨC, không phải workspace. */
    members: number;
  };
}

/**
 * Sửa hồ sơ cá nhân (§4.4).
 *
 * Cố ý KHÔNG có `email`: đó là định danh đăng nhập duy nhất toàn cục, đổi nó cần
 * một luồng xác thực email mà hệ thống chưa có. Cho sửa tự do nghĩa là gõ nhầm
 * một ký tự là mất tài khoản vĩnh viễn, không có đường lấy lại.
 *
 * Cũng KHÔNG có `role` hay `isActive`: người dùng tự nâng quyền cho mình là lỗ
 * hổng leo thang đặc quyền kinh điển. Vai trò chỉ đổi được qua §4.7.
 */
export interface UpdateProfileDto {
  fullName: string;
  phone: string | null;
  jobTitle: string | null;
  /** 'YYYY-MM-DD' hoặc null. */
  dateOfBirth: string | null;
}

/** Mã lỗi riêng của khu người dùng, nối tiếp `ADMIN_ERROR_CODES`. */
export const WORKSPACE_ERROR_CODES = {
  /** Không còn workspace nào dùng được trong tổ chức. */
  NO_WORKSPACE: 'NoWorkspace',
  /** Workspace đang bị quản trị hệ thống khoá. */
  WORKSPACE_LOCKED: 'WorkspaceLocked',
  /** Không thể xoá workspace cuối cùng của tổ chức. */
  LAST_WORKSPACE: 'LastWorkspace',
} as const;

export type WorkspaceErrorCode =
  (typeof WORKSPACE_ERROR_CODES)[keyof typeof WORKSPACE_ERROR_CODES];
