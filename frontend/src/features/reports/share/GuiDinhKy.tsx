import {
  TAN_SUAT,
  TAN_SUAT_LABELS,
  THU_LABELS,
  type ReportScheduleDto,
  type TanSuat,
} from '@bi/shared';
import { useEffect, useState } from 'react';

import { Button } from '../../../components/ui/Button';
import { Modal } from '../../../components/ui/Modal';
import { getApiError } from '../../../services/apiClient';
import { docLich, doiTrangThaiLich, taoLich, xoaLich } from './api';

/**
 * Hộp "Gửi định kỳ" — mong muốn D6.
 *
 * "Chủ shop muốn nhận số sáng thứ Hai, không muốn mở app." Nên mặc định của hộp
 * này là ĐÚNG câu đó: hằng tuần, Thứ Hai, 8 giờ.
 *
 * Người nhận gõ tay nhưng chỉ thành viên tổ chức được chấp nhận — luật cưỡng
 * chế ở backend (`emailDinhKy.locNguoiNhan`), và câu lỗi của nó đã nói đích
 * danh địa chỉ bị từ chối cùng đường đi đúng cho người ngoài (liên kết chia
 * sẻ). Nên ở đây KHÔNG dựng lại luật đó bằng một bộ chọn thành viên: hai nơi
 * cùng quyết định "ai được nhận" là hai nơi sẽ lệch nhau.
 */
export function GuiDinhKy({ reportId }: { reportId: number }): React.ReactElement {
  const [mo, setMo] = useState(false);

  return (
    <>
      <Button onClick={() => setMo(true)}>Gửi định kỳ</Button>
      {mo && <HopLich reportId={reportId} onClose={() => setMo(false)} />}
    </>
  );
}

const GIO = Array.from({ length: 24 }, (_, i) => i);

function HopLich({
  reportId,
  onClose,
}: {
  reportId: number;
  onClose: () => void;
}): React.ReactElement {
  const [items, setItems] = useState<ReportScheduleDto[] | null>(null);
  const [tanSuat, setTanSuat] = useState<TanSuat>('hang-tuan');
  const [gio, setGio] = useState(8);
  const [thu, setThu] = useState(1);
  const [ngay, setNgay] = useState(1);
  const [nguoiNhan, setNguoiNhan] = useState('');
  const [loi, setLoi] = useState<string | null>(null);
  const [dangChay, setDangChay] = useState(false);

  async function nap(): Promise<void> {
    try {
      setItems(await docLich(reportId));
    } catch (err) {
      setLoi(getApiError(err).message);
    }
  }

  useEffect(() => {
    void nap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function tao(): Promise<void> {
    setLoi(null);
    setDangChay(true);
    try {
      await taoLich(reportId, {
        tanSuat,
        gio,
        thu: tanSuat === 'hang-tuan' ? thu : null,
        ngay: tanSuat === 'hang-thang' ? ngay : null,
        // Tách bằng dấu phẩy HOẶC khoảng trắng: người dùng dán một danh sách từ
        // chỗ khác thì nó đến bằng cả hai kiểu.
        nguoiNhan: nguoiNhan
          .split(/[,\s]+/)
          .map((e) => e.trim())
          .filter((e) => e !== ''),
      });
      setNguoiNhan('');
      await nap();
    } catch (err) {
      setLoi(getApiError(err).message);
    } finally {
      setDangChay(false);
    }
  }

  async function doi(id: number, isActive: boolean): Promise<void> {
    setLoi(null);
    try {
      await doiTrangThaiLich(reportId, id, isActive);
      await nap();
    } catch (err) {
      setLoi(getApiError(err).message);
    }
  }

  async function xoa(id: number): Promise<void> {
    setLoi(null);
    try {
      await xoaLich(reportId, id);
      await nap();
    } catch (err) {
      setLoi(getApiError(err).message);
    }
  }

  return (
    <Modal open onClose={onClose} title="Gửi báo cáo định kỳ qua email">
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Hệ thống gửi số liệu của báo cáo này vào hộp thư, theo lịch bạn đặt. Thư mang{' '}
          <strong>bảng số</strong> và một đường dẫn tới báo cáo — không có hình biểu đồ.
        </p>

        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-700">Tần suất</span>
            <select
              value={tanSuat}
              onChange={(e) => setTanSuat(e.target.value as TanSuat)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
            >
              {TAN_SUAT.map((t) => (
                <option key={t} value={t}>
                  {TAN_SUAT_LABELS[t]}
                </option>
              ))}
            </select>
          </label>

          {tanSuat === 'hang-tuan' && (
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-700">Thứ</span>
              <select
                value={thu}
                onChange={(e) => setThu(Number(e.target.value))}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
              >
                {[1, 2, 3, 4, 5, 6, 7].map((t) => (
                  <option key={t} value={t}>
                    {THU_LABELS[t]}
                  </option>
                ))}
              </select>
            </label>
          )}

          {tanSuat === 'hang-thang' && (
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-700">Ngày</span>
              <select
                value={ngay}
                onChange={(e) => setNgay(Number(e.target.value))}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
              >
                {Array.from({ length: 28 }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    Ngày {n}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-700">Giờ</span>
            <select
              value={gio}
              onChange={(e) => setGio(Number(e.target.value))}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
            >
              {GIO.map((g) => (
                <option key={g} value={g}>
                  {String(g).padStart(2, '0')}:00
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">
            Người nhận — email của thành viên trong tổ chức
          </span>
          <input
            value={nguoiNhan}
            onChange={(e) => setNguoiNhan(e.target.value)}
            placeholder="mai@congty.vn, hung@congty.vn"
            className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
          />
          {/* Nói giới hạn NGAY tại ô nhập, không đợi câu lỗi từ máy chủ. */}
          <span className="mt-1 block text-xs text-slate-500">
            Người ngoài tổ chức (kế toán thuê ngoài, chủ đầu tư) thì dùng “Chia sẻ” — liên kết không
            cần hộp thư và thu hồi được.
          </span>
        </label>

        <Button variant="primary" disabled={dangChay} onClick={() => void tao()}>
          {dangChay ? 'Đang lưu…' : 'Đặt lịch'}
        </Button>

        {loi !== null && (
          <p role="alert" className="rounded-lg bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
            {loi}
          </p>
        )}

        <div>
          <h3 className="text-sm font-semibold text-slate-900">Lịch đã đặt</h3>
          {items === null ? (
            <p className="mt-2 text-sm text-slate-500">Đang tải…</p>
          ) : items.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">Chưa có lịch nào.</p>
          ) : (
            <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
              {items.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-3 px-3.5 py-2.5">
                  <span className="min-w-0 flex-1 text-sm text-slate-700">
                    {TAN_SUAT_LABELS[l.tanSuat]}
                    {l.thu === null ? '' : `, ${THU_LABELS[l.thu] ?? ''}`}
                    {l.ngay === null ? '' : `, ngày ${String(l.ngay)}`} lúc{' '}
                    {String(l.gio).padStart(2, '0')}:00
                    <span className="mt-0.5 block text-xs text-slate-500">
                      {l.nguoiNhan.join(', ')}
                      {' · '}
                      {l.isActive
                        ? `lần tới ${new Date(l.nextRunAt).toLocaleString('vi-VN')}`
                        : 'đang tắt'}
                    </span>
                    {/* Lỗi lần gửi gần nhất phải HIỆN RA: không có nó, người
                        dùng chỉ biết là thư không tới và không biết vì sao. */}
                    {l.lastError !== null && (
                      <span className="mt-0.5 block text-xs text-red-600">
                        Lần gửi gần nhất lỗi: {l.lastError}
                      </span>
                    )}
                  </span>
                  <Button size="sm" onClick={() => void doi(l.id, !l.isActive)}>
                    {l.isActive ? 'Tắt' : 'Bật'}
                  </Button>
                  <Button size="sm" onClick={() => void xoa(l.id)}>
                    <span className="text-red-600">Xoá</span>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}
