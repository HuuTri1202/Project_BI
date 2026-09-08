/**
 * Định dạng tiền, dung lượng và thời gian cho §11.
 *
 * Repo chưa có helper định dạng dùng chung nào — mọi nơi gọi thẳng
 * `n.toLocaleString('vi-VN')` tại chỗ. Ở đây thì cần một chỗ chung, vì cùng một
 * con số tiền hiện trên bốn màn hình (bảng giá, trang Billing, danh sách đơn,
 * màn thanh toán) và bốn cách viết khác nhau cho cùng một số là thứ người dùng
 * nhận ra ngay.
 */

/**
 * Số tiền VND.
 *
 * ⚠️ KHÔNG dùng `style: 'currency'`. `Intl` với `currency: 'VND'` cho ra
 * `"299.000 ₫"` ở một số môi trường và `"₫299.000"` ở môi trường khác, tuỳ
 * phiên bản ICU — nghĩa là cùng một bản build hiện khác nhau trên hai máy. Tự
 * ghép hậu tố thì luôn ra một kết quả.
 *
 * `maximumFractionDigits: 0` vì VND không có đơn vị phụ; một dấu phẩy thập phân
 * trong giá tiền Việt là dấu hiệu ai đó đã chia cho 100 ở đâu đó.
 */
export function dinhDangTien(vnd: number): string {
  return `${vnd.toLocaleString('vi-VN', { maximumFractionDigits: 0 })} ₫`;
}

/**
 * Dung lượng theo đơn vị người đọc được.
 *
 * Dùng 1024 chứ không 1000: hạn mức trong database khai bằng luỹ thừa của 1024
 * (`104857600` = 100 MiB, `5368709120` = 5 GiB), nên chia cho 1000 sẽ hiện
 * "104,9 MB" cho một hạn mức đặt là 100 MB — và người dùng sẽ tưởng mình được
 * nhiều hơn con số trên bảng giá.
 */
export function dinhDangDungLuong(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;

  const donVi = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < donVi.length - 1) {
    value /= 1024;
    i += 1;
  }

  // Một chữ số thập phân là đủ để phân biệt 1,2 GB với 1,9 GB mà không biến
  // thanh mức sử dụng thành một hàng số dài.
  return `${value.toLocaleString('vi-VN', { maximumFractionDigits: 1 })} ${donVi[i] ?? 'B'}`;
}

/** Hạn mức: `null` nghĩa là KHÔNG GIỚI HẠN, không phải 0. */
export function dinhDangHanMuc(limit: number | null, doDungLuong = false): string {
  if (limit === null) return 'Không giới hạn';
  return doDungLuong ? dinhDangDungLuong(limit) : limit.toLocaleString('vi-VN');
}

export function dinhDangNgay(iso: string): string {
  return new Date(iso).toLocaleDateString('vi-VN');
}

export function dinhDangNgayGio(iso: string): string {
  return new Date(iso).toLocaleString('vi-VN');
}

/**
 * Phần trăm đã dùng, để vẽ thanh.
 *
 * `null` (không giới hạn) trả về 0 — một thanh trống. Trả 100 sẽ vẽ thanh đầy
 * cho khách trả nhiều tiền nhất, đúng ngược ý nghĩa.
 *
 * Chặn trên 100 vì mức sử dụng CÓ THỂ vượt hạn mức: hạn mức chỉ hiển thị chứ
 * không chặn thao tác, và người vận hành cũng có thể siết một gói xuống dưới
 * mức khách đang dùng. Một thanh dài quá khung là lỗi bố cục, không phải thông
 * tin — con số bên cạnh đã nói sự thật rồi.
 */
export function phanTramDaDung(used: number, limit: number | null): number {
  if (limit === null || limit <= 0) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

/**
 * Còn bao lâu tới mốc `iso`, dạng `mm:ss`.
 *
 * Trả `null` khi đã quá hạn, để nơi gọi hiện một câu khác chứ không hiện
 * `00:00` — hai trạng thái đó khác nhau và người dùng cần biết mình đang ở đâu.
 */
export function conLai(iso: string, now: number): string | null {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return null;

  const tong = Math.floor(ms / 1000);
  const phut = Math.floor(tong / 60);
  const giay = tong % 60;
  return `${String(phut).padStart(2, '0')}:${String(giay).padStart(2, '0')}`;
}
