import { CHART_PALETTE_COLORS, DEFAULT_CHART_PALETTE, type PaidOrdersPoint } from '@bi/shared';
import { useMemo } from 'react';
import type { TopLevelSpec } from 'vega-lite';

import { VegaChart } from '../../../components/charts/VegaChart';
import { dinhDangTien } from '../../billing/format';
import { CHART_AXIS_CONFIG } from './theme';

/**
 * Đơn đã thanh toán theo ngày, xếp chồng theo GÓI — trang Tổng quan của quản trị
 * hệ thống.
 *
 * ─── Cột xếp chồng, không phải đường ───────────────────────────────────────
 *
 * Mỗi ngày là một số ĐẾM rời (3 đơn, 0 đơn), và phần lớn các ngày là 0. Đường
 * nối hai ngày có đơn qua mười ngày trống vẽ ra một sườn dốc nói "doanh số tăng
 * dần" — điều không xảy ra. Cột thì ngày trống là khoảng trắng, đúng như nó là.
 * Xếp chồng vì câu hỏi đầu tiên là "hôm đó bán được bao nhiêu đơn", câu thứ hai
 * mới là "gói nào".
 *
 * ─── Màu đi theo GÓI, không theo thứ hạng ──────────────────────────────────
 *
 * Chuyên nghiệp luôn là màu đầu, Doanh nghiệp luôn là màu thứ hai, gói tự tạo
 * nối sau theo mã. Gán màu theo thứ tự xuất hiện trong dữ liệu thì tháng nào chỉ
 * bán gói Doanh nghiệp, gói đó đổi sang màu của Chuyên nghiệp — và người xem
 * quen mắt đọc sai.
 *
 * Doanh thu nằm trong tooltip chứ không thành trục thứ hai: hai thang đo trên
 * một biểu đồ là cách chắc chắn để người xem so nhầm hai con số không cùng đơn
 * vị. Tổng doanh thu cả kỳ đã có ở thẻ số phía trên.
 */

interface PaidOrdersChartProps {
  daily: PaidOrdersPoint[];
  /** Ngày UTC 'YYYY-MM-DD' của cả kỳ, cũ nhất trước — trục ngang trải đủ chừng này. */
  days: string[];
}

const PLAN_ORDER = ['pro', 'business'];
const MOT_NGAY = 86_400_000;

export default function PaidOrdersChart({ daily, days }: PaidOrdersChartProps): React.ReactElement {
  /** Tên gói theo đúng thứ tự gán màu — xem docblock. */
  const plans = useMemo(() => {
    const byCode = new Map<string, string>();
    for (const p of daily) byCode.set(p.planCode, p.planName);
    const codes = [...byCode.keys()].sort((a, b) => {
      const ia = PLAN_ORDER.indexOf(a);
      const ib = PLAN_ORDER.indexOf(b);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      return a.localeCompare(b);
    });
    return codes.map((code) => ({ code, name: byCode.get(code) ?? code }));
  }, [daily]);

  // Doanh thu định dạng sẵn kiểu Việt Nam (1.198.000 ₫). Vega chỉ biết dấu phẩy
  // ngăn nghìn kiểu Mỹ, và một con số tiền đọc ngược dấu là con số đọc sai.
  const rows = useMemo(
    () => daily.map((p) => ({ ...p, doanhThu: dinhDangTien(p.revenueVnd) })),
    [daily],
  );

  const first = days[0];
  const last = days.at(-1);

  const spec = useMemo<TopLevelSpec>(() => {
    const palette = CHART_PALETTE_COLORS[DEFAULT_CHART_PALETTE] ?? [];
    // Hai gói bán chính giữ CỐ ĐỊNH màu 0 và 1; gói lạ lấy từ màu 2 trở đi.
    const range = plans.map((p, i) => {
      const fixed = PLAN_ORDER.indexOf(p.code);
      return palette[fixed !== -1 ? fixed : PLAN_ORDER.length + i] ?? '#64748b';
    });

    const start = first === undefined ? undefined : Date.parse(`${first}T00:00:00Z`);
    const end = last === undefined ? undefined : Date.parse(`${last}T00:00:00Z`) + MOT_NGAY;

    return {
      $schema: 'https://vega.github.io/schema/vega-lite/v6.json',
      data: { values: [] },
      width: 'container',
      height: 240,
      background: 'transparent',
      // Viền trắng 1px tách hai khúc chồng lên nhau: hai khối màu dính liền thì
      // khúc nhỏ ở trên trông như một phần của khúc dưới.
      mark: { type: 'bar', tooltip: true, stroke: '#ffffff', strokeWidth: 1 },
      encoding: {
        x: {
          field: 'date',
          type: 'temporal',
          timeUnit: 'utcyearmonthdate',
          title: null,
          ...(start === undefined || end === undefined ? {} : { scale: { domain: [start, end] } }),
          axis: { format: '%d/%m', labelAngle: 0, tickCount: 8, grid: false },
        },
        y: {
          field: 'orders',
          type: 'quantitative',
          title: null,
          stack: 'zero',
          // "1,5 đơn" là vô nghĩa — mặc định Vega sẽ chia như vậy khi cột cao nhất bé.
          axis: { tickMinStep: 1, grid: true, gridDash: [2, 3] },
        },
        color: {
          field: 'planName',
          type: 'nominal',
          scale: { domain: plans.map((p) => p.name), range },
          // Chú giải luôn có khi hai gói trở lên — màu không bao giờ là thứ duy
          // nhất nói cột nào của gói nào.
          legend:
            plans.length > 1
              ? { orient: 'top', title: null, labelColor: '#475569', labelFontSize: 12 }
              : null,
        },
        tooltip: [
          {
            field: 'date',
            type: 'temporal',
            timeUnit: 'utcyearmonthdate',
            title: 'Ngày (UTC)',
            format: '%d/%m/%Y',
          },
          { field: 'planName', type: 'nominal', title: 'Gói' },
          { field: 'orders', type: 'quantitative', title: 'Số đơn' },
          { field: 'doanhThu', type: 'nominal', title: 'Doanh thu' },
        ],
      },
      config: { axis: CHART_AXIS_CONFIG, view: { stroke: null } },
    } as TopLevelSpec;
  }, [plans, first, last]);

  return (
    <VegaChart
      spec={spec}
      data={rows}
      ariaLabel={`Số đơn đã thanh toán theo từng ngày và từng gói trong ${days.length} ngày gần nhất`}
      className="w-full"
    />
  );
}
