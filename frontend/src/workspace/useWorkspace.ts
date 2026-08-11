import { useContext } from 'react';
import { WorkspaceContext, type WorkspaceContextValue } from './workspaceContext';

/**
 * Lấy workspace đang mở (§4.6).
 *
 * Ném lỗi thay vì trả `null` khi dùng ngoài `WorkspaceProvider`: đó là lỗi lắp
 * ráp của lập trình viên, phải nổ ngay lúc dev chứ không được âm thầm biến thành
 * "chưa có workspace" rồi làm người ta đi tìm bug ở chỗ khác.
 */
export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error('useWorkspace phải được dùng bên trong <WorkspaceProvider>');
  }
  return ctx;
}
