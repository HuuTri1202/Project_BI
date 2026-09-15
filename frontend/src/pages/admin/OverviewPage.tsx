import type { PlatformOverviewDto } from '@bi/shared';
import { lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge';
import { Page, PageBody, PageHeader } from '../../components/ui/Page';
import { TBody, Td, Th, THead, TableWrap, Tr } from '../../components/ui/Table';
import { ErrorState } from '../../components/ui/states';
import { useOverview } from '../../features/admin/hooks';
import { dinhDangTien } from '../../features/billing/format';
import { getApiError } from '../../services/apiClient';

const GrowthChart = lazy(() => import('../../features/admin/charts/GrowthChart'));
const PaidOrdersChart = lazy(() => import('../../features/admin/charts/PaidOrdersChart'));

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
    <Page>
      <PageHeader
        title="Tổng quan hệ thống"
        description="Số liệu trên toàn bộ nền tảng, gồm tất cả tổ chức."
      />

      <PageBody>
        {isError && <ErrorState message={getApiError(error).message} />}

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
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

        {data && <BillingSection data={data} />}
      </PageBody>
    </Page>
  );
}

/**
 * Đơn thanh toán — ai đã mua gói gì, bán được bao nhiêu.
 *
 * Ba lớp, từ gọn tới chi tiết: ba con số của cả kỳ, biểu đồ theo ngày và gói,
 * rồi danh sách những đơn vừa thanh toán kèm NGƯỜI MUA. Danh sách không phải phần
 * thừa dưới biểu đồ: biểu đồ trả lời "bán được bao nhiêu", còn câu người vận hành
 * hỏi ngay sau đó là "ai mua" — và nó cũng là bản số liệu đọc được bằng trình
 * đọc màn hình.
 *
 * Không có bộ lọc hay phân trang ở đây: trang Đơn hàng đã có đủ, và một đường
 * dẫn tới đó rẻ hơn một bản sao thứ hai của nó.
 */
function BillingSection({ data }: { data: PlatformOverviewDto }): React.ReactElement {
  const { billing, rangeDays } = data;
  const days = data.growth.map((p) => p.date);

  const stats = [
    {
      label: 'Doanh thu',
      value: dinhDangTien(billing.revenueVnd),
      hint: `${rangeDays} ngày gần nhất`,
    },
    {
      label: 'Đơn đã thanh toán',
      value: billing.paidOrders.toLocaleString('vi-VN'),
      hint: `${rangeDays} ngày gần nhất`,
    },
    {
      label: 'Tổ chức đang trả phí',
      value: billing.payingTenants.toLocaleString('vi-VN'),
      hint: 'gói có phí, còn hạn',
    },
  ];

  return (
    <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">Đơn thanh toán</h2>
        <Link
          to="/admin/billing/orders"
          className="text-xs font-medium text-brand-700 hover:text-brand-600"
        >
          Xem tất cả đơn →
        </Link>
      </div>

      <dl className="mt-4 grid gap-3 sm:grid-cols-3">
        {stats.map((s) => (
          <div key={s.label} className="rounded-lg bg-slate-50 px-4 py-3">
            <dt className="text-xs font-medium text-slate-500">{s.label}</dt>
            <dd className="mt-1 text-xl font-bold text-slate-900 tabular-nums">{s.value}</dd>
            <dd className="text-xs text-slate-400">{s.hint}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-5">
        <p className="mb-2 text-xs text-slate-400">
          Số đơn đã thanh toán mỗi ngày, theo gói · giờ UTC
        </p>
        {billing.daily.length === 0 ? (
          // Cùng lý do với biểu đồ tăng trưởng: một trục toàn số 0 trông giống
          // biểu đồ hỏng hơn là "chưa bán được đơn nào".
          <p className="py-12 text-center text-sm text-slate-500">
            Chưa có đơn nào được thanh toán trong {rangeDays} ngày qua.
          </p>
        ) : (
          <Suspense fallback={<ChartSkeleton />}>
            <PaidOrdersChart daily={billing.daily} days={days} />
          </Suspense>
        )}
      </div>

      <div className="mt-6">
        <h3 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
          Vừa thanh toán
        </h3>
        {billing.recentOrders.length === 0 ? (
          <p className="text-sm text-slate-500">Chưa có đơn nào được thanh toán.</p>
        ) : (
          <TableWrap>
            <THead>
              <Tr>
                <Th>Mã đơn</Th>
                <Th>Người mua</Th>
                <Th>Tổ chức</Th>
                <Th>Gói</Th>
                <Th align="right">Số tiền</Th>
                <Th>Thanh toán lúc</Th>
              </Tr>
            </THead>
            <TBody>
              {billing.recentOrders.map((o) => (
                <Tr key={o.orderCode}>
                  <Td>
                    <span className="font-mono text-xs text-slate-700">{o.orderCode}</span>
                  </Td>
                  <Td>
                    {o.buyerName === null ? (
                      <span className="text-xs text-slate-400">Tài khoản đã xoá</span>
                    ) : (
                      <>
                        <div className="font-medium text-slate-900">{o.buyerName}</div>
                        <div className="text-xs text-slate-500">{o.buyerEmail}</div>
                      </>
                    )}
                  </Td>
                  <Td>
                    <span className="text-slate-600">{o.tenantName}</span>
                  </Td>
                  <Td>
                    <Badge tone="brand">{o.planName}</Badge>
                  </Td>
                  <Td align="right">
                    <span className="tabular-nums">{dinhDangTien(o.amountVnd)}</span>
                  </Td>
                  <Td>
                    <span className="text-slate-500">
                      {new Date(o.paidAt).toLocaleString('vi-VN')}
                    </span>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </TableWrap>
        )}
      </div>
    </section>
  );
}

function ChartSkeleton(): React.ReactElement {
  return (
    <div className="h-[260px] animate-pulse rounded-lg bg-slate-100" role="status">
      <span className="sr-only">Đang tải biểu đồ…</span>
    </div>
  );
}
