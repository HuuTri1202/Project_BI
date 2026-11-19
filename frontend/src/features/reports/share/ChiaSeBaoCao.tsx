import type { ReportShareDto } from '@bi/shared';
import { useEffect, useState } from 'react';

import { Button } from '../../../components/ui/Button';
import { Modal } from '../../../components/ui/Modal';
import { getApiError } from '../../../services/apiClient';
import { docLienKet, taoLienKet, thuHoiLienKet } from './api';

/**
 * Hộp "Chia sẻ báo cáo" — mong muốn D5.
 *
 * ═══ Hai thứ hộp này phải nói ra, không được để người dùng tự đoán ═════════
 *
 *   1. Ai mở liên kết cũng xem được, KHÔNG cần tài khoản. Đó là cả điểm của
 *      tính năng, và cũng là rủi ro của nó — một người gửi liên kết vào nhóm
 *      Zalo công ty cần hiểu rằng ai trong nhóm cũng đọc được số liệu.
 *   2. Chuỗi chỉ hiện MỘT lần. Database giữ băm (migration 45), nên không có
 *      đường nào đọc lại. Không nói ra thì người dùng đóng hộp rồi đi tìm.
 */
export function ChiaSeBaoCao({ reportId }: { reportId: number }): React.ReactElement {
  const [mo, setMo] = useState(false);

  return (
    <>
      <Button onClick={() => setMo(true)}>Chia sẻ</Button>
      {mo && <HopChiaSe reportId={reportId} onClose={() => setMo(false)} />}
    </>
  );
}

const HAN = [
  { nhan: '7 ngày', soNgay: 7 },
  { nhan: '30 ngày', soNgay: 30 },
  { nhan: 'Không hết hạn', soNgay: null },
] as const;

function HopChiaSe({
  reportId,
  onClose,
}: {
  reportId: number;
  onClose: () => void;
}): React.ReactElement {
  const [items, setItems] = useState<ReportShareDto[] | null>(null);
  const [soNgay, setSoNgay] = useState<number | null>(7);
  const [urlMoi, setUrlMoi] = useState<string | null>(null);
  const [daChep, setDaChep] = useState(false);
  const [loi, setLoi] = useState<string | null>(null);
  const [dangChay, setDangChay] = useState(false);

  async function nap(): Promise<void> {
    try {
      setItems(await docLienKet(reportId));
    } catch (err) {
      setLoi(getApiError(err).message);
    }
  }

  useEffect(() => {
    void nap();
    // `reportId` không đổi trong suốt đời của hộp này (hộp mở trên một báo cáo).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function tao(): Promise<void> {
    setLoi(null);
    setDangChay(true);
    try {
      const kq = await taoLienKet(reportId, soNgay);
      setUrlMoi(kq.url);
      setDaChep(false);
      await nap();
    } catch (err) {
      setLoi(getApiError(err).message);
    } finally {
      setDangChay(false);
    }
  }

  async function thuHoi(id: number): Promise<void> {
    setLoi(null);
    try {
      await thuHoiLienKet(reportId, id);
      // Liên kết vừa thu hồi có thể CHÍNH LÀ liên kết đang hiện ở trên. Giữ nó
      // lại trên màn hình là mời người dùng đi gửi một đường dẫn đã chết.
      setUrlMoi(null);
      await nap();
    } catch (err) {
      setLoi(getApiError(err).message);
    }
  }

  async function chep(url: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      setDaChep(true);
    } catch {
      // Trình duyệt chặn clipboard (ngữ cảnh không bảo mật, hoặc người dùng từ
      // chối). Ô input vẫn `readOnly` và chọn được, nên còn đường chép tay.
      setDaChep(false);
    }
  }

  const conSong = (items ?? []).filter((i) => i.revokedAt === null);

  return (
    <Modal open onClose={onClose} title="Chia sẻ báo cáo bằng liên kết">
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Ai có liên kết cũng xem được báo cáo này, <strong>không cần tài khoản</strong>. Họ chỉ xem
          — không sửa được gì, và không thấy dữ liệu nào khác của tổ chức.
        </p>

        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-700">Liên kết sống trong</span>
            <select
              value={soNgay === null ? 'vinh-vien' : String(soNgay)}
              onChange={(e) =>
                setSoNgay(e.target.value === 'vinh-vien' ? null : Number(e.target.value))
              }
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
            >
              {HAN.map((h) => (
                <option key={h.nhan} value={h.soNgay === null ? 'vinh-vien' : String(h.soNgay)}>
                  {h.nhan}
                </option>
              ))}
            </select>
          </label>
          <Button variant="primary" disabled={dangChay} onClick={() => void tao()}>
            {dangChay ? 'Đang tạo…' : 'Tạo liên kết'}
          </Button>
        </div>

        {loi !== null && (
          <p role="alert" className="rounded-lg bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
            {loi}
          </p>
        )}

        {urlMoi !== null && (
          <div className="rounded-lg border border-brand-200 bg-brand-50 p-3.5">
            <p className="text-sm font-medium text-brand-900">
              Liên kết đã tạo — chép lại ngay bây giờ
            </p>
            {/* Nói ra, vì nó là một giới hạn thật: băm một chiều, không đọc lại
                được. Người dùng đóng hộp mà chưa chép là phải tạo cái mới. */}
            <p className="mt-0.5 text-xs text-brand-700">
              Hệ thống không lưu lại đường dẫn này, nên đóng hộp là không xem lại được.
            </p>
            <div className="mt-2 flex gap-2">
              <input
                readOnly
                value={urlMoi}
                aria-label="Đường dẫn chia sẻ"
                onFocus={(e) => e.currentTarget.select()}
                className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-800"
              />
              <Button onClick={() => void chep(urlMoi)}>{daChep ? 'Đã chép' : 'Chép'}</Button>
            </div>
          </div>
        )}

        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            Liên kết đang hoạt động ({conSong.length})
          </h3>
          {items === null ? (
            <p className="mt-2 text-sm text-slate-500">Đang tải…</p>
          ) : conSong.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">Chưa có liên kết nào đang hoạt động.</p>
          ) : (
            <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
              {conSong.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-3 px-3.5 py-2.5">
                  <span className="min-w-0 flex-1 text-sm text-slate-700">
                    Tạo {new Date(i.createdAt).toLocaleDateString('vi-VN')}
                    {i.createdByName === null ? '' : ' bởi ' + i.createdByName}
                    <span className="mt-0.5 block text-xs text-slate-500">
                      {i.expiresAt === null
                        ? 'Không hết hạn'
                        : 'Hết hạn ' + new Date(i.expiresAt).toLocaleDateString('vi-VN')}
                      {' · '}
                      {/* Câu trả lời cho câu hỏi đầu tiên người chia sẻ hỏi:
                          "kế toán xem chưa?" */}
                      {i.viewCount === 0 ? 'chưa ai mở' : 'đã mở ' + String(i.viewCount) + ' lần'}
                    </span>
                  </span>
                  <Button size="sm" onClick={() => void thuHoi(i.id)}>
                    <span className="text-red-600">Thu hồi</span>
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
