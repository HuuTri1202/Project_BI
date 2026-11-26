import { registerSchema, type RegisterInput } from '@bi/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { redirectTargetFor } from '../../auth/redirectTarget';
import { useAuth } from '../../auth/useAuth';
import { getApiError } from '../../services/apiClient';
import { GOOGLE_CHUA_DANG_KY, register as registerAccount } from '../../services/authApi';

/** Dữ liệu trang đăng nhập gửi kèm khi đá người dùng sang đây — xem `LoginPage`. */
interface GoogleLocationState {
  googleCredential?: string;
  googleMessage?: string;
}

/** Màn hình xác nhận đang mở cho đúng một ID token. */
interface GoogleXacNhan {
  credential: string;
  /** Câu của backend, đã chứa sẵn email — hiện nguyên văn. */
  message: string;
}
import { AuthLayout, FormError, SubmitButton } from './AuthLayout';
import { Field } from '../../components/ui/Field';
import { NutGoogle } from './NutGoogle';

/**
 * Form đăng ký.
 *
 * Luật kiểm tra dữ liệu KHÔNG viết ở đây — nó nằm trong `@bi/shared` và backend
 * dùng đúng schema đó. Nhờ vậy không có cảnh frontend chặt hơn backend (người
 * dùng bị từ chối bởi một luật server không hề có) hay lỏng hơn (form báo hợp lệ
 * rồi server trả 400).
 */
/**
 * Tên NGẮN của từng ô — vá B1.
 *
 * Một bảng, hai nơi dùng: nhãn trên ô, và câu "Còn thiếu: …" dưới nút. Viết tay
 * hai lần thì lần sửa đầu tiên làm chúng lệch nhau, và khi đó câu "còn thiếu"
 * gọi tên một ô không tồn tại trên màn hình.
 *
 * Thứ tự các khoá là thứ tự ĐỌC của form, nên câu "còn thiếu" liệt kê theo đúng
 * chiều mắt người dùng đang đi.
 */
const NHAN_O: Record<keyof RegisterInput, string> = {
  fullName: 'Họ và tên',
  email: 'Email',
  password: 'Mật khẩu',
  confirmPassword: 'Nhập lại mật khẩu',
  companyName: 'Tên công ty',
};

/**
 * Những ô BẮT BUỘC, theo thứ tự đọc của form.
 *
 * `companyName` cố ý KHÔNG có trong danh sách này dù nó có nhãn ở trên: nó là ô
 * tuỳ ý, và liệt kê nó trong câu "Còn thiếu: …" sẽ nói với người dùng rằng họ
 * phải điền một thứ mà hệ thống không đòi.
 */
const O_BAT_BUOC = ['fullName', 'email', 'password', 'confirmPassword'] as const;

export function RegisterPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { loginWithGoogle } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);

  /*
   * Màn hình xác nhận tạo tài khoản bằng Google.
   *
   * Tới đây bằng HAI đường, và cả hai đặt cùng một state nên chỉ có một khối
   * giao diện:
   *   • từ trang đăng nhập — `credential` đi theo state của router;
   *   • từ chính nút Google ở trang này — `dangKyGoogle` bắt lỗi 404.
   *
   * Giữ `credential` trong state của component chứ không trong URL: nó là ID
   * token của Google. Người tải lại trang thì state mất và họ bấm lại nút —
   * đúng hành vi muốn có, vì một token đã rời khỏi tay người dùng thì không nên
   * sống lại sau một lần F5.
   */
  const tuDangNhap = location.state as GoogleLocationState | null;
  const [xacNhanGoogle, setXacNhanGoogle] = useState<GoogleXacNhan | null>(
    tuDangNhap?.googleCredential === undefined
      ? null
      : {
          credential: tuDangNhap.googleCredential,
          message: tuDangNhap.googleMessage ?? 'Email này chưa có tài khoản trên hệ thống.',
        },
  );
  const [tenToChuc, setTenToChuc] = useState('');
  const [dangTao, setDangTao] = useState(false);
  const [loiXacNhan, setLoiXacNhan] = useState<string | null>(null);

  const { register, handleSubmit, setError, watch, formState } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    // BẮT BUỘC. Ở chế độ mặc định 'onSubmit', react-hook-form không chạy resolver
    // trong lúc gõ, nên `isValid` không được cập nhật — nó đứng ở false cho tới
    // lần submit đầu tiên, mà nút thì đang bị disable bởi chính `isValid`. Kết
    // quả: nút disable vĩnh viễn, form không bao giờ gửi được.
    mode: 'onChange',
    // Phải đủ MỌI trường. Thiếu thì input khởi tạo là `undefined`, zod báo
    // "Required" ngay lần render đầu. Với chuỗi rỗng, trạng thái ban đầu sạch sẽ
    // là "chưa hợp lệ, chưa ai chạm vào" — đúng nghĩa "Submit disabled mặc định".
    defaultValues: {
      fullName: '',
      email: '',
      password: '',
      confirmPassword: '',
      // `undefined` chứ không `''`: ô tuỳ ý để trống nghĩa là KHÔNG KHAI, và
      // `companyNameRule` sẽ từ chối chuỗi rỗng. Để `''` ở đây thì form không
      // bao giờ hợp lệ cho tới khi người dùng gõ một tên công ty — đúng thứ vừa
      // được bỏ khỏi phần bắt buộc.
      companyName: undefined,
    },
  });

  // Destructure Ở ĐÂY, trong thân component, là chuyện bắt buộc chứ không phải
  // phong cách: `formState` là một Proxy, react-hook-form chỉ đăng ký re-render
  // cho những thuộc tính được ĐỌC LÚC RENDER. Nếu chỉ đọc `formState.isValid`
  // bên trong callback thì component không bao giờ render lại và nút không bao
  // giờ bật lên.
  const { errors, touchedFields, isValid, isSubmitting } = formState;

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await registerAccount(values);

      // §1.5 — đăng ký xong thì sang trang đăng nhập, KHÔNG tự đăng nhập.
      //
      // `replace: true` để nút Quay lại của trình duyệt không đưa họ về form
      // đăng ký đã gửi. `state` mang thông báo và email sang, nên trang đăng
      // nhập chào đúng người và điền sẵn ô email — họ chỉ còn phải gõ mật khẩu
      // vừa đặt, và đó chính là bước chứng minh mật khẩu đúng như họ nghĩ.
      navigate('/login', {
        replace: true,
        state: {
          registered: true,
          email: values.email,
        },
      });
    } catch (err) {
      const apiError = getApiError(err);

      if (apiError.error === 'EmailAlreadyRegistered') {
        // Gắn lỗi vào đúng ô thay vì hiện một banner chung.
        //
        // `setError` làm `isValid` thành false, nên nút submit bị disable ngay
        // sau đó — người dùng KHÔNG thể bấm gửi lại y nguyên. Vì `mode` là
        // 'onChange', chỉ cần sửa ô email một ký tự là resolver chạy lại, lỗi
        // biến mất và nút bật lên. Đó chính là hành vi mong muốn: chặn việc gửi
        // lại đúng dữ liệu vừa bị từ chối, nhưng không cản người dùng sửa.
        setError('email', { type: 'server', message: apiError.message }, { shouldFocus: true });
        return;
      }

      if (apiError.fields) {
        for (const [name, message] of Object.entries(apiError.fields)) {
          setError(name as keyof RegisterInput, { type: 'server', message });
        }
        return;
      }

      setFormError(apiError.message);
    }
  });

  /**
   * Đăng ký bằng Google — cùng MỘT endpoint với đăng nhập.
   *
   * Người ĐÃ có tài khoản mà lạc vào trang này vẫn vào được bằng một cú bấm,
   * thay vì nhận một lỗi "email đã được đăng ký" cho thao tác đúng đắn của họ.
   * Email chưa có tài khoản thì mở màn hình xác nhận ngay tại trang này.
   *
   * Khác đăng nhập ở đúng một chỗ: KHÔNG có `from` để quay về, vì người ở trang
   * đăng ký chưa từng bị chặn ở một trang nào cả.
   *
   * ⚠️ NÉM LẠI lỗi thay vì tự hiện. `NutGoogle` hiện thông báo ngay dưới nút,
   * cạnh chỗ người dùng vừa bấm.
   */
  async function dangKyGoogle(credential: string): Promise<void> {
    setFormError(null);
    try {
      const outcome = await loginWithGoogle(credential);
      navigate(redirectTargetFor(outcome.user, outcome.role, null), { replace: true });
    } catch (err) {
      const loi = getApiError(err);
      // Chưa có tài khoản KHÔNG phải lỗi: chuyển sang màn hình xác nhận và
      // THOÁT êm, để `NutGoogle` không hiện một dòng đỏ dưới nút vừa biến mất.
      if (loi.error === GOOGLE_CHUA_DANG_KY) {
        setXacNhanGoogle({ credential, message: loi.message });
        return;
      }
      throw new Error(loi.message);
    }
  }

  /**
   * Lượt gọi THỨ HAI: người dùng đã bấm xác nhận, giờ mới tạo tài khoản.
   *
   * Lỗi ở đây hiện NGAY TRONG màn hình xác nhận chứ không ném lên: nút Google
   * không còn trên màn hình này, nên không còn chỗ nào bên dưới nó để hiện.
   */
  async function taoTaiKhoanGoogle(): Promise<void> {
    if (xacNhanGoogle === null) return;
    setLoiXacNhan(null);
    setDangTao(true);
    try {
      const outcome = await loginWithGoogle(xacNhanGoogle.credential, { companyName: tenToChuc });
      navigate(redirectTargetFor(outcome.user, outcome.role, null), { replace: true });
    } catch (err) {
      setDangTao(false);
      setLoiXacNhan(getApiError(err).message);
    }
  }

  /** Chỉ hiện lỗi khi người dùng đã chạm vào ô — không quát họ trước khi họ gõ. */
  const errorOf = (field: keyof RegisterInput): string | undefined =>
    touchedFields[field] ? errors[field]?.message : undefined;

  /**
   * Cảnh báo mật khẩu nhập lại không khớp, hiện NGAY thay vì đợi cả form hợp lệ.
   *
   * Cần đoạn này vì luật so khớp nằm ở `superRefine` cấp object, mà zod chỉ chạy
   * refinement cấp object SAU KHI mọi trường con parse thành công. Người dùng
   * thường điền mật khẩu trước chức danh, nên nếu chỉ dựa vào resolver thì họ gõ
   * lệch hai ô mà không hề được báo cho tới lúc điền xong hết mọi thứ.
   *
   * Đây thuần tuý là lớp hiển thị: `isValid` (và do đó nút Submit) vẫn do
   * resolver quyết định, và backend vẫn kiểm lại bằng chính schema đó.
   */
  /*
   * Những ô CÒN TRỐNG, để nói thẳng vì sao nút Đăng ký còn xám — vá B1.
   *
   * Lỗi đã đo khi dùng hệ thống như người thật: điền 6 trong 7 ô, nút vẫn xám,
   * và KHÔNG có chữ nào nói vì sao. Lỗi của từng ô thì chỉ hiện sau khi ô đó
   * được chạm vào (`touchedFields`), nên một ô chưa ai bấm vào thì im lặng hoàn
   * toàn — người dùng không có cách nào biết mình còn thiếu cái gì.
   *
   * `watch()` không tham số nên component render lại mỗi lần gõ. Với một form
   * bảy ô thì đó là cái giá đúng để trả.
   */
  const dangNhapLieu = watch();
  const oConTrong = O_BAT_BUOC.filter((field) => (dangNhapLieu[field] ?? '') === '');

  const password = watch('password');
  const confirmPassword = watch('confirmPassword');
  const confirmMismatch =
    touchedFields.confirmPassword && confirmPassword.length > 0 && password !== confirmPassword
      ? 'Mật khẩu nhập lại không khớp'
      : undefined;

  /*
   * ─── Màn hình xác nhận: THAY CHỖ form, không nằm cạnh nó ───────────────────
   *
   * Người tới đây đã chọn "vào bằng Google", nên hiện form mật khẩu bên cạnh là
   * mời họ làm lại việc vừa chọn bỏ. Toàn bộ thứ cần hỏi là một ô tuỳ chọn.
   *
   * Không có nút "Đổi tài khoản Google": muốn đổi thì quay lại trang đăng nhập,
   * vì chính Google giữ cửa sổ chọn tài khoản chứ không phải ta.
   */
  if (xacNhanGoogle !== null) {
    return (
      <AuthLayout
        title="Email này chưa có tài khoản"
        subtitle={xacNhanGoogle.message}
        footer={
          <>
            Không phải tài khoản bạn muốn dùng?{' '}
            <Link to="/login" className="font-medium text-brand-600 hover:text-brand-700">
              Quay lại đăng nhập
            </Link>
          </>
        }
      >
        {loiXacNhan !== null && <FormError message={loiXacNhan} />}

        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void taoTaiKhoanGoogle();
          }}
          className="space-y-5"
        >
          <p className="text-sm text-slate-600">
            Bấm <span className="font-medium text-slate-900">Tạo tài khoản</span> để lập một tài
            khoản mới cho email này. Bạn sẽ đăng nhập bằng Google, nên{' '}
            <span className="font-medium text-slate-900">không cần đặt mật khẩu</span>. Muốn thêm
            mật khẩu sau thì dùng “Quên mật khẩu”.
          </p>

          <Field
            label={`${NHAN_O.companyName} (không bắt buộc)`}
            autoComplete="organization"
            hint="Để trống thì chúng tôi dựng một không gian riêng mang tên bạn — đổi tên sau ở trang Tổ chức."
            value={tenToChuc}
            onChange={(e) => setTenToChuc(e.target.value)}
          />

          <SubmitButton disabled={dangTao} loading={dangTao} loadingLabel="Đang tạo tài khoản…">
            Tạo tài khoản
          </SubmitButton>
        </form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Tạo tài khoản"
      subtitle="Không gian làm việc của bạn được dựng ngay cùng tài khoản."
      footer={
        <>
          Đã có tài khoản?{' '}
          <Link to="/login" className="font-medium text-brand-600 hover:text-brand-700">
            Đăng nhập
          </Link>
        </>
      }
    >
      {formError && <FormError message={formError} />}

      {/*
       * Nói THẲNG rằng đăng ký nghĩa là lập một tổ chức mới, ngay ở đầu form.
       *
       * Không có dòng này, người được đồng nghiệp bảo "vào trang này đăng ký đi"
       * sẽ tự lập ra một tổ chức rỗng của riêng mình, rồi cả hai cùng bối rối vì
       * không thấy nhau trong danh sách thành viên. Đó là tình huống đã xảy ra
       * thật, nhiều lần — chữ nhỏ dưới ô "Tên công ty" không đủ để ai đọc.
       */}
      <div className="mb-5 rounded-lg border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-900">
        <p className="font-medium">Đăng ký ở đây tạo một tổ chức MỚI của riêng bạn.</p>
        <p className="mt-1 text-brand-700">
          Nếu bạn được mời vào một tổ chức đã có, đừng dùng form này — hãy hỏi quản trị viên
          của tổ chức đó để họ tạo tài khoản và gửi bạn mật khẩu tạm.
        </p>
      </div>

      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <Field
          label={NHAN_O.fullName}
          required
          autoComplete="name"
          error={errorOf('fullName')}
          registration={register('fullName')}
        />
        <Field
          label={NHAN_O.email}
          required
          type="email"
          autoComplete="email"
          error={errorOf('email')}
          // Cắt khoảng trắng TRƯỚC khi validate, khớp với backend. Email dán từ
          // nơi khác rất hay kèm khoảng trắng ở hai đầu; không có dòng này thì
          // frontend chặt hơn backend và người dùng bị chặn bởi một luật server
          // không hề có. `setValueAs` chỉ đổi giá trị mà react-hook-form giữ,
          // không đụng vào nội dung ô nhập nên không cản người dùng gõ.
          registration={register('email', { setValueAs: (v: string) => v.trim() })}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={NHAN_O.password}
            required
            type="password"
            autoComplete="new-password"
            revealable
            error={errorOf('password')}
            registration={register('password')}
          />
          <Field
            label={NHAN_O.confirmPassword}
            required
            type="password"
            autoComplete="new-password"
            revealable
            error={errorOf('confirmPassword') ?? confirmMismatch}
            registration={register('confirmPassword')}
          />
        </div>
        {!errorOf('password') && (
          <p className="-mt-2 text-sm text-slate-500">
            Tối thiểu 8 ký tự, có ít nhất 1 chữ hoa và 1 chữ số.
          </p>
        )}

        {/*
          Ô TUỲ Ý duy nhất của form, và nó được đặt cuối cùng là có lý: ba ô trên
          là danh tính, ô này là một quyết định về tổ chức mà người mới chưa cần
          phải có ngay. `setValueAs` đổi ô trống thành `undefined` để backend
          hiểu là "không khai" chứ không phải "tên công ty rỗng".
        */}
        <Field
          label={`${NHAN_O.companyName} (không bắt buộc)`}
          autoComplete="organization"
          hint="Để trống thì chúng tôi dựng một không gian riêng mang tên bạn — đổi tên sau ở trang Tổ chức."
          error={errorOf('companyName')}
          registration={register('companyName', {
            setValueAs: (v: string) => (v.trim() === '' ? undefined : v.trim()),
          })}
        />

        <SubmitButton
          disabled={!isValid || isSubmitting}
          loading={isSubmitting}
          loadingLabel="Đang tạo tài khoản…"
        >
          Đăng ký
        </SubmitButton>

        {/* Nút xám thì phải nói vì sao xám. `role="status"` chứ không `alert`:
            đây là tình trạng của form, không phải một lỗi người dùng vừa gây
            ra — `alert` sẽ cắt ngang trình đọc màn hình ở mỗi ký tự được gõ. */}
        {!isValid && !isSubmitting && (
          <p role="status" className="text-center text-sm text-slate-500">
            {oConTrong.length > 0
              ? `Còn thiếu: ${oConTrong.map((field) => NHAN_O[field]).join(', ')}.`
              : 'Hãy sửa những ô đang báo đỏ để tiếp tục.'}
          </p>
        )}
      </form>

      {/* NGOÀI thẻ <form>: nút của Google không phải một control của form này, và
          để trong đó thì Enter khi đang gõ mật khẩu có thể kích hoạt nhầm nó
          thay vì nút Đăng ký. Cùng lý lẽ với trang đăng nhập. */}
      <div className="mt-6">
        <NutGoogle onCredential={dangKyGoogle} disabled={isSubmitting} text="signup_with" />
      </div>
    </AuthLayout>
  );
}
