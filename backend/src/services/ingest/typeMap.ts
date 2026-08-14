import type { SemanticType } from '@bi/shared';

/**
 * Ánh xạ kiểu sang ClickHouse (§9.2) — TOÀN BỘ file này là hàm thuần.
 *
 * Không import database, không import client, không đọc `env`. Đó là chủ ý: đây
 * là nơi mọi luật khó nằm, và cũng là nơi duy nhất của §9 test được đầy đủ mà
 * không cần một container nào đang chạy.
 *
 * ─── Vì sao mọi cột đều `Nullable` ──────────────────────────────────────────
 *
 * Kể cả cột nguồn khai NOT NULL. Lý do không phải lười: một ô không ép được kiểu
 * (ngày sai định dạng ở dòng 40.000) phải ghi được `NULL` rồi đi tiếp. Cột NOT
 * NULL thì ClickHouse từ chối cả LÔ, và một ô rác giết một lần nạp đã chạy mười
 * phút. Giá phải trả là ~1 byte/ô cho bitmap null — không đáng kể ở quy mô này.
 */

/** Quy ước BẮT BUỘC của dự án cho mọi mốc thời gian. Xem ghi chú ở `DATETIME_CH`. */
const DATETIME_CH = "DateTime64(3,'UTC')";

/**
 * Từ `semantic_type` của nguồn `file` (§7).
 *
 * Chỉ có bốn giá trị, và §7 đã chuẩn hoá giá trị trong `dataset_rows` theo đúng
 * bốn kiểu này (`commit.ts:normalize`) — nên bảng này ngắn và không có ngoại lệ.
 *
 * `Float64` cho `number`, KHÔNG phải `Decimal`. Nghe thì `Decimal(18,2)` "đúng
 * cho tiền" hơn, nhưng §7 đã ép giá trị qua `parseNumber()` thành `Number` (double
 * IEEE-754) từ lúc nhập. Khai `Decimal` ở đây là hứa một độ chính xác ĐÃ MẤT
 * trước khi tới đây. `Float64` nói đúng sự thật; muốn tiền chính xác thì phải sửa
 * ở §7 (giữ chuỗi thô), không sửa được ở §9.
 */
const SEMANTIC_TO_CH: Record<SemanticType, string> = {
  text: 'String',
  number: 'Float64',
  date: DATETIME_CH,
  boolean: 'UInt8',
};

export function chTypeFromSemantic(semantic: SemanticType | null): string {
  return `Nullable(${semantic === null ? 'String' : SEMANTIC_TO_CH[semantic]})`;
}

/**
 * Từ kiểu MySQL của nguồn `connection` (§8).
 *
 * Nhận chuỗi `column_type` ĐẦY ĐỦ (`decimal(18,4)`, `tinyint(1)`,
 * `bigint unsigned`) — xem ghi chú ở `drivers/mysql.ts` về việc vì sao đổi từ
 * `data_type` sang `column_type`. Vẫn phải chịu được dạng TRẦN (`decimal`,
 * `bigint`) vì dataset đồng bộ trước thay đổi đó còn giữ giá trị cũ cho tới lần
 * đồng bộ sau.
 */
export function chTypeFromMysql(rawColumnType: string): string {
  const lower = rawColumnType.trim().toLowerCase();

  // `bigint(20) unsigned zerofill` -> base = 'bigint', args = '20'
  const base = /^[a-z_ ]*?[a-z_]+/.exec(lower)?.[0].trim().split(' ')[0] ?? '';
  const args = /\(([^)]*)\)/.exec(lower)?.[1] ?? '';
  const unsigned = / unsigned\b/.test(lower);

  return `Nullable(${mysqlBase(base, args, unsigned)})`;
}

function mysqlBase(base: string, args: string, unsigned: boolean): string {
  switch (base) {
    // `tinyint(1)` là quy ước boolean của MySQL — chính là thứ đã mất khi driver
    // còn đọc `data_type`. Dạng trần `tinyint` không phân biệt được, đành coi là
    // số: đoán nhầm sang boolean thì giá trị 2..127 biến thành `true` và không
    // ai cộng lại được nữa, còn đoán nhầm sang số thì 0/1 vẫn là 0/1.
    case 'tinyint':
      if (args === '1') return 'UInt8';
      return unsigned ? 'UInt8' : 'Int8';
    case 'smallint':
      return unsigned ? 'UInt16' : 'Int16';
    // ClickHouse không có kiểu 24 bit; Int32 là kiểu nhỏ nhất chứa đủ.
    case 'mediumint':
      return unsigned ? 'UInt32' : 'Int32';
    case 'int':
    case 'integer':
      return unsigned ? 'UInt32' : 'Int32';
    // `unsigned` ở đây KHÔNG phải chi tiết vụn: `BIGINT UNSIGNED` là kiểu rất hay
    // gặp cho khoá chính, và giá trị vượt 2^63 nhét vào `Int64` là TRÀN SỐ — id
    // biến thành số âm mà không có lỗi nào.
    case 'bigint':
      return unsigned ? 'UInt64' : 'Int64';

    case 'decimal':
    case 'numeric': {
      const parts = args.split(',').map((x) => Number.parseInt(x.trim(), 10));
      const p = parts[0];
      const s = parts[1];
      if (p === undefined || s === undefined || !Number.isInteger(p) || !Number.isInteger(s)) {
        // Kiểu TRẦN, không có (p,s) — dataset đồng bộ trước khi driver đổi sang
        // `column_type`. Không đoán `Decimal(18,2)`: đoán thiếu chữ số thập phân
        // là ÂM THẦM làm tròn tiền của khách hàng. `String` giữ nguyên từng chữ
        // số; đồng bộ lại một lần là có kiểu đúng.
        return 'String';
      }
      // MySQL cho tới 65 chữ số, ClickHouse `Decimal` tối đa 38. Kẹp lại thay vì
      // để ClickHouse từ chối cả câu DDL.
      return `Decimal(${Math.min(p, 38)}, ${Math.min(s, 38)})`;
    }

    case 'float':
      return 'Float32';
    case 'double':
    case 'real':
      return 'Float64';

    // `Date32` chứ không `DateTime64`, và đây là NGOẠI LỆ có chủ ý so với quy
    // ước "mọi cột thời gian là DateTime64(3,'UTC')": `DATE` của MySQL không
    // phải một mốc thời gian, nó là một ngày trên lịch — không có giờ, nên cũng
    // không có múi giờ để mà lệch. Ép nó thành DateTime64 là bịa ra một
    // `00:00:00` không có trong dữ liệu gốc, rồi người đọc phải hỏi "nửa đêm ở
    // múi giờ nào".
    //
    // `Date32` chứ không `Date`: `Date` chỉ từ 1970, nên mọi ngày sinh trước đó
    // bị kẹp về 1970-01-01. `Date32` phủ 1900–2299.
    case 'date':
      return 'Date32';
    case 'datetime':
    case 'timestamp':
      return DATETIME_CH;

    // ClickHouse có kiểu `Time` nhưng còn thử nghiệm ở 25.8. `String` là lựa
    // chọn buồn tẻ và đúng.
    case 'time':
      return 'String';
    case 'year':
      return 'UInt16';

    case 'char':
    case 'varchar':
    case 'text':
    case 'tinytext':
    case 'mediumtext':
    case 'longtext':
    case 'enum':
    case 'set':
    case 'json':
    case 'uuid':
      return 'String';

    // Kiểu lạ -> `String`, KHÔNG phải lỗi. Một cột `POINT` làm hỏng cả lần nạp
    // nghĩa là người dùng không nạp được CẢ BẢNG vì một cột họ không quan tâm.
    // Chuỗi thì không bao giờ mất dữ liệu — cùng lắm §10 phải ép kiểu.
    default:
      return 'String';
  }
}

/**
 * Bọc một định danh cho ClickHouse.
 *
 * ─── Quy tắc escape là BACKSLASH, không phải nhân đôi ───────────────────────
 *
 * Đây là chỗ rất dễ viết sai vì MySQL làm ngược lại: `escapeId` của mysql2 nhân
 * đôi backtick (`` a`b `` -> `` `a``b` ``). ClickHouse KHÔNG hiểu cú pháp đó —
 * nó escape bằng dấu chéo ngược, y như trong chuỗi:
 *
 *     tên cột  a`b   ->   `a\`b`
 *     tên cột  c\d   ->   `c\\d`
 *
 * Đã kiểm bằng `CREATE TABLE` thật trên ClickHouse 25.8 rồi đọc lại
 * `system.columns`. Nhân đôi backtick ở đây cho ra lỗi cú pháp — mà lỗi đó chỉ
 * nổ với đúng những tên cột hiếm, tức là nổ ở máy khách hàng chứ không ở máy ta.
 *
 * Thứ tự thay thế QUAN TRỌNG: escape `\` trước rồi mới tới `` ` ``. Làm ngược
 * lại thì dấu chéo ta vừa thêm vào sẽ bị escape lần nữa.
 */
export function quoteIdent(name: string): string {
  return `\`${name.replace(/\\/g, '\\\\').replace(/`/g, '\\`')}\``;
}

/**
 * Chuỗi ngày của nguồn `file` -> văn bản ClickHouse đọc được như một mốc UTC.
 *
 * ─── Vì sao TỰ GHÉP CHUỖI, tuyệt đối không qua `new Date()` ─────────────────
 *
 * `new Date('2026-12-31')` là nửa đêm UTC, nhưng `new Date('2026-12-31 00:00')`
 * là nửa đêm GIỜ MÁY CHỦ. Hai chuỗi khác nhau đúng một ký tự, kết quả lệch đúng
 * 7 tiếng trên máy dev (container đặt `TZ=Asia/Ho_Chi_Minh`) — và nó hiện ra
 * ngoài dưới dạng báo cáo sai MỘT NGÀY ở những bản ghi gần nửa đêm. Đó chính là
 * loại lỗi mà quy ước `DateTime64(3,'UTC')` sinh ra để chặn, nên để nó lọt vào ở
 * đúng chỗ chuyển đổi thì cả quy ước thành vô nghĩa.
 *
 * Ghép tay thì không có bước nào diễn giải múi giờ: chuỗi ra đúng những chữ số
 * người dùng đã gõ, và cột khai `'UTC'` nên ClickHouse đọc chúng như UTC.
 *
 * `31/12/2026` theo quy ước Việt Nam là 31 tháng 12 — cùng quy ước với
 * `looksLikeDate` trong `inferType.ts`, và cùng lý do: không có cách nào đoán
 * đúng cả hai quy ước từ một chuỗi.
 *
 * Trả `null` khi không đọc được. `inferColumnType` chỉ lấy mẫu 200 dòng đầu
 * (`SAMPLE_ROWS` trong `commit.ts`), nên một cột được gọi là `date` HOÀN TOÀN có
 * thể chứa `'chưa xác định'` ở dòng 5.000. Nơi gọi ghi một dòng lỗi rồi đi tiếp.
 */
const ISO_LIKE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/;
const VN_LIKE = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/;

export function toClickHouseDateTime(raw: string): string | null {
  const s = raw.trim();

  // `num(m, i)` chứ không `Number(m[i])`: `noUncheckedIndexedAccess` của repo
  // làm mọi phần tử mảng có kiểu `T | undefined`, và `Number(undefined)` là
  // `NaN` — một giá trị lọt qua mọi phép so sánh rồi thành chuỗi 'NaN' trong SQL.
  const num = (m: RegExpExecArray, i: number): number => Number(m[i] ?? 0);

  const iso = ISO_LIKE.exec(s);
  if (iso) return assemble(num(iso, 1), num(iso, 2), num(iso, 3), num(iso, 4), num(iso, 5), num(iso, 6));

  const vn = VN_LIKE.exec(s);
  if (vn) return assemble(num(vn, 3), num(vn, 2), num(vn, 1), 0, 0, 0);

  return null;
}

/**
 * Ghép các số đã tách thành `'YYYY-MM-DD HH:mm:ss.SSS'`, sau khi kiểm ngày có
 * thật.
 *
 * Regex một mình không đủ: `31/02/2026` khớp hoàn hảo mà không tồn tại. Kiểm
 * bằng cách dựng một `Date` UTC rồi đối chiếu lại ba thành phần — nếu tháng 2
 * ngày 31 thì `Date` tự trôi sang tháng 3 và phép đối chiếu bắt được.
 *
 * `Date.UTC` ở đây an toàn (khác hẳn `new Date(chuỗi)`): nó nhận các SỐ và luôn
 * hiểu chúng là UTC, không có chỗ nào cho múi giờ máy chen vào. Kết quả của nó
 * cũng không được dùng để sinh chuỗi — chuỗi ghép từ chính các số đầu vào.
 */
function assemble(y: number, mo: number, d: number, h: number, mi: number, s: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;

  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) {
    return null;
  }

  const p2 = (n: number): string => String(n).padStart(2, '0');
  return `${String(y).padStart(4, '0')}-${p2(mo)}-${p2(d)} ${p2(h)}:${p2(mi)}:${p2(s)}.000`;
}
