import { useEffect, useRef, useState } from 'react';

/**
 * Nhãn mã hạ tầng — tên bảng trong ClickHouse, khoá đối tượng trên MinIO.
 *
 * ─── Vì sao những mã này được bày ra màn hình ───────────────────────────────
 *
 * Chúng không phải thứ người dùng cuối cần. Nhưng chúng là câu trả lời duy nhất
 * cho "bộ dữ liệu tôi đang nhìn nằm ở đâu trong hạ tầng" — câu hỏi của người
 * vận hành lúc đối chiếu với giao diện MinIO hay lúc chạy một câu SQL thẳng vào
 * kho. Không bày ra thì cách duy nhất còn lại là tự ghép tên từ mã tổ chức và
 * mã bộ dữ liệu, và đó là chỗ người ta ghép sai rồi đi xoá nhầm bảng.
 *
 * ─── Vì sao là NÚT CHÉP chứ không phải một dòng chữ ─────────────────────────
 *
 * `raw_t4_d197` gõ lại được. `t4/w1/9f8a2c1e-…-446655440000.xlsx` thì không —
 * và đó chính là mã người ta cần dán vào ô tìm kiếm của MinIO. Bôi đen bằng
 * chuột một chuỗi 50 ký tự nằm trong một dải thông tin dày đặc là thao tác hay
 * trượt, nên chép bằng một cú bấm.
 *
 * Hai chỗ dùng nó bày hai loại mã dài ngắn khác hẳn nhau, nhưng CÙNG một hình
 * dạng: hai nhãn trông giống nhau mà một cái bấm được còn cái kia thì không là
 * thứ người dùng phải thử mới biết.
 */

/** Chữ "Đã chép" đứng lại bao lâu. Đủ để đọc, không đủ để quên là mình vừa bấm. */
const GIU_MS = 1500;

export function MaHaTang({
  ma,
  giaiThich,
}: {
  /** Chuỗi hiện ra và cũng là chuỗi được chép. */
  ma: string;
  /** Câu nói mã này là gì — vào `title` và vào nhãn cho trình đọc màn hình. */
  giaiThich: string;
}): React.ReactElement {
  const [daChep, setDaChep] = useState(false);
  const hen = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Dọn hẹn giờ khi rời trang: `setDaChep` sau khi component đã gỡ là một cảnh
  // báo trong console cho một việc không còn ai nhìn.
  useEffect(() => {
    return () => {
      if (hen.current !== null) clearTimeout(hen.current);
    };
  }, []);

  function chep(): void {
    // `catch` chứ không để Promise rơi tự do: clipboard bị từ chối khi trang
    // không chạy trên HTTPS hoặc người dùng đã chặn quyền — cùng lý do đã ghi ở
    // nút chép IP trong wizard kết nối.
    navigator.clipboard
      .writeText(ma)
      .then(() => {
        setDaChep(true);
        if (hen.current !== null) clearTimeout(hen.current);
        hen.current = setTimeout(() => setDaChep(false), GIU_MS);
      })
      .catch(() => setDaChep(false));
  }

  return (
    <button
      type="button"
      onClick={chep}
      title={`${giaiThich} — bấm để chép`}
      aria-label={`${giaiThich}: ${ma}. Bấm để chép.`}
      className="inline-flex max-w-full items-center gap-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 hover:bg-slate-200"
    >
      {/* `truncate` + `min-w-0`: khoá MinIO dài 50 ký tự và dải thông tin quanh
          nó thì hẹp. Chuỗi đầy đủ vẫn đọc được ở `title`, và vẫn được chép đủ. */}
      <code className="min-w-0 truncate">{ma}</code>
      {daChep && <span className="shrink-0 font-medium text-emerald-700">đã chép</span>}
    </button>
  );
}
