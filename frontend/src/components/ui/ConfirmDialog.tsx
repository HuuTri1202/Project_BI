import { useEffect, useState, type ReactNode } from 'react';
import { getApiError } from '../../services/apiClient';
import { Button } from './Button';
import { Modal } from './Modal';

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  loading: boolean;
  onConfirm: (onError: (err: unknown) => void) => void;
}

/**
 * Hộp thoại xác nhận dùng chung cho mọi thao tác khoá / xoá của console.
 *
 * Điểm quan trọng: lỗi từ server hiện NGAY TRONG hộp thoại chứ không đóng lại
 * im lặng. Server từ chối bằng những lý do rất cụ thể — `TenantNotEmpty` kèm số
 * workspace còn lại, `LastSuperadmin`, `CannotModifySelf` — và đó chính là
 * thông tin người dùng cần để biết phải làm gì tiếp.
 */
export function ConfirmDialog({
  open,
  onClose,
  title,
  description,
  children,
  confirmLabel,
  danger = false,
  loading,
  onConfirm,
}: ConfirmDialogProps): React.ReactElement {
  const [error, setError] = useState<string | null>(null);

  // Mở lại hộp thoại thì xoá lỗi cũ, nếu không lần mở sau vẫn hiện lỗi của lần
  // trước và người dùng tưởng thao tác mới cũng vừa thất bại.
  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      {...(description ? { description } : {})}
      footer={
        <>
          <Button onClick={onClose}>Huỷ</Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            loading={loading}
            onClick={() => onConfirm((err) => setError(getApiError(err).message))}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {error && (
        <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3.5 py-3 text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="text-sm text-slate-600">{children}</div>
    </Modal>
  );
}
