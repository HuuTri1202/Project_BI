import type { PlatformUserDto } from '@bi/shared';
import { useState } from 'react';
import { useAuth } from '../../auth/useAuth';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Pagination } from '../../components/ui/Pagination';
import { SortableTh, TBody, Td, Th, THead, TableWrap, Tr } from '../../components/ui/Table';
import { EmptyState, ErrorState, TableSkeleton } from '../../components/ui/states';
import { ConfirmDialog } from '../../features/admin/ConfirmDialog';
import { STATUS_OPTIONS } from '../../features/admin/filterOptions';
import { FilterSelect, ListToolbar } from '../../features/admin/ListToolbar';
import { useDeleteUser, useSetUserActive, useTenants, useUsers } from '../../features/admin/hooks';
import { useListQueryState } from '../../features/admin/useListQueryState';
import type { UserListQuery } from '../../features/admin/api';
import { getApiError } from '../../services/apiClient';

// Khai kiểu tường minh chứ KHÔNG dùng `as const`: nó thu hẹp mỗi trường xuống
// đúng một literal, khiến đổi giá trị thành lỗi biên dịch và phải ép kiểu khắp nơi.
const DEFAULTS: UserListQuery = {
  page: 1,
  pageSize: 20,
  sort: 'createdAt',
  order: 'desc',
  q: '',
  tenantId: '',
  status: '',
  platformRole: '',
} as const;

const ALLOWED = {
  sort: ['fullName', 'email', 'createdAt', 'lastLoginAt'],
  order: ['asc', 'desc'],
  status: ['active', 'locked'],
  platformRole: ['superadmin', 'user'],
} as const;

/** Quản lý User — tất cả tài khoản trên nền tảng, không giới hạn tổ chức. */
export default function UsersPage(): React.ReactElement {
  const { user: me } = useAuth();
  const { query, update, reset } = useListQueryState<UserListQuery>({ ...DEFAULTS }, ALLOWED);

  const { data, isPending, isError, error, isPlaceholderData } = useUsers({
    ...query,
    order: query.order as 'asc' | 'desc',
    status: query.status as '' | 'active' | 'locked',
    platformRole: query.platformRole as '' | 'superadmin' | 'user',
    tenantId: query.tenantId === '' ? '' : Number(query.tenantId),
  });

  // Danh sách tổ chức để đổ vào ô lọc. Lấy trang đầu 100 tổ chức là đủ cho quy
  // mô hiện tại; khi nào vượt thì đổi ô select này thành ô tìm kiếm có gợi ý.
  const { data: tenantPage } = useTenants({
    page: 1,
    pageSize: 100,
    sort: 'name',
    order: 'asc',
    q: '',
    status: '',
  });

  const [lockTarget, setLockTarget] = useState<PlatformUserDto | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PlatformUserDto | null>(null);

  const setActive = useSetUserActive();
  const remove = useDeleteUser();

  const onSort = (key: string): void => {
    update(
      key === query.sort
        ? { order: query.order === 'asc' ? 'desc' : 'asc' }
        : { sort: key, order: 'asc' },
    );
  };

  const hasFilter =
    query.q !== '' || query.status !== '' || query.tenantId !== '' || query.platformRole !== '';

  return (
    <div className="mx-auto max-w-6xl">
      <header>
        <h1 className="text-xl font-bold text-slate-900">Quản lý người dùng</h1>
        <p className="mt-1 text-sm text-slate-500">
          Tất cả tài khoản trên nền tảng. Một người có thể thuộc nhiều tổ chức.
        </p>
      </header>

      <div className="mt-6">
        <ListToolbar
          search={query.q}
          onSearch={(q) => update({ q })}
          placeholder="Họ tên hoặc email…"
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
            title={hasFilter ? 'Không có ai khớp bộ lọc' : 'Chưa có người dùng nào'}
            hint={hasFilter ? 'Thử bỏ bớt điều kiện lọc hoặc đổi từ khoá.' : undefined}
            action={hasFilter ? <Button onClick={reset}>Xoá lọc</Button> : undefined}
          />
        )}

        {data && data.items.length > 0 && (
          <div className={isPlaceholderData ? 'opacity-60 transition-opacity' : ''}>
            <TableWrap>
              <THead>
                <Tr>
                  <SortableTh sortKey="fullName" activeKey={query.sort} order={query.order} onSort={onSort}>
                    Họ và tên
                  </SortableTh>
                  <SortableTh sortKey="email" activeKey={query.sort} order={query.order} onSort={onSort}>
                    Email
                  </SortableTh>
                  <Th>Tổ chức</Th>
                  <Th>Trạng thái</Th>
                  <SortableTh sortKey="lastLoginAt" activeKey={query.sort} order={query.order} onSort={onSort}>
                    Đăng nhập gần nhất
                  </SortableTh>
                  <Th align="right">Thao tác</Th>
                </Tr>
              </THead>
              <TBody>
                {data.items.map((user) => {
                  const isSelf = user.id === me?.id;
                  return (
                    <Tr key={user.id}>
                      <Td>
                        <div className="font-medium text-slate-900">{user.fullName}</div>
                        {user.jobTitle && (
                          <div className="text-xs text-slate-500">{user.jobTitle}</div>
                        )}
                      </Td>
                      <Td>
                        <span className="text-slate-600">{user.email}</span>
                        {user.platformRole === 'superadmin' && (
                          <div className="mt-0.5">
                            <Badge tone="brand">Quản trị hệ thống</Badge>
                          </div>
                        )}
                      </Td>
                      <Td>
                        {user.tenants.length === 0 ? (
                          <span className="text-xs text-slate-400">Không thuộc tổ chức nào</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {user.tenants.map((t) => (
                              <Badge key={t.id} tone="neutral">
                                {t.name}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </Td>
                      <Td>
                        <Badge tone={user.isActive ? 'success' : 'warning'}>
                          {user.isActive ? 'Đang hoạt động' : 'Bị khoá'}
                        </Badge>
                      </Td>
                      <Td>
                        <span className="text-slate-500">
                          {user.lastLoginAt
                            ? new Date(user.lastLoginAt).toLocaleDateString('vi-VN')
                            : 'Chưa đăng nhập'}
                        </span>
                      </Td>
                      <Td align="right">
                        {isSelf ? (
                          // Không hiện nút cho chính mình. Backend cũng chặn bằng
                          // 403, nhưng để nút bấm được rồi mới báo lỗi là bày ra
                          // một cái bẫy không có lý do gì để tồn tại.
                          <span className="text-xs text-slate-400">Bạn</span>
                        ) : (
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="ghost" onClick={() => setLockTarget(user)}>
                              {user.isActive ? 'Khoá' : 'Mở khoá'}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(user)}>
                              <span className="text-red-600">Xoá</span>
                            </Button>
                          </div>
                        )}
                      </Td>
                    </Tr>
                  );
                })}
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
        title={lockTarget?.isActive ? 'Khoá tài khoản' : 'Mở khoá tài khoản'}
        description={lockTarget ? `${lockTarget.fullName} · ${lockTarget.email}` : ''}
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
            Khoá ở đây là khoá <strong>toàn hệ thống</strong>: người này không đăng nhập được vào
            bất kỳ tổ chức nào. Mở khoá lại được bất cứ lúc nào.
          </>
        ) : (
          <>Người này sẽ đăng nhập lại được với mọi tổ chức họ đang tham gia.</>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Xoá tài khoản"
        description={deleteTarget ? `${deleteTarget.fullName} · ${deleteTarget.email}` : ''}
        confirmLabel="Xoá tài khoản"
        danger
        loading={remove.isPending}
        onConfirm={(onError) => {
          if (!deleteTarget) return;
          remove.mutate(deleteTarget.id, { onSuccess: () => setDeleteTarget(null), onError });
        }}
      >
        Tài khoản bị xoá mềm: biến mất khỏi mọi tổ chức và không đăng nhập được nữa.{' '}
        <strong>Email vẫn bị giữ chỗ</strong> — không đăng ký lại bằng email đó được, để người mới
        không thừa hưởng dấu vết của người cũ.
      </ConfirmDialog>
    </div>
  );
}
