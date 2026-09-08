import { useEffect, useState } from 'react';

import { apiClient } from '../../services/apiClient';

/**
 * Ảnh QR tĩnh lấy từ API — §11 mục 3.2.
 *
 * ═══ Vì sao KHÔNG dùng thẳng `<img src={url}>` ════════════════════════════
 *
 * Đường dẫn ảnh nằm sau `authorize('billing', 'read')`, và trình duyệt KHÔNG
 * gắn header `Authorization` vào request của thẻ `<img>` — nó chỉ gửi cookie.
 * Phiên đăng nhập của app này nằm ở localStorage cộng header Bearer (xem
 * `apiClient`), nên một thẻ img trỏ vào đó sẽ nhận 401 và hiện ô ảnh vỡ.
 *
 * Ba cách ra khỏi chuyện đó, và lý do chọn cách thứ ba:
 *
 *   1. Mở công khai endpoint ảnh — không, đó là mã QR nhận tiền.
 *   2. Cho token vào query string — nó sẽ nằm trong log truy cập của mọi proxy
 *      trên đường đi, và trong lịch sử trình duyệt.
 *   3. Tải bằng axios (có sẵn interceptor gắn token) rồi dựng một object URL.
 *
 * ⚠️ `URL.revokeObjectURL` trong cleanup là bắt buộc: object URL giữ cả blob
 * trong bộ nhớ cho tới khi bị thu hồi, và một màn hình thanh toán mở suốt buổi
 * sẽ tích lại từng ảnh một.
 */
export function StaticQrImage({
  path,
  size = 224,
  label,
}: {
  /** Đường dẫn API tương đối, ví dụ `/v1/payment-methods/2/qr`. */
  path: string;
  size?: number;
  label: string;
}): React.ReactElement {
  const [src, setSrc] = useState<string | null>(null);
  const [loi, setLoi] = useState(false);

  useEffect(() => {
    let huy = false;
    let url: string | null = null;

    apiClient.get<Blob>(path, { responseType: 'blob' }).then(
      (res) => {
        if (huy) return;
        url = URL.createObjectURL(res.data);
        setSrc(url);
      },
      () => {
        if (!huy) setLoi(true);
      },
    );

    return () => {
      huy = true;
      if (url !== null) URL.revokeObjectURL(url);
    };
  }, [path]);

  if (loi) {
    return (
      <div
        className="flex items-center justify-center rounded-lg border border-dashed border-slate-300 p-4 text-center text-xs text-slate-500"
        style={{ width: size, height: size }}
      >
        Không tải được ảnh mã QR. Hãy báo quản trị viên hệ thống.
      </div>
    );
  }

  if (src === null) {
    return (
      <div
        className="animate-pulse rounded-lg bg-slate-100"
        style={{ width: size, height: size }}
        role="status"
      >
        <span className="sr-only">Đang tải mã QR…</span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={label}
      width={size}
      height={size}
      className="rounded-lg bg-white object-contain p-1"
      style={{ width: size, height: size }}
    />
  );
}
