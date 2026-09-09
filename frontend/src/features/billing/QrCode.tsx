import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

/**
 * Vẽ một chuỗi thành hình QR — §11.
 *
 * ─── Vì sao SVG chứ không canvas ───────────────────────────────────────────
 *
 * Mã QR này được QUÉT bằng camera điện thoại, nên độ nét là yêu cầu chức năng
 * chứ không phải thẩm mỹ: một canvas 200px bị phóng to trên màn hình retina sẽ
 * mờ, và một mã QR mờ là một mã QR khách phải thử ba lần mới quét được. SVG nét
 * ở mọi kích thước và mọi tỉ lệ pixel.
 *
 * SVG cũng in ra giấy được — người vận hành in đơn ra để đối chiếu là chuyện có
 * thật.
 *
 * ─── Vì sao sinh ở TRÌNH DUYỆT, không lấy ảnh từ dịch vụ ngoài ─────────────
 *
 * Cách quen thuộc là `<img src="https://img.vietqr.io/image/...">`. Làm thế là
 * gửi SỐ TÀI KHOẢN, SỐ TIỀN và MÃ ĐƠN của khách sang máy chủ bên thứ ba ở mỗi
 * lần mở trang thanh toán, và trang thanh toán chết khi dịch vụ đó chết — đúng
 * lúc khách đang định trả tiền. Chuỗi EMVCo do backend dựng
 * (`services/billing/vietqr.ts`), còn ở đây chỉ vẽ nó ra.
 *
 * ─── Mức sửa lỗi M, không phải L ───────────────────────────────────────────
 *
 * Chuỗi VietQR khá dài, và mức sửa lỗi càng cao thì ma trận càng nhiều ô — tức
 * là mỗi ô càng nhỏ trên cùng một khung, càng khó quét. M (15%) là mức NAPAS
 * khuyến nghị và là cân bằng đúng cho một mã hiện trên màn hình sạch, không
 * phải một tờ giấy dán ngoài trời.
 */

export function QrCode({
  value,
  size = 224,
  label,
}: {
  value: string;
  size?: number;
  /** Nội dung cho trình đọc màn hình. Ảnh QR không tự nói nó là gì. */
  label: string;
}): React.ReactElement {
  const [svg, setSvg] = useState<string | null>(null);
  const [loi, setLoi] = useState(false);

  useEffect(() => {
    let huy = false;

    QRCode.toString(value, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      // Viền trắng bắt buộc theo chuẩn QR — thiếu nó thì nhiều máy quét không
      // tách được ma trận khỏi nền. 1 module là mức tối thiểu dùng được và
      // không phí chỗ.
      margin: 1,
      width: size,
    }).then(
      (result) => {
        if (!huy) setSvg(result);
      },
      () => {
        if (!huy) setLoi(true);
      },
    );

    // Chuỗi QR không đổi trong đời một đơn, nhưng người dùng có thể rời trang
    // giữa chừng — cờ này để không `setState` trên component đã tháo.
    return () => {
      huy = true;
    };
  }, [value, size]);

  if (loi) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-dashed border-slate-300 p-4 text-center text-xs text-slate-500"
        style={{ width: size, height: size }}
      >
        Không vẽ được mã QR. Hãy chuyển khoản thủ công theo thông tin bên dưới.
      </div>
    );
  }

  if (svg === null) {
    return (
      <div
        className="animate-pulse rounded-lg bg-slate-100"
        style={{ width: size, height: size }}
        role="status"
      >
        <span className="sr-only">Đang tạo mã QR…</span>
      </div>
    );
  }

  return (
    <div
      className="rounded-lg bg-white p-1"
      style={{ width: size, height: size }}
      role="img"
      aria-label={label}
      // Nội dung do `qrcode` sinh từ một chuỗi backend dựng, không phải từ input
      // người dùng — và thư viện chỉ phát ra thẻ <svg> với <path>. Đây là chỗ
      // duy nhất trong repo dùng `dangerouslySetInnerHTML`, và nó có mặt vì
      // không có cách nào khác chèn một SVG dựng lúc chạy.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
