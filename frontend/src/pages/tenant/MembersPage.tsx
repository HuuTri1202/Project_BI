import { MEMBER_STATUS_LABELS, TENANT_ROLE_LABELS, type AdminUserDto } from '@bi/shared';
import { useCallback, useState } from 'react';
import { useAuth } from '../../auth/useAuth';
import { Button } from '../../components/ui/Button';
import { FilterSelect, ListToolbar } from '../../components/ui/ListToolbar';
import { Pagination } from '../../components/ui/Pagination';
import { EmptyState, ErrorState, TableSkeleton } from '../../components/ui/states';
import type { MemberListQuery } from '../../features/tenant/api';
import { useMembers } from '../../features/tenant/hooks';
import { CreateMemberModal } from '../../features/tenant/members/CreateMemberModal';
import {
  ChangeRoleModal,
  RemoveMemberModal,
  ResetPasswordModal,
  ToggleStatusModal,
} from '../../features/tenant/members/MemberActionModals';
import { MemberTable } from '../../features/tenant/members/MemberTable';
import { TempPasswordPanel } from '../../features/tenant/members/TempPasswordPanel';
import {
  forgetIssue,
  readIssue,
  rememberIssue,
  type TempPasswordIssue,
} from '../../features/tenant/members/tempPasswordStore';
import { useListQueryState } from '../../hooks/useListQueryState';
import { getApiError } from '../../services/apiClient';

/**
 * Quản lý thành viên trong tổ chức — §4.7.
 *
 * Chỉ Admin tổ chức vào được (`TenantAdminRoute`), và mọi thao tác ghi ở backend
 * còn một lớp `requireRole('admin')` nữa.
 *
 * Trạng thái danh sách nằm trong URL (`useListQueryState`) nên F5 không mất bộ
 * lọc và link chia sẻ được. Nó cũng làm luôn phần debounce cho react-query: query
 * key dẫn xuất từ URL, nên chỉ khi URL đổi mới có request mới.
 */
const DEFAULTS: MemberListQuery = {
  page: 1,
  pageSize: 20,
  sort: 'joinedAt',
  order: 'desc',
  q: '',
  role: '',
  status: '',
};

/**
 * Whitelist cho giá trị đọc từ URL.
 *
 * `?role=<script>` hay `?sort=password_hash` gõ tay phải thoái lui về mặc định.
 * Backend cũng đối chiếu `sort` bằng `resolveSortColumn`, nên đây là lớp thứ hai
 * — nhưng nó là lớp giữ giao diện không rơi vào trạng thái vô nghĩa.
 */
const ALLOWED = {
  sort: ['fullName', 'email', 'role', 'joinedAt', 'lastLoginAt'],
  order: ['asc', 'desc'],
  role: ['admin', 'creator', 'viewer'],
  status: ['active', 'locked', 'removed'],
} as const;

const ROLE_OPTIONS = Object.entries(TENANT_ROLE_LABELS).map(([value, label]) => ({ value, label }));
const STATUS_OPTIONS = Object.entries(MEMBER_STATUS_LABELS).map(([value, label]) => ({
  value,
  label,
}));

export default function MembersPage(): React.ReactElement {
  const { user, tenant } = useAuth();
  const { query, update, reset } = useListQueryState<MemberListQuery>(DEFAULTS, ALLOWED);
  const { data, isPending, isError, error } = useMembers(query);

  const [createOpen, setCreateOpen] = useState(false);
  const [changingRole, setChangingRole] = useState<AdminUserDto | null>(null);
  const [togglingStatus, setTogglingStatus] = useState<AdminUserDto | null>(null);
  const [resettingPassword, setResettingPassword] = useState<AdminUserDto | null>(null);
  const [removing, setRemoving] = useState<AdminUserDto | null>(null);

  /*
   * ─── Mật khẩu tạm không được chết theo `useState` ──────────────────────────
   *
   * Trước đây nó chỉ nằm trong state của component này, nên bấm sang mục khác ở
   * sidebar hay F5 là mất bản sao DUY NHẤT — backend chỉ giữ hash bcrypt, không
   * có đường lấy lại. `tempPasswordStore` gương state này xuống sessionStorage
   * (khoá theo tổ chức + người đang đăng nhập, hạn 30 phút) nên nó sống qua điều
   * hướng và tải lại trang.
   *
   * Vẫn giữ `useState` song song chứ không đọc thẳng storage mỗi lần render:
   * `sessionStorage` không phải nguồn dữ liệu React theo dõi được, đọc thẳng thì
   * bảng sẽ không hiện lên cho tới lần render kế tiếp vì lý do khác.
   */
  const actorId = user?.id ?? null;
  const tenantId = tenant?.id ?? null;

  const [issue, setIssue] = useState<TempPasswordIssue | null>(() =>
    tenantId !== null && actorId !== null ? readIssue(tenantId, actorId) : null,
  );

  const showIssue = useCallback(
    (next: TempPasswordIssue) => {
      setIssue(next);
      if (tenantId !== null && actorId !== null) rememberIssue(tenantId, actorId, next);
    },
    [tenantId, actorId],
  );

  const dismissIssue = useCallback(() => {
    setIssue(null);
    if (tenantId !== null && actorId !== null) forgetIssue(tenantId, actorId);
  }, [tenantId, actorId]);

  const hasFilter = query.q !== '' || query.role !== '' || query.status !== '';

  // Bấm lại đúng cột đang sắp xếp thì đảo chiều; cột khác thì về giảm dần —
  // với dữ liệu thời gian, "mới nhất trước" gần như luôn là thứ người ta muốn.
  function onSort(key: string): void {
    if (key === query.sort) {
      update({ order: query.order === 'asc' ? 'desc' : 'asc' });
    } else {
      update({ sort: key, order: 'desc' });
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-4">
        <p className="text-sm text-slate-500">
          Người dùng trong tổ chức của bạn và vai trò của họ.
        </p>
        <Button variant="primary" onClick={() => setCreateOpen(true)}>
          Thêm thành viên
        </Button>
      </div>

      {/* Mật khẩu tạm nằm NGAY đầu tab, không phải trong hộp thoại vừa đóng:
          đây là bản sao duy nhất và nó phải ở lại tới khi admin tự tay xác nhận
          đã gửi đi. */}
      {issue && (
        <div className="mt-4 shrink-0">
          <TempPasswordPanel issue={issue} onDismiss={dismissIssue} />
        </div>
      )}

      <div className="mt-4 shrink-0">
        <ListToolbar
          search={query.q}
          onSearch={(value) => update({ q: value })}
          placeholder="Họ tên hoặc email…"
          hasFilter={hasFilter}
          onReset={reset}
        >
          <FilterSelect
            id="member-role"
            label="Vai trò"
            value={query.role}
            onChange={(value) => update({ role: value })}
            allLabel="Mọi vai trò"
            options={ROLE_OPTIONS}
          />
          <FilterSelect
            id="member-status"
            label="Trạng thái"
            value={query.status}
            onChange={(value) => update({ status: value })}
            // Nói rõ mặc định gồm những gì: danh sách KHÔNG hiện người đã gỡ trừ
            // khi lọc đúng vào họ. Không nói thì admin sẽ tưởng dữ liệu bị mất.
            allLabel="Đang hoạt động + bị khoá"
            options={STATUS_OPTIONS}
          />
        </ListToolbar>
      </div>

      <div className="mt-4 flex min-h-0 flex-1 flex-col">
        {isError && <ErrorState message={getApiError(error).message} />}
        {isPending && <TableSkeleton />}

        {data && data.items.length === 0 && (
          <EmptyState
            title={hasFilter ? 'Không tìm thấy thành viên nào' : 'Chưa có thành viên nào'}
            hint={
              hasFilter
                ? 'Thử bỏ bớt bộ lọc hoặc đổi từ khoá tìm kiếm.'
                : 'Thêm người vào tổ chức để họ cùng làm việc trên dữ liệu.'
            }
            action={
              hasFilter ? (
                <Button onClick={reset}>Xoá lọc</Button>
              ) : (
                <Button variant="primary" onClick={() => setCreateOpen(true)}>
                  Thêm thành viên
                </Button>
              )
            }
          />
        )}

        {data && data.items.length > 0 && (
          <>
            <MemberTable
              items={data.items}
              sort={query.sort}
              order={query.order}
              onSort={onSort}
              currentUserId={user?.id ?? -1}
              onChangeRole={setChangingRole}
              onToggleStatus={setTogglingStatus}
              onResetPassword={setResettingPassword}
              onRemove={setRemoving}
            />
            <div className="shrink-0">
              <Pagination
                page={data.page}
                pageSize={data.pageSize}
                total={data.total}
                totalPages={data.totalPages}
                onPageChange={(page) => update({ page })}
              />
            </div>
          </>
        )}
      </div>

      <CreateMemberModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(result) => {
          // `mode === 'attached'` thì không có mật khẩu nào được cấp — người này
          // đã có tài khoản riêng. Kiểm cả `tempPassword` chứ không chỉ `mode`:
          // kiểu của nó là optional, và một bảng mật khẩu trống là thứ tệ hơn cả
          // không có bảng.
          showIssue(
            result.mode === 'created' && result.tempPassword
              ? { kind: 'created', user: result.user, tempPassword: result.tempPassword }
              : { kind: 'attached', user: result.user },
          );
          setCreateOpen(false);
        }}
      />
      <ChangeRoleModal user={changingRole} onClose={() => setChangingRole(null)} />
      <ToggleStatusModal user={togglingStatus} onClose={() => setTogglingStatus(null)} />
      <ResetPasswordModal
        user={resettingPassword}
        onClose={() => setResettingPassword(null)}
        onIssued={(result) => {
          showIssue({ kind: 'reset', user: result.user, tempPassword: result.tempPassword });
          setResettingPassword(null);
        }}
      />
      <RemoveMemberModal user={removing} onClose={() => setRemoving(null)} />
    </div>
  );
}
