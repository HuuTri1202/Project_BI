import type { DataModelDetailDto, ExplorerFieldDto } from '@bi/shared';
import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';

import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { TBody, Td, Th, THead, TableWrap, Tr } from '../../../components/ui/Table';
import { EmptyState, ErrorState, TableSkeleton } from '../../../components/ui/states';
import {
  useExplorerFields,
  useExplorerStatus,
  useRunQuery,
} from '../../../features/datamodels/hooks';
import { getApiError } from '../../../services/apiClient';

/**
 * Tab Explorer — §10.7.
 *
 * Đây là tab DUY NHẤT của §10 phụ thuộc Cube.js. Ba tab kia chỉ đọc MySQL và
 * ClickHouse, nên chúng vẫn chạy bình thường khi Cube tắt — và màn hình báo lỗi
 * ở dưới NÓI RA điều đó, vì "cái gì vẫn dùng được" đáng giá đúng bằng "lệnh nào
 * phải chạy".
 *
 * Trình duyệt không bao giờ thấy một tên cube: nó gửi ID, Express tra trong
 * phạm vi mô hình đã lọc theo tổ chức rồi tự dựng tên. Xem
 * `services/datamodel/explorer.ts`.
 */

function FieldGroup({
  title,
  fields,
  selected,
  onToggle,
  emptyHint,
}: {
  title: string;
  fields: ExplorerFieldDto[];
  selected: Set<number>;
  onToggle: (id: number) => void;
  emptyHint: string;
}): React.ReactElement {
  // Gom theo bảng: một mô hình bốn bảng cho ra vài chục trường, và một danh
  // sách phẳng thì không tìm được gì.
  const byDataset = new Map<string, ExplorerFieldDto[]>();
  for (const field of fields) {
    const list = byDataset.get(field.datasetName) ?? [];
    list.push(field);
    byDataset.set(field.datasetName, list);
  }

  return (
    <section>
      <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">
        {title}
      </h3>
      {fields.length === 0 ? (
        <p className="text-xs text-slate-400">{emptyHint}</p>
      ) : (
        <div className="space-y-3">
          {[...byDataset.entries()].map(([datasetName, list]) => (
            <div key={datasetName}>
              <div className="mb-1 text-xs font-medium text-slate-600">{datasetName}</div>
              <ul className="space-y-0.5">
                {list.map((field) => (
                  <li key={field.id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-slate-50">
                      <input
                        type="checkbox"
                        checked={selected.has(field.id)}
                        onChange={() => onToggle(field.id)}
                        className="rounded border-slate-300"
                      />
                      <span className="text-slate-700">{field.label}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default function ExplorerTab(): React.ReactElement {
  const model = useOutletContext<DataModelDetailDto>();

  const status = useExplorerStatus(model.id);
  const fields = useExplorerFields(model.id);
  const run = useRunQuery(model.id);

  const [dimensions, setDimensions] = useState<Set<number>>(new Set());
  const [measures, setMeasures] = useState<Set<number>>(new Set());
  const [queryError, setQueryError] = useState<string | null>(null);

  function toggle(setter: typeof setDimensions, id: number): void {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Cube chưa chạy — nói đúng lệnh phải gõ, và nói cả những gì vẫn dùng được.
  // Cùng tiền lệ `pingClickhouse` của §9, vốn tồn tại vì bài học MinIO: khi một
  // service phía sau tắt, thứ người dùng thấy là "Có lỗi không xác định" — một
  // câu không dẫn tới bất kỳ hành động nào.
  if (status.data !== undefined && !status.data.cubeReady) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4" role="alert">
        <h2 className="text-sm font-semibold text-amber-900">
          Chưa kết nối được tới tầng ngữ nghĩa (Cube.js)
        </h2>
        <p className="mt-1.5 text-sm text-amber-900">
          Chạy lệnh sau ở thư mục gốc rồi bấm Thử lại:
        </p>
        <code className="mt-2 block rounded-lg bg-amber-100 px-3 py-2 font-mono text-sm text-amber-900">
          {status.data.command}
        </code>
        <p className="mt-2.5 text-sm text-amber-800">
          Ba tab <strong>Schemas</strong>, <strong>Relationship</strong> và{' '}
          <strong>Measures</strong> vẫn dùng được bình thường — chúng không cần Cube.
        </p>
        <div className="mt-3">
          <Button onClick={() => void status.refetch()} loading={status.isFetching}>
            Thử lại
          </Button>
        </div>
      </div>
    );
  }

  if (fields.isError) return <ErrorState message={getApiError(fields.error).message} />;
  if (fields.isPending) return <TableSkeleton rows={6} />;

  const canRun = dimensions.size + measures.size > 0;
  const result = run.data;

  return (
    <div className="flex h-full min-h-0 gap-5">
      <aside className="w-64 shrink-0 space-y-5 overflow-y-auto border-r border-slate-200 pr-4">
        <FieldGroup
          title="Chiều"
          fields={fields.data?.dimensions ?? []}
          selected={dimensions}
          onToggle={(id) => toggle(setDimensions, id)}
          emptyHint="Không có chiều nào. Kiểm vai trò cột ở tab Schemas."
        />
        <FieldGroup
          title="Thước đo"
          fields={fields.data?.measures ?? []}
          selected={measures}
          onToggle={(id) => toggle(setMeasures, id)}
          emptyHint="Chưa có thước đo nào. Thêm ở tab Measures."
        />
      </aside>

      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex items-center gap-3">
          <Button
            variant="primary"
            disabled={!canRun}
            loading={run.isPending}
            onClick={() => {
              setQueryError(null);
              run.mutate(
                {
                  dimensionIds: [...dimensions],
                  measureIds: [...measures],
                },
                { onError: (err) => setQueryError(getApiError(err).message) },
              );
            }}
          >
            Chạy truy vấn
          </Button>
          <span className="text-sm text-slate-500">
            {dimensions.size} chiều · {measures.size} thước đo
          </span>
        </div>

        {queryError !== null && <ErrorState message={queryError} />}

        {result === undefined && queryError === null && (
          <EmptyState
            title="Chọn chiều và thước đo rồi bấm Chạy"
            hint="Truy vấn chạy trên ClickHouse qua Cube.js — Cube tự sinh câu SQL và tự nối các bảng theo quan hệ bạn đã khai."
          />
        )}

        {result !== undefined && (
          <div className="min-h-0 flex-1 overflow-auto">
            {result.truncated && (
              <div className="mb-2">
                {/* Chạm trần nghĩa là RẤT CÓ THỂ còn dữ liệu. Nói ra chứ không
                    để người dùng tin rằng họ đang nhìn toàn bộ. */}
                <Badge tone="warning">đã cắt bớt — còn dữ liệu chưa lấy hết</Badge>
              </div>
            )}
            <TableWrap>
              <THead>
                <Tr>
                  {result.columns.map((column) => (
                    <Th key={`${column.kind}-${column.id}`} align={column.kind === 'measure' ? 'right' : 'left'}>
                      {column.label}
                    </Th>
                  ))}
                </Tr>
              </THead>
              <TBody>
                {result.rows.map((row, rowIndex) => (
                  // Chỉ số làm khoá: kết quả tổng hợp không có định danh tự
                  // nhiên nào, và bảng được vẽ lại toàn bộ mỗi lần chạy.
                  <Tr key={rowIndex}>
                    {row.map((cell, cellIndex) => (
                      <Td
                        key={cellIndex}
                        align={result.columns[cellIndex]?.kind === 'measure' ? 'right' : 'left'}
                      >
                        {cell === null ? (
                          <span className="text-slate-400">—</span>
                        ) : typeof cell === 'number' ? (
                          <span className="tabular-nums">{cell.toLocaleString('vi-VN')}</span>
                        ) : (
                          cell
                        )}
                      </Td>
                    ))}
                  </Tr>
                ))}
              </TBody>
            </TableWrap>
            {result.rows.length === 0 && (
              <p className="mt-3 text-sm text-slate-500">
                Truy vấn chạy được nhưng không có dòng nào khớp.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
