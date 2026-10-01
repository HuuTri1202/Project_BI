import {
  TENANT_ROLE_LABELS,
  type AdminUserDto,
  type ResetMemberPasswordResultDto,
  type TenantRole,
} from '@bi/shared';
import { useEffect, useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { Modal } from '../../../components/ui/Modal';
import { getApiError } from '../../../services/apiClient';
import {
  useMemberWorkspaces,
  useRemoveMember,
  useSetMemberWorkspaces,
  useWorkspaces,
  useResetMemberPassword,
  useUpdateMemberRole,
  useSetMemberActive,
} from '../hooks';

/**
 * Bốn hộp thoại thao tác của §4.7, gom một file vì chúng chia sẻ cùng một khung
 * xử lý lỗi: server có thể từ chối bằng `LastAdmin`, `CannotModifySelf`,
 * `SharedIdentity`… và tất cả đều phải hiện lý do ngay trong hộp thoại thay vì
 * đóng lại im lặng.
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

// ─── Gán workspace ───────────────────────────────────────────────────────────

/**
 * Chọn những workspace một thành viên vào được — migration 40.
 *
 * ═══ Vì sao ADMIN có một màn hình riêng, không phải một danh sách bị khoá ═══
 *
 * Quản trị viên tổ chức thấy MỌI workspace, và quyền đó đến từ vai trò chứ
 * không từ bảng phân quyền — nên danh sách ô tích của họ luôn rỗng. Vẽ ra một
 * danh sách rỗng, kể cả khi làm mờ đi, sẽ đọc như "người này chưa được vào đâu
 * cả" — đúng ngược với sự thật.
 *
 * Nên nhánh admin nói thẳng điều đang xảy ra, và chỉ ra việc THẬT SỰ cần làm
 * nếu người dùng muốn siết: đổi vai trò trước. Backend từ chối cùng một lý do,
 * nên hai bên nói cùng một câu.
 */
export function AssignWorkspacesModal({
  user,
  onClose,
}: {
  user: AdminUserDto | null;
  onClose: () => void;
}): React.ReactElement {
  const [chon, setChon] = useState<Set<number>>(new Set());
  const [error, showError, clearError] = useActionError();
  const laAdmin = user?.role === 'admin';

  const workspaces = useWorkspaces();
  // `null` khi đóng, và khi người đó là admin — không có gì để hỏi.
  const daGan = useMemberWorkspaces(user === null || laAdmin ? null : user.userId);
  const mutation = useSetMemberWorkspaces();

  // Mở cho một người khác -> nạp lại lựa chọn của CHÍNH họ. Thiếu đoạn này thì
  // lần mở thứ hai mang theo ô tích của người trước, và bấm Lưu là gán nhầm.
  useEffect(() => {
    if (user) clearError();
    setChon(new Set(daGan.data ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, daGan.data]);

  const bat = (id: number): void => {
    setChon((truoc) => {
      const sau = new Set(truoc);
      if (sau.has(id)) sau.delete(id);
      else sau.add(id);
      return sau;
    });
  };

  const submit = (): void => {
    if (!user) return;
    mutation.mutate(
      { userId: user.userId, workspaceIds: [...chon] },
      { onSuccess: onClose, onError: showError },
    );
  };

  return (
    <Modal
      open={user !== null}
      onClose={onClose}
      title="Workspace được vào"
      description={user ? `${user.fullName} · ${user.email}` : ''}
      footer={
        <>
          <Button onClick={onClose}>{laAdmin ? 'Đóng' : 'Huỷ'}</Button>
          {!laAdmin && (
            <Button variant="primary" onClick={submit} loading={mutation.isPending}>
              Lưu
            </Button>
          )}
        </>
      }
    >
      <ErrorLine message={error} />

      {laAdmin ? (
        <p className="rounded-lg bg-slate-50 px-3.5 py-3 text-sm text-slate-600">
          Quản trị viên tổ chức luôn thấy <strong>mọi workspace</strong>, nên không có gì để
          chọn ở đây. Muốn giới hạn người này thì đổi vai trò của họ sang Người tạo hoặc Người
          xem trước.
        </p>
      ) : (
        <>
          <p className="mb-3 text-sm text-slate-600">
            Người này chỉ thấy báo cáo, bộ dữ liệu và mô hình nằm trong những workspace được
            tích. Bỏ tích hết thì họ không vào được workspace nào.
          </p>
          <fieldset className="space-y-2">
            <legend className="sr-only">Chọn workspace</legend>
            {(workspaces.data ?? []).map((ws) => (
              <label
                key={ws.id}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                  chon.has(ws.id)
                    ? 'border-brand-500 bg-brand-50'
                    : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={chon.has(ws.id)}
                  onChange={() => bat(ws.id)}
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-slate-800">
                    {ws.name}
                  </span>
                  <span className="block text-xs text-slate-500">{ws.reportCount} báo cáo</span>
                </span>
              </label>
            ))}
          </fieldset>
        </>
      )}
    </Modal>
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
  const mutation = useUpdateMemberRole();

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
  const mutation = useSetMemberActive();
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

// ─── Cấp lại mật khẩu tạm ────────────────────────────────────────────────────

/**
 * Lối thoát khi mật khẩu tạm hiện một lần đã mất.
 *
 * KHÔNG phải "xem lại mật khẩu" — thứ đó không dựng được. Database chỉ giữ hash
 * bcrypt, nên nút này SINH một mật khẩu mới và giết mật khẩu cũ. Hộp thoại phải
 * nói thẳng điều đó trước khi bấm, vì hai việc trông giống nhau từ phía người
 * dùng nhưng hậu quả khác hẳn: nếu người kia đang giữ mật khẩu cũ và dùng được,
 * bấm nút này là làm hỏng thứ đang chạy.
 */
export function ResetPasswordModal({
  user,
  onClose,
  onIssued,
}: {
  user: AdminUserDto | null;
  onClose: () => void;
  onIssued: (result: ResetMemberPasswordResultDto) => void;
}): React.ReactElement {
  const [error, showError, clearError] = useActionError();
  const mutation = useResetMemberPassword();

  useEffect(() => {
    if (user) clearError();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const submit = (): void => {
    if (!user) return;
    mutation.mutate(user.userId, {
      // KHÔNG gọi `onClose` ở đây. `onIssued` đưa mật khẩu mới lên bảng của
      // trang rồi tự đóng hộp thoại — tách hai việc ra thì sẽ có một nhịp hộp
      // thoại đã đóng mà bảng chưa hiện, và đó đúng là nhịp làm mất mật khẩu.
      onSuccess: onIssued,
      onError: showError,
    });
  };

  return (
    <Modal
      open={user !== null}
      onClose={onClose}
      title="Cấp lại mật khẩu tạm"
      description={user ? `${user.fullName} · ${user.email}` : ''}
      footer={
        <>
          <Button onClick={onClose}>Huỷ</Button>
          <Button variant="danger" onClick={submit} loading={mutation.isPending}>
            Cấp mật khẩu mới
          </Button>
        </>
      }
    >
      <ErrorLine message={error} />
      <p className="text-sm text-slate-600">
        Hệ thống sinh một mật khẩu tạm <strong>mới</strong> và hiện đúng một lần để bạn gửi cho
        người này. Họ sẽ bị buộc đổi mật khẩu ở lần đăng nhập tiếp theo.
      </p>
      <p className="mt-2 text-sm text-slate-600">
        Mật khẩu hiện tại của họ <strong>hết hiệu lực ngay lập tức</strong>. Chỉ dùng khi mật
        khẩu tạm đã mất hoặc người này không đăng nhập được.
      </p>
      {/* Nói ra hạn chế thay vì để admin tự phát hiện lúc cần nhất: đổi mật khẩu
          KHÔNG đá phiên đang mở ra, vì token đã ký thì còn giá trị tới 7 ngày và
          hệ thống chưa có bảng thu hồi token. */}
      <p className="mt-2 text-sm text-slate-500">
        Nếu người này đang đăng nhập sẵn, phiên của họ vẫn chạy tiếp. Cần chặn ngay thì dùng
        nút <strong>Khoá</strong>.
      </p>
    </Modal>
  );
}

// ─── Gỡ khỏi tổ chức ─────────────────────────────────────────────────────────

export function RemoveMemberModal({
  user,
  onClose,
}: {
  user: AdminUserDto | null;
  onClose: () => void;
}): React.ReactElement {
  const [error, showError, clearError] = useActionError();
  const mutation = useRemoveMember();

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
