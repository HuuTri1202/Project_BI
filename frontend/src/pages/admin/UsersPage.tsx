import type { PlatformUserDto } from '@bi/shared';
import { useState } from 'react';
import { useAuth } from '../../auth/useAuth';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Page, PageBody, PageHeader } from '../../components/ui/Page';
import { Pagination } from '../../components/ui/Pagination';
import { SortableTh, TBody, Td, Th, THead, TableWrap, Tr } from '../../components/ui/Table';
import { EmptyState, ErrorState, TableSkeleton } from '../../components/ui/states';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { STATUS_OPTIONS } from '../../components/ui/filterOptions';
import { FilterSelect, ListToolbar } from '../../components/ui/ListToolbar';
import { useDeleteUser, useSetUserActive, useTenants, useUsers } from '../../features/admin/hooks';
import { useListQueryState } from '../../hooks/useListQueryState';
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
  //
  // `kind: ''` = chỉ công ty thật. Không gian cá nhân đúng ra không nên có mặt
  // trong một ô select: có bao nhiêu người dùng thì có bấy nhiêu mục, và 100 mục
  // đầu tiên sẽ toàn là chúng.
  const { data: tenantPage } = useTenants({
    page: 1,
    pageSize: 100,
    sort: 'name',
    order: 'asc',
    q: '',
    status: '',
    kind: '',
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
    <Page>
      <PageHeader title="Quản lý người dùng" description="Tất cả tài khoản trên nền tảng. Một người có thể thuộc nhiều tổ chức.">
        <div className="mt-4">
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
      </PageHeader>

      <PageBody scroll={false}>
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
          <div
            className={`flex min-h-0 flex-1 flex-col ${
              isPlaceholderData ? 'opacity-60 transition-opacity' : ''
            }`}
          >
            <TableWrap fill>
              <THead>
                <Tr>
                  <SortableTh sortKey="fullName" activeKey={query.sort} order={query.order} onSort={onSort}>
                    Họ và tên
                  </SortableTh>
                  <SortableTh sortKey="email" activeKey={query.sort} order={query.order} onSort={onSort}>
                    Email
                  </SortableTh>
                  <Th>Tổ chức</Th>
                  <Th>Gói dịch vụ</Th>
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
                        <GoiDichVu tenants={user.tenants} />
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

            <div className="shrink-0">
              <Pagination
                page={data.page}
                pageSize={data.pageSize}
                total={data.total}
                totalPages={data.totalPages}
                onPageChange={(page) => update({ page })}
              />
            </div>
          </div>
        )}

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
        Tài khoản biến mất khỏi mọi tổ chức và không đăng nhập được nữa.{' '}
        <strong>Email vẫn bị giữ chỗ</strong> — không đăng ký lại bằng email đó được, để người mới
        không thừa hưởng dấu vết của người cũ.
      </ConfirmDialog>
      </PageBody>
    </Page>
  );
}

/**
 * Gói người dùng đang dùng — MỘT dòng cho mỗi tổ chức họ tham gia.
 *
 * Gói gắn với tổ chức, không gắn với người: quản trị viên mua gói thì mọi thành
 * viên của tổ chức đó cùng dùng. Một người thuộc công ty gói Doanh nghiệp và có
 * thêm không gian cá nhân gói Miễn phí đang dùng CẢ HAI, tuỳ lúc mở tổ chức nào —
 * gộp thành một gói là trả lời sai cho một nửa số lần mở.
 *
 * Gói trả phí xếp lên đầu và mang màu thương hiệu: câu người vận hành hỏi khi
 * nhìn cột này là người này có đang ở gói trả tiền nào không.
 */
function GoiDichVu({ tenants }: { tenants: PlatformUserDto['tenants'] }): React.ReactElement {
  if (tenants.length === 0) return <span className="text-xs text-slate-400">—</span>;

  const sapXep = [...tenants].sort(
    (a, b) => Number(b.plan.isPaid) - Number(a.plan.isPaid) || a.name.localeCompare(b.name, 'vi'),
  );

  return (
    <ul className="space-y-1.5">
      {sapXep.map((t) => (
        <li key={t.id} className="text-xs">
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            <Badge tone={t.plan.isPaid ? 'brand' : 'neutral'}>{t.plan.name}</Badge>
            <span className="text-slate-500">{t.name}</span>
          </div>
          {t.plan.periodEnd !== null && (
            <div className="mt-0.5 text-slate-400">
              Hết hạn {new Date(t.plan.periodEnd).toLocaleDateString('vi-VN')}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
