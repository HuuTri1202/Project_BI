import type { PlatformOverviewDto } from '@bi/shared';
import { lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import { ErrorState } from '../../components/ui/states';
import { useOverview } from '../../features/admin/hooks';
import { getApiError } from '../../services/apiClient';

const GrowthChart = lazy(() => import('../../features/admin/charts/GrowthChart'));

interface KpiCard {
  label: string;
  hint: string;
  to: string;
  value: (data: PlatformOverviewDto) => number;
  /** Số phụ hiện nhỏ bên dưới, ví dụ "2 đang bị khoá". */
  sub?: (data: PlatformOverviewDto) => string | null;
}

const KPI_CARDS: KpiCard[] = [
  {
    label: 'Tổ chức đang hoạt động',
    hint: 'công ty trên nền tảng',
    to: '/admin/tenants',
    value: (d) => d.activeTenants,
    sub: (d) => (d.lockedTenants > 0 ? `${d.lockedTenants} đang bị khoá` : null),
  },
  {
    label: 'Người dùng toàn hệ thống',
    hint: 'tất cả tài khoản',
    to: '/admin/users',
    value: (d) => d.totalUsers,
    sub: (d) => (d.lockedUsers > 0 ? `${d.lockedUsers} đang bị khoá` : null),
  },
  {
    label: 'Workspace',
    hint: 'trên tất cả tổ chức',
    to: '/admin/workspaces',
    value: (d) => d.totalWorkspaces,
  },
];

/** Tổng quan hệ thống — chỉ số toàn nền tảng và biểu đồ tăng trưởng. */
export default function OverviewPage(): React.ReactElement {
  const { data, isPending, isError, error } = useOverview();

  const hasGrowth =
    data?.growth.some((p) => p.tenants > 0 || p.users > 0 || p.workspaces > 0) ?? false;

  return (
    <div className="mx-auto max-w-6xl">
      <header>
        <h1 className="text-xl font-bold text-slate-900">Tổng quan hệ thống</h1>
        <p className="mt-1 text-sm text-slate-500">
          Số liệu trên toàn bộ nền tảng, gồm tất cả tổ chức.
        </p>
      </header>

      {isError && (
        <div className="mt-6">
          <ErrorState message={getApiError(error).message} />
        </div>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        {KPI_CARDS.map((card) => (
          <Link
            key={card.label}
            to={card.to}
            className="rounded-xl border border-slate-200 bg-white p-5 transition-colors hover:border-brand-300 hover:bg-brand-50/30"
          >
            <p className="text-sm font-medium text-slate-600">{card.label}</p>
            <p
              className={`mt-2 text-3xl font-bold tabular-nums ${
                // Trong lúc chờ vẫn để dấu gạch ngang chứ không phải số 0. Hiện
                // 0 rồi nhảy sang 12 khiến người ta tin vào con số 0 đó trong
                // khoảnh khắc — với số liệu vận hành thì đó là nói dối.
                data === undefined ? 'text-slate-300' : 'text-slate-900'
              }`}
            >
              {data === undefined ? '—' : card.value(data).toLocaleString('vi-VN')}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {data && card.sub?.(data) ? (
                <span className="text-amber-600">{card.sub(data)}</span>
              ) : (
                card.hint
              )}
            </p>
          </Link>
        ))}
      </div>

      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">Tăng trưởng theo thời gian</h2>
          <p className="text-xs text-slate-400">
            {data ? `${data.rangeDays} ngày gần nhất · số mới mỗi ngày · giờ UTC` : ''}
          </p>
        </div>

        <div className="mt-4">
          {isPending && <ChartSkeleton />}

          {/* Cả kỳ không có gì mới thì nói thẳng, thay vì vẽ ba đường phẳng
              dính đáy để người xem tự đoán là biểu đồ hỏng hay chưa có dữ liệu.
              Bỏ qua luôn việc tải chunk vega trong trường hợp này. */}
          {data && !hasGrowth && (
            <p className="py-16 text-center text-sm text-slate-500">
              Chưa có tổ chức, người dùng hay workspace nào được tạo trong {data.rangeDays} ngày
              qua.
            </p>
          )}

          {data && hasGrowth && (
            <Suspense fallback={<ChartSkeleton />}>
              <GrowthChart data={data.growth} rangeDays={data.rangeDays} />
            </Suspense>
          )}
        </div>
      </section>
    </div>
  );
}

function ChartSkeleton(): React.ReactElement {
  return (
    <div className="h-[260px] animate-pulse rounded-lg bg-slate-100" role="status">
      <span className="sr-only">Đang tải biểu đồ…</span>
    </div>
  );
}
