import { COLUMN_ROLE_LABELS, COLUMN_ROLES, type ColumnRole, type DataModelDetailDto } from '@bi/shared';
import { useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';

import { usePermissions } from '../../../auth/usePermissions';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { TBody, Td, Th, THead, TableWrap, Tr } from '../../../components/ui/Table';
import { EmptyState, ErrorState, TableSkeleton } from '../../../components/ui/states';
import { useModelSchema, useSaveSchema } from '../../../features/datamodels/hooks';
import { getApiError } from '../../../services/apiClient';

/**
 * Tab Schemas — §10.3.
 *
 * Đọc cấu trúc THẬT từ ClickHouse (không phải từ `dataset_columns`, vốn mô tả
 * nguồn chứ không mô tả kho), hiện phân loại Chiều/Thước đo, và cho sửa alias
 * lẫn vai trò.
 *
 * ─── Sửa tay là CÁCH XỬ LÝ chính thức ───────────────────────────────────────
 *
 * Bộ phân loại tự động sẽ đoán sai ở hai chỗ đã biết: cột boolean của §7 nạp
 * thành `UInt8` nên bị xếp vào thước đo, và cột mã sản phẩm toàn chữ số cũng
 * vậy. Trang này là nơi sửa, và việc sửa được là một phần của thiết kế — không
 * phải cách chữa cháy cho một thuật toán đoán tồi.
 */

interface Draft {
  alias: string;
  role: ColumnRole;
}

export default function SchemasTab(): React.ReactElement {
  const model = useOutletContext<DataModelDetailDto>();
  const permissions = usePermissions();
  const canEdit = permissions.can('datamodel', 'modify');

  const { data, isPending, isError, error } = useModelSchema(model.id);
  const save = useSaveSchema(model.id);

  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [saveError, setSaveError] = useState<string | null>(null);

  // Nạp lại bản nháp mỗi khi dữ liệu server đổi. Không có bước này thì sau khi
  // lưu xong, ô nhập vẫn giữ giá trị cũ của lần chỉnh trước.
  useEffect(() => {
    if (data === undefined) return;
    const next: Record<number, Draft> = {};
    for (const ds of data.datasets) {
      for (const column of ds.columns) {
        next[column.id] = { alias: column.alias ?? '', role: column.role };
      }
    }
    setDrafts(next);
  }, [data]);

  const dirty = useMemo(() => {
    if (data === undefined) return false;
    for (const ds of data.datasets) {
      for (const column of ds.columns) {
        const draft = drafts[column.id];
        if (draft === undefined) continue;
        if (draft.alias !== (column.alias ?? '') || draft.role !== column.role) return true;
      }
    }
    return false;
  }, [data, drafts]);

  const changedTypes = useMemo(
    () => (data?.datasets ?? []).flatMap((ds) => ds.columns.filter((c) => c.typeChanged)),
    [data],
  );

  if (isError) return <ErrorState message={getApiError(error).message} />;
  if (isPending) return <TableSkeleton rows={8} />;
  if (data === undefined) return <TableSkeleton rows={8} />;

  if (data.datasets.length === 0) {
    return (
      <EmptyState
        title="Mô hình chưa có bảng nào"
        hint="Thêm bộ dữ liệu vào mô hình để bắt đầu gắn nhãn cho các cột."
      />
    );
  }

  function update(columnId: number, patch: Partial<Draft>): void {
    setDrafts((prev) => {
      const current = prev[columnId];
      if (current === undefined) return prev;
      return { ...prev, [columnId]: { ...current, ...patch } };
    });
  }

  function onSave(): void {
    if (data === undefined) return;
    setSaveError(null);

    const columns = data.datasets.flatMap((ds) =>
      ds.columns.map((column) => {
        const draft = drafts[column.id] ?? { alias: column.alias ?? '', role: column.role };
        return {
          columnId: column.id,
          alias: draft.alias.trim() === '' ? null : draft.alias.trim(),
          role: draft.role,
        };
      }),
    );

    save.mutate({ columns }, { onError: (err) => setSaveError(getApiError(err).message) });
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-3xl text-sm text-slate-500">
          Cấu trúc đọc trực tiếp từ kho phân tích (ClickHouse). Hệ thống tự phân loại{' '}
          <strong>số → Thước đo</strong>, <strong>chữ và ngày → Chiều</strong>; sửa lại bên dưới
          nếu đoán chưa đúng. Cột đặt là <em>Ẩn</em> sẽ không xuất hiện ở Explorer.
        </p>
        {canEdit && (
          <Button variant="primary" onClick={onSave} loading={save.isPending} disabled={!dirty}>
            Lưu thay đổi
          </Button>
        )}
      </div>

      {saveError !== null && <ErrorState message={saveError} />}

      {/* Kiểu cột đổi sau một lần nạp lại là chuyện phải NÓI RA: một thước đo
          sum() dựng trên cột vừa thành văn bản sẽ trả về 0 mà không báo lỗi. */}
      {changedTypes.length > 0 && (
        <div
          role="alert"
          className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          <strong>{changedTypes.length} cột đã đổi kiểu trong kho</strong> kể từ lần dựng mô hình.
          Hãy kiểm lại vai trò của chúng — một thước đo dựng trên cột vừa chuyển thành chữ sẽ
          không cộng được nữa.
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto">
        {data.datasets.map((dataset) => (
          <section key={dataset.id}>
            <header className="mb-2 flex flex-wrap items-baseline gap-2">
              <h2 className="text-sm font-semibold text-slate-900">{dataset.datasetName}</h2>
              <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
                {dataset.chTable}
              </code>
            </header>

            <TableWrap>
              <THead>
                <Tr>
                  <Th>Cột trong kho</Th>
                  <Th>Kiểu ClickHouse</Th>
                  <Th>Tên hiển thị</Th>
                  <Th>Vai trò</Th>
                </Tr>
              </THead>
              <TBody>
                {dataset.columns.map((column) => {
                  const draft = drafts[column.id] ?? {
                    alias: column.alias ?? '',
                    role: column.role,
                  };
                  return (
                    <Tr key={column.id}>
                      <Td>
                        <code className="text-xs text-slate-700">{column.columnName}</code>
                        {column.typeChanged && (
                          <span className="ml-2">
                            <Badge tone="warning">kiểu đã đổi</Badge>
                          </span>
                        )}
                      </Td>
                      <Td>
                        <code className="text-xs text-slate-500">{column.chType}</code>
                      </Td>
                      <Td>
                        <input
                          type="text"
                          value={draft.alias}
                          disabled={!canEdit}
                          placeholder={column.columnName}
                          aria-label={`Tên hiển thị của cột ${column.columnName}`}
                          onChange={(e) => update(column.id, { alias: e.target.value })}
                          className="w-full rounded-lg border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-50 disabled:text-slate-500"
                        />
                      </Td>
                      <Td>
                        <select
                          value={draft.role}
                          disabled={!canEdit}
                          aria-label={`Vai trò của cột ${column.columnName}`}
                          onChange={(e) => update(column.id, { role: e.target.value as ColumnRole })}
                          className="rounded-lg border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-50 disabled:text-slate-500"
                        >
                          {COLUMN_ROLES.map((role) => (
                            <option key={role} value={role}>
                              {COLUMN_ROLE_LABELS[role]}
                            </option>
                          ))}
                        </select>
                      </Td>
                    </Tr>
                  );
                })}
              </TBody>
            </TableWrap>
          </section>
        ))}
      </div>
    </div>
  );
}
