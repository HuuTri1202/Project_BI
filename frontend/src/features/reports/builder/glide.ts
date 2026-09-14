/**
 * Cho một hộp TRƯỢT về chỗ mới thay vì nhảy tới — §10.20.
 *
 * Kỹ thuật FLIP: đo chỗ hộp đang HIỆN (`from`), để React đặt nó vào ô lưới mới,
 * đo lại, rồi chạy một hoạt ảnh từ chỗ cũ về số 0. Bố cục thật đổi ngay lập tức
 * — chỉ phần vẽ là đuổi theo trong 160 ms — nên mọi phép đo sau đó (kéo tiếp,
 * `elementFromPoint`, bàn phím) đều thấy đúng chỗ đã lưu.
 *
 * Web Animations API chứ không đặt `transition` vào `style`: hoạt ảnh tự dọn khi
 * xong, không đè lên `transform` mà cú kéo đang ghi, và không cần nghe
 * `transitionend` — sự kiện không bao giờ tới nếu hộp bị gỡ giữa chừng.
 */

const DURATION_MS = 160;
const EASING = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

/** Tỉ lệ thu phóng thật của một phần tử: bề rộng trên màn hình ÷ bề rộng bố cục. */
export function scaleOf(el: HTMLElement): number {
  return el.offsetWidth > 0 ? el.getBoundingClientRect().width / el.offsetWidth : 1;
}

export function glide(el: HTMLElement, from: DOMRect, scale: number): void {
  if (typeof el.animate !== 'function' || prefersReducedMotion()) return;

  const to = el.getBoundingClientRect();
  // `translate` áp BÊN TRONG khung đã thu phóng, nên quãng màn hình phải chia
  // cho tỉ lệ — không thì ở mức 50% hộp trượt từ một chỗ xa gấp đôi chỗ thật.
  const dx = (from.left - to.left) / scale;
  const dy = (from.top - to.top) / scale;
  const resized = Math.abs(from.width - to.width) > 0.5 || Math.abs(from.height - to.height) > 0.5;
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && !resized) return;

  const first: Keyframe = { transform: `translate(${dx}px, ${dy}px)` };
  const last: Keyframe = { transform: 'translate(0px, 0px)' };
  // Cỡ chỉ đi vào hoạt ảnh khi cỡ THẬT SỰ đổi: hoạt ảnh bề rộng làm biểu đồ bên
  // trong đo lại mỗi khung hình, một cái giá không đáng trả cho một cú dời chỗ.
  if (resized) {
    first.width = `${from.width / scale}px`;
    first.height = `${from.height / scale}px`;
    last.width = `${to.width / scale}px`;
    last.height = `${to.height / scale}px`;
  }
  el.animate([first, last], { duration: DURATION_MS, easing: EASING });
}

/** Hộp vừa được chèn hiện ra nhẹ, để mắt bắt được nó rơi xuống chỗ nào. */
export function appear(el: HTMLElement): void {
  if (typeof el.animate !== 'function' || prefersReducedMotion()) return;
  el.animate(
    [
      { opacity: 0, transform: 'scale(0.96)' },
      { opacity: 1, transform: 'scale(1)' },
    ],
    { duration: DURATION_MS, easing: EASING },
  );
}
