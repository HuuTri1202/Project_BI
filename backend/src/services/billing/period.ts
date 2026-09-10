/**
 * Tính chu kỳ của một gói — §11.
 *
 * ═══ MỘT công thức cho mọi trường hợp, không rẽ nhánh ══════════════════════
 *
 *     periodEnd = GREATEST(now, chuKyCu.periodEnd) + durationDays
 *
 * Áp đúng như nhau cho gia hạn cùng gói, nâng cấp, và hạ cấp:
 *
 *   · Gia hạn   -> cộng dồn từ ngày hết hạn cũ, nên mua sớm KHÔNG mất ngày.
 *                  Đây là điều khách sẽ thử: mua lại trước hạn vài ngày để
 *                  chắc chắn không đứt dịch vụ.
 *   · Nâng cấp  -> khách giữ nguyên số ngày còn lại, nhưng ở tầng cao hơn.
 *                  Rộng rãi, và quan trọng hơn là GIẢI THÍCH ĐƯỢC BẰNG MỘT
 *                  CÂU cho người đang bực vì vừa trả tiền.
 *   · Hạ cấp    -> cùng công thức. Chấp nhận.
 *
 * Ba nhánh `if` cho ba trường hợp nghe hợp lý hơn và sai theo kiểu không ai
 * phát hiện: mỗi nhánh là một cách tính, ba cách tính là ba chỗ để lệch nhau,
 * và không có màn hình nào đối chiếu chúng.
 *
 * ─── KHÔNG làm proration, và đó là quyết định ──────────────────────────────
 *
 * Với thanh toán chuyển khoản xác nhận tay và hạn mức chỉ hiển thị, một cỗ máy
 * tính tiền theo tỷ lệ là nợ kỹ thuật không đổi lấy gì: nó cần bảng giá theo
 * ngày, cần xử lý hoàn tiền lẻ, và cần một màn hình giải thích con số cho
 * khách. Cộng dồn ngày cho cùng một sự công bằng với một phần trăm công sức.
 *
 * ─── Hàm THUẦN: nhận `now` làm tham số ─────────────────────────────────────
 *
 * Không gọi `new Date()` bên trong. Một hàm tính ngày mà tự đọc đồng hồ thì
 * chỉ kiểm được bằng cách giả lập thời gian toàn cục — và bài test đó sẽ đỏ
 * vào đúng nửa đêm, mỗi năm một lần, ở một máy CI nào đó.
 */

const MS_PER_DAY = 86_400_000;

export interface PeriodInput {
  now: Date;
  /** Ngày hết hạn của gói ĐANG hiệu lực, `null` khi tổ chức đang ở Free. */
  currentPeriodEnd: Date | null;
  /** Số ngày của gói vừa mua. Lấy từ ảnh chụp trong đơn, không từ bảng giá. */
  durationDays: number;
}

export interface PeriodResult {
  periodStart: Date;
  periodEnd: Date;
  /**
   * Số ngày còn lại của gói cũ được cộng sang.
   *
   * Có mặt để màn hình nói được "bạn được cộng thêm 12 ngày còn lại của gói
   * cũ". Không có nó thì `periodEnd` là một ngày rơi từ trên trời xuống, và bộ
   * phận hỗ trợ phải tính tay mỗi lần khách hỏi vì sao lại là ngày đó.
   *
   * Làm tròn XUỐNG: nói ít hơn thực tế thì khách không thấy mình bị hụt.
   */
  carriedOverDays: number;
}

export function tinhChuKy(input: PeriodInput): PeriodResult {
  const { now, currentPeriodEnd, durationDays } = input;

  if (!Number.isInteger(durationDays) || durationDays <= 0) {
    // Gói Free có `durationDays = 0`, và không subscription nào được trỏ vào
    // nó — luật "không dòng nào = đang ở Free". Rơi vào đây nghĩa là ai đó vừa
    // tạo đơn cho gói Free, và đó là lỗi logic chứ không phải dữ liệu xấu.
    throw new Error(`Số ngày của gói phải là số nguyên dương, nhận được ${String(durationDays)}.`);
  }

  /*
   * Mốc để cộng thêm: MUỘN HƠN giữa "bây giờ" và "hạn cũ".
   *
   * Dùng `Math.max` trên số mili-giây chứ không so hai `Date` bằng `>`: hai
   * đối tượng Date so bằng `>` thì JavaScript ép về số, nhưng `Math.max` trên
   * hai Date trả về NaN — một cái bẫy đủ quen để đáng viết ra.
   *
   * Hạn cũ đã QUA thì `now` thắng, nên gói mới bắt đầu từ hôm nay chứ không
   * nối vào một mốc trong quá khứ.
   */
  const moc = new Date(Math.max(now.getTime(), currentPeriodEnd?.getTime() ?? 0));

  const conLaiMs = Math.max(0, moc.getTime() - now.getTime());

  return {
    // `periodStart` luôn là BÂY GIỜ, kể cả khi cộng dồn: gói mới có hiệu lực
    // ngay lập tức. Đặt nó bằng `moc` sẽ khiến khách vừa trả tiền nâng cấp
    // phải chờ hết gói cũ mới được dùng gói mới.
    periodStart: now,
    periodEnd: new Date(moc.getTime() + durationDays * MS_PER_DAY),
    carriedOverDays: Math.floor(conLaiMs / MS_PER_DAY),
  };
}

/** Đơn hết hạn chưa — dùng cho cả kiểm lười lúc đọc lẫn quét định kỳ. */
export function daHetHan(expiresAt: Date, now: Date): boolean {
  return expiresAt.getTime() <= now.getTime();
}

/**
 * Hạn thanh toán của một đơn mới.
 *
 * 15 phút theo đề bài. Đặt ở đây thay vì viết thẳng vào service để bài test
 * hết hạn và luồng tạo đơn dùng chung đúng một con số.
 */
export const ORDER_TTL_MINUTES = 15;

export function hanThanhToan(now: Date): Date {
  return new Date(now.getTime() + ORDER_TTL_MINUTES * 60_000);
}
