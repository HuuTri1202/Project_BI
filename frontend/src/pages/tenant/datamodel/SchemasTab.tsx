import {
  COLUMN_ROLE_LABELS,
  COLUMN_ROLES,
  MEASURE_AGG_LABELS,
  MEASURE_AGGS_BY_CUBE_TYPE,
  type ColumnRole,
  type DataModelDatasetDto,
  type DataModelDetailDto,
  type MeasureAgg,
  type PrimaryKeyWarningDto,
} from '@bi/shared';
import { useEffect, useMemo, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';

import { usePermissions } from '../../../auth/usePermissions';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog';
import { Modal } from '../../../components/ui/Modal';
import { ROW_MENU_ICONS, RowMenu, RowMenuItem } from '../../../components/ui/RowMenu';
import { SearchSelect } from '../../../components/ui/SearchSelect';
import { TBody, Td, Th, THead, TableWrap, Tr } from '../../../components/ui/Table';
import { EmptyState, ErrorState, TableSkeleton } from '../../../components/ui/states';
import { AddDatasetsModal } from '../../../features/datamodels/AddDatasetsModal';
import { FormulaMeasuresModal } from '../../../features/datamodels/FormulaMeasuresModal';
import {
  useMeasures,
  useModelSchema,
  useRemoveDataset,
  useSaveSchema,
  useUpdateModelDataset,
} from '../../../features/datamodels/hooks';
import { getApiError } from '../../../services/apiClient';

/**
 * Tab Schemas — §10.3. Danh sách bảng, bấm vào một bảng thì xem cấu trúc cột.
 *
 * ─── Hai màn, không phải hai route ──────────────────────────────────────────
 *
 * Danh sách và chi tiết đổi nhau bằng state chứ không bằng đường dẫn. Lý do:
 * `useModelSchema` đọc lại ClickHouse cho MỌI bảng trong một lần gọi, nên hai
 * màn dùng chung đúng một kết quả. Tách thành hai route nghĩa là vào chi tiết
 * lại gọi sang kho lần nữa để lấy đúng dữ liệu đang có sẵn trong tay.
 *
 * ─── Khoá chính ở đây KHÔNG phải khoá chính của Cube ────────────────────────
 *
 * Cube nhận `_row_index` (§9) làm `primary_key` vì nó chắc chắn duy nhất. Cột
 * khai ở màn này là khoá theo NGHĨA NGHIỆP VỤ — nó trả lời "muốn nối tới bảng
 * này thì nối vào cột nào", và tab Quan hệ dùng nó để điền sẵn form.
 *
 * Tách hai vai là có chủ đích: người dùng có thể chọn nhầm một cột có giá trị
 * trùng, và nếu cột đó đi thẳng vào `primary_key` của Cube thì mọi phép tổng sau
 * JOIN sẽ sai mà không có lỗi nào. Backend đối chiếu với dữ liệu thật trong kho
 * rồi CẢNH BÁO — xem `primaryKeyCheck.ts`.
 */

interface Draft {
  alias: string;
  /**
   * Mô tả cột — §8.3.1. Chuỗi rỗng = chưa viết gì, backend quy về `null`.
   *
   * Đi chung bản nháp với `alias` và `role` vì cùng một lý do đã ghi cho `agg`
   * ngay dưới: người dùng sửa cả bốn thứ rồi bấm một nút Lưu.
   */
  description: string;
  role: ColumnRole;
  /**
   * Phép gộp của thước đo dựng trên cột này. `null` = không có thước đo nào.
   *
   * Bản nháp giữ nó cùng chỗ với `alias` và `role` để cả ba đi chung một nút
   * Lưu. Tách ra một nút riêng nghĩa là người dùng đổi ba thứ rồi bấm một nút
   * và chỉ hai thứ được lưu.
   */
  agg: MeasureAgg | null;
}

export default function SchemasTab(): React.ReactElement {
  const model = useOutletContext<DataModelDetailDto>();
  const permissions = usePermissions();
  const canEdit = permissions.can('datamodel', 'modify');

  const { data, isPending, isError, error } = useModelSchema(model.id);
  const save = useSaveSchema(model.id);
  const removeDataset = useRemoveDataset(model.id);
  const updateDataset = useUpdateModelDataset(model.id);

  const measures = useMeasures(model.id);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [showFormulas, setShowFormulas] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** `null` = đang ở danh sách. Khác `undefined` để không lẫn với "chưa nạp". */
  const [openedId, setOpenedId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<DataModelDatasetDto | null>(null);
  const [editing, setEditing] = useState<DataModelDatasetDto | null>(null);
  const [pickingKey, setPickingKey] = useState<DataModelDatasetDto | null>(null);
  const [keyWarning, setKeyWarning] = useState<{ name: string; w: PrimaryKeyWarningDto } | null>(
    null,
  );

  // Nạp lại bản nháp mỗi khi dữ liệu server đổi. Không có bước này thì sau khi
  // lưu xong, ô nhập vẫn giữ giá trị cũ của lần chỉnh trước.
  useEffect(() => {
    if (data === undefined || measures.data === undefined) return;

    // Thước đo dựng-trên-cột tra ngược theo `columnId`. Thước đo TÍNH TOÁN
    // không có cột nào nên nó không lọt vào bảng tra này — đúng ý, vì nó được
    // quản ở hộp thoại riêng chứ không phải ở dòng cột.
    const aggByColumn = new Map<number, MeasureAgg>();
    for (const m of measures.data) {
      if (m.kind === 'column' && m.columnId !== null) aggByColumn.set(m.columnId, m.agg);
    }

    const next: Record<number, Draft> = {};
    for (const ds of data.datasets) {
      for (const column of ds.columns) {
        next[column.id] = {
          alias: column.alias ?? '',
          description: column.description ?? '',
          role: column.role,
          agg: aggByColumn.get(column.id) ?? null,
        };
      }
    }
    setDrafts(next);
  }, [data, measures.data]);

  const datasets = useMemo(() => data?.datasets ?? [], [data]);

  /** Bảng đang mở — TÍNH RA, để nó tự biến mất khi bảng bị gỡ khỏi mô hình. */
  const opened = datasets.find((d) => d.id === openedId) ?? null;

  /** Phép gộp ĐANG LƯU của từng cột — mốc để biết bản nháp có đổi gì không. */
  const savedAgg = useMemo(() => {
    const out = new Map<number, MeasureAgg | null>();
    for (const m of measures.data ?? []) {
      if (m.kind === 'column' && m.columnId !== null) out.set(m.columnId, m.agg);
    }
    return out;
  }, [measures.data]);

  const dirtyDatasets = useMemo(() => {
    const out = new Set<number>();
    for (const ds of datasets) {
      for (const column of ds.columns) {
        const draft = drafts[column.id];
        if (draft === undefined) continue;
        if (
          draft.alias !== (column.alias ?? '') ||
          draft.description !== (column.description ?? '') ||
          draft.role !== column.role ||
          draft.agg !== (savedAgg.get(column.id) ?? null)
        ) {
          out.add(ds.id);
          break;
        }
      }
    }
    return out;
  }, [datasets, drafts, savedAgg]);

  const dirty = dirtyDatasets.size > 0;

  const formulaCount = (measures.data ?? []).filter((m) => m.kind === 'formula').length;

  const changedTypes = useMemo(
    () => datasets.flatMap((ds) => ds.columns.filter((c) => c.typeChanged)),
    [datasets],
  );

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
        const draft = drafts[column.id] ?? {
          alias: column.alias ?? '',
          description: column.description ?? '',
          role: column.role,
          agg: savedAgg.get(column.id) ?? null,
        };
        return {
          columnId: column.id,
          alias: draft.alias.trim() === '' ? null : draft.alias.trim(),
          description: draft.description.trim() === '' ? null : draft.description.trim(),
          role: draft.role,
          measureAgg: draft.agg,
        };
      }),
    );

    save.mutate({ columns }, { onError: (err) => setSaveError(getApiError(err).message) });
  }

  if (isError) return <ErrorState message={getApiError(error).message} />;
  if (isPending || data === undefined) return <TableSkeleton rows={8} />;

  const modals = (
    <>
      <AddDatasetsModal
        open={adding}
        onClose={() => setAdding(false)}
        modelId={model.id}
        existing={datasets}
      />

      <EditSchemaModal
        schema={editing}
        onClose={() => setEditing(null)}
        loading={updateDataset.isPending}
        onSave={(input, onError) => {
          if (editing === null) return;
          updateDataset.mutate(
            { refId: editing.id, input },
            { onSuccess: () => setEditing(null), onError },
          );
        }}
      />

      <PrimaryKeyModal
        schema={pickingKey}
        onClose={() => setPickingKey(null)}
        loading={updateDataset.isPending}
        onSave={(primaryColumnId, onError) => {
          if (pickingKey === null) return;
          const name = pickingKey.displayName ?? pickingKey.datasetName;
          updateDataset.mutate(
            { refId: pickingKey.id, input: { primaryColumnId } },
            {
              onSuccess: (result) => {
                setPickingKey(null);
                // Cảnh báo hiện SAU khi lưu, không chặn: bảng cầu nối và bảng
                // lịch sử là những ca hợp lệ mà khoá vẫn trùng. Nhưng phải nói
                // ra, vì tổng bị nhân lên là một con số sai trông rất hợp lý.
                //
                // Khoá TRỐNG cũng phải báo, không chỉ khoá trùng: dòng mang khoá
                // trống rơi khỏi kết quả khi nối, và tổng nhỏ hơn sự thật cũng
                // sai y như tổng lớn hơn. Tab Quan hệ đã báo cả hai từ trước.
                const w = result.warning;
                if (w !== null && (w.duplicateValues || w.nullValues > 0)) {
                  setKeyWarning({ name, w });
                }
              },
              onError,
            },
          );
        }}
      />

      <FormulaMeasuresModal
        open={showFormulas}
        onClose={() => setShowFormulas(false)}
        modelId={model.id}
        canEdit={canEdit}
        measures={measures.data ?? []}
      />

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title="Bỏ bảng khỏi mô hình"
        description={removing === null ? undefined : (removing.displayName ?? removing.datasetName)}
        confirmLabel="Bỏ khỏi mô hình"
        danger
        loading={removeDataset.isPending}
        onConfirm={(onError) => {
          if (removing === null) return;
          removeDataset.mutate(removing.id, {
            onSuccess: () => {
              setRemoving(null);
              setOpenedId(null);
            },
            onError,
          });
        }}
      >
        Mọi thước đo và quan hệ khai trên bảng này cũng bị bỏ theo.{' '}
        <strong>Bảng trong kho phân tích không bị đụng tới</strong> — chỉ mô hình thôi nhắc tới nó.
      </ConfirmDialog>
    </>
  );

  // ─── Màn chi tiết: cấu trúc cột của MỘT bảng ──────────────────────────────
  if (opened !== null) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => setOpenedId(null)}>
              ← Danh sách
            </Button>
            <h2 className="truncate text-sm font-semibold text-slate-900">
              {opened.displayName ?? opened.datasetName}
            </h2>
            <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
              {opened.chTable}
            </code>
          </div>
          <div className="flex items-center gap-2">
            {dirty && (
              <span className="text-xs font-medium text-amber-700">
                {dirtyDatasets.size} bảng có thay đổi chưa lưu
              </span>
            )}
            {canEdit && (
              <Button variant="primary" onClick={onSave} loading={save.isPending} disabled={!dirty}>
                Lưu thay đổi
              </Button>
            )}
          </div>
        </div>

        {saveError !== null && <ErrorState message={saveError} />}

        <TableWrap fill>
          <THead>
            <Tr>
              <Th>Cột trong kho</Th>
              <Th>Kiểu ClickHouse</Th>
              <Th>Tên hiển thị</Th>
              {/*
               * Mô tả — §8.3.1.
               *
               * Đặt NGAY SAU tên hiển thị chứ không đẩy xuống cuối bảng: hai ô
               * này trả lời cùng một câu hỏi ("cột này là gì"), chỉ khác độ
               * dài, nên người dùng gõ xong ô trái là gõ tiếp ô phải. Đẩy nó ra
               * sau hai ô chọn nghĩa là phải nhảy qua hai thứ không liên quan.
               */}
              <Th>Mô tả</Th>
              <Th>Vai trò (Role)</Th>
              {/*
               * "Phép gộp", KHÔNG phải "Thước đo" như trước.
               *
               * Cột bên trái nhận giá trị "Thước đo (Measure)", nên đặt cùng
               * một từ lên tiêu đề cột bên phải là bày ra hai thứ khác nhau
               * dưới một cái tên, cạnh nhau, trên cùng một hàng. Ô select ở đây
               * chọn PHÉP GỘP — và `aria-label` của chính nó vẫn luôn đọc là
               * "Phép gộp của cột …", tức là hai nhãn đang nói hai đằng.
               */}
              <Th>Phép gộp (Aggregation)</Th>
            </Tr>
          </THead>
          <TBody>
            {opened.columns.map((column) => {
              const draft = drafts[column.id] ?? {
                alias: column.alias ?? '',
                description: column.description ?? '',
                role: column.role,
                agg: savedAgg.get(column.id) ?? null,
              };
              const isKey = opened.primaryColumnId === column.id;
              /*
               * Phép gộp nào bấm được, tuỳ KIỂU của cột.
               *
               * Bản trước chỉ cột số mới có ô chọn, cột chữ và cột ngày để
               * trống hẳn. Điều đó khoá mất hai câu hỏi rất hay gặp mà backend
               * vốn trả lời được: "bao nhiêu khách hàng khác nhau"
               * (`countDistinct` trên cột chữ) và "đơn đầu tiên / gần nhất"
               * (`min`/`max` trên cột ngày).
               *
               * Danh sách lấy từ @bi/shared để giao diện và tầng dịch vụ không
               * bao giờ nói hai điều khác nhau — backend chặn lại bằng đúng
               * bảng đó, nên một lựa chọn hiện ra ở đây mà bị 400 khi lưu là
               * chuyện không xảy ra được.
               */
              const aggs = MEASURE_AGGS_BY_CUBE_TYPE[column.cubeType];
              return (
                <Tr key={column.id}>
                  <Td>
                    <code className="text-xs text-slate-700">{column.columnName}</code>
                    {isKey && (
                      <span className="ml-2">
                        <Badge tone="brand">khoá chính</Badge>
                      </span>
                    )}
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
                    {/*
                     * Một dòng `<input>` chứ không phải `<textarea>`: mỗi cột
                     * là MỘT dòng của bảng, và một ô cao ba dòng nhân với 20
                     * cột biến màn hình thành thứ phải cuộn mãi mới hết. Trần
                     * 500 ký tự khớp với cột trong database, nên không có
                     * đường nào gõ được một câu rồi bị 400 lúc bấm Lưu.
                     */}
                    <input
                      type="text"
                      value={draft.description}
                      disabled={!canEdit}
                      maxLength={500}
                      placeholder="Cột này nghĩa là gì?"
                      aria-label={`Mô tả của cột ${column.columnName}`}
                      onChange={(e) => update(column.id, { description: e.target.value })}
                      className="w-full min-w-48 rounded-lg border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-50 disabled:text-slate-500"
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
                  <Td>
                    {aggs.length > 0 ? (
                      <select
                        value={draft.agg ?? ''}
                        disabled={!canEdit}
                        aria-label={`Phép gộp của cột ${column.columnName}`}
                        onChange={(e) =>
                          update(column.id, {
                            agg: e.target.value === '' ? null : (e.target.value as MeasureAgg),
                          })
                        }
                        className="rounded-lg border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-50 disabled:text-slate-500"
                      >
                        <option value="">— Không —</option>
                        {aggs.map((agg) => (
                          <option key={agg} value={agg}>
                            {MEASURE_AGG_LABELS[agg]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </Td>
                </Tr>
              );
            })}
          </TBody>
        </TableWrap>

        {modals}
      </div>
    );
  }

  // ─── Màn danh sách ────────────────────────────────────────────────────────
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">
          Mỗi bảng cần một <strong>khoá chính</strong> để các bảng khác nối tới được ở tab Quan hệ.
        </p>
        <div className="flex items-center gap-2">
          {dirty && (
            <span className="text-xs font-medium text-amber-700">
              {dirtyDatasets.size} bảng có thay đổi chưa lưu
            </span>
          )}
          {canEdit && dirty && (
            <Button variant="primary" onClick={onSave} loading={save.isPending}>
              Lưu thay đổi
            </Button>
          )}
          <Button onClick={() => setShowFormulas(true)}>
            Thước đo tính toán{formulaCount > 0 ? ` (${formulaCount})` : ''}
          </Button>
          {canEdit && <Button onClick={() => setAdding(true)}>+ Thêm bảng</Button>}
        </div>
      </div>

      {saveError !== null && <ErrorState message={saveError} />}

      {changedTypes.length > 0 && (
        <div
          role="alert"
          className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900"
        >
          <strong>{changedTypes.length} cột đã đổi kiểu trong kho</strong> kể từ lần dựng mô hình.
          Hãy kiểm lại vai trò của chúng — một thước đo dựng trên cột vừa chuyển thành chữ sẽ
          không cộng được nữa.
        </div>
      )}

      {keyWarning !== null && <KeyWarning {...keyWarning} onDismiss={() => setKeyWarning(null)} />}

      {datasets.length === 0 ? (
        <EmptyState
          title="Mô hình chưa có bảng nào"
          hint="Thêm một bộ dữ liệu đã nạp vào kho phân tích để bắt đầu."
          action={
            canEdit ? (
              <Button variant="primary" onClick={() => setAdding(true)}>
                + Thêm bảng
              </Button>
            ) : undefined
          }
        />
      ) : (
        <TableWrap grow>
          <THead>
            <Tr>
              <Th>Tên</Th>
              <Th>Bảng vật lý</Th>
              <Th>Mô tả</Th>
              <Th>Khoá chính</Th>
              <Th align="right">Cột</Th>
              <Th align="right">Thao tác</Th>
            </Tr>
          </THead>
          <TBody>
            {datasets.map((ds) => {
              const dimensions = ds.columns.filter((c) => c.role === 'dimension').length;
              const measures = ds.columns.filter((c) => c.role === 'measure').length;
              return (
                <Tr key={ds.id}>
                  <Td>
                    {/* Bấm vào TÊN để mở cấu trúc — thói quen từ mọi bảng dữ
                        liệu khác trong sản phẩm. */}
                    <button
                      type="button"
                      onClick={() => setOpenedId(ds.id)}
                      className="text-left font-medium text-brand-700 hover:underline"
                    >
                      {ds.displayName ?? ds.datasetName}
                    </button>
                    {dirtyDatasets.has(ds.id) && (
                      <span className="ml-2">
                        <Badge tone="warning">chưa lưu</Badge>
                      </span>
                    )}
                  </Td>
                  <Td>
                    <code className="text-xs text-slate-500">{ds.chTable}</code>
                  </Td>
                  <Td>
                    {ds.description ?? <span className="text-slate-400">—</span>}
                  </Td>
                  <Td>
                    {ds.primaryColumnName === null ? (
                      // Chưa đặt khoá chính là thứ CHẶN người dùng ở tab Quan
                      // hệ, nên nó phải nổi bật chứ không phải một dấu gạch.
                      <Badge tone="warning">chưa đặt</Badge>
                    ) : (
                      <code className="text-xs text-slate-700">{ds.primaryColumnName}</code>
                    )}
                  </Td>
                  <Td align="right">
                    <span className="text-xs text-slate-500">
                      {ds.columns.length} · {dimensions} chiều · {measures} thước đo
                    </span>
                  </Td>
                  <Td align="right">
                    <RowMenu>
                      {(close) => (
                        <>
                          {canEdit && (
                            <RowMenuItem
                              icon={ROW_MENU_ICONS.key}
                              onClick={() => {
                                close();
                                setPickingKey(ds);
                              }}
                            >
                              Đặt khoá chính
                            </RowMenuItem>
                          )}
                          {canEdit && (
                            <RowMenuItem
                              icon={ROW_MENU_ICONS.edit}
                              onClick={() => {
                                close();
                                setEditing(ds);
                              }}
                            >
                              Sửa tên và mô tả
                            </RowMenuItem>
                          )}
                          <RowMenuItem
                            icon={ROW_MENU_ICONS.open}
                            onClick={() => {
                              close();
                              setOpenedId(ds.id);
                            }}
                          >
                            Xem cấu trúc cột
                          </RowMenuItem>
                          <RowMenuItem icon={ROW_MENU_ICONS.open} onClick={close}>
                            <Link to={`/datasets/${ds.datasetId}`} className="block w-full">
                              Mở bộ dữ liệu gốc
                            </Link>
                          </RowMenuItem>
                          {canEdit && (
                            <RowMenuItem
                              icon={ROW_MENU_ICONS.trash}
                              danger
                              onClick={() => {
                                close();
                                setRemoving(ds);
                              }}
                            >
                              Bỏ khỏi mô hình
                            </RowMenuItem>
                          )}
                        </>
                      )}
                    </RowMenu>
                  </Td>
                </Tr>
              );
            })}
          </TBody>
        </TableWrap>
      )}

      {modals}
    </div>
  );
}

/**
 * Kết quả đối chiếu cột khoá với dữ liệu thật trong kho.
 *
 * ─── Vì sao phải đưa SỐ DÒNG DÔI RA, không chỉ "có trùng" ───────────────────
 *
 * Bản đầu chỉ nói "có giá trị trùng nhau" kèm tổng số dòng của bảng. Câu đó
 * đúng nhưng đọc lên như thể cả bảng đều trùng, và hai tình huống khác hẳn nhau
 * lại hiện ra y hệt:
 *
 *   - `Returns`: 1.172 giá trị / 1.173 dòng → dôi ĐÚNG MỘT dòng. Dữ liệu nguồn
 *     có một lỗi nhỏ, sửa được, và cột này gần như vẫn là khoá.
 *   - `Orders`: 25.035 giá trị / 51.290 dòng → dôi 26.255 dòng. Đây là bảng dòng
 *     hàng, `Order ID` vốn dĩ KHÔNG phải khoá, phải chọn cột khác.
 *
 * Người dùng phải làm hai việc hoàn toàn khác nhau, nên cảnh báo phải nói được
 * hai chuyện khác nhau. Đưa ra con số là cách rẻ nhất và không bao giờ sai.
 */
function KeyWarning({
  name,
  w,
  onDismiss,
}: {
  name: string;
  w: PrimaryKeyWarningDto;
  onDismiss: () => void;
}): React.ReactElement {
  const vn = (n: number): string => n.toLocaleString('vi-VN');
  // Số dòng "dôi ra": bao nhiêu dòng mang một giá trị đã xuất hiện ở dòng khác.
  // Trừ cả `nullValues` vì `uniqExact` không đếm ô trống.
  const extra = w.rowCount - w.nullValues - w.distinctValues;

  return (
    <div
      role="alert"
      className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
    >
      <strong>
        Đã lưu, nhưng {w.duplicateValues ? 'cột này chưa chắc là khoá.' : 'cột này có ô trống.'}
      </strong>

      {w.duplicateValues && (
        <p className="mt-1">
          Cột <code className="rounded bg-amber-100 px-1">{w.columnName}</code> của{' '}
          <strong>{name}</strong> có <strong>{vn(w.distinctValues)} giá trị khác nhau</strong> trên{' '}
          {vn(w.rowCount)} dòng — tức <strong>{vn(extra)} dòng</strong> mang giá trị đã có ở dòng
          khác. Nối vào cột này sẽ nhân bản dòng bên kia, và mọi phép tổng sau đó lớn hơn sự thật.
        </p>
      )}

      {w.nullValues > 0 && (
        <p className="mt-1">
          Có <strong>{vn(w.nullValues)} dòng</strong> mang khoá trống. Chúng bị loại khỏi kết quả
          khi nối, nên tổng sẽ nhỏ hơn thực tế.
        </p>
      )}

      <div className="mt-2">
        <Button size="sm" onClick={onDismiss}>
          Đã hiểu
        </Button>
      </div>
    </div>
  );
}

/** Sửa tên hiển thị và mô tả của một bảng trong mô hình. */
function EditSchemaModal({
  schema,
  onClose,
  loading,
  onSave,
}: {
  schema: DataModelDatasetDto | null;
  onClose: () => void;
  loading: boolean;
  onSave: (
    input: { displayName: string | null; description: string | null },
    onError: (err: unknown) => void,
  ) => void;
}): React.ReactElement {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Nạp giá trị hiện tại mỗi lần mở cho một bảng khác. Thiếu bước này thì hộp
  // thoại giữ nội dung của bảng mở lần trước.
  useEffect(() => {
    if (schema === null) return;
    setName(schema.displayName ?? '');
    setDescription(schema.description ?? '');
    setError(null);
  }, [schema]);

  return (
    <Modal
      open={schema !== null}
      onClose={onClose}
      title="Sửa bảng"
      description={schema?.datasetName}
      footer={
        <>
          <Button onClick={onClose}>Huỷ</Button>
          <Button
            variant="primary"
            loading={loading}
            onClick={() =>
              onSave(
                { displayName: name.trim() || null, description: description.trim() || null },
                (err) => setError(getApiError(err).message),
              )
            }
          >
            Lưu
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error !== null && <ErrorState message={error} />}

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Tên hiển thị</span>
          <input
            type="text"
            value={name}
            autoFocus
            placeholder={schema?.datasetName}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <span className="mt-1 block text-xs text-slate-500">
            Chỉ đổi tên trong mô hình này. Tên ở Kho dữ liệu giữ nguyên.
          </span>
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Mô tả</span>
          <textarea
            value={description}
            rows={3}
            placeholder="Bảng này chứa gì, ai dùng nó để làm gì…"
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
      </div>
    </Modal>
  );
}

/** Chọn cột làm khoá chính nghiệp vụ của một bảng. */
function PrimaryKeyModal({
  schema,
  onClose,
  loading,
  onSave,
}: {
  schema: DataModelDatasetDto | null;
  onClose: () => void;
  loading: boolean;
  onSave: (primaryColumnId: number | null, onError: (err: unknown) => void) => void;
}): React.ReactElement {
  const [columnId, setColumnId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (schema === null) return;
    setColumnId(schema.primaryColumnId);
    setError(null);
  }, [schema]);

  return (
    <Modal
      open={schema !== null}
      onClose={onClose}
      title="Đặt khoá chính"
      description={schema === null ? undefined : (schema.displayName ?? schema.datasetName)}
      footer={
        <>
          <Button onClick={onClose}>Huỷ</Button>
          <Button
            variant="primary"
            loading={loading}
            onClick={() => onSave(columnId, (err) => setError(getApiError(err).message))}
          >
            Lưu
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error !== null && <ErrorState message={error} />}

        <SearchSelect
          label="Cột khoá chính"
          value={columnId}
          onChange={setColumnId}
          emptyLabel="— Chưa đặt —"
          noun="cột"
          options={(schema?.columns ?? [])
            .filter((c) => c.role !== 'hidden')
            // Kèm kiểu ClickHouse: khoá chính gần như luôn là cột số hoặc chuỗi
            // ID, nên kiểu là gợi ý mạnh nhất — và nó lọc được bằng ô tìm kiếm.
            .map((c) => ({ value: c.id, label: c.alias ?? c.columnName, hint: c.chType }))}
        />

        {/* Giải thích NGHĨA chứ không chỉ đưa một ô chọn: chọn sai thì kết quả
            vẫn ra, chỉ là sai — đúng loại lỗi khó phát hiện nhất. */}
        <p className="text-xs text-slate-500">
          Khoá chính là cột mà <strong>mỗi giá trị ứng với đúng một dòng</strong>. Tab Quan hệ dùng
          nó để điền sẵn cột nối. Sau khi lưu, hệ thống đối chiếu với dữ liệu thật trong kho và báo
          nếu cột có giá trị trùng.
        </p>
      </div>
    </Modal>
  );
}
