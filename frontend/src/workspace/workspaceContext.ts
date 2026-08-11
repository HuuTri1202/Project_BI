import type { AdminWorkspaceDto } from '@bi/shared';
import { createContext } from 'react';

/**
 * Context của bộ chuyển workspace (§4.6).
 *
 * File riêng chỉ chứa `createContext` và kiểu, KHÔNG chứa component — luật
 * `react-refresh/only-export-components` cảnh báo mọi file vừa export component
 * vừa export thứ khác, và `allowConstantExport` không tha cho kết quả của
 * `createContext(...)`. Cùng lý do đã tách `authContext` / `AuthProvider` /
 * `useAuth`.
 */
export interface WorkspaceContextValue {
  /**
   * Workspace đang mở. `null` khi danh sách chưa tải xong, hoặc khi tổ chức
   * không còn workspace nào dùng được — hai trạng thái phân biệt bằng `isLoading`.
   */
  current: AdminWorkspaceDto | null;
  /** Chỉ những workspace CHỌN ĐƯỢC: đã lọc bỏ cái bị quản trị hệ thống khoá. */
  options: AdminWorkspaceDto[];
  /** Toàn bộ, kể cả cái bị khoá — màn quản lý §4.5 cần thấy đủ. */
  all: AdminWorkspaceDto[];
  isLoading: boolean;
  error: string | null;
  select: (workspaceId: number) => void;
}

export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);
