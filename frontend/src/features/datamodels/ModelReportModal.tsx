import {
  CHART_TYPES,
  CHART_TYPE_LABELS,
  COLUMN_ROLE_LABELS,
  type ChartType,
  type ExplorerFieldDto,
} from '@bi/shared';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { SearchSelect } from '../../components/ui/SearchSelect';
import { ErrorState } from '../../components/ui/states';
import { useCreateModelReport } from '../datasets/hooks';
import { getApiError } from '../../services/apiClient';
import { useDataModels, useExplorerFields } from './hooks';

/**
 * Tạo báo cáo từ MÔ HÌNH DỮ LIỆU — §10.8.
 *
 * ═══ Vì sao một hộp thoại chứ không phải một wizard nhiều bước ═══════════════
 *
 * Wizard của §7 có ba bước vì mỗi bước phải CHỜ bước trước: tải file lên xong
 * mới đọc được có những sheet nào, chọn sheet xong mới nhập được. Ở đây không
 * có chuỗi chờ đó — chọn mô hình xong là biết ngay có những chiều và thước đo
 * nào. Chia thành ba màn hình chỉ thêm ba lần bấm cho cùng một lượng thông tin.
 *
 * ═══ Vì sao báo cáo ra đời là ĐÃ có biểu đồ ═════════════════════════════════
 *
 * Ngược luồng file, nơi wizard tạo cái vỏ rồi để người dùng dựng biểu đồ sau.
 * Khác biệt nằm ở chỗ hệ thống biết gì: một file vừa tải lên thì chưa biết cột
 * nào đáng vẽ, còn ở đây người dùng vừa TỰ chọn chiều và thước đo. Tạo ra một
 * báo cáo rỗng để bắt họ chọn lại là việc thừa.
 *
 * ═══ Vì sao KHÔNG có ô chọn phép gộp ═══════════════════════════════════════
 *
 * Nhánh bộ dữ liệu hỏi "cột nào, gộp kiểu gì" vì một cột trần không tự nói được
 * điều đó. Thước đo thì đã mang sẵn phép gộp của nó (tab Schemas, hoặc công
 * thức ở §10.6). Hỏi lại nghĩa là cùng một thước đo cho hai con số khác nhau
 * tuỳ báo cáo — đúng thứ tầng ngữ nghĩa sinh ra để dẹp.
 */

/** Trần nhóm hiện trên biểu đồ; phần vượt gộp thành "Khác" nếu phép cộng được. */
const LIMIT_CHOICES = [10, 20, 50] as const;

export function ModelReportModal({
  open,
  onClose,
  /** Có sẵn khi mở từ trong một mô hình — khi đó không hỏi lại mô hình nào. */
  datamodelId,
}: {
  open: boolean;
  onClose: () => void;
  datamodelId?: number | undefined;
}): React.ReactElement {
  const navigate = useNavigate();
  const create = useCreateModelReport();

  const [pickedId, setPickedId] = useState<number | null>(datamodelId ?? null);
  const [dimensionId, setDimensionId] = useState<number | null>(null);
  const [measureId, setMeasureId] = useState<number | null>(null);
  const [chartType, setChartType] = useState<ChartType>('bar');
  const [limit, setLimit] = useState<number>(20);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Chỉ tải danh sách khi THẬT SỰ phải hỏi. Mở từ trong một mô hình thì việc
  // kéo về danh sách mô hình là một vòng mạng không ai dùng tới.
  const models = useDataModels({
    page: 1,
    pageSize: 100,
    q: '',
    sort: 'updatedAt',
    order: 'desc',
  });
  const fields = useExplorerFields(open ? pickedId : null);

  // Đổi mô hình thì chiều và thước đo cũ thuộc mô hình khác — bỏ đi thay vì để
  // lại hai id đã thành vô nghĩa và chỉ lộ ra khi backend từ chối.
  useEffect(() => {
    setDimensionId(null);
    setMeasureId(null);
  }, [pickedId]);

  // Hộp thoại không bị gỡ khỏi cây khi đóng, nên state sống qua các lần mở. Đặt
  // lại mô hình theo prop mỗi lần mở: người dùng mở nó từ hai mô hình khác nhau
  // thì lần thứ hai phải là mô hình thứ hai.
  useEffect(() => {
    if (open) setPickedId(datamodelId ?? null);
  }, [open, datamodelId]);

  const dimensions = fields.data?.dimensions ?? [];
  const measures = fields.data?.measures ?? [];
  const ready = pickedId !== null && dimensionId !== null && measureId !== null && name.trim() !== '';

  const optionsOf = (list: ExplorerFieldDto[]): { value: number; label: string; hint: string }[] =>
    list.map((f) => ({ value: f.id, label: f.label, hint: shortName(f.datasetName) }));

  function submit(): void {
    if (pickedId === null || dimensionId === null || measureId === null) return;
    setError(null);
    create.mutate(
      {
        datamodelId: pickedId,
        name: name.trim(),
        chartType,
        config: { dimensionId, measureId, limit },
      },
      {
        onSuccess: (report) => {
          onClose();
          reset();
          // Đưa thẳng tới báo cáo vừa tạo. Đây là chỗ chứng minh mọi lựa chọn
          // vừa rồi có nghĩa — quay về danh sách thì người dùng vẫn chưa thấy
          // con số nào.
          navigate(`/reports/${report.id}`);
        },
        onError: (err) => setError(getApiError(err).message),
      },
    );
  }

  function reset(): void {
    setDimensionId(null);
    setMeasureId(null);
    setChartType('bar');
    setLimit(20);
    setName('');
    setError(null);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Tạo báo cáo từ mô hình dữ liệu"
      description="Chọn một chiều để nhóm và một thước đo để đo. Câu lệnh do Cube sinh, nên báo cáo thừa hưởng cả phép nối lẫn thước đo tính toán của mô hình."
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Huỷ</Button>
          <Button variant="primary" loading={create.isPending} disabled={!ready} onClick={submit}>
            Tạo báo cáo
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error !== null && <ErrorState message={error} />}

        {datamodelId === undefined && (
          <SearchSelect
            label="Mô hình dữ liệu"
            value={pickedId}
            noun="mô hình"
            rows={5}
            onChange={setPickedId}
            options={(models.data?.items ?? []).map((m) => ({
              value: m.id,
              label: m.name,
              hint: `${m.datasetCount} bảng`,
            }))}
            hint={
              models.isPending
                ? 'Đang tải danh sách mô hình…'
                : (models.data?.items.length ?? 0) === 0
                  ? 'Workspace này chưa có mô hình nào. Hãy tạo mô hình trước.'
                  : undefined
            }
          />
        )}

        {pickedId !== null && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <SearchSelect
                label={`${COLUMN_ROLE_LABELS.dimension} — nhóm theo`}
                value={dimensionId}
                noun="chiều"
                rows={5}
                onChange={setDimensionId}
                options={optionsOf(dimensions)}
                hint={
                  fields.isPending
                    ? 'Đang đọc mô hình…'
                    : dimensions.length === 0
                      ? 'Mô hình này chưa có chiều nào.'
                      : undefined
                }
              />

              <SearchSelect
                label={`${COLUMN_ROLE_LABELS.measure} — đo cái gì`}
                value={measureId}
                noun="thước đo"
                rows={5}
                onChange={setMeasureId}
                options={optionsOf(measures)}
                hint={
                  fields.isPending
                    ? undefined
                    : measures.length === 0
                      ? 'Mô hình này chưa có thước đo nào.'
                      : 'Phép gộp đã nằm trong thước đo — không chọn lại ở đây.'
                }
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <span className="mb-1 block text-sm font-medium text-slate-700">Loại biểu đồ</span>
                <div className="flex flex-wrap gap-1 rounded-lg bg-slate-50 p-1 ring-1 ring-slate-300 ring-inset">
                  {CHART_TYPES.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setChartType(t)}
                      aria-pressed={chartType === t}
                      className={`flex-1 rounded-md px-2 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors ${
                        chartType === t
                          ? 'bg-brand-600 text-white'
                          : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      {CHART_TYPE_LABELS[t]}
                    </button>
                  ))}
                </div>
              </div>

              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-700">Số nhóm tối đa</span>
                <select
                  value={limit}
                  onChange={(e) => setLimit(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  {LIMIT_CHOICES.map((n) => (
                    <option key={n} value={n}>
                      {n} nhóm
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-xs text-slate-500">
                  Vượt quá thì phần còn lại gộp thành <strong>Khác</strong> — chỉ khi phép tính
                  cộng được. Tỉ lệ và trung bình thì cắt bớt, và báo cáo nói rõ là đã cắt.
                </span>
              </label>
            </div>

            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">Tên báo cáo</span>
              <input
                type="text"
                value={name}
                placeholder="Doanh thu theo vùng"
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              />
            </label>
          </>
        )}
      </div>
    </Modal>
  );
}

/** "Global-Superstore · Orders" → "Orders". Tên mô hình đã ở tiêu đề hộp thoại. */
function shortName(datasetName: string): string {
  return datasetName.split(' · ').pop() ?? datasetName;
}
