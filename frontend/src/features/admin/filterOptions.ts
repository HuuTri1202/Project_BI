/**
 * Lựa chọn cho ô lọc trạng thái, dùng chung cho cả ba trang danh sách.
 *
 * Để riêng file thay vì xuất từ `ListToolbar.tsx`: một file vừa xuất component
 * vừa xuất hằng số sẽ làm hỏng Fast Refresh của Vite — sửa hằng số thì cả cây
 * component bị dựng lại và state của form bay mất.
 */
export const STATUS_OPTIONS = [
  { value: 'active', label: 'Đang hoạt động' },
  { value: 'locked', label: 'Bị khoá' },
];
