import type { ExplorerQueryDto } from '@bi/shared';
import { describe, expect, it } from 'vitest';

import type { TruongChon } from '../src/services/chat/datCauHoi';
import { goiYTiep } from '../src/services/chat/goiYTiep';

/**
 * Câu hỏi TIẾP, sinh từ form vừa chạy — §chat.
 *
 * ═══ Bộ này canh gì ════════════════════════════════════════════════════════
 *
 * Một gợi ý sai đắt hơn là không gợi ý, và nó sai được theo đúng ba kiểu:
 *
 *   1. **Mời lại thứ vừa hỏi.** Người dùng đọc "top 5 Sản phẩm theo Doanh thu"
 *      ngay dưới câu trả lời của đúng câu đó thì họ tưởng mình đọc sai kết quả.
 *   2. **Mời một thứ mô hình này không làm được.** "Doanh thu theo tháng" trên
 *      một mô hình không có cột ngày, hay "trung bình" trên một thước đo không
 *      nhận trung bình — bấm vào là nhận "chưa hiểu". Một nút dẫn tới bế tắc
 *      tệ hơn không có nút.
 *   3. **Mời sai hướng.** Vừa xem bảng giảm dần thì câu tiếp là "cái nào thấp
 *      nhất", không phải "cái nào cao nhất".
 */

const TRUONG: TruongChon[] = [
  { id: 21, nhan: 'Doanh thu', loai: 'thuoc do', phepGop: ['sum', 'avg'] },
  { id: 22, nhan: 'Số đơn', loai: 'thuoc do', phepGop: ['count'] },
  { id: 11, nhan: 'Sản phẩm (bảng Products)', loai: 'chieu' },
  { id: 13, nhan: 'Ngày đặt (bảng Orders)', loai: 'chieu', thoiGian: true },
];

/** Cùng bộ trường nhưng KHÔNG có cột ngày nào. */
const KHONG_NGAY = TRUONG.filter((t) => t.thoiGian !== true);

const CO_BAN: ExplorerQueryDto = { dimensionIds: [11], measureIds: [21] };

describe('Gợi ý sinh ra', () => {
  /** Nhãn bỏ "(bảng X)" — câu gợi ý là câu người ta sẽ gõ, không phải tên kỹ thuật. */
  it('gọi tên trường bằng nhãn gọn, không kèm tên bảng', () => {
    const ra = goiYTiep(CO_BAN, TRUONG, 'desc');

    expect(ra.join(' | ')).not.toContain('bảng Products');
    expect(ra[0]).toBe('Sản phẩm nào Doanh thu thấp nhất');
  });

  /** ⚠️ Kiểu sai số 3. */
  it('bảng đang GIẢM thì mời xem thấp nhất, và ngược lại', () => {
    expect(goiYTiep(CO_BAN, TRUONG, 'desc')[0]).toContain('thấp nhất');
    expect(goiYTiep(CO_BAN, TRUONG, 'asc')[0]).toContain('cao nhất');
  });

  it('mời cắt top khi form chưa cắt', () => {
    expect(goiYTiep(CO_BAN, TRUONG, 'desc')).toContain('top 5 Sản phẩm theo Doanh thu');
  });

  /** ⚠️ Kiểu sai số 1. */
  it('form ĐÃ cắt thì không mời cắt nữa', () => {
    const ra = goiYTiep({ ...CO_BAN, limit: 3 }, TRUONG, 'desc');
    expect(ra.some((c) => c.startsWith('top 5'))).toBe(false);
  });

  it('mời gom theo tháng khi mô hình có cột ngày', () => {
    expect(goiYTiep(CO_BAN, TRUONG, 'desc')).toContain('Doanh thu theo tháng');
  });

  /*
   * ⚠️ Kiểu sai số 2 — và là ca quan trọng nhất của bộ này.
   *
   * Mời gom theo tháng trên một mô hình không có cột ngày là mời người dùng
   * bấm vào một câu "chưa hiểu". `kiemForm` sẽ bỏ cả form vì `thoiGian`
   * không đúng, nên nút đó KHÔNG BAO GIỜ chạy được.
   */
  it('mô hình KHÔNG có cột ngày thì không mời gom theo tháng', () => {
    const ra = goiYTiep(CO_BAN, KHONG_NGAY, 'desc');
    expect(ra.some((c) => c.includes('theo tháng'))).toBe(false);
  });

  it('form đã gom theo thời gian thì không mời gom nữa', () => {
    const ra = goiYTiep(
      { ...CO_BAN, timeDimension: { dimensionId: 13, granularity: 'month' } },
      TRUONG,
      'desc',
    );
    expect(ra.some((c) => c.includes('theo tháng'))).toBe(false);
  });

  /*
   * ⚠️ Kiểu sai số 2 lần nữa, ở ô phép gộp.
   *
   * `limit: 3` KHÔNG phải trang trí: không có nó thì ba gợi ý đứng trước đã
   * chiếm hết trần, và bài này xanh vì gợi ý trung bình bị CẮT chứ không vì nó
   * bị chặn. Vòng đột biến bắt đúng chỗ đó — bỏ phép kiểm `phepGop` đi mà bài
   * vẫn xanh.
   */
  it('thước đo KHÔNG nhận trung bình thì không mời tính trung bình', () => {
    // `Số đơn` chỉ nhận `count` — xem `TRUONG`.
    const ra = goiYTiep({ dimensionIds: [11], measureIds: [22], limit: 3 }, TRUONG, 'desc');

    expect(ra.some((c) => c.includes('trung bình'))).toBe(false);
    // Và có chỗ trống thật: nếu danh sách đã đầy thì bài trên vô nghĩa.
    expect(ra.length).toBeLessThan(3);
  });

  it('thước đo nhận trung bình thì có mời, khi form chưa đổi phép', () => {
    // Bỏ hai gợi ý đứng trước để nó lọt vào trần 3.
    const ra = goiYTiep({ ...CO_BAN, limit: 3 }, TRUONG, 'desc');
    expect(ra).toContain('Doanh thu trung bình theo Sản phẩm');
  });

  it('form đã đổi phép gộp thì không mời đổi nữa', () => {
    const ra = goiYTiep(
      { ...CO_BAN, limit: 3, measureAggs: [{ id: 21, agg: 'avg' }] },
      TRUONG,
      'desc',
    );
    expect(ra.some((c) => c.includes('trung bình'))).toBe(false);
  });
});

describe('Khi không có gì đáng gợi ý', () => {
  /*
   * Không thước đo thì cả bốn gợi ý đều vô nghĩa: không có gì để xếp hạng, để
   * cắt top, hay để gộp. Trả về rỗng là đúng — panel chỉ vẽ khối gợi ý khi
   * danh sách không rỗng.
   */
  it('form không có thước đo nào -> rỗng', () => {
    expect(goiYTiep({ dimensionIds: [11], measureIds: [] }, TRUONG, 'desc')).toEqual([]);
  });

  it('form không có chiều nào thì bỏ mấy gợi ý cần chiều', () => {
    const ra = goiYTiep({ dimensionIds: [], measureIds: [21] }, TRUONG, 'desc');

    expect(ra.some((c) => c.includes('nào'))).toBe(false);
    expect(ra.some((c) => c.startsWith('top 5'))).toBe(false);
    // Nhưng hai gợi ý không cần chiều thì vẫn còn.
    expect(ra).toContain('Doanh thu theo tháng');
    expect(ra).toContain('Doanh thu trung bình');
  });

  /** Trần 3: dài hơn thì nó thành một cái thực đơn chứ không phải gợi ý. */
  it('cắt ở 3 gợi ý', () => {
    expect(goiYTiep(CO_BAN, TRUONG, 'desc').length).toBeLessThanOrEqual(3);
  });
});
