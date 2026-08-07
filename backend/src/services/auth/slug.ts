/**
 * Sinh slug ascii từ tên tiếng Việt.
 *
 * `NFD` tách ký tự có dấu thành chữ cái gốc + dấu tổ hợp, rồi xoá dải dấu
 * U+0300–U+036F. Cách này xử lý được toàn bộ nguyên âm có dấu mà không cần bảng
 * tra: "Công ty Đại Việt" -> "cong ty ai viet"… trừ chữ Đ/đ.
 *
 * Đ/đ phải thay TAY vì nó không phải "D + dấu tổ hợp" trong Unicode — nó là một
 * ký tự riêng (U+0110/U+0111), nên NFD không tách được gì và nó sẽ bị bước lọc
 * [^a-z0-9] xoá sạch. Thiếu hai dòng đó thì "Đại Việt" ra "ai-viet".
 */
export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/**
 * Slug dự phòng khi tên rút gọn xong không còn ký tự nào.
 *
 * Xảy ra với tên thuần chữ Hán, Nhật, Hàn hoặc chỉ gồm ký hiệu — hiếm nhưng
 * không phải không có, và một slug rỗng sẽ vi phạm ràng buộc NOT NULL hoặc tạo
 * ra URL cụt.
 */
export function slugifyOrFallback(input: string, fallbackPrefix = 'to-chuc'): string {
  const slug = slugify(input);
  return slug || fallbackPrefix;
}
