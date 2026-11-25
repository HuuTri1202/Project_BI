import { z, type ZodErrorMap, type ZodIssueOptionalMessage } from 'zod';

/**
 * Câu báo lỗi MẶC ĐỊNH của zod, dịch sang tiếng Việt — dùng cho CẢ hai phía.
 *
 * ═══ Vì sao cần ════════════════════════════════════════════════════════════
 *
 * `errorHandler` trả `issue.message` ra nguyên văn trong `fields`, và `fields`
 * được gắn thẳng vào từng ô của form (xem `RegisterPage`). Rule nào có câu chữ
 * viết tay thì ổn; rule nào không thì người dùng Việt đọc đúng những câu này —
 * ĐO ĐƯỢC 24/11/2026, mười một câu chỉ trong mười hai lần thử:
 *
 *     fullName    : Required
 *     email       : Required
 *     password    : Required
 *     workspaceId : Expected number, received nan
 *     datasetId   : Expected number, received nan
 *     role        : Invalid enum value. Expected 'admin' | 'creator' | 'viewer', received 'ceo'
 *     pageSize    : Number must be less than or equal to 100
 *
 * Đếm trong `api/v1/schemas.ts`: 131 rule, chỉ 36 có câu tiếng Việt. Tức khoảng
 * ba phần tư lỗi nhập liệu của cả sản phẩm ra tiếng Anh nếu người dùng chạm
 * tới. Viết tay 131 câu là việc không bao giờ xong và sẽ mục dần theo từng rule
 * mới; một bản đồ lỗi thì sửa hết trong đúng một chỗ, kể cả rule viết sau này.
 *
 * ⚠️ Nó KHÔNG ghi đè câu chữ viết tay. Thứ tự zod đọc là: `message` của chính
 * rule → error map của lời gọi → error map của schema → error map TOÀN CỤC →
 * mặc định. Nên "Tên công ty phải có ít nhất 2 ký tự" vẫn thắng, và bản đồ này
 * chỉ thay vào đúng chỗ trước đây là tiếng Anh.
 *
 * ═══ Vì sao để ở gói CHUNG ═════════════════════════════════════════════════
 *
 * Cùng một ô được kiểm hai lần: frontend kiểm trước khi gửi, backend kiểm lại
 * khi nhận. Hai bản dịch chép tay sẽ lệch nhau, và người dùng sẽ thấy hai câu
 * khác nhau cho cùng một lỗi tuỳ theo họ bấm nhanh hay chậm.
 *
 * Mỗi phía tự gọi `datLoiTiengViet()` một lần lúc khởi động: `createApp()` ở
 * backend và `main.tsx` ở frontend. Gọi nhiều lần vô hại — nó chỉ ghi lại cùng
 * một bản đồ.
 */

/** Trường vắng mặt — không phải "sai kiểu". */
function thieu(issue: ZodIssueOptionalMessage): string | null {
  if (issue.code !== z.ZodIssueCode.invalid_type) return null;
  if (issue.received === 'undefined' || issue.received === 'null') {
    return 'Thiếu thông tin này.';
  }
  /*
   * `received: 'nan'` tới từ `z.coerce.number()`: `Number(undefined)` là NaN,
   * nên một tham số THIẾU và một chuỗi "abc" đi vào đây giống nhau như đúc.
   * Không đoán — nói đúng thứ mà cả hai trường hợp đều cần nghe.
   */
  if (issue.received === 'nan') return 'Cần một số hợp lệ.';
  return null;
}

const TEN_KIEU: Record<string, string> = {
  string: 'một đoạn chữ',
  number: 'một số',
  boolean: 'đúng hoặc sai',
  array: 'một danh sách',
  object: 'một đối tượng',
  date: 'một ngày',
};

/** "ít nhất 2 ký tự" / "ít nhất 1 mục" / "từ 1 trở lên" — câu chữ theo KIỂU. */
function nguong(loai: string, so: number | bigint, thapNhat: boolean, kemCa: boolean): string {
  const n = String(so);
  if (loai === 'string') return thapNhat ? `Cần ít nhất ${n} ký tự.` : `Tối đa ${n} ký tự.`;
  if (loai === 'array' || loai === 'set') {
    return thapNhat ? `Hãy chọn ít nhất ${n} mục.` : `Chọn nhiều nhất ${n} mục.`;
  }
  if (loai === 'date') return thapNhat ? `Ngày phải từ ${n} trở đi.` : `Ngày phải trước ${n}.`;
  // Số: `inclusive` đổi hẳn nghĩa của câu, nên phải nói ra.
  if (thapNhat) return kemCa ? `Phải từ ${n} trở lên.` : `Phải lớn hơn ${n}.`;
  return kemCa ? `Phải từ ${n} trở xuống.` : `Phải nhỏ hơn ${n}.`;
}

const LOI_CHUOI: Record<string, string> = {
  email: 'Email không hợp lệ.',
  url: 'Địa chỉ web không hợp lệ.',
  uuid: 'Mã không hợp lệ.',
  datetime: 'Thời điểm không hợp lệ.',
  date: 'Ngày không hợp lệ.',
  regex: 'Giá trị không đúng định dạng.',
};

export const banDoLoiTiengViet: ZodErrorMap = (issue) => {
  const vangMat = thieu(issue);
  if (vangMat !== null) return { message: vangMat };

  switch (issue.code) {
    case z.ZodIssueCode.invalid_type: {
      const ten = TEN_KIEU[String(issue.expected)];
      return {
        message: ten === undefined ? 'Giá trị không hợp lệ.' : `Giá trị phải là ${ten}.`,
      };
    }

    case z.ZodIssueCode.too_small:
      return { message: nguong(issue.type, issue.minimum, true, issue.inclusive !== false) };

    case z.ZodIssueCode.too_big:
      return { message: nguong(issue.type, issue.maximum, false, issue.inclusive !== false) };

    /*
     * KHÔNG kể ra danh sách giá trị hợp lệ. Câu mặc định của zod in cả tập
     * (`Expected 'admin' | 'creator' | 'viewer'`); với một ô người dùng tự gõ
     * thì đó là thông tin có ích, nhưng mọi ô kiểu enum trong sản phẩm này đều
     * là một danh sách chọn sẵn, nên người gửi được giá trị lạ là người đang
     * gọi API trực tiếp — và với họ thì chỗ để đọc là tài liệu, không phải câu
     * báo lỗi.
     */
    case z.ZodIssueCode.invalid_enum_value:
    case z.ZodIssueCode.invalid_literal:
      return { message: 'Giá trị không nằm trong danh sách cho phép.' };

    case z.ZodIssueCode.invalid_string: {
      const kieu = typeof issue.validation === 'string' ? issue.validation : 'regex';
      return { message: LOI_CHUOI[kieu] ?? 'Giá trị không đúng định dạng.' };
    }

    case z.ZodIssueCode.unrecognized_keys:
      return { message: 'Có trường không được chấp nhận.' };

    case z.ZodIssueCode.not_multiple_of:
      return { message: `Phải là bội số của ${String(issue.multipleOf)}.` };

    case z.ZodIssueCode.invalid_date:
      return { message: 'Ngày không hợp lệ.' };

    /*
     * Nhánh cuối CỐ Ý không rơi về `ctx.defaultError`: đó là câu tiếng Anh, tức
     * đúng thứ tệp này tồn tại để bỏ đi. Một câu chung tiếng Việt kém chính xác
     * hơn câu mặc định, nhưng nó đọc được — còn mã lỗi dành cho người đi sửa
     * thì đã nằm trong log.
     */
    default:
      return { message: 'Giá trị không hợp lệ.' };
  }
};

/** Gọi MỘT LẦN lúc khởi động, ở cả backend và frontend. */
export function datLoiTiengViet(): void {
  z.setErrorMap(banDoLoiTiengViet);
}
