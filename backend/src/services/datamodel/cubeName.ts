import type { MeasureAgg } from '@bi/shared';

/**
 * Sinh định danh cho file cube schema — §10, TOÀN BỘ hàm thuần.
 *
 * ─── Vì sao SINH chứ không NHẬN, và vì sao đây là chuyện an toàn ────────────
 *
 * File cube schema KHÔNG phải dữ liệu. Nó là mã JavaScript mà Cube `require()`
 * rồi chạy. Tên cube, tên chiều và tên thước đo trong đó là KHOÁ CỦA OBJECT JS:
 *
 *     cube(`dm12_ds77`, { dimensions: { d341: { ... } } })
 *
 * Khoá object không escape được — không có hàm nào biến một chuỗi tuỳ ý thành
 * một định danh JS an toàn mà vẫn giữ nguyên chuỗi đó. Nên cách duy nhất đúng là
 * KHÔNG BAO GIỜ để tên người dùng làm khoá: mọi định danh sinh hoàn toàn từ số
 * nguyên do hệ thống cấp.
 *
 * Đây đúng là lập luận `buildDdl.ts` đã dùng cho tên bảng ClickHouse, và nó
 * thắng ở đây vì cùng bốn lý do: không tham số hoá được, đổi tên là mất liên
 * kết, va chạm giữa hai thứ trùng tên, và ký tự lạ trong tên do người dùng đặt
 * (tên sheet Excel thật có dấu tiếng Việt, khoảng trắng, emoji).
 *
 * Tên NGƯỜI DÙNG THẤY đi vào `title:` — nơi nó là GIÁ TRỊ CHUỖI, và ở đó
 * `JSON.stringify` xử lý được mọi ký tự. Xem `buildCubeSchema.ts`.
 *
 * ─── Lợi ích phụ, hoá ra lại quan trọng ─────────────────────────────────────
 *
 * Vì định danh dựa trên id chứ không dựa trên tên, người dùng đổi alias của một
 * cột KHÔNG làm hỏng một truy vấn đã lưu. Cái giá là file sinh ra khó đọc bằng
 * mắt — chấp nhận được, vì mỗi định danh đều có một chú thích `//` mang tên thật
 * ngay bên cạnh.
 */

/**
 * Tên cube — một bộ dữ liệu trong một mô hình.
 *
 * Mang cả `dataModelId` lẫn `datasetId` vì cùng một bộ dữ liệu có thể nằm trong
 * nhiều mô hình với cách phân loại khác nhau, và hai mô hình biên dịch trong
 * cùng một ngữ cảnh Cube của tổ chức. Chỉ lấy `datasetId` thì hai mô hình cùng
 * dùng một bộ dữ liệu sẽ khai trùng tên cube và cái sau đè cái trước.
 */
export function cubeNameFor(dataModelId: number, datasetId: number): string {
  assertPositiveInt(dataModelId, 'dataModelId');
  assertPositiveInt(datasetId, 'datasetId');
  return `dm${dataModelId}_ds${datasetId}`;
}

/** Tên file trong `model/tenants/{tenantId}/`. Một mô hình một file. */
export function cubeFileNameFor(dataModelId: number): string {
  assertPositiveInt(dataModelId, 'dataModelId');
  return `dm${dataModelId}.js`;
}

/** Khoá của một chiều. `d` + id dòng `datamodel_columns`. */
export function dimensionNameFor(columnId: number): string {
  assertPositiveInt(columnId, 'columnId');
  return `d${columnId}`;
}

/**
 * Hậu tố của một biến thể phép gộp.
 *
 * Bảng ĐÓNG, không nội suy thẳng chuỗi `agg` vào tên. Sáu giá trị hiện tại đều
 * là chữ cái nên nội suy cũng chạy, nhưng cả file này đứng trên đúng một luật:
 * định danh trong file cube sinh từ từ vựng của HỆ THỐNG, không từ một chuỗi
 * đi ngang qua. Một phép gộp mới thêm vào `MEASURE_AGGS` mà quên dòng ở đây là
 * lỗi BIÊN DỊCH nhờ `Record<MeasureAgg, string>`, chứ không phải một định danh
 * lạ lọt vào file rồi Cube từ chối cả tổ chức.
 */
const AGG_SUFFIX: Record<MeasureAgg, string> = {
  sum: 'sum',
  avg: 'avg',
  count: 'cnt',
  countDistinct: 'cntd',
  countDistinctApprox: 'cntda',
  min: 'min',
  max: 'max',
};

/**
 * Khoá của một thước đo. `m` + id dòng `datamodel_measures`.
 *
 * Có `agg` = khoá của BIẾN THỂ dùng phép gộp đó (`m237_avg`). File cube phát ra
 * một biến thể cho mỗi phép mà cột nhận được, để Explorer đổi phép tại chỗ:
 * Cube chỉ hỏi được những thước đo đã KHAI SẴN trong schema, nên "gộp kiểu khác"
 * lúc chạy thật ra là "hỏi một thước đo khác đã dựng sẵn".
 */
export function measureNameFor(measureId: number, agg?: MeasureAgg): string {
  assertPositiveInt(measureId, 'measureId');
  return agg === undefined ? `m${measureId}` : `m${measureId}_${AGG_SUFFIX[agg]}`;
}

/**
 * Khoá của chiều khoá chính ẩn.
 *
 * Hằng số, không sinh: mỗi cube có đúng một cột `_row_index`, và nó là cột hệ
 * thống nên không có id trong `datamodel_columns` để mà lấy.
 */
export const PRIMARY_KEY_DIMENSION = 'row_index';

/**
 * Chặn ngay tại nguồn nếu id không phải số nguyên dương.
 *
 * Cả lập luận an toàn ở trên đứng trên đúng một giả định: những tham số này là
 * SỐ. Kiểm lại ở đây rẻ, và nó biến một giả định thành một bảo đảm — kể cả khi
 * có người sau này gọi hàm với một giá trị đọc từ chỗ khác. Cùng khuôn với
 * `assertPositiveInt` trong `buildDdl.ts`.
 */
function assertPositiveInt(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} phải là số nguyên dương, nhận được: ${String(value)}`);
  }
}
