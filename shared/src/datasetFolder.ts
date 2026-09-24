import type { FolderDto } from './folder';

/**
 * Thư mục BỘ DỮ LIỆU — §7.9.
 *
 * Phần luật chung nằm ở `folder.ts` và dùng chung với thư mục báo cáo. Ở đây
 * chỉ còn những thứ riêng của kho dữ liệu — xem `reportFolder.ts` để biết vì
 * sao vẫn có một tên kiểu riêng.
 */
export type DatasetFolderDto = FolderDto;

/** Chuyển một bộ dữ liệu sang thư mục khác. `null` = đưa về Chung. */
export interface MoveDatasetInput {
  folderId: number | null;
}
