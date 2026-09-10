import type { UsageItemDto } from '@bi/shared';

import { dinhDangDungLuong, dinhDangHanMuc, phanTramDaDung } from './format';

/**
 * Một dòng mức sử dụng: đã dùng bao nhiêu trên hạn mức của gói.
 *
 * ─── Con số đứng TRƯỚC cái thanh, không phải ngược lại ─────────────────────
 *
 * Thanh màu trả lời "tôi sắp hết chưa" trong nửa giây; con số trả lời "còn bao
 * nhiêu". Người dùng cần cả hai, nhưng chỉ con số là thứ họ đọc để ra quyết
 * định, nên nó phải luôn có mặt và luôn đọc được — kể cả khi ai đó xem bằng
 * chế độ tương phản cao và cái thanh biến mất.
 *
 * Đây cũng là lý do KHÔNG dùng riêng màu để báo sắp hết: cùng nguyên tắc đã ghi
 * cho `Badge` — "luôn có chữ, không bao giờ chỉ có màu".
 */

/** Ngưỡng đổi màu. 100% là đã vượt, không phải "vừa đủ". */
const NGUONG_CANH_BAO = 80;

function toneOf(percent: number, khongGioiHan: boolean): string {
  if (khongGioiHan) return 'bg-slate-300';
  if (percent >= 100) return 'bg-red-500';
  if (percent >= NGUONG_CANH_BAO) return 'bg-amber-500';
  return 'bg-brand-600';
}

export function UsageBar({
  label,
  item,
  /** Đổi cách viết con số sang KB/MB/GB. */
  storage = false,
}: {
  label: string;
  item: UsageItemDto;
  storage?: boolean;
}): React.ReactElement {
  const khongGioiHan = item.limit === null;
  const percent = phanTramDaDung(item.used, item.limit);
  const daDung = storage ? dinhDangDungLuong(item.used) : item.used.toLocaleString('vi-VN');

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="text-slate-700">{label}</span>
        <span className="tabular-nums text-slate-500">
          <strong className="text-slate-900">{daDung}</strong>
          {' / '}
          {dinhDangHanMuc(item.limit, storage)}
        </span>
      </div>

      {/*
        `role="progressbar"` kèm ba thuộc tính aria: trình đọc màn hình đọc ra
        "đã dùng 3 trên 5" thay vì bỏ qua hoàn toàn một cái div màu.

        Gói không giới hạn thì thanh để trống chứ KHÔNG vẽ đầy — vẽ đầy là báo
        hiệu "sắp hết" cho đúng người trả nhiều tiền nhất.
      */}
      <div
        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100"
        role="progressbar"
        aria-label={label}
        aria-valuenow={khongGioiHan ? 0 : percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={khongGioiHan ? `${daDung}, không giới hạn` : `${String(percent)}%`}
      >
        <div
          className={`h-full rounded-full transition-[width] ${toneOf(percent, khongGioiHan)}`}
          style={{ width: khongGioiHan ? '0%' : `${String(percent)}%` }}
        />
      </div>

      {/* Vượt hạn mức phải nói bằng CHỮ. Hạn mức đợt này chỉ hiển thị chứ không
          chặn, nên nếu chỉ đổi màu thanh thì người dùng không biết chuyện gì
          đang xảy ra và cũng không biết có phải làm gì không. */}
      {!khongGioiHan && percent >= 100 && (
        <p className="mt-1 text-xs text-red-700">
          Đã vượt hạn mức của gói. Bạn vẫn dùng được bình thường — nâng gói để có thêm chỗ.
        </p>
      )}
    </div>
  );
}
