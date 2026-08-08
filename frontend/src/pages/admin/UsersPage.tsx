import type { AdminUserDto, CreateAdminUserResultDto } from '@bi/shared';
import { useState } from 'react';
import { useAuth } from '../../auth/useAuth';
import { Button } from '../../components/ui/Button';
import { Pagination } from '../../components/ui/Pagination';
import { EmptyState, ErrorState, TableSkeleton } from '../../components/ui/states';
import { useAdminUsers } from '../../features/admin/useAdminUsers';
import { useUserListQueryState } from '../../features/admin/useUserListQueryState';
import { CreateUserModal } from '../../features/admin/users/CreateUserModal';
import { TempPasswordPanel } from '../../features/admin/users/TempPasswordPanel';
import {
  ChangeRoleModal,
  RemoveUserModal,
  ToggleStatusModal,
} from '../../features/admin/users/UserActionModals';
import { UserFilters } from '../../features/admin/users/UserFilters';
import { UserTable } from '../../features/admin/users/UserTable';
import { getApiError } from '../../services/apiClient';

/** §3.3 + §3.4 — danh sách và quản lý người dùng trong tổ chức. */
export default function UsersPage(): React.ReactElement {
  const { user } = useAuth();
  const { query, update, reset } = useUserListQueryState();
  const { data, isPending, isError, error, isPlaceholderData } = useAdminUsers(query);

  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreateAdminUserResultDto | null>(null);
  const [roleTarget, setRoleTarget] = useState<AdminUserDto | null>(null);
  const [statusTarget, setStatusTarget] = useState<AdminUserDto | null>(null);
  const [removeTarget, setRemoveTarget] = useState<AdminUserDto | null>(null);

  /** Bấm lại đúng cột đang sắp thì đảo chiều, bấm cột khác thì sắp tăng dần. */
  const onSort = (key: string): void => {
    update(key === query.sort ? { order: query.order === 'asc' ? 'desc' : 'asc' } : { sort: key, order: 'asc' });
  };

  const hasFilter = query.q !== '' || query.role !== '' || query.status !== '';

  return (
    <div className="mx-auto max-w-6xl">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Người dùng</h1>
          <p className="mt-1 text-sm text-slate-500">
            Quản lý thành viên và vai trò trong tổ chức của bạn.
          </p>
        </div>
        <Button variant="primary" onClick={() => setCreating(true)}>
          Thêm người dùng
        </Button>
      </header>

      {created && (
        <div className="mt-6">
          <TempPasswordPanel result={created} onDismiss={() => setCreated(null)} />
        </div>
      )}

      <div className="mt-6">
        <UserFilters query={query} onChange={update} onReset={reset} />
      </div>

      <div className="mt-4">
        {isPending && <TableSkeleton />}

        {isError && <ErrorState message={getApiError(error).message} />}

        {data && data.items.length === 0 && (
          // Phân biệt "chưa có ai" với "lọc không ra kết quả". Hiện nhầm thông
          // báo thứ nhất khi người dùng đang lọc sẽ khiến họ tưởng dữ liệu mất.
          <EmptyState
            title={hasFilter ? 'Không có ai khớp bộ lọc' : 'Tổ chức chưa có thành viên nào khác'}
            hint={
              hasFilter
                ? 'Thử bỏ bớt điều kiện lọc hoặc đổi từ khoá tìm kiếm.'
                : 'Thêm người dùng để họ cùng làm việc trong tổ chức này.'
            }
            action={
              hasFilter ? (
                <Button onClick={reset}>Xoá lọc</Button>
              ) : (
                <Button variant="primary" onClick={() => setCreating(true)}>
                  Thêm người dùng
                </Button>
              )
            }
          />
        )}

        {data && data.items.length > 0 && (
          // Mờ đi trong lúc tải trang mới, thay vì thay bảng bằng khung xám:
          // `keepPreviousData` giữ dữ liệu cũ nên chiều cao trang không nhảy,
          // con trỏ chuột không bị trượt khỏi nút đang định bấm.
          <div className={isPlaceholderData ? 'opacity-60 transition-opacity' : ''}>
            <UserTable
              items={data.items}
              sort={query.sort}
              order={query.order}
              onSort={onSort}
              currentUserId={user?.id ?? 0}
              onChangeRole={setRoleTarget}
              onToggleStatus={setStatusTarget}
              onRemove={setRemoveTarget}
            />
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

      <CreateUserModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(result) => {
          setCreating(false);
          setCreated(result);
        }}
      />
      <ChangeRoleModal user={roleTarget} onClose={() => setRoleTarget(null)} />
      <ToggleStatusModal user={statusTarget} onClose={() => setStatusTarget(null)} />
      <RemoveUserModal user={removeTarget} onClose={() => setRemoveTarget(null)} />
    </div>
  );
}
