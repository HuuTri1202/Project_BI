import { CHART_TYPE_LABELS, REPORT_SOURCE_LABELS, type ReportDto } from '@bi/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { usePermissions } from '../auth/usePermissions';
import { Badge } from '../components/ui/Badge';
import { Page, PageBody, PageHeader } from '../components/ui/Page';
import { EmptyState, ErrorState, TableSkeleton } from '../components/ui/states';
import { CreateReportMenu } from '../features/tenant/CreateReportMenu';
import { useHome } from '../features/tenant/hooks';
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
 * Danh sách BÁO CÁO của workspace đang chọn, chuyển được giữa lưới và danh
 * sách. Kiểu hiển thị ghi nhớ trong localStorage: đó là sở thích cá nhân, không
 * phải trạng thái điều hướng, nên nó không thuộc về URL và cũng không đáng một
 * cột trong database.
 *
 * Trước đây chỗ này liệt kê project. Project đã bị bỏ khỏi hệ thống (migration
 * 17) vì `workspace_id` đã làm đúng việc gom nhóm mà nó sinh ra để làm, nên
 * trang chủ chuyển sang liệt kê thứ người dùng thật sự quay lại tìm.
 */
export default function HomePage(): React.ReactElement {
  const { user } = useAuth();
  const permissions = usePermissions();
  const { current, isLoading: wsLoading } = useWorkspace();
  const { data, isPending, isError, error } = useHome();

  const [view, setView] = useState<ViewMode>(readView);

  // §5.9 — hỏi bảng quyền, không so sánh chuỗi vai trò tại chỗ. Ô `editContent`
  // khớp với `authorize('report', 'modify')` ở backend.
  const canEdit = permissions.editContent;

  function changeView(next: ViewMode): void {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, next);
    } catch {
      // Không nhớ được thì lần sau về mặc định, không đáng để chặn thao tác.
    }
  }

  const reports = data?.reports ?? [];

  return (
    <Page>
      <PageHeader
        title={`Xin chào, ${user?.fullName ?? 'bạn'}`}
        description={current ? `Đang làm việc trong ${current.name}` : 'Chưa chọn workspace'}
        // §5.9 — viewer không tạo được báo cáo, nên nút cũng không hiện.
        actions={canEdit ? <CreateReportMenu /> : undefined}
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
        <StatCard label="Báo cáo trong workspace" value={data?.stats.reports} />
        <StatCard label="Thành viên trong tổ chức" value={data?.stats.members} />
      </div>

      <section className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-900">Báo cáo</h2>
          <ViewToggle value={view} onChange={changeView} />
        </div>

        <div className="mt-4">
          {(isPending || wsLoading) && <TableSkeleton rows={3} />}

          {!isPending && !wsLoading && reports.length === 0 && (
            <EmptyState
              title="Chưa có báo cáo nào"
              hint={
                canEdit
                  ? 'Dùng nút "Tạo báo cáo" để dựng cái đầu tiên — từ một file Excel/CSV, hoặc từ một mô hình dữ liệu đã khai.'
                  : 'Quản trị viên hoặc người tạo báo cáo của tổ chức sẽ dựng báo cáo.'
              }
            />
          )}

          {reports.length > 0 &&
            (view === 'grid' ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {reports.map((r) => (
                  <ReportCard key={r.id} report={r} />
                ))}
              </div>
            ) : (
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
                {reports.map((r) => (
                  <ReportRow key={r.id} report={r} />
                ))}
              </ul>
            ))}
        </div>
      </section>

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
  report: ReportDto;
}

/**
 * Cả thẻ là MỘT liên kết, khác thẻ project trước đây.
 *
 * Thẻ project phải để hai nút Sửa/Xoá bên trong nên chỉ tiêu đề mới bấm được.
 * Báo cáo không có nút nào ở đây — sửa và xoá đều nằm trên trang báo cáo — nên
 * cả khối trở thành vùng bấm, và đó là thứ người dùng vốn đã cố bấm vào.
 */
function ReportCard({ report }: ItemProps): React.ReactElement {
  return (
    <Link
      to={`/reports/${report.id}`}
      className="flex flex-col rounded-xl border border-slate-200 bg-white p-5 transition-colors hover:border-brand-300 hover:bg-slate-50"
    >
      <h3 className="font-semibold text-slate-900">{report.name}</h3>
      <p className="mt-2 flex flex-wrap items-center gap-2">
        {report.chartType === null ? (
          <Badge tone="warning">Chưa có biểu đồ</Badge>
        ) : (
          <Badge tone="neutral">{CHART_TYPE_LABELS[report.chartType]}</Badge>
        )}
        <span className="text-xs text-slate-500">
          {REPORT_SOURCE_LABELS[report.source]} · {report.sourceName}
        </span>
      </p>
      <p className="mt-3 text-xs text-slate-400">
        {report.creatorName ?? 'Không rõ'} · {formatDate(report.updatedAt)}
      </p>
    </Link>
  );
}

function ReportRow({ report }: ItemProps): React.ReactElement {
  return (
    <li>
      <Link
        to={`/reports/${report.id}`}
        className="flex flex-wrap items-center gap-3 px-5 py-3.5 transition-colors hover:bg-slate-50"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-slate-900">{report.name}</p>
          <p className="truncate text-sm text-slate-500">
            {REPORT_SOURCE_LABELS[report.source]} · {report.sourceName}
          </p>
        </div>
        {report.chartType === null ? (
          <Badge tone="warning">Chưa có biểu đồ</Badge>
        ) : (
          <Badge tone="neutral">{CHART_TYPE_LABELS[report.chartType]}</Badge>
        )}
        <p className="text-xs text-slate-400">
          {report.creatorName ?? 'Không rõ'} · {formatDate(report.updatedAt)}
        </p>
      </Link>
    </li>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('vi-VN');
}

