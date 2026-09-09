import {
  JOB_TITLES,
  TENANT_ROLE_LABELS,
  emailRule,
  fullNameRule,
  type CreateAdminUserResultDto,
  type TenantRole,
} from '@bi/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '../../../components/ui/Button';
import { Field, SelectField } from '../../../components/ui/Field';
import { Modal } from '../../../components/ui/Modal';
import { LimitAlert } from '../../billing/LimitAlert';
import { getApiError } from '../../../services/apiClient';
import { useCreateMember } from '../hooks';

/**
 * Schema dựng tại chỗ từ các rule dùng chung của `@bi/shared`.
 *
 * Không đưa cả object schema này vào gói shared vì backend có schema riêng với
 * phần chuẩn hoá (hạ chữ thường, gộp khoảng trắng) — mà transform thì làm kiểu
 * input/output của zod lệch nhau và phá `zodResolver`. Chia sẻ RULE từng trường
 * là đủ để hai phía không lệch luật.
 */
const formSchema = z.object({
  email: emailRule,
  fullName: fullNameRule,
  role: z.enum(['admin', 'creator', 'viewer']),
  jobTitle: z.enum(JOB_TITLES).optional(),
});

type FormValues = z.infer<typeof formSchema>;

const ROLE_OPTIONS = Object.entries(TENANT_ROLE_LABELS).map(([value, label]) => ({
  value,
  label,
}));

interface CreateMemberModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (result: CreateAdminUserResultDto) => void;
}

export function CreateMemberModal({
  open,
  onClose,
  onCreated,
}: CreateMemberModalProps): React.ReactElement {
  const [formError, setFormError] = useState<string | null>(null);
  // Giữ cả MÃ lỗi, không chỉ câu chữ: LimitAlert cần nó để quyết định có gắn
  // link `Xem các gói` hay không. So khớp bằng câu chữ thì hỏng ngay lần đổi từ ngữ.
  const [formErrorCode, setFormErrorCode] = useState<string | null>(null);
  const createUser = useCreateMember();

  const { register, handleSubmit, setError, reset, formState } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    mode: 'onChange',
    defaultValues: {
      email: '',
      fullName: '',
      // Mặc định `viewer` — đặc quyền tối thiểu. Người cần thêm quyền sẽ hỏi,
      // còn người được cấp thừa quyền thì không ai biết.
      role: 'viewer' as TenantRole,
      jobTitle: undefined,
    },
  });

  const { errors, touchedFields, isValid, isSubmitting } = formState;

  const close = (): void => {
    reset();
    setFormError(null);
    setFormErrorCode(null);
    onClose();
  };

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    setFormErrorCode(null);
    try {
      const result = await createUser.mutateAsync(values);
      reset();
      onCreated(result);
    } catch (err) {
      const apiError = getApiError(err);
      if (apiError.fields) {
        for (const [name, message] of Object.entries(apiError.fields)) {
          setError(name as keyof FormValues, { type: 'server', message });
        }
        return;
      }
      setFormError(apiError.message);
      setFormErrorCode(apiError.error);
    }
  });

  return (
    <Modal
      open={open}
      onClose={close}
      title="Thêm người dùng"
      description="Hệ thống sinh mật khẩu tạm và hiện đúng một lần để bạn gửi cho người này."
      footer={
        <>
          <Button onClick={close}>Huỷ</Button>
          <Button
            variant="primary"
            type="submit"
            form="create-member-form"
            disabled={!isValid}
            loading={isSubmitting}
          >
            Tạo tài khoản
          </Button>
        </>
      }
    >
      <LimitAlert message={formError} code={formErrorCode} />

      {/* Nút submit nằm ở footer, ngoài thẻ form — thuộc tính `form` nối chúng
          lại. Cách này giữ được hành vi Enter-để-gửi của form thật. */}
      <form id="create-member-form" onSubmit={onSubmit} noValidate className="space-y-4">
        <Field
          label="Email"
          type="email"
          autoComplete="off"
          error={touchedFields.email ? errors.email?.message : undefined}
          registration={register('email', { setValueAs: (v: string) => v.trim() })}
        />
        <Field
          label="Họ và tên"
          autoComplete="off"
          error={touchedFields.fullName ? errors.fullName?.message : undefined}
          registration={register('fullName')}
        />
        <SelectField
          label="Vai trò"
          options={ROLE_OPTIONS}
          placeholder="— Chọn vai trò —"
          error={errors.role?.message}
          registration={register('role')}
        />
        <SelectField
          label="Chức danh (không bắt buộc)"
          options={JOB_TITLES}
          placeholder="— Không chọn —"
          error={errors.jobTitle?.message}
          registration={register('jobTitle')}
        />
      </form>
    </Modal>
  );
}
