import type { RoleBreakdownSlice } from '@bi/shared';
import { useMemo } from 'react';
import type { TopLevelSpec } from 'vega-lite';
import { VegaChart } from '../../../components/charts/VegaChart';
import { readBrandColor } from './theme';

/**
 * Cơ cấu nhân sự theo vai trò, dạng vành khuyên.
 *
 * Vì sao là biểu đồ THỨ HAI của trang tổng quan: "thành viên mới theo ngày" chỉ
 * có dữ liệu khi tổ chức đã hoạt động một thời gian — với tổ chức mới lập, nó là
 * một cột đơn độc và không nói lên điều gì. Phân bổ vai trò thì luôn có dữ liệu
 * ngay từ thành viên đầu tiên, nên trang không bao giờ trống.
 *
 * Vành khuyên chứ không phải hình tròn đặc: lỗ ở giữa để đặt tổng số, và mắt
 * người so sánh độ dài cung tốt hơn so sánh diện tích quạt.
 *
 * Chỉ ba lát nên biểu đồ tròn còn đọc được — quá năm sáu loại thì phải đổi sang
 * cột ngang. Ghi lại đây để ai thêm vai trò thứ tư còn biết ngưỡng.
 */

interface RoleBreakdownChartProps {
  data: RoleBreakdownSlice[];
}

export default function RoleBreakdownChart({ data }: RoleBreakdownChartProps): React.ReactElement {
  const spec = useMemo<TopLevelSpec>(() => {
    // Ba sắc độ cùng một tông thương hiệu, đậm dần theo mức quyền. Dùng ba màu
    // khác nhau (đỏ/vàng/xanh) sẽ ngụ ý "tốt/xấu", mà vai trò thì không có tốt
    // xấu — chỉ khác nhau về phạm vi.
    const shades = [
      readBrandColor('--color-brand-700', '#2f56a8'),
      readBrandColor('--color-brand-500', '#4f7ddb'),
      readBrandColor('--color-brand-200', '#b9cdf5'),
    ];

    return {
      $schema: 'https://vega.github.io/schema/vega-lite/v6.json',
      data: { values: [] },
      width: 'container',
      height: 220,
      background: 'transparent',
      mark: { type: 'arc', innerRadius: 58, outerRadius: 92, tooltip: true },
      encoding: {
        theta: { field: 'count', type: 'quantitative', stack: true },
        color: {
          field: 'label',
          type: 'nominal',
          // `sort` bám theo thứ tự backend trả về; thiếu nó Vega tự sắp theo
          // alphabet và màu sẽ nhảy chỗ mỗi khi số liệu đổi.
          sort: data.map((slice) => slice.label),
          scale: { range: shades },
          legend: {
            orient: 'right',
            title: null,
            labelColor: '#475569',
            labelFontSize: 12,
            symbolType: 'circle',
          },
        },
        order: { field: 'count', type: 'quantitative', sort: 'descending' },
      },
      view: { stroke: null },
    };
  }, [data]);

  const total = data.reduce((sum, slice) => sum + slice.count, 0);

  return (
    <div className="relative">
      <VegaChart
        spec={spec}
        data={data}
        ariaLabel="Phân bổ thành viên theo vai trò trong tổ chức"
        className="w-full"
      />
      {/* Tổng đặt vào lỗ vành khuyên. `pointer-events-none` để không chắn
          tooltip của Vega bên dưới. Lệch trái 46px vì phần chú giải chiếm bên
          phải, nên tâm hình vẽ không trùng tâm khung. */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="-translate-x-[46px] text-center">
          <p className="text-2xl font-bold tabular-nums text-slate-900">{total}</p>
          <p className="text-xs text-slate-400">thành viên</p>
        </div>
      </div>
    </div>
  );
}
