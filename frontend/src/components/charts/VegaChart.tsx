import { useEffect, useRef, useState } from 'react';
import type { TopLevelSpec } from 'vega-lite';

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
 */

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
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    // StrictMode ở dev gọi effect HAI lần. Không có hai lớp bảo vệ dưới đây thì
    // `vegaEmbed` chạy hai lượt và để lại hai view sống cùng hai ResizeObserver
    // trên một thẻ div — biểu đồ nhân đôi, và bộ nhớ không được giải phóng.
    let cancelled = false;
    let view: { finalize: () => void } | null = null;

    void (async () => {
      try {
        const { default: vegaEmbed } = await import('vega-embed');
        if (cancelled) return;

        const result = await vegaEmbed(
          host,
          { ...spec, data: { values: data as unknown as Record<string, unknown>[] } },
          {
            actions: false,
            // 'svg' chứ không phải 'canvas': màu lấy từ biến CSS của Tailwind là
            // chuỗi `oklch(...)`, và trình duyệt tự hiểu nó khi nằm trong thuộc
            // tính `fill` của SVG. Canvas thì khắt khe hơn khi phân tích màu.
            renderer: 'svg',
          },
        );

        // Cờ `cancelled` có thể bật lên TRONG lúc await ở trên — kiểm lại,
        // nếu không thì view vừa tạo sẽ không ai dọn.
        if (cancelled) {
          result.view.finalize();
          return;
        }
        view = result.view;
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      view?.finalize();
      host.replaceChildren();
    };
  }, [spec, data]);

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
