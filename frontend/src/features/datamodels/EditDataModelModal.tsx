import type { DataModelDto } from '@bi/shared';
import { useEffect, useState } from 'react';

import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { ErrorState } from '../../components/ui/states';
import { getApiError } from '../../services/apiClient';
import { useUpdateDataModel } from './hooks';

/**
 * Đổi tên và mô tả một mô hình — §10.1.
 *
 * ─── Vì sao mô tả nằm ở đây chứ không ở trong mô hình ───────────────────────
 *
 * Tab Schemas đã có ô mô tả, nhưng đó là mô tả của từng BẢNG. Mô tả của cả mô
 * hình chưa có đường nào sửa: nó được `PATCH /datamodels/:id` nhận từ đầu, và
 * `CreateDataModelModal` không hỏi tới. Nên một mô hình sinh ra là mô tả rỗng
 * vĩnh viễn — chỉ vì thiếu đúng cái ô này.
 *
 * Nó đáng có: trong một danh sách mười mô hình, tên "test" và tên "bán hàng Q4"
 * đều không nói được mô hình đó gộp những bảng nào và trả lời câu hỏi gì.
 */
export function EditDataModelModal({
  model,
  onClose,
}: {
  model: DataModelDto | null;
  onClose: () => void;
}): React.ReactElement {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Hook phải được gọi ở mọi lần render, kể cả khi hộp thoại đóng. `0` là id
  // không bao giờ tồn tại, và không có đường nào gửi đi khi `model` là null.
  const update = useUpdateDataModel(model?.id ?? 0);

  useEffect(() => {
    if (model === null) return;
    setName(model.name);
    setDescription(model.description ?? '');
    setError(null);
  }, [model]);

  function submit(): void {
    if (model === null) return;
    setError(null);
    update.mutate(
      // Mô tả rỗng lưu thành `null` chứ không phải chuỗi rỗng: cột này nullable,
      // và hai cách biểu diễn "không có mô tả" trong cùng một cột là chỗ để mọi
      // phép kiểm tra sau này phải nhớ cả hai.
      { name: name.trim(), description: description.trim() || null },
      { onSuccess: onClose, onError: (err) => setError(getApiError(err).message) },
    );
  }

  const unchanged =
    model !== null &&
    name.trim() === model.name &&
    (description.trim() || null) === model.description;

  return (
    <Modal
      open={model !== null}
      onClose={onClose}
      title="Sửa mô hình dữ liệu"
      description={model === null ? '' : `${model.datasetCount} bảng · ${model.measureCount} thước đo`}
      footer={
        <>
          <Button onClick={onClose}>Huỷ</Button>
          <Button
            variant="primary"
            loading={update.isPending}
            disabled={name.trim() === '' || unchanged}
            onClick={submit}
          >
            Lưu
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error !== null && <ErrorState message={error} />}

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Tên mô hình</span>
          <input
            type="text"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <span className="mt-1 block text-xs text-slate-500">
            Chỉ là nhãn. Bảng trong kho phân tích và tên cube đều dựng từ ID, nên đổi tên không
            làm hỏng báo cáo nào đang dùng mô hình này.
          </span>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Mô tả</span>
          <textarea
            value={description}
            rows={3}
            placeholder="Mô hình này gộp những bảng nào, trả lời câu hỏi gì…"
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
      </div>
    </Modal>
  );
}
