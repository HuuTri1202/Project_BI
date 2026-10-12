import { useState } from 'react';

import { KHONG_XUAT } from '../../services/danhDauXuat';
import { useNguCanh } from './nguCanh';
import type { Nguon } from './nguCanh';
import { traLoi } from './traLoi';

/**
 * Khung hỏi đáp nổi ở góc dưới-phải.
 *
 * ═══ Vì sao KHÔNG dùng `components/ui/Modal` ═══════════════════════════════
 *
 * `Modal` dựng trên `<dialog>` + `showModal()`, nên nó khoá phần còn lại của
 * trang: nền thành `inert`, Esc đóng, tiêu điểm bị giam. Với một hộp thoại xác
 * nhận thì đó đúng là thứ cần. Ở đây thì nó che mất chính cái biểu đồ, cái bảng
 * mà người ta đang hỏi về — tức là lấy đi thứ duy nhất giúp họ kiểm lại câu trả
 * lời. Nên đây là một hộp `fixed` thường, và trang vẫn đọc được, vẫn cuộn được.
 *
 * ═══ Vì sao `KHONG_XUAT` ═══════════════════════════════════════════════════
 *
 * Trang báo cáo xuất được ra PNG/PDF, và việc chụp quét cả vùng. Thiếu dấu này
 * thì mọi tệp xuất ra đều có một khung chat dán ở góc. Xem `services/danhDauXuat`.
 *
 * ═══ Khung tự ẩn khi trang chưa khai gì ════════════════════════════════════
 *
 * Trang nào chưa có hàm khai ngữ cảnh thì không có nguồn nào, và một khung mở ra
 * để trả lời "tôi không biết gì về trang này" thì tệ hơn là không có khung. Nó
 * sẽ tự hiện khi trang đó được khai.
 */
export function HoiDapPanel(): React.ReactElement | null {
  const nguCanh = useNguCanh();
  const [mo, setMo] = useState(false);
  const [chon, setChon] = useState(0);
  const [cauHoi, setCauHoi] = useState('');
  const [daHoi, setDaHoi] = useState<{ hoi: string; cau: string | null } | null>(null);

  if (nguCanh.nguon.length === 0) return null;

  // Nguồn có thể biến mất khi số liệu nạp lại (một ô bị xoá, danh sách lọc
  // khác đi), nên chỉ số đã chọn có thể trỏ ra ngoài mảng. Rơi về nguồn đầu
  // thay vì vẽ ra một khung trống không giải thích được.
  const nguon: Nguon = nguCanh.nguon[chon] ?? nguCanh.nguon[0]!;

  function hoi(): void {
    const q = cauHoi.trim();
    if (q === '') return;
    const kq = traLoi(nguon, q);
    setDaHoi({ hoi: q, cau: kq?.cau ?? null });
    setCauHoi('');
  }

  if (!mo) {
    return (
      <button
        type="button"
        {...KHONG_XUAT}
        onClick={() => setMo(true)}
        aria-label="Mở khung hỏi đáp về dữ liệu đang xem"
        title="Hỏi về dữ liệu đang xem"
        className="fixed right-4 bottom-4 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-brand-600 text-white shadow-lg transition-colors hover:bg-brand-700"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          className="h-6 w-6"
          aria-hidden="true"
        >
          <path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.3 9 9 0 0 1-3.8-.8L3 21l1.9-5a8.2 8.2 0 0 1-.9-3.7A8.4 8.4 0 0 1 12.5 4 8.4 8.4 0 0 1 21 11.5Z" />
        </svg>
      </button>
    );
  }

  return (
    <section
      {...KHONG_XUAT}
      aria-label="Hỏi đáp về dữ liệu đang xem"
      className="fixed right-4 bottom-4 z-50 flex max-h-[32rem] w-[22rem] flex-col rounded-xl border border-slate-200 bg-white shadow-2xl"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-slate-200 px-3 py-2">
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">
          Hỏi về {nguCanh.trang}
        </p>
        <button
          type="button"
          onClick={() => setMo(false)}
          aria-label="Thu khung hỏi đáp"
          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            className="h-4 w-4"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </header>

      {/* Một nguồn thì không có gì để chọn, và một dãy chip có đúng một chip chỉ
          chiếm chỗ mà không nói thêm điều gì. */}
      {nguCanh.nguon.length > 1 && (
        <div className="flex shrink-0 flex-wrap gap-1 border-b border-slate-100 px-3 py-2">
          {nguCanh.nguon.map((n, i) => (
            <button
              key={n.ten}
              type="button"
              aria-pressed={i === chon}
              onClick={() => {
                setChon(i);
                // Xoá câu trả lời cũ: nó nói về nguồn KHÁC, và để nó nằm lại
                // dưới một chip vừa đổi là mời người đọc gán nó cho nguồn mới.
                setDaHoi(null);
              }}
              className={`max-w-full truncate rounded-full border px-2 py-0.5 text-xs ${
                i === chon
                  ? 'border-brand-500 bg-brand-50 font-medium text-brand-700'
                  : 'border-slate-200 text-slate-500 hover:bg-slate-50'
              }`}
            >
              {n.ten}
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 text-sm">
        {daHoi === null ? (
          <CauMau nguon={nguon} onChon={setCauHoi} />
        ) : (
          <>
            <p className="mb-2 text-right">
              <span className="inline-block rounded-lg bg-slate-100 px-2.5 py-1.5 text-slate-700">
                {daHoi.hoi}
              </span>
            </p>
            {daHoi.cau === null ? (
              <div role="status" className="text-slate-600">
                <p className="mb-2">
                  Tôi chưa hiểu câu này. Tôi chỉ trả lời bằng số liệu đang có trên {nguCanh.trang} —
                  không tra ở đâu khác.
                </p>
                <CauMau nguon={nguon} onChon={setCauHoi} />
              </div>
            ) : (
              <p className="whitespace-pre-line text-slate-800">{daHoi.cau}</p>
            )}
          </>
        )}
      </div>

      <form
        className="flex shrink-0 items-center gap-2 border-t border-slate-200 p-2"
        onSubmit={(e) => {
          e.preventDefault();
          hoi();
        }}
      >
        <input
          value={cauHoi}
          onChange={(e) => setCauHoi(e.target.value)}
          placeholder="Hỏi về số liệu đang xem…"
          aria-label="Câu hỏi"
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
        />
        <button
          type="submit"
          disabled={cauHoi.trim() === ''}
          className="shrink-0 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:bg-slate-200 disabled:text-slate-400"
        >
          Hỏi
        </button>
      </form>
    </section>
  );
}

/**
 * Câu mẫu — sinh từ CHÍNH nguồn đang chọn, không phải một danh sách cố định.
 *
 * Đây là chỗ nói ra năng lực thật của khung. Một danh sách viết cứng sẽ gợi ý
 * "khu vực nào cao nhất" trên một trang không có biểu đồ nào, tức là dạy người
 * dùng hỏi những câu chắc chắn nhận về "tôi chưa hiểu".
 */
function CauMau({
  nguon,
  onChon,
}: {
  nguon: Nguon;
  onChon: (q: string) => void;
}): React.ReactElement {
  const mau =
    nguon.bang !== undefined
      ? [
          `${nguon.bang.dimensionLabel} nào cao nhất?`,
          `Tổng ${nguon.bang.measureLabel} là bao nhiêu?`,
          `Top 3 ${nguon.bang.dimensionLabel}`,
          `Có mấy ${nguon.bang.dimensionLabel}?`,
        ]
      : nguon.duKien.slice(0, 4).map((d) => `${d.nhan}?`);

  return (
    <div>
      <p className="mb-1.5 text-xs text-slate-400">Thử hỏi:</p>
      <ul className="space-y-1">
        {mau.map((q) => (
          <li key={q}>
            <button
              type="button"
              onClick={() => onChon(q)}
              className="hover:border-brand-300 w-full rounded-lg border border-slate-200 px-2 py-1 text-left text-xs text-slate-600 hover:bg-brand-50"
            >
              {q}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
