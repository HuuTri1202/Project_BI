import { Link } from 'react-router-dom';
import { usePermissions } from '../../auth/usePermissions';
import { useWorkspace } from '../../workspace/useWorkspace';
import { SidebarSwitcher, type SwitcherOption } from './SidebarSwitcher';

/**
 * Bộ chuyển WORKSPACE — §4.6, §5.1.
 *
 * Đổi workspace là phép đổi state cục bộ, tức thì: không có request nào, không
 * có trạng thái chờ. `WorkspaceProvider` giữ lựa chọn và ghi nhớ nó vào
 * localStorage theo `tenantId`, nên F5 vẫn đúng workspace và đổi tổ chức không
 * mang workspace của tổ chức cũ sang.
 *
 * Chỉ liệt kê workspace ĐANG HOẠT ĐỘNG. Cái bị quản trị hệ thống khoá vẫn hiện ở
 * màn quản lý §5.2 kèm lời giải thích, nhưng đưa vào đây thì người dùng chọn
 * xong sẽ ăn 403 từ backend.
 *
 * Link "Quản lý workspace" ở đáy chỉ hiện với admin tổ chức (§5.9) — đó là chỗ
 * tự nhiên để tìm nó khi đang đứng trong dropdown và không thấy workspace mình
 * cần.
 */
export function WorkspaceSwitcher(): React.ReactElement {
  const permissions = usePermissions();
  const { current, options, isLoading, error, select } = useWorkspace();

  const items: SwitcherOption[] = options.map((w) => ({
    id: w.id,
    label: w.name,
    meta: `${w.projectCount} project`,
  }));

  const selected = current ? (items.find((i) => i.id === current.id) ?? null) : null;

  return (
    <SidebarSwitcher
      caption="Workspace"
      icon="M3 7h18v12H3V7Zm0 0 3-3h5l2 3"
      current={selected}
      options={items}
      onSelect={select}
      // Nói thẳng thay vì hiện một nút rỗng: admin sẽ biết phải sang §5.2 tạo
      // mới, người khác biết phải đi hỏi ai.
      emptyLabel="Chưa có workspace"
      isLoading={isLoading}
      error={error}
      footer={
        permissions.manageWorkspaces ? (
          <Link
            to="/organization/workspaces"
            className="block rounded-lg px-3 py-2 text-sm text-slate-300 transition-colors hover:bg-slate-700 hover:text-white"
          >
            Quản lý workspace →
          </Link>
        ) : undefined
      }
    />
  );
}
