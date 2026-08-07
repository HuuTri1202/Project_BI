import type { InputHTMLAttributes } from 'react';
import { ERROR_CLASS, LABEL_CLASS, inputClass } from './formStyles';

interface FormFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'className'> {
  id: string;
  label: string;
  /** Chỉ truyền vào khi ô ĐÃ được chạm (touched) — xem quy tắc onBlur ở §2.2. */
  error?: string | undefined;
}

/**
 * Ô nhập kèm nhãn và thông báo lỗi.
 *
 * Ba chi tiết trợ năng bắt buộc, không phải trang trí:
 *  - `htmlFor` nối nhãn với ô -> bấm vào chữ là con trỏ nhảy vào ô.
 *  - `aria-invalid` để trình đọc màn hình biết ô đang sai.
 *  - `aria-describedby` trỏ tới đúng dòng lỗi -> trình đọc màn hình đọc luôn
 *    lý do sai, thay vì chỉ nói "không hợp lệ" rồi để người dùng tự đoán.
 */
export function FormField({ id, label, error, ...inputProps }: FormFieldProps): React.ReactElement {
  const errorId = `${id}-error`;

  return (
    <div>
      <label htmlFor={id} className={LABEL_CLASS}>
        {label}
      </label>

      <input
        {...inputProps}
        id={id}
        className={inputClass(Boolean(error))}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
      />

      {error && (
        <p id={errorId} className={ERROR_CLASS}>
          {error}
        </p>
      )}
    </div>
  );
}
