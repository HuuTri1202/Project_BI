import { JOB_TITLES, normalizePhone, phoneRule, registerFields } from '@bi/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useAuth } from '../auth/useAuth';
import { Page, PageBody, PageHeader } from '../components/ui/Page';
import { Button } from '../components/ui/Button';
import { Field, SelectField } from '../components/ui/Field';
import { useChangePassword, useUpdateProfile } from '../features/tenant/hooks';
import { getApiError } from '../services/apiClient';
import { ROLE_LABELS } from '../types/auth';

/**
 * Hồ sơ cá nhân — §4.4: sửa thông tin và đổi mật khẩu.
 *
 * Hai form TÁCH RỜI, mỗi form một nút lưu riêng. Gộp chung nghĩa là người chỉ
 * muốn sửa số điện thoại vẫn phải gõ mật khẩu hiện tại, và một lần lưu hỏng sẽ
 * kéo theo cả hai phần.
 */
export default function ProfilePage(): React.ReactElement {
  const { user, tenant, role } = useAuth();

  return (
    <Page width="6xl">
      <PageHeader
        title="Hồ sơ cá nhân"
        description={`${tenant?.name ?? ''} · ${role ? ROLE_LABELS[role] : ''}`}
      />

      <PageBody>
        {/* Hai thẻ nằm CẠNH nhau chứ không chồng lên nhau. Xếp dọc trong một cột
            hẹp bỏ trống hơn nửa bề ngang màn hình rồi bắt cuộn để xem thẻ thứ
            hai — trong khi cả hai đều là form ngắn, thừa chỗ để đứng cạnh.
            Dưới `lg` mới xếp dọc, vì lúc đó bề ngang thật sự không đủ. */}
        <div className="grid items-start gap-5 lg:grid-cols-2">
          <ProfileForm />
          <PasswordForm />
        </div>

        <p className="mt-4 text-xs text-slate-400">
          Tài khoản tạo ngày {user ? new Date(user.createdAt).toLocaleDateString('vi-VN') : '—'}
          {user?.lastLoginAt
            ? ` · đăng nhập gần nhất ${new Date(user.lastLoginAt).toLocaleString('vi-VN')}`
            : ''}
        </p>
      </PageBody>
    </Page>
  );
}

// ─── Thông tin cá nhân ───────────────────────────────────────────────────────

/**
 * Dùng lại luật của `@bi/shared` để form này không lỏng hơn hay chặt hơn backend.
 *
 * Ba trường không bắt buộc nên phải nhận chuỗi rỗng. `z.union([rule, literal('')])`
 * thay vì `.optional()`: ô input rỗng gửi lên là `''`, không phải `undefined` —
 * `.optional()` sẽ để `''` rơi vào `phoneRule` và người dùng nhận lỗi "Số điện
 * thoại không hợp lệ" cho một ô họ cố ý để trống.
 */
const empty = z.literal('');

const profileSchema = z.object({
  fullName: registerFields.shape.fullName,
  phone: z.union([phoneRule, empty]),
  jobTitle: z.union([z.enum(JOB_TITLES), empty]),
  dateOfBirth: z.union([
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày sinh phải có dạng YYYY-MM-DD'),
    empty,
  ]),
});

type ProfileValues = z.infer<typeof profileSchema>;

function ProfileForm(): React.ReactElement {
  const { user } = useAuth();
  const updateProfile = useUpdateProfile();
  const [saved, setSaved] = useState(false);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isDirty },
  } = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    // `user` đã có sẵn từ `GET /me` lúc khôi phục phiên, nên không cần trạng thái
    // chờ: trang này chỉ render sau `ProtectedRoute`.
    defaultValues: {
      fullName: user?.fullName ?? '',
      phone: user?.phone ?? '',
      jobTitle: (user?.jobTitle ?? '') as ProfileValues['jobTitle'],
      dateOfBirth: user?.dateOfBirth ?? '',
    },
  });

  async function onSubmit(values: ProfileValues): Promise<void> {
    setSaved(false);
    try {
      await updateProfile.mutateAsync({
        fullName: values.fullName,
        // Chuẩn hoá về +84XXXXXXXXX trước khi gửi. Backend cũng làm bước này, nên
        // đây thuần tuý là để ô nhập hiện đúng thứ vừa được lưu sau khi trả về.
        phone: values.phone === '' ? null : (normalizePhone(values.phone) ?? values.phone),
        jobTitle: values.jobTitle === '' ? null : values.jobTitle,
        dateOfBirth: values.dateOfBirth === '' ? null : values.dateOfBirth,
      });
      setSaved(true);
    } catch (err) {
      const apiError = getApiError(err);
      if (apiError.fields) {
        for (const [field, message] of Object.entries(apiError.fields)) {
          if (field in profileSchema.shape) {
            setError(field as keyof ProfileValues, { message });
          }
        }
      } else {
        setError('fullName', { message: apiError.message });
      }
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-slate-900">Thông tin cá nhân</h2>

      {/* Các ô ngắn đi thành hai cột. Một ô "Ngày sinh" kéo hết bề ngang thẻ vừa
          xấu vừa tốn một hàng cho thứ chỉ cần vài chục pixel. */}
      <form
        onSubmit={(e) => void handleSubmit(onSubmit)(e)}
        noValidate
        className="mt-4 grid gap-4 sm:grid-cols-2"
      >
        <div className="sm:col-span-2">
          <Field
            label="Họ và tên"
            registration={register('fullName')}
            error={errors.fullName?.message}
            autoComplete="name"
          />
        </div>

        {/* Email chỉ đọc. Nó là định danh đăng nhập DUY NHẤT và duy nhất TOÀN
            CỤC; đổi nó cần một luồng xác thực email mà hệ thống chưa có, và cho
            sửa tự do nghĩa là gõ nhầm một ký tự là mất tài khoản vĩnh viễn. */}
        <div className="sm:col-span-2">
          <label
            htmlFor="profile-email"
            className="mb-1.5 block text-sm font-medium text-slate-700"
          >
            Email
          </label>
          <input
            id="profile-email"
            value={user?.email ?? ''}
            readOnly
            className="w-full cursor-not-allowed rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-500"
          />
          <p className="mt-1.5 text-xs text-slate-400">Email là tên đăng nhập, không đổi được.</p>
        </div>

        <Field
          label="Số điện thoại"
          registration={register('phone')}
          error={errors.phone?.message}
          autoComplete="tel"
        />

        <SelectField
          label="Chức danh"
          registration={register('jobTitle')}
          options={JOB_TITLES}
          placeholder="Không chọn"
          allowEmpty
          error={errors.jobTitle?.message}
        />

        <Field
          label="Ngày sinh"
          type="date"
          registration={register('dateOfBirth')}
          error={errors.dateOfBirth?.message}
        />

        <div className="flex items-center gap-3 sm:col-span-2">
          <Button
            type="submit"
            variant="primary"
            loading={updateProfile.isPending}
            disabled={!isDirty}
          >
            Lưu thay đổi
          </Button>
          {saved && !isDirty && (
            <span role="status" className="text-sm text-emerald-600">
              Đã lưu
            </span>
          )}
        </div>
      </form>
    </section>
  );
}

// ─── Đổi mật khẩu ────────────────────────────────────────────────────────────

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Vui lòng nhập mật khẩu hiện tại'),
    newPassword: z
      .string()
      .min(8, 'Mật khẩu phải có ít nhất 8 ký tự')
      // Đếm BYTE chứ không phải ký tự: bcrypt cắt âm thầm ở byte thứ 72, và
      // tiếng Việt có dấu là 2–3 byte mỗi ký tự nên ~24 ký tự đã chạm trần.
      // Backend từ chối theo đúng luật này; không kiểm ở đây thì người dùng gõ
      // xong mới biết.
      .refine(
        (v) => new TextEncoder().encode(v).length <= 72,
        'Mật khẩu quá dài (tối đa 72 byte — chữ có dấu tính 2–3 byte)',
      ),
    confirmPassword: z.string().min(1, 'Vui lòng nhập lại mật khẩu mới'),
  })
  .superRefine((value, ctx) => {
    if (value.newPassword !== value.confirmPassword) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['confirmPassword'],
        message: 'Mật khẩu nhập lại không khớp',
      });
    }
    if (value.currentPassword === value.newPassword) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['newPassword'],
        message: 'Mật khẩu mới phải khác mật khẩu hiện tại',
      });
    }
  });

type PasswordValues = z.infer<typeof passwordSchema>;

function PasswordForm(): React.ReactElement {
  const changePassword = useChangePassword();
  const [done, setDone] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<PasswordValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  async function onSubmit(values: PasswordValues): Promise<void> {
    setDone(false);
    try {
      await changePassword.mutateAsync({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      // Xoá sạch form sau khi đổi: để mật khẩu nằm lại trong ô nhập trên một máy
      // dùng chung là thứ không có lý do gì để làm.
      reset();
      setDone(true);
    } catch (err) {
      const apiError = getApiError(err);
      setError('currentPassword', {
        message: apiError.fields?.['currentPassword'] ?? apiError.message,
      });
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-slate-900">Đổi mật khẩu</h2>

      <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} noValidate className="mt-4 space-y-4">
        <Field
          label="Mật khẩu hiện tại"
          type="password"
          revealable
          registration={register('currentPassword')}
          error={errors.currentPassword?.message}
          autoComplete="current-password"
        />
        <Field
          label="Mật khẩu mới"
          type="password"
          revealable
          registration={register('newPassword')}
          error={errors.newPassword?.message}
          autoComplete="new-password"
        />
        <Field
          label="Nhập lại mật khẩu mới"
          type="password"
          revealable
          registration={register('confirmPassword')}
          error={errors.confirmPassword?.message}
          autoComplete="new-password"
        />

        <div className="flex items-center gap-3 pt-1">
          <Button type="submit" variant="primary" loading={changePassword.isPending}>
            Đổi mật khẩu
          </Button>
          {done && (
            <span role="status" className="text-sm text-emerald-600">
              Đã đổi mật khẩu
            </span>
          )}
        </div>
      </form>
    </section>
  );
}
