/**
 * Thư mục báo cáo — §10.25.
 *
 * ═══ Vì sao "Chung" không phải một thư mục ══════════════════════════════════
 *
 * Thư mục mặc định được biểu diễn bằng `folderId === null`, không phải bằng một
 * bản ghi tên "Chung". Lý do đầy đủ nằm ở migration 37; phần cần nhớ khi đọc mã
 * ở đây là hệ quả của nó: mọi chỗ nhận `folderId` đều nhận `null`, và `null` là
 * một câu trả lời HỢP LỆ chứ không phải "chưa biết".
 *
 * Vì vậy `CHUNG` bên dưới là một NHÃN, không phải dữ liệu. Nó nằm ở @bi/shared
 * để backend (câu lỗi, tên gợi ý) và frontend (cột thư mục, hộp di chuyển) gọi
 * cùng một cái tên — hai bản chép tay lệch nhau thì người dùng thấy "Chung" ở
 * chỗ này và "Mặc định" ở chỗ kia cho cùng một thứ.
 */

/** Tên hiện ra cho chỗ chứa mặc định (`folderId === null`). */
export const CHUNG = 'Chung';

/** Một câu ngắn nói Chung là gì — hiện dưới tên nó trong cột thư mục. */
export const CHUNG_HINT = 'Tổng quan — chỗ của báo cáo chưa xếp vào đâu';

/**
 * Trần độ dài tên thư mục — khớp `VARCHAR(120)` của migration 37.
 *
 * ⚠️ Đổi con số ở đây mà không đổi cột là zod cho qua rồi MySQL cắt cụt trong
 * im lặng (hoặc báo lỗi 1406, tuỳ chế độ), và người dùng mất phần đuôi tên mà
 * không có câu nào nói ra.
 */
export const FOLDER_NAME_MAX = 120;

/**
 * Trần số thư mục MỖI workspace.
 *
 * Không phải một hạn mức thương mại — nó là cái chặn để cột thư mục bên trái
 * còn đọc được, và để một vòng lặp lỗi phía client không dựng ra vài nghìn
 * dòng. Hạn mức gói tính theo số BÁO CÁO, và không đụng tới file này.
 */
export const MAX_REPORT_FOLDERS = 100;

export interface ReportFolderDto {
  id: number;
  workspaceId: number;
  name: string;
  /**
   * Số báo cáo đang nằm trong thư mục này.
   *
   * Tính tại chỗ mỗi lần hỏi danh sách, KHÔNG phải một cột đếm sẵn trong bảng:
   * một con số lưu sẵn phải được cập nhật ở cả bốn đường (tạo, xoá, di chuyển,
   * xoá workspace), và cái nó tiết kiệm được là một phép COUNT trên một bảng
   * đã có index đúng chiều.
   */
  reportCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateReportFolderInput {
  name: string;
}

export interface RenameReportFolderInput {
  name: string;
}

/** Chuyển một báo cáo sang thư mục khác. `null` = đưa về Chung. */
export interface MoveReportInput {
  folderId: number | null;
}

/**
 * Bộ lọc thư mục trên URL của tab Báo cáo.
 *
 * Ba trạng thái, và cả ba đều phải nói ra được bằng một chuỗi trên thanh địa
 * chỉ — người dùng chép link gửi đồng nghiệp thì đối phương phải mở ra đúng chỗ
 * đang nhìn:
 *
 *   - vắng mặt   → mọi báo cáo của workspace
 *   - `'chung'`  → chỉ những báo cáo chưa xếp thư mục (`folder_id IS NULL`)
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
