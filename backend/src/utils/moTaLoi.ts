/**
 * Rút một câu CÓ ÍCH ra khỏi một lỗi bất kỳ, để ghi log hoặc trả readiness.
 *
 * ═══ Vì sao không dùng thẳng `err.message` ══════════════════════════════════
 *
 * Khi không kết nối được tới một host, Node thử cả IPv4 lẫn IPv6 rồi gộp hai
 * thất bại vào một `AggregateError` — và `message` của nó RỖNG. Nên
 * `console.error('[redis]', err.message)` in ra đúng một dòng:
 *
 *     [redis]
 *
 * ĐO ĐƯỢC 24/11/2026 khi chạy thử ảnh Docker của API với `REDIS_HOST` trỏ sai:
 * năm dòng `[redis]` trắng trơn, không dòng nào nói được chuyện gì đang xảy ra.
 * Đó là đúng tình huống cần log nhất — một bản triển khai mới cấu hình sai.
 *
 * Hàm này mở từng lỗi con ra, và lấy thêm `code` (`ECONNREFUSED`, `ETIMEDOUT`,
 * `ER_ACCESS_DENIED_ERROR`…) khi `message` trống: mã lỗi là thứ phân biệt "sai
 * địa chỉ" với "sai mật khẩu", hai hướng sửa hoàn toàn khác nhau.
 *
 * ⚠️ Dùng CHUNG, không chép: trước đây nó là hàm riêng trong `api/health.ts`,
 * nên readiness thì đọc được lỗi còn log của Redis thì không. Một bản sao thứ
 * hai sẽ lệch đi theo đúng cách đó.
 */
export function moTaLoi(err: unknown): string {
  if (err instanceof AggregateError) {
    const inner = err.errors.map(moTaLoi).filter(Boolean);
    // `Set` vì hai nhánh IPv4/IPv6 gần như luôn cho cùng một câu, và
    // "ECONNREFUSED; ECONNREFUSED" không nói thêm gì so với một lần.
    return inner.length > 0 ? [...new Set(inner)].join('; ') : err.name;
  }
  if (err instanceof Error) {
    const { code } = err as NodeJS.ErrnoException;
    return err.message || code || err.name;
  }
  return String(err);
}
