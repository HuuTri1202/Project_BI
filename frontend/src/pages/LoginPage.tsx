import { APP_NAME, ERROR_CODES } from '@bi/shared';
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { redirectTargetFor } from '../auth/redirectTarget';
import { useAuth } from '../auth/useAuth';
import { validateEmail, validateLoginPassword } from '../auth/validators';
import { FormField } from '../components/FormField';
import { guiLaiThuXacMinh } from '../features/auth/api';
import { NutGoogle } from '../features/auth/NutGoogle';
import { FullPageLoader } from '../components/FullPageLoader';
import { PasswordInput } from '../components/PasswordInput';
import { docGhiNho, ghiGhiNho } from '../auth/ghiNhoDangNhap';
import { getApiError } from '../services/apiClient';
import { GOOGLE_CHUA_DANG_KY } from '../services/authApi';

type FieldName = 'email' | 'password';
type Errors = Partial<Record<FieldName, string>>;

/** Dữ liệu mà trang đăng ký gửi kèm khi điều hướng sang đây (§1.5). */
interface LoginLocationState {
  from?: string;
  registered?: boolean;
  email?: string;
  /** Vừa đặt lại mật khẩu xong qua liên kết trong email. */
  datLaiXong?: boolean;
}

export default function LoginPage(): React.ReactElement {
  const { status, user, role, login, loginWithGoogle } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const incoming = (location.state ?? null) as LoginLocationState | null;

  // Vừa đăng ký xong: điền sẵn email, chỉ còn phải gõ mật khẩu. Đọc MỘT LẦN lúc
  // khởi tạo state chứ không đồng bộ theo `location` — nếu không, người dùng
  // sửa ô email rồi bấm Quay lại/Tiến sẽ bị ghi đè mất thứ họ vừa gõ.
  const [values, setValues] = useState({ email: incoming?.email ?? '', password: '' });
  const [justRegistered, setJustRegistered] = useState(incoming?.registered === true);
  const [vuaDatLai, setVuaDatLai] = useState(incoming?.datLaiXong === true);
  const [touched, setTouched] = useState<Record<FieldName, boolean>>({
    email: false,
    password: false,
  });
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  /*
   * Đọc cờ hiện có làm giá trị ban đầu: người đã tích ở lần trước mở lại trang
   * đăng nhập (vì token hết hạn 7 ngày) thì không phải tích lại.
   */
  const [ghiNho, setGhiNho] = useState(docGhiNho);

  /*
   * ─── Trạng thái riêng cho "email chưa xác minh" (§1.10) ────────────────────
   *
   * Đây là lỗi đăng nhập DUY NHẤT mà người dùng có thể tự xử lý ngay tại đây,
   * nên nó là lỗi duy nhất được kèm một hành động. Mọi lỗi khác (sai mật khẩu,
   * bị khoá, quá tần suất) chỉ còn cách gõ lại hoặc đi hỏi người khác.
   *
   * Nút gửi lại nằm NGAY TRONG hộp lỗi, không phải một dòng link ở cuối trang:
   * người đọc câu "email chưa được xác minh" cần thấy việc phải làm ở cùng chỗ,
   * chứ không phải đi tìm.
   */
  const [chuaXacMinh, setChuaXacMinh] = useState(false);
  const [dangGuiLai, setDangGuiLai] = useState(false);
  const [daGuiLai, setDaGuiLai] = useState<string | null>(null);

  async function guiLaiThu(): Promise<void> {
    setDangGuiLai(true);
    try {
      setDaGuiLai(await guiLaiThuXacMinh(values.email.trim()));
      // Hạ hộp lỗi xuống: để cả "chưa xác minh" lẫn "đã gửi lại" cùng hiện là
      // hai tin trái nhau trên một màn hình.
      setFormError(null);
      setChuaXacMinh(false);
    } catch (err) {
      setFormError(getApiError(err).message);
    } finally {
      setDangGuiLai(false);
    }
  }

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
    setVuaDatLai(false);
    setDaGuiLai(null);
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

  /**
   * Đăng nhập bằng Google — §1.9.
   *
   * Dùng lại ĐÚNG đường điều hướng của đăng nhập mật khẩu: cả hai trả về cùng
   * một `LoginOutcome`, nên luật "vào đâu sau khi đăng nhập" chỉ có một bản.
   *
   * ⚠️ NÉM LẠI lỗi thay vì tự hiện. `NutGoogle` hiện thông báo ngay dưới nút,
   * cạnh chỗ người dùng vừa bấm — đẩy nó lên đầu form thì nó nằm cách xa hành
   * động vừa gây ra nó, và lẫn với lỗi của ô email/mật khẩu.
   */
  async function dangNhapGoogle(credential: string): Promise<void> {
    setFormError(null);
    setSubmitting(true);
    try {
      const outcome = await loginWithGoogle(credential);
      navigate(redirectTargetFor(outcome.user, outcome.role, incoming?.from), { replace: true });
    } catch (err) {
      setSubmitting(false);
      const loi = getApiError(err);

      /*
       * Email chưa có tài khoản: đưa sang trang đăng ký để XÁC NHẬN, không hiện
       * lỗi đỏ dưới nút. Đây không phải một sự cố — người dùng chỉ chưa có tài
       * khoản, và việc tiếp theo của họ nằm ở trang khác.
       *
       * `credential` đi theo state của router chứ không qua URL: nó là một ID
       * token, và query string thì nằm lại trong lịch sử trình duyệt, trong log
       * của proxy, và trong header Referer gửi cho bên thứ ba.
       */
      if (loi.error === GOOGLE_CHUA_DANG_KY) {
        navigate('/register', {
          state: { googleCredential: credential, googleMessage: loi.message },
        });
        return;
      }

      throw new Error(loi.message);
    }
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
      /*
       * Ghi cờ TRƯỚC khi gọi `login`, không phải sau.
       *
       * `login` thành công là điều hướng ngay sang trang trong, nên mọi dòng
       * đặt sau nó chỉ chạy nhờ may mắn về thứ tự render. Cờ này cũng được ghi
       * khi đăng nhập THẤT BẠI, và đúng như vậy: nó là sở thích của cái máy,
       * không phải một phần của phiên vừa mở.
       */
      ghiGhiNho(ghiNho);
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
        // So mã, KHÔNG so câu chữ: câu chữ là thứ sẽ bị ai đó sửa cho hay hơn,
        // còn mã là hợp đồng của API (`ERROR_CODES` trong @bi/shared).
        setChuaXacMinh(apiError.error === ERROR_CODES.EMAIL_NOT_VERIFIED);
      }
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <header className="mb-7 text-center">
            <h1 className="text-2xl font-bold tracking-tight text-brand-700">{APP_NAME}</h1>
            <p className="mt-1.5 text-sm text-slate-500">Đăng nhập để vào hệ thống</p>
          </header>

          {justRegistered && !formError && (
            /*
             * §1.5 — vừa đăng ký xong. `role="status"` chứ không phải "alert":
             * đây là tin vui, không phải lỗi, nên trình đọc màn hình chỉ cần đọc
             * khi rảnh chứ không cắt ngang việc đang làm.
             *
             * ⚠️ Câu này ĐÃ ĐỔI ở §1.10. Bản cũ nói "Đăng nhập bằng mật khẩu bạn
             * vừa đặt để vào hệ thống" — từ khi `/login` chặn tài khoản chưa xác
             * minh thì câu đó dẫn người dùng thẳng vào một thông báo lỗi ngay sau
             * khi vừa đăng ký xong. Việc tiếp theo của họ là mở hộp thư, nên màn
             * hình phải nói đúng việc đó.
             */
            <div
              role="status"
              className="mb-5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
            >
              Tạo tài khoản thành công. Chúng tôi vừa gửi một thư xác minh tới email của bạn — mở
              liên kết trong thư đó rồi quay lại đây đăng nhập.
            </div>
          )}

          {vuaDatLai && !formError && (
            <div
              role="status"
              className="mb-5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
            >
              Đã đặt mật khẩu mới. Đăng nhập bằng mật khẩu vừa đặt.
            </div>
          )}

          {daGuiLai !== null && !formError && (
            <div
              role="status"
              className="mb-5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
            >
              {daGuiLai}
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
              {chuaXacMinh && (
                <button
                  type="button"
                  onClick={() => void guiLaiThu()}
                  disabled={dangGuiLai}
                  className="mt-2 block font-semibold underline underline-offset-2 hover:no-underline disabled:opacity-60"
                >
                  {dangGuiLai ? 'Đang gửi…' : 'Gửi lại thư xác minh'}
                </button>
              )}
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

            {/*
             * "Ghi nhớ đăng nhập trên máy này" — mong muốn D7.
             *
             * Mặc định TẮT, và đó là chủ đích: luật "đóng app là hết phiên"
             * (`appSession.ts`) bảo vệ đúng tình huống máy dùng chung, nên nó
             * vẫn là mặc định. Bản vá chỉ biến luật thành lựa chọn.
             *
             * Nhãn nói "máy này" và dòng dưới nói "máy riêng": người tích ô này
             * đang để token nằm trên đĩa qua cả lần đóng trình duyệt, và họ cần
             * biết điều đó bằng chữ, không phải bằng kinh nghiệm.
             */}
            <label className="flex items-start gap-2.5 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={ghiNho}
                onChange={(e) => setGhiNho(e.target.checked)}
                disabled={submitting}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
              />
              <span>
                Ghi nhớ đăng nhập trên máy này
                <span className="mt-0.5 block text-xs text-slate-500">
                  Chỉ dùng trên máy riêng. Không tích thì đóng trình duyệt là hết phiên.
                </span>
              </span>
            </label>

            <button
              type="submit"
              // Khoá nút khi đang gửi: bấm hai lần thật nhanh sẽ tính thành hai
              // lần đăng nhập, và bộ đếm chống dò mật khẩu ở backend đếm cả hai.
              disabled={submitting}
              className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? 'Đang đăng nhập…' : 'Đăng nhập'}
            </button>

            {/* Dưới nút chứ không nằm cạnh ô mật khẩu: người vào đây để đăng
                nhập, và một lối thoát đặt ngay cạnh ô đang gõ sẽ tranh sự chú ý
                với việc chính. Người thật sự quên mật khẩu vẫn tìm thấy nó
                ngay, vì họ đang quét cả trang để tìm đúng thứ này. */}
            <p className="text-center text-sm">
              <Link to="/quen-mat-khau" className="font-medium text-slate-500 hover:text-slate-700">
                Quên mật khẩu?
              </Link>
            </p>
          </form>

          {/* NGOÀI thẻ <form>: nút của Google không phải một control của form
              này, và để trong đó thì Enter khi đang gõ mật khẩu có thể kích
              hoạt nhầm nó thay vì nút Đăng nhập. */}
          <div className="mt-6">
            <NutGoogle onCredential={dangNhapGoogle} disabled={submitting} />
          </div>
        </div>

        {/* Nói rõ đăng ký là để lập tổ chức RIÊNG của mình, không phải để xin
            vào tổ chức đã có — người bị lạc sẽ quay về đúng trang này, nên chỉ
            dẫn phải nằm ở đây chứ không chỉ ở trang đăng ký. */}
        <p className="mt-6 text-center text-sm text-slate-500">
          Chưa có tài khoản?{' '}
          <Link to="/register" className="font-medium text-brand-600 hover:text-brand-700">
            Đăng ký
          </Link>
          <br />
          <span className="text-xs text-slate-400">
            Được mời vào tổ chức có sẵn? Quản trị viên sẽ tạo tài khoản và gửi bạn mật khẩu tạm.
          </span>
        </p>
      </div>
    </main>
  );
}
