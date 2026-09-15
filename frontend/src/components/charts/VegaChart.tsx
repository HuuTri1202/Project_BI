import { useEffect, useMemo, useRef, useState } from 'react';
import type { TopLevelSpec } from 'vega-lite';

import { hamBieuThucVega, type DoChu } from './vegaExpr';
import { khongKichThuoc, soDo } from './vegaSpecKey';

/**
 * Bọc Vega-Lite cho React.
 *
 * ─── Vì sao nạp động, không import tĩnh ──────────────────────────────────────
 *
 * Bộ `vega` + `vega-lite` + `vega-embed` nặng cỡ 250–300 kB sau gzip: một trình
 * biên dịch spec, một máy dataflow phản ứng, và một bộ phân tích biểu thức. Đó
 * là nhiều hơn hẳn toàn bộ phần còn lại của ứng dụng, chỉ để vẽ một biểu đồ cột
 * 30 điểm. Nó vẫn xứng đáng vì kiến trúc mục tiêu (README) là người dùng tự tạo
 * biểu đồ bằng spec khai báo lưu dạng JSON — thứ không viết tay được.
 *
 * Nhưng cái giá đó không được tính vào lần tải trang đầu. `await import(...)`
 * bên trong effect đẩy cả bộ ba sang một chunk riêng, chỉ tải khi thật sự có
 * biểu đồ cần vẽ. `import type` ở trên bị xoá lúc biên dịch nên tốn 0 byte.
 *
 * ─── Vì sao không dùng `react-vega` ──────────────────────────────────────────
 *
 * Nó là dependency thứ tư, hay chạy sau bản phát hành của vega-lite, và thay thế
 * đúng khoảng ba mươi dòng dưới đây.
 *
 * ═══ Cập nhật TẠI CHỖ, không dựng lại — §10.17 ══════════════════════════════
 *
 * Một view Vega là một MÁY DATAFLOW đang chạy, không phải một bức ảnh. Dựng lại
 * nó cho mỗi thay đổi là xoá sạch thẻ chứa, biên dịch lại spec, tính lại thang
 * đo và vẽ lại từ pixel đầu tiên — và giữa hai việc đó, ô trống trơn.
 *
 * Đo trên trình duyệt thật, mỗi lần dựng lại là một CHỚP TRẮNG 7–22ms:
 *
 *   đổi số liệu (một vòng tới Cube)   1 lần dựng lại, chớp 20ms
 *   kéo co giãn một ô, 10 nhịp        6 lần dựng lại, chớp 7–22ms mỗi lần
 *
 * Người dùng gọi đúng tên nó ra: "khi load biểu đồ thì bị giật màn hình rất khó
 * chịu". Nên từ §10.17 chỉ có ĐỔI CẤU TRÚC mới dựng lại; hai thứ đổi liên tục
 * nhất thì đẩy thẳng vào view đang sống:
 *
 *   số liệu về      `view.data(...)` rồi `runAsync()`
 *   ô đổi kích cỡ   `view.width()/height()` rồi `runAsync()`
 *
 * Cả hai đều là API chính thức của Vega, và cái thứ hai chính là thứ vega-embed
 * tự dùng cho `width: 'container'` khi cửa sổ đổi cỡ.
 */

/**
 * Tên bộ dữ liệu bên trong view — bắt buộc phải có thì mới đẩy số liệu mới vào
 * được bằng `view.data(TEN_DU_LIEU, ...)`.
 *
 * `VegaChart` GHI ĐÈ khoá `data` của mọi spec đi qua nó (xem chú thích ở prop
 * `spec`), nên cái tên này luôn tồn tại — kể cả với spec do nơi khác dựng.
 */
const TEN_DU_LIEU = 'bang';

/** Một view Vega đang sống — chỉ khai đúng phần `VegaChart` đụng tới. */
interface VegaView {
  finalize: () => void;
  width: (value: number) => VegaView;
  height: (value: number) => VegaView;
  data: (name: string, values: unknown) => VegaView;
  runAsync: () => Promise<unknown>;
}

interface VegaChartProps<T extends object> {
  /**
   * Nên là hằng số ở cấp module hoặc được `useMemo`. Spec đổi tham chiếu mỗi
   * lần render sẽ dựng lại toàn bộ view sau mỗi lần render.
   *
   * Trong spec vẫn phải khai `data` (kiểu `TopLevelSpec` bắt buộc) nhưng để
   * rỗng — dữ liệu thật truyền qua prop `data` và được ghi đè lúc embed. Tách
   * làm hai để spec giữ nguyên tham chiếu khi số liệu đổi.
   */
  spec: TopLevelSpec;
  data: readonly T[];
  /** Mô tả cho người dùng trình đọc màn hình — xem bảng ẩn bên dưới. */
  ariaLabel: string;
  className?: string;
}

export function VegaChart<T extends object>({
  spec,
  data,
  ariaLabel,
  className,
}: VegaChartProps<T>): React.ReactElement {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<VegaView | null>(null);
  const [failed, setFailed] = useState(false);

  /*
   * Bản MỚI NHẤT của hai prop, cho hàm bất đồng bộ bên dưới.
   *
   * Việc dựng view có một quãng `await import(...)` ở giữa. Số liệu hoặc kích
   * thước đổi trong quãng đó thì hai effect kia bỏ qua (chưa có view nào), nên
   * chính lần dựng này phải nhặt lấy bản mới — nếu không, biểu đồ vẽ ra bằng
   * dữ liệu của một phần nghìn giây trước và đứng yên như thế.
   */
  const moiNhat = useRef({ spec, data });
  moiNhat.current = { spec, data };

  const khoaCauTruc = useMemo(() => khongKichThuoc(spec), [spec]);
  const rong = soDo(spec, 'width');
  const cao = soDo(spec, 'height');

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    // StrictMode ở dev gọi effect HAI lần. Không có hai lớp bảo vệ dưới đây thì
    // `vegaEmbed` chạy hai lượt và để lại hai view sống cùng hai ResizeObserver
    // trên một thẻ div — biểu đồ nhân đôi, và bộ nhớ không được giải phóng.
    let cancelled = false;
    let view: VegaView | null = null;

    void (async () => {
      try {
        const { default: vegaEmbed, vega } = await import('vega-embed');
        if (cancelled) return;

        const { spec: specMoi, data: dataMoi } = moiNhat.current;
        const result = await vegaEmbed(
          host,
          {
            ...specMoi,
            // Tên bộ dữ liệu là điều kiện để `view.data()` đẩy số mới vào được.
            data: {
              name: TEN_DU_LIEU,
              values: dataMoi as unknown as Record<string, unknown>[],
            },
          },
          {
            actions: false,
            // 'svg' chứ không phải 'canvas': màu lấy từ biến CSS của Tailwind là
            // chuỗi `oklch(...)`, và trình duyệt tự hiểu nó khi nằm trong thuộc
            // tính `fill` của SVG. Canvas thì khắt khe hơn khi phân tích màu.
            renderer: 'svg',
            // Hàm riêng mà spec được gọi (đo nhãn trục — §10.22). Thiếu dòng
            // này thì spec gọi tới chúng không parse được, và ô hiện "Không vẽ
            // được biểu đồ".
            // `textMetrics` có trong gói `vega` lúc chạy (xuất lại từ
            // vega-scenegraph) nhưng bộ khai kiểu của nó không nhắc tới.
            expressionFunctions: hamBieuThucVega(
              (vega as unknown as { textMetrics: DoChu }).textMetrics,
            ),
          },
        );

        // Cờ `cancelled` có thể bật lên TRONG lúc await ở trên — kiểm lại,
        // nếu không thì view vừa tạo sẽ không ai dọn.
        if (cancelled) {
          result.view.finalize();
          return;
        }
        view = result.view as unknown as VegaView;
        viewRef.current = view;
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      view?.finalize();
      if (viewRef.current === view) viewRef.current = null;
      host.replaceChildren();
    };
    /*
     * KHÔNG có `spec` và `data` trong danh sách phụ thuộc, và đó là cả điểm của
     * §10.17: chỉ đổi CẤU TRÚC mới dựng lại view. Kích thước và số liệu đi
     * đường riêng ở hai effect ngay dưới, còn bản mới nhất của chúng thì lấy
     * qua `moiNhat`.
     */
  }, [khoaCauTruc]);

  /*
   * Số liệu mới đẩy thẳng vào view đang sống.
   *
   * `view.data` thay cả bộ dữ liệu rồi `runAsync` tính lại thang đo và vẽ lại —
   * không xoá thẻ chứa, nên không có khung hình nào trống. Chưa có view (đang
   * dựng) thì bỏ qua: lần dựng ấy sẽ tự nhặt bản mới nhất.
   */
  useEffect(() => {
    const view = viewRef.current;
    if (view === null) return;
    view.data(TEN_DU_LIEU, data as unknown as Record<string, unknown>[]);
    void view.runAsync();
  }, [data]);

  /*
   * Kích thước mới cũng vậy — đây là đường vega-embed tự đi khi cửa sổ đổi cỡ.
   *
   * `null` nghĩa là spec khai `'container'` (hoặc không khai): ở đó vega-embed
   * đang tự đo thẻ bọc, và ghi đè bằng một con số sẽ giẫm lên phép đo của nó.
   */
  useEffect(() => {
    const view = viewRef.current;
    if (view === null || (rong === null && cao === null)) return;
    if (rong !== null) view.width(rong);
    if (cao !== null) view.height(cao);
    void view.runAsync();
  }, [rong, cao]);

  if (failed) {
    return (
      <p className="text-sm text-slate-500" role="status">
        Không vẽ được biểu đồ. Số liệu vẫn xem được ở bảng bên dưới.
      </p>
    );
  }

  return (
    <div className={className}>
      {/* Đầu ra của Vega là một mớ <path> và <g> — trình đọc màn hình không
          duyệt được. `aria-hidden` để nó im lặng, và toàn bộ số liệu được lặp
          lại ở bảng ẩn thị giác bên dưới. Một trang KPI mà người khiếm thị
          không đọc được là lỗi, không phải thiếu sót thẩm mỹ. */}
      <div ref={hostRef} aria-hidden="true" />
      <VisuallyHiddenTable data={data} caption={ariaLabel} />
    </div>
  );
}

/**
 * Bảng chỉ dành cho trình đọc màn hình.
 *
 * Dùng `sr-only` của Tailwind chứ không phải `display: none` — `display: none`
 * ẩn khỏi CẢ cây khả năng tiếp cận, tức là không giải quyết được gì.
 *
 * ⚠️ `sr-only` phải đặt trên một `<div>` BỌC NGOÀI, không đặt thẳng lên `<table>`.
 * Với `display: table`, CSS coi `height`/`width` là kích thước TỐI THIỂU chứ
 * không phải cố định, nên `sr-only` không co bảng lại: nó vẫn chiếm đúng chiều
 * cao nội dung. Cộng với `position: absolute` không có tổ tiên định vị, bảng đó
 * bám vào khối chứa gốc và kéo dài cả tài liệu — đo được 2208px vô hình trên
 * trang Tổng quan. Trước đây không ai thấy vì cả trang vốn đã cuộn được.
 */
function VisuallyHiddenTable<T extends object>({
  data,
  caption,
}: {
  data: readonly T[];
  caption: string;
}): React.ReactElement {
  const rows = data as readonly Record<string, unknown>[];
  const first = rows[0];
  const columns = first ? Object.keys(first) : [];

  return (
    <div className="sr-only">
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col} scope="col">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {columns.map((col) => (
                <td key={col}>{String(row[col] ?? '')}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
