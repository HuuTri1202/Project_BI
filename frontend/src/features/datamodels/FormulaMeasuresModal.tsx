import {
  MEASURE_AGG_LABELS,
  MEASURE_AGGS_BY_CUBE_TYPE,
  MEASURE_FORMAT_LABELS,
  MEASURE_FORMATS,
  MEASURE_OP_LABELS,
  MEASURE_OPS,
  defaultKindForOp,
  type DataModelMeasureDto,
  type MeasureAgg,
  type MeasureFormat,
  type MeasureKind,
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
import { useCreateFormulaMeasure, useCreateRowExprMeasure, useDeleteMeasure } from './hooks';

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
  const createRowExpr = useCreateRowExprMeasure(modelId);
  const remove = useDeleteMeasure(modelId);

  const [name, setName] = useState('');
  const [leftId, setLeftId] = useState<number | null>(null);
  const [op, setOp] = useState<MeasureOp>('div');
  const [rightId, setRightId] = useState<number | null>(null);
  const [format, setFormat] = useState<MeasureFormat>('percent');
  const [agg, setAgg] = useState<MeasureAgg>('sum');
  const [error, setError] = useState<string | null>(null);

  /*
   * Cách tính: theo phép toán cho tới khi người dùng tự chọn.
   *
   * `null` = chưa ai đụng tới, nên `defaultKindForOp` quyết. Bấm × thì nhảy
   * sang "tính từng dòng", bấm ÷ thì nhảy về "gộp trước" — đúng cái người ta
   * muốn trong hầu hết trường hợp, mà không khoá lại lựa chọn ngược lại.
   *
   * Nhớ lựa chọn thủ công là bắt buộc: nếu không, người dùng chọn "gộp trước"
   * rồi đổi phép sang × sẽ bị âm thầm kéo về "tính từng dòng" — đúng loại tự
   * tiện tay mà cả hộp thoại này sinh ra để tránh.
   */
  const [kindDaChon, setKindDaChon] = useState<MeasureKind | null>(null);
  const kind = kindDaChon ?? defaultKindForOp(op);

  const tinhTungDong = kind === 'rowExpr';

  const formulas = measures.filter((m) => m.kind === 'formula' || m.kind === 'rowExpr');

  /*
   * Nguồn cho hai ô chọn.
   *
   * Ở chế độ "tính từng dòng" hai vế là CỘT, nhưng ta vẫn cho chọn qua thước đo
   * dựng-trên-cột rồi lấy `columnId` của nó lúc gửi: mỗi cột số của mô hình đã
   * có sẵn một thước đo như vậy, nên danh sách là một, và người dùng không phải
   * học rằng "cột" với "thước đo" là hai danh sách khác nhau.
   */
  const nguon = tinhTungDong
    ? measures.filter((m) => m.kind === 'column' && m.columnId !== null)
    : measures;

  const left = nguon.find((m) => m.id === leftId) ?? null;
  const right = nguon.find((m) => m.id === rightId) ?? null;

  /*
   * Vế phải chỉ liệt kê thước đo CÙNG BẢNG với vế trái.
   *
   * Lọc ngay ở bộ chọn thay vì để người dùng chọn xong rồi backend từ chối:
   * ràng buộc này không hiển nhiên, và một thông báo lỗi sau khi bấm Lưu thì
   * muộn hơn hẳn một danh sách chỉ hiện những lựa chọn hợp lệ.
   */
  const rightOptions = nguon.filter(
    (m) =>
      left !== null &&
      m.datamodelDatasetId === left.datamodelDatasetId &&
      // `x × x` là bình phương — một câu hỏi thật. `a / a` thì luôn bằng 1, nên
      // chỉ chế độ tính-từng-dòng mới cho chọn trùng vế.
      (tinhTungDong || m.id !== left.id),
  );

  function reset(): void {
    setName('');
    setLeftId(null);
    setRightId(null);
    setOp('div');
    setFormat('percent');
    setAgg('sum');
    setKindDaChon(null);
    setError(null);
  }

  /** Công thức viết ra chữ, đúng thứ sẽ chạy. */
  function congThuc(k: MeasureKind): string {
    const t = left?.name ?? '…';
    const p = right?.name ?? '…';
    const dau = MEASURE_OP_LABELS[op];
    return k === 'rowExpr'
      ? `${MEASURE_AGG_LABELS[agg]}( ${t} ${dau} ${p} )`
      : `${t} ${dau} ${p}`;
  }

  const shortName = (m: DataModelMeasureDto): string =>
    m.datasetName.split(' · ').pop() ?? m.datasetName;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Thước đo tính toán"
      description="Ghép hai cột hoặc hai thước đo có sẵn thành một chỉ số mới — doanh thu, tỉ suất, đơn giá bình quân."
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
                    {/* Hai loại đọc khác nhau, và khác biệt đó phải nhìn thấy
                        được: `Tổng( a × b )` với `a × b` là hai con số khác
                        nhau. Hiện cùng một kiểu là giấu đi đúng thứ quan trọng. */}
                    {m.rowExpr !== null && m.columnName !== null ? (
                      <code className="text-xs text-slate-600">
                        {MEASURE_AGG_LABELS[m.agg]}( {m.columnName}{' '}
                        {MEASURE_OP_LABELS[m.rowExpr.op]} {m.rowExpr.rightColumnName} )
                      </code>
                    ) : m.formula !== null ? (
                      <code className="text-xs text-slate-600">
                        {m.formula.leftName} {MEASURE_OP_LABELS[m.formula.op]} {m.formula.rightName}
                      </code>
                    ) : (
                      <span className="text-slate-400">—</span>
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

            {/* ═══ Cách tính ═══════════════════════════════════════════════
                Hai lựa chọn bày CẠNH NHAU kèm công thức viết ra chữ, vì đây là
                chỗ ra hai CON SỐ khác nhau chứ không phải hai lối viết cho cùng
                một số — và cái sai lại là cái trông hợp lý. Đo trên dữ liệu
                thật: `sum(sl) × avg(giá)` lệch 0,047% so với `sum(sl × giá)`,
                tức không ai phát hiện. */}
            <fieldset>
              <legend className="mb-1.5 text-sm font-medium text-slate-700">Cách tính</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {(['formula', 'rowExpr'] as const).map((k) => {
                  const on = kind === k;
                  return (
                    <button
                      key={k}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setKindDaChon(k)}
                      className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                        on
                          ? 'border-brand-500 bg-brand-50'
                          : 'border-slate-300 bg-white hover:bg-slate-50'
                      }`}
                    >
                      <span
                        className={`block text-sm font-medium ${
                          on ? 'text-brand-900' : 'text-slate-700'
                        }`}
                      >
                        {k === 'formula' ? 'Gộp trước rồi tính' : 'Tính từng dòng rồi gộp'}
                      </span>
                      <span
                        className={`mt-0.5 block font-mono text-xs ${
                          on ? 'text-brand-800' : 'text-slate-500'
                        }`}
                      >
                        {congThuc(k)}
                      </span>
                    </button>
                  );
                })}
              </div>
              <span className="mt-1.5 block text-xs text-slate-500">
                {tinhTungDong
                  ? 'Nhân hoặc chia trên TỪNG DÒNG trước, rồi mới gộp. Đây là cách tính doanh thu từ số lượng và đơn giá.'
                  : 'Gộp hai vế trước, rồi mới tính. Đây là cách tính tỉ suất — tỉ số của hai TỔNG.'}
              </span>
            </fieldset>

            <div className="grid gap-4 sm:grid-cols-2">
              <SearchSelect
                label={tinhTungDong ? 'Cột thứ nhất' : 'Thước đo thứ nhất'}
                value={leftId}
                noun="thước đo"
                rows={5}
                onChange={(next) => {
                  setLeftId(next);
                  // Đổi vế trái thì vế phải có thể không còn cùng bảng nữa. Bỏ
                  // nó đi thay vì để lại một lựa chọn đã thành không hợp lệ.
                  setRightId(null);
                }}
                options={nguon.map((m) => ({
                  value: m.id,
                  label: m.name,
                  hint: shortName(m),
                }))}
              />

              <SearchSelect
                label={tinhTungDong ? 'Cột thứ hai' : 'Thước đo thứ hai'}
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
                    ? `Chọn ${tinhTungDong ? 'cột' : 'thước đo'} thứ nhất trước.`
                    : `Chỉ liệt kê ${tinhTungDong ? 'cột' : 'thước đo'} của bảng ${left.datasetName}. Ghép chéo bảng phải đi qua một phép nối, và phép nối thì nhân bản dòng — con số ra sai mà vẫn trông hợp lý.`
                }
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {/* Phép gộp CHỈ có nghĩa ở chế độ tính-từng-dòng: ở chế độ kia hai
                  vế đã gộp xong rồi, không còn gì để gộp nữa. Hiện một ô vô
                  hiệu lực sẽ khiến người dùng tưởng mình chọn được. */}
              {tinhTungDong && (
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-slate-700">Phép gộp</span>
                  <select
                    value={agg}
                    onChange={(e) => setAgg(e.target.value as MeasureAgg)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    {MEASURE_AGGS_BY_CUBE_TYPE.number.map((a) => (
                      <option key={a} value={a}>
                        {MEASURE_AGG_LABELS[a]}
                      </option>
                    ))}
                  </select>
                  <span className="mt-1 block text-xs text-slate-500">
                    Chạy SAU khi đã tính từng dòng.
                  </span>
                </label>
              )}

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
                loading={create.isPending || createRowExpr.isPending}
                disabled={name.trim() === '' || left === null || right === null}
                onClick={() => {
                  if (left === null || right === null) return;
                  setError(null);
                  const xong = {
                    onSuccess: reset,
                    onError: (err: unknown) => setError(getApiError(err).message),
                  };

                  if (!tinhTungDong) {
                    create.mutate(
                      { name: name.trim(), leftId: left.id, op, rightId: right.id, format },
                      xong,
                    );
                    return;
                  }

                  // Ô chọn cho chọn qua THƯỚC ĐO nhưng backend nhận ID CỘT —
                  // xem ghi chú ở `nguon`. Lọc `kind === 'column'` ở trên đã
                  // bảo đảm `columnId` không rỗng, kiểm lại vì kiểu vẫn nullable.
                  if (left.columnId === null || right.columnId === null) {
                    setError('Có vế không gắn với cột nào. Hãy tải lại trang rồi chọn lại.');
                    return;
                  }
                  createRowExpr.mutate(
                    {
                      name: name.trim(),
                      agg,
                      leftColumnId: left.columnId,
                      op,
                      rightColumnId: right.columnId,
                      format,
                    },
                    xong,
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
                  <strong className="font-medium text-slate-700">{congThuc(kind)}</strong>
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
