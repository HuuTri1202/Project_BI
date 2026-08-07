import { JOB_TITLES, registerSchema, type JobTitle, type RegisterInput } from '@bi/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';

import { getApiError } from '../../services/apiClient';
import { register as registerAccount } from '../../services/authApi';
import { AuthLayout, FormError, SubmitButton } from './AuthLayout';
import { Field, SelectField } from './Field';

/**
 * Form đăng ký.
 *
 * Luật kiểm tra dữ liệu KHÔNG viết ở đây — nó nằm trong `@bi/shared` và backend
 * dùng đúng schema đó. Nhờ vậy không có cảnh frontend chặt hơn backend (người
 * dùng bị từ chối bởi một luật server không hề có) hay lỏng hơn (form báo hợp lệ
 * rồi server trả 400).
 */
export function RegisterPage() {
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);

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
      companyName: '',
      email: '',
      password: '',
      confirmPassword: '',
      phone: '',
      // Ép kiểu ở đây là CỐ Ý: '' không phải một chức danh hợp lệ, và đúng như
      // vậy — nó là trạng thái "chưa chọn" mà schema phải từ chối để nút Submit
      // còn khoá. Kiểu của zod mô tả dữ liệu ĐÃ HỢP LỆ, không mô tả trạng thái
      // dở dang của form.
      jobTitle: '' as JobTitle,
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
  const password = watch('password');
  const confirmPassword = watch('confirmPassword');
  const confirmMismatch =
    touchedFields.confirmPassword && confirmPassword.length > 0 && password !== confirmPassword
      ? 'Mật khẩu nhập lại không khớp'
      : undefined;

  return (
    <AuthLayout
      title="Tạo tài khoản"
      subtitle="Bắt đầu dùng BI Platform trong vài chục giây."
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

      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <Field
          label="Họ và tên"
          autoComplete="name"
          error={errorOf('fullName')}
          registration={register('fullName')}
        />
        <Field
          label="Email"
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
            label="Mật khẩu"
            type="password"
            autoComplete="new-password"
            revealable
            error={errorOf('password')}
            registration={register('password')}
          />
          <Field
            label="Nhập lại mật khẩu"
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

        <Field
          label="Số điện thoại"
          type="tel"
          autoComplete="tel"
          hint="Gõ kiểu nào cũng được: 0901234567, +84 901 234 567…"
          error={errorOf('phone')}
          registration={register('phone')}
        />
        <Field
          label="Tên công ty"
          autoComplete="organization"
          hint="Chúng tôi sẽ tạo tổ chức này cho bạn, và bạn là quản trị viên của nó."
          error={errorOf('companyName')}
          registration={register('companyName')}
        />
        <SelectField
          label="Chức danh"
          options={JOB_TITLES}
          placeholder="— Chọn chức danh —"
          error={errorOf('jobTitle')}
          registration={register('jobTitle')}
        />

        <SubmitButton
          disabled={!isValid || isSubmitting}
          loading={isSubmitting}
          loadingLabel="Đang tạo tài khoản…"
        >
          Đăng ký
        </SubmitButton>
      </form>
    </AuthLayout>
  );
}
