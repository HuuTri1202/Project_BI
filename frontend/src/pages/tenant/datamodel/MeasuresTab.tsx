import {
  MEASURE_AGG_LABELS,
  MEASURE_AGGS,
  type DataModelDetailDto,
  type DataModelMeasureDto,
  type MeasureAgg,
} from '@bi/shared';
import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';

import { usePermissions } from '../../../auth/usePermissions';
import { Button } from '../../../components/ui/Button';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { Modal } from '../../../components/ui/Modal';
import { TBody, Td, Th, THead, TableWrap, Tr } from '../../../components/ui/Table';
import { EmptyState, ErrorState, TableSkeleton } from '../../../components/ui/states';
import {
  useCreateMeasure,
  useDeleteMeasure,
  useMeasures,
  useUpdateMeasure,
} from '../../../features/datamodels/hooks';
import { getApiError } from '../../../services/apiClient';

/**
 * Tab Thước đo — §10.6.
 *
 * Danh sách KHÔNG rỗng với một mô hình mới: §10.2 gieo sẵn một thước đo `Tổng`
 * cho mỗi cột số lúc tạo mô hình. Nếu không có bước gieo đó thì phân loại
 * "số → Thước đo" của §10.2 không dẫn đi đâu cả, và Explorer mở ra không đo
 * được gì — đó là lỗ hổng chỉ lộ ra khi hỏi Cube "cube này có gì".
 */

interface FormState {
  measureId: number | null;
  datamodelDatasetId: number;
  name: string;
  agg: MeasureAgg;
  columnId: number | '';
}

export default function MeasuresTab(): React.ReactElement {
  const model = useOutletContext<DataModelDetailDto>();
  const permissions = usePermissions();
  const canEdit = permissions.can('datamodel', 'modify');

  const { data, isPending, isError, error } = useMeasures(model.id);
  const create = useCreateMeasure(model.id);
  const update = useUpdateMeasure(model.id);
  const remove = useDeleteMeasure(model.id);

  const [form, setForm] = useState<FormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<DataModelMeasureDto | null>(null);

  const firstDataset = model.datasets[0];

  function openCreate(): void {
    if (firstDataset === undefined) return;
    setFormError(null);
    setForm({
      measureId: null,
      datamodelDatasetId: firstDataset.id,
      name: '',
      agg: 'sum',
      columnId: '',
    });
  }

  function openEdit(measure: DataModelMeasureDto): void {
    setFormError(null);
    setForm({
      measureId: measure.id,
      datamodelDatasetId: measure.datamodelDatasetId,
      name: measure.name,
      agg: measure.agg,
      columnId: measure.columnId ?? '',
    });
  }

  // Chỉ cột SỐ mới đo được — trừ khi phép tính là đếm dòng, vốn không cần cột.
  const dataset = model.datasets.find((d) => d.id === form?.datamodelDatasetId);
  const numericColumns = (dataset?.columns ?? []).filter(
    (c) => c.cubeType === 'number' && c.role !== 'hidden',
  );

  function submit(): void {
    if (form === null) return;
    setFormError(null);

    // `count` là đếm DÒNG nên không có cột. Backend cưỡng chế lại luật này; ở
    // đây chỉ là không bày ra một cái bẫy.
    const columnId = form.agg === 'count' ? undefined : Number(form.columnId);
    if (form.agg !== 'count' && (!columnId || Number.isNaN(columnId))) {
      setFormError('Hãy chọn cột để đo.');
      return;
    }

    const onError = (err: unknown): void => setFormError(getApiError(err).message);
    const onSuccess = (): void => setForm(null);

    if (form.measureId === null) {
      create.mutate(
        {
          datamodelDatasetId: form.datamodelDatasetId,
          name: form.name,
          agg: form.agg,
          ...(columnId === undefined ? {} : { columnId }),
        },
        { onSuccess, onError },
      );
    } else {
      update.mutate(
        {
          measureId: form.measureId,
          input: {
            name: form.name,
            agg: form.agg,
            ...(columnId === undefined ? {} : { columnId }),
          },
        },
        { onSuccess, onError },
      );
    }
  }

  if (isError) return <ErrorState message={getApiError(error).message} />;
  if (isPending) return <TableSkeleton rows={5} />;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-3xl text-sm text-slate-500">
          Thước đo là một con số có tên và một phép tính — ví dụ <em>Tổng doanh thu</em> ={' '}
          <code className="text-xs">SUM(Doanh_thu)</code>. Một cột đẻ ra được nhiều thước đo.
        </p>
        {canEdit && (
          <Button variant="primary" onClick={openCreate} disabled={firstDataset === undefined}>
            + Thêm thước đo
          </Button>
        )}
      </div>

      {(data ?? []).length === 0 ? (
        <EmptyState
          title="Chưa có thước đo nào"
          hint={
            firstDataset === undefined
              ? 'Thêm bộ dữ liệu vào mô hình trước đã.'
              : 'Mô hình không có cột số nào, hoặc thước đo đã bị xoá hết. Thêm một cái để Explorer đo được.'
          }
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <TableWrap>
            <THead>
              <Tr>
                <Th>Tên thước đo</Th>
                <Th>Bảng</Th>
                <Th>Cột</Th>
                <Th>Phép tính</Th>
                <Th align="right">Thao tác</Th>
              </Tr>
            </THead>
            <TBody>
              {(data ?? []).map((measure) => (
                <Tr key={measure.id}>
                  <Td>
                    <span className="font-medium text-slate-900">{measure.name}</span>
                  </Td>
                  <Td>{measure.datasetName}</Td>
                  <Td>
                    {measure.columnName === null ? (
                      <span className="text-slate-400">— (đếm dòng)</span>
                    ) : (
                      <code className="text-xs text-slate-600">{measure.columnName}</code>
                    )}
                  </Td>
                  <Td>{MEASURE_AGG_LABELS[measure.agg]}</Td>
                  <Td align="right">
                    {canEdit ? (
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(measure)}>
                          Sửa
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setDeleting(measure)}>
                          <span className="text-red-600">Xoá</span>
                        </Button>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">Chỉ xem</span>
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </TableWrap>
        </div>
      )}

      <Modal
        open={form !== null}
        onClose={() => setForm(null)}
        title={form?.measureId === null ? 'Thêm thước đo' : 'Sửa thước đo'}
        footer={
          <>
            <Button onClick={() => setForm(null)}>Huỷ</Button>
            <Button
              variant="primary"
              onClick={submit}
              loading={create.isPending || update.isPending}
            >
              Lưu
            </Button>
          </>
        }
      >
        {form !== null && (
          <div className="space-y-4">
            {formError !== null && <ErrorState message={formError} />}

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">Tên thước đo</span>
              <input
                type="text"
                value={form.name}
                autoFocus
                placeholder="Tổng doanh thu"
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">Bảng</span>
              <select
                value={form.datamodelDatasetId}
                disabled={form.measureId !== null}
                onChange={(e) =>
                  setForm({ ...form, datamodelDatasetId: Number(e.target.value), columnId: '' })
                }
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
              >
                {model.datasets.map((ds) => (
                  <option key={ds.id} value={ds.id}>
                    {ds.datasetName}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">Phép tính</span>
              <select
                value={form.agg}
                onChange={(e) => setForm({ ...form, agg: e.target.value as MeasureAgg })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                {MEASURE_AGGS.map((agg) => (
                  <option key={agg} value={agg}>
                    {MEASURE_AGG_LABELS[agg]}
                  </option>
                ))}
              </select>
            </label>

            {/* Đếm dòng không có cột — giấu hẳn ô chọn thay vì để nó ở đó rồi
                báo lỗi sau khi người dùng đã điền. */}
            {form.agg !== 'count' && (
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-700">Cột để đo</span>
                <select
                  value={form.columnId}
                  onChange={(e) => setForm({ ...form, columnId: Number(e.target.value) })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">— Chọn cột —</option>
                  {numericColumns.map((column) => (
                    <option key={column.id} value={column.id}>
                      {column.alias ?? column.columnName}
                    </option>
                  ))}
                </select>
                {numericColumns.length === 0 && (
                  <span className="mt-1 block text-xs text-amber-700">
                    Bảng này không có cột số nào. Kiểm lại vai trò cột ở tab Schemas.
                  </span>
                )}
              </label>
            )}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Xoá thước đo"
        description={deleting?.name}
        confirmLabel="Xoá"
        danger
        loading={remove.isPending}
        onConfirm={(onError) => {
          if (deleting === null) return;
          remove.mutate(deleting.id, { onSuccess: () => setDeleting(null), onError });
        }}
      >
        Thước đo biến mất khỏi Explorer. Báo cáo đang dùng nó sẽ không chạy được cho tới khi bạn
        chọn thước đo khác.
      </ConfirmDialog>
    </div>
  );
}
