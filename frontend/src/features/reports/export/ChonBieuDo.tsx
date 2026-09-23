import { useState } from 'react';

import { Button } from '../../../components/ui/Button';
import { Modal } from '../../../components/ui/Modal';
import type { OXuat } from './chonO';

/**
 * Hộp "Xuất những biểu đồ nào?" — §10.23.
 *
 * ═══ Mặc định là CHỌN HẾT ═══════════════════════════════════════════════════
 *
 * Người bấm "Xuất" mà chưa nghĩ tới chuyện lọc thì bỏ chọn đâu cũng không bằng
 * bấm thẳng "Xuất" một cái nữa — nên hộp mở ra với mọi ô đã tích, và đường đi
 * cũ chỉ tốn thêm đúng một cú bấm. Mở ra với ô trống thì ngược lại: mỗi lần
 * xuất cả báo cáo là một lần đi tích mười hai cái hộp.
 *
 * Chọn hết cũng là trạng thái mà việc xuất đi ĐÚNG đường cũ (chụp cả khung,
 * giữ nguyên bố cục và chú thích). Bỏ bớt ô mới chuyển sang ghép từng ô — xem
 * `chupCacVung`. Nên mặc định này không chỉ tiện tay, nó còn giữ kết quả quen
 * thuộc cho người không quan tâm tới tính năng này.
 *
 * ═══ Không cho xuất ZERO biểu đồ ═══════════════════════════════════════════
 *
 * Bỏ hết dấu tích thì nút xuất khoá lại. Một tệp PDF chỉ có dải tiêu đề và một
 * khoảng trắng không phải thứ ai định xin, và để nó tải về được là bắt người
 * dùng mở tệp ra mới biết mình bấm hụt.
 */
export function ChonBieuDo({
  danhSach,
  moTa,
  onHuy,
  onXuat,
}: {
  danhSach: readonly OXuat[];
  /** Tên định dạng sắp xuất, đúng chữ trên menu — "Ảnh PNG", "Bảng tính Excel". */
  moTa: string;
  onHuy: () => void;
  onXuat: (chon: ReadonlySet<string>) => void;
}): React.ReactElement {
  const [chon, setChon] = useState<ReadonlySet<string>>(() => new Set(danhSach.map((o) => o.khoa)));

  const doi = (khoa: string): void => {
    const sau = new Set(chon);
    if (!sau.delete(khoa)) sau.add(khoa);
    setChon(sau);
  };

  const het = chon.size === danhSach.length;

  /*
   * Gom theo trang ĐÚNG thứ tự gặp trong danh sách, không gom bằng `Map` rồi
   * duyệt lại: danh sách đã xếp theo thứ tự trang của báo cáo, và người dùng
   * tìm ô của mình bằng cách đối chiếu với các thẻ trang họ vừa nhìn.
   */
  const nhom: { ten: string | null; muc: OXuat[] }[] = [];
  for (const o of danhSach) {
    const cuoi = nhom.at(-1);
    if (cuoi !== undefined && cuoi.ten === o.tenTrang) cuoi.muc.push(o);
    else nhom.push({ ten: o.tenTrang, muc: [o] });
  }

  return (
    <Modal
      open
      onClose={onHuy}
      title="Xuất những biểu đồ nào?"
      description={`Bỏ dấu tích ở ô không cần. Định dạng: ${moTa}.`}
      footer={
        <>
          <Button onClick={onHuy}>Huỷ</Button>
          <Button variant="primary" disabled={chon.size === 0} onClick={() => onXuat(chon)}>
            {het ? `Xuất tất cả ${danhSach.length} biểu đồ` : `Xuất ${chon.size} biểu đồ`}
          </Button>
        </>
      }
    >
      <label className="flex items-center gap-2.5 border-b border-slate-100 pb-3 text-sm font-medium text-slate-800">
        <input
          type="checkbox"
          checked={het}
          // Tích một phần: không phải "chưa chọn gì", cũng không phải "chọn
          // hết". Thiếu dấu này thì ô tổng hiện trống y như lúc chưa ai đụng
          // vào, dù bên dưới đang có mười một ô được chọn.
          ref={(el) => {
            if (el !== null) el.indeterminate = !het && chon.size > 0;
          }}
          onChange={() => setChon(het ? new Set() : new Set(danhSach.map((o) => o.khoa)))}
          className="h-4 w-4 rounded border-slate-300 text-brand-600"
        />
        Chọn tất cả ({danhSach.length})
      </label>

      <div className="mt-3 space-y-3">
        {nhom.map((g) => (
          <div key={g.ten ?? ''}>
            {g.ten !== null && (
              <p className="mb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                {g.ten}
              </p>
            )}
            <ul className="space-y-0.5">
              {g.muc.map((o) => (
                <li key={o.khoa}>
                  <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={chon.has(o.khoa)}
                      onChange={() => doi(o.khoa)}
                      className="h-4 w-4 shrink-0 rounded border-slate-300 text-brand-600"
                    />
                    <span className="min-w-0 truncate" title={o.ten}>
                      {o.ten}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Modal>
  );
}
