import { companyNameRule, type AdminWorkspaceDto } from '@bi/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '../../../components/ui/Button';
import { Field } from '../../../components/ui/Field';
import { Modal } from '../../../components/ui/Modal';
import { getApiError } from '../../../services/apiClient';
import { useCreateWorkspace, useUpdateWorkspace } from '../hooks';

// Tên workspace dùng lại `companyNameRule`: cùng ràng buộc độ dài (khớp cột
// VARCHAR), cùng luật không-chỉ-khoảng-trắng, cùng thông báo lỗi.
const formSchema = z.object({
  name: companyNameRule,
  description: z.string().max(500, 'Mô tả tối đa 500 ký tự').optional(),
});

type FormValues = z.infer<typeof formSchema>;

interface WorkspaceFormModalProps {
  open: boolean;
  /** Có giá trị = sửa; null = tạo mới. */
  editing: AdminWorkspaceDto | null;
  onClose: () => void;
}

export function WorkspaceFormModal({
  open,
  editing,
  onClose,
}: WorkspaceFormModalProps): React.ReactElement {
  const [formError, setFormError] = useState<string | null>(null);
  const createMutation = useCreateWorkspace();
  const updateMutation = useUpdateWorkspace();

  const { register, handleSubmit, reset, setError, formState } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    mode: 'onChange',
    defaultValues: { name: '', description: '' },
  });

  const { errors, touchedFields, isValid, isSubmitting } = formState;

  // Nạp lại giá trị mỗi lần mở: mở "sửa" cho workspace A rồi đóng, mở "tạo mới"
  // mà không reset thì form vẫn còn tên của A.
  useEffect(() => {
    if (!open) return;
    reset({ name: editing?.name ?? '', description: editing?.description ?? '' });
    setFormError(null);
  }, [open, editing, reset]);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    // `api.ts` tự bỏ mô tả rỗng khỏi payload — xem `withOptionalDescription`.
    const payload = { name: values.name, description: values.description ?? '' };
    try {
      if (editing) {
        await updateMutation.mutateAsync({ id: editing.id, values: payload });
      } else {
        await createMutation.mutateAsync(payload);
      }
      onClose();
    } catch (err) {
      const apiError = getApiError(err);
      if (apiError.fields) {
        for (const [name, message] of Object.entries(apiError.fields)) {
          setError(name as keyof FormValues, { type: 'server', message });
        }
        return;
      }
      setFormError(apiError.message);
    }
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Đổi tên workspace' : 'Tạo workspace'}
      description={
        editing
          ? `Đường dẫn (${editing.slug}) giữ nguyên để không làm hỏng link đã chia sẻ.`
          : 'Không gian làm việc để nhóm dữ liệu, mô hình và báo cáo.'
      }
      footer={
        <>
          <Button onClick={onClose}>Huỷ</Button>
          <Button
            variant="primary"
            type="submit"
            form="workspace-form"
            disabled={!isValid}
            loading={isSubmitting}
          >
            {editing ? 'Lưu' : 'Tạo'}
          </Button>
        </>
      }
    >
      {formError && (
        <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3.5 py-3 text-sm text-red-700">
          {formError}
        </p>
      )}

      <form id="workspace-form" onSubmit={onSubmit} noValidate className="space-y-4">
        <Field
          label="Tên workspace"
          error={touchedFields.name ? errors.name?.message : undefined}
          registration={register('name')}
        />
        <Field
          label="Mô tả (không bắt buộc)"
          error={errors.description?.message}
          registration={register('description')}
        />
      </form>
    </Modal>
  );
}
