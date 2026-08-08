import type { AdminOverviewDto } from '@bi/shared';
import { lazy, Suspense } from 'react';
import { useAuth } from '../../auth/useAuth';
import { useAdminOverview } from '../../features/admin/useAdminOverview';
import { getApiError } from '../../services/apiClient';

/**
 * Trang Tổng quan — §3.2.
 *
 * Biểu đồ nạp qua `React.lazy` để bộ vega (~250–300 kB gzip) nằm ở chunk riêng:
 * bốn thẻ KPI hiện ngay, biểu đồ tới sau. Không làm vậy thì mỗi lần mở khu quản
 * trị đều phải tải cả trình biên dịch Vega-Lite trước khi thấy được con số đầu
 * tiên.
 */
const NewMembersChart = lazy(() => import('../../features/admin/charts/NewMembersChart'));
const RoleBreakdownChart = lazy(() => import('../../features/admin/charts/RoleBreakdownChart'));

interface KpiCard {
  label: string;
  hint: string;
  value: (data: AdminOverviewDto) => number;
  /** Bật màu cảnh báo khi số này khác 0. */
  warnWhenPositive?: boolean;
}

const KPI_CARDS: KpiCard[] = [
  { label: 'Tổng người dùng', hint: 'trong tổ chức', value: (d) => d.totalMembers },
  { label: 'Quản trị viên', hint: 'vai trò admin', value: (d) => d.admins },
  {
    label: 'Tài khoản bị khoá',
    hint: 'đang vô hiệu',
    value: (d) => d.lockedMembers,
    warnWhenPositive: true,
  },
  { label: 'Workspace', hint: 'đang hoạt động', value: (d) => d.workspaces },
];

export default function OverviewPage(): React.ReactElement {
  const { user, tenant } = useAuth();
  const { data, isPending, isError, error } = useAdminOverview();

  return (
    <div className="mx-auto max-w-6xl">
      <header>
        <h1 className="text-xl font-bold text-slate-900">Tổng quan</h1>
        <p className="mt-1 text-sm text-slate-500">
          {tenant?.name ?? 'Không rõ tổ chức'} · đăng nhập bởi {user?.email}
        </p>
      </header>

      {isError && (
        <div
          role="alert"
          className="mt-6 rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700"
        >
          {getApiError(error).message}
        </div>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {KPI_CARDS.map((card) => (
          <div key={card.label} className="rounded-xl border border-slate-200 bg-white p-5">
            <p className="text-sm font-medium text-slate-600">{card.label}</p>
            <p
              className={[
                'mt-2 text-3xl font-bold tabular-nums',
                // Trong lúc chờ vẫn để dấu gạch ngang chứ không phải số 0.
                // Hiện 0 rồi nhảy sang 12 khiến người ta tin vào con số 0 đó
                // trong khoảnh khắc — với số liệu quản trị thì đó là nói dối.
                data === undefined
                  ? 'text-slate-300'
                  : card.warnWhenPositive && card.value(data) > 0
                    ? 'text-amber-600'
                    : 'text-slate-900',
              ].join(' ')}
            >
              {data === undefined ? '—' : card.value(data).toLocaleString('vi-VN')}
            </p>
            <p className="mt-1 text-xs text-slate-400">{card.hint}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <ChartCard title="Cơ cấu theo vai trò" subtitle="thành viên còn trong tổ chức">
          {isPending && <ChartSkeleton />}
          {data && (
            <Suspense fallback={<ChartSkeleton />}>
              <RoleBreakdownChart data={data.roleBreakdown} />
            </Suspense>
          )}
        </ChartCard>

        <ChartCard
          title="Thành viên mới theo ngày"
          subtitle={data ? `${data.rangeDays} ngày gần nhất · giờ UTC` : ''}
        >
          {isPending && <ChartSkeleton />}

          {/* Không có ai vào trong cả kỳ thì nói thẳng, thay vì vẽ một khung
              trống trơn để người xem tự đoán là biểu đồ hỏng hay chưa có dữ
              liệu. Bỏ qua luôn việc tải chunk vega trong trường hợp này. */}
          {data && data.newMembersDaily.every((point) => point.count === 0) && (
            <p className="py-16 text-center text-sm text-slate-500">
              Chưa có ai tham gia trong {data.rangeDays} ngày qua.
            </p>
          )}

          {data && data.newMembersDaily.some((point) => point.count > 0) && (
            <Suspense fallback={<ChartSkeleton />}>
              <NewMembersChart data={data.newMembersDaily} rangeDays={data.rangeDays} />
            </Suspense>
          )}
        </ChartCard>
      </div>
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        <p className="text-xs text-slate-400">{subtitle}</p>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function ChartSkeleton(): React.ReactElement {
  return (
    <div className="h-[220px] animate-pulse rounded-lg bg-slate-100" role="status">
      <span className="sr-only">Đang tải biểu đồ…</span>
    </div>
  );
}
