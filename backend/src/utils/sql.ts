/**
 * Escape ký tự đại diện của LIKE trước khi bọc dấu `%`.
 *
 * Không escape thì tìm "100%" thành `LIKE '%100%%'` — khớp MỌI dòng, tức là ô
 * tìm kiếm trả về toàn bộ danh sách và người dùng tưởng nó hỏng. Tương tự, `_`
 * khớp một ký tự bất kỳ (email có gạch dưới là chuyện thường ngày), và một dấu
 * `\` lẻ làm hỏng cả pattern.
 *
 * Luôn đi kèm `ESCAPE '\\'` trong câu SQL, nếu không MySQL sẽ không hiểu dấu
 * gạch chéo mà hàm này thêm vào.
 */
export function escapeLikeTerm(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}
