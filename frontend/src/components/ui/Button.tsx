import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
type Size = 'sm' | 'md';

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: Variant;
  size?: Size;
  /** Hiện spinner và tự khoá nút. */
  loading?: boolean;
  children: ReactNode;
}

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 disabled:bg-slate-300',
  secondary:
    'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:text-slate-400',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-slate-300',
  ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:text-slate-300',
};

const SIZES: Record<Size, string> = {
  sm: 'px-2.5 py-1.5 text-xs',
  md: 'px-4 py-2.5 text-sm',
};

/**
 * Nút bấm dùng chung.
 *
 * Trước file này, mỗi trang tự viết một chuỗi className riêng — LoginPage,
 * ForbiddenPage, NotFoundPage và AdminLayout mỗi nơi một kiểu, và chúng đã lệch
 * nhau về padding lẫn màu hover. Gom về một chỗ để nút ở trang mới không phải
 * đoán xem sao chép từ trang nào.
 *
 * Hai điểm không được bỏ:
 *
 * 1. `disabled` phải NHÌN LÀ BIẾT. Nút khoá mà trông y hệt nút bấm được thì
 *    người dùng bấm mãi rồi tưởng hệ thống treo.
 * 2. `type` mặc định của thẻ <button> trong form là "submit". Một nút "Huỷ"
 *    trong modal mà quên khai `type="button"` sẽ gửi luôn form — nên ở đây
 *    mặc định là "button", ai cần submit thì khai tường minh.
 */
export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  disabled,
  children,
  type = 'button',
  ...rest
}: ButtonProps): React.ReactElement {
  return (
    <button
      type={type}
      disabled={disabled === true || loading}
      className={[
        'inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed',
        VARIANTS[variant],
        SIZES[size],
      ].join(' ')}
      {...rest}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

function Spinner(): React.ReactElement {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
    </svg>
  );
}
