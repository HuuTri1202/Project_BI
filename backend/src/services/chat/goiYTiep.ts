import type { ExplorerQueryDto } from '@bi/shared';

import type { TruongChon } from './datCauHoi';

const TRAN = 3;

export function goiYTiep(
  truyVan: ExplorerQueryDto,
  truong: readonly TruongChon[],
  huong: 'asc' | 'desc',
): string[] {
  const nhan = new Map(truong.map((t) => [t.id, t.nhan]));
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
