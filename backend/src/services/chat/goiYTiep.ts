import type { ExplorerQueryDto } from '@bi/shared';

import type { TruongChon } from './datCauHoi';

/**
 * Câu hỏi TIẾP, sinh từ cái form vừa chạy — §chat.
 *
 * ═══ Vấn đề ════════════════════════════════════════════════════════════════
 *
 * Khung chỉ gợi ý khi nó BẾ TẮC (`goiYGan`, `deXuatBieuDo`). Lúc trả lời được
 * thì nó im — mà đó mới là lúc người ta muốn đi tiếp. Người dùng vừa thấy
 * "Doanh thu theo Khu vực" ra số, và câu kế tiếp trong đầu họ gần như luôn là
 * một trong bốn thứ: đổi hướng, cắt top, gom theo thời gian, đổi phép tính.
 *
 * Cả bốn đều là **sửa một ô của form vừa chạy**, nên code sinh ra được chính
 * xác, không cần hỏi mô hình. Và câu sinh ra là câu người dùng CÓ THỂ SỬA
 * trước khi gửi, nên nó đi vào `goiY` (bấm để điền) chứ không phải `chonNguon`
 * (bấm là hỏi luôn).
 *
 * ═══ Vì sao ở BACKEND, không ở panel ══════════════════════════════════════
 *
 * Vì chỉ chỗ này có đủ ba thứ cùng lúc: cái form đã chạy, nhãn thật của từng
 * trường (đã qua `distinctFieldLabels`, nên nó đúng cái tên bảng số liệu đang
 * dùng), và danh sách phép gộp mà mỗi thước đo nhận. Panel có `nguCanh.truong`
 * nhưng không có hai thứ sau, nên nó sẽ gợi ý "trung bình" cho một thước đo
 * không nhận trung bình — một gợi ý bấm vào là "chưa hiểu".
 *
 * ⚠️ KHÔNG gợi ý thứ form đã có. Hỏi lại đúng câu vừa hỏi là một gợi ý tệ hơn
 * không gợi ý: nó làm người dùng tưởng mình đọc sai kết quả.
 */

/** Trần số gợi ý. Dài hơn thì nó thành một cái thực đơn chứ không phải gợi ý. */
const TRAN = 3;

export function goiYTiep(
  truyVan: ExplorerQueryDto,
  truong: readonly TruongChon[],
  /** Hướng đã sắp — xem `huongSap`. Quyết định nên mời đổi sang hướng nào. */
  huong: 'asc' | 'desc',
): string[] {
  const nhan = new Map(truong.map((t) => [t.id, t.nhan]));
  /** Nhãn gọn: bỏ "(bảng X)" cho câu đọc tự nhiên. Xem `hoiTrenMoHinh`. */
  const gon = (id: number): string => (nhan.get(id) ?? '').replace(/\s*\(bảng .*\)\s*$/, '');

  const chieu = truyVan.dimensionIds[0];
  const thuocDo = truyVan.measureIds[0];
  // Không có thước đo thì không có gì để xếp hạng hay gộp — bốn gợi ý dưới đây
  // đều vô nghĩa, và một gợi ý vô nghĩa đắt hơn là không gợi ý.
  if (thuocDo === undefined) return [];

  const ra: string[] = [];
  const do_ = gon(thuocDo);

  /*
   * 1. Đổi hướng. Đứng đầu vì nó là câu hỏi tiếp tự nhiên nhất sau một bảng
   *    xếp hạng — "thế cái nào ít nhất" — và vì nó là chỗ khung từng trả lời
   *    SAI, nên mời người dùng đi vào đó là mời họ kiểm chính chỗ đó.
   */
  if (chieu !== undefined) {
    ra.push(
      huong === 'desc' ? `${gon(chieu)} nào ${do_} thấp nhất` : `${gon(chieu)} nào ${do_} cao nhất`,
    );
  }

  // 2. Cắt top — chỉ khi form chưa cắt.
  if (chieu !== undefined && truyVan.limit === undefined) {
    ra.push(`top 5 ${gon(chieu)} theo ${do_}`);
  }

  /*
   * 3. Gom theo tháng — chỉ khi mô hình CÓ cột ngày và form chưa gom theo
   *    thời gian. Mời gom theo tháng trên một mô hình không có cột ngày là
   *    mời người dùng bấm vào một câu "chưa hiểu".
   */
  const coNgay = truong.some((t) => t.loai === 'chieu' && t.thoiGian === true);
  if (coNgay && truyVan.timeDimension === undefined) {
    ra.push(`${do_} theo tháng`);
  }

  // 4. Đổi phép gộp — chỉ khi thước đo THẬT SỰ nhận trung bình, và form chưa đổi.
  const nhanAvg = truong.find((t) => t.id === thuocDo)?.phepGop?.includes('avg') === true;
  if (nhanAvg && truyVan.measureAggs === undefined) {
    ra.push(`${do_} trung bình${chieu === undefined ? '' : ` theo ${gon(chieu)}`}`);
  }

  return ra.slice(0, TRAN);
}
