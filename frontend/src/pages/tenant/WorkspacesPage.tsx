import type { AdminWorkspaceDto } from '@bi/shared';
import { useState } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { TBody, TableWrap, Td, Th, THead, Tr } from '../../components/ui/Table';
import { EmptyState, ErrorState, TableSkeleton } from '../../components/ui/states';
import { useDeleteWorkspace, useWorkspaceList } from '../../features/tenant/hooks';
import { WorkspaceFormModal } from '../../features/tenant/workspaces/WorkspaceFormModal';
import { getApiError } from '../../services/apiClient';

/**
 * Tab "Workspace" của trang Quản lý tổ chức — §4.5.
 *
 * Chỉ Admin tổ chức vào được (`TenantAdminRoute`), và mọi thao tác ghi ở backend
 * còn một lớp `authorize('workspace', …)` nữa.
 *
 * KHÔNG có `<h1>` và không tự căn giữa: tiêu đề trang và khung `max-w` do
 * `OrganizationPage` lo. Mỗi tab tự dựng tiêu đề của mình thì trang có hai cấp
 * tiêu đề cùng cỡ và ba tab lệch bề ngang nhau.
 *
 * Danh sách lấy thẳng từ `WorkspaceProvider` — cùng dữ liệu mà bộ chuyển
 * workspace ở sidebar đang dùng. Nhờ vậy, tạo hoặc xoá ở đây thì dropdown trên
 * kia đổi theo ngay, không có hai bản danh sách lệch nhau.
 */
export default function TenantWorkspacesPage(): React.ReactElement {
  const { items, isLoading, error } = useWorkspaceList();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AdminWorkspaceDto | null>(null);
  const [deleting, setDeleting] = useState<AdminWorkspaceDto | null>(null);

  function openCreate(): void {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(workspace: AdminWorkspaceDto): void {
    setEditing(workspace);
    setFormOpen(true);
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <p className="text-sm text-slate-500">
          Không gian làm việc để nhóm project và dữ liệu của tổ chức.
        </p>
        <Button variant="primary" onClick={openCreate}>
          Tạo workspace
        </Button>
      </div>

      <div className="mt-5">
        {error && <ErrorState message={error} />}
        {isLoading && <TableSkeleton rows={3} />}

        {!isLoading && items.length === 0 && (
          <EmptyState
            title="Chưa có workspace nào"
            hint="Tạo workspace đầu tiên để thành viên có chỗ làm việc."
            action={
              <Button variant="primary" onClick={openCreate}>
                Tạo workspace
              </Button>
            }
          />
        )}

        {items.length > 0 && (
          <TableWrap>
            <THead>
              <Tr>
                {/* Bảng này không phân trang và không sắp xếp được — một tổ
                    chức có vài workspace, thêm cơ chế sắp xếp là công sức cho
                    thứ không ai dùng. Dùng Th thường thay vì SortableTh. */}
                <Th>Tên</Th>
                <Th>Đường dẫn</Th>
                <Th>Mô tả</Th>
                <Th align="right">Project</Th>
                <Th align="right">Thao tác</Th>
              </Tr>
            </THead>
            <TBody>
              {items.map((workspace) => (
                <Tr key={workspace.id}>
                  <Td>
                    <span className="font-medium text-slate-900">{workspace.name}</span>
                    {/* Khoá bởi quản trị HỆ THỐNG, không phải bởi admin tổ chức.
                        Không hiện thì workspace này biến mất khỏi bộ chuyển mà
                        vẫn nằm trong bảng — người dùng sẽ đi tìm lỗi ở chỗ không
                        có lỗi. */}
                    {!workspace.isActive && (
                      <div className="mt-0.5">
                        <Badge tone="danger">Bị quản trị hệ thống khoá</Badge>
                      </div>
                    )}
                  </Td>
                  <Td>
                    <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                      {workspace.slug}
                    </code>
                  </Td>
                  <Td>
                    <span className="text-slate-500">{workspace.description ?? '—'}</span>
                  </Td>
                  <Td align="right">
                    {workspace.projectCount > 0 ? (
                      <Badge tone="brand">{workspace.projectCount}</Badge>
                    ) : (
                      <span className="text-slate-400">0</span>
                    )}
                  </Td>
                  <Td align="right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => openEdit(workspace)}>
                        Đổi tên
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setDeleting(workspace)}>
                        <span className="text-red-600">Xoá</span>
                      </Button>
                    </div>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </TableWrap>
        )}
      </div>

      <WorkspaceFormModal open={formOpen} editing={editing} onClose={() => setFormOpen(false)} />
      <DeleteWorkspaceModal
        workspace={deleting}
        total={items.length}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}

function DeleteWorkspaceModal({
  workspace,
  total,
  onClose,
}: {
  workspace: AdminWorkspaceDto | null;
  total: number;
  onClose: () => void;
}): React.ReactElement {
  const [error, setError] = useState<string | null>(null);
  const mutation = useDeleteWorkspace();

  const submit = (): void => {
    if (!workspace) return;
    setError(null);
    mutation.mutate(workspace.id, {
      onSuccess: onClose,
      // Server từ chối bằng `WorkspaceNotEmpty` kèm số project, hoặc
      // `LastWorkspace` — hiện nguyên thông báo đó, vì nó cho biết chính xác
      // phải làm gì tiếp.
      onError: (err) => setError(getApiError(err).message),
    });
  };

  const hasProjects = (workspace?.projectCount ?? 0) > 0;
  const isLast = total <= 1;
  // Hai lý do chặn, kiểm cả ở đây lẫn ở backend. Khoá nút và nói rõ lý do tốt
  // hơn là để bấm được rồi mới báo lỗi — người dùng biết trước phải dọn gì.
  const blocked = hasProjects || isLast;

  return (
    <Modal
      open={workspace !== null}
      onClose={onClose}
      title="Xoá workspace"
      description={workspace?.name}
      footer={
        <>
          <Button onClick={onClose}>Huỷ</Button>
          <Button variant="danger" onClick={submit} loading={mutation.isPending} disabled={blocked}>
            Xoá
          </Button>
        </>
      }
    >
      {error && (
        <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3.5 py-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {hasProjects ? (
        <p className="text-sm text-slate-600">
          Workspace này còn <strong>{workspace?.projectCount} project</strong> đang hoạt động. Hãy
          chuyển hoặc xoá chúng trước — hệ thống không xoá lan sang project để tránh mất dữ liệu
          ngoài ý muốn.
        </p>
      ) : isLast ? (
        <p className="text-sm text-slate-600">
          Đây là workspace <strong>cuối cùng</strong> của tổ chức. Xoá nó thì không ai vào được
          trang chủ nữa. Hãy tạo một workspace khác trước.
        </p>
      ) : (
        <p className="text-sm text-slate-600">
          Workspace sẽ bị ẩn khỏi tổ chức. Tên đường dẫn được giải phóng nên bạn tạo lại workspace
          cùng tên sau này vẫn được.
        </p>
      )}
    </Modal>
  );
}
