import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { validateNewPassword } from '../auth/validators';
import { PasswordInput } from '../components/PasswordInput';
import { getApiError } from '../services/apiClient';
import { changePassword } from '../services/authApi';

type FieldName = 'currentPassword' | 'newPassword' | 'confirmPassword';
type Errors = Partial<Record<FieldName, string>>;

const EMPTY_TOUCHED: Record<FieldName, boolean> = {
  currentPassword: false,
  newPassword: false,
  confirmPassword: false,
};

export default function ChangePasswordPage(): React.ReactElement {
  const { user, role, logout, markPasswordChanged } = useAuth();
  const navigate = useNavigate();

  const [values, setValues] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [touched, setTouched] = useState(EMPTY_TOUCHED);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const forced = user?.mustChangePassword ?? false;

  function validateField(name: FieldName, next = values): string | undefined {
    switch (name) {
      case 'currentPassword':
        return next.currentPassword ? undefined : 'Vui lòng nhập mật khẩu hiện tại';
      case 'newPassword': {
        const lengthError = validateNewPassword(next.newPassword);
        if (lengthError) return lengthError;
        // Backend cũng chặn luật này; kiểm ở đây để người dùng biết ngay thay vì
        // bấm gửi rồi mới nhận lỗi.
        if (next.newPassword === next.currentPassword) {
          return 'Mật khẩu mới phải khác mật khẩu hiện tại';
        }
        return undefined;
      }
      case 'confirmPassword':
        if (!next.confirmPassword) return 'Vui lòng nhập lại mật khẩu mới';
        if (next.confirmPassword !== next.newPassword) return 'Hai mật khẩu không khớp';
        return undefined;
    }
  }

  function handleChange(name: FieldName, value: string): void {
    const next = { ...values, [name]: value };
    setValues(next);
    if (!touched[name]) return;

    // Sửa mật khẩu mới thì ô "nhập lại" cũng phải được chấm lại — nếu không,
    // lỗi "hai mật khẩu không khớp" vẫn đứng đó dù người dùng đã sửa xong.
    setErrors((prev) => ({
      ...prev,
      [name]: validateField(name, next),
      ...(name === 'newPassword' && touched.confirmPassword
        ? { confirmPassword: validateField('confirmPassword', next) }
        : {}),
    }));
  }

  function handleBlur(name: FieldName): void {
    setTouched((prev) => ({ ...prev, [name]: true }));
    setErrors((prev) => ({ ...prev, [name]: validateField(name) }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError(null);

    const nextErrors: Errors = {
      currentPassword: validateField('currentPassword'),
      newPassword: validateField('newPassword'),
      confirmPassword: validateField('confirmPassword'),
    };
    setTouched({ currentPassword: true, newPassword: true, confirmPassword: true });
    setErrors(nextErrors);
    if (nextErrors.currentPassword || nextErrors.newPassword || nextErrors.confirmPassword) return;

    setSubmitting(true);
    try {
      await changePassword(values.currentPassword, values.newPassword);
      markPasswordChanged();
      navigate(role === 'admin' ? '/admin' : '/', { replace: true });
    } catch (err) {
      const apiError = getApiError(err);
      if (apiError.fields) {
        setErrors({
          currentPassword: apiError.fields['currentPassword'],
          newPassword: apiError.fields['newPassword'],
        });
      } else {
        setFormError(apiError.message);
      }
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <header className="mb-6">
            <h1 className="text-xl font-bold text-slate-900">Đổi mật khẩu</h1>
            <p className="mt-1.5 text-sm text-slate-500">{user?.email}</p>
          </header>

          {forced && (
            <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Tài khoản đang dùng mật khẩu tạm. Hãy đặt mật khẩu mới để tiếp tục sử dụng hệ thống.
            </div>
          )}

          {formError && (
            <div
              role="alert"
              className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              {formError}
            </div>
          )}

          <form onSubmit={(e) => void handleSubmit(e)} noValidate className="space-y-5">
            <PasswordInput
              id="currentPassword"
              label="Mật khẩu hiện tại"
              value={values.currentPassword}
              onChange={(e) => handleChange('currentPassword', e.target.value)}
              onBlur={() => handleBlur('currentPassword')}
              error={touched.currentPassword ? errors.currentPassword : undefined}
              autoComplete="current-password"
              disabled={submitting}
              autoFocus
            />

            <PasswordInput
              id="newPassword"
              label="Mật khẩu mới"
              value={values.newPassword}
              onChange={(e) => handleChange('newPassword', e.target.value)}
              onBlur={() => handleBlur('newPassword')}
              error={touched.newPassword ? errors.newPassword : undefined}
              autoComplete="new-password"
              disabled={submitting}
            />

            <PasswordInput
              id="confirmPassword"
              label="Nhập lại mật khẩu mới"
              value={values.confirmPassword}
              onChange={(e) => handleChange('confirmPassword', e.target.value)}
              onBlur={() => handleBlur('confirmPassword')}
              error={touched.confirmPassword ? errors.confirmPassword : undefined}
              autoComplete="new-password"
              disabled={submitting}
            />

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? 'Đang lưu…' : 'Đổi mật khẩu'}
            </button>
          </form>
        </div>

        <button
          type="button"
          onClick={() => void logout()}
          className="mt-5 w-full text-center text-sm text-slate-500 transition-colors hover:text-slate-700"
        >
          Đăng xuất
        </button>
      </div>
    </main>
  );
}
