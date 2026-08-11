import { zodResolver } from '@hookform/resolvers/zod';
import type { ProjectDto } from '@bi/shared';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '../../components/ui/Button';
import { Field } from '../../components/ui/Field';
import { Modal } from '../../components/ui/Modal';
import { getApiError } from '../../services/apiClient';
import { useCreateProject, useUpdateProject } from './hooks';

/**
 * Tạo và sửa project dùng CHUNG một modal.
 *
 * Hai modal riêng cho hai thao tác khác nhau đúng một chỗ — nhãn — nhưng lại
 * nhân đôi phần validate, phần dựng ô nhập và phần hiển thị lỗi. Chúng sẽ lệch
 * nhau ở lần sửa thứ hai.
 *
 * `project === null` là chế độ tạo.
 */
const schema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Vui lòng nhập tên project')
    .max(255, 'Tên project tối đa 255 ký tự'),
  description: z.string().trim().max(500, 'Mô tả tối đa 500 ký tự'),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onClose: () => void;
  project: ProjectDto | null;
}

export function ProjectFormModal({ open, onClose, project }: Props): React.ReactElement {
  const create = useCreateProject();
  const update = useUpdateProject();
  const pending = create.isPending || update.isPending;

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', description: '' },
  });

  // Nạp lại giá trị mỗi lần modal MỞ, không phải mỗi lần `project` đổi.
  //
  // `defaultValues` chỉ có tác dụng ở lần dựng đầu tiên, mà modal không bị
  // unmount giữa các lần mở — thiếu effect này thì bấm Sửa dòng A, đóng, rồi bấm
  // Sửa dòng B sẽ hiện dữ liệu của A.
  useEffect(() => {
    if (!open) return;
    reset({ name: project?.name ?? '', description: project?.description ?? '' });
  }, [open, project, reset]);

  async function onSubmit(values: FormValues): Promise<void> {
    try {
      if (project) {
        await update.mutateAsync({ id: project.id, values });
      } else {
        await create.mutateAsync(values);
      }
      onClose();
    } catch (err) {
      const apiError = getApiError(err);
      // Lỗi validate của backend về theo từng trường; các lỗi khác gắn vào ô tên
      // để người dùng nhìn thấy ngay chỗ họ đang thao tác.
      setError('name', { message: apiError.fields?.['name'] ?? apiError.message });
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={project ? 'Sửa project' : 'Tạo project'}
      description={
        project
          ? 'Đổi tên hoặc mô tả. Dữ liệu bên trong không bị ảnh hưởng.'
          : 'Project là nơi chứa dataset và báo cáo của một mảng công việc.'
      }
      footer={
        <>
          <Button onClick={onClose} disabled={pending}>
            Huỷ
          </Button>
          <Button
            type="submit"
            form="project-form"
            variant="primary"
            loading={pending}
          >
            {project ? 'Lưu' : 'Tạo project'}
          </Button>
        </>
      }
    >
      {/* Nút submit nằm ở `footer` — ngoài thẻ <form> — nên phải nối bằng
          `form="project-form"`, nếu không bấm nút sẽ không gửi gì cả. */}
      <form id="project-form" onSubmit={(e) => void handleSubmit(onSubmit)(e)} noValidate>
        <div className="space-y-4">
          <Field
            label="Tên project"
            registration={register('name')}
            error={errors.name?.message}
          />
          <Field
            label="Mô tả"
            registration={register('description')}
            error={errors.description?.message}
            hint="Không bắt buộc."
          />
        </div>
      </form>
    </Modal>
  );
}
