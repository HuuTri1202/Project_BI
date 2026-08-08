import type { DailyCountPoint } from '@bi/shared';
import { useMemo } from 'react';
import type { TopLevelSpec } from 'vega-lite';
import { VegaChart } from '../../../components/charts/VegaChart';
import { CHART_AXIS_CONFIG, readBrandColor } from './theme';

interface NewMembersChartProps {
  data: DailyCountPoint[];
  rangeDays: number;
}

export default function NewMembersChart({
  data,
  rangeDays,
}: NewMembersChartProps): React.ReactElement {
  // Spec phải ổn định tham chiếu, nếu không `VegaChart` dựng lại view sau mỗi
  // lần render. Mảng phụ thuộc rỗng: spec không còn tham chiếu tới `rangeDays`
  // nữa (số nhãn trục do `labelOverlap` tự lo), và màu chỉ cần đọc một lần.
  const spec = useMemo<TopLevelSpec>(
    () => ({
      $schema: 'https://vega.github.io/schema/vega-lite/v6.json',
      // Rỗng có chủ ý: `VegaChart` ghi đè bằng prop `data`. Kiểu `TopLevelSpec`
      // bắt buộc phải có khoá này nên không bỏ đi được.
      data: { values: [] },
      width: 'container',
      height: 220,
      background: 'transparent',
      // Chừa lề phải: cột của ngày cuối cùng nằm sát mép và bị cắt mất một nửa
      // nếu không có khoảng này. Ngày cuối cũng là ngày hay có dữ liệu nhất.
      padding: { left: 0, top: 8, right: 10, bottom: 0 },
      // `band: 0.65` để giữa các cột có khe hở; sát nhau quá thì 30 ngày liền
      // nhau trông như một khối đặc.
      mark: { type: 'bar', cornerRadiusEnd: 2, tooltip: true, width: { band: 0.65 } },
      encoding: {
        x: {
          field: 'date',
          type: 'temporal',
          // `utcyearmonthdate` làm hai việc cùng lúc, cả hai đều cần:
          //
          //  1. Gộp theo NGÀY UTC. Backend đã gom theo ngày UTC (session MySQL
          //     ghim +00:00), nên nếu ở đây để Vega diễn giải theo giờ máy thì
          //     người dùng ở GMT+7 sẽ thấy số của ngày hôm trước.
          //  2. Đổi trục từ liên tục sang dạng dải. Trên trục thời gian liên
          //     tục, Vega không suy ra được bề rộng một cột nên vẽ ra sợi chỉ
          //     vài pixel — đúng cái đang thấy. Dải thì mỗi ngày một ô đều nhau.
          timeUnit: 'utcyearmonthdate',
          title: null,
          axis: {
            format: '%d/%m',
            labelAngle: 0,
            // 30 nhãn ngày cạnh nhau thì chữ chồng lên nhau. `labelOverlap:
            // 'greedy'` để Vega tự bỏ bớt nhãn cho tới khi không còn chồng —
            // tự điều chỉnh theo bề rộng thật, nên thu nhỏ cửa sổ trình duyệt
            // vẫn đọc được. Cách tự tính "giữ mỗi 5 nhãn" thì hỏng ngay khi
            // đổi rangeDays hoặc đổi kích thước màn hình.
            labelOverlap: 'greedy',
            grid: false,
          },
        },
        y: {
          field: 'count',
          type: 'quantitative',
          title: null,
          // Trục y phải là SỐ NGUYÊN: "1,5 thành viên mới" là vô nghĩa, và mặc
          // định Vega sẽ chia nhỏ như vậy khi giá trị lớn nhất bé.
          axis: { tickMinStep: 1, grid: true, gridDash: [2, 3] },
        },
        color: { value: readBrandColor('--color-brand-500', '#4f7ddb') },
      },
      config: {
        axis: CHART_AXIS_CONFIG,
        view: { stroke: null },
      },
    }),
    [],
  );

  return (
    <VegaChart
      spec={spec}
      data={data}
      ariaLabel={`Số thành viên mới theo từng ngày trong ${rangeDays} ngày gần nhất`}
      className="w-full"
    />
  );
}
