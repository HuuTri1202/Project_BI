import type { FileExt } from '@bi/shared';

/**
 * Xác định định dạng THẬT của file từ nội dung — §7.3 phía server.
 *
 * ─── Vì sao không đọc đuôi file ─────────────────────────────────────────────
 *
 * §7.3 đòi server kiểm lại định dạng. Nếu việc "kiểm lại" đó là đọc
 * `originalFilename` thì ta đang kiểm đúng thứ client vừa khai — làm hai lần một
 * phép kiểm tra không có thẩm quyền, chứ không phải thêm một lớp.
 *
 * Đổi tên `payload.exe` thành `bao-cao.xlsx` mất hai giây. Điều ngăn nó không
 * phải là đuôi file mà là bốn byte đầu.
 *
 * ─── Điều hàm này KHÔNG làm ─────────────────────────────────────────────────
 *
 * Nó không phải bộ quét virus. Một file .xlsx hợp lệ vẫn có thể chứa macro độc
 * hại, và ta đang tải file đó về server để parse. Với đồ án thì chấp nhận được;
 * với sản phẩm thật thì đây là chỗ phải có thêm một lớp quét. Ghi ra để nó là
 * một quyết định chứ không phải một sơ suất.
 */

/**
 * `.xlsx` là một file ZIP. Bốn byte đầu của mọi ZIP là `PK\x03\x04` — chữ ký do
 * Phil Katz đặt năm 1989 và chưa từng đổi.
 *
 * Một file ZIP RỖNG bắt đầu bằng `PK\x05\x06`, và file .xlsx thật không bao giờ
 * rỗng (nó luôn có ít nhất `[Content_Types].xml`), nên chỉ nhận biến thể đầu.
 */
const ZIP_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/** BOM của UTF-8. Excel thêm nó vào mọi file CSV nó xuất ra. */
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

export interface FormatCheck {
  ok: boolean;
  detected: FileExt | null;
  reason?: string;
}

/**
 * So nội dung thật với đuôi file người dùng khai.
 *
 * Trả về kết quả thay vì ném lỗi: nơi gọi cần cả `detected` lẫn `reason` để dựng
 * thông báo nói rõ chuyện gì xảy ra, và một ngoại lệ chỉ mang được một chuỗi.
 */
export function checkFormat(buffer: Buffer, claimedExt: FileExt): FormatCheck {
  if (buffer.byteLength === 0) {
    return { ok: false, detected: null, reason: 'File rỗng.' };
  }

  const isZip = buffer.subarray(0, 4).equals(ZIP_SIGNATURE);

  if (claimedExt === 'xlsx') {
    if (!isZip) {
      return {
        ok: false,
        detected: null,
        reason: 'Nội dung file không phải định dạng Excel (.xlsx).',
      };
    }
    return { ok: true, detected: 'xlsx' };
  }

  // Khai là CSV nhưng nội dung là ZIP: gần như luôn là người dùng đổi đuôi một
  // file .xlsx. Nói thẳng điều đó thay vì để parser CSV đọc ra một cột toàn ký
  // tự nhị phân rồi báo "file hỏng".
  if (isZip) {
    return {
      ok: false,
      detected: 'xlsx',
      reason: 'Đây là file Excel được đổi tên thành .csv. Hãy tải lên với đuôi .xlsx.',
    };
  }

  if (!isProbablyText(buffer)) {
    return { ok: false, detected: null, reason: 'Nội dung file không phải văn bản.' };
  }

  return { ok: true, detected: 'csv' };
}

/**
 * File có phải văn bản không.
 *
 * Kiểm byte NUL trong 8KB đầu. Đây là phép thử mà `file(1)` và `git` dùng, vì
 * nó rẻ và gần như không bao giờ sai: định dạng nhị phân nào cũng có byte NUL
 * trong vài kilobyte đầu, còn văn bản UTF-8 thì không bao giờ có.
 *
 * KHÔNG thử `buffer.toString('utf8')` rồi bắt lỗi: Node không ném lỗi cho chuỗi
 * UTF-8 hỏng, nó lặng lẽ thay bằng ký tự U+FFFD. Phép thử đó luôn thành công và
 * vì vậy không kiểm được gì.
 */
function isProbablyText(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(8192, buffer.byteLength));
  return !sample.includes(0);
}

/**
 * Bỏ BOM ở đầu file.
 *
 * Không bỏ thì tên cột đầu tiên mang theo một ký tự vô hình U+FEFF ở đầu. Nó
 * hiện ra bình thường trên màn hình, nhưng mọi phép so sánh với chuỗi 'Ngày'
 * đều sai. Loại lỗi tốn hàng giờ vì mắt không nhìn thấy nguyên nhân.
 *
 * (Không viết ký tự đó vào comment này để minh hoạ: `no-irregular-whitespace`
 * chặn nó trong comment — bỏ qua trong chuỗi, nên dữ liệu test vẫn dùng được.)
 */
export function stripBom(buffer: Buffer): Buffer {
  return buffer.subarray(0, 3).equals(UTF8_BOM) ? buffer.subarray(3) : buffer;
}
