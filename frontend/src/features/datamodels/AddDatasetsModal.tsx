import { LOAD_STATUS_LABELS, type DataModelDatasetDto } from '@bi/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { ErrorState } from '../../components/ui/states';
import { getApiError } from '../../services/apiClient';
import { useDatasets } from '../tenant/hooks';
import { useAddDatasets } from './hooks';

/**
 * Thêm bảng vào một mô hình ĐÃ CÓ.
 *
 * `POST /datamodels/:id/datasets` tồn tại từ §10 nhưng chưa có nút nào gọi tới,
 * nên mô hình chỉ nhận bảng đúng một lần lúc tạo. Muốn thêm một bảng thứ tư thì
 * phải xoá cả mô hình rồi dựng lại — mất sạch alias, vai trò cột, thước đo và
 * quan hệ đã khai. Hộp thoại này là đường còn thiếu.
 *
 * Cùng luật với `CreateDataModelModal`: bộ chưa nạp vào kho phân tích vẫn hiện
 * ra nhưng vô hiệu kèm lý do, chứ không bị giấu đi không giải thích.
 */
export function AddDatasetsModal({
  open,
  onClose,
  modelId,
  existing,
}: {
  open: boolean;
  onClose: () => void;
  modelId: number;
  /** Bảng đã có trong mô hình — hiện ra nhưng không tích lại được. */
  existing: DataModelDatasetDto[];
}): React.ReactElement {
  const add = useAddDatasets(modelId);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [formError, setFormError] = useState<string | null>(null);

  const { data, isPending } = useDatasets(
    { page: 1, pageSize: 100, q: '', sort: 'name', order: 'asc', connectionId: '', source: '' },
    open,
  );

  const inModel = new Set(existing.map((d) => d.datasetId));
  const datasets = data?.items ?? [];
  const available = datasets.filter((d) => !inModel.has(d.id));

  function toggle(id: number): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function submit(): void {
    setFormError(null);
    if (selected.size === 0) {
      setFormError('Hãy chọn ít nhất một bảng.');
      return;
    }

    add.mutate([...selected], {
      onSuccess: () => {
        setSelected(new Set());
        onClose();
      },
      onError: (err) => setFormError(getApiError(err).message),
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Thêm bảng vào mô hình"
      description="Cấu trúc cột được đọc từ kho phân tích và phân loại tự động, giống như lúc tạo mô hình."
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Huỷ</Button>
          <Button variant="primary" onClick={submit} loading={add.isPending}>
            Thêm {selected.size > 0 ? `${selected.size} bảng` : ''}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {formError !== null && <ErrorState message={formError} />}

        {isPending && <p className="text-sm text-slate-500">Đang tải…</p>}

        {!isPending && available.length === 0 && (
          <p className="text-sm text-slate-500">
            Mọi bộ dữ liệu trong workspace này đã có trong mô hình. Tải thêm ở{' '}
            <Link to="/datasets" className="text-brand-700 hover:underline">
              Kho dữ liệu
            </Link>
            .
          </p>
        )}

        {available.length > 0 && (
          <ul className="max-h-80 space-y-0.5 overflow-y-auto rounded-lg border border-slate-200 p-1.5">
            {available.map((dataset) => {
              const ready = dataset.loadStatus === 'loaded';
              return (
                <li key={dataset.id}>
                  <label
                    className={`flex items-center gap-2.5 rounded px-2 py-1.5 text-sm ${
                      ready ? 'cursor-pointer hover:bg-slate-50' : 'cursor-not-allowed opacity-60'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(dataset.id)}
                      disabled={!ready}
                      onChange={() => toggle(dataset.id)}
                      className="rounded border-slate-300"
                    />
                    <span className="flex-1 text-slate-700">{dataset.name}</span>
                    {ready ? (
                      <span className="text-xs text-slate-400">{dataset.columnCount} cột</span>
                    ) : (
                      <Badge tone="warning">{LOAD_STATUS_LABELS[dataset.loadStatus]}</Badge>
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
}
