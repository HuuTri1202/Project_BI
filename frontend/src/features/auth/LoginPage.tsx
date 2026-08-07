import { loginSchema, type LoginInput } from '@bi/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';

import { ApiError, authApi } from './authApi';
import { AuthLayout, FormError, SubmitButton } from './AuthLayout';
import { Field } from './Field';

export function LoginPage() {
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);

  const { register, handleSubmit, formState } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    mode: 'onChange',
    defaultValues: { email: '', password: '' },
  });

  const { errors, touchedFields, isValid, isSubmitting } = formState;

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await authApi.login(values);
      navigate('/', { replace: true });
    } catch (err) {
      // Sai email hay sai mật khẩu đều trả về CÙNG một thông báo — backend cố ý
      // không phân biệt, nên ở đây cũng không được đoán thêm.
      setFormError(err instanceof ApiError ? err.message : 'Đã có lỗi xảy ra. Vui lòng thử lại.');
    }
  });

  return (
    <AuthLayout
      title="Đăng nhập"
      subtitle="Nhập email và mật khẩu của bạn."
      footer={
        <>
          Chưa có tài khoản?{' '}
          <Link to="/register" className="font-medium text-brand-600 hover:text-brand-700">
            Đăng ký
          </Link>
        </>
      }
    >
      {formError && <FormError message={formError} />}

      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <Field
          label="Email"
          type="email"
          autoComplete="email"
          error={touchedFields.email ? errors.email?.message : undefined}
          registration={register('email', { setValueAs: (v: string) => v.trim() })}
        />
        <Field
          label="Mật khẩu"
          type="password"
          autoComplete="current-password"
          revealable
          error={touchedFields.password ? errors.password?.message : undefined}
          registration={register('password')}
        />

        <SubmitButton
          disabled={!isValid || isSubmitting}
          loading={isSubmitting}
          loadingLabel="Đang đăng nhập…"
        >
          Đăng nhập
        </SubmitButton>
      </form>
    </AuthLayout>
  );
}
