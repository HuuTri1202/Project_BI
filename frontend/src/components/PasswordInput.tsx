import { useState, type InputHTMLAttributes } from 'react';
import { ERROR_CLASS, LABEL_CLASS, inputClass } from './formStyles';

interface PasswordInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'id' | 'className' | 'type'
> {
  id: string;
  label: string;
  error?: string | undefined;
}

/** Con mắt mở / gạch chéo. Vẽ tay bằng SVG để khỏi kéo cả bộ icon về. */
function EyeIcon({ crossed }: { crossed: boolean }): React.ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z" />
      <circle cx="12" cy="12" r="2.8" />
      {crossed && <path d="m4 20 16-16" />}
    </svg>
  );
}

/**
 * Ô mật khẩu kèm nút hiện/ẩn — §1.3, §2.1.
 *
 * Trạng thái hiện/ẩn là việc riêng của ô này nên giữ trong chính nó; trang gọi
 * không cần biết và không cần truyền thêm props.
 */
export function PasswordInput({
  id,
  label,
  error,
  ...inputProps
}: PasswordInputProps): React.ReactElement {
  const [visible, setVisible] = useState(false);
  const errorId = `${id}-error`;

  return (
    <div>
      <label htmlFor={id} className={LABEL_CLASS}>
        {label}
      </label>

      <div className="relative">
        <input
          {...inputProps}
          id={id}
          type={visible ? 'text' : 'password'}
          className={`${inputClass(Boolean(error))} pr-11`}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
        />

        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          // `tabIndex={-1}` để phím Tab đi thẳng từ ô mật khẩu sang nút Đăng
          // nhập. Nút vẫn bấm được bằng chuột và vẫn có aria-label cho trình
          // đọc màn hình — chỉ là không chen vào giữa luồng điền form.
          tabIndex={-1}
          aria-label={visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
          aria-pressed={visible}
          className="absolute inset-y-0 right-0 flex items-center rounded-r-lg px-3 text-slate-400 transition-colors hover:text-slate-600"
        >
          <EyeIcon crossed={visible} />
        </button>
      </div>

      {error && (
        <p id={errorId} className={ERROR_CLASS}>
          {error}
        </p>
      )}
    </div>
  );
}
