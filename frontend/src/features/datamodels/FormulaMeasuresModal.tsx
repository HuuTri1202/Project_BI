import {
  MEASURE_FORMAT_LABELS,
  MEASURE_FORMATS,
  MEASURE_OP_LABELS,
  MEASURE_OPS,
  type DataModelMeasureDto,
  type MeasureFormat,
  type MeasureOp,
} from '@bi/shared';
import { useState } from 'react';

import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { SearchSelect } from '../../components/ui/SearchSelect';
import { TBody, Td, Th, THead, TableWrap, Tr } from '../../components/ui/Table';
import { ErrorState } from '../../components/ui/states';
import { getApiError } from '../../services/apiClient';
import { useCreateFormulaMeasure, useDeleteMeasure } from './hooks';

/**
 * Quản lý thước đo TÍNH TOÁN — §10.6.
 *
 * ─── Vì sao là hộp thoại, không phải một tab hay một khối trên trang ────────
 *
 * Tab Measures đã bị bỏ vì nó là cả một tab dành cho một thứ ít khi đụng tới.
 * Đặt danh sách này thành một khối dưới bảng Schemas cũng không được: bảng đó
 * đang chiếm hết chiều cao còn lại, và thêm một khối bên dưới sẽ lặp lại đúng
 * cuộc tranh chiều cao mà tab Quan hệ vừa phải sửa.
 *
 * Hộp thoại tránh cả hai — không tốn chỗ khi không dùng, không cần một tab.
 *
 * ─── Vì sao không có ô nhập công thức ──────────────────────────────────────
 *
 * Hai vế là hai Ô CHỌN, phép nằm trong bốn nút. Người dùng không gõ được một ký
 * tự nào vào biểu thức, nên không ký tự nào của họ đi vào SQL — xem ghi chú ở
 * migration 13. Cái mất là `CASE WHEN`; cái được là cả một lớp lỗ hổng biến mất.
 */
export function FormulaMeasuresModal({
  open,
  onClose,
  modelId,
  canEdit,
  measures,
}: {
  open: boolean;
  onClose: () => void;
  modelId: number;
  canEdit: boolean;
  measures: DataModelMeasureDto[];
}): React.ReactElement {
  const create = useCreateFormulaMeasure(modelId);
  const remove = useDeleteMeasure(modelId);

  const [name, setName] = useState('');
  const [leftId, setLeftId] = useState<number | null>(null);
  const [op, setOp] = useState<MeasureOp>('div');
  const [rightId, setRightId] = useState<number | null>(null);
  const [format, setFormat] = useState<MeasureFormat>('percent');
  const [error, setError] = useState<string | null>(null);

  const formulas = measures.filter((m) => m.kind === 'formula');
  const left = measures.find((m) => m.id === leftId) ?? null;
  const right = measures.find((m) => m.id === rightId) ?? null;

  /*
   * Vế phải chỉ liệt kê thước đo CÙNG BẢNG với vế trái.
   *
   * Lọc ngay ở bộ chọn thay vì để người dùng chọn xong rồi backend từ chối:
   * ràng buộc này không hiển nhiên, và một thông báo lỗi sau khi bấm Lưu thì
   * muộn hơn hẳn một danh sách chỉ hiện những lựa chọn hợp lệ.
   */
  const rightOptions = measures.filter(
    (m) => left !== null && m.datamodelDatasetId === left.datamodelDatasetId && m.id !== left.id,
  );

  function reset(): void {
    setName('');
    setLeftId(null);
    setRightId(null);
    setOp('div');
    setFormat('percent');
    setError(null);
  }

  const shortName = (m: DataModelMeasureDto): string =>
    m.datasetName.split(' · ').pop() ?? m.datasetName;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Thước đo tính toán"
      description="Ghép hai thước đo có sẵn thành một tỉ lệ hoặc một tổng hợp mới."
      size="lg"
      footer={<Button onClick={onClose}>Đóng</Button>}
    >
      <div className="space-y-5">
        {formulas.length === 0 ? (
          <p className="text-sm text-slate-500">
            Chưa có thước đo tính toán nào. Ví dụ hay dùng nhất là{' '}
            <strong>Biên lợi nhuận = Profit ÷ Sales</strong> — và nó không thay được bằng cách
            chia tay trên bảng kết quả, vì phép chia phải xảy ra <strong>sau khi gộp nhóm</strong>.
          </p>
        ) : (
          <TableWrap className="max-h-52">
            <THead>
              <Tr>
                <Th>Tên</Th>
                <Th>Công thức</Th>
                <Th>Bảng</Th>
                <Th align="right">Thao tác</Th>
              </Tr>
            </THead>
            <TBody>
              {formulas.map((m) => (
                <Tr key={m.id}>
                  <Td>
                    <span className="font-medium text-slate-800">{m.name}</span>
                    {m.format === 'percent' && (
                      <span className="ml-2">
                        <Badge tone="neutral">%</Badge>
                      </span>
                    )}
                  </Td>
                  <Td>
                    {m.formula === null ? (
                      <span className="text-slate-400">—</span>
                    ) : (
                      <code className="text-xs text-slate-600">
                        {m.formula.leftName} {MEASURE_OP_LABELS[m.formula.op]} {m.formula.rightName}
                      </code>
                    )}
                  </Td>
                  <Td>
                    <span className="text-xs text-slate-500">{m.datasetName}</span>
                  </Td>
                  <Td align="right">
                    {canEdit ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={remove.isPending}
                        onClick={() =>
                          remove.mutate(m.id, {
                            onError: (err) => setError(getApiError(err).message),
                          })
                        }
                      >
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

        {error !== null && <ErrorState message={error} />}

        {canEdit && (
          <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <h3 className="text-sm font-semibold text-slate-900">Thêm thước đo tính toán</h3>

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">Tên</span>
              <input
                type="text"
                value={name}
                placeholder="Biên lợi nhuận"
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <SearchSelect
                label="Thước đo thứ nhất"
                value={leftId}
                noun="thước đo"
                rows={5}
                onChange={(next) => {
                  setLeftId(next);
                  // Đổi vế trái thì vế phải có thể không còn cùng bảng nữa. Bỏ
                  // nó đi thay vì để lại một lựa chọn đã thành không hợp lệ.
                  setRightId(null);
                }}
                options={measures.map((m) => ({
                  value: m.id,
                  label: m.name,
                  hint: shortName(m),
                }))}
              />

              <SearchSelect
                label="Thước đo thứ hai"
                value={rightId}
                noun="thước đo"
                rows={5}
                onChange={setRightId}
                options={rightOptions.map((m) => ({
                  value: m.id,
                  label: m.name,
                  hint: shortName(m),
                }))}
                hint={
                  left === null
                    ? 'Chọn thước đo thứ nhất trước.'
                    : `Chỉ liệt kê thước đo của bảng ${left.datasetName}. Ghép chéo bảng phải đi qua một phép nối, và nếu khoá bên kia có giá trị trùng thì tử số với mẫu số bị nhân lên không đều — tỉ lệ ra sai mà vẫn trông hợp lý.`
                }
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <span className="mb-1 block text-sm font-medium text-slate-700">Phép tính</span>
                <div className="flex gap-1 rounded-lg bg-white p-1 ring-1 ring-slate-300 ring-inset">
                  {MEASURE_OPS.map((o) => (
                    <button
                      key={o}
                      type="button"
                      onClick={() => setOp(o)}
                      aria-pressed={op === o}
                      aria-label={`Phép ${MEASURE_OP_LABELS[o]}`}
                      className={`flex-1 rounded-md py-1.5 text-sm font-semibold transition-colors ${
                        op === o ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      {MEASURE_OP_LABELS[o]}
                    </button>
                  ))}
                </div>
              </div>

              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-700">Hiển thị</span>
                <select
                  value={format}
                  onChange={(e) => setFormat(e.target.value as MeasureFormat)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  {MEASURE_FORMATS.map((f) => (
                    <option key={f} value={f}>
                      {MEASURE_FORMAT_LABELS[f]}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-xs text-slate-500">
                  Chỉ đổi cách ĐỌC, không đổi con số. <strong>Phần trăm</strong> hiện 0,283 thành
                  28,3 %.
                </span>
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="primary"
                loading={create.isPending}
                disabled={name.trim() === '' || leftId === null || rightId === null}
                onClick={() => {
                  if (leftId === null || rightId === null) return;
                  setError(null);
                  create.mutate(
                    { name: name.trim(), leftId, op, rightId, format },
                    { onSuccess: reset, onError: (err) => setError(getApiError(err).message) },
                  );
                }}
              >
                Thêm thước đo
              </Button>

              {/* Xem trước bằng chính TÊN người dùng vừa chọn, không bằng biểu
                  thức SQL: đây là chỗ họ xác nhận mình ghép đúng hai thứ, và
                  `m70 / m67` không giúp gì cho việc đó. */}
              {left !== null && right !== null && (
                <span className="text-sm text-slate-500">
                  {name.trim() === '' ? 'Thước đo mới' : name.trim()} ={' '}
                  <strong className="font-medium text-slate-700">{left.name}</strong>{' '}
                  {MEASURE_OP_LABELS[op]}{' '}
                  <strong className="font-medium text-slate-700">{right.name}</strong>
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
