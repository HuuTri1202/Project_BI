const KHOA = 'bi:chat:phien';

const BAN = 1;

const TRAN_TIN = 60;

export interface PhienChat {
  tinNhan: unknown[];
  demId: number;
  boiCanh: unknown;
}

export function ghiPhien(p: PhienChat): void {
  try {
    /*
     * Bỏ mấy tin ĐANG SOẠN.
     *
     * Một bong bóng ba chấm được ghi lại sẽ nhấp nháy mãi mãi sau khi tải
     * lại: lời gọi sinh ra nó đã chết cùng trang cũ, nên không còn gì tới để
     * thay nó. Câu hỏi của người dùng thì vẫn giữ — họ đã hỏi thật, và một
     * câu hỏi không có trả lời là mô tả đúng chuyện vừa xảy ra.
     */
    const xong = p.tinNhan.filter((t) => (t as { dangSoan?: unknown }).dangSoan !== true);

    sessionStorage.setItem(
      KHOA,
      JSON.stringify({
        ban: BAN,
        demId: p.demId,
        boiCanh: p.boiCanh,
        tinNhan: xong.slice(-TRAN_TIN),
      }),
    );
  } catch {
    // Xem khối chú thích đầu tệp: mất lịch sử là hậu quả duy nhất.
  }
}

export function docPhien(): PhienChat | null {
  try {
    const tho = sessionStorage.getItem(KHOA);
    if (tho === null) return null;

    const o = JSON.parse(tho) as {
      ban?: unknown;
      tinNhan?: unknown;
      demId?: unknown;
      boiCanh?: unknown;
    };
    if (o.ban !== BAN || !Array.isArray(o.tinNhan)) return null;

    return {
      tinNhan: o.tinNhan,
      demId: typeof o.demId === 'number' ? o.demId : 0,
      boiCanh: o.boiCanh ?? null,
    };
  } catch {
    // JSON hỏng (bị sửa tay, bị cắt giữa chừng) đọc ra như chưa có gì.
    return null;
  }
}

export function xoaPhien(): void {
  try {
    sessionStorage.removeItem(KHOA);
  } catch {
    // Không xoá được thì lần ghi sau cũng không ghi được. Không có gì để làm.
  }
}
