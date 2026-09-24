import { useLayoutEffect, useState, type RefObject } from 'react';

/**
 * Hộp nổi mở ra từ một cái nút — đặt nó ở đâu theo CHIỀU DỌC.
 *
 * ═══ Vì sao có file này ═════════════════════════════════════════════════════
 *
 * Mọi menu trong ứng dụng đều mở xuống dưới nút, và mỗi cái tự nghĩ rằng dưới
 * nút thì lúc nào cũng còn chỗ. Đo được hai chỗ hỏng thật:
 *
 *   menu "⋮" dòng cuối bảng   thò xuống dưới đáy cửa sổ 72px, chỉ 2/4 mục
 *                             nhìn thấy được — và vì nó định vị `fixed`, cuộn
 *                             trang cũng không tới được, chỉ làm menu đóng lại
 *   "Tạo báo cáo" khung rỗng  cửa sổ cao 520px thì thò 17px, 440px thì thò 97px
 *
 * Hai chỗ đó dựng hộp bằng hai cách khác nhau (portal `fixed` với toạ độ tự
 * tính, và `absolute` với lớp CSS), nên không gộp được phần dựng. Thứ gộp được
 * là LUẬT: dưới nút nếu đủ chỗ, không thì lật lên trên. Để luật ở một chỗ thì
 * cái menu thứ ba được hưởng sẵn, thay vì lặp lại đúng lỗi này lần thứ ba.
 *
 * ═══ Vì sao phải đo sau khi dựng ════════════════════════════════════════════
 *
 * Chiều cao hộp chỉ biết sau khi nó có mặt trong DOM: số mục thay đổi theo
 * quyền của người dùng, và chữ trong mục thì xuống dòng theo bề ngang. Nên
 * không đoán trước được — phải dựng, đo, rồi dời. `useLayoutEffect` chạy TRƯỚC
 * lượt vẽ nên mắt không kịp thấy cú dời.
 */

/** Khoảng hở tối thiểu giữ với mép cửa sổ. */
export const LE_CUA_SO = 8;
/** Khe mặc định giữa nút và hộp. */
export const KHE_NEO = 4;

/**
 * @param neo     ô của cái nút (toạ độ theo cửa sổ)
 * @param cao     chiều cao hộp đã đo được
 * @param caoCuaSo `window.innerHeight`
 * @param khe     khe giữa nút và hộp, nếu nơi gọi dùng khoảng cách khác
 * @returns `top` theo toạ độ cửa sổ, và `len` = có phải lật lên trên không
 *
 * Thứ tự ưu tiên: dưới nút (chỗ mắt đang nhìn) → trên nút → ghim vào mép dưới
 * cửa sổ. Vế thứ ba dành cho cửa sổ quá thấp, nơi cả trên lẫn dưới đều không
 * đủ; lúc đó hộp rời khỏi nút một quãng, nhưng đọc được vẫn hơn mất một nửa.
 * Nơi dùng CSS thuần chỉ đọc `len` nên không có vế ba — hộp của họ cao
 * 140–160px, tức chỉ thua ở cửa sổ thấp hơn mọi cửa sổ có thật.
 */
export function choDatDoc(
  neo: DOMRect,
  cao: number,
  caoCuaSo: number,
  khe: number = KHE_NEO,
): { top: number; len: boolean } {
  const duoi = neo.bottom + khe;
  if (duoi + cao <= caoCuaSo - LE_CUA_SO) return { top: duoi, len: false };

  const tren = neo.top - khe - cao;
  if (tren >= LE_CUA_SO) return { top: tren, len: true };

  return { top: Math.max(LE_CUA_SO, caoCuaSo - LE_CUA_SO - cao), len: false };
}

/**
 * Bản dùng cho hộp `absolute`: chỉ cần biết lật hay không, rồi đổi lớp CSS.
 *
 * Trả `false` khi đóng để lần mở sau đo lại từ đầu — giữ nguyên `true` thì hộp
 * dựng ra đã nằm trên nút và phép đo đầu tiên nói về một chỗ khác.
 */
export function useDatDoc(
  mo: boolean,
  hopRef: RefObject<HTMLElement | null>,
  neoRef: RefObject<HTMLElement | null>,
): boolean {
  const [len, setLen] = useState(false);

  useLayoutEffect(() => {
    if (!mo) {
      setLen(false);
      return;
    }
    const hop = hopRef.current;
    const neo = neoRef.current;
    if (hop === null || neo === null) return;
    setLen(choDatDoc(neo.getBoundingClientRect(), hop.offsetHeight, window.innerHeight).len);
  }, [mo, hopRef, neoRef]);

  return len;
}
