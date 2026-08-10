import type { GrowthPoint } from '@bi/shared';
import { useMemo } from 'react';
import type { TopLevelSpec } from 'vega-lite';
import { VegaChart } from '../../../components/charts/VegaChart';
import { CHART_AXIS_CONFIG, readBrandColor } from './theme';

/**
 * Tăng trưởng theo ngày của ba loại: tổ chức, người dùng, workspace.
 *
 * Dữ liệu vào là dạng "rộng" (mỗi ngày một dòng, ba cột số) nhưng Vega-Lite vẽ
 * nhiều đường thì cần dạng "dài" (mỗi ngày × mỗi loại một dòng). Đổi hình ngay
 * trong component thay vì bắt backend trả sẵn dạng dài: dạng rộng gọn hơn trên
 * dây và dễ đọc hơn khi gỡ lỗi bằng mắt.
 *
 * Là số MỚI theo ngày chứ không phải luỹ kế. Biểu đồ luỹ kế lúc nào cũng đi lên
 * nên nhìn đâu cũng thấy "tăng trưởng tốt", kể cả khi đã hai tuần không ai đăng
 * ký — đúng loại biểu đồ tự lừa mình.
 */

interface GrowthChartProps {
  data: GrowthPoint[];
  rangeDays: number;
}

const SERIES = [
  { key: 'tenants', label: 'Tổ chức' },
  { key: 'users', label: 'Người dùng' },
  { key: 'workspaces', label: 'Workspace' },
] as const;

export default function GrowthChart({ data, rangeDays }: GrowthChartProps): React.ReactElement {
  const long = useMemo(
    () =>
      data.flatMap((point) =>
        SERIES.map((series) => ({
          date: point.date,
          loai: series.label,
          soLuong: point[series.key],
        })),
      ),
    [data],
  );

  const spec = useMemo<TopLevelSpec>(() => {
    const colors = [
      readBrandColor('--color-brand-700', '#2f56a8'),
      readBrandColor('--color-brand-400', '#7aa2e8'),
      '#10b981',
    ];

    return {
      $schema: 'https://vega.github.io/schema/vega-lite/v6.json',
      // Rỗng có chủ ý: `VegaChart` ghi đè bằng prop `data`. Kiểu `TopLevelSpec`
      // bắt buộc phải có khoá này nên không bỏ đi được.
      data: { values: [] },
      width: 'container',
      height: 260,
      background: 'transparent',
      mark: { type: 'line', point: true, tooltip: true, interpolate: 'monotone' },
      encoding: {
        x: {
          field: 'date',
          type: 'temporal',
          title: null,
          axis: { format: '%d/%m', labelAngle: 0, tickCount: Math.min(rangeDays, 8), grid: false },
        },
        y: {
          field: 'soLuong',
          type: 'quantitative',
          title: null,
          // Trục y phải là SỐ NGUYÊN: "1,5 tổ chức mới" là vô nghĩa, mà mặc định
          // Vega sẽ chia nhỏ như vậy khi giá trị lớn nhất bé.
          axis: { tickMinStep: 1, grid: true, gridDash: [2, 3] },
        },
        color: {
          field: 'loai',
          type: 'nominal',
          sort: SERIES.map((s) => s.label),
          scale: { range: colors },
          legend: { orient: 'top', title: null, labelColor: '#475569', labelFontSize: 12 },
        },
      },
      config: { axis: CHART_AXIS_CONFIG, view: { stroke: null } },
    };
  }, [rangeDays]);

  return (
    <VegaChart
      spec={spec}
      data={long}
      ariaLabel={`Số tổ chức, người dùng và workspace mới theo từng ngày trong ${rangeDays} ngày gần nhất`}
      className="w-full"
    />
  );
}
