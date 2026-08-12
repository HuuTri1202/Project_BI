import { CHART_TYPE_LABELS, type ChartType, type ReportDataDto } from '@bi/shared';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { TopLevelSpec } from 'vega-lite';
import { usePermissions } from '../auth/usePermissions';
import { VegaChart } from '../components/charts/VegaChart';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { TBody, Td, Th, THead, TableWrap, Tr } from '../components/ui/Table';
import { ErrorState, TableSkeleton } from '../components/ui/states';
import { CHART_AXIS_CONFIG, readBrandColor } from '../features/admin/charts/theme';
import { useDeleteReport, useReport, useReportData } from '../features/datasets/hooks';
import { getApiError } from '../services/apiClient';

/**
 * Trang xem báo cáo — §7.6.
 *
 * Đây là đích của wizard: sau khi tạo xong, người dùng được đưa thẳng tới đây và
 * nhìn thấy biểu đồ vẽ từ chính file họ vừa tải lên. Không có màn hình này thì
 * bước "chọn cột" ở wizard không chứng minh được điều gì.
 *
 * Trình SOẠN báo cáo (đổi cấu hình rồi lưu lại) chưa có — mục này chỉ yêu cầu
 * xem. Bảng số liệu bên dưới biểu đồ không phải phần thừa: nó là thứ người dùng
 * đối chiếu khi nghi ngờ biểu đồ, và là bản mà trình đọc màn hình đọc được.
 */
export default function ReportPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const reportId = Number(id);
  const navigate = useNavigate();
  const permissions = usePermissions();

  const report = useReport(Number.isFinite(reportId) ? reportId : null);
  const remove = useDeleteReport();

  const [confirming, setConfirming] = useState(false);

  /**
   * `chartType === null` nghĩa là báo cáo CHƯA được dựng biểu đồ.
   *
   * Đó là trạng thái mọi báo cáo đi qua ngay sau khi wizard tạo ra nó (§7.6) —
   * bình thường, không phải hỏng. Trang này hiện lời mời dựng biểu đồ thay vì
   * một khung trống hay một biểu đồ mặc định không ai yêu cầu.
   */
  const chartType = report.data?.chartType ?? null;
  const notConfigured = report.data !== undefined && chartType === null;

  /**
   * Chỉ hỏi dữ liệu khi báo cáo ĐÃ có biểu đồ.
   *
   * Gọi lúc chưa cấu hình thì backend trả 409 `ReportNotConfigured` — đúng
   * nghiệp vụ, nhưng react-query ghi nó vào trạng thái lỗi và trang hiện một
   * thông báo đỏ cho một tình huống hoàn toàn bình thường.
   */
  const data = useReportData(
    Number.isFinite(reportId) && report.data?.chartType != null ? reportId : null,
  );

  /**
   * Spec được `useMemo`: `VegaChart` dựng lại toàn bộ view mỗi khi tham chiếu
   * `spec` đổi, nên một object literal trong JSX sẽ tạo lại biểu đồ sau MỖI lần
   * render — nhấp nháy liên tục và rò bộ nhớ.
   */
  const spec = useMemo<TopLevelSpec | null>(
    () => (data.data && chartType !== null ? buildSpec(chartType, data.data) : null),
    [chartType, data.data],
  );

  if (report.isError) {
    return <ErrorState message={getApiError(report.error).message} />;
  }

  return (
    <div className="mx-auto max-w-5xl">
      <nav className="mb-4 text-sm">
        <Link to="/" className="text-slate-500 hover:text-slate-700">
          ← Trang chủ
        </Link>
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-slate-900">
            {report.data?.name ?? 'Đang tải…'}
          </h1>
          {report.data && (
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500">
              {report.data.chartType === null ? (
                <Badge tone="warning">Chưa có biểu đồ</Badge>
              ) : (
                <Badge tone="neutral">{CHART_TYPE_LABELS[report.data.chartType]}</Badge>
              )}
              <span>
                Dữ liệu từ <span className="font-medium">{report.data.datasetName}</span>
              </span>
              <span>· {report.data.creatorName ?? 'Không rõ'}</span>
            </p>
          )}
        </div>

        {permissions.can('report', 'delete') && report.data && (
          <Button variant="ghost" onClick={() => setConfirming(true)}>
            <span className="text-red-600">Xoá báo cáo</span>
          </Button>
        )}
      </header>

      <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5">
        {/* Báo cáo vừa được wizard tạo: chưa có biểu đồ, và đó là trạng thái
            bình thường. Nói rõ bước tiếp theo thay vì để một khung trống. */}
        {notConfigured && <NotConfigured datasetName={report.data?.datasetName ?? ''} />}

        {!notConfigured && data.isPending && <TableSkeleton rows={4} />}
        {!notConfigured && data.isError && (
          <ErrorState message={getApiError(data.error).message} />
        )}

        {data.data && data.data.rows.length === 0 && (
          <p className="py-10 text-center text-sm text-slate-500">
            Bộ dữ liệu không có dòng nào để vẽ.
          </p>
        )}

        {data.data && data.data.rows.length > 0 && spec && chartType !== 'table' && (
          <>
            <VegaChart
              spec={spec}
              data={data.data.rows}
              ariaLabel={`${data.data.measureLabel} theo ${data.data.dimensionLabel}`}
              className="w-full"
            />
            {data.data.grouped && (
              // Người xem phải biết biểu đồ không hiện hết mọi nhóm, nếu không
              // họ sẽ đọc "5 nhóm lớn nhất" thành "toàn bộ dữ liệu".
              <p className="mt-3 text-xs text-slate-500">
                Chỉ hiện các nhóm lớn nhất; phần còn lại được gộp vào “Khác”.
              </p>
            )}
          </>
        )}
      </section>

      {data.data && data.data.rows.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Số liệu</h2>
          <TableWrap>
            <THead>
              <Tr>
                <Th>{data.data.dimensionLabel}</Th>
                <Th align="right">{data.data.measureLabel}</Th>
              </Tr>
            </THead>
            <TBody>
              {data.data.rows.map((row) => (
                <Tr key={row.label}>
                  <Td>{row.label}</Td>
                  <Td align="right">
                    <span className="tabular-nums">{row.value.toLocaleString('vi-VN')}</span>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </TableWrap>
        </section>
      )}

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Xoá báo cáo"
        confirmLabel="Xoá báo cáo"
        danger
        loading={remove.isPending}
        onConfirm={(onError) => {
          remove.mutate(reportId, { onSuccess: () => navigate('/'), onError });
        }}
      >
        Xoá <strong>{report.data?.name}</strong>? Bộ dữ liệu vẫn giữ nguyên, bạn dựng lại báo cáo
        khác từ nó được.
      </ConfirmDialog>
    </div>
  );
}

/**
 * Báo cáo chưa có biểu đồ — trạng thái ngay sau khi wizard tạo ra nó (§7.6).
 *
 * Nói rõ đây là bước tiếp theo chứ không phải lỗi, và nói luôn thứ chưa có.
 * Trình dựng biểu đồ (kéo thả) là phần việc sau; giấu điều đó đi thì người dùng
 * sẽ đi tìm một nút không tồn tại.
 */
function NotConfigured({ datasetName }: { datasetName: string }): React.ReactElement {
  return (
    <div className="py-10 text-center">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="mx-auto h-10 w-10 text-slate-300"
        aria-hidden="true"
      >
        <path d="M4 19V5m0 14h16M8 15V11m4 4V9m4 6v-3" />
      </svg>
      <p className="mt-3 text-sm font-medium text-slate-700">Báo cáo chưa có biểu đồ</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
        Bộ dữ liệu <span className="font-medium text-slate-700">{datasetName}</span> đã sẵn sàng.
        Trình dựng biểu đồ sẽ được bổ sung ở bước sau — khi có, bạn kéo thả cột vào đây để tạo
        biểu đồ.
      </p>
    </div>
  );
}

/**
 * Dựng spec Vega-Lite cho từng loại biểu đồ.
 *
 * `width: 'container'` để biểu đồ giãn theo thẻ cha. Nó chỉ hoạt động nhờ đoạn
 * CSS trong `index.css` đặt `.vega-embed { display: block }` NGOÀI `@layer` —
 * vega-embed tự tiêm `display: inline-block` lúc chạy, và inline-block co lại
 * vừa nội dung cộng với `width: container` là một vòng lặp phụ thuộc giải ra 0
 * pixel. Biểu đồ biến mất mà không có lỗi nào trong console.
 */
function buildSpec(chartType: ChartType, data: ReportDataDto): TopLevelSpec {
  const brand = readBrandColor('--color-brand-600', '#4f46e5');

  const base = {
    $schema: 'https://vega.github.io/schema/vega-lite/v6.json',
    width: 'container',
    height: 320,
    data: { values: [] },
    config: {
      axis: CHART_AXIS_CONFIG,
      view: { stroke: null },
    },
  } as const;

  if (chartType === 'pie') {
    return {
      ...base,
      mark: { type: 'arc', innerRadius: 60, tooltip: true },
      encoding: {
        theta: { field: 'value', type: 'quantitative', title: data.measureLabel },
        color: {
          field: 'label',
          type: 'nominal',
          title: data.dimensionLabel,
          scale: { scheme: 'tableau20' },
        },
      },
    } as TopLevelSpec;
  }

  const mark =
    chartType === 'line'
      ? ({ type: 'line', point: true, color: brand, tooltip: true } as const)
      : chartType === 'area'
        ? ({ type: 'area', color: brand, opacity: 0.85, tooltip: true } as const)
        : ({ type: 'bar', color: brand, cornerRadiusEnd: 3, tooltip: true } as const);

  return {
    ...base,
    mark,
    encoding: {
      x: {
        field: 'label',
        type: 'nominal',
        title: data.dimensionLabel,
        // Giữ nguyên thứ tự backend đã sắp (giảm dần theo giá trị). Để Vega tự
        // sắp thì nó xếp theo bảng chữ cái và cột "Khác" nhảy vào giữa.
        sort: null,
        axis: { labelAngle: -35, labelLimit: 120 },
      },
      y: { field: 'value', type: 'quantitative', title: data.measureLabel },
    },
  } as TopLevelSpec;
}
