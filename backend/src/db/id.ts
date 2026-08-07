import { v7 as uuidv7 } from 'uuid';

/**
 * Sinh khoá chính cho mọi bảng.
 *
 * UUIDv7 chứ không phải `crypto.randomUUID()` (vốn là v4): 48 bit đầu của v7 là
 * timestamp mili-giây nên các bản ghi mới nằm gần nhau trong clustered index của
 * InnoDB — insert gần như nối đuôi, giống auto-increment, nhưng vẫn không đoán
 * được. v4 ngẫu nhiên toàn phần làm mỗi insert rơi vào một trang bất kỳ, gây
 * tách trang và phân mảnh index. Thêm một lợi ích: sắp theo id là sắp theo thời
 * điểm tạo, miễn phí.
 *
 * Id được sinh ở tầng ứng dụng TRƯỚC transaction, nên bốn câu INSERT lúc đăng ký
 * độc lập nhau và không cần vòng round-trip `LAST_INSERT_ID()` nào.
 */
export function newId(): string {
  return uuidv7();
}
