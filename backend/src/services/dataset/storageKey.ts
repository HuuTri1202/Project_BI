import { randomUUID } from 'node:crypto';
import type { FileExt } from '@bi/shared';

/** Phần đọc được dài tối đa bao nhiêu ký tự. */
const SLUG_TOI_DA = 40;

/** Khi tên file không còn lại chữ nào dùng được — ví dụ tên thuần ký tự lạ. */
const SLUG_TRONG = 'tep';

/** `đ`/`Đ` KHÔNG tách ra dấu phụ khi chuẩn hoá NFD, nên phải thay tay. */
const D_GACH = /[đĐ]/g;

/**
 * Rút tên file thành một đoạn AN TOÀN để ghép vào khoá.
 *
 * ⚠️ Hàm này là RANH GIỚI AN TOÀN, không phải một tiện ích làm đẹp. Tên file đi
 * thẳng từ client lên, nên nếu để lọt `/` hay `..` thì khoá sinh ra sẽ trỏ ra
 * NGOÀI tiền tố tổ chức: `t4/w5/../../t1/w1/victim.xlsx`. Vé ghi cấp cho khoá
 * đó sẽ đè lên file của tổ chức khác, và việc ghi diễn ra thẳng giữa trình
 * duyệt với S3 nên không middleware nào thấy.
 *
 * Nên cách làm ở đây là DANH SÁCH TRẮNG chứ không phải lọc bỏ vài ký tự xấu:
 * chỉ `a-z`, `0-9` và `-` sống sót, mọi thứ khác thành `-`. Không có cách nào
 * để một ký tự nguy hiểm đi qua được một bộ lọc dạng này.
 *
 * Bỏ dấu tiếng Việt trước khi lọc, nếu không "Báo cáo quý 4" sẽ thành
 * `b-o-c-o-qu-4`. Đọc được là toàn bộ lý do đoạn này tồn tại.
 */
export function slugTenFile(filename: string): string {
  const khongDuoi = filename.replace(/\.(csv|xlsx)$/i, '');

  const slug = khongDuoi
    .normalize('NFD')
    // Dải này là các dấu phụ tổ hợp — bỏ chúng đi thì "ế" còn "e".
    .replace(/[\u0300-\u036f]/g, '')
    .replace(D_GACH, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_TOI_DA)
    // Cắt ở `SLUG_TOI_DA` có thể để lại một dấu `-` lủng lẳng ở cuối.
    .replace(/-+$/, '');

  return slug === '' ? SLUG_TRONG : slug;
}

/**
 * Sinh khoá lưu trữ cho một file.
 *
 *     t4/w5/bao-cao-quy-4__ffb0134f-f6e7-4e56-94dc-3badf6d6e532.xlsx
 *     ▲     ▲                       ▲
 *     │     │                       └ UUID: thứ bảo đảm không trùng
 *     │     └ tên người dùng đặt, đã rút gọn về ASCII an toàn
 *     └ tổ chức / workspace
 *
 * ─── Vì sao khoá PHẢI do server sinh ────────────────────────────────────────
 *
 * Presigned URL là một tấm vé ghi vào ĐÚNG khoá đó, có hiệu lực 15 phút, không
 * cần token nào nữa. Nếu khoá lấy từ body request thì client gửi lên
 * `t1/w1/bao-cao-tai-chinh.xlsx` là ghi đè file của tổ chức số 1 — và không lớp
 * phân quyền nào ở tầng HTTP nhìn thấy chuyện đó, vì việc ghi diễn ra thẳng giữa
 * trình duyệt và S3.
 *
 * Tên file người dùng đặt CÓ đi vào khoá, nhưng chỉ sau khi qua `slugTenFile` —
 * xem cảnh báo ở đó. Nó chỉ là phần trang trí: thứ quyết định khoá này trỏ vào
 * đâu vẫn là `tenantId`, `workspaceId` và UUID, cả ba đều do server đặt.
 *
 * ─── Vì sao vẫn giữ UUID ĐẦY ĐỦ bên cạnh tên ────────────────────────────────
 *
 * Tên một mình thì hai lần tải `database (1).xlsx` vào cùng một workspace sẽ ra
 * cùng một khoá, và lần sau ghi đè lần trước. Cột `s3_key` CỐ Ý không UNIQUE
 * (một file Excel nhiều sheet dùng chung một khoá — migration 7), nên database
 * không có gì để chặn: bộ dữ liệu đầu vẫn hiện ra bình thường, tới lúc bấm "Nạp
 * lại" mới đọc nhầm file. Một hậu tố ngắn 8 ký tự hạ rủi ro đó xuống chứ không
 * xoá nó; UUID đầy đủ thì xoá hẳn, và cái giá chỉ là 36 ký tự trong một cột
 * `VARCHAR(512)`.
 *
 * ─── Vì sao có tenant và workspace trong đường dẫn ──────────────────────────
 *
 * UUID đã đủ để không đụng nhau. Hai đoạn đầu là để CON NGƯỜI dùng: xem bucket
 * trên giao diện MinIO/S3 mà biết file thuộc về ai, và xoá được toàn bộ dữ liệu
 * của một tổ chức bằng một lệnh xoá theo tiền tố khi họ rời đi.
 *
 * ⚠️ Khoá của file CŨ (chỉ có UUID, không có tên) vẫn còn nguyên trong
 * `datasets.s3_key` và vẫn dùng được: không chỗ nào trong hệ thống suy ra khoá
 * từ mã bộ dữ liệu, mọi nơi đều đọc lại giá trị đã lưu. Kho sẽ trộn hai khuôn
 * một thời gian, và đó là chuyện bình thường.
 */
export function buildStorageKey(
  tenantId: number,
  workspaceId: number,
  filename: string,
  ext: FileExt,
): string {
  return `t${tenantId}/w${workspaceId}/${slugTenFile(filename)}__${randomUUID()}.${ext}`;
}

/**
 * Lấy đuôi file từ tên người dùng tải lên.
 *
 * Trả `null` khi đuôi không nằm trong danh sách cho phép — nơi gọi biến nó thành
 * 400. KHÔNG đoán, không tự sửa: `bao-cao.xls` (định dạng cũ, khác hẳn .xlsx)
 * phải bị từ chối rõ ràng chứ không được lặng lẽ coi là .xlsx rồi hỏng ở bước
 * parse với một thông báo chẳng liên quan.
 *
 * Kết quả của hàm này CHỈ dùng để chọn parser và đặt đuôi cho khoá. Định dạng
 * thật vẫn do `checkFormat` quyết định bằng magic bytes.
 */
export function extensionOf(filename: string): FileExt | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.csv')) return 'csv';
  if (lower.endsWith('.xlsx')) return 'xlsx';
  return null;
}

/** Kiểu MIME để ký vào presigned URL. Phải khớp header trình duyệt gửi lên. */
export function contentTypeOf(ext: FileExt): string {
  return ext === 'csv'
    ? 'text/csv'
    : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
}

/**
 * Tên mặc định cho bộ dữ liệu, suy từ tên file.
 *
 * `Báo cáo quý 4.xlsx` -> `Báo cáo quý 4`. Người dùng sửa được ở bước 3, nhưng
 * phải có sẵn một cái tên hợp lý: bắt gõ lại đúng thứ vừa chọn từ máy là bắt làm
 * một việc thừa.
 */
export function defaultDatasetName(filename: string): string {
  const withoutExt = filename.replace(/\.(csv|xlsx)$/i, '').trim();
  return withoutExt === '' ? 'Bộ dữ liệu' : withoutExt.slice(0, 255);
}
