import { APP_NAME } from '@bi/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { validateNewPassword } from '../auth/validators';
import { FullPageLoader } from '../components/FullPageLoader';
import { PasswordInput } from '../components/PasswordInput';
import { datLaiMatKhau, kiemLienKetDatLai } from '../features/auth/api';
import { getApiError } from '../services/apiClient';

/**
 * Quên mật khẩu — bước 2: đặt mật khẩu mới.
 *
 * ─── Vì sao KIỂM vé ngay khi mở trang ───────────────────────────────────────
 *
 * Không kiểm thì người mở một liên kết đã hết hạn sẽ nghĩ ra mật khẩu mới, gõ
 * hai lần, bấm nút — rồi mới biết là vô ích. Một lời gọi lúc mở trang đổi trải
 * nghiệm đó lấy khoảng 200ms.
 *
 * ─── Vé đi vào body, không đi vào query của API ─────────────────────────────
 *
 * Vé nằm trên URL của trình duyệt vì đó là cách duy nhất đưa nó từ email sang
 * đây. Nhưng từ trang này trở đi nó chỉ đi trong body POST — xem `features/auth/api.ts`.
 *
 * ─── Không tự đăng nhập sau khi đổi ─────────────────────────────────────────
 *
 * Cùng lập luận với trang đăng ký: lần đăng nhập đầu tiên là lần duy nhất chứng
 * minh mật khẩu vừa đặt đúng như người dùng nghĩ. Gõ nhầm thì họ biết ngay bây
 * giờ, lúc còn nhớ mình vừa gõ gì.
 */
type TrangThai = 'dang-kiem' | 'hop-le' | 'hong';

export default function ResetPasswordPage(): React.ReactElement {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';

  const [trangThai, setTrangThai] = useState<TrangThai>('dang-kiem');
  const [loiVe, setLoiVe] = useState<string | null>(null);

  const [values, setValues] = useState({ newPassword: '', confirmPassword: '' });
  const [touched, setTouched] = useState({ newPassword: false, confirmPassword: false });
  const [errors, setErrors] = useState<{ newPassword?: string; confirmPassword?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (token === '') {
      setLoiVe('Liên kết thiếu mã đặt lại mật khẩu. Hãy mở lại liên kết trong email.');
      setTrangThai('hong');
      return;
    }

    let conHieuLuc = true;
    void kiemLienKetDatLai(token).then(
      () => {
        // Người dùng đã rời trang thì đừng gọi setState — React sẽ cảnh báo, và
        // tệ hơn là ta ghi đè trạng thái của trang họ vừa mở.
        if (conHieuLuc) setTrangThai('hop-le');
      },
      (err: unknown) => {
        if (!conHieuLuc) return;
        setLoiVe(getApiError(err).message);
        setTrangThai('hong');
      },
    );

    return () => {
      conHieuLuc = false;
    };
  }, [token]);

  function kiemTruong(ten: 'newPassword' | 'confirmPassword', giaTri: string): string | undefined {
    if (ten === 'newPassword') return validateNewPassword(giaTri);
    if (!giaTri) return 'Vui lòng nhập lại mật khẩu';
    return giaTri === values.newPassword ? undefined : 'Mật khẩu nhập lại không khớp';
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError(null);

    const next = {
      newPassword: validateNewPassword(values.newPassword),
      confirmPassword:
        values.confirmPassword === ''
          ? 'Vui lòng nhập lại mật khẩu'
          : values.confirmPassword === values.newPassword
            ? undefined
            : 'Mật khẩu nhập lại không khớp',
    };
    setTouched({ newPassword: true, confirmPassword: true });
    setErrors(next);
    if (next.newPassword || next.confirmPassword) return;

    setSubmitting(true);
    try {
      await datLaiMatKhau(token, values.newPassword);
      navigate('/login', {
        replace: true,
        state: { datLaiXong: true },
      });
    } catch (err) {
      const apiError = getApiError(err);
      if (apiError.fields?.['newPassword']) {
        setErrors((prev) => ({ ...prev, newPassword: apiError.fields?.['newPassword'] }));
      } else {
        setFormError(apiError.message);
      }
      setSubmitting(false);
    }
  }

  if (trangThai === 'dang-kiem') return <FullPageLoader label="Đang kiểm tra liên kết…" />;

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <header className="mb-7 text-center">
            <h1 className="text-2xl font-bold tracking-tight text-brand-700">{APP_NAME}</h1>
            <p className="mt-1.5 text-sm text-slate-500">Đặt mật khẩu mới</p>
          </header>

          {trangThai === 'hong' ? (
            <>
              <div
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
              >
                {loiVe}
              </div>
              <Link
                to="/quen-mat-khau"
                className="mt-6 block w-full rounded-lg bg-brand-600 px-4 py-2.5 text-center text-sm font-semibold text-white transition-colors hover:bg-brand-700"
              >
                Xin liên kết mới
              </Link>
            </>
          ) : (
            <>
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
                  id="newPassword"
                  label="Mật khẩu mới"
                  value={values.newPassword}
                  onChange={(e) => {
                    const v = e.target.value;
                    setValues((prev) => ({ ...prev, newPassword: v }));
                    if (touched.newPassword) {
                      setErrors((prev) => ({ ...prev, newPassword: validateNewPassword(v) }));
                    }
                  }}
                  onBlur={() => {
                    setTouched((prev) => ({ ...prev, newPassword: true }));
                    setErrors((prev) => ({
                      ...prev,
                      newPassword: kiemTruong('newPassword', values.newPassword),
                    }));
                  }}
                  error={touched.newPassword ? errors.newPassword : undefined}
                  autoComplete="new-password"
                  placeholder="••••••••"
                  disabled={submitting}
                  autoFocus
                />

                <PasswordInput
                  id="confirmPassword"
                  label="Nhập lại mật khẩu mới"
                  value={values.confirmPassword}
                  onChange={(e) => {
                    const v = e.target.value;
                    setValues((prev) => ({ ...prev, confirmPassword: v }));
                    if (touched.confirmPassword) {
                      setErrors((prev) => ({
                        ...prev,
                        confirmPassword: kiemTruong('confirmPassword', v),
                      }));
                    }
                  }}
                  onBlur={() => {
                    setTouched((prev) => ({ ...prev, confirmPassword: true }));
                    setErrors((prev) => ({
                      ...prev,
                      confirmPassword: kiemTruong('confirmPassword', values.confirmPassword),
                    }));
                  }}
                  error={touched.confirmPassword ? errors.confirmPassword : undefined}
                  autoComplete="new-password"
                  placeholder="••••••••"
                  disabled={submitting}
                />

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? 'Đang lưu…' : 'Đặt mật khẩu mới'}
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
