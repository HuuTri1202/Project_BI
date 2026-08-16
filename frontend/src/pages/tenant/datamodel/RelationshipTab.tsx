import {
  RELATIONSHIP_KIND_LABELS,
  RELATIONSHIP_KINDS,
  type DataModelDetailDto,
  type DataModelRelationshipDto,
  type RelationshipKind,
  type RelationshipWarningDto,
} from '@bi/shared';
import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';

import { usePermissions } from '../../../auth/usePermissions';
import { Button } from '../../../components/ui/Button';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { Modal } from '../../../components/ui/Modal';
import { TBody, Td, Th, THead, TableWrap, Tr } from '../../../components/ui/Table';
import { EmptyState, ErrorState } from '../../../components/ui/states';
import { RelationshipCanvas } from '../../../features/datamodels/relationship/RelationshipCanvas';
import type { CanvasNode } from '../../../features/datamodels/relationship/geometry';
import {
  useCreateRelationship,
  useDeleteRelationship,
  useInvalidateDataModel,
  useSaveLayout,
} from '../../../features/datamodels/hooks';
import { getApiError } from '../../../services/apiClient';

/**
 * Tab Quan hệ — §10.4, §10.5.
 *
 * Sơ đồ ở trên, BẢNG LIỆT KÊ ở dưới, và bảng mới là thứ chịu trách nhiệm:
 * người dùng bàn phím và trình đọc màn hình thao tác ở đó, nút Xoá nằm ở đó
 * (một đường SVG mảnh không phải mục tiêu bấm được), và khi sơ đồ vẽ sai thì
 * bảng vẫn nói đúng.
 *
 * Đi xa hơn bảng `sr-only` của `VegaChart` là có chủ ý: dữ liệu ở đây SỬA ĐƯỢC,
 * và giấu đường sửa duy nhất khỏi người dùng bàn phím là một bước lùi.
 *
 * Quan hệ tạo bằng FORM, không phải bằng cách kéo từ cổng này sang cổng kia.
 * Kéo-để-nối là một tương tác lớn hơn nhiều với bài toán tiếp cận riêng của nó,
 * và đề bài yêu cầu một nút "+ Add Relationship" — tức là một form.
 */

interface FormState {
  leftId: number;
  leftColumnId: number | '';
  rightId: number;
  rightColumnId: number | '';
  kind: RelationshipKind;
}

export default function RelationshipTab(): React.ReactElement {
  const model = useOutletContext<DataModelDetailDto>();
  const permissions = usePermissions();
  const canEdit = permissions.can('datamodel', 'modify');

  const create = useCreateRelationship(model.id);
  const remove = useDeleteRelationship(model.id);
  const saveLayout = useSaveLayout(model.id);
  const invalidate = useInvalidateDataModel();

  const [form, setForm] = useState<FormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [warning, setWarning] = useState<RelationshipWarningDto | null>(null);
  const [deleting, setDeleting] = useState<DataModelRelationshipDto | null>(null);
  const [layoutError, setLayoutError] = useState(false);

  const nodes: CanvasNode[] = model.datasets.map((ds) => ({
    id: ds.id,
    label: ds.datasetName,
    columns: ds.columns.map((c) => ({
      id: c.id,
      name: c.alias ?? c.columnName,
      role: c.role,
    })),
    x: ds.canvasX,
    y: ds.canvasY,
  }));

  const leftDataset = model.datasets.find((d) => d.id === form?.leftId);
  const rightDataset = model.datasets.find((d) => d.id === form?.rightId);

  function openForm(): void {
    const [first, second] = model.datasets;
    if (first === undefined || second === undefined) return;
    setFormError(null);
    setWarning(null);
    setForm({
      leftId: first.id,
      leftColumnId: '',
      rightId: second.id,
      rightColumnId: '',
      kind: 'many_to_one',
    });
  }

  function submit(): void {
    if (form === null) return;
    setFormError(null);

    if (form.leftColumnId === '' || form.rightColumnId === '') {
      setFormError('Hãy chọn cột khoá ở cả hai bảng.');
      return;
    }

    create.mutate(
      {
        leftId: form.leftId,
        leftColumnId: Number(form.leftColumnId),
        rightId: form.rightId,
        rightColumnId: Number(form.rightColumnId),
        kind: form.kind,
      },
      {
        onSuccess: (result) => {
          setForm(null);
          // Cảnh báo khoá trùng hiện SAU khi lưu, không chặn: nối qua bảng cầu
          // nối là hợp lệ và cũng cho ra khoá trùng. Nhưng phải nói ra, vì tổng
          // bị nhân lên là con số sai trông rất hợp lý.
          if (result.warning.duplicateKeys || result.warning.nullKeys > 0) {
            setWarning(result.warning);
          }
        },
        onError: (err) => setFormError(getApiError(err).message),
      },
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-3xl text-sm text-slate-500">
          Khai quan hệ để Cube.js biết cách nối các bảng khi bạn hỏi một câu chạm tới nhiều bảng.
          Kéo thẻ để sắp lại sơ đồ; vị trí được lưu tự động.
        </p>
        <div className="flex gap-2">
          <Button onClick={() => void invalidate()}>Làm mới</Button>
          {canEdit && (
            <Button
              variant="primary"
              onClick={openForm}
              disabled={model.datasets.length < 2}
              title={
                model.datasets.length < 2
                  ? 'Cần ít nhất hai bảng trong mô hình để nối'
                  : undefined
              }
            >
              + Thêm quan hệ
            </Button>
          )}
        </div>
      </div>

      {warning !== null && (
        <div
          role="alert"
          className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          <strong>Đã lưu, nhưng cần lưu ý.</strong>
          {warning.duplicateKeys && (
            <p className="mt-1">
              Cột khoá ở phía &ldquo;một&rdquo; có giá trị <strong>trùng nhau</strong>. Sau khi nối,
              mọi phép tổng có thể bị <strong>nhân lên</strong> — trừ khi đây là bảng trung gian và
              bạn đã lường trước.
            </p>
          )}
          {warning.nullKeys > 0 && (
            <p className="mt-1">
              Có <strong>{warning.nullKeys.toLocaleString('vi-VN')} dòng</strong> mang khoá trống.
              Chúng sẽ bị loại khỏi kết quả khi nối, nên tổng sẽ nhỏ hơn thực tế.
            </p>
          )}
          <div className="mt-2">
            <Button size="sm" onClick={() => setWarning(null)}>
              Đã hiểu
            </Button>
          </div>
        </div>
      )}

      {layoutError && (
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-700">
          Chưa lưu được vị trí sơ đồ.
          <Button size="sm" onClick={() => setLayoutError(false)}>
            Bỏ qua
          </Button>
        </div>
      )}

      {model.datasets.length === 0 ? (
        <EmptyState
          title="Mô hình chưa có bảng nào"
          hint="Thêm bộ dữ liệu vào mô hình rồi quay lại đây để nối chúng."
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-slate-200 bg-slate-50/60 p-2">
          <RelationshipCanvas
            nodes={nodes}
            relationships={model.relationships}
            canEdit={canEdit}
            onMove={(positions) =>
              saveLayout.mutate(
                { positions },
                {
                  // KHÔNG lùi vị trí về cũ khi lưu hỏng: thẻ bật ngược lại dưới
                  // con trỏ người dùng còn khó chịu hơn một vị trí chưa lưu.
                  onError: () => setLayoutError(true),
                  onSuccess: () => setLayoutError(false),
                },
              )
            }
          />
        </div>
      )}

      {/* Bảng này là bản SONG SONG của sơ đồ, không phải phần phụ. Mọi thứ vẽ
          trên sơ đồ đều có ở đây, và nút Xoá chỉ nằm ở đây. */}
      <section className="shrink-0">
        <h2 className="mb-2 text-sm font-semibold text-slate-900">
          Danh sách quan hệ ({model.relationships.length})
        </h2>
        {model.relationships.length === 0 ? (
          <p className="text-sm text-slate-500">
            Chưa có quan hệ nào. Không có quan hệ thì Explorer chỉ hỏi được trong phạm vi từng
            bảng riêng lẻ.
          </p>
        ) : (
          <TableWrap>
            <THead>
              <Tr>
                <Th>Bảng nguồn</Th>
                <Th>Cột khoá</Th>
                <Th>Bảng đích</Th>
                <Th>Cột khoá</Th>
                <Th>Kiểu</Th>
                <Th align="right">Thao tác</Th>
              </Tr>
            </THead>
            <TBody>
              {model.relationships.map((rel) => (
                <Tr key={rel.id}>
                  <Td>{rel.left.datasetName}</Td>
                  <Td>
                    <code className="text-xs text-slate-600">{rel.left.columnName}</code>
                  </Td>
                  <Td>{rel.right.datasetName}</Td>
                  <Td>
                    <code className="text-xs text-slate-600">{rel.right.columnName}</code>
                  </Td>
                  <Td>{RELATIONSHIP_KIND_LABELS[rel.kind]}</Td>
                  <Td align="right">
                    {canEdit ? (
                      <Button size="sm" variant="ghost" onClick={() => setDeleting(rel)}>
                        <span className="text-red-600">Xoá</span>
                      </Button>
                    ) : (
                      <span className="text-xs text-slate-400">Chỉ xem</span>
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </TableWrap>
        )}
      </section>

      <Modal
        open={form !== null}
        onClose={() => setForm(null)}
        title="Thêm quan hệ"
        description="Chọn hai bảng và cột khoá nối chúng với nhau."
        size="lg"
        footer={
          <>
            <Button onClick={() => setForm(null)}>Huỷ</Button>
            <Button variant="primary" onClick={submit} loading={create.isPending}>
              Lưu quan hệ
            </Button>
          </>
        }
      >
        {form !== null && (
          <div className="space-y-4">
            {formError !== null && <ErrorState message={formError} />}

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-700">Bảng nguồn</span>
                <select
                  value={form.leftId}
                  onChange={(e) =>
                    setForm({ ...form, leftId: Number(e.target.value), leftColumnId: '' })
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  {model.datasets.map((ds) => (
                    <option key={ds.id} value={ds.id}>
                      {ds.datasetName}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-700">Cột khoá</span>
                <select
                  value={form.leftColumnId}
                  onChange={(e) => setForm({ ...form, leftColumnId: Number(e.target.value) })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">— Chọn cột —</option>
                  {(leftDataset?.columns ?? [])
                    .filter((c) => c.role !== 'hidden')
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.alias ?? c.columnName}
                      </option>
                    ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-700">Bảng đích</span>
                <select
                  value={form.rightId}
                  onChange={(e) =>
                    setForm({ ...form, rightId: Number(e.target.value), rightColumnId: '' })
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  {model.datasets.map((ds) => (
                    <option key={ds.id} value={ds.id}>
                      {ds.datasetName}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-700">Cột khoá</span>
                <select
                  value={form.rightColumnId}
                  onChange={(e) => setForm({ ...form, rightColumnId: Number(e.target.value) })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">— Chọn cột —</option>
                  {(rightDataset?.columns ?? [])
                    .filter((c) => c.role !== 'hidden')
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.alias ?? c.columnName}
                      </option>
                    ))}
                </select>
              </label>
            </div>

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">Kiểu quan hệ</span>
              <select
                value={form.kind}
                onChange={(e) => setForm({ ...form, kind: e.target.value as RelationshipKind })}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              >
                {RELATIONSHIP_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {RELATIONSHIP_KIND_LABELS[kind]}
                  </option>
                ))}
              </select>
              {/* Đặt sai kiểu thì số VẪN RA, chỉ là sai — nên phải giải thích,
                  không chỉ đưa một ô chọn. */}
              <span className="mt-1 block text-xs text-slate-500">
                <strong>Nhiều → một</strong> là trường hợp hay gặp nhất: nhiều đơn hàng cùng trỏ
                về một khách hàng. Chọn sai thì kết quả vẫn ra nhưng con số sẽ sai.
              </span>
            </label>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Xoá quan hệ"
        description={
          deleting === null
            ? undefined
            : `${deleting.left.datasetName} → ${deleting.right.datasetName}`
        }
        confirmLabel="Xoá"
        danger
        loading={remove.isPending}
        onConfirm={(onError) => {
          if (deleting === null) return;
          remove.mutate(deleting.id, { onSuccess: () => setDeleting(null), onError });
        }}
      >
        Sau khi xoá, Explorer không nối được hai bảng này nữa — câu hỏi chạm tới cả hai sẽ báo
        lỗi cho tới khi bạn khai một quan hệ khác.
      </ConfirmDialog>
    </div>
  );
}
