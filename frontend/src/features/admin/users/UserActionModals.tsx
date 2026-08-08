import { TENANT_ROLE_LABELS, type AdminUserDto, type TenantRole } from '@bi/shared';
import { useEffect, useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { Modal } from '../../../components/ui/Modal';
import { getApiError } from '../../../services/apiClient';
import { useRemoveUser, useUpdateUserRole, useUpdateUserStatus } from '../useAdminUsers';

/**
 * Ba hộp thoại thao tác của §3.4, gom một file vì chúng chia sẻ cùng một khung
 * xử lý lỗi: server có thể từ chối bằng `LastAdmin` hoặc `CannotModifySelf`, và
 * cả ba đều phải hiện lý do ngay trong hộp thoại thay vì đóng lại im lặng.
 */

function useActionError(): [string | null, (err: unknown) => void, () => void] {
  const [error, setError] = useState<string | null>(null);
  return [error, (err) => setError(getApiError(err).message), () => setError(null)];
}

function ErrorLine({ message }: { message: string | null }): React.ReactElement | null {
  if (!message) return null;
  return (
    <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3.5 py-3 text-sm text-red-700">
      {message}
    </p>
  );
}

// ─── Đổi vai trò ─────────────────────────────────────────────────────────────

export function ChangeRoleModal({
  user,
  onClose,
}: {
  user: AdminUserDto | null;
  onClose: () => void;
}): React.ReactElement {
  const [role, setRole] = useState<TenantRole>('viewer');
  const [error, showError, clearError] = useActionError();
  const mutation = useUpdateUserRole();

  // Mở hộp thoại cho một người khác -> nạp lại vai trò hiện tại của họ. Không có
  // đoạn này thì lần mở thứ hai vẫn giữ lựa chọn của lần trước.
  useEffect(() => {
    if (user) {
      setRole(user.role);
      clearError();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const submit = (): void => {
    if (!user) return;
    mutation.mutate(
      { userId: user.userId, role },
      { onSuccess: onClose, onError: showError },
    );
  };

  return (
    <Modal
      open={user !== null}
      onClose={onClose}
      title="Đổi vai trò"
      description={user ? `${user.fullName} · ${user.email}` : ''}
      footer={
        <>
          <Button onClick={onClose}>Huỷ</Button>
          <Button
            variant="primary"
            onClick={submit}
            loading={mutation.isPending}
            disabled={user?.role === role}
          >
            Lưu
          </Button>
        </>
      }
    >
      <ErrorLine message={error} />
      <fieldset className="space-y-2">
        <legend className="sr-only">Chọn vai trò</legend>
        {(Object.keys(TENANT_ROLE_LABELS) as TenantRole[]).map((value) => (
          <label
            key={value}
            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
              role === value ? 'border-brand-500 bg-brand-50' : 'border-slate-200 hover:bg-slate-50'
            }`}
          >
            <input
              type="radio"
              name="role"
              value={value}
              checked={role === value}
              onChange={() => setRole(value)}
              className="mt-0.5"
            />
            <span>
              <span className="block text-sm font-medium text-slate-900">
                {TENANT_ROLE_LABELS[value]}
              </span>
              <span className="block text-xs text-slate-500">{ROLE_HINTS[value]}</span>
            </span>
          </label>
        ))}
      </fieldset>
    </Modal>
  );
}

const ROLE_HINTS: Record<TenantRole, string> = {
  admin: 'Quản lý thành viên, workspace và toàn bộ cấu hình tổ chức.',
  creator: 'Tạo và chỉnh sửa dataset, báo cáo, dashboard.',
  viewer: 'Chỉ xem những gì được chia sẻ.',
};

// ─── Khoá / mở khoá ──────────────────────────────────────────────────────────

export function ToggleStatusModal({
  user,
  onClose,
}: {
  user: AdminUserDto | null;
  onClose: () => void;
}): React.ReactElement {
  const [error, showError, clearError] = useActionError();
  const mutation = useUpdateUserStatus();
  const locking = user?.memberActive === true;

  useEffect(() => {
    if (user) clearError();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const submit = (): void => {
    if (!user) return;
    mutation.mutate(
      { userId: user.userId, isActive: !user.memberActive },
      { onSuccess: onClose, onError: showError },
    );
  };

  return (
    <Modal
      open={user !== null}
      onClose={onClose}
      title={locking ? 'Khoá thành viên' : 'Mở khoá thành viên'}
      description={user ? `${user.fullName} · ${user.email}` : ''}
      footer={
        <>
          <Button onClick={onClose}>Huỷ</Button>
          <Button variant={locking ? 'danger' : 'primary'} onClick={submit} loading={mutation.isPending}>
            {locking ? 'Khoá' : 'Mở khoá'}
          </Button>
        </>
      }
    >
      <ErrorLine message={error} />
      <p className="text-sm text-slate-600">
        {locking ? (
          <>
            Người này sẽ không truy cập được tổ chức nữa, nhưng vẫn giữ tài khoản và vẫn dùng được
            ở những tổ chức khác. Bỏ khoá lại được bất cứ lúc nào.
          </>
        ) : (
          <>Người này sẽ truy cập lại được tổ chức với vai trò cũ.</>
        )}
      </p>
    </Modal>
  );
}

// ─── Gỡ khỏi tổ chức ─────────────────────────────────────────────────────────

export function RemoveUserModal({
  user,
  onClose,
}: {
  user: AdminUserDto | null;
  onClose: () => void;
}): React.ReactElement {
  const [error, showError, clearError] = useActionError();
  const mutation = useRemoveUser();

  useEffect(() => {
    if (user) clearError();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const submit = (): void => {
    if (!user) return;
    mutation.mutate(user.userId, { onSuccess: onClose, onError: showError });
  };

  return (
    <Modal
      open={user !== null}
      onClose={onClose}
      title="Gỡ khỏi tổ chức"
      description={user ? `${user.fullName} · ${user.email}` : ''}
      footer={
        <>
          <Button onClick={onClose}>Huỷ</Button>
          <Button variant="danger" onClick={submit} loading={mutation.isPending}>
            Gỡ khỏi tổ chức
          </Button>
        </>
      }
    >
      <ErrorLine message={error} />
      <p className="text-sm text-slate-600">
        Người này bị đưa ra khỏi danh sách thành viên và mất quyền truy cập tổ chức.{' '}
        <strong>Tài khoản của họ không bị xoá</strong> — email là định danh chung của cả nền tảng,
        và họ có thể đang làm việc ở tổ chức khác.
      </p>
      <p className="mt-2 text-sm text-slate-500">Mời lại sau này thì họ giữ nguyên tài khoản cũ.</p>
    </Modal>
  );
}
