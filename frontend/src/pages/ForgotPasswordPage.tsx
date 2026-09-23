import { APP_NAME } from '@bi/shared';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { validateEmail } from '../auth/validators';
import { FormField } from '../components/FormField';
import { xinLienKetDatLai } from '../features/auth/api';
import { getApiError } from '../services/apiClient';

/**
 * Quên mật khẩu — bước 1: xin liên kết.
 *
 * ─── Vì sao màn hình này KHÔNG nói "đã gửi tới email của bạn" ────────────────
 *
 * Backend cố ý trả cùng một phản hồi cho email có thật và email không tồn tại,
 * để endpoint này không thành máy dò xem ai có tài khoản (xem
 * `services/auth/passwordReset.ts`). Nếu giao diện lại viết "Đã gửi thư tới
 * you@example.com" thì nó khẳng định hộ backend đúng cái điều backend vừa cẩn
 * thận không nói.
 *
 * Nên câu chữ ở đây phải mở đúng bằng phần sự thật ta biết: "NẾU email này có
 * tài khoản". Câu đó do chính backend trả về, không viết lại ở frontend — hai
 * bản chép tay của cùng một lời hứa sớm muộn sẽ lệch.
 *
 * ─── Vì sao không chuyển trang sau khi gửi ──────────────────────────────────
 *
 * Người dùng cần ở lại để đọc câu "kiểm tra cả hộp thư rác" và để bấm gửi lại
 * nếu gõ nhầm email. Đẩy họ về /login là lấy mất cả hai.
 */
export default function ForgotPasswordPage(): React.ReactElement {
  const [email, setEmail] = useState('');
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [formError, setFormError] = useState<string | null>(null);
  const [daGui, setDaGui] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError(null);

    const loi = validateEmail(email);
    setTouched(true);
    setError(loi);
    if (loi) return;

    setSubmitting(true);
    try {
      setDaGui(await xinLienKetDatLai(email.trim()));
    } catch (err) {
      const apiError = getApiError(err);
      if (apiError.fields?.['email']) setError(apiError.fields['email']);
      else setFormError(apiError.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <header className="mb-7 text-center">
            <h1 className="text-2xl font-bold tracking-tight text-brand-700">{APP_NAME}</h1>
            <p className="mt-1.5 text-sm text-slate-500">Đặt lại mật khẩu</p>
          </header>

          {daGui !== null ? (
            <>
              <div
                role="status"
                className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
              >
                {daGui}
              </div>
              <p className="mt-5 text-sm text-slate-500">
                Liên kết chỉ dùng được một lần và sẽ hết hạn sau một giờ. Chưa thấy thư?{' '}
                <button
                  type="button"
                  onClick={() => setDaGui(null)}
                  className="font-medium text-brand-600 underline-offset-2 hover:text-brand-700 hover:underline"
                >
                  Gửi lại
                </button>
              </p>
            </>
          ) : (
            <>
              <p className="mb-6 text-sm text-slate-600">
                Nhập email bạn dùng để đăng nhập. Chúng tôi sẽ gửi một liên kết để bạn tự đặt mật
                khẩu mới.
              </p>

              {formError && (
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
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (touched) setError(validateEmail(e.target.value));
                  }}
                  onBlur={() => {
                    setTouched(true);
                    setError(validateEmail(email));
                  }}
                  error={touched ? error : undefined}
                  autoComplete="username"
                  placeholder="ban@congty.com"
                  disabled={submitting}
                  autoFocus
                />

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? 'Đang gửi…' : 'Gửi liên kết đặt lại'}
                </button>
              </form>
            </>
          )}
        </div>

        <p className="mt-6 text-center text-sm text-slate-500">
          <Link to="/login" className="font-medium text-brand-600 hover:text-brand-700">
            Quay lại đăng nhập
          </Link>
        </p>
      </div>
    </main>
  );
}
