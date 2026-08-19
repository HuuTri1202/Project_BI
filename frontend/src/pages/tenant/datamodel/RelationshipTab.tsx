import {
  RELATIONSHIP_KIND_LABELS,
  RELATIONSHIP_KINDS,
  type DataModelDatasetDto,
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
import { SearchSelect, type SearchSelectOption } from '../../../components/ui/SearchSelect';
import { TBody, Td, Th, THead, TableWrap, Tr } from '../../../components/ui/Table';
import { EmptyState, ErrorState } from '../../../components/ui/states';
import {
  RelationshipCanvas,
  type ConnectEnd,
} from '../../../features/datamodels/relationship/RelationshipCanvas';
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
 * ─── HAI đường tạo quan hệ, không phải một ─────────────────────────────────
 *
 * 1. **Kéo** từ một cột sang cột của bảng khác — nhanh, và là thứ ai nhìn sơ đồ
 *    cũng thử làm đầu tiên.
 * 2. Nút **+ Thêm quan hệ** — bốn ô chọn, dùng được bằng bàn phím.
 *
 * Đường thứ hai KHÔNG phải phần thừa: kéo-thả là cử chỉ chuột thuần tuý, và bỏ
 * nó đi là khoá người dùng bàn phím lẫn trình đọc màn hình khỏi thao tác duy
 * nhất làm nên giá trị của tab này. Cùng nguyên tắc với bảng liệt kê bên dưới.
 *
 * Cả hai đường đều đổ vào CÙNG một form. Kéo chỉ điền sẵn bốn ô rồi để người
 * dùng xác nhận kiểu quan hệ — thứ mà một cử chỉ kéo không nói được, và chọn sai
 * thì con số vẫn ra nhưng sai.
 */

/**
 * Cột chọn được để nối, kèm kiểu ClickHouse và dấu khoá chính.
 *
 * Kiểu không phải chi tiết trang trí: nối một cột `String` với một cột `Int64`
 * là lỗi hay gặp nhất, và nó không báo lỗi — chỉ ra không dòng nào khớp. Thấy
 * hai kiểu cạnh nhau là thấy ngay.
 */
function columnOptions(dataset: DataModelDatasetDto | undefined): SearchSelectOption[] {
  if (dataset === undefined) return [];
  return dataset.columns
    .filter((c) => c.role !== 'hidden')
    .map((c) => ({
      value: c.id,
      label: c.alias ?? c.columnName,
      hint: dataset.primaryColumnId === c.id ? `khoá chính · ${c.chType}` : c.chType,
    }));
}

interface FormState {
  leftId: number;
  leftColumnId: number | null;
  rightId: number;
  rightColumnId: number | null;
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
    label: ds.displayName ?? ds.datasetName,
    columns: ds.columns.map((c) => ({
      id: c.id,
      name: c.alias ?? c.columnName,
      role: c.role,
      // Khoá chính luôn hiện kể cả khi thẻ thu gọn: nó là cột mà bảng khác sẽ
      // nối tới, nên giấu nó đi là giấu đúng thứ người ta đang đi tìm.
      isPrimary: ds.primaryColumnId === c.id,
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
      leftColumnId: null,
      rightId: second.id,
      // Điền sẵn KHOÁ CHÍNH của bảng đích.
      //
      // `many_to_one` là kiểu mặc định, và ở kiểu đó phía "một" — tức bảng đích
      // — phải được nối vào cột khoá của nó, nếu không mọi phép tổng sẽ bị nhân
      // lên. Đó chính là điều người dùng khai ở tab Schemas, nên bắt họ chọn lại
      // ở đây là hỏi hai lần cùng một câu và mở đường cho một câu trả lời khác.
      rightColumnId: second.primaryColumnId,
      kind: 'many_to_one',
    });
  }

  /**
   * Kéo từ một cột sang cột của bảng khác — §10.4.
   *
   * Mở form ĐÃ ĐIỀN SẴN thay vì lưu thẳng. Cử chỉ kéo nói được "nối cột nào với
   * cột nào" nhưng KHÔNG nói được kiểu quan hệ, mà chọn sai kiểu thì kết quả vẫn
   * ra — chỉ là sai. Ở đây người dùng còn đúng một ô để xác nhận, thay vì bốn ô
   * phải tự điền như khi bấm nút.
   */
  function onConnect(left: ConnectEnd, right: ConnectEnd): void {
    setFormError(null);
    setWarning(null);
    setForm({
      leftId: left.nodeId,
      leftColumnId: left.columnId,
      rightId: right.nodeId,
      rightColumnId: right.columnId,
      kind: 'many_to_one',
    });
  }

  function submit(): void {
    if (form === null) return;
    setFormError(null);

    if (form.leftColumnId === null || form.rightColumnId === null) {
      setFormError('Hãy chọn cột khoá ở cả hai bảng.');
      return;
    }

    create.mutate(
      {
        leftId: form.leftId,
        leftColumnId: form.leftColumnId,
        rightId: form.rightId,
        rightColumnId: form.rightColumnId,
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
    /*
     * `overflow-y-auto` ở ngoài cùng — và đó là điều kiện để `min-h` bên dưới có
     * nghĩa. Trước đây sơ đồ là `flex-1` thuần, nên nó là thứ DUY NHẤT co lại
     * khi danh sách quan hệ dài ra: thêm vài quan hệ là sơ đồ bị bóp xuống còn
     * vài trăm pixel, và thẻ cao nhất kéo tỉ lệ của cả sơ đồ xuống theo.
     *
     * Giờ sơ đồ có sàn, danh sách có trần, và phần dư thì trang cuộn.
     */
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-3xl text-sm text-slate-500">
          <strong>Kéo từ một cột sang cột của bảng khác</strong> để tạo quan hệ. Kéo phần tiêu đề
          thẻ để sắp lại sơ đồ (vị trí tự lưu), kéo nền để dời khung, Ctrl + lăn chuột để thu phóng.
        </p>
        <div className="flex shrink-0 gap-2">
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
        // `overflow-hidden` chứ không `auto`: từ khi canvas tự thu phóng và dời
        // khung, một thanh cuộn của trình duyệt chồng lên đó chỉ tạo ra hai cách
        // làm cùng một việc, và chúng đá nhau khi kéo bằng chuột.
        <div className="min-h-[28rem] flex-1 overflow-hidden rounded-xl border border-slate-200 bg-slate-50/60 p-2">
          <RelationshipCanvas
            nodes={nodes}
            relationships={model.relationships}
            canEdit={canEdit}
            onConnect={onConnect}
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
          // Trần chiều cao + tự cuộn: danh sách dài không được phép đẩy sơ đồ
          // ra khỏi màn hình. Năm dòng là đủ để thấy có gì mà không lấn.
          <TableWrap className="max-h-60">
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

            {/* Gom theo ĐẦU quan hệ chứ không theo loại ô: bảng và cột của cùng
                một phía đứng cạnh nhau thì mắt đọc được thành "nguồn nối bằng
                cột này". Cách xếp cũ đặt hai ô Cột khoá ở hai hàng khác nhau,
                và chúng trông giống hệt nhau. */}
            <div className="grid gap-5 sm:grid-cols-2">
              <fieldset className="space-y-3">
                <legend className="text-sm font-semibold text-slate-900">Bảng nguồn</legend>

                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-slate-700">Bảng</span>
                  <select
                    value={form.leftId}
                    onChange={(e) =>
                      setForm({ ...form, leftId: Number(e.target.value), leftColumnId: null })
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    {model.datasets.map((ds) => (
                      <option key={ds.id} value={ds.id}>
                        {ds.displayName ?? ds.datasetName}
                      </option>
                    ))}
                  </select>
                </label>

                <SearchSelect
                  label="Cột khoá"
                  value={form.leftColumnId}
                  onChange={(leftColumnId) => setForm({ ...form, leftColumnId })}
                  rows={6}
                  noun="cột"
                  options={columnOptions(leftDataset)}
                />
              </fieldset>

              <fieldset className="space-y-3">
                <legend className="text-sm font-semibold text-slate-900">Bảng đích</legend>

                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-slate-700">Bảng</span>
                  <select
                    value={form.rightId}
                    onChange={(e) => {
                      const rightId = Number(e.target.value);
                      const target = model.datasets.find((d) => d.id === rightId);
                      // Đổi bảng đích thì điền lại khoá chính của bảng MỚI, không
                      // giữ cột của bảng cũ (id đó thuộc bảng khác nên vô nghĩa).
                      setForm({ ...form, rightId, rightColumnId: target?.primaryColumnId ?? null });
                    }}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    {model.datasets.map((ds) => (
                      <option key={ds.id} value={ds.id}>
                        {ds.displayName ?? ds.datasetName}
                      </option>
                    ))}
                  </select>
                </label>

                <SearchSelect
                  label="Cột khoá"
                  value={form.rightColumnId}
                  onChange={(rightColumnId) => setForm({ ...form, rightColumnId })}
                  rows={6}
                  noun="cột"
                  options={columnOptions(rightDataset)}
                  // Bảng đích chưa có khoá chính là lý do hay gặp nhất khiến
                  // người dùng chọn nhầm cột nối. Chỉ thẳng chỗ đi sửa.
                  hint={
                    rightDataset !== undefined && rightDataset.primaryColumnId === null ? (
                      <span className="text-amber-700">
                        Bảng này chưa có khoá chính — đặt ở tab <strong>Schemas</strong> để lần sau
                        được điền sẵn.
                      </span>
                    ) : undefined
                  }
                />
              </fieldset>
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
