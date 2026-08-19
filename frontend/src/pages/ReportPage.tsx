import {
  CHART_TYPE_LABELS,
  REPORT_ERROR_CODES,
  REPORT_SOURCE_LABELS,
  type ChartType,
  type ReportDataDto,
} from '@bi/shared';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { TopLevelSpec } from 'vega-lite';
import { usePermissions } from '../auth/usePermissions';
import { VegaChart } from '../components/charts/VegaChart';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Page, PageBody, PageHeader } from '../components/ui/Page';
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
   * Bộ dữ liệu chưa vào kho phân tích — trạng thái bình thường, không phải lỗi.
   *
   * Phải khai SAU `data`, và đó là lý do nó không nằm cạnh `notConfigured`.
   */
  const notLoaded =
    data.isError && getApiError(data.error).error === REPORT_ERROR_CODES.DATASET_NOT_LOADED;

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
    <Page width="5xl">
      <PageHeader
        title={
          <>
            <Link to="/" className="font-normal text-brand-700 hover:underline">
              Trang chủ
            </Link>
            <span aria-hidden="true" className="mx-2 font-normal text-slate-300">
              /
            </span>
            {report.data?.name ?? 'Đang tải…'}
          </>
        }
        description={
          report.data ? (
            <span className="flex flex-wrap items-center gap-2">
              {report.data.chartType === null ? (
                <Badge tone="warning">Chưa có biểu đồ</Badge>
              ) : (
                <Badge tone="neutral">{CHART_TYPE_LABELS[report.data.chartType]}</Badge>
              )}
              <Badge tone="neutral">{REPORT_SOURCE_LABELS[report.data.source]}</Badge>
              <span>{report.data.sourceName}</span>
              <span>· {report.data.creatorName ?? 'Không rõ'}</span>
            </span>
          ) : undefined
        }
        actions={
          permissions.can('report', 'delete') && report.data ? (
            <Button variant="ghost" onClick={() => setConfirming(true)}>
              <span className="text-red-600">Xoá báo cáo</span>
            </Button>
          ) : undefined
        }
      />

      <PageBody>
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        {/* Báo cáo vừa được wizard tạo: chưa có biểu đồ, và đó là trạng thái
            bình thường. Nói rõ bước tiếp theo thay vì để một khung trống. */}
        {notConfigured && <NotConfigured sourceName={report.data?.sourceName ?? ''} />}

        {!notConfigured && data.isPending && <TableSkeleton rows={4} />}

        {/* Bộ dữ liệu chưa vào kho phân tích — trạng thái BÌNH THƯỜNG kéo dài
            vài giây sau khi tải file lên, không phải sự cố. Hộp đỏ ở đây dạy
            người dùng rằng hệ thống hay hỏng vặt, đúng cái bẫy mà khối
            `notConfigured` ngay trên đã tránh. Hook tự hỏi lại mỗi 3 giây nên
            biểu đồ tự hiện, không cần F5. */}
        {!notConfigured && notLoaded && (
          <p className="py-10 text-center text-sm text-slate-500">
            Đang nạp bộ dữ liệu vào kho phân tích… biểu đồ sẽ tự hiện khi xong.
          </p>
        )}

        {!notConfigured && !notLoaded && data.isError && (
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
              /* Người xem phải biết biểu đồ không hiện hết mọi nhóm, nếu không
                 họ sẽ đọc "5 nhóm lớn nhất" thành "toàn bộ dữ liệu".

                 Hai câu khác nhau, vì hai chuyện khác nhau: "Khác" chỉ tồn tại
                 khi phép tính CỘNG ĐƯỢC. Với tỉ lệ hay trung bình thì phần vượt
                 bị CẮT hẳn, và nói nó "được gộp vào Khác" là nói sai — người
                 xem sẽ tin rằng tổng trên biểu đồ vẫn là tổng của tất cả. */
              <p className="mt-3 text-xs text-slate-500">
                {hasOther(data.data)
                  ? 'Chỉ hiện các nhóm lớn nhất; phần còn lại được gộp vào “Khác”.'
                  : 'Chỉ hiện các nhóm lớn nhất — phép tính này không cộng được nên phần còn lại bị bỏ khỏi biểu đồ.'}
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
                    <span className="tabular-nums">{formatValue(row.value, data.data?.format)}</span>
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
      </PageBody>
    </Page>
  );
}

/**
 * Báo cáo chưa có biểu đồ — trạng thái ngay sau khi wizard tạo ra nó (§7.6).
 *
 * Nói rõ đây là bước tiếp theo chứ không phải lỗi, và nói luôn thứ chưa có.
 * Trình dựng biểu đồ (kéo thả) là phần việc sau; giấu điều đó đi thì người dùng
 * sẽ đi tìm một nút không tồn tại.
 */
/** Có dòng "Khác" thật hay chỉ bị cắt bớt — xem ghi chú ở chỗ gọi. */
function hasOther(data: ReportDataDto): boolean {
  return data.rows.at(-1)?.label === 'Khác';
}

/**
 * Con số trong bảng, đọc theo cách thước đo được khai.
 *
 * `'percent'` nhân 100 khi HIỂN THỊ, không đụng tới dữ liệu — cùng lập luận với
 * trục của biểu đồ.
 */
function formatValue(value: number, format: ReportDataDto['format']): string {
  if (format === 'percent') {
    return `${(value * 100).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} %`;
  }
  return value.toLocaleString('vi-VN');
}

/**
 * Chỉ báo cáo dựng trên BỘ DỮ LIỆU mới đi qua trạng thái này — báo cáo trên mô
 * hình ra đời là đã có biểu đồ (§10.8).
 */
function NotConfigured({ sourceName }: { sourceName: string }): React.ReactElement {
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
        Bộ dữ liệu <span className="font-medium text-slate-700">{sourceName}</span> đã sẵn sàng
        nhưng chưa chọn cột để vẽ.
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

  /*
   * Thước đo tỉ lệ: kho lưu 0,283 và trục phải đọc thành 28,3 % (§10.6).
   *
   * Đặt ở ĐỊNH DẠNG chứ không nhân 100 vào dữ liệu: nhân vào dữ liệu thì tooltip,
   * bảng số liệu bên dưới và câu SQL người dùng chép ra sẽ nói ba con số khác
   * nhau cho cùng một ô.
   */
  const valueAxis = data.format === 'percent' ? { format: '.1%' } : {};

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
        theta: {
          field: 'value',
          type: 'quantitative',
          title: data.measureLabel,
          ...(data.format === 'percent' ? { format: '.1%' } : {}),
        },
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
      y: { field: 'value', type: 'quantitative', title: data.measureLabel, axis: valueAxis },
    },
  } as TopLevelSpec;
}
