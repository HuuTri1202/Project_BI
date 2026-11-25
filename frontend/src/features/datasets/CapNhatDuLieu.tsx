import {
  ACCEPTED_EXTENSIONS,
  UPLOAD_MAX_BYTES,
  type AnalyzeResultDto,
  type DatasetDetailDto,
} from '@bi/shared';
import { useState } from 'react';

import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { getApiError } from '../../services/apiClient';
import * as api from './api';

/**
 * Cập nhật một bộ dữ liệu từ file bằng TỆP MỚI — §B2.
 *
 * ═══ Lỗ nó lấp ═════════════════════════════════════════════════════════════
 *
 * Trước bản này, bộ dữ liệu từ file là ảnh chụp một lần. Tháng sau có số mới
 * thì phải tạo bộ mới → mô hình mới → báo cáo mới, còn báo cáo cũ treo số tháng
 * 8 đến hết đời. Đó là lý do một nền tảng BI mà người ta chỉ mở đúng một lần.
 *
 * Ở đây `id` giữ nguyên, nên mô hình và báo cáo đang trỏ tới bộ này vẫn chạy —
 * sáng mai mở lên là số mới.
 *
 * ═══ Ba bước, và bước giữa là bước phải có ═════════════════════════════════
 *
 * Chọn tệp → ĐỐI CHIẾU CỘT → thay. Bước giữa không phải để trang trí: backend
 * từ chối tệp thiếu cột, và nếu người dùng chỉ biết điều đó sau khi bấm "Thay"
 * thì họ đã chờ xong một lần tải tệp 50MB để nhận một câu 400.
 */
export function CapNhatDuLieu({
  dataset,
  onXong,
}: {
  dataset: DatasetDetailDto;
  onXong: () => void;
}): React.ReactElement | null {
  const [mo, setMo] = useState(false);

  // Chỉ bộ dữ liệu từ FILE mới có tệp để thay. Nguồn `connection` đọc thẳng từ
  // CSDL nên nút đúng của nó là "Nạp lại" ở tab Kho phân tích.
  if (dataset.source !== 'file') return null;

  return (
    <>
      <Button onClick={() => setMo(true)}>Cập nhật dữ liệu</Button>
      {mo && (
        <HopCapNhat
          dataset={dataset}
          onDong={() => setMo(false)}
          onXong={() => {
            setMo(false);
            onXong();
          }}
        />
      )}
    </>
  );
}

type TrangThai =
  | { buoc: 'chon' }
  | { buoc: 'dang-tai'; ten: string }
  | { buoc: 'doi-chieu'; ten: string; sheets: string[]; sheet: string; cotMoi: string[] }
  | { buoc: 'dang-thay' };

function HopCapNhat({
  dataset,
  onDong,
  onXong,
}: {
  dataset: DatasetDetailDto;
  onDong: () => void;
  onXong: () => void;
}): React.ReactElement {
  const [tt, setTt] = useState<TrangThai>({ buoc: 'chon' });
  const [loi, setLoi] = useState<string | null>(null);

  const cotCu = dataset.columns.map((c) => c.name);

  async function chonTep(file: File): Promise<void> {
    setLoi(null);
    if (file.size > UPLOAD_MAX_BYTES) {
      setLoi(`Tệp lớn hơn ${String(Math.round(UPLOAD_MAX_BYTES / 1024 / 1024))}MB.`);
      return;
    }

    setTt({ buoc: 'dang-tai', ten: file.name });
    try {
      const ve = await api.xinChoCapNhat(dataset.id, { filename: file.name, fileSize: file.size });
      await api.dayTepLen(ve.uploadUrl, file);
      const phanTich = await api.analyzeDataset(dataset.id);

      const sheets = phanTich.sheets.map((s) => s.name);
      /*
       * Sheet CÙNG TÊN với sheet đang dùng được chọn sẵn: tệp tháng sau gần như
       * luôn giữ nguyên tên sheet, và đoán đúng ở đây tiết kiệm một cú bấm mà
       * không giấu lựa chọn nào.
       */
      const dauTien = sheets.find((s) => s === dataset.sheetName) ?? sheets[0] ?? '';
      setTt({
        buoc: 'doi-chieu',
        ten: file.name,
        sheets,
        sheet: dauTien,
        cotMoi: cotCuaSheet(phanTich, dauTien),
      });
    } catch (err) {
      setLoi(getApiError(err).message);
      setTt({ buoc: 'chon' });
    }
  }

  async function thay(sheet: string): Promise<void> {
    setLoi(null);
    setTt({ buoc: 'dang-thay' });
    try {
      await api.commitDatasets(dataset.id, {
        name: dataset.name,
        sheets: [sheet],
        capNhat: true,
      });
      onXong();
    } catch (err) {
      setLoi(getApiError(err).message);
      setTt({ buoc: 'chon' });
    }
  }

  const thieu = tt.buoc === 'doi-chieu' ? cotCu.filter((c) => !tt.cotMoi.includes(c)) : [];
  const them = tt.buoc === 'doi-chieu' ? tt.cotMoi.filter((c) => !cotCu.includes(c)) : [];

  return (
    <Modal
      open
      onClose={onDong}
      title="Cập nhật dữ liệu bằng tệp mới"
      description={`Thay toàn bộ dữ liệu của "${dataset.name}". Mô hình và báo cáo đang dùng bộ này giữ nguyên.`}
      footer={
        tt.buoc === 'doi-chieu' ? (
          <>
            <Button onClick={onDong}>Huỷ</Button>
            <Button
              variant="primary"
              disabled={thieu.length > 0}
              onClick={() => void thay(tt.sheet)}
            >
              Thay dữ liệu
            </Button>
          </>
        ) : null
      }
    >
      {loi !== null && (
        <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {loi}
        </p>
      )}

      {tt.buoc === 'chon' && (
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Chọn tệp mới</span>
          <input
            type="file"
            /* `aria-label` chứ không để `<label>` bọc tự lo: nhãn này còn chứa
               cả câu gợi ý bên dưới, nên tên đọc lên sẽ là cả đoạn văn. */
            aria-label="Chọn tệp mới"
            accept={ACCEPTED_EXTENSIONS.join(',')}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f !== undefined) void chonTep(f);
            }}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          />
          <span className="mt-1 block text-xs text-slate-500">
            Tệp mới phải có đủ {cotCu.length} cột đang dùng. Thêm cột mới thì được.
          </span>
        </label>
      )}

      {(tt.buoc === 'dang-tai' || tt.buoc === 'dang-thay') && (
        <p className="text-sm text-slate-600" role="status">
          {tt.buoc === 'dang-tai' ? `Đang đọc ${tt.ten}…` : 'Đang thay dữ liệu…'}
        </p>
      )}

      {tt.buoc === 'doi-chieu' && (
        <div className="space-y-3 text-sm">
          {tt.sheets.length > 1 && (
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-700">Sheet</span>
              <select
                value={tt.sheet}
                onChange={(e) => setTt({ ...tt, sheet: e.target.value })}
                className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
              >
                {tt.sheets.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          )}

          {thieu.length > 0 ? (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-red-700">
              Tệp mới <strong>thiếu {thieu.length} cột</strong> đang dùng:{' '}
              {thieu.slice(0, 6).join(', ')}
              {thieu.length > 6 ? '…' : ''}. Mô hình và báo cáo gọi tên những cột này, nên thay bằng
              tệp thiếu chúng sẽ làm biểu đồ hỏng.
            </p>
          ) : (
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-800">
              Đủ {cotCu.length} cột đang dùng.
              {them.length > 0 &&
                ` Có thêm ${them.length} cột mới: ${them.slice(0, 4).join(', ')}.`}
            </p>
          )}

          <p className="text-xs leading-snug text-slate-500">
            Dữ liệu đang có sẽ bị thay hoàn toàn bằng nội dung tệp này. Không có đường lùi.
          </p>
        </div>
      )}
    </Modal>
  );
}

/**
 * Tên cột của một sheet trong kết quả phân tích.
 *
 * `sourceName` — tên ĐỌC TỪ TỆP, đúng thứ `buildColumns` lấy làm `name` của cột
 * khi chốt. So với tên nào khác là so hai danh sách khác nhau rồi kết luận
 * thiếu/thừa sai.
 */
function cotCuaSheet(phanTich: AnalyzeResultDto, sheet: string): string[] {
  return phanTich.sheets.find((s) => s.name === sheet)?.columns.map((c) => c.sourceName) ?? [];
}
