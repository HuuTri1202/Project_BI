/**
 * Tên sản phẩm — MỘT chỗ duy nhất.
 *
 * Trước đây "BI Platform" được gõ tay ở năm chỗ trên giao diện (sidebar người
 * dùng, sidebar quản trị, trang đăng nhập, khung đăng ký, thẻ tiêu đề) và hai chỗ
 * ở backend. Đổi tên sang Open Insight là đi tìm từng chỗ một, và sót một chỗ
 * nghĩa là cùng một sản phẩm tự gọi mình bằng hai cái tên.
 *
 * ⚠️ Chỉ là TÊN HIỂN THỊ. Những định danh kỹ thuật mang chữ `bi` cố ý giữ
 * nguyên, vì đổi chúng không làm đổi thứ người dùng thấy mà làm hỏng thứ đang
 * chạy:
 *
 *   `bi_platform` (tên database)      volume MySQL hiện có mất dữ liệu
 *   `bi_platform_token` (localStorage) mọi người đang đăng nhập bị đăng xuất
 *   `JWT_ISSUER` / `JWT_AUDIENCE`       mọi token đã cấp thành không hợp lệ
 *   `admin@bi-platform.local`          tài khoản dev đăng nhập bằng đúng chuỗi này
 *   tiền tố mã đơn `BI…`               nội dung chuyển khoản của đơn đã tạo
 *
 * `frontend/index.html` là chỗ duy nhất không đọc được hằng số này (HTML tĩnh,
 * chạy trước mọi dòng TypeScript) — sửa tên thì sửa cả ở đó.
 */
export const APP_NAME = 'Open Insight';

/** Chữ trong ô biểu tượng vuông cạnh tên, ở trang đăng nhập và đăng ký. */
export const APP_INITIALS = 'OI';
