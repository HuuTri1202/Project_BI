// @vitest-environment node
import type { ChartType, ReportDataDto } from '@bi/shared';
import * as vega from 'vega';
import type { TopLevelSpec } from 'vega-lite';
import { compile } from 'vega-lite';
import { describe, expect, it } from 'vitest';

import { hamBieuThucVega, type DoChu } from '../src/components/charts/vegaExpr';
import { buildChartSpec } from '../src/features/reports/chartSpec';

/**
 * Nhãn trục nhóm trên một biểu đồ VẼ THẬT — §10.22.
 *
 * ═══ Vì sao phải vẽ, không đọc spec ═════════════════════════════════════════
 *
 * Luật "nằm ngang hay dựng đứng" không nằm trong spec dưới dạng một giá trị: nó
 * là biểu thức Vega tính lúc chạy từ thang `x` và độ rộng chữ. Đọc spec thì chỉ
 * thấy một chuỗi công thức. Nên ở đây đi đủ đường của `VegaChart` — Vega-Lite
 * biên dịch, Vega parse (có đăng ký hàm đo), dựng view, xuất SVG — rồi đo trục
 * X giống hệt cách đã đo lỗi trên Chromium: mỗi nhãn có hiện không, và nó có
 * nằm NGAY dưới vạch của cột mình không.
 *
 * Môi trường `node` chứ không `jsdom`: jsdom có `canvas.getContext` nhưng chỉ
 * để in "Not implemented", và Vega dò đúng hàm đó lúc nạp. Không có canvas thì
 * Vega đo chữ bằng ước lượng (0,8 × cỡ chữ × số ký tự) — rộng tay hơn chữ thật,
 * và giống nhau trên mọi máy.
 */

for (const [ten, fn] of Object.entries(hamBieuThucVega(vega.textMetrics as unknown as DoChu))) {
  vega.expressionFunction(ten, fn);
}
const doChu = vega.textMetrics as unknown as DoChu;

const DAI = Array.from(
  { length: 20 },
  (_, i) => `Chromcraft Training Table ${String(i + 1).padStart(2, '0')}`,
);

function duLieu(labels: readonly string[], series = false): ReportDataDto {
  return {
    rows: labels.flatMap((label, i) =>
      series
        ? [
            { label, series: 'Furniture', value: 20 - i },
            { label, series: 'Technology', value: 10 + i },
          ]
        : [{ label, value: 20 - i }],
    ),
    dimensionLabel: 'Product Name',
    measureLabel: 'Discount',
    ...(series ? { seriesLabel: 'Category' } : {}),
    grouped: false,
  };
}

interface Nhan {
  x: number;
  anchor: string | undefined;
  goc: number;
  hien: boolean;
  text: string;
}

/** Vạch và nhãn của trục X, đọc từ SVG Vega xuất ra. */
function trucX(svg: string): { vachs: number[]; nhans: Nhan[] } {
  const truc = svg.split('aria-label="X-axis')[1]?.split('role-axis-domain')[0] ?? '';
  const [phanVach = '', phanNhan = ''] = truc.split('role-axis-label');

  const vachs = [...phanVach.matchAll(/<line transform="translate\(([-\d.]+),/g)].map((m) =>
    Number(m[1]),
  );
  const nhans = [
    ...phanNhan.matchAll(
      /<text(?: text-anchor="(\w+)")? transform="translate\(([-\d.]+),[-\d.]+\)(?: rotate\(([-\d.]+)\))?[^"]*"[^>]*?opacity="([\d.]+)"[^>]*>([^<]*)<\/text>/g,
    ),
  ].map((m) => ({
    anchor: m[1],
    x: Number(m[2]),
    goc: (((Number(m[3] ?? 0) % 360) + 360) % 360) as number,
    hien: Number(m[4]) > 0,
    text: m[5] ?? '',
  }));
  return { vachs, nhans };
}

async function ve(
  chartType: ChartType,
  data: ReportDataDto,
  kichThuoc: { width: number; height: number },
): Promise<{ view: vega.View; svg: string }> {
  const spec = buildChartSpec({ chartType, data, ...kichThuoc }) as TopLevelSpec;
  const { spec: vg } = compile({
    ...spec,
    data: { name: 'bang', values: data.rows },
  } as TopLevelSpec);
  const view = new vega.View(vega.parse(vg), { renderer: 'none' });
  await view.runAsync();
  return { view, svg: await view.toSVG() };
}

/** Mọi nhãn hiện, và mỗi nhãn nằm đúng dưới vạch của cột mình. */
function duVaThang(svg: string, soNhom: number): Nhan[] {
  const { vachs, nhans } = trucX(svg);
  expect(vachs).toHaveLength(soNhom);
  expect(nhans).toHaveLength(soNhom);
  expect(nhans.filter((n) => !n.hien)).toEqual([]);
  nhans.forEach((n, i) => expect(Math.abs(n.x - (vachs[i] ?? NaN))).toBeLessThanOrEqual(1));
  return nhans;
}

describe('nhãn trục nhóm', () => {
  it('nhãn ngắn vừa cột thì nằm ngang, CĂN GIỮA dưới cột', async () => {
    const { svg } = await ve('bar', duLieu(['Bắc', 'Trung', 'Nam']), { width: 870, height: 300 });
    const nhans = duVaThang(svg, 3);

    for (const n of nhans) {
      expect(n.goc).toBe(0);
      // Thiếu `labelAlign` thì Vega-Lite để căn lề `null` và SVG hiểu là
      // `start`: chữ BẮT ĐẦU tại vạch, lệch nửa bề rộng sang phải.
      expect(n.anchor).toBe('middle');
    }
  });

  for (const series of [false, true]) {
    it(`20 tên dài trên 870px thì dựng đứng và hiện ĐỦ 20${series ? ' (có Nhóm màu)' : ''}`, async () => {
      // Đúng ô trong ảnh người dùng: "Discount theo Product Name", 20 cột. Trước
      // §10.22 nhãn nghiêng -35° và Chromium chỉ còn 6/20 tên, lệch 46px.
      const { svg } = await ve('bar', duLieu(DAI, series), { width: 870, height: 440 });
      const nhans = duVaThang(svg, 20);

      for (const n of nhans) {
        expect(n.goc).toBe(270);
        expect(n.anchor).toBe('end');
        expect(doChu.width({ font: 'sans-serif', fontSize: 10 }, n.text)).toBeLessThanOrEqual(120);
      }
    });
  }

  it('ô thấp thì nhãn dựng đứng ngắn lại, nhường chỗ cho cột', async () => {
    const { svg } = await ve('bar', duLieu(DAI.slice(0, 8)), { width: 300, height: 150 });
    const nhans = duVaThang(svg, 8);
    for (const n of nhans) {
      expect(n.goc).toBe(270);
      expect(doChu.width({ font: 'sans-serif', fontSize: 10 }, n.text)).toBeLessThanOrEqual(60);
    }
  });

  for (const chartType of ['line', 'area', 'scatter', 'heatmap'] as const) {
    it(`${chartType}: cùng một luật`, async () => {
      const ngan = await ve(chartType, duLieu(['Bắc', 'Trung', 'Nam'], true), {
        width: 870,
        height: 300,
      });
      expect(duVaThang(ngan.svg, 3).every((n) => n.goc === 0 && n.anchor === 'middle')).toBe(true);

      const dai = await ve(chartType, duLieu(DAI, true), { width: 870, height: 440 });
      expect(duVaThang(dai.svg, 20).every((n) => n.goc === 270)).toBe(true);
    });
  }

  it('bật in số (spec thành `layer`) vẫn đủ nhãn', async () => {
    const data = duLieu(DAI);
    const spec = buildChartSpec({
      chartType: 'bar',
      data,
      options: { showValues: true },
      width: 870,
      height: 440,
    }) as TopLevelSpec;
    const { spec: vg } = compile({
      ...spec,
      data: { name: 'bang', values: data.rows },
    } as TopLevelSpec);
    const view = new vega.View(vega.parse(vg), { renderer: 'none' });
    await view.runAsync();
    duVaThang(await view.toSVG(), 20);
  });

  it('đổi hướng ngay trong view đang sống — lật trang và co ô KHÔNG cần dựng lại', async () => {
    // `VegaChart` đẩy số liệu mới bằng `view.data` và kích thước mới bằng
    // `view.width` (§10.17). Luật nhãn phải theo kịp cả hai mà spec không đổi.
    const thang = Array.from({ length: 12 }, (_, i) => `Tháng ${String(i + 1)}`);
    const { view, svg } = await ve('bar', duLieu(thang), { width: 1200, height: 300 });
    expect(duVaThang(svg, 12).every((n) => n.goc === 0)).toBe(true);

    view.width(500);
    await view.runAsync();
    expect(duVaThang(await view.toSVG(), 12).every((n) => n.goc === 270)).toBe(true);

    view.width(1200);
    view.data('bang', duLieu(DAI.slice(0, 12)).rows);
    await view.runAsync();
    expect(duVaThang(await view.toSVG(), 12).every((n) => n.goc === 270)).toBe(true);

    view.data('bang', duLieu(thang).rows);
    await view.runAsync();
    expect(duVaThang(await view.toSVG(), 12).every((n) => n.goc === 0)).toBe(true);
  });
});

describe('hamBieuThucVega', () => {
  const doRong = hamBieuThucVega({ width: (_item, text) => text.length * 7 }).doRongNhanToiDa as (
    values: unknown,
    fontSize: number,
    font: string,
  ) => number;

  it('trả độ rộng của nhãn DÀI NHẤT', () => {
    expect(doRong(['Bắc', 'Office Supplies', 'Nam'], 10, 'sans-serif')).toBe(15 * 7);
  });

  it('miền rỗng hay không phải mảng thì 0 — trục chưa có nhóm nào', () => {
    expect(doRong([], 10, 'sans-serif')).toBe(0);
    expect(doRong(undefined, 10, 'sans-serif')).toBe(0);
  });
});
