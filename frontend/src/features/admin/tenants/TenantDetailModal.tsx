import { TENANT_ROLE_LABELS } from '@bi/shared';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Modal } from '../../../components/ui/Modal';
import { getApiError } from '../../../services/apiClient';
import { useTenantDetail } from '../hooks';

interface TenantDetailModalProps {
  tenantId: number | null;
  onClose: () => void;
}

/**
 * Chi tiết một tổ chức: thông tin chung + thành viên + workspace.
 *
 * Chỉ ĐỌC. Mọi thao tác sửa nằm ở trang danh sách tương ứng — gộp nút bấm vào
 * đây sẽ có hai chỗ làm cùng một việc, và chúng sẽ lệch nhau ở lần sửa đầu tiên.
 */
export function TenantDetailModal({
  tenantId,
  onClose,
}: TenantDetailModalProps): React.ReactElement {
  const { data, isPending, isError, error } = useTenantDetail(tenantId);

  return (
    <Modal
      open={tenantId !== null}
      onClose={onClose}
      title={data?.tenant.name ?? 'Chi tiết tổ chức'}
      description={data ? `${data.tenant.slug} · tạo ngày ${formatDate(data.tenant.createdAt)}` : ''}
      footer={<Button onClick={onClose}>Đóng</Button>}
    >
      {isPending && <p className="text-sm text-slate-500">Đang tải…</p>}
      {isError && (
        <p role="alert" className="rounded-lg bg-red-50 px-3.5 py-3 text-sm text-red-700">
          {getApiError(error).message}
        </p>
      )}

      {data && (
        <div className="space-y-5">
          <div className="flex flex-wrap gap-2">
            <Badge tone={data.tenant.isActive ? 'success' : 'warning'}>
              {data.tenant.isActive ? 'Đang hoạt động' : 'Bị khoá'}
            </Badge>
            <Badge tone="neutral">{data.members.length} thành viên</Badge>
            <Badge tone="neutral">{data.workspaces.length} workspace</Badge>
          </div>

          <section>
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
              Thành viên
            </h3>
            {data.members.length === 0 ? (
              <p className="text-sm text-slate-500">Tổ chức chưa có thành viên nào.</p>
            ) : (
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {data.members.map((member) => (
                  <li
                    key={member.userId}
                    className="flex items-center justify-between gap-3 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900">
                        {member.fullName}
                      </p>
                      <p className="truncate text-xs text-slate-500">{member.email}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {!member.userActive && <Badge tone="danger">Khoá hệ thống</Badge>}
                      {member.userActive && !member.memberActive && (
                        <Badge tone="warning">Khoá trong tổ chức</Badge>
                      )}
                      <Badge tone={member.role === 'admin' ? 'brand' : 'neutral'}>
                        {TENANT_ROLE_LABELS[member.role]}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
              Workspace
            </h3>
            {data.workspaces.length === 0 ? (
              <p className="text-sm text-slate-500">Tổ chức chưa có workspace nào.</p>
            ) : (
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {data.workspaces.map((workspace) => (
                  <li
                    key={workspace.id}
                    className="flex items-center justify-between gap-3 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900">
                        {workspace.name}
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {workspace.slug} · {workspace.projectCount} project
                      </p>
                    </div>
                    {!workspace.isActive && <Badge tone="warning">Bị khoá</Badge>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('vi-VN');
}
