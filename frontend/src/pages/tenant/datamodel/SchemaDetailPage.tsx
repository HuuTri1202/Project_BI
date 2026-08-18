import { CALC_AGG_LABELS, type DataModelColumnDto } from '@bi/shared';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { usePermissions } from '../../../auth/usePermissions';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Modal } from '../../../components/ui/Modal';
import { Page, PageBody, PageHeader } from '../../../components/ui/Page';
import { TBody, Td, Th, THead, TableWrap, Tr } from '../../../components/ui/Table';
import { ErrorState, TableSkeleton } from '../../../components/ui/states';
import { useSchemaFields, useUpdateField } from '../../../features/datamodels/hooks';
import { getApiError } from '../../../services/apiClient';

/**
 * Trang chi tiết Schema — §8.3.1.
 *
 * ─── Hệ thống tự làm ────────────────────────────────────────────────────────
 *
 * Đọc cột từ ClickHouse, và với MỖI cột số sinh thêm bốn field tính toán:
 * `<cột>_count`, `<cột>_countDistinct`, `<cột>_sum`, `<cột>_avg`. Tất cả lưu
 * vào MySQL. Người dùng không tạo tay field nào.
 *
 * ─── Người dùng làm được ba việc ────────────────────────────────────────────
 *
 *   Visibility     công tắc. Tắt = ẩn field khỏi Data Model, nghĩa là nó KHÔNG
 *                  được sinh vào file cube — Explorer không thấy nó nữa.
 *   Description    mô tả field.
 *   Display Name   tên hiển thị.
 *
 * Mỗi việc gửi ĐÚNG trường của nó lên `PUT`. Gửi cả ba mỗi lần thì một cú gạt
 * công tắc sẽ ghi đè mô tả người dùng vừa nhập ở dòng bên cạnh.
 */

/** Sửa Description và Display Name — một hộp thoại cho cả hai. */
function EditFieldModal({
  field,
  onClose,
  onSave,
  saving,
}: {
  field: DataModelColumnDto | null;
  onClose: () => void;
  onSave: (input: { displayName: string | null; description: string | null }) => void;
  saving: boolean;
}): React.ReactElement {
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [loadedFor, setLoadedFor] = useState<number | null>(null);

  // Nạp giá trị khi hộp thoại mở cho một field KHÁC. Dùng `loadedFor` thay cho
  // `useEffect` để tránh một nhịp render với ô rỗng.
  if (field !== null && loadedFor !== field.id) {
    setLoadedFor(field.id);
    setDisplayName(field.displayName ?? '');
    setDescription(field.description ?? '');
  }

  return (
    <Modal
      open={field !== null}
      onClose={onClose}
      title="Edit field"
      description={field?.columnName}
      footer={
        <>
          <Button onClick={onClose}>Huỷ</Button>
          <Button
            variant="primary"
            loading={saving}
            onClick={() =>
              onSave({
                displayName: displayName.trim() === '' ? null : displayName.trim(),
                description: description.trim() === '' ? null : description.trim(),
              })
            }
          >
            Lưu
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Display Name</span>
          <input
            type="text"
            value={displayName}
            autoFocus
            placeholder={field?.columnName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Description</span>
          <textarea
            value={description}
            rows={3}
            placeholder="Field này nói lên điều gì?"
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
      </div>
    </Modal>
  );
}

export default function SchemaDetailPage(): React.ReactElement {
  const { id, schemaId } = useParams();
  const permissions = usePermissions();
  const canEdit = permissions.can('datamodel', 'modify');

  const modelId = Number(id);
  const sid = Number(schemaId);
  const validModel = Number.isInteger(modelId) && modelId > 0 ? modelId : null;
  const validSchema = Number.isInteger(sid) && sid > 0 ? sid : null;

  const { data, isPending, isError, error } = useSchemaFields(validModel, validSchema);
  const update = useUpdateField(validModel ?? 0, validSchema ?? 0);

  const [editing, setEditing] = useState<DataModelColumnDto | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  function save(fieldId: number, input: Parameters<typeof update.mutate>[0]['input']): void {
    setSaveError(null);
    update.mutate(
      { fieldId, input },
      {
        onSuccess: () => setEditing(null),
        onError: (err) => setSaveError(getApiError(err).message),
      },
    );
  }

  return (
    <Page>
      <PageHeader
        title={data?.schema.name ?? 'Schema'}
        description={
          data === undefined
            ? undefined
            : `${data.fields.filter((f) => f.calcAgg === null).length} columns · ${
                data.fields.filter((f) => f.calcAgg !== null).length
              } calculated fields`
        }
      >
        <nav className="mt-1 flex flex-wrap items-center gap-1.5 text-sm" aria-label="Đường dẫn">
          <Link to="/datamodels" className="text-brand-700 hover:underline">
            Data Model
          </Link>
          <span aria-hidden="true" className="text-slate-400">
            ›
          </span>
          <Link to={`/datamodels/${modelId}`} className="text-brand-700 hover:underline">
            Schemas
          </Link>
          <span aria-hidden="true" className="text-slate-400">
            ›
          </span>
          <span aria-current="page" className="text-slate-500">
            {data?.schema.name ?? '…'}
          </span>
        </nav>
        {data !== undefined && (
          <code className="mt-2 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
            {data.schema.chTable}
          </code>
        )}
      </PageHeader>

      <PageBody>
        {(validModel === null || validSchema === null) && (
          <ErrorState message="Địa chỉ không hợp lệ — không có schema nào ứng với đường dẫn này." />
        )}
        {isError && <ErrorState message={getApiError(error).message} />}
        {isPending && validSchema !== null && <TableSkeleton rows={8} />}
        {saveError !== null && <ErrorState message={saveError} />}

        {data !== undefined && (
          <TableWrap>
            <THead>
              <Tr>
                <Th>Field</Th>
                <Th>Type</Th>
                <Th>Display Name</Th>
                <Th>Description</Th>
                <Th align="right">Visibility</Th>
                <Th align="right">Actions</Th>
              </Tr>
            </THead>
            <TBody>
              {data.fields.map((field) => (
                <Tr key={field.id}>
                  <Td>
                    <code className="text-xs text-slate-700">{field.columnName}</code>
                  </Td>
                  <Td>
                    {field.calcAgg === null ? (
                      <code className="text-xs text-slate-500">{field.chType}</code>
                    ) : (
                      // Field tính toán không có kiểu ClickHouse riêng — nó là
                      // một phép tính trên cột gốc. Hiện phép tính thay vì lặp
                      // lại kiểu của cột nguồn.
                      <Badge tone="brand">{CALC_AGG_LABELS[field.calcAgg]}</Badge>
                    )}
                  </Td>
                  <Td>
                    <span className={field.displayName === null ? 'text-slate-400' : 'text-slate-800'}>
                      {field.displayName ?? field.columnName}
                    </span>
                  </Td>
                  <Td>
                    <span className="text-slate-600">
                      {field.description ?? <span className="text-slate-400">—</span>}
                    </span>
                  </Td>
                  <Td align="right">
                    {/* Công tắc thật: `role="switch"` + `aria-checked` để trình
                        đọc màn hình đọc ra "bật/tắt", không phải "nút". */}
                    <button
                      type="button"
                      role="switch"
                      aria-checked={field.visible}
                      aria-label={`Visibility của ${field.columnName}`}
                      disabled={!canEdit || update.isPending}
                      onClick={() => save(field.id, { visible: !field.visible })}
                      className={`inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-50 ${
                        field.visible ? 'bg-brand-600' : 'bg-slate-300'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          field.visible ? 'translate-x-4' : 'translate-x-0.5'
                        }`}
                      />
                    </button>
                  </Td>
                  <Td align="right">
                    {canEdit ? (
                      <Button size="sm" variant="ghost" onClick={() => setEditing(field)}>
                        Edit description
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
      </PageBody>

      <EditFieldModal
        field={editing}
        saving={update.isPending}
        onClose={() => setEditing(null)}
        onSave={(input) => {
          if (editing === null) return;
          save(editing.id, input);
        }}
      />
    </Page>
  );
}
