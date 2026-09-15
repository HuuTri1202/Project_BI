import {
  CHART_PALETTE_COLORS,
  DEFAULT_CHART_PALETTE,
  CHART_VALUE_LABELS,
  type ChartPalette,
  type ChartType,
  type ReportChartOptionsDto,
  type ReportDataDto,
} from '@bi/shared';
import type { TopLevelSpec } from 'vega-lite';

import { CHART_AXIS_CONFIG } from '../admin/charts/theme';

/**
 * Dựng spec Vega-Lite cho một báo cáo — §10.9.
 *
 * ═══ MỘT hàm, hai màn hình ═══════════════════════════════════════════════════
 *
 * Trước bản này hàm dựng spec nằm ngay trong `ReportPage`. Trình dựng biểu đồ
 * cần đúng hàm đó — nó tồn tại để cho xem TRƯỚC thứ trang Report sẽ vẽ. Chép
 * sang một bản thứ hai là hẹn trước một lỗi: hai bản sẽ trôi khỏi nhau ở một
 * chi tiết nhỏ (một `sort`, một `cornerRadius`), và triệu chứng sẽ là "xem
 * trước một đằng, lưu xong một nẻo" — kiểu lỗi phá lòng tin vào cả hai màn.
 *
 * Cùng lập luận với `modelReportData.ts` phía backend, nơi báo cáo và Explorer
 * dùng chung `runExplorerQuery` để không cho ra hai con số khác nhau.
 *
 * ═══ Vì sao nhận `ReportDataDto` chứ không nhận dòng thô ════════════════════
 *
 * Vì đó là thứ CẢ HAI bên có: trang Report lấy từ `GET /reports/:id/data`, còn
 * trình dựng lấy từ `POST /datamodels/:id/report-preview` — và endpoint thứ hai
 * cố ý gọi đúng hàm tổng hợp của endpoint thứ nhất. Nhãn trục, cờ "đã cắt" và
 * cách một ô trống được đặt tên vì vậy giống nhau tuyệt đối.
 *
 * ⚠️ Kết quả PHẢI được `useMemo` ở nơi gọi. `VegaChart` dựng lại toàn bộ view
 * mỗi khi tham chiếu `spec` đổi, nên gọi thẳng trong JSX là dựng lại biểu đồ
 * sau mỗi lần render — nhấp nháy liên tục và rò bộ nhớ.
 */

/**
 * Bảng màu CŨ vẫn vẽ bằng tên scheme của Vega, không phải danh sách hex.
 *
 * Chép lại đúng dãy màu của `tableau10`/`pastel1`/`dark2` vào đây thì chỉ cần
 * sai một mã là mọi báo cáo đang dùng chúng đổi màu — lặng lẽ, và không ai đối
 * chiếu được với cái gì. Để Vega tự tra tên là cách duy nhất chắc chắn không
 * đổi một pixel nào của những báo cáo ấy.
 */
const LEGACY_SCHEMES: Partial<Record<ChartPalette, string>> = {
  tableau10: 'tableau10',
  tableau20: 'tableau20',
  pastel: 'pastel1',
  dark: 'dark2',
};

/**
 * Đầu NHẠT của thang bản đồ nhiệt. Đầu đậm là màu đầu tiên của bảng màu.
 *
 * Trước §10.15 cả thang là `scheme: 'blues'` của Vega — một cái tên cứng, nên
 * bản đồ nhiệt là loại biểu đồ duy nhất không nghe theo bảng màu người dùng
 * chọn. Giờ nó nghe, nhưng vẫn là một thang MỘT SẮC ĐỘ đi từ nhạt tới đậm:
 * màu ở đây mã hoá ĐỘ LỚN của con số, và một thang nhiều hướng màu thì không
 * đọc ra được cái nào lớn hơn cái nào.
 *
 * Nội suy trong không gian `lab` chứ không phải `rgb`: `rgb` trộn thẳng ba kênh
 * nên khúc giữa của thang xám và tối hơn hẳn hai đầu, tức hai ô có giá trị khác
 * nhau lại trông đậm ngang nhau.
 */
const HEATMAP_LOW = '#f1f5f9';

/**
 * Chiều cao khi KHÔNG ai nói ô cao bao nhiêu.
 *
 * Số cứng chứ không `'container'`: `height: 'container'` chỉ hoạt động khi thẻ
 * bọc có chiều cao xác định, mà khung xem trước lại cao theo nội dung. Vòng phụ
 * thuộc đó trình duyệt giải ra 0 — cùng cái bẫy đã hạ `width` xuống 0px và được
 * chữa bằng đoạn `.vega-embed` trong `index.css`.
 *
 * Nơi gọi nào ĐO được ô của mình thì truyền `height` và số này không dùng tới —
 * xem `fit` bên dưới.
 */
const HEIGHT = 340;

/**
 * Sàn của chế độ vừa-khung.
 *
 * Một ô cao `CANVAS_MIN_H` hàng còn lại chừng 90px cho phần vẽ, nhưng người
 * dùng vẫn thu được nhỏ hơn thế trong lúc kéo tay nắm. Dưới sàn này Vega dựng
 * ra một biểu đồ có trục mà không còn chỗ nào cho mark; thà để nó thò ra vài
 * chục pixel còn hơn vẽ một hình rỗng.
 */
const MIN_FIT = 60;

/**
 * Dưới ngưỡng này thì bỏ TIÊU ĐỀ TRỤC — §10.16.
 *
 * Hai con số, hai chiều, vì tiêu đề trục ăn chỗ theo phương VUÔNG GÓC với trục
 * nó đặt tên: tên trục ngang nằm bên dưới nên nó ăn chiều CAO; tên trục dọc
 * quay nghiêng bên trái nên nó ăn chiều NGANG.
 *
 * Đo trên trình duyệt thật (mọi số đều rộng×cao), một ô vẽ 195×109 — nhỏ nhất
 * mà lưới cho phép. Phần VẼ DỮ LIỆU ở đó chỉ còn 122×28px: một phần tư chiều
 * cao, phần còn lại là trục, nhãn, và hai cái tên nhắc lại đúng những chữ đã
 * có sẵn trên tiêu đề ô ("Quantity theo Category").
 *
 * Bỏ hai cái tên ấy đi thì vùng vẽ thành 136×43 — CAO THÊM 54%. Một ô 870×277
 * nằm trên cả hai ngưỡng nên không đổi một pixel nào.
 *
 * Ngưỡng đặt ở chỗ tỉ lệ đó bắt đầu vô lý, không phải ở chỗ chữ khó đọc: ô lớn
 * thì tên trục vẫn đáng có, vì ô có thể bị đổi tên thành một câu không nhắc tới
 * trường nào.
 */
const TEN_TRUC_CAO = 200;
const TEN_TRUC_NGANG = 320;

/**
 * Bề dày một thanh của biểu đồ ngang. Trục dọc dài ra theo SỐ NHÓM.
 *
 * ⚠️ `height: {step}` đi cùng `width: 'container'` sinh ra một cảnh báo của
 * Vega-Lite: *Dropping "fit-y" because spec has discrete height*. Nó là ĐÚNG và
 * vô hại — `width: 'container'` bật `autosize: fit` cho cả hai chiều, còn chiều
 * cao ở đây do dữ liệu quyết định chứ không do khung chứa, nên Vega-Lite hạ
 * xuống `fit-x`. Đó chính xác là thứ ta muốn.
 *
 * Khai thẳng `autosize: {type: 'fit-x'}` KHÔNG dập được cảnh báo (nhánh cảnh
 * báo chạy cho mọi kiểu `fit-*`) và cho ra spec biên dịch giống hệt — đã đo. Nên
 * đừng thêm nó vào: một dòng cấu hình không đổi được gì là một dòng người đọc
 * sau phải mất công tìm hiểu. `tests/chartSpec.test.ts` bỏ qua đúng một câu này
 * và bắt mọi cảnh báo khác.
 */
const BAR_STEP = 24;

export interface ChartSpecInput {
  chartType: ChartType;
  data: ReportDataDto;
  options?: ReportChartOptionsDto | undefined;
  /**
   * Chiều cao thật của chỗ sẽ vẽ, tính bằng pixel — §10.13.
   *
   * ═══ Vì sao spec phải biết con số này ═══════════════════════════════════
   *
   * Ô trên khung cao theo LƯỚI (`h` hàng × 44px), còn spec trước đây khai
   * chiều cao theo DỮ LIỆU: 340px cho mọi loại, và thanh ngang thì 24px một
   * nhóm nên 20 nhóm là 480px. Hai con số ấy không liên quan gì nhau, nên
   * biểu đồ thường xuyên cao hơn ô — và phần thò ra bị cắt. Người dùng thấy
   * một biểu đồ mất mấy nhóm cuối mà không có gì báo là nó đã mất.
   *
   * Truyền chiều cao vào đây thì Vega tự chia lại: `autosize: fit` (bật sẵn
   * bởi `width: 'container'`) coi con số này là chiều cao TỔNG của SVG và co
   * vùng vẽ lại để chừa chỗ cho trục. Ô nhỏ thì thanh mảnh đi, không nhóm nào
   * biến mất.
   *
   * `undefined` = nơi gọi không đo được (trang xem một biểu đồ cao theo nội
   * dung). Ở đó `HEIGHT` và bước 24px vẫn đúng như trước.
   */
  height?: number | undefined;
  /**
   * Bề ngang thật của chỗ sẽ vẽ, tính bằng pixel — §10.16.
   *
   * ═══ Vì sao `width: 'container'` KHÔNG đủ ═══════════════════════════════════
   *
   * `'container'` bảo vega-embed tự đo thẻ bọc. Nó đo đúng — MỘT LẦN, lúc dựng
   * view — rồi từ đó chỉ đo lại khi `window` phát sự kiện `resize`. Cái ô trên
   * khung thì hẹp lại mà cửa sổ không đổi một pixel nào:
   *
   *   kéo tay nắm co giãn        ô 870px -> 195px
   *   gấp một cột bên (§10.15)   cả hàng ô rộng thêm 480px
   *
   * Đo được trên trình duyệt thật: vùng vẽ còn 109x195 mà SVG vẫn 109x870 —
   * 675px biểu đồ nằm ngoài ô và bị `overflow-hidden` cắt đi. Đúng thứ §10.13
   * chữa cho chiều cao, còn sót lại nguyên vẹn ở chiều ngang.
   *
   * Nên nơi nào ĐO ĐƯỢC thì truyền cả hai chiều vào đây, và Vega nhận một con
   * số thay vì một lời hứa. `undefined` giữ nguyên `'container'` — đúng cho
   * trang xem một biểu đồ, nơi bề ngang chỉ đổi khi cửa sổ đổi.
   */
  width?: number | undefined;
}

/** `null` = loại này không vẽ bằng Vega (bảng số liệu). */
export function buildChartSpec({
  chartType,
  data,
  options,
  height,
  width,
}: ChartSpecInput): TopLevelSpec | null {
  if (chartType === 'table') return null;

  const opts = options ?? {};

  /** Ô có tự khai chiều cao không — xem `height` ở trên. */
  const fit = typeof height === 'number' && height > 0;
  const boxHeight = fit ? Math.max(Math.round(height), MIN_FIT) : HEIGHT;

  /*
   * Bề ngang đo được thì dùng SỐ, không dùng `'container'` — xem `width` ở trên.
   *
   * Hai chiều tách nhau vì chúng hỏng theo hai kiểu khác nhau, và một nơi gọi
   * có thể đo được chiều này mà không đo được chiều kia. Khung hình ĐẦU TIÊN
   * cũng rơi vào đây: `useLayoutEffect` đo trước khi trình duyệt vẽ, nhưng nếu
   * vì lý do nào đó chưa có số thì `'container'` vẫn là đường lui đúng.
   */
  const boxWidth =
    typeof width === 'number' && width > 0 ? Math.max(Math.round(width), MIN_FIT) : null;
  const vungNgang = { width: boxWidth ?? ('container' as const) };

  /**
   * `height` là chiều cao TỔNG của SVG, không phải của vùng vẽ.
   *
   * ─── Vì sao phải khai ra, chứ không để mặc định ────────────────────────────
   *
   * `width: 'container'` bật `autosize` cho ĐÚNG chiều ngang (`fit-x`), vì chỉ
   * chiều đó khai `'container'`. Chiều dọc giữ nghĩa mặc định: `height` là chiều
   * cao của HÌNH CHỮ NHẬT DỮ LIỆU, còn trục và nhãn được cộng thêm bên ngoài.
   *
   * Nên truyền đúng chiều cao ô vào vẫn ra một SVG cao hơn ô — đo được 487px
   * trong một vùng vẽ 445px, tức thò ra đúng 42px của trục dưới. Bằng đúng chỗ
   * cũ, và đúng cái lỗi §10.13 sinh ra để chữa.
   *
   * `contains: 'padding'` để con số bao trọn cả phần đệm quanh biểu đồ — nếu
   * không thì vẫn còn dư mấy pixel thò ra.
   */
  const vuaKhung = fit ? { autosize: { type: 'fit', contains: 'padding' } as const } : {};

  /**
   * Vừa-khung thì nhãn nhóm phải TỰ NHƯỜNG nhau chỗ.
   *
   * Trục nhóm là thang band, mà mặc định của Vega-Lite ở thang đó là
   * `labelOverlap: false` — mọi nhãn đều được vẽ, kể cả khi chúng đè lên nhau
   * thành một vệt xám. Trước §10.13 điều đó vô hại vì trục dài ra theo số
   * nhóm; giờ trục bị nhốt trong ô nên 20 nhãn có thể phải chen vào 200px.
   *
   * `greedy` chỉ bỏ đúng những nhãn ĐANG đè lên nhau, nên nơi còn chỗ thì
   * không mất gì. Không bật ở chế độ cũ: ở đó không có nhãn nào phải chen.
   */
  const denseLabels = fit ? { labelOverlap: 'greedy' as const } : {};

  /*
   * Ô nhỏ thì dữ liệu được ưu tiên hơn tên trục — xem `TEN_TRUC_CAO`.
   *
   * Chỉ ở chế độ vừa-khung: ngoài đó biểu đồ tự khai chiều cao của mình nên
   * không có ai phải nhường chỗ cho ai.
   */
  const tenDuoi = (label: string): string | null =>
    fit && boxHeight < TEN_TRUC_CAO ? null : label;
  const tenTrai = (label: string): string | null =>
    fit && boxWidth !== null && boxWidth < TEN_TRUC_NGANG ? null : label;

  const multi = hasSeries(data);

  /*
   * Thước đo tỉ lệ: kho lưu 0,283 và trục phải đọc thành 28,3 % (§10.6).
   *
   * Đặt ở ĐỊNH DẠNG chứ không nhân 100 vào dữ liệu: nhân vào dữ liệu thì
   * tooltip, bảng số liệu bên dưới và câu SQL người dùng chép ra sẽ nói ba con
   * số khác nhau cho cùng một ô.
   */
  const valueFormat = data.format === 'percent' ? '.1%' : undefined;
  const valueAxis = valueFormat === undefined ? {} : { format: valueFormat };

  const base = {
    $schema: 'https://vega.github.io/schema/vega-lite/v6.json',
    ...vungNgang,
    data: { values: [] },
    config: {
      axis: CHART_AXIS_CONFIG,
      view: { stroke: null },
      legend: { labelColor: '#475569', titleColor: '#334155' },
    },
  } as const;

  // ─── Biểu đồ tròn: một trục duy nhất, và trục đó là màu ────────────────────
  if (chartType === 'pie') {
    return {
      ...base,
      ...vuaKhung,
      height: boxHeight,
      mark: { type: 'arc', innerRadius: 60, tooltip: true },
      encoding: {
        theta: { field: 'value', type: 'quantitative', title: data.measureLabel },
        color: {
          field: 'label',
          type: 'nominal',
          title: data.dimensionLabel,
          scale: colorScaleFor(opts.palette),
          ...(opts.showLegend === false ? { legend: null } : {}),
        },
        // Lát cắt đi theo đúng thứ tự backend trả về. Không khai `order` thì
        // Vega xếp theo bảng chữ cái và lát "Khác" nhảy vào giữa vòng tròn.
        //
        // Vòng tròn không có trục, nhưng ô "Sắp xếp trục" vẫn hiện ra cho loại
        // này — nên nó phải có tác dụng. Trước bản này nó không, kể cả với
        // `'label'` vốn đã có từ §10.9: một ô chọn bấm mãi không thấy gì đổi.
        ...pieOrder(opts, data.measureLabel),
        tooltip: tooltipOf(data, ['label', 'value'], valueFormat),
      },
    } as TopLevelSpec;
  }

  // ─── Bản đồ nhiệt: hai chiều bắt chéo, giá trị là ĐỘ ĐẬM ───────────────────
  if (chartType === 'heatmap') {
    const cells = {
      mark: { type: 'rect', tooltip: true },
      encoding: {
        color: {
          field: 'value',
          type: 'quantitative',
          title: data.measureLabel,
          scale: { range: [HEATMAP_LOW, markColorFor(opts.palette)], interpolate: 'lab' },
          ...(opts.showLegend === false
            ? { legend: null }
            : valueFormat === undefined
              ? {}
              : { legend: { format: valueFormat } }),
        },
        tooltip: tooltipOf(data, ['label', 'series', 'value'], valueFormat),
      },
    };

    return {
      ...base,
      ...vuaKhung,
      // Bản đồ nhiệt cao theo SỐ CHUỖI khi không ai đo hộ; đo được thì vừa ô.
      height: fit ? boxHeight : { step: BAR_STEP + 6 },
      encoding: {
        x: {
          field: 'label',
          type: 'nominal',
          title: tenDuoi(data.dimensionLabel),
          sort: sortOf(opts),
          axis: { labelAngle: -35, labelLimit: 120, ...denseLabels },
        },
        y: {
          field: 'series',
          type: 'nominal',
          title: tenTrai(data.seriesLabel ?? ''),
          sort: 'ascending',
          axis: denseLabels,
        },
      },
      layer: opts.showValues === true ? [cells, valueLayer(valueFormat, '#0f172a', {})] : [cells],
    } as TopLevelSpec;
  }

  // ─── Bốn loại còn lại: một trục nhóm, một trục giá trị ─────────────────────
  const horizontal = chartType === 'hbar';
  const mau = markColorFor(opts.palette);

  const groupAxis = {
    field: 'label',
    type: 'nominal' as const,
    // Trục nhóm của biểu đồ NGANG là trục dọc, nên tên nó ăn bề ngang; của bốn
    // loại kia là trục ngang, nên tên nó ăn chiều cao.
    title: horizontal ? tenTrai(data.dimensionLabel) : tenDuoi(data.dimensionLabel),
    sort: sortOf(opts),
    // Nằm ngang thì nhãn có cả chiều rộng để trải ra, nên không xoay và cho
    // gấp đôi chỗ. Đó chính là lý do loại này tồn tại bên cạnh biểu đồ cột.
    axis: horizontal
      ? { labelLimit: 220, ...denseLabels }
      : { labelAngle: -35, labelLimit: 120, ...denseLabels },
  };

  /*
   * Xếp chồng hay đặt cạnh nhau.
   *
   * `stack: null` KHÔNG tự tách các mark ra — nó chỉ tắt việc cộng dồn, và cột
   * của mọi chuỗi sẽ chồng lên nhau ở cùng một vị trí. `xOffset` mới là thứ đẩy
   * chúng sang bên cạnh. Thiếu nó thì biểu đồ trông như chỉ có một chuỗi: chuỗi
   * cao nhất che hết phần còn lại.
   */
  const stacked = opts.stacked !== false;
  const stackable = chartType === 'bar' || chartType === 'hbar' || chartType === 'area';

  const valueAxisSpec = {
    field: 'value',
    type: 'quantitative' as const,
    // Ngược lại với `groupAxis` — hai trục luôn vuông góc nhau.
    title: horizontal ? tenDuoi(data.measureLabel) : tenTrai(data.measureLabel),
    axis: valueAxis,
    ...(multi && stackable && !stacked ? { stack: null } : {}),
  };

  const offsetKey = horizontal ? 'yOffset' : 'xOffset';
  const offset =
    multi && !stacked && (chartType === 'bar' || chartType === 'hbar')
      ? { [offsetKey]: { field: 'series', type: 'nominal' as const } }
      : {};

  const color = multi
    ? {
        color: {
          field: 'series',
          type: 'nominal' as const,
          title: data.seriesLabel ?? '',
          scale: colorScaleFor(opts.palette),
          ...(opts.showLegend === false ? { legend: null } : {}),
        },
      }
    : {};

  const mark =
    chartType === 'line'
      ? { type: 'line' as const, point: true, tooltip: true, ...(multi ? {} : { color: mau }) }
      : chartType === 'area'
        ? {
            type: 'area' as const,
            tooltip: true,
            // Chồng lên nhau thì phải nhìn xuyên được, nếu không miền vẽ sau
            // xoá hẳn miền vẽ trước khỏi màn hình.
            opacity: multi && !stacked ? 0.55 : 0.85,
            ...(multi ? {} : { color: mau }),
          }
        : chartType === 'scatter'
          ? {
              type: 'point' as const,
              filled: true,
              size: 110,
              tooltip: true,
              ...(multi ? {} : { color: mau }),
            }
          : {
              type: 'bar' as const,
              tooltip: true,
              cornerRadiusEnd: 3,
              ...(multi ? {} : { color: mau }),
            };

  const tooltip = {
    tooltip: tooltipOf(
      data,
      multi ? ['label', 'series', 'value'] : ['label', 'value'],
      valueFormat,
    ),
  };

  const encoding = horizontal
    ? { y: groupAxis, x: valueAxisSpec, ...offset, ...color, ...tooltip }
    : { x: groupAxis, y: valueAxisSpec, ...offset, ...color, ...tooltip };

  const layers: object[] = [{ mark, encoding }];

  // Con số in lên mark. Chỉ vài loại làm được — xem `CHART_VALUE_LABELS` và chú
  // thích ở `valueLayer`.
  if (opts.showValues === true && CHART_VALUE_LABELS.includes(chartType)) {
    // Dựng lại VỊ TRÍ từ chính ba mảnh đã dùng cho mark, cố ý bỏ `color`: chữ
    // nhỏ nên một màu đậm đọc rõ hơn bảy màu, và giữ `color` ở đây còn kéo theo
    // một chú giải thứ hai chỉ để chú thích cho lớp chữ.
    const position = horizontal
      ? { y: groupAxis, x: valueAxisSpec, ...offset }
      : { x: groupAxis, y: valueAxisSpec, ...offset };
    layers.push(valueLayer(valueFormat, '#334155', position));
  }

  return {
    ...base,
    ...vuaKhung,
    /* Thanh ngang cao theo SỐ NHÓM — nhưng chỉ khi không ai nói ô cao bao
       nhiêu. 30 nhóm nhồi vào 340px thì mỗi thanh dày 8px và nhãn chồng lên
       nhau, đúng thứ loại biểu đồ này sinh ra để tránh; nhưng để nó dài 720px
       trong một ô 300px thì mất hẳn 17 nhóm cuối, tệ hơn nhiều. Đo được ô thì
       vừa ô, và ai muốn thanh dày hơn thì kéo ô cao lên hoặc chia trang. */
    ...(horizontal && !fit ? { height: { step: BAR_STEP } } : { height: boxHeight }),
    ...(layers.length === 1 ? (layers[0] as object) : { layer: layers }),
  } as TopLevelSpec;
}

/**
 * Tooltip khai TƯỜNG MINH từng dòng — §10.21.
 *
 * ═══ Vì sao không để `tooltip: true` tự suy ═══════════════════════════════════
 *
 * `tooltip: true` bảo Vega-Lite dựng tooltip từ các kênh đang vẽ, lấy TÊN TRỤC
 * làm tên dòng. Nó dựng thành một object lấy tên làm khoá, và hai hỏng hóc đi ra
 * từ đúng chỗ đó — cả hai đã đo bằng `compile()`:
 *
 *   hai trường cùng tên   Trục `name` (products) + Nhóm màu `name` (categories)
 *                         cho ra `{"name": …, "price": …}`: dòng nhóm màu bị
 *                         BỎ HẲN, không phải ghi đè. Người dùng rê chuột và
 *                         không thấy chiều thứ hai mình vừa kéo thả.
 *
 *   ô nhỏ bỏ tên trục     `tenDuoi` trả `null` để nhường chỗ cho dữ liệu (§10.16),
 *                         và tooltip rơi về tên TRƯỜNG KỸ THUẬT: "label",
 *                         "series" — chữ người dùng chưa từng đặt.
 *
 * Tách tooltip khỏi trục là chữa được cả hai: tên dòng lấy thẳng từ nhãn dữ
 * liệu, và không bao giờ trùng nhau. Backend đã đặt tên riêng cho các trường
 * trùng tên (`nhanKhongTrung` — thêm tên bảng); đánh số ở đây là lưới an toàn
 * cho nguồn khác, vì tên trùng ở tooltip là MẤT một giá trị, không phải xấu.
 *
 * Thứ tự: các chiều trước, con số sau — đọc như một dòng của bảng số liệu.
 */
function tooltipOf(
  data: ReportDataDto,
  fields: readonly ('label' | 'series' | 'value')[],
  format: string | undefined,
): object[] {
  const ten = {
    label: data.dimensionLabel === '' ? 'Nhóm' : data.dimensionLabel,
    series: data.seriesLabel === undefined || data.seriesLabel === '' ? 'Chuỗi' : data.seriesLabel,
    value: data.measureLabel === '' ? 'Giá trị' : data.measureLabel,
  };

  const daDung = new Set<string>();
  return fields.map((field) => {
    let title = ten[field];
    for (let n = 2; daDung.has(title); n += 1) title = `${ten[field]} (${String(n)})`;
    daDung.add(title);

    return field === 'value'
      ? { field, type: 'quantitative', title, ...(format === undefined ? {} : { format }) }
      : { field, type: 'nominal', title };
  });
}

/**
 * Biểu đồ này có nhiều chuỗi không.
 *
 * Hỏi `seriesLabel` chứ không quét `rows`: backend đặt nhãn đó đúng khi và chỉ
 * khi cấu hình khai chiều thứ hai, còn `rows` có thể rỗng (bảng chưa có dòng
 * nào khớp) và khi đó một biểu đồ nhiều chuỗi sẽ lặng lẽ tự vẽ thành một chuỗi.
 */
export function hasSeries(data: ReportDataDto): boolean {
  return typeof data.seriesLabel === 'string' && data.seriesLabel !== '';
}

/**
 * Thứ tự lát cắt của biểu đồ tròn.
 *
 * Vòng tròn không sắp bằng `sort` trên một trục — nó sắp bằng kênh `order`,
 * và kênh đó nhận MỘT trường để so sánh. Nên hai cách sắp theo tên phải trỏ vào
 * `label`, còn hai cách theo giá trị trỏ vào `value`.
 */
function pieOrder(
  opts: ReportChartOptionsDto,
  measureLabel: string,
): { order: Record<string, unknown> } {
  const theoTen = opts.sort === 'label' || opts.sort === 'label-desc';
  const tang = opts.sort === 'label' || opts.sort === 'value-asc';

  return {
    order: theoTen
      ? { field: 'label', type: 'nominal', sort: tang ? 'ascending' : 'descending' }
      : {
          field: 'value',
          type: 'quantitative',
          title: measureLabel,
          sort: tang ? 'ascending' : 'descending',
        },
  };
}

/**
 * Thang màu cho một encoding MÀU.
 *
 * `brand` là một màu đơn nên nó vô nghĩa ở đây: một biểu đồ tròn tô toàn một
 * màu không còn lát cắt nào phân biệt được, và các chuỗi của một biểu đồ cột
 * cũng vậy. Rơi về bảng mặc định thay vì vẽ ra một biểu đồ không đọc được.
 *
 * Trình dựng cũng tự đổi lựa chọn này khi người dùng thả một chiều vào ô Nhóm
 * màu — ở đó nó nói ra, còn ở đây chỉ là lưới an toàn cho cấu hình cũ.
 *
 * Trả về `range` (danh sách hex) cho bảng màu khai bằng hex và `scheme` (tên
 * Vega) cho bảng màu cũ chỉ có tên. Hai hình dạng vì hai nguồn sự thật khác
 * nhau — xem `LEGACY_SCHEMES`.
 *
 * Thứ tự hỏi KHÔNG đảo được: hex trước, tên scheme sau. `powerbi` có mặt ở cả
 * hai bảng (nó là tên cũ của `bright`, cùng dãy màu), và hỏi `LEGACY_SCHEMES`
 * trước sẽ đẩy nó sang một scheme của Vega — tức lặng lẽ vẽ lại mọi báo cáo cũ
 * bằng một dãy màu khác hẳn.
 */
function colorScaleFor(
  palette: ChartPalette | undefined,
): { range: readonly string[] } | { scheme: string } {
  const hex = palette === undefined ? undefined : CHART_PALETTE_COLORS[palette];
  if (hex !== undefined) return { range: hex };

  const scheme = palette === undefined ? undefined : LEGACY_SCHEMES[palette];
  if (scheme !== undefined) return { scheme };

  // Còn lại đúng hai ca: cấu hình không nói gì, và `brand` (một màu duy nhất,
  // không phân loại được). Cả hai rơi về bảng mặc định — xem `normalizePalette`,
  // nơi ca thứ hai được dẹp hẳn ngay lúc nạp vào trình dựng.
  return { range: CHART_PALETTE_COLORS[DEFAULT_CHART_PALETTE] ?? [] };
}

/**
 * MỘT màu từ bảng màu — cho biểu đồ chỉ có một chuỗi, và cho đầu đậm của thang
 * bản đồ nhiệt.
 *
 * ═══ Vì sao không còn là màu thương hiệu ════════════════════════════════════
 *
 * Tới §10.14, mark của biểu đồ một chuỗi tô bằng `--color-brand-600` — một
 * hằng số. Hệ quả: bộ chọn bảng màu bấm được, tô sáng được, lưu được, mà biểu
 * đồ cột thì đứng yên. Người dùng gọi đúng tên nó ra:
 *
 *   "phần bảng màu … như biểu đồ cột lại ko thể thay đổi bảng màu"
 *
 * Lấy màu ĐẦU TIÊN của bảng là câu trả lời đúng cho cả hai phía. Người dùng
 * đổi bảng thì biểu đồ đổi màu; và màu ấy vẫn là màu Vega sẽ gán cho chuỗi thứ
 * nhất, nên thả thêm một chiều vào ô Nhóm màu thì CHUỖI ĐẦU giữ nguyên màu cũ
 * thay vì cả biểu đồ nhảy sang một dãy màu khác.
 *
 * ⚠️ KHÔNG tô mỗi nhóm một màu. Màu khi đó mã hoá đúng thứ trục ngang đã mã
 * hoá, và với hai mươi nhóm thì dãy tám màu phải quay vòng — hai nhóm khác hẳn
 * nhau mang cùng một màu, thứ mắt đọc thành "hai nhóm này cùng loại".
 *
 * ⚠️ Đây là một lần VẼ LẠI có chủ ý: mọi biểu đồ một chuỗi đã lưu đổi từ tím
 * chàm sang màu đầu của bảng nó đang mang. Không tránh được nếu muốn ô chọn có
 * tác dụng, và cái mất đi chỉ là một màu chưa từng ai chọn.
 */
function markColorFor(palette: ChartPalette | undefined): string {
  const scale = colorScaleFor(palette);
  // `scheme` là một cái tên chỉ Vega tra được, không phải một danh sách hex —
  // bảng màu cũ nào rơi vào nhánh đó thì lấy màu đầu của bảng mặc định.
  const range = 'range' in scale ? scale.range : undefined;
  return range?.[0] ?? CHART_PALETTE_COLORS[DEFAULT_CHART_PALETTE]?.[0] ?? '#118DFF';
}

/**
 * Thứ tự trên trục nhóm — xem `CHART_SORTS`.
 *
 * `null` = GIỮ NGUYÊN thứ tự backend đã sắp (giảm dần theo thước đo). Đó là
 * mặc định, và nó phải là `null` chứ không phải một phép sắp tương đương: để
 * Vega tự sắp thì nó xếp theo bảng chữ cái, và dòng "Khác" nhảy vào giữa — ở
 * thứ tự mặc định nó phải nằm cuối, vì nó là phần còn lại chứ không phải một
 * nhóm.
 *
 * Ba lựa chọn kia sắp lại cả "Khác" theo đúng luật của chúng. Không phải bỏ
 * sót: `'label'` đã làm vậy từ đầu, và mọi công cụ BI cũng thế — khi người
 * dùng RA LỆNH sắp, một cái cột đứng yên một chỗ mới là thứ khó hiểu.
 *
 * ⚠️ Dòng "Khác" chỉ còn đến từ nhánh BỘ DỮ LIỆU (`aggregateWarehouse`). Báo cáo
 * dựng trên mô hình chia trang thay vì gộp, từ §10.15.
 *
 * `'value-asc'` sắp bằng `op: 'sum'` chứ không đảo ngược mảng: biểu đồ nhiều
 * chuỗi có nhiều dòng cùng một nhãn, nên thứ tự phải tính trên TỔNG của nhãn
 * đó — đảo mảng sẽ xếp theo dòng đầu tiên bắt gặp.
 */
function sortOf(opts: ReportChartOptionsDto): SortOrder {
  if (opts.sort === 'label') return 'ascending';
  if (opts.sort === 'label-desc') return 'descending';
  if (opts.sort === 'value-asc') return { field: 'value', op: 'sum', order: 'ascending' };
  return null;
}

type SortOrder =
  'ascending' | 'descending' | { field: 'value'; op: 'sum'; order: 'ascending' } | null;

/**
 * Lớp chữ in con số lên từng mark.
 *
 * KHÔNG dùng cho biểu đồ đường, miền và phân tán: ở đó các điểm nằm sát nhau
 * theo trục ngang nên chữ đè lên nhau thành một vệt không đọc được, và chính
 * đường nối mới là thứ người ta nhìn. `CHART_VALUE_LABELS` giữ danh sách này,
 * và trình dựng khoá công tắc lại cho những loại không có tên trong đó — thay
 * vì để người dùng bật một thứ không xảy ra gì.
 */
function valueLayer(
  format: string | undefined,
  color: string,
  /**
   * Vị trí của lớp chữ.
   *
   * Rỗng với bản đồ nhiệt: ở đó `x` và `y` khai ở cấp trên cùng nên mọi lớp
   * THỪA HƯỞNG chúng. Với bốn loại còn lại thì vị trí nằm trong từng lớp, nên
   * phải truyền vào — và phải trộn CÙNG object `encoding` với `text`, không
   * phải ghi đè nó. Ghi đè là mất luôn con số cần in.
   */
  position: object,
): object {
  return {
    mark: { type: 'text', dy: -6, fontSize: 10, color },
    encoding: {
      ...position,
      text: { field: 'value', type: 'quantitative', ...(format === undefined ? {} : { format }) },
    },
  };
}
