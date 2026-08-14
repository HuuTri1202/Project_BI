import type { ProjectDto } from '@bi/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { usePermissions } from '../auth/usePermissions';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { Button } from '../components/ui/Button';
import { Page, PageBody, PageHeader } from '../components/ui/Page';
import { EmptyState, ErrorState, TableSkeleton } from '../components/ui/states';
import { CreateReportMenu } from '../features/tenant/CreateReportMenu';
import { ProjectFormModal } from '../features/tenant/ProjectFormModal';
import { useDeleteProject, useHome } from '../features/tenant/hooks';
import { getApiError } from '../services/apiClient';
import { useWorkspace } from '../workspace/useWorkspace';

type ViewMode = 'grid' | 'list';

const VIEW_STORAGE_KEY = 'bi.home.view';

function readView(): ViewMode {
  try {
    return window.localStorage.getItem(VIEW_STORAGE_KEY) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}

/**
 * Trang chủ khu người dùng — §4.2.
 *
 * Danh sách project của workspace ĐANG CHỌN, chuyển được giữa lưới và danh sách.
 * Kiểu hiển thị ghi nhớ trong localStorage: đó là sở thích cá nhân, không phải
 * trạng thái điều hướng, nên nó không thuộc về URL và cũng không đáng một cột
 * trong database.
 *
 * Khối "Báo cáo gần đây" dựng sẵn ở trạng thái *sắp có*: chưa có bảng `reports`
 * và chưa có trình soạn báo cáo. Nói thẳng điều đó thay vì để một ô trống mà
 * người xem phải tự đoán là hỏng hay chưa có dữ liệu.
 */
export default function HomePage(): React.ReactElement {
  const { user } = useAuth();
  const permissions = usePermissions();
  const { current, isLoading: wsLoading } = useWorkspace();
  const { data, isPending, isError, error } = useHome();
  const deleteProject = useDeleteProject();

  const [view, setView] = useState<ViewMode>(readView);
  const [editing, setEditing] = useState<ProjectDto | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [confirming, setConfirming] = useState<ProjectDto | null>(null);

  // §5.9 — hỏi bảng quyền, không so sánh chuỗi vai trò tại chỗ. Ô `editContent`
  // khớp với `requireRole('admin','creator')` trên `/v1/projects` ở backend.
  const canEdit = permissions.editContent;

  function changeView(next: ViewMode): void {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, next);
    } catch {
      // Không nhớ được thì lần sau về mặc định, không đáng để chặn thao tác.
    }
  }

  function openCreate(): void {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(project: ProjectDto): void {
    setEditing(project);
    setFormOpen(true);
  }

  // `onError` do chính ConfirmDialog truyền vào: lỗi hiện NGAY TRONG hộp thoại
  // chứ không đóng lại im lặng. Server từ chối bằng những lý do rất cụ thể, và
  // đó chính là thông tin người dùng cần để biết phải làm gì tiếp.
  function confirmDelete(onError: (err: unknown) => void): void {
    if (!confirming) return;
    deleteProject.mutate(confirming.id, {
      onSuccess: () => setConfirming(null),
      onError,
    });
  }

  const projects = data?.projects ?? [];

  return (
    <Page>
      <PageHeader
        title={`Xin chào, ${user?.fullName ?? 'bạn'}`}
        description={current ? `Đang làm việc trong ${current.name}` : 'Chưa chọn workspace'}
        actions={
          <>
            {/* §5.9 — viewer không tạo được báo cáo, nên nút cũng không hiện. Cùng
                một ô quyền với nút "Tạo project" ngay bên cạnh: cả hai đều là tạo
                nội dung, tách ra hai câu điều kiện riêng chỉ mời chúng lệch nhau. */}
            {canEdit && <CreateReportMenu />}
            {canEdit && (
              <Button variant="primary" onClick={openCreate} disabled={!current}>
                Tạo project
              </Button>
            )}
          </>
        }
      />

      <PageBody>

      {/* Đường vào console vận hành hệ thống.
          Hỏi `platformRole` (`users.role`), KHÔNG phải `role` (`memberships.role`):
          luồng đăng ký cấp `admin` trong tổ chức cho mọi người tự lập công ty, nên
          hỏi nhầm trục là ai đăng ký cũng thấy nút này. `AdminRoute` chặn ở route
          và ba lớp guard chặn ở backend, nhưng một nút dẫn tới trang 403 thì vẫn
          là một cái bẫy không có lý do gì để tồn tại. */}
      {permissions.adminConsole && <AdminConsoleCard />}

      {isError && (
        <div className="mt-6">
          <ErrorState message={getApiError(error).message} />
        </div>
      )}
      {/* Thẻ số. Trong lúc chờ để dấu gạch ngang chứ không phải số 0 — hiện 0
          rồi nhảy sang 12 khiến người ta tin vào con số 0 đó trong khoảnh khắc. */}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <StatCard label="Project trong workspace" value={data?.stats.projects} />
        <StatCard label="Thành viên trong tổ chức" value={data?.stats.members} />
      </div>

      <section className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-900">Project</h2>
          <ViewToggle value={view} onChange={changeView} />
        </div>

        <div className="mt-4">
          {(isPending || wsLoading) && <TableSkeleton rows={3} />}

          {!isPending && !wsLoading && projects.length === 0 && (
            <EmptyState
              title="Chưa có project nào"
              hint={
                canEdit
                  ? 'Project là nơi chứa dataset và báo cáo của một mảng công việc. Tạo cái đầu tiên để bắt đầu.'
                  : 'Quản trị viên hoặc người tạo báo cáo của tổ chức sẽ tạo project.'
              }
              action={
                canEdit && current ? (
                  <Button variant="primary" onClick={openCreate}>
                    Tạo project
                  </Button>
                ) : undefined
              }
            />
          )}

          {projects.length > 0 &&
            (view === 'grid' ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {projects.map((p) => (
                  <ProjectCard
                    key={p.id}
                    project={p}
                    canEdit={canEdit}
                    onEdit={() => openEdit(p)}
                    onDelete={() => setConfirming(p)}
                  />
                ))}
              </div>
            ) : (
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
                {projects.map((p) => (
                  <ProjectRow
                    key={p.id}
                    project={p}
                    canEdit={canEdit}
                    onEdit={() => openEdit(p)}
                    onDelete={() => setConfirming(p)}
                  />
                ))}
              </ul>
            ))}
        </div>
      </section>

      <ProjectFormModal open={formOpen} onClose={() => setFormOpen(false)} project={editing} />

      <ConfirmDialog
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        onConfirm={confirmDelete}
        title="Xoá project"
        confirmLabel="Xoá project"
        danger
        loading={deleteProject.isPending}
      >
        Xoá <strong>{confirming?.name}</strong>? Dataset và báo cáo bên trong sẽ không truy cập
        được nữa.
        </ConfirmDialog>
      </PageBody>
    </Page>
  );
}

/**
 * Thẻ dẫn sang console vận hành hệ thống.
 *
 * Cố ý dùng tông tối của sidebar khu quản trị chứ không phải tông trắng của khu
 * người dùng: đây là lối sang một khu vực khác hẳn về phạm vi — nhìn xuyên mọi
 * tổ chức, không chỉ tổ chức đang mở — và màu sắc là thứ báo điều đó trước khi
 * người dùng kịp đọc chữ.
 */
function AdminConsoleCard(): React.ReactElement {
  return (
    <section className="mt-6 flex flex-wrap items-center gap-4 rounded-xl bg-slate-900 px-5 py-4">
      <span
        aria-hidden="true"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-800 text-slate-300"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-5 w-5"
        >
          <path d="M12 3 4 6v6c0 4.4 3.4 8.2 8 9 4.6-.8 8-4.6 8-9V6l-8-3Z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-white">Quản trị hệ thống</p>
        <p className="mt-0.5 text-sm text-slate-400">
          Tài khoản của bạn quản lý được toàn bộ nền tảng: tổ chức, người dùng và workspace của
          mọi công ty.
        </p>
      </div>

      <Link
        to="/admin"
        className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition-colors hover:bg-slate-100"
      >
        Admin Console →
      </Link>
    </section>
  );
}

function StatCard({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <p className="text-sm font-medium text-slate-600">{label}</p>
      <p
        className={`mt-2 text-3xl font-bold tabular-nums ${
          value === undefined ? 'text-slate-300' : 'text-slate-900'
        }`}
      >
        {value === undefined ? '—' : value.toLocaleString('vi-VN')}
      </p>
    </div>
  );
}

function ViewToggle({
  value,
  onChange,
}: {
  value: ViewMode;
  onChange: (v: ViewMode) => void;
}): React.ReactElement {
  const options: { mode: ViewMode; label: string; icon: string }[] = [
    { mode: 'grid', label: 'Dạng lưới', icon: 'M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm9 0h7v7h-7v-7Z' },
    { mode: 'list', label: 'Dạng danh sách', icon: 'M4 6h16M4 12h16M4 18h16' },
  ];

  return (
    <div className="flex rounded-lg border border-slate-300 bg-white p-0.5" role="group">
      {options.map((o) => (
        <button
          key={o.mode}
          type="button"
          onClick={() => onChange(o.mode)}
          aria-label={o.label}
          aria-pressed={value === o.mode}
          className={`rounded-md p-1.5 transition-colors ${
            value === o.mode ? 'bg-slate-100 text-slate-900' : 'text-slate-400 hover:text-slate-600'
          }`}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4"
            aria-hidden="true"
          >
            <path d={o.icon} />
          </svg>
        </button>
      ))}
    </div>
  );
}

interface ItemProps {
  project: ProjectDto;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('vi-VN');
}

function ProjectCard({ project, canEdit, onEdit, onDelete }: ItemProps): React.ReactElement {
  return (
    <article className="flex flex-col rounded-xl border border-slate-200 bg-white p-5">
      <h3 className="font-semibold text-slate-900">{project.name}</h3>
      <p className="mt-1 line-clamp-2 min-h-[2.5rem] text-sm text-slate-500">
        {project.description ?? 'Không có mô tả'}
      </p>
      <p className="mt-3 text-xs text-slate-400">
        {project.creatorName ?? 'Không rõ'} · {formatDate(project.updatedAt)}
      </p>
      {canEdit && (
        <div className="mt-4 flex gap-2 border-t border-slate-100 pt-3">
          <Button size="sm" variant="ghost" onClick={onEdit}>
            Sửa
          </Button>
          <Button size="sm" variant="ghost" onClick={onDelete}>
            Xoá
          </Button>
        </div>
      )}
    </article>
  );
}

function ProjectRow({ project, canEdit, onEdit, onDelete }: ItemProps): React.ReactElement {
  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-3.5">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-slate-900">{project.name}</p>
        <p className="truncate text-sm text-slate-500">
          {project.description ?? 'Không có mô tả'}
        </p>
      </div>
      <p className="text-xs text-slate-400">
        {project.creatorName ?? 'Không rõ'} · {formatDate(project.updatedAt)}
      </p>
      {canEdit && (
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={onEdit}>
            Sửa
          </Button>
          <Button size="sm" variant="ghost" onClick={onDelete}>
            Xoá
          </Button>
        </div>
      )}
    </li>
  );
}
