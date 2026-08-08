import type { AdminWorkspaceDto } from '@bi/shared';
import { useState } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { TBody, Td, Th, THead, TableWrap, Tr } from '../../components/ui/Table';
import { EmptyState, ErrorState, TableSkeleton } from '../../components/ui/states';
import { useAdminWorkspaces, useDeleteWorkspace } from '../../features/admin/useAdminWorkspaces';
import { WorkspaceFormModal } from '../../features/admin/workspaces/WorkspaceFormModal';
import { getApiError } from '../../services/apiClient';

/** §3.5 — quản lý workspace trong tổ chức. */
export default function WorkspacesPage(): React.ReactElement {
  const { data, isPending, isError, error } = useAdminWorkspaces();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AdminWorkspaceDto | null>(null);
  const [deleting, setDeleting] = useState<AdminWorkspaceDto | null>(null);

  const openCreate = (): void => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (workspace: AdminWorkspaceDto): void => {
    setEditing(workspace);
    setFormOpen(true);
  };

  return (
    <div className="mx-auto max-w-6xl">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Workspace</h1>
          <p className="mt-1 text-sm text-slate-500">
            Không gian làm việc nhóm các project và dữ liệu của tổ chức.
          </p>
        </div>
        <Button variant="primary" onClick={openCreate}>
          Tạo workspace
        </Button>
      </header>

      <div className="mt-6">
        {isPending && <TableSkeleton rows={3} />}
        {isError && <ErrorState message={getApiError(error).message} />}

        {data && data.length === 0 && (
          <EmptyState
            title="Chưa có workspace nào"
            hint="Tạo một workspace để bắt đầu nhóm project và dữ liệu."
            action={
              <Button variant="primary" onClick={openCreate}>
                Tạo workspace
              </Button>
            }
          />
        )}

        {data && data.length > 0 && (
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
              {data.map((workspace) => (
                <Tr key={workspace.id}>
                  <Td>
                    <span className="font-medium text-slate-900">{workspace.name}</span>
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
      <DeleteWorkspaceModal workspace={deleting} onClose={() => setDeleting(null)} />
    </div>
  );
}

function DeleteWorkspaceModal({
  workspace,
  onClose,
}: {
  workspace: AdminWorkspaceDto | null;
  onClose: () => void;
}): React.ReactElement {
  const [error, setError] = useState<string | null>(null);
  const mutation = useDeleteWorkspace();

  const submit = (): void => {
    if (!workspace) return;
    setError(null);
    mutation.mutate(workspace.id, {
      onSuccess: onClose,
      // Server từ chối bằng `WorkspaceNotEmpty` kèm số project — hiện nguyên
      // thông báo đó, vì nó cho biết chính xác còn bao nhiêu cái phải dọn.
      onError: (err) => setError(getApiError(err).message),
    });
  };

  const hasProjects = (workspace?.projectCount ?? 0) > 0;

  return (
    <Modal
      open={workspace !== null}
      onClose={onClose}
      title="Xoá workspace"
      description={workspace?.name}
      footer={
        <>
          <Button onClick={onClose}>Huỷ</Button>
          <Button
            variant="danger"
            onClick={submit}
            loading={mutation.isPending}
            disabled={hasProjects}
          >
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
      ) : (
        <p className="text-sm text-slate-600">
          Workspace sẽ bị ẩn khỏi tổ chức. Tên đường dẫn được giải phóng nên bạn tạo lại workspace
          cùng tên sau này vẫn được.
        </p>
      )}
    </Modal>
  );
}
