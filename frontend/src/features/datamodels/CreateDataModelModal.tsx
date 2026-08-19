import { LOAD_STATUS_LABELS, LOAD_STATUSES_LIVE } from '@bi/shared';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { ErrorState } from '../../components/ui/states';
import { useDatasets } from '../tenant/hooks';
import { getApiError } from '../../services/apiClient';
import { useWorkspace } from '../../workspace/useWorkspace';
import { useCreateDataModel } from './hooks';

/**
 * Tạo mô hình dữ liệu — §10.2.
 *
 * ─── Chỉ chào bộ dữ liệu ĐÃ NẠP ─────────────────────────────────────────────
 *
 * Mô hình dựng trên bảng `raw_*` trong ClickHouse, mà bảng đó chỉ tồn tại sau
 * khi bộ dữ liệu được nạp (§9). Bộ chưa nạp vẫn HIỆN RA nhưng bị vô hiệu kèm
 * lý do — giấu hẳn thì người dùng tìm mãi không thấy bộ dữ liệu họ vừa tải lên
 * và không có gì giải thích vì sao.
 *
 * ─── `workspaceId` BẮT BUỘC phải gửi ────────────────────────────────────────
 *
 * Mô hình thuộc về một workspace, và danh sách ở trang Mô hình dữ liệu lọc theo
 * workspace đang mở. Bỏ trống trường này thì backend rơi vào `resolveWorkspace`
 * với `undefined`, và nhánh đó chọn workspace ĐẦU TIÊN THEO TÊN (`ORDER BY
 * w.name ASC`) — không liên quan gì tới workspace người dùng đang xem.
 *
 * Tổ chức một workspace thì hai thứ đó tình cờ trùng nhau và lỗi không lộ ra.
 * Tổ chức hai workspace trở lên thì mô hình vừa tạo rơi vào workspace khác, biến
 * mất khỏi danh sách ngay lập tức, và người dùng thấy đúng một điều: công sức
 * của họ không được lưu.
 */

interface Props {
  open: boolean;
  onClose: () => void;
}

export function CreateDataModelModal({ open, onClose }: Props): React.ReactElement {
  const navigate = useNavigate();
  const create = useCreateDataModel();
  const { current: workspace } = useWorkspace();

  const [name, setName] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [formError, setFormError] = useState<string | null>(null);

  // Lấy cả bộ chưa nạp để hiện chúng ở trạng thái vô hiệu kèm lý do.
  const { data, isPending } = useDatasets(
    {
      page: 1,
      pageSize: 100,
      q: '',
      sort: 'name',
      order: 'asc',
      connectionId: '',
      source: '',
    },
    // Chỉ hỏi lại khi hộp thoại đang mở — không có lý do gì để một hộp thoại
    // đóng vẫn bắn request mỗi hai giây.
    open,
  );

  const datasets = data?.items ?? [];
  const noneReady = datasets.every((d) => d.loadStatus !== 'loaded');
  const loading = datasets.filter((d) => LOAD_STATUSES_LIVE.includes(d.loadStatus)).length;

  function toggle(id: number): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function submit(): void {
    setFormError(null);

    if (name.trim() === '') {
      setFormError('Hãy đặt tên cho mô hình.');
      return;
    }
    if (selected.size === 0) {
      setFormError('Hãy chọn ít nhất một bộ dữ liệu.');
      return;
    }
    if (workspace === null) {
      setFormError('Chưa chọn được workspace. Hãy tải lại trang.');
      return;
    }

    create.mutate(
      { name: name.trim(), workspaceId: workspace.id, datasetIds: [...selected] },
      {
        onSuccess: (model) => {
          setName('');
          setSelected(new Set());
          onClose();
          // Đưa thẳng vào mô hình vừa tạo: người dùng tạo nó để làm việc trên
          // đó, không phải để nhìn nó trong một danh sách.
          navigate(`/datamodels/${model.id}`);
        },
        onError: (err) => setFormError(getApiError(err).message),
      },
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Tạo mô hình dữ liệu"
      description="Chọn những bộ dữ liệu bạn muốn hỏi cùng nhau. Hệ thống đọc cấu trúc từ kho phân tích và tự phân loại cột."
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Huỷ</Button>
          <Button variant="primary" onClick={submit} loading={create.isPending}>
            Tạo mô hình
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {formError !== null && <ErrorState message={formError} />}

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Tên mô hình</span>
          <input
            type="text"
            value={name}
            autoFocus
            placeholder="Doanh thu theo khách hàng"
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          {/* Nói ra workspace đích. Mô hình chỉ hiện trong danh sách của đúng
              workspace này, nên đó là thông tin người dùng cần TRƯỚC khi bấm
              tạo, không phải sau khi đi tìm mãi không thấy. */}
          {workspace !== null && (
            <span className="mt-1 block text-xs text-slate-500">
              Mô hình sẽ nằm trong workspace <strong>{workspace.name}</strong>.
            </span>
          )}
        </label>

        <div>
          <span className="mb-1.5 block text-sm font-medium text-slate-700">
            Bộ dữ liệu ({selected.size} đã chọn)
          </span>

          {isPending && <p className="text-sm text-slate-500">Đang tải…</p>}

          {!isPending && datasets.length === 0 && (
            <p className="text-sm text-slate-500">
              Chưa có bộ dữ liệu nào. Tải một file lên ở{' '}
              <Link to="/datasets" className="text-brand-700 hover:underline">
                Kho dữ liệu
              </Link>{' '}
              trước đã.
            </p>
          )}

          {/* Có dữ liệu nhưng CHƯA NẠP là tình huống rất dễ gặp và rất dễ hiểu
              nhầm: người dùng thấy bộ dữ liệu của mình nằm đó nhưng không tích
              được, và không có gì giải thích. Nói thẳng việc phải làm và chỉ
              đúng chỗ làm. */}
          {/* Đang nạp là trạng thái SẼ TỰ HẾT, khác hẳn "chưa ai bấm nạp". Nói
              rõ là màn hình tự cập nhật, nếu không người dùng nhìn chữ "Đang
              chờ" đứng im và kết luận là hỏng. */}
          {loading > 0 && (
            <div
              aria-live="polite"
              className="mb-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700"
            >
              <strong>{loading} bộ dữ liệu đang được nạp vào kho phân tích.</strong> File lớn mất
              vài chục giây. Danh sách này tự cập nhật, không cần đóng mở lại.
            </div>
          )}

          {!isPending && datasets.length > 0 && noneReady && loading === 0 && (
            <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Chưa bộ dữ liệu nào được <strong>nạp vào kho phân tích</strong> nên chưa dựng mô
              hình lên được. Mở một bộ ở{' '}
              <Link to="/datasets" className="font-medium underline">
                Kho dữ liệu
              </Link>{' '}
              rồi vào tab <strong>Kho phân tích</strong> để nạp.
            </div>
          )}

          <ul className="max-h-72 space-y-0.5 overflow-y-auto rounded-lg border border-slate-200 p-1.5">
            {datasets.map((dataset) => {
              const ready = dataset.loadStatus === 'loaded';
              return (
                <li key={dataset.id}>
                  <label
                    className={`flex items-center gap-2.5 rounded px-2 py-1.5 text-sm ${
                      ready ? 'cursor-pointer hover:bg-slate-50' : 'cursor-not-allowed opacity-60'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(dataset.id)}
                      disabled={!ready}
                      onChange={() => toggle(dataset.id)}
                      className="rounded border-slate-300"
                    />
                    <span className="flex-1 text-slate-700">{dataset.name}</span>
                    {ready ? (
                      <span className="text-xs text-slate-400">{dataset.columnCount} cột</span>
                    ) : (
                      // Nói LÝ DO chứ không chỉ làm mờ: bộ dữ liệu chưa nạp thì
                      // chưa có bảng nào trong kho để dựng mô hình lên.
                      <Badge tone="warning">{LOAD_STATUS_LABELS[dataset.loadStatus]}</Badge>
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </Modal>
  );
}
