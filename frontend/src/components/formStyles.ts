/**
 * Lớp Tailwind dùng chung cho các ô nhập.
 *
 * Để ở file riêng (không có component) vì hai lý do: `FormField` và
 * `PasswordInput` cùng dùng, và luật `react-refresh/only-export-components`
 * không thích file vừa export component vừa export thứ khác.
 */

const BASE_INPUT =
  'block w-full rounded-lg border bg-white px-3 py-2.5 text-sm text-slate-900 ' +
  'placeholder:text-slate-400 transition-colors ' +
  'disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500';

const NORMAL_BORDER = 'border-slate-300 focus:border-brand-500';
const ERROR_BORDER = 'border-red-400 focus:border-red-500';

/** Ô nhập bình thường / đang có lỗi. Viền đỏ, KHÔNG chỉ dựa vào màu — luôn có
 *  chữ báo lỗi kèm theo để người mù màu vẫn đọc được. */
export function inputClass(hasError: boolean): string {
  return `${BASE_INPUT} ${hasError ? ERROR_BORDER : NORMAL_BORDER}`;
}

export const LABEL_CLASS = 'mb-1.5 block text-sm font-medium text-slate-700';

export const ERROR_CLASS = 'mt-1.5 text-sm text-red-600';

/**
 * Chỗ CHỪA SẴN cho dòng lỗi, cao đúng một dòng dù đang có lỗi hay không.
 *
 * ─── Đây không phải chuyện thẩm mỹ. Nó sửa một lỗi bấm không được ──────────
 *
 * Trước đây dòng lỗi chỉ tồn tại khi có lỗi, nên lúc nó hiện ra mọi thứ bên
 * dưới tụt xuống 26px. Cái đó đủ để nuốt trọn một cú click:
 *
 *   1. Ô email có `autoFocus`, người dùng chưa gõ gì.
 *   2. Họ bấm vào "Quên mật khẩu?" ngay bên dưới.
 *   3. `mousedown` làm ô email mất focus -> hiện "Vui lòng nhập email".
 *   4. Liên kết tụt xuống 13px.
 *   5. `mouseup` rơi vào chỗ trống mà liên kết vừa rời khỏi.
 *
 * Trình duyệt chỉ sinh sự kiện `click` khi mousedown và mouseup cùng rơi vào
 * MỘT phần tử — nên không có click nào cả. Người dùng bấm, không có gì xảy ra,
 * và họ phải bấm lần thứ hai. Đo được trên Chromium: liên kết đi từ y=469 sang
 * y=482; điền sẵn email (không sinh lỗi, không xê dịch) thì bấm phát ăn ngay.
 *
 * Lỗi này dính cả liên kết "Đăng ký" vốn có từ trước, và nó cắn nặng nhất ở
 * đúng chỗ tệ nhất: người quên mật khẩu, vừa vào trang, chưa gõ gì.
 *
 * Chừa sẵn chỗ thì không có gì xê dịch, nên không có cú click nào rơi hụt. Phần
 * thưởng kèm theo: form thôi giật nảy mỗi lần một thông báo lỗi hiện ra.
 *
 * ⚠️ Chỉ chừa MỘT dòng. Thông báo dài phải xuống hai dòng trên màn hình hẹp thì
 * vẫn xê dịch — ít hơn hẳn, nhưng không phải bằng không. Muốn triệt để thì mọi
 * thông báo lỗi phải ngắn hơn một dòng ở 320px, và đó là việc của câu chữ.
 */
export const ERROR_SLOT_CLASS = 'min-h-[1.625rem]';
