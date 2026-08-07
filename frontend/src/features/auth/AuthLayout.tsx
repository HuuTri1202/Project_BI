import type { ReactNode } from 'react';

interface AuthLayoutProps {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
}

/** Khung chung cho trang đăng ký và đăng nhập — cùng một cái thẻ giữa màn hình. */
export function AuthLayout({ title, subtitle, children, footer }: AuthLayoutProps) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-slate-50 to-slate-100 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-lg font-bold text-white">
            BI
          </span>
          <span className="text-lg font-semibold tracking-tight text-slate-900">BI Platform</span>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm sm:p-8">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
          <p className="mt-1.5 text-sm text-slate-500">{subtitle}</p>

          <div className="mt-6">{children}</div>
        </div>

        <p className="mt-5 text-center text-sm text-slate-600">{footer}</p>
      </div>
    </div>
  );
}

/** Banner lỗi ở đầu form — dùng cho lỗi không thuộc riêng ô nào. */
export function FormError({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="mb-5 flex gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700"
    >
      <svg
        className="mt-0.5 h-4 w-4 shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v5M12 16.5v.01" />
      </svg>
      <span>{message}</span>
    </div>
  );
}

interface SubmitButtonProps {
  disabled: boolean;
  loading: boolean;
  children: ReactNode;
  loadingLabel: string;
}

export function SubmitButton({ disabled, loading, children, loadingLabel }: SubmitButtonProps) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className={[
        'mt-6 flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5',
        'text-sm font-semibold text-white transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2',
        // Trạng thái disabled phải NHÌN LÀ BIẾT: nút này mặc định bị khoá cho tới
        // khi cả form hợp lệ, nên nếu nó trông y hệt nút bấm được thì người dùng
        // sẽ bấm mãi mà không hiểu vì sao không có gì xảy ra.
        'disabled:cursor-not-allowed disabled:bg-slate-300',
        'bg-brand-600 hover:bg-brand-700 active:bg-brand-700',
      ].join(' ')}
    >
      {loading && (
        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z"
          />
        </svg>
      )}
      {loading ? loadingLabel : children}
    </button>
  );
}
