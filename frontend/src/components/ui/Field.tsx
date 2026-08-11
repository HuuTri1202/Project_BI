import { useId, useState, type ReactNode } from 'react';
import type { UseFormRegisterReturn } from 'react-hook-form';

interface FieldShellProps {
  label: string;
  error?: string | undefined;
  hint?: string;
  /** Nhận id và id của phần mô tả để gắn vào control — xem giải thích useId bên dưới. */
  children: (ids: { id: string; describedBy: string | undefined }) => ReactNode;
}

/**
 * Khung chung: nhãn ở trên, control ở giữa, thông báo lỗi hoặc gợi ý ở dưới.
 *
 * `useId()` chứ không dùng tên trường làm id: tên trường chỉ duy nhất TRONG một
 * form, còn id phải duy nhất trong cả trang. Hôm nào có hai form trên cùng một
 * trang (đăng nhập ở modal chẳng hạn) thì `htmlFor` sẽ trỏ nhầm ô, và lỗi đó im
 * lặng — bấm vào nhãn lại nhảy con trỏ sang ô của form kia.
 */
function FieldShell({ label, error, hint, children }: FieldShellProps) {
  const id = useId();
  const describedById = `${id}-desc`;
  const describedBy = error || hint ? describedById : undefined;

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">
        {label}
      </label>

      {children({ id, describedBy })}

      {error ? (
        <p id={describedById} role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : (
        hint && (
          <p id={describedById} className="text-sm text-slate-500">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

/** Viền + focus ring dùng chung cho input và select, đổi màu theo trạng thái lỗi. */
function controlClass(error: string | undefined, extra = ''): string {
  return [
    'block w-full rounded-lg border bg-white px-3.5 py-2.5 text-slate-900 shadow-sm',
    'placeholder:text-slate-400 transition-colors outline-none',
    'focus:ring-2 focus:ring-offset-0',
    extra,
    error
      ? 'border-red-400 focus:border-red-500 focus:ring-red-200'
      : 'border-slate-300 focus:border-brand-500 focus:ring-brand-200',
  ]
    .filter(Boolean)
    .join(' ');
}

interface FieldProps {
  label: string;
  registration: UseFormRegisterReturn;
  error?: string | undefined;
  hint?: string;
  type?: string;
  autoComplete?: string;
  /** Hiện nút con mắt để xem mật khẩu vừa gõ. */
  revealable?: boolean;
}

export function Field({
  label,
  registration,
  error,
  hint,
  type = 'text',
  autoComplete,
  revealable = false,
}: FieldProps) {
  const [revealed, setRevealed] = useState(false);
  const inputType = revealable && revealed ? 'text' : type;

  return (
    <FieldShell label={label} error={error} hint={hint}>
      {({ id, describedBy }) => (
        <div className="relative">
          <input
            id={id}
            type={inputType}
            autoComplete={autoComplete}
            aria-invalid={Boolean(error)}
            aria-describedby={describedBy}
            className={controlClass(error, revealable ? 'pr-11' : '')}
            {...registration}
          />

          {revealable && (
            <button
              type="button"
              // tabIndex={-1}: nút này không được nằm trong luồng Tab, nếu không
              // người dùng bàn phím phải bấm Tab hai lần mới rời khỏi ô mật khẩu.
              tabIndex={-1}
              onClick={() => setRevealed((v) => !v)}
              aria-label={revealed ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
              className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-600"
            >
              {revealed ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          )}
        </div>
      )}
    </FieldShell>
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectFieldProps {
  label: string;
  registration: UseFormRegisterReturn;
  /**
   * Nhận cả mảng chuỗi lẫn mảng {value,label}.
   *
   * Dạng chuỗi đủ cho danh sách chức danh (giá trị lưu vào DB chính là chữ hiển
   * thị). Nhưng vai trò thì lưu `admin` mà phải hiện "Quản trị viên", nên cần
   * dạng object — và viết một component select thứ hai chỉ vì khác chỗ đó thì
   * hai cái sẽ lệch nhau về giao diện ngay lần sửa đầu tiên.
   */
  options: readonly string[] | readonly SelectOption[];
  /** Dòng hiển thị khi chưa chọn gì. Nó có value rỗng nên form vẫn ở trạng thái chưa hợp lệ. */
  placeholder: string;
  /**
   * Cho phép quay lại "chưa chọn gì".
   *
   * Mặc định `false` vì form đăng ký BẮT BUỘC chọn chức danh — để người dùng bỏ
   * chọn lại chỉ tạo thêm một cách làm form không hợp lệ.
   *
   * Form hồ sơ (§4.4) thì ngược lại: chức danh không bắt buộc, và tài khoản do
   * Admin tạo có thể đang để trống. Không có cờ này thì một ô lỡ chọn sai sẽ
   * VĨNH VIỄN không xoá được — người dùng chỉ có thể đổi sang giá trị sai khác.
   */
  allowEmpty?: boolean;
  error?: string | undefined;
  hint?: string;
}

function normalizeOptions(
  options: readonly string[] | readonly SelectOption[],
): readonly SelectOption[] {
  return options.map((option) =>
    typeof option === 'string' ? { value: option, label: option } : option,
  );
}

export function SelectField({
  label,
  registration,
  options,
  placeholder,
  allowEmpty = false,
  error,
  hint,
}: SelectFieldProps) {
  return (
    <FieldShell label={label} error={error} hint={hint}>
      {({ id, describedBy }) => (
        <div className="relative">
          <select
            id={id}
            aria-invalid={Boolean(error)}
            aria-describedby={describedBy}
            // appearance-none + mũi tên tự vẽ: mũi tên mặc định của <select> khác
            // nhau hẳn giữa Chrome/Firefox/Safari và không đổi màu theo trạng
            // thái lỗi được.
            className={controlClass(error, 'appearance-none pr-10')}
            defaultValue=""
            {...registration}
          >
            {/* disabled + value rỗng: người dùng không quay lại chọn "trống"
                được sau khi đã chọn, và giá trị rỗng khiến zod báo chưa hợp lệ
                nên nút Submit vẫn khoá đúng như yêu cầu.
                `allowEmpty` bỏ `disabled` cho những form mà trống là hợp lệ. */}
            <option value="" disabled={!allowEmpty}>
              {placeholder}
            </option>
            {normalizeOptions(options).map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-slate-400">
            <ChevronDownIcon />
          </span>
        </div>
      )}
    </FieldShell>
  );
}

/* Icon vẽ inline thay vì kéo cả một thư viện icon về cho đúng ba hình. */

function ChevronDownIcon() {
  return (
    <svg
      className="h-5 w-5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg
      className="h-5 w-5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      className="h-5 w-5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <path d="M3 3l18 18" />
      <path d="M10.6 6.1A9.9 9.9 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-2.9 3.6" />
      <path d="M6.4 6.9A17 17 0 0 0 2.5 12S6 18 12 18a9.6 9.6 0 0 0 3.6-.7" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  );
}
