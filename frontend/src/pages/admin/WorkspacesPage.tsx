import type { PlatformWorkspaceDto } from '@bi/shared';
import { useState } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Pagination } from '../../components/ui/Pagination';
import { TBody, Td, Th, THead, TableWrap, Tr } from '../../components/ui/Table';
import { EmptyState, ErrorState, TableSkeleton } from '../../components/ui/states';
import { ConfirmDialog } from '../../features/admin/ConfirmDialog';
import { STATUS_OPTIONS } from '../../features/admin/filterOptions';
import { FilterSelect, ListToolbar } from '../../features/admin/ListToolbar';
import {
  useDeleteWorkspace,
  useSetWorkspaceActive,
  useTenants,
  useWorkspaces,
} from '../../features/admin/hooks';
import { useListQueryState } from '../../features/admin/useListQueryState';
import type { WorkspaceListQuery } from '../../features/admin/api';
import { getApiError } from '../../services/apiClient';

// Khai kiểu tường minh chứ KHÔNG dùng `as const`: nó thu hẹp mỗi trường xuống
// đúng một literal, khiến đổi giá trị thành lỗi biên dịch và phải ép kiểu khắp nơi.
const DEFAULTS: WorkspaceListQuery = { page: 1, pageSize: 20, q: '', tenantId: '', status: '' };
const ALLOWED = { status: ['active', 'locked'] } as const;

/** Quản lý Workspace — tất cả không gian làm việc, nhóm theo tổ chức. */
export default function WorkspacesPage(): React.ReactElement {
  const { query, update, reset } = useListQueryState<WorkspaceListQuery>({ ...DEFAULTS }, ALLOWED);

  const { data, isPending, isError, error, isPlaceholderData } = useWorkspaces({
    ...query,
    status: query.status as '' | 'active' | 'locked',
    tenantId: query.tenantId === '' ? '' : Number(query.tenantId),
  });

  const { data: tenantPage } = useTenants({
    page: 1,
    pageSize: 100,
    sort: 'name',
    order: 'asc',
    q: '',
    status: '',
  });

  const [lockTarget, setLockTarget] = useState<PlatformWorkspaceDto | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PlatformWorkspaceDto | null>(null);

  const setActive = useSetWorkspaceActive();
  const remove = useDeleteWorkspace();

  const hasFilter = query.q !== '' || query.status !== '' || query.tenantId !== '';

  return (
    <div className="mx-auto max-w-6xl">
      <header>
        <h1 className="text-xl font-bold text-slate-900">Quản lý workspace</h1>
        <p className="mt-1 text-sm text-slate-500">
          Không gian làm việc của tất cả tổ chức. Mỗi công ty có thể có nhiều workspace để chia
          theo bộ phận.
        </p>
      </header>

      <div className="mt-6">
        <ListToolbar
          search={query.q}
          onSearch={(q) => update({ q })}
          placeholder="Tên workspace hoặc tên công ty…"
          hasFilter={hasFilter}
          onReset={reset}
        >
          <FilterSelect
            id="filter-tenant"
            label="Tổ chức"
            value={String(query.tenantId)}
            onChange={(tenantId) => update({ tenantId })}
            allLabel="Tất cả tổ chức"
            options={(tenantPage?.items ?? []).map((t) => ({
              value: String(t.id),
              label: t.name,
            }))}
          />
          <FilterSelect
            id="filter-status"
            label="Trạng thái"
            value={query.status}
            onChange={(status) => update({ status })}
            allLabel="Tất cả trạng thái"
            options={STATUS_OPTIONS}
          />
        </ListToolbar>
      </div>

      <div className="mt-4">
        {isPending && <TableSkeleton />}
        {isError && <ErrorState message={getApiError(error).message} />}

        {data && data.items.length === 0 && (
          <EmptyState
            title={hasFilter ? 'Không có workspace nào khớp bộ lọc' : 'Chưa có workspace nào'}
            hint={
              hasFilter
                ? 'Thử bỏ bớt điều kiện lọc hoặc đổi từ khoá.'
                : 'Workspace mặc định được tạo cùng lúc với tổ chức.'
            }
            action={hasFilter ? <Button onClick={reset}>Xoá lọc</Button> : undefined}
          />
        )}

        {data && data.items.length > 0 && (
          <div className={isPlaceholderData ? 'opacity-60 transition-opacity' : ''}>
            <TableWrap>
              <THead>
                <Tr>
                  <Th>Tổ chức</Th>
                  <Th>Workspace</Th>
                  <Th>Trạng thái</Th>
                  <Th align="right">Project</Th>
                  <Th align="right">Thao tác</Th>
                </Tr>
              </THead>
              <TBody>
                {data.items.map((workspace) => (
                  <Tr key={workspace.id}>
                    <Td>
                      <span className="text-slate-600">{workspace.tenantName}</span>
                    </Td>
                    <Td>
                      <div className="font-medium text-slate-900">{workspace.name}</div>
                      <div className="text-xs text-slate-400">{workspace.slug}</div>
                    </Td>
                    <Td>
                      <Badge tone={workspace.isActive ? 'success' : 'warning'}>
                        {workspace.isActive ? 'Đang hoạt động' : 'Bị khoá'}
                      </Badge>
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
                        <Button size="sm" variant="ghost" onClick={() => setLockTarget(workspace)}>
                          {workspace.isActive ? 'Khoá' : 'Mở khoá'}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(workspace)}>
                          <span className="text-red-600">Xoá</span>
                        </Button>
                      </div>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </TableWrap>

            <Pagination
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              totalPages={data.totalPages}
              onPageChange={(page) => update({ page })}
            />
          </div>
        )}
      </div>

      <ConfirmDialog
        open={lockTarget !== null}
        onClose={() => setLockTarget(null)}
        title={lockTarget?.isActive ? 'Khoá workspace' : 'Mở khoá workspace'}
        description={lockTarget ? `${lockTarget.tenantName} · ${lockTarget.name}` : ''}
        confirmLabel={lockTarget?.isActive ? 'Khoá' : 'Mở khoá'}
        danger={lockTarget?.isActive === true}
        loading={setActive.isPending}
        onConfirm={(onError) => {
          if (!lockTarget) return;
          setActive.mutate(
            { id: lockTarget.id, isActive: !lockTarget.isActive },
            { onSuccess: () => setLockTarget(null), onError },
          );
        }}
      >
        {lockTarget?.isActive ? (
          <>Workspace tạm ngừng hoạt động. Dữ liệu bên trong được giữ nguyên, mở lại được.</>
        ) : (
          <>Workspace hoạt động trở lại.</>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Xoá workspace"
        description={deleteTarget ? `${deleteTarget.tenantName} · ${deleteTarget.name}` : ''}
        confirmLabel="Xoá workspace"
        danger
        loading={remove.isPending}
        onConfirm={(onError) => {
          if (!deleteTarget) return;
          remove.mutate(deleteTarget.id, { onSuccess: () => setDeleteTarget(null), onError });
        }}
      >
        {(deleteTarget?.projectCount ?? 0) > 0 ? (
          <>
            Workspace này còn <strong>{deleteTarget?.projectCount} project</strong>. Xoá workspace
            sẽ khiến chúng không truy cập được nữa.
          </>
        ) : (
          <>
            Workspace bị ẩn khỏi tổ chức (xoá mềm). Tên đường dẫn được giải phóng nên tạo lại
            workspace cùng tên sau này vẫn được.
          </>
        )}
      </ConfirmDialog>
    </div>
  );
}
