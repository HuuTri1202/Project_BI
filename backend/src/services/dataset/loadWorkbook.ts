import ExcelJS from 'exceljs';
import JSZip from 'jszip';

/**
 * Dựng workbook từ một buffer .xlsx — chỗ DUY NHẤT trong repo gọi
 * `workbook.xlsx.load`.
 *
 * ═══ Vì sao phải có một hàm riêng cho một lời gọi một dòng ═══════════════════
 *
 * Vì lời gọi đó ném lỗi trên file .xlsx HOÀN TOÀN HỢP LỆ, và cả hai nhánh dùng
 * nó — phân tích (§7) lẫn đường lùi của nạp (§9) — đều phải chữa giống nhau.
 * Hai bản chữa chép tay là hai bản sẽ lệch nhau.
 *
 * ─── Chỗ hỏng, đọc thẳng từ mã nguồn exceljs 4.4 ────────────────────────────
 *
 * Ghi chú của một sheet nằm ở một phần riêng trong gói, được nối vào sheet bằng
 * một quan hệ. exceljs đánh chỉ mục các phần ghi chú bằng một biểu thức chính
 * quy (`lib/xlsx/xlsx.js:386`):
 *
 *     entryName.match(/xl\/(comments\d+)[.]xml/)
 *
 * rồi cất vào bản đồ dưới khoá dạng TƯƠNG ĐỐI (`xlsx.js:160`):
 *
 *     model.comments[`../${name}.xml`] = comments
 *
 * Lúc ráp lại, nó tra bản đồ đó bằng đích ghi trong quan hệ, KHÔNG kiểm tra kết
 * quả (`lib/xlsx/xform/sheet/worksheet-xform.js:453`):
 *
 *     model.comments = options.comments[rel.Target].comments
 *
 * ─── Vì sao file của người dùng rơi đúng vào đó ─────────────────────────────
 *
 * File `database (1).xlsx` do **openpyxl 3.1.5** ghi (xem `docProps/app.xml`).
 * openpyxl đặt ghi chú ở một đường dẫn khác, và ghi đích ở dạng TUYỆT ĐỐI:
 *
 *     phần thật     xl/comments/comment1.xml        (exceljs chờ xl/comments1.xml)
 *     đích quan hệ  /xl/comments/comment1.xml       (exceljs chờ ../comments1.xml)
 *
 * Lệch cả hai đầu: biểu thức chính quy không khớp nên phần ghi chú không bao giờ
 * được đánh chỉ mục, và phép tra ra `undefined`. Kết quả đo được:
 *
 *     TypeError: Cannot read properties of undefined (reading 'comments')
 *       at WorkSheetXform.reconcile  worksheet-xform.js:453
 *
 * Đây là ANH EM của lỗi đã ghi trong `services/ingest/readFileRows.ts` (hàm
 * `opcTarget`): cùng một giả định sai của exceljs rằng mọi đích quan hệ đều
 * viết ở dạng tương đối. Chuẩn OPC cho phép cả hai dạng.
 *
 * ═══ Cách chữa, và vì sao được phép chữa như vậy ═════════════════════════════
 *
 * Gỡ chính các quan hệ ghi chú ra khỏi gói rồi đọc lại. Nghe như phá dữ liệu,
 * nhưng ghi chú là lời chú thích dán lên ô — nền tảng này KHÔNG đọc nó ở bất kỳ
 * đâu (`cellText` chỉ lấy giá trị ô). Thứ bị vứt đi là thứ chưa từng được dùng.
 *
 * Không đi đường "đổi tên phần ghi chú cho khớp cái exceljs chờ" vì nó phải đoán
 * đúng cả hai quy ước cùng lúc, để giữ lại một dữ liệu ta không đọc.
 *
 * ─── Chỉ chạy khi ĐÃ hỏng, không chạy trước ─────────────────────────────────
 *
 * Bản chữa phải giải nén và nén lại cả gói. Đo trên chính file đã hỏng (1,3 MB,
 * 5 sheet, 33.000 dòng): gỡ 10 quan hệ, nén lại còn 1.406.047 byte, và cả chặng
 * chữa + đọc mất 1,7 giây. Bắt MỌI file trả cái giá đó để cứu một thiểu số là
 * sai; nên đường thẳng chạy trước, chữa chỉ là đường lùi.
 *
 * Không có gì để gỡ thì KHÔNG đọc lại lần hai — đọc lại một file vừa hỏng theo
 * một lý do khác chỉ tốn thêm một lượt phân tích rồi hỏng y hệt.
 */

export type Workbook = ExcelJS.Workbook;

/**
 * "Không đọc nổi file .xlsx này", kèm sẵn câu viết cho người dùng đọc.
 *
 * Có lớp riêng để nơi gọi phân biệt được với mọi lỗi khác: `parseFile` chuyển
 * nó thành `ParseError` (ra 400 kèm nguyên văn), còn một `TypeError` lọt lên
 * thì phải thành 500 — đúng bản chất của nó là lỗi của ta, không phải của file.
 */
export class XlsxLoadError extends Error {}

export async function loadWorkbook(buffer: Buffer): Promise<Workbook> {
  try {
    return await load(buffer);
  } catch (first) {
    let repaired: Buffer;
    try {
      repaired = await stripCommentRels(buffer);
    } catch {
      // Không mở nổi bằng cả trình đọc zip: đây mới thật sự là file hỏng. Báo
      // theo lỗi ĐẦU TIÊN, vì nó nói về nội dung file chứ không về bản chữa.
      throw unreadable(first);
    }

    if (repaired === buffer) throw unreadable(first);

    try {
      return await load(repaired);
    } catch (second) {
      throw unreadable(second);
    }
  }
}

async function load(buffer: Buffer): Promise<Workbook> {
  const workbook = new ExcelJS.Workbook();
  // `buffer as never`: kiểu của exceljs khai tham số là `Buffer` của phiên bản
  // @types/node mà nó ghim, lệch với phiên bản trong repo này. Không phải lỗi
  // logic, chỉ là hai khai báo Buffer không đồng nhất.
  await workbook.xlsx.load(buffer as never);
  return workbook;
}

/** Phần rels của MỘT sheet. Ghi chú luôn nối từ sheet, không từ workbook. */
const SHEET_RELS = /^xl\/worksheets\/_rels\/[^/]+\.rels$/;

/**
 * Một thẻ `<Relationship>`, cả dạng tự đóng lẫn dạng có thẻ đóng.
 *
 * Đọc bằng biểu thức chính quy thay vì dựng cây XML là có chủ đích: đây là một
 * file máy sinh, cấu trúc phẳng một tầng, và ta chỉ cần XOÁ vài thẻ chứ không
 * cần hiểu nội dung. Kéo thêm một trình phân tích XML vào phụ thuộc để làm đúng
 * việc này là cái giá không tương xứng.
 *
 * Dấu `>` không thể lọt vào giữa thẻ: trong rels, giá trị thuộc tính là URI đã
 * thoát, `>` luôn ở dạng `&gt;`.
 */
const REL_TAG = /<Relationship\b[^>]*?(?:\/>|>[\s\S]*?<\/Relationship>)/g;

/**
 * Hai loại quan hệ phải gỡ.
 *
 * `comments` là thủ phạm. `vmlDrawing` đi kèm nó — trong exceljs, nhánh đọc
 * vmlDrawing chỉ tồn tại để gắn hình dạng cho chính các ghi chú
 * (`worksheet-xform.js:455`), nên để lại một mình thì nó vừa vô nghĩa vừa là
 * một phép tra bản đồ không kiểm tra thứ hai đang chờ sẵn.
 */
const COMMENT_REL = /Type\s*=\s*"[^"]*\/(?:comments|vmlDrawing)"/;

/**
 * Trả về gói đã gỡ các quan hệ ghi chú — hoặc CHÍNH buffer cũ nếu không có gì
 * để gỡ.
 *
 * Trả lại đúng tham chiếu cũ là cách nơi gọi biết "bản chữa không đổi được gì"
 * mà không cần một cờ riêng.
 */
export async function stripCommentRels(buffer: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);
  let removed = 0;

  for (const path of Object.keys(zip.files)) {
    if (!SHEET_RELS.test(path)) continue;

    const entry = zip.file(path);
    if (entry === null) continue;

    const xml = await entry.async('string');
    const cleaned = xml.replace(REL_TAG, (tag) => {
      if (!COMMENT_REL.test(tag)) return tag;
      removed += 1;
      return '';
    });

    if (cleaned !== xml) zip.file(path, cleaned);
  }

  if (removed === 0) return buffer;

  // DEFLATE, không phải mặc định STORE: gói nén lại giữ nguyên cỡ (1,3 MB),
  // còn để trần thì phần XML của sheet phình lên nhiều lần và ta cầm cả khối đó
  // trong bộ nhớ ngay trước khi đưa cho exceljs.
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/**
 * Câu cuối cùng nói với người dùng — và chỗ DUY NHẤT lỗi thật được ghi ra log.
 *
 * ─── Câu cũ đổ lỗi cho file, và một nửa của nó không thể đúng ───────────────
 *
 * Trước bản này, mọi thất bại đều ra "File Excel hỏng hoặc được bảo vệ bằng mật
 * khẩu." với một `catch {}` trần — nguyên nhân thật bị nuốt, không log, không
 * lần lại được. File của người dùng không hỏng, cũng không có mật khẩu; nó là
 * một file Excel mở lên bình thường mà thư viện của TA không đọc nổi.
 *
 * Nửa "bảo vệ bằng mật khẩu" còn không bao giờ đúng được: .xlsx đặt mật khẩu là
 * một gói OLE (`D0 CF 11 E0`), không phải zip, nên `checkFormat` đã chặn nó từ
 * trước với một thông báo khác. Câu ấy nêu một nguyên nhân không thể xảy ra ở
 * đây, và người dùng làm theo nó sẽ đi tìm một cái mật khẩu không tồn tại.
 */
function unreadable(cause: unknown): XlsxLoadError {
  console.error('[dataset] exceljs không đọc được file .xlsx:', cause);
  return new XlsxLoadError(
    'Không đọc được nội dung file Excel này. Hãy mở bằng Excel rồi "Lưu thành" một file .xlsx mới và tải lên lại.',
  );
}
