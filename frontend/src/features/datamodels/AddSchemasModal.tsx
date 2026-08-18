import { LOAD_STATUS_LABELS, LOAD_STATUSES_LIVE } from '@bi/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { ErrorState } from '../../components/ui/states';
import { useDatasets } from '../tenant/hooks';
import { getApiError } from '../../services/apiClient';
import { useAddDatasets, useDataModel } from './hooks';

/**
 * "+ Add Schemas" — §8.3.
 *
 * Một Schema sinh ra từ đúng một Dataset (§8.2), nên thêm Schema chính là thêm
 * bộ dữ liệu vào model. Bộ đã có trong model bị vô hiệu kèm nhãn, thay vì biến
 * mất — biến mất thì người dùng đi tìm mãi không thấy và không có gì giải thích.
 */
interface Props {
  open: boolean;
  onClose: () => void;
  dataModelId: number;
}

export function AddSchemasModal({ open, onClose, dataModelId }: Props): React.ReactElement {
  const model = useDataModel(open ? dataModelId : null);
  const add = useAddDatasets(dataModelId);

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [formError, setFormError] = useState<string | null>(null);

  const { data, isPending } = useDatasets(
    { page: 1, pageSize: 100, q: '', sort: 'name', order: 'asc', connectionId: '', source: '' },
    open,
  );

  const datasets = data?.items ?? [];
  const already = new Set((model.data?.datasets ?? []).map((d) => d.datasetId));
  const loading = datasets.filter((d) => LOAD_STATUSES_LIVE.includes(d.loadStatus)).length;

  function toggle(id: number): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add Schemas"
      description="Mỗi bộ dữ liệu được chọn trở thành một Schema; hệ thống đọc cấu trúc từ kho phân tích và tự sinh field tính toán."
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Huỷ</Button>
          <Button
            variant="primary"
            loading={add.isPending}
            onClick={() => {
              setFormError(null);
              if (selected.size === 0) {
                setFormError('Hãy chọn ít nhất một bộ dữ liệu.');
                return;
              }
              add.mutate([...selected], {
                onSuccess: () => {
                  setSelected(new Set());
                  onClose();
                },
                onError: (err) => setFormError(getApiError(err).message),
              });
            }}
          >
            Add
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {formError !== null && <ErrorState message={formError} />}

        {loading > 0 && (
          <div
            aria-live="polite"
            className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700"
          >
            <strong>{loading} bộ dữ liệu đang được nạp vào kho phân tích.</strong> Danh sách này tự
            cập nhật.
          </div>
        )}

        {isPending && <p className="text-sm text-slate-500">Đang tải…</p>}

        {!isPending && datasets.length === 0 && (
          <p className="text-sm text-slate-500">
            Chưa có bộ dữ liệu nào. Tải một file lên ở{' '}
            <Link to="/datasets" className="text-brand-700 hover:underline">
              Kho dữ liệu
            </Link>{' '}
            trước đã.
          </p>
        )}

        <ul className="max-h-72 space-y-0.5 overflow-y-auto rounded-lg border border-slate-200 p-1.5">
          {datasets.map((dataset) => {
            const inModel = already.has(dataset.id);
            const ready = dataset.loadStatus === 'loaded';
            const usable = ready && !inModel;

            return (
              <li key={dataset.id}>
                <label
                  className={`flex items-center gap-2.5 rounded px-2 py-1.5 text-sm ${
                    usable ? 'cursor-pointer hover:bg-slate-50' : 'cursor-not-allowed opacity-60'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(dataset.id)}
                    disabled={!usable}
                    onChange={() => toggle(dataset.id)}
                    className="rounded border-slate-300"
                  />
                  <span className="flex-1 text-slate-700">{dataset.name}</span>
                  {inModel ? (
                    <Badge tone="neutral">đã có trong model</Badge>
                  ) : ready ? (
                    <span className="text-xs text-slate-400">{dataset.columnCount} cột</span>
                  ) : (
                    <Badge tone="warning">{LOAD_STATUS_LABELS[dataset.loadStatus]}</Badge>
                  )}
                </label>
              </li>
            );
          })}
        </ul>
      </div>
    </Modal>
  );
}
