/**
 * Dấu hiệu trên DOM để việc xuất ảnh báo cáo biết khi nào mới được chụp.
 *
 * ═══ Vì sao dấu hiệu, không phải "chờ 2 giây rồi chụp" ═════════════════════
 *
 * Thời điểm một báo cáo vẽ xong không đoán được: số liệu đi một vòng Cube (49ms
 * khi ấm, 4,6 giây khi Cube vừa biên dịch lại schema), rồi Vega dựng view bất
 * đồng bộ, rồi ô đo lại kích thước và Vega vẽ lại lần nữa. Chờ một khoảng cố
 * định thì hoặc chụp phải ô "Đang tải…", hoặc bắt người dùng chờ vô ích.
 *
 * Nên chính các component nói ra mình đang bận, bằng thuộc tính trên thẻ của
 * mình, và `choVeXong` chờ tới lúc cả vùng không còn thẻ nào bận. Thuộc tính
 * DOM chứ không phải một context React: vùng được chụp có thể là trang đang
 * hiển thị hoặc một trang dựng ngoài màn hình, và câu hỏi "trong cây DOM này có
 * gì còn bận" trả lời được cho cả hai bằng một `querySelector`.
 *
 * File ở `services/` vì cả `components/charts` lẫn `features/reports` dùng nó.
 */

/** Vega đang dựng view hoặc đang vẽ lại — `VegaChart` bật/tắt trực tiếp. */
export const THUOC_TINH_DANG_VE = 'data-dang-ve';

/** Rải lên phần tử chỉ tồn tại khi số liệu còn đang về ("Đang tải…"). */
export const DANG_TAI = { 'data-dang-tai': '' } as const;

/** Phần tử không đưa vào ảnh xuất — nút bấm, bảng ẩn cho trình đọc màn hình. */
export const THUOC_TINH_KHONG_XUAT = 'data-khong-xuat';
export const KHONG_XUAT = { [THUOC_TINH_KHONG_XUAT]: '' } as const;

/**
 * Vùng đang hiện LỖI thay cho báo cáo. Chụp nó là giao cho người dùng một tệp
 * PDF trông như báo cáo mà chỉ chứa một hộp đỏ — nên việc xuất dừng lại và nói
 * đúng câu lỗi đó.
 */
export const THUOC_TINH_LOI_XUAT = 'data-loi-xuat';
export function loiXuat(message: string): { [THUOC_TINH_LOI_XUAT]: string } {
  return { [THUOC_TINH_LOI_XUAT]: message };
}

export const CHON_DANG_BAN = `[${THUOC_TINH_DANG_VE}],[data-dang-tai]`;
