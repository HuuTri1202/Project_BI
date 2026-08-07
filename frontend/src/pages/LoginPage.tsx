import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { redirectTargetFor } from '../auth/redirectTarget';
import { useAuth } from '../auth/useAuth';
import { validateEmail, validateLoginPassword } from '../auth/validators';
import { FormField } from '../components/FormField';
import { FullPageLoader } from '../components/FullPageLoader';
import { PasswordInput } from '../components/PasswordInput';
import { getApiError } from '../services/apiClient';

type FieldName = 'email' | 'password';
type Errors = Partial<Record<FieldName, string>>;

/** Dữ liệu mà trang đăng ký gửi kèm khi điều hướng sang đây (§1.5). */
interface LoginLocationState {
  from?: string;
  registered?: boolean;
  email?: string;
}

export default function LoginPage(): React.ReactElement {
  const { status, user, role, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const incoming = (location.state ?? null) as LoginLocationState | null;

  // Vừa đăng ký xong: điền sẵn email, chỉ còn phải gõ mật khẩu. Đọc MỘT LẦN lúc
  // khởi tạo state chứ không đồng bộ theo `location` — nếu không, người dùng
  // sửa ô email rồi bấm Quay lại/Tiến sẽ bị ghi đè mất thứ họ vừa gõ.
  const [values, setValues] = useState({ email: incoming?.email ?? '', password: '' });
  const [justRegistered, setJustRegistered] = useState(incoming?.registered === true);
  const [touched, setTouched] = useState<Record<FieldName, boolean>>({
    email: false,
    password: false,
  });
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Cùng lý do với ProtectedRoute: token còn trong máy nhưng `GET /me` chưa
  // trả lời thì CHƯA biết người này là ai. Dựng form ra ngay sẽ nháy một nhịp
  // rồi bị đẩy đi khi câu trả lời về — F5 tại /login trông như trang bị giật.
  if (status === 'loading') return <FullPageLoader label="Đang khôi phục phiên…" />;

  // Đã đăng nhập mà quay lại /login thì đưa đi luôn, đừng bắt đăng nhập lại.
  if (status === 'authenticated' && user && role) {
    return <Navigate to={redirectTargetFor(user, role, incoming?.from)} replace />;
  }

  function validateField(name: FieldName, value: string): string | undefined {
    return name === 'email' ? validateEmail(value) : validateLoginPassword(value);
  }

  function handleChange(name: FieldName, value: string): void {
    setValues((prev) => ({ ...prev, [name]: value }));
    // Người dùng bắt đầu thao tác -> hạ lời chúc mừng đăng ký xuống. Để nó nằm
    // lại trong lúc họ đang sửa email hay nhận thông báo lỗi sẽ thành hai tin
    // trái ngược nhau cùng hiện trên một màn hình.
    setJustRegistered(false);
    // Chỉ validate lại khi ô ĐÃ chạm. Bắt lỗi ngay từ ký tự đầu tiên là kiểu
    // giao diện quát vào mặt người đang gõ dở.
    if (touched[name]) {
      setErrors((prev) => ({ ...prev, [name]: validateField(name, value) }));
    }
  }

  function handleBlur(name: FieldName): void {
    setTouched((prev) => ({ ...prev, [name]: true }));
    setErrors((prev) => ({ ...prev, [name]: validateField(name, values[name]) }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError(null);

    const nextErrors: Errors = {
      email: validateEmail(values.email),
      password: validateLoginPassword(values.password),
    };
    setTouched({ email: true, password: true });
    setErrors(nextErrors);
    if (nextErrors.email || nextErrors.password) return;

    setSubmitting(true);
    try {
      const outcome = await login(values.email.trim(), values.password);
      navigate(redirectTargetFor(outcome.user, outcome.role, incoming?.from), { replace: true });
    } catch (err) {
      const apiError = getApiError(err);
      // Lỗi validate của backend về theo từng trường; còn 401/403/429 chỉ có
      // một câu chung -> hiện ở đầu form.
      if (apiError.fields) {
        setErrors({
          email: apiError.fields['email'],
          password: apiError.fields['password'],
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
          <header className="mb-7 text-center">
            <h1 className="text-2xl font-bold tracking-tight text-brand-700">BI Platform</h1>
            <p className="mt-1.5 text-sm text-slate-500">Đăng nhập để vào hệ thống</p>
          </header>

          {justRegistered && !formError && (
            // §1.5 — vừa đăng ký xong. `role="status"` chứ không phải "alert":
            // đây là tin vui, không phải lỗi, nên trình đọc màn hình chỉ cần
            // đọc khi rảnh chứ không cắt ngang việc đang làm.
            <div
              role="status"
              className="mb-5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
            >
              Tạo tài khoản thành công. Đăng nhập bằng mật khẩu bạn vừa đặt để vào hệ thống.
            </div>
          )}

          {formError && (
            // role="alert" để trình đọc màn hình đọc ngay khi thông báo xuất
            // hiện, không cần người dùng tự đi tìm.
            <div
              role="alert"
              className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              {formError}
            </div>
          )}

          <form onSubmit={(e) => void handleSubmit(e)} noValidate className="space-y-5">
            <FormField
              id="email"
              label="Email"
              type="email"
              value={values.email}
              onChange={(e) => handleChange('email', e.target.value)}
              onBlur={() => handleBlur('email')}
              error={touched.email ? errors.email : undefined}
              autoComplete="username"
              placeholder="ban@congty.com"
              disabled={submitting}
              autoFocus
            />

            <PasswordInput
              id="password"
              label="Mật khẩu"
              value={values.password}
              onChange={(e) => handleChange('password', e.target.value)}
              onBlur={() => handleBlur('password')}
              error={touched.password ? errors.password : undefined}
              autoComplete="current-password"
              placeholder="••••••••"
              disabled={submitting}
            />

            <button
              type="submit"
              // Khoá nút khi đang gửi: bấm hai lần thật nhanh sẽ tính thành hai
              // lần đăng nhập, và bộ đếm chống dò mật khẩu ở backend đếm cả hai.
              disabled={submitting}
              className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? 'Đang đăng nhập…' : 'Đăng nhập'}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-sm text-slate-500">
          Chưa có tài khoản?{' '}
          <Link to="/register" className="font-medium text-brand-600 hover:text-brand-700">
            Đăng ký
          </Link>
        </p>
      </div>
    </main>
  );
}
