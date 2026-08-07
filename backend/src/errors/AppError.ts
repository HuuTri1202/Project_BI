/**
 * Lỗi có chủ đích — thứ ta muốn client nhìn thấy.
 *
 * Phân biệt với lỗi ngoài ý muốn (bug, mất kết nối DB): `errorHandler` chỉ trả
 * `message` ra ngoài khi lỗi là `AppError`. Mọi thứ khác thành 500 với nội dung
 * chung chung, vì message của chúng thường chứa chi tiết nội bộ (câu SQL, tên
 * bảng, có khi cả tham số bind).
 *
 * `fields` cố ý hẹp (tên trường -> danh sách thông báo) chứ không phải `unknown`:
 * nó chỉ được điền từ `ZodError.flatten().fieldErrors`, và có kiểu rõ ràng thì
 * frontend đọc được mà không phải ép kiểu.
 */
export class AppError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly code: string,
    message: string,
    readonly fields?: Readonly<Record<string, string[]>>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
