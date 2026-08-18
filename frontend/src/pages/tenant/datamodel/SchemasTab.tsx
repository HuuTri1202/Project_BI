import type { DataModelDetailDto } from '@bi/shared';
import { useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';

import { usePermissions } from '../../../auth/usePermissions';
import { Button } from '../../../components/ui/Button';
import { TBody, Td, Th, THead, TableWrap, Tr } from '../../../components/ui/Table';
import { EmptyState, ErrorState, TableSkeleton } from '../../../components/ui/states';
import { AddSchemasModal } from '../../../features/datamodels/AddSchemasModal';
import { useSchemas, useSyncSchema } from '../../../features/datamodels/hooks';
import { getApiError } from '../../../services/apiClient';

/**
 * Tab Schemas — §8.3.
 *
 * Bảng danh sách Schema, nút Sync, nút "+ Add Schemas", và bấm vào một Schema
 * thì sang trang chi tiết của nó.
 *
 * MỘT Schema sinh ra từ đúng MỘT Dataset (§8.2), nên "thêm Schema" chính là
 * "thêm bộ dữ liệu vào model" — hai cách gọi của cùng một việc.
 */
export default function SchemasTab(): React.ReactElement {
  const model = useOutletContext<DataModelDetailDto>();
  const permissions = usePermissions();
  const canEdit = permissions.can('datamodel', 'modify');

  const { data, isPending, isError, error } = useSchemas(model.id);
  const sync = useSyncSchema(model.id);

  const [adding, setAdding] = useState(false);
  const [syncing, setSyncing] = useState<number | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  function onSync(schemaId: number): void {
    setSyncMessage(null);
    setSyncError(null);
    setSyncing(schemaId);

    sync.mutate(schemaId, {
      onSuccess: (result) => {
        setSyncing(null);
        const parts: string[] = [];
        if (result.added.length > 0) parts.push(`thêm ${result.added.length} cột`);
        if (result.removed.length > 0) parts.push(`gỡ ${result.removed.length} cột`);
        if (result.typeChanged.length > 0) parts.push(`${result.typeChanged.length} cột đổi kiểu`);
        if (result.calcFieldsAdded > 0) parts.push(`${result.calcFieldsAdded} field tính toán mới`);
        // "Không có gì đổi" là một kết quả HỢP LỆ và hay gặp nhất. Không nói ra
        // thì người dùng bấm Sync, không thấy gì xảy ra, rồi bấm tiếp.
        setSyncMessage(
          parts.length === 0 ? 'Đã đồng bộ — cấu trúc không có gì thay đổi.' : `Đã đồng bộ: ${parts.join(', ')}.`,
        );
      },
      onError: (err) => {
        setSyncing(null);
        setSyncError(getApiError(err).message);
      },
    });
  }

  if (isError) return <ErrorState message={getApiError(error).message} />;
  if (isPending) return <TableSkeleton rows={4} />;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-3xl text-sm text-slate-500">
          Mỗi Schema là cấu trúc của một bộ dữ liệu trong kho phân tích. Bấm vào tên để xem và sửa
          Field; bấm <strong>Sync</strong> để đọc lại cấu trúc từ ClickHouse.
        </p>
        {canEdit && (
          <Button variant="primary" onClick={() => setAdding(true)}>
            + Add Schemas
          </Button>
        )}
      </div>

      {syncMessage !== null && (
        <div
          aria-live="polite"
          className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-700"
        >
          {syncMessage}
        </div>
      )}
      {syncError !== null && <ErrorState message={syncError} />}

      {(data ?? []).length === 0 ? (
        <EmptyState
          title="Model chưa có Schema nào"
          hint="Bấm “+ Add Schemas” để chọn bộ dữ liệu đưa vào model."
          action={
            canEdit ? (
              <Button variant="primary" onClick={() => setAdding(true)}>
                + Add Schemas
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <TableWrap>
            <THead>
              <Tr>
                <Th>Schema</Th>
                <Th>ClickHouse Table</Th>
                <Th align="right">Columns</Th>
                <Th align="right">Calculated Fields</Th>
                <Th align="right">Visible</Th>
                <Th align="right">Actions</Th>
              </Tr>
            </THead>
            <TBody>
              {(data ?? []).map((schema) => (
                <Tr key={schema.id}>
                  <Td>
                    <Link
                      to={`/datamodels/${model.id}/schemas/${schema.id}`}
                      className="font-medium text-brand-700 hover:underline"
                    >
                      {schema.name}
                    </Link>
                  </Td>
                  <Td>
                    <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                      {schema.chTable}
                    </code>
                  </Td>
                  <Td align="right">{schema.columnCount}</Td>
                  <Td align="right">{schema.calcFieldCount}</Td>
                  <Td align="right">
                    {schema.visibleCount}
                    <span className="text-slate-400">
                      /{schema.columnCount + schema.calcFieldCount}
                    </span>
                  </Td>
                  <Td align="right">
                    {canEdit ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={syncing === schema.id}
                        onClick={() => onSync(schema.id)}
                      >
                        Sync
                      </Button>
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

      <AddSchemasModal open={adding} onClose={() => setAdding(false)} dataModelId={model.id} />
    </div>
  );
}
