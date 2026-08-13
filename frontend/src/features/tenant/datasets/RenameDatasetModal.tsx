import type { DatasetDto } from '@bi/shared';
import { useEffect, useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { Field } from '../../../components/ui/Field';
import { Modal } from '../../../components/ui/Modal';
import { getApiError } from '../../../services/apiClient';
import { useRenameDataset } from '../hooks';

/**
 * Đổi tên hiển thị của một dataset — §8.9.
 *
 * Chỉ đổi TÊN HIỂN THỊ. `source_table` giữ nguyên và vẫn là thứ dùng để khớp
 * với CSDL nguồn ở lần đồng bộ sau — nói rõ điều đó ngay trong hộp thoại, vì
 * nếu không người dùng sẽ tưởng mình vừa đổi tên bảng của họ.
 */
export function RenameDatasetModal({
  dataset,
  onClose,
}: {
  dataset: DatasetDto | null;
  onClose: () => void;
}): React.ReactElement {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const mutation = useRenameDataset();

  useEffect(() => {
    if (dataset) {
      setName(dataset.name);
      setError(null);
    }
  }, [dataset]);

  function submit(): void {
    if (!dataset) return;
    setError(null);
    mutation.mutate(
      { id: dataset.id, name },
      { onSuccess: onClose, onError: (err) => setError(getApiError(err).message) },
    );
  }

  return (
    <Modal
      open={dataset !== null}
      onClose={onClose}
      title="Đổi tên tập dữ liệu"
      description={dataset ? `${dataset.sourceSchema}.${dataset.sourceTable}` : ''}
      footer={
        <>
          <Button onClick={onClose}>Huỷ</Button>
          <Button
            variant="primary"
            onClick={submit}
            loading={mutation.isPending}
            disabled={name.trim() === '' || name === dataset?.name}
          >
            Lưu
          </Button>
        </>
      }
    >
      {error && (
        <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3.5 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <Field
        label="Tên hiển thị"
        value={name}
        onChange={(e) => setName(e.target.value)}
        hint="Chỉ đổi tên hiển thị trong kho. Bảng trong CSDL của bạn không bị đụng tới, và những lần đồng bộ sau vẫn giữ nguyên tên bạn đặt ở đây."
      />
    </Modal>
  );
}
