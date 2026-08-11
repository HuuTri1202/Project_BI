import { companyNameRule } from '@bi/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useAuth } from '../../auth/useAuth';
import { Button } from '../../components/ui/Button';
import { Field } from '../../components/ui/Field';
import { ErrorState } from '../../components/ui/states';
import { useTenant, useUpdateTenant } from '../../features/tenant/hooks';
import { getApiError } from '../../services/apiClient';

/**
 * Tab "Tổ chức" — đổi tên công ty.
 *
 * §6.2 của tài liệu hứa "Admin sửa được thông tin Company" nhưng trước đây
 * KHÔNG có endpoint nào làm việc đó: tên tổ chức khai một lần lúc đăng ký rồi
 * đóng băng vĩnh viễn. Gõ sai một chữ lúc đăng ký là mang nó theo mãi.
 *
 * Đọc từ `GET /v1/tenant` chứ không lấy tên trong phiên đăng nhập: bản trong
 * phiên là ảnh chụp lúc cấp token, nên nếu một admin khác vừa đổi tên thì form
 * này sẽ mở ra với tên cũ và lưu lại đúng cái tên cũ đó — ghi đè thao tác của
 * người kia mà không ai thấy.
 */
const formSchema = z.object({ name: companyNameRule });
type FormValues = z.infer<typeof formSchema>;

export default function OrganizationProfilePage(): React.ReactElement {
  const { role } = useAuth();
  const { data: tenant, isPending, isError, error } = useTenant();
  const update = useUpdateTenant();

  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const { register, handleSubmit, reset, formState } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    mode: 'onChange',
    defaultValues: { name: '' },
  });

  // Nạp giá trị thật khi request về. `defaultValues` chạy đúng một lần lúc dựng
  // form, mà lúc đó dữ liệu chưa tới — thiếu effect này thì ô luôn rỗng.
  useEffect(() => {
    if (tenant) reset({ name: tenant.name });
  }, [tenant, reset]);

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    setSaved(false);
    update.mutate(values.name, {
      onSuccess: (updated) => {
        // Nạp lại từ phản hồi của server, không giữ nguyên thứ người dùng gõ:
        // backend gộp khoảng trắng thừa, nên "Công  ty  A" lưu xuống thành
        // "Công ty A". Không đồng bộ lại thì ô vẫn hiện bản chưa chuẩn hoá và
        // nút Lưu lại sáng lên như thể còn thay đổi chưa lưu.
        reset({ name: updated.name });
        setSaved(true);
      },
      onError: (err) => setFormError(getApiError(err).message),
    });
  });

  if (isError) return <ErrorState message={getApiError(error).message} />;

  return (
    <div className="max-w-xl">
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && (
          <p
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700"
          >
            {formError}
          </p>
        )}

        <Field
          label="Tên tổ chức"
          error={formState.errors.name?.message}
          hint="Tên này hiện trên thanh bên, trong bộ chuyển tổ chức và ở mọi nơi nhắc tới công ty."
          registration={register('name')}
        />

        {/* Slug hiện ra nhưng KHÔNG sửa được, và nói rõ vì sao ngay tại chỗ.
            Giấu hẳn thì người dùng sẽ đi tìm nó; để sửa được thì mọi đường dẫn
            đã lưu của người khác gãy. Hiện kèm lý do là lựa chọn thứ ba. */}
        <div className="space-y-1.5">
          <span className="block text-sm font-medium text-slate-700">Đường dẫn</span>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5">
            <code className="text-sm text-slate-600">{isPending ? '…' : tenant?.slug}</code>
          </div>
          <p className="text-sm text-slate-500">
            Không đổi được. Đây là định danh cố định của tổ chức — đổi nó sẽ làm hỏng những liên
            kết đã được lưu lại ở nơi khác.
          </p>
        </div>

        <div className="flex items-center gap-3 pt-1">
          <Button
            variant="primary"
            type="submit"
            loading={update.isPending}
            disabled={isPending || !formState.isDirty || !formState.isValid}
          >
            Lưu thay đổi
          </Button>
          {/* Cờ `saved` bị `isDirty` dập tắt ngay khi người dùng gõ tiếp, nên
              không có chuyện "Đã lưu" đứng cạnh một ô vừa bị sửa. */}
          {saved && !formState.isDirty && (
            <span role="status" className="text-sm text-emerald-700">
              Đã lưu.
            </span>
          )}
        </div>
      </form>

      <div className="mt-8 border-t border-slate-200 pt-6">
        <h2 className="text-sm font-semibold text-slate-900">Vai trò của bạn</h2>
        <p className="mt-1 text-sm text-slate-500">
          Bạn là <strong className="text-slate-700">quản trị viên</strong> của tổ chức này ({role}
          ). Vai trò cấp tổ chức khác hoàn toàn với vai trò cấp nền tảng — đổi sang tổ chức khác
          thì quyền của bạn đổi theo.
        </p>
      </div>
    </div>
  );
}
