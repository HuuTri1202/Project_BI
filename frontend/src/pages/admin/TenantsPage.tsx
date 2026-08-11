import type { PlatformTenantDto } from '@bi/shared';
import { useState } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Pagination } from '../../components/ui/Pagination';
import { SortableTh, TBody, Td, Th, THead, TableWrap, Tr } from '../../components/ui/Table';
import { EmptyState, ErrorState, TableSkeleton } from '../../components/ui/states';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { STATUS_OPTIONS } from '../../components/ui/filterOptions';
import { FilterSelect, ListToolbar } from '../../components/ui/ListToolbar';
import { TenantDetailModal } from '../../features/admin/tenants/TenantDetailModal';
import { useDeleteTenant, useSetTenantActive, useTenants } from '../../features/admin/hooks';
import { useListQueryState } from '../../hooks/useListQueryState';
import type { TenantListQuery } from '../../features/admin/api';
import { getApiError } from '../../services/apiClient';

// Khai kiểu tường minh chứ KHÔNG dùng `as const`: `as const` thu hẹp `order`
// xuống đúng literal `'desc'`, nên đổi sang `'asc'` thành lỗi biên dịch và mọi
// nơi phải ép kiểu. Dùng chính kiểu của query là vừa đủ rộng, vừa giữ được kiểm
// tra kiểu ở nơi gọi.
const DEFAULTS: TenantListQuery = {
  page: 1,
  pageSize: 20,
  sort: 'createdAt',
  order: 'desc',
  q: '',
  status: '',
  // Rỗng = backend áp mặc định `org`. Cố ý KHÔNG đặt sẵn `'org'`: để rỗng thì
  // `hasFilter` bên dưới không coi trạng thái mặc định là "đang lọc", và nút
  // "Xoá lọc" không hiện lên đòi xoá một thứ người dùng chưa chọn.
  kind: '',
};

const ALLOWED = {
  sort: ['name', 'userCount', 'workspaceCount', 'createdAt'],
  order: ['asc', 'desc'],
  status: ['active', 'locked'],
  kind: ['org', 'personal', 'all'],
} as const;

/**
 * Ba lựa chọn của bộ lọc loại tổ chức.
 *
 * `allLabel` của `FilterSelect` là lựa chọn ứng với giá trị rỗng, mà ở đây rỗng
 * KHÔNG có nghĩa "tất cả" — nó là "công ty thật". Nên nhãn phải nói đúng điều
 * đó, và "Tất cả" là một mục riêng có giá trị `all`.
 */
const KIND_OPTIONS = [
  { value: 'personal', label: 'Không gian cá nhân' },
  { value: 'all', label: 'Tất cả' },
];

/** Quản lý Tenant — danh sách tất cả công ty trên nền tảng. */
export default function TenantsPage(): React.ReactElement {
  const { query, update, reset } = useListQueryState<TenantListQuery>({ ...DEFAULTS }, ALLOWED);
  const { data, isPending, isError, error, isPlaceholderData } = useTenants(query);

  const [detailId, setDetailId] = useState<number | null>(null);
  const [lockTarget, setLockTarget] = useState<PlatformTenantDto | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PlatformTenantDto | null>(null);

  const setActive = useSetTenantActive();
  const remove = useDeleteTenant();

  const onSort = (key: string): void => {
    update(
      key === query.sort
        ? { order: query.order === 'asc' ? 'desc' : 'asc' }
        : { sort: key, order: 'asc' },
    );
  };

  const hasFilter = query.q !== '' || query.status !== '' || query.kind !== '';

  return (
    <div className="mx-auto max-w-6xl">
      <header>
        <h1 className="text-xl font-bold text-slate-900">Quản lý tổ chức</h1>
        <p className="mt-1 text-sm text-slate-500">
          Các công ty trên nền tảng. Danh sách mặc định <strong>không</strong> hiện không gian cá
          nhân — mỗi tài khoản được cấp một cái khi tạo, nên chúng sẽ lấn át công ty thật.
        </p>
      </header>

      <div className="mt-6">
        <ListToolbar
          search={query.q}
          onSearch={(q) => update({ q })}
          placeholder="Tên công ty hoặc đường dẫn…"
          hasFilter={hasFilter}
          onReset={reset}
        >
          <FilterSelect
            id="filter-status"
            label="Trạng thái"
            value={query.status}
            onChange={(status) => update({ status })}
            allLabel="Tất cả trạng thái"
            options={STATUS_OPTIONS}
          />
          <FilterSelect
            id="filter-kind"
            label="Loại"
            value={query.kind}
            onChange={(kind) => update({ kind: kind as TenantListQuery['kind'] })}
            allLabel="Công ty thật"
            options={KIND_OPTIONS}
          />
        </ListToolbar>
      </div>

      <div className="mt-4">
        {isPending && <TableSkeleton />}
        {isError && <ErrorState message={getApiError(error).message} />}

        {data && data.items.length === 0 && (
          <EmptyState
            title={hasFilter ? 'Không có tổ chức nào khớp bộ lọc' : 'Chưa có tổ chức nào'}
            hint={
              hasFilter
                ? 'Thử bỏ bớt điều kiện lọc hoặc đổi từ khoá.'
                : 'Tổ chức được tạo khi có người đăng ký tài khoản mới.'
            }
            action={hasFilter ? <Button onClick={reset}>Xoá lọc</Button> : undefined}
          />
        )}

        {data && data.items.length > 0 && (
          <div className={isPlaceholderData ? 'opacity-60 transition-opacity' : ''}>
            <TableWrap>
              <THead>
                <Tr>
                  <SortableTh sortKey="name" activeKey={query.sort} order={query.order} onSort={onSort}>
                    Tên công ty
                  </SortableTh>
                  <Th>Trạng thái</Th>
                  <SortableTh sortKey="userCount" activeKey={query.sort} order={query.order} onSort={onSort}>
                    Người dùng
                  </SortableTh>
                  <SortableTh sortKey="workspaceCount" activeKey={query.sort} order={query.order} onSort={onSort}>
                    Workspace
                  </SortableTh>
                  <SortableTh sortKey="createdAt" activeKey={query.sort} order={query.order} onSort={onSort}>
                    Ngày tạo
                  </SortableTh>
                  <Th align="right">Thao tác</Th>
                </Tr>
              </THead>
              <TBody>
                {data.items.map((tenant) => (
                  <Tr key={tenant.id}>
                    <Td>
                      <button
                        type="button"
                        onClick={() => setDetailId(tenant.id)}
                        className="text-left font-medium text-brand-700 hover:underline"
                      >
                        {tenant.name}
                      </button>
                      {/* Nhãn nằm cạnh TÊN chứ không ở cột trạng thái: khi bật
                          bộ lọc "Tất cả", hai loại tổ chức trộn lẫn nhau và
                          người vận hành cần biết dòng nào là gì ngay ở chỗ mắt
                          đọc đầu tiên. */}
                      {tenant.isPersonal && (
                        <span className="ml-2 align-middle">
                          <Badge tone="neutral">Cá nhân</Badge>
                        </span>
                      )}
                      <div className="text-xs text-slate-400">{tenant.slug}</div>
                    </Td>
                    <Td>
                      <Badge tone={tenant.isActive ? 'success' : 'warning'}>
                        {tenant.isActive ? 'Đang hoạt động' : 'Bị khoá'}
                      </Badge>
                    </Td>
                    <Td>{tenant.userCount}</Td>
                    <Td>{tenant.workspaceCount}</Td>
                    <Td>
                      <span className="text-slate-500">
                        {new Date(tenant.createdAt).toLocaleDateString('vi-VN')}
                      </span>
                    </Td>
                    <Td align="right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setDetailId(tenant.id)}>
                          Chi tiết
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setLockTarget(tenant)}>
                          {tenant.isActive ? 'Khoá' : 'Mở khoá'}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(tenant)}>
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

      <TenantDetailModal tenantId={detailId} onClose={() => setDetailId(null)} />

      <ConfirmDialog
        open={lockTarget !== null}
        onClose={() => setLockTarget(null)}
        title={lockTarget?.isActive ? 'Khoá tổ chức' : 'Mở khoá tổ chức'}
        description={lockTarget?.name}
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
          <>
            <strong>Toàn bộ {lockTarget.userCount} thành viên</strong> của tổ chức này sẽ không
            đăng nhập được nữa. Họ vẫn dùng được tài khoản ở những tổ chức khác. Mở khoá lại được
            bất cứ lúc nào.
          </>
        ) : (
          <>Thành viên của tổ chức này sẽ đăng nhập lại được với vai trò cũ.</>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Xoá tổ chức"
        description={deleteTarget?.name}
        confirmLabel="Xoá tổ chức"
        danger
        loading={remove.isPending}
        onConfirm={(onError) => {
          if (!deleteTarget) return;
          remove.mutate(deleteTarget.id, {
            onSuccess: () => setDeleteTarget(null),
            onError,
          });
        }}
      >
        {(deleteTarget?.workspaceCount ?? 0) > 0 ? (
          <>
            Tổ chức này còn <strong>{deleteTarget?.workspaceCount} workspace</strong>. Hãy xoá
            chúng trước — hệ thống không xoá lan xuống workspace và project để tránh mất dữ liệu
            ngoài ý muốn.
          </>
        ) : (
          <>
            Tổ chức bị ẩn khỏi hệ thống (xoá mềm). Thành viên mất quyền truy cập nhưng{' '}
            <strong>tài khoản của họ không bị xoá</strong> — email là định danh chung, họ có thể
            đang làm ở tổ chức khác.
          </>
        )}
      </ConfirmDialog>
    </div>
  );
}
