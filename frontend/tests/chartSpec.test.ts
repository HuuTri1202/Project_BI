import {
  CHART_PALETTE_COLORS,
  CHART_PALETTES,
  CHART_SORTS,
  CHART_TYPES,
  DEFAULT_CHART_PALETTE,
  normalizePalette,
  type ChartType,
  type ReportDataDto,
} from '@bi/shared';
import { compile } from 'vega-lite';
import { describe, expect, it } from 'vitest';

import { buildChartSpec } from '../src/features/reports/chartSpec';

/**
 * Mọi spec do trình dựng sinh ra phải BIÊN DỊCH ĐƯỢC.
 *
 * ═══ Vì sao đáng một file test riêng ════════════════════════════════════════
 *
 * `buildChartSpec` trả về `TopLevelSpec`, nhưng phần lớn nội dung của nó đi qua
 * một phép ép kiểu `as TopLevelSpec` — bắt buộc, vì spec được ghép từ nhiều
 * mảnh có điều kiện và TypeScript không lần được kiểu union khổng lồ của
 * Vega-Lite qua các phép spread đó. Nghĩa là trình biên dịch KHÔNG kiểm gì cả ở
 * đây.
 *
 * Hậu quả của một spec sai không phải một lỗi đỏ: `vegaEmbed` ném lỗi trong
 * `VegaChart`, component bắt lại và hiện "Không vẽ được biểu đồ". Người dùng
 * thấy một dòng chữ xám, console sạch sẽ, và không ai biết cấu hình nào vừa
 * hỏng. `compile()` ở đây là thứ duy nhất nói ra điều đó trước khi ai đó bấm.
 *
 * Tổ hợp được quét vì chúng đổi HÌNH DẠNG spec, không chỉ đổi giá trị:
 *   - một chuỗi so với nhiều chuỗi  -> có/không encoding `color`, có/không `stack`
 *   - xếp chồng so với đặt cạnh     -> có/không `xOffset` (và `yOffset` khi nằm ngang)
 *   - in số lên mark                -> spec một lớp trở thành spec `layer`
 *
 * Riêng lớp thứ ba là lý do trực tiếp file này tồn tại: `height: {step: …}` của
 * biểu đồ thanh ngang đi kèm `layer` là chỗ dễ vỡ nhất, và cũng là chỗ không
 * đọc code mà biết được.
 */

function fakeData(overrides: Partial<ReportDataDto> = {}): ReportDataDto {
  return {
    rows: [
      { label: 'Bắc', value: 120 },
      { label: 'Trung', value: 80 },
      { label: 'Nam', value: 210 },
    ],
    dimensionLabel: 'Khu vực',
    measureLabel: 'Doanh thu',
    grouped: false,
    ...overrides,
  };
}

const WITH_SERIES = fakeData({
  rows: [
    { label: 'Bắc', series: '2024', value: 120 },
    { label: 'Bắc', series: '2025', value: 140 },
    { label: 'Nam', series: '2024', value: 210 },
  ],
  seriesLabel: 'Năm',
});

/** Biểu đồ nào cũng phải chạy được với cả hai định dạng thước đo (§10.6). */
const PERCENT = fakeData({ format: 'percent' });

describe('buildChartSpec', () => {
  const drawable = CHART_TYPES.filter((t): t is Exclude<ChartType, 'table'> => t !== 'table');

  it('bảng số liệu KHÔNG sinh spec — nó vẽ bằng chính bảng bên dưới', () => {
    expect(buildChartSpec({ chartType: 'table', data: fakeData() })).toBeNull();
  });

  for (const chartType of drawable) {
    // Bản đồ nhiệt cần đủ hai chiều mới có ô để tô; trang chặn nó ở nút Lưu,
    // nên ở đây chỉ quét nó với dữ liệu nhiều chuỗi.
    const oneSeries = chartType !== 'heatmap';

    it(`${chartType}: biên dịch được với mọi tổ hợp tuỳ chọn`, () => {
      const cases = [
        ...(oneSeries
          ? [
              { data: fakeData(), options: undefined },
              ...CHART_SORTS.map((sort) => ({
                data: PERCENT,
                options: { sort, palette: 'dark' as const },
              })),
              { data: fakeData(), options: { showValues: true, showLegend: false } },
            ]
          : []),
        ...CHART_SORTS.map((sort) => ({ data: WITH_SERIES, options: { sort } })),
        { data: WITH_SERIES, options: { stacked: true } },
        { data: WITH_SERIES, options: { stacked: false } },
        { data: WITH_SERIES, options: { stacked: false, showValues: true } },
      ];

      for (const { data, options } of cases) {
        const spec = buildChartSpec({ chartType, data, options });
        expect(spec).not.toBeNull();

        /*
         * BẮT CẢ CẢNH BÁO, không chỉ lỗi ném ra.
         *
         * `compile` chỉ ném với spec hỏng về cấu trúc. Một encoding sai tên,
         * một thuộc tính không tồn tại, một `stack` đặt nhầm chỗ — tất cả chỉ
         * là `warn`, và spec vẫn biên dịch thành công. Đúng những thứ đó mới là
         * lỗi hay xảy ra ở một hàm ghép spec từ nhiều mảnh có điều kiện, nên
         * chỉ hỏi "có ném không" thì bài test này gần như không kiểm gì cả.
         */
        const noise: string[] = [];
        const logger = {
          level: () => logger,
          error: (...args: unknown[]) => {
            noise.push(`error: ${args.join(' ')}`);
            return logger;
          },
          warn: (...args: unknown[]) => {
            noise.push(`warn: ${args.join(' ')}`);
            return logger;
          },
          info: () => logger,
          debug: () => logger,
        };

        // Dữ liệu thật do `VegaChart` bơm vào lúc embed, nên spec khai `data`
        // rỗng — ở đây gắn dữ liệu mẫu vào để Vega-Lite suy được kiểu trường.
        expect(() =>
          compile(
            { ...spec!, data: { values: data.rows } },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- LoggerInterface của vega không xuất ra từ vega-lite
            { logger: logger as any },
          ),
        ).not.toThrow();

        /*
         * Đúng MỘT câu được bỏ qua, và nó được bỏ qua bằng cách so khớp toàn
         * văn — không phải bằng một bộ lọc rộng nuốt luôn cảnh báo thật.
         *
         * Biểu đồ thanh ngang và bản đồ nhiệt cao theo SỐ NHÓM (`height:
         * {step}`), trong khi `width: 'container'` bật `autosize: fit` cho cả
         * hai chiều. Vega-Lite hạ xuống `fit-x` và nói ra điều đó — đúng thứ ta
         * muốn. Xem chú thích ở `BAR_STEP`.
         */
        const real = noise.filter(
          (line) => line !== 'warn: Dropping "fit-y" because spec has discrete height.',
        );
        expect(real, `${chartType} với ${JSON.stringify(options)}`).toEqual([]);
      }
    });
  }

  it('không có chiều thứ hai thì KHÔNG sinh encoding màu theo chuỗi', () => {
    const spec = buildChartSpec({ chartType: 'bar', data: fakeData() }) as {
      encoding: { color?: unknown };
    };
    // Tô theo `series` khi mọi dòng đều không có trường đó cho ra một biểu đồ
    // một màu kèm chú giải "undefined" — sai kiểu vẫn vẽ ra được.
    expect(spec.encoding.color).toBeUndefined();
  });

  it('có chiều thứ hai thì trục giá trị xếp chồng, trừ khi bị tắt', () => {
    const stacked = buildChartSpec({ chartType: 'bar', data: WITH_SERIES }) as {
      encoding: { y: { stack?: unknown } };
    };
    expect(stacked.encoding.y.stack).toBeUndefined();

    const grouped = buildChartSpec({
      chartType: 'bar',
      data: WITH_SERIES,
      options: { stacked: false },
    }) as { encoding: { y: { stack?: unknown }; xOffset?: unknown } };
    // `stack: null` một mình KHÔNG tách các cột ra — thiếu `xOffset` thì mọi
    // chuỗi vẽ chồng lên nhau tại cùng một vị trí và biểu đồ trông như chỉ có
    // một chuỗi.
    expect(grouped.encoding.y.stack).toBeNull();
    expect(grouped.encoding.xOffset).toBeDefined();
  });

  /*
   * ─── Bốn cách sắp trục ───────────────────────────────────────────────
   *
   * Vòng quét ở trên chỉ nói "spec biên dịch được". Nó KHÔNG bắt được việc
   * hai lựa chọn khác nhau cùng sinh ra một spec — mà đó đúng là hình dạng
   * của lỗi ở đây: ô chọn có bốn dòng, bấm dòng nào biểu đồ cũng y hệt, và
   * không có gì đỏ ở đâu cả.
   */

  it('mặc định GIỮ NGUYÊN thứ tự backend trả về', () => {
    // `null` chứ không phải một phép sắp theo giá trị: dòng "Khác" là phần
    // còn lại, và ở thứ tự mặc định nó phải nằm cuối chứ không trôi theo
    // giá trị của mình.
    const spec = buildChartSpec({ chartType: 'bar', data: fakeData() }) as {
      encoding: { x: { sort?: unknown } };
    };

    expect(spec.encoding.x.sort).toBeNull();
  });

  it('bốn cách sắp cho ra BỐN spec khác nhau', () => {
    const specs = CHART_SORTS.map(
      (sort) =>
        buildChartSpec({ chartType: 'bar', data: fakeData(), options: { sort } }) as {
          encoding: { x: { sort?: unknown } };
        },
    );

    const nhan = specs.map((spec) => JSON.stringify(spec.encoding.x.sort ?? null));
    expect(new Set(nhan).size).toBe(CHART_SORTS.length);
  });

  it('theo tên: A → Z và Z → A', () => {
    const az = buildChartSpec({
      chartType: 'bar',
      data: fakeData(),
      options: { sort: 'label' },
    }) as { encoding: { x: { sort?: unknown } } };
    const za = buildChartSpec({
      chartType: 'bar',
      data: fakeData(),
      options: { sort: 'label-desc' },
    }) as { encoding: { x: { sort?: unknown } } };

    expect(az.encoding.x.sort).toBe('ascending');
    expect(za.encoding.x.sort).toBe('descending');
  });

  it('theo giá trị tăng dần sắp trên TỔNG của mỗi nhãn', () => {
    // Biểu đồ nhiều chuỗi có nhiều dòng cùng một nhãn. Đảo ngược mảng sẽ xếp
    // theo dòng đầu tiên bắt gặp — đúng với một chuỗi, sai với nhiều chuỗi.
    const spec = buildChartSpec({
      chartType: 'bar',
      data: WITH_SERIES,
      options: { sort: 'value-asc' },
    }) as { encoding: { x: { sort?: unknown } } };

    expect(spec.encoding.x.sort).toEqual({ field: 'value', op: 'sum', order: 'ascending' });
  });

  it('biểu đồ tròn cũng nghe ô sắp xếp — trước đây nó bỏ qua', () => {
    // Ô chọn hiện ra cho mọi loại biểu đồ. Một ô bấm mãi không thấy gì đổi là
    // chỗ người dùng kết luận trang bị hỏng.
    const theoGiaTri = buildChartSpec({
      chartType: 'pie',
      data: fakeData(),
      options: { sort: 'value-asc' },
    }) as { encoding: { order: { field: string; sort: string } } };
    const theoTen = buildChartSpec({
      chartType: 'pie',
      data: fakeData(),
      options: { sort: 'label-desc' },
    }) as { encoding: { order: { field: string; sort: string } } };

    expect(theoGiaTri.encoding.order).toMatchObject({ field: 'value', sort: 'ascending' });
    expect(theoTen.encoding.order).toMatchObject({ field: 'label', sort: 'descending' });
  });

  it('bảng màu ĐANG DÙNG đi vào spec bằng danh sách hex', () => {
    // Bộ chọn vẽ ra đúng dãy ô vuông này. Nếu spec lấy màu từ một nguồn
    // khác thì cái người dùng bấm và cái biểu đồ tô là hai thứ.
    const spec = buildChartSpec({
      chartType: 'pie',
      data: fakeData(),
      options: { palette: 'bright' },
    }) as { encoding: { color: { scale: { range?: string[]; scheme?: string } } } };

    expect(spec.encoding.color.scale.range).toEqual(CHART_PALETTE_COLORS.bright);
    expect(spec.encoding.color.scale.scheme).toBeUndefined();
  });

  it('bảng màu CŨ vẫn đi bằng tên scheme của Vega', () => {
    // Chép dãy màu của `tableau10` vào mã nguồn ta là hẹn giờ để một mã sai
    // làm đổi màu mọi báo cáo cũ, lặng lẽ. Để Vega tự tra tên là cách duy
    // nhất chắc chắn không đổi một pixel nào.
    const spec = buildChartSpec({
      chartType: 'pie',
      data: fakeData(),
      options: { palette: 'tableau10' },
    }) as { encoding: { color: { scale: { range?: string[]; scheme?: string } } } };

    expect(spec.encoding.color.scale.scheme).toBe('tableau10');
    expect(spec.encoding.color.scale.range).toBeUndefined();
  });

  it('`brand` không phân loại được nên rơi về bảng mặc định', () => {
    // Một biểu đồ tròn tô toàn một màu không còn lát cắt nào phân biệt được.
    const spec = buildChartSpec({
      chartType: 'pie',
      data: fakeData(),
      options: { palette: 'brand' },
    }) as { encoding: { color: { scale: { range?: string[] } } } };

    expect(spec.encoding.color.scale.range).toEqual(CHART_PALETTE_COLORS[DEFAULT_CHART_PALETTE]);
  });

  /* ─── Đổi TÊN bảng màu mà KHÔNG đổi một pixel nào — §10.12 ────────────────
   *
   * "Power BI" và "Xanh ngọc" là hai cái tên phải đi: cái đầu mượn tên một sản
   * phẩm khác ngay trong ứng dụng của người dùng, cái sau đặt tên cho đúng MỘT
   * ô trong tám ô. Nhưng báo cáo đã lưu mang những cái tên đó trong cột
   * `config`, nên ba ca dưới đây khoá chuyện chúng vẫn vẽ ra y hệt.
   */
  it('`powerbi` là TÊN CŨ của `bright` — cùng một dãy, không phải bản chép tay', () => {
    // Hai mảng riêng thì một mã sai sẽ lặng lẽ đổi màu mọi báo cáo cũ, và không
    // ai đối chiếu được với cái gì.
    expect(CHART_PALETTE_COLORS.powerbi).toBe(CHART_PALETTE_COLORS.bright);
  });

  it('`teal` giữ NGUYÊN dãy cũ — "Trầm dịu" là một bảng khác, không phải nó đổi tên', () => {
    const spec = buildChartSpec({
      chartType: 'pie',
      data: fakeData(),
      options: { palette: 'teal' },
    }) as { encoding: { color: { scale: { range?: string[] } } } };

    expect(spec.encoding.color.scale.range?.[0]).toBe('#00A19B');
    expect(spec.encoding.color.scale.range).not.toEqual(CHART_PALETTE_COLORS.muted);
  });

  it('bộ chọn tô sáng đúng bảng ĐANG VẼ cho một cấu hình cũ', () => {
    // Không quy tên cũ về tên mới thì mở một báo cáo cũ sẽ thấy bộ chọn tô sáng
    // một dòng "(cũ)" nằm ngay dưới một dòng vẽ giống hệt — hai lựa chọn trông
    // khác nhau cho cùng một kết quả.
    expect(normalizePalette('powerbi')).toBe('bright');
    expect(normalizePalette('brand')).toBe(DEFAULT_CHART_PALETTE);
    expect(normalizePalette(undefined)).toBe(DEFAULT_CHART_PALETTE);
    // `teal` KHÔNG được quy đổi: nó vẽ ra một dãy màu khác hẳn.
    expect(normalizePalette('teal')).toBe('teal');
  });

  it('mọi bảng CÒN ĐƯỢC MỜI đều có đủ màu và có câu gợi ý', () => {
    // Một dòng trong bộ chọn không có ô vuông nào là một dòng người dùng phải
    // chọn màu bằng cách đọc tên — đúng thứ §10.12 vừa dẹp.
    for (const palette of CHART_PALETTES) {
      expect(CHART_PALETTE_COLORS[palette]).toHaveLength(8);
    }
  });
  /* ─── Bảng màu đụng tới MỌI loại biểu đồ — §10.15 ────────────────────────
   *
   * Tới §10.14, biểu đồ một chuỗi tô bằng `--color-brand-600` và bản đồ nhiệt tô
   * bằng `scheme: 'blues'` — hai hằng số. Bộ chọn bảng màu bấm được, lưu được, mà
   * biểu đồ đứng yên:
   *
   *   "phần bảng màu … như biểu đồ cột lại ko thể thay đổi bảng màu"
   *
   * Bốn ca dưới đây khoá cả bốn nhánh màu: một chuỗi, nhiều chuỗi, bảng màu cũ
   * chỉ có tên scheme, và thang liên tục của bản đồ nhiệt.
   */
  const mauMark = (spec: unknown): unknown => (spec as { mark?: { color?: string } }).mark?.color;

  it('biểu đồ MỘT chuỗi tô bằng màu ĐẦU TIÊN của bảng đang chọn', () => {
    // Đây là ca người dùng gõ thẳng tên ra: biểu đồ cột, một chuỗi, đổi bảng
    // màu mà không thấy gì đổi.
    for (const chartType of ['bar', 'hbar', 'line', 'area', 'scatter'] as const) {
      const sang = buildChartSpec({ chartType, data: fakeData(), options: { palette: 'bright' } });
      const diu = buildChartSpec({ chartType, data: fakeData(), options: { palette: 'muted' } });

      expect(mauMark(sang), chartType).toBe(CHART_PALETTE_COLORS.bright?.[0]);
      expect(mauMark(diu), chartType).toBe(CHART_PALETTE_COLORS.muted?.[0]);
      expect(mauMark(sang), chartType).not.toBe(mauMark(diu));
    }
  });

  it('NHIỀU chuỗi thì màu do thang quyết định — mark không được mang màu cứng', () => {
    // Một màu cứng ở mark sẽ ĐÈ lên thang màu và mọi chuỗi tô cùng một màu.
    const spec = buildChartSpec({
      chartType: 'bar',
      data: WITH_SERIES,
      options: { palette: 'muted' },
    }) as { encoding: { color: { scale: { range?: string[] } } } };

    expect(mauMark(spec)).toBeUndefined();
    expect(spec.encoding.color.scale.range).toEqual(CHART_PALETTE_COLORS.muted);
  });

  it('bảng màu CŨ chỉ có tên scheme thì mark lấy màu đầu của bảng mặc định', () => {
    // `tableau10` là một cái tên chỉ Vega tra được — không có dãy hex nào để lấy
    // màu đầu. Rơi về mặc định chứ không vẽ ra một mark không màu.
    const spec = buildChartSpec({
      chartType: 'bar',
      data: fakeData(),
      options: { palette: 'tableau10' },
    });

    expect(mauMark(spec)).toBe(CHART_PALETTE_COLORS[DEFAULT_CHART_PALETTE]?.[0]);
  });

  it('bản đồ nhiệt: thang MỘT sắc độ, từ nhạt tới màu đầu của bảng', () => {
    // Màu ở đây mã hoá ĐỘ LỚN, nên thang phải đi một hướng. Hai đầu chứ không
    // phải tám màu: một thang phân loại thì không đọc ra được cái nào lớn hơn.
    const spec = buildChartSpec({
      chartType: 'heatmap',
      data: WITH_SERIES,
      options: { palette: 'muted' },
    }) as {
      layer: { encoding: { color: { scale: { range: string[]; interpolate: string } } } }[];
    };

    const scale = spec.layer[0]?.encoding.color.scale;
    expect(scale?.range).toHaveLength(2);
    expect(scale?.range[1]).toBe(CHART_PALETTE_COLORS.muted?.[0]);
    expect(scale?.interpolate).toBe('lab');
  });

  /* ─── Biểu đồ vừa KHUNG, không vừa dữ liệu — §10.13 ───────────────────────
   *
   * Ô trên khung cao theo LƯỚI; spec thì trước đây cao theo DỮ LIỆU. Chỗ nào
   * chênh nhau là chỗ bị cắt, và thứ bị cắt luôn là phần dưới cùng. Bốn ca dưới
   * đây khoá cả hai chiều: đo được thì vừa ô, không đo được thì y như cũ.
   */
  const cao = (spec: unknown): unknown => (spec as { height: unknown }).height;

  it('có `height` thì thanh NGANG thôi dài theo số nhóm', () => {
    // Đây là ca quan trọng nhất. `{step: 24}` × 20 nhóm = 480px trong một ô
    // 300px, tức mất hẳn 7 nhóm cuối mà không có gì báo.
    const nhieuNhom = fakeData({
      rows: Array.from({ length: 20 }, (_, k) => ({ label: `N${k}`, value: k })),
    });

    expect(cao(buildChartSpec({ chartType: 'hbar', data: nhieuNhom, height: 300 }))).toBe(300);
    // Không ai đo hộ thì vẫn dài theo số nhóm — trang xem một biểu đồ cuộn được.
    expect(cao(buildChartSpec({ chartType: 'hbar', data: nhieuNhom }))).toEqual({ step: 24 });
  });

  it('mọi loại khác cũng nhận đúng chiều cao được truyền', () => {
    for (const chartType of ['bar', 'line', 'area', 'scatter', 'pie', 'heatmap'] as const) {
      const data = chartType === 'heatmap' ? WITH_SERIES : fakeData();
      expect(cao(buildChartSpec({ chartType, data, height: 220 }))).toBe(220);
    }
  });

  it('chiều cao 0 hoặc âm bị BỎ QUA, không dựng ra một biểu đồ rỗng', () => {
    // 0 là giá trị thật của lượt render đầu tiên, trước khi `ReportChart` kịp đo.
    // Nhận nó nguyên xi là vẽ một SVG cao 0px rồi nhấp nháy sang chiều cao thật.
    expect(cao(buildChartSpec({ chartType: 'bar', data: fakeData(), height: 0 }))).toBe(340);
    expect(cao(buildChartSpec({ chartType: 'bar', data: fakeData(), height: -5 }))).toBe(340);
    // Dưới sàn thì kẹp lại: một ô 20px không còn chỗ nào cho mark.
    expect(cao(buildChartSpec({ chartType: 'bar', data: fakeData(), height: 20 }))).toBe(60);
  });

  it('vừa-khung khai `autosize: fit` — nếu không thì trục vẫn thò ra', () => {
    // Ca này khoá đúng thứ đã làm bản đầu của §10.13 trượt. Truyền chiều cao ô
    // vào là chưa đủ: `width: 'container'` chỉ bật fit cho chiều NGANG, nên chiều
    // dọc vẫn hiểu `height` là vùng dữ liệu và cộng thêm trục ra ngoài. Đo trên
    // trình duyệt: svg 487px trong một ô 445px, thò đúng 42px của trục dưới.
    const co = buildChartSpec({ chartType: 'hbar', data: fakeData(), height: 300 }) as {
      autosize?: unknown;
    };
    expect(co.autosize).toEqual({ type: 'fit', contains: 'padding' });

    // Chế độ cũ KHÔNG khai: ở đó chiều cao do dữ liệu quyết định, và ép fit sẽ
    // nén 30 nhóm vào 340px — đúng thứ biểu đồ thanh ngang sinh ra để tránh.
    const khong = buildChartSpec({ chartType: 'hbar', data: fakeData() }) as {
      autosize?: unknown;
    };
    expect(khong.autosize).toBeUndefined();
  });

  it('vừa-khung thì nhãn trục tự nhường chỗ; chế độ cũ thì KHÔNG', () => {
    // `labelOverlap` chỉ bỏ nhãn ĐANG đè lên nhau. Bật sẵn ở chế độ cũ là đổi
    // hình mọi biểu đồ đã lưu để chữa một chuyện chưa xảy ra ở đó.
    const truc = (spec: unknown): Record<string, unknown> =>
      (spec as { encoding: { y: { axis: Record<string, unknown> } } }).encoding.y.axis;

    expect(
      truc(buildChartSpec({ chartType: 'hbar', data: fakeData(), height: 300 })),
    ).toMatchObject({ labelOverlap: 'greedy' });
    expect(truc(buildChartSpec({ chartType: 'hbar', data: fakeData() }))).not.toHaveProperty(
      'labelOverlap',
    );
  });

  it('biểu đồ tròn mặc định KHÔNG đổi hình so với trước', () => {
    // Mọi báo cáo tròn đã lưu đều mang `sort: value` hoặc không mang gì.
    const macDinh = buildChartSpec({ chartType: 'pie', data: fakeData() }) as {
      encoding: { order: unknown };
    };

    expect(macDinh.encoding.order).toMatchObject({
      field: 'value',
      type: 'quantitative',
      sort: 'descending',
    });
  });
});
