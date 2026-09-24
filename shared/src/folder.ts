/**
 * Thư mục — luật dùng CHUNG cho tab Báo cáo (§10.25) và tab Kho dữ liệu (§7.9).
 *
 * ═══ Vì sao MỘT file cho hai tính năng ═════════════════════════════════════
 *
 * Hai tab có hai BẢNG riêng (`report_folders`, `dataset_folders`) vì chúng đếm
 * hai thứ khác nhau và ràng buộc khoá ngoại đi hai đường khác nhau. Nhưng phần
 * người dùng NHÌN THẤY và phần nằm trên URL thì giống hệt nhau: cùng chỗ chứa
 * mặc định tên "Chung", cùng trần độ dài tên, cùng ba trạng thái bộ lọc.
 *
 * Chép đôi những thứ đó là hẹn trước một ngày hai tab nói hai kiểu — thư mục
 * mặc định tên "Chung" ở đây và "Tổng quan" ở kia, `?folder=chung` mở ra Chung
 * ở tab này và mọi thư mục ở tab kia. Không cái nào trong số đó ném lỗi.
 *
 * ═══ Vì sao "Chung" không phải một thư mục ═════════════════════════════════
 *
 * Chỗ chứa mặc định được biểu diễn bằng `folderId === null`, không phải bằng
 * một bản ghi tên "Chung". Lý do đầy đủ nằm ở migration 37; phần cần nhớ khi
 * đọc mã là hệ quả: mọi chỗ nhận `folderId` đều nhận `null`, và `null` là một
 * câu trả lời HỢP LỆ chứ không phải "chưa biết".
 *
 * Vì vậy `CHUNG` bên dưới là một NHÃN, không phải dữ liệu.
 */

/** Tên hiện ra cho chỗ chứa mặc định (`folderId === null`). */
export const CHUNG = 'Chung';

/**
 * Câu ngắn nói Chung là gì — hiện dưới tên nó trong cột thư mục.
 *
 * Nhận danh từ của thứ đang được xếp ("báo cáo", "bộ dữ liệu") thay vì là một
 * hằng số: một câu chung chung kiểu "chỗ của mục chưa xếp vào đâu" đọc như máy
 * viết, còn hai hằng số chép tay thì lệch nhau ở lần sửa câu chữ đầu tiên.
 */
export function chungHint(danhTu: string): string {
  return `Tổng quan — chỗ của ${danhTu} chưa xếp vào đâu`;
}

/**
 * Trần độ dài tên thư mục — khớp `VARCHAR(120)` của migration 37 và 39.
 *
 * ⚠️ Đổi con số ở đây mà không đổi cột là zod cho qua rồi MySQL cắt cụt trong
 * im lặng (hoặc báo lỗi 1406, tuỳ chế độ), và người dùng mất phần đuôi tên mà
 * không có câu nào nói ra.
 */
export const FOLDER_NAME_MAX = 120;

/**
 * Trần số thư mục MỖI workspace, cho mỗi loại.
 *
 * Không phải một hạn mức thương mại — nó là cái chặn để cột thư mục bên trái
 * còn đọc được, và để một vòng lặp lỗi phía client không dựng ra vài nghìn
 * dòng. Hạn mức gói tính theo số BÁO CÁO và DUNG LƯỢNG, không đụng tới file này.
 */
export const MAX_FOLDERS = 100;

/**
 * Một thư mục, như giao diện nhìn thấy nó.
 *
 * Cùng một hình dạng cho cả hai tab — xem đầu file. `itemCount` cố ý KHÔNG mang
 * tên loại ("reportCount"/"datasetCount"): cột thư mục và hộp "Chuyển tới thư
 * mục" là một bản dựng dùng chung, và một trường mang tên loại buộc chúng phải
 * rẽ nhánh theo loại ở đúng chỗ chúng chẳng cần biết loại là gì.
 */
export interface FolderDto {
  id: number;
  workspaceId: number;
  name: string;
  /**
   * Số mục đang nằm trong thư mục này.
   *
   * Tính tại chỗ mỗi lần hỏi danh sách, KHÔNG phải một cột đếm sẵn trong bảng:
   * một con số lưu sẵn phải được cập nhật ở cả bốn đường (tạo, xoá, di chuyển,
   * xoá workspace), và cái nó tiết kiệm được là một phép COUNT trên một bảng
   * đã có index đúng chiều.
   *
   * ⚠️ Nó đếm đúng những mục người dùng THẤY khi mở thư mục đó mà không lọc gì
   * thêm. Định nghĩa "còn sống" phải là MỘT câu SQL dùng chung với danh sách —
   * hai bản chép tay là hai con số khác nhau cho cùng một thư mục, và lỗi đó
   * từng xảy ra thật ở tab Báo cáo.
   */
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFolderInput {
  name: string;
}

export interface RenameFolderInput {
  name: string;
}

/**
 * Bộ lọc thư mục trên URL.
 *
 * Ba trạng thái, và cả ba đều phải nói ra được bằng một chuỗi trên thanh địa
 * chỉ — người dùng chép link gửi đồng nghiệp thì đối phương phải mở ra đúng chỗ
 * đang nhìn:
 *
 *   - vắng mặt   → mọi thư mục của workspace
 *   - `'chung'`  → chỉ những mục chưa xếp thư mục (`folder_id IS NULL`)
 *   - `'12'`     → thư mục số 12
 *
 * Không dùng `folderId=0` cho Chung: số 0 trông như một mã thật, và ngày nào đó
 * sẽ có người truyền `0` vì biến của họ chưa khởi tạo.
 */
export const FOLDER_FILTER_CHUNG = 'chung';

/** `undefined` = mọi thư mục; `null` = Chung; số = đúng thư mục đó. */
export function parseFolderFilter(raw: string | undefined): number | null | undefined {
  if (raw === undefined || raw === '') return undefined;
  if (raw === FOLDER_FILTER_CHUNG) return null;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : undefined;
}

/** Đường ngược lại — dựng giá trị cho URL từ lựa chọn đang hiện. */
export function folderFilterValue(folderId: number | null | undefined): string {
  if (folderId === undefined) return '';
  return folderId === null ? FOLDER_FILTER_CHUNG : String(folderId);
}
