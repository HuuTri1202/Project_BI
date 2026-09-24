import type { FolderDto } from './folder';

/**
 * Thư mục BÁO CÁO — §10.25.
 *
 * Phần luật chung (tên "Chung", trần độ dài, ba trạng thái bộ lọc trên URL) nằm
 * ở `folder.ts` và dùng chung với thư mục bộ dữ liệu — xem đầu file đó. Ở đây
 * chỉ còn những thứ RIÊNG của báo cáo.
 */

/**
 * Cùng hình dạng với thư mục bộ dữ liệu, và tên riêng này là để đọc.
 *
 * Một hàm nhận `ReportFolderDto` nói ra ngay nó làm việc với thư mục nào, trong
 * khi `FolderDto` trần thì phải lần ngược lên nơi gọi mới biết. TypeScript coi
 * hai tên là một kiểu, nên không có phép ép nào phải viết thêm.
 */
export type ReportFolderDto = FolderDto;

/** Chuyển một báo cáo sang thư mục khác. `null` = đưa về Chung. */
export interface MoveReportInput {
  folderId: number | null;
}
