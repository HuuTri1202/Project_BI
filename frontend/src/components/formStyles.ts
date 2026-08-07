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
