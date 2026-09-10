/**
 * Dựng chuỗi mã QR chuyển khoản theo chuẩn VietQR — §11.
 *
 * ═══ Đây là EMVCo, không phải một định dạng riêng của Việt Nam ══════════════
 *
 * VietQR là hồ sơ (profile) của NAPAS trên chuẩn EMVCo QR Code. Chuỗi gồm các
 * trường TLV nối tiếp nhau — mỗi trường là `<tag 2 số><độ dài 2 số><giá trị>` —
 * và kết thúc bằng một mã kiểm CRC.
 *
 * ─── Vì sao TỰ DỰNG chứ không gọi img.vietqr.io ────────────────────────────
 *
 * Cách quen thuộc là nhúng `<img src="https://img.vietqr.io/image/...">`. Ba
 * lý do không đi đường đó:
 *
 *   1. Nó gửi SỐ TÀI KHOẢN, SỐ TIỀN và MÃ ĐƠN của khách sang máy chủ bên thứ
 *      ba ở mỗi lần mở trang thanh toán.
 *   2. Trang thanh toán chết khi dịch vụ đó chết — đúng lúc khách đang định
 *      trả tiền.
 *   3. Chuỗi tự dựng LƯU ĐƯỢC vào `orders.qr_payload`, nên đơn cũ vẫn hiện
 *      đúng số tài khoản khách đã quét kể cả sau khi người vận hành đổi tài
 *      khoản. Một URL thì luôn sinh lại theo cấu hình hiện tại — nó là cache,
 *      còn chuỗi là bằng chứng.
 *
 * Việc vẽ chuỗi này thành hình QR là của trình duyệt.
 *
 * ─── Hàm THUẦN, không đọc database, không đọc env ──────────────────────────
 *
 * Cùng lý do đã ghi ở `typeMap.ts` và `buildCubeSchema.ts`: mọi luật khó của
 * mục này nằm ở đây, nên đây phải là nơi kiểm được đầy đủ mà không cần một
 * container nào đang chạy.
 */

export interface VietQrInput {
  /** Mã ngân hàng 6 chữ số theo NAPAS (BIN), ví dụ Vietcombank là 970436. */
  bankBin: string;
  accountNo: string;
  /** Số tiền, đơn vị ĐỒNG. Số nguyên — VND không có đơn vị phụ. */
  amountVnd: number;
  /** Nội dung chuyển khoản. Với hệ thống này nó LUÔN là `order_code`. */
  content: string;
}

/**
 * Một trường TLV.
 *
 * ⚠️ Độ dài đếm theo KÝ TỰ và luôn hai chữ số. Một giá trị dài quá 99 ký tự
 * không diễn tả được trong định dạng này, nên nó bị chặn ở `assertShort` chứ
 * không lặng lẽ sinh ra một chuỗi sai độ dài — chuỗi đó vẫn quét ra được một
 * mã QR, chỉ là ngân hàng đọc sai trường tiếp theo.
 */
function tlv(tag: string, value: string): string {
  assertShort(tag, value);
  return tag + String(value.length).padStart(2, '0') + value;
}

function assertShort(tag: string, value: string): void {
  if (value.length > 99) {
    throw new Error(`Trường VietQR '${tag}' dài ${value.length} ký tự, tối đa 99.`);
  }
}

/**
 * Chỉ giữ chữ và số, ép hoa.
 *
 * Không phải để cho gọn: nhiều ngân hàng lọc bỏ ký tự lạ và ép hoa TRƯỚC khi
 * ghi nội dung vào sao kê. Nếu ta gửi đi một chuỗi khác với chuỗi sẽ hiện trên
 * sao kê thì việc đối chiếu tự động không bao giờ khớp — và người vận hành sẽ
 * phải dò tay từng dòng mà không hiểu vì sao.
 *
 * Với `order_code` thì hàm này không đổi gì (mã vốn chỉ có [0-9A-Z]); nó có mặt
 * để một nội dung khác lọt vào đây sau này không âm thầm phá phần đối chiếu.
 */
export function normalizeContent(raw: string): string {
  return raw
    .normalize('NFD')
    // Bỏ dấu tiếng Việt thay vì xoá cả chữ: "Đơn hàng" thành "DON HANG" chứ
    // không thành "n hng".
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, (c) => (c === 'đ' ? 'd' : 'D'))
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '');
}

/**
 * CRC-16/CCITT-FALSE — mã kiểm bắt buộc ở cuối chuỗi EMVCo.
 *
 * Tham số của biến thể này: đa thức 0x1021, giá trị đầu 0xFFFF, không đảo bit
 * đầu vào, không đảo đầu ra, không XOR cuối. Chọn nhầm biến thể (có hàng chục
 * biến thể CRC-16) cho ra bốn chữ số trông hoàn toàn hợp lệ mà mọi ứng dụng
 * ngân hàng đều từ chối — và thông báo họ hiện là "mã QR không hợp lệ", không
 * nói gì về CRC.
 */
export function crc16(input: string): string {
  let crc = 0xffff;

  for (let i = 0; i < input.length; i += 1) {
    crc ^= input.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }

  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Chuỗi hoàn chỉnh để vẽ thành mã QR.
 *
 * ⚠️ Thứ tự trường KHÔNG tuỳ ý. CRC tính trên toàn bộ chuỗi ĐÃ GỒM tag và độ
 * dài của chính trường CRC (`6304`), nên đảo thứ tự là đổi luôn kết quả CRC.
 */
export function buildVietQrPayload(input: VietQrInput): string {
  if (!/^\d{6}$/.test(input.bankBin)) {
    throw new Error(`Mã ngân hàng phải là 6 chữ số, nhận được '${input.bankBin}'.`);
  }
  if (!Number.isInteger(input.amountVnd) || input.amountVnd <= 0) {
    throw new Error(`Số tiền phải là số nguyên dương, nhận được ${String(input.amountVnd)}.`);
  }

  const beneficiary = tlv('00', input.bankBin) + tlv('01', input.accountNo);

  const body =
    // Phiên bản định dạng.
    tlv('00', '01') +
    // 12 = QR ĐỘNG, dùng một lần. Khác 11 (tĩnh, dùng lại nhiều lần) — và đây
    // là khác biệt có nghĩa: mã này đã mang sẵn số tiền và mã đơn của MỘT đơn
    // hàng cụ thể, quét lại lần hai là trả tiền cho đơn đã đóng.
    tlv('01', '12') +
    tlv(
      '38',
      // GUID của NAPAS, cố định cho mọi mã VietQR.
      tlv('00', 'A000000727') +
        tlv('01', beneficiary) +
        // QRIBFTTA = chuyển tới TÀI KHOẢN. (QRIBFTTC là chuyển tới THẺ — sai
        // mã dịch vụ thì ngân hàng đi tìm một số thẻ và không thấy.)
        tlv('02', 'QRIBFTTA'),
    ) +
    // 704 = VND theo ISO 4217.
    tlv('53', '704') +
    tlv('54', String(input.amountVnd)) +
    tlv('58', 'VN') +
    // Nội dung chuyển khoản nằm ở trường 08 BÊN TRONG nhóm 62.
    tlv('62', tlv('08', normalizeContent(input.content)));

  // `6304` phải có mặt TRƯỚC khi tính CRC — nó nằm trong phần được tính.
  const withCrcTag = `${body}6304`;
  return withCrcTag + crc16(withCrcTag);
}
