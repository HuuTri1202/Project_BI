import { useLayoutEffect, useRef, useState } from 'react';

/**
 * Vùng cuộn của khung soạn thảo, có thu phóng — §10.20.
 *
 * ═══ Thu phóng HÌNH, không dựng lại bố cục ═════════════════════════════════
 *
 * Lưới vẫn được dựng ở đúng bề rộng của mức 100% — bề rộng vùng cuộn — rồi cả
 * khối được `scale()`. Nhờ vậy ở 50% người dùng thấy ĐÚNG bố cục của 100%, chỉ
 * nhỏ đi: chữ trong biểu đồ, cỡ chữ hộp văn bản, độ dày nét đều nhỏ theo cùng
 * một tỉ lệ.
 *
 * Cách còn lại — đổi bước lưới theo mức phóng — thì biểu đồ dựng lại ở cỡ mới
 * còn chữ giữ nguyên: một tiêu đề 24px trong một hàng 22px bị cắt mất nửa, và
 * thứ thấy ở 50% không còn là thứ người xem sẽ thấy.
 *
 * ⚠️ Biểu đồ Vega vẫn chạm đúng khi đã `scale()`: trình dựng vẽ bằng SVG, và
 * Vega tìm mục dưới con trỏ theo phần tử DOM nhận sự kiện chứ không bằng phép
 * trừ toạ độ — phép trừ đó mới là thứ lệch khi khối cha bị co giãn.
 *
 * ═══ Hai lớp bọc ═══════════════════════════════════════════════════════════
 *
 * `transform` không đổi bố cục: một khối cao 2.000px thu về 50% vẫn chiếm chỗ
 * 2.000px. Nên lớp NGOÀI mang cỡ đã thu phóng (để thanh cuộn đúng), lớp TRONG
 * mang bề rộng 100% và phép `scale()`.
 *
 * ⚠️ Ở 100% cả hai lớp vẫn có mặt, chỉ không mang style nào. Bỏ hẳn chúng đi thì
 * đổi 100% ↔ 75% là đổi CÂY DOM, React gỡ rồi dựng lại cả khung — mọi biểu đồ
 * vẽ lại từ đầu và mất trang nhóm đang xem.
 */
export function ZoomViewport({
  zoom,
  children,
}: {
  zoom: number;
  children: React.ReactNode;
}): React.ReactElement {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [basis, setBasis] = useState(0);
  const [height, setHeight] = useState(0);

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const inner = innerRef.current;
    if (scroller === null || inner === null) return;

    const measure = (): void => {
      const style = window.getComputedStyle(scroller);
      const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      setBasis(Math.max(scroller.clientWidth - padding, 0));
      // `offsetHeight` là cỡ BỐ CỤC — không đổi theo `scale()`, đúng thứ cần nhân.
      setHeight(inner.offsetHeight);
    };
    measure();

    // jsdom không có `ResizeObserver`; trong trình duyệt thật thì luôn có.
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    observer.observe(inner);
    return () => observer.disconnect();
  }, []);

  const scaled = zoom !== 1 && basis > 0;

  return (
    <div
      ref={scrollerRef}
      // Cú kéo trong `CanvasBoard` tìm vùng cuộn qua dấu này để tự cuộn khi con
      // trỏ chạm mép, và để cộng quãng đã cuộn vào quãng con trỏ đi.
      data-canvas-scroller=""
      className="min-h-0 flex-1 overflow-auto pr-1"
    >
      <div
        style={
          scaled
            ? // `margin: auto` căn giữa khung đã thu nhỏ; phóng to thì khung rộng
              // hơn vùng cuộn, `auto` về 0 và thanh cuộn ngang tự hiện.
              { width: basis * zoom, height: height * zoom, margin: '0 auto' }
            : undefined
        }
      >
        <div
          ref={innerRef}
          data-canvas-zoom={zoom}
          style={
            scaled
              ? { width: basis, transform: `scale(${zoom})`, transformOrigin: '0 0' }
              : undefined
          }
        >
          {children}
        </div>
      </div>
    </div>
  );
}
