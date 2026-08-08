import {
  memberStatusOf,
  MEMBER_STATUS_LABELS,
  TENANT_ROLE_LABELS,
  type AdminUserDto,
} from '@bi/shared';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { SortableTh, TBody, Td, Th, THead, TableWrap, Tr } from '../../../components/ui/Table';

interface UserTableProps {
  items: AdminUserDto[];
  sort: string;
  order: 'asc' | 'desc';
  onSort: (key: string) => void;
  /** Id của người đang đăng nhập — dòng của chính họ không có nút thao tác. */
  currentUserId: number;
  onChangeRole: (user: AdminUserDto) => void;
  onToggleStatus: (user: AdminUserDto) => void;
  onRemove: (user: AdminUserDto) => void;
}

const ROLE_TONE = { admin: 'brand', creator: 'success', viewer: 'neutral' } as const;

export function UserTable({
  items,
  sort,
  order,
  onSort,
  currentUserId,
  onChangeRole,
  onToggleStatus,
  onRemove,
}: UserTableProps): React.ReactElement {
  return (
    <TableWrap>
      <THead>
        <Tr>
          <SortableTh sortKey="fullName" activeKey={sort} order={order} onSort={onSort}>
            Họ và tên
          </SortableTh>
          <SortableTh sortKey="email" activeKey={sort} order={order} onSort={onSort}>
            Email
          </SortableTh>
          <SortableTh sortKey="role" activeKey={sort} order={order} onSort={onSort}>
            Vai trò
          </SortableTh>
          <Th>Trạng thái</Th>
          <SortableTh sortKey="joinedAt" activeKey={sort} order={order} onSort={onSort}>
            Tham gia
          </SortableTh>
          <Th align="right">Thao tác</Th>
        </Tr>
      </THead>

      <TBody>
        {items.map((user) => {
          const status = memberStatusOf(user);
          const isSelf = user.userId === currentUserId;
          // Tài khoản bị khoá ở cấp hệ thống thì Admin tổ chức không sửa được gì
          // — cột `users.is_active` nằm ngoài thẩm quyền của họ.
          const locked = !user.userActive;

          return (
            <Tr key={user.userId}>
              <Td>
                <div className="font-medium text-slate-900">{user.fullName}</div>
                {user.jobTitle && <div className="text-xs text-slate-500">{user.jobTitle}</div>}
              </Td>
              <Td>
                <span className="text-slate-600">{user.email}</span>
                {user.mustChangePassword && (
                  <div className="mt-0.5">
                    <Badge tone="warning">Chưa đổi mật khẩu tạm</Badge>
                  </div>
                )}
              </Td>
              <Td>
                <Badge tone={ROLE_TONE[user.role]}>{TENANT_ROLE_LABELS[user.role]}</Badge>
              </Td>
              <Td>
                {locked ? (
                  <Badge tone="danger">Khoá toàn hệ thống</Badge>
                ) : (
                  <Badge tone={status === 'active' ? 'success' : 'warning'}>
                    {MEMBER_STATUS_LABELS[status]}
                  </Badge>
                )}
              </Td>
              <Td>
                <span className="text-slate-500">
                  {new Date(user.joinedAt).toLocaleDateString('vi-VN')}
                </span>
              </Td>
              <Td align="right">
                {isSelf ? (
                  // Không hiện nút cho chính mình. Backend cũng chặn bằng 403,
                  // nhưng để nút đó bấm được rồi mới báo lỗi là bày ra một cái
                  // bẫy không có lý do gì để tồn tại.
                  <span className="text-xs text-slate-400">Bạn</span>
                ) : (
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" disabled={locked} onClick={() => onChangeRole(user)}>
                      Đổi vai trò
                    </Button>
                    <Button size="sm" variant="ghost" disabled={locked} onClick={() => onToggleStatus(user)}>
                      {user.memberActive ? 'Khoá' : 'Mở khoá'}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={locked} onClick={() => onRemove(user)}>
                      <span className="text-red-600">Gỡ</span>
                    </Button>
                  </div>
                )}
              </Td>
            </Tr>
          );
        })}
      </TBody>
    </TableWrap>
  );
}
