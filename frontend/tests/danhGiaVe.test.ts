import type { ChartType, ExplorerFieldDto, ExplorerFieldsDto } from '@bi/shared';
import { describe, expect, it } from 'vitest';

import { goiYBieuDo, tenDeXuat } from '../src/features/chat/goiYBieuDo';

/**
 * BỘ ĐÁNH GIÁ cho đường VẼ — "tui muốn xem X theo Y" ra đúng cặp trường nào.
 *
 * ═══ Vì sao nó phải tồn tại ════════════════════════════════════════════════
 *
 *   "có đảm bảo là chatbot đã hiểu mọi loại câu mà user hỏi khi yêu cầu vẽ
 *    chưa, cần cải thiện điểm gì"
 *
 * Câu trả lời đầu tiên là 10/30, và nó chỉ có nghĩa vì nó được ĐO. Không có bộ
 * này thì mọi cải tiến sau đó là cảm tính, và sửa chỗ này hỏng chỗ kia mà không
 * ai biết — đúng việc mà `danhGia.test.ts` đang làm cho đường hỏi-đáp.
 *
 * ═══ BA kết quả, không phải hai ════════════════════════════════════════════
 *
 *   ĐÚNG       đúng chiều, đúng thước đo, đúng loại biểu đồ
 *   CHƯA HIỂU  trả `null`, hoặc đúng cặp trường mà lệch loại biểu đồ
 *   SAI        trả về một CẶP TRƯỜNG KHÁC
 *
 * Chỉ SAI là nguy. Người dùng bấm "Vẽ" và nhận một biểu đồ ĐÚNG HÌNH, SAI SỐ
 * LIỆU — không có gì trên màn hình nói rằng khung đã hiểu nhầm, và không ai
 * kiểm lại một thứ trông bình thường. CHƯA HIỂU thì tự nó nói ra.
 *
 * Lệch LOẠI biểu đồ xếp vào CHƯA HIỂU chứ không phải SAI: số liệu vẫn đúng,
 * chỉ đọc khó hơn, và người dùng đổi loại bằng một cú bấm.
 *
 * ⚠️ Ca `moHinh: true` CỐ Ý nằm ngoài tầm lớp ngoại tuyến: "vùng", "miền",
 * "lãi", "revenue" là tên KHÁC với nhãn trường, và khối chú thích của
 * `DONG_NGHIA` đã ghi rõ vì sao khung không đoán tên trường của khách. Chúng
 * được đếm riêng và chỉ lớp mô hình mới với tới.
 */

const f = (x: Partial<ExplorerFieldDto>): ExplorerFieldDto =>
  ({ id: 1, label: 'X', datasetName: 'Đơn hàng', cubeType: 'string', ...x }) as ExplorerFieldDto;

/** Một mô hình bán hàng cỡ thật — ba bảng, năm chiều, ba thước đo. */
const MO_HINH: ExplorerFieldsDto = {
  dimensions: [
    f({ id: 1, label: 'Khu vực', datasetName: 'Khách hàng' }),
    f({ id: 2, label: 'Nhóm hàng', datasetName: 'Sản phẩm' }),
    f({ id: 3, label: 'Ngày đặt', datasetName: 'Đơn hàng', cubeType: 'time' }),
    f({ id: 4, label: 'Tên sản phẩm', datasetName: 'Sản phẩm' }),
    f({ id: 5, label: 'Trạng thái', datasetName: 'Đơn hàng' }),
  ],
  measures: [
    f({ id: 10, label: 'Doanh thu', cubeType: 'number' }),
    f({ id: 11, label: 'Số đơn', cubeType: 'number' }),
    f({ id: 12, label: 'Lợi nhuận', cubeType: 'number' }),
  ],
};

interface Ca {
  hoi: string;
  chieu: string;
  do: string;
  loai: ChartType;
  /** Ngoài tầm lớp ngoại tuyến — đếm riêng, xem khối chú thích đầu file. */
  moHinh?: true;
  /** Vì sao ca này đáng có mặt, khi nó không hiển nhiên. */
  vi?: string;
}

const CA: Ca[] = [
  /* ─── Cách nói thẳng, mỗi người một kiểu ──────────────────────────────── */
  { hoi: 'tui muốn xem doanh thu theo khu vực', chieu: 'Khu vực', do: 'Doanh thu', loai: 'bar' },
  { hoi: 'cho tui xem doanh thu theo khu vực', chieu: 'Khu vực', do: 'Doanh thu', loai: 'bar' },
  { hoi: 'vẽ biểu đồ doanh thu theo khu vực', chieu: 'Khu vực', do: 'Doanh thu', loai: 'bar' },
  { hoi: 'vẽ cho tui doanh thu theo khu vực', chieu: 'Khu vực', do: 'Doanh thu', loai: 'bar' },
  { hoi: 'biểu đồ doanh thu theo khu vực', chieu: 'Khu vực', do: 'Doanh thu', loai: 'bar' },
  { hoi: 'thêm biểu đồ doanh thu theo khu vực', chieu: 'Khu vực', do: 'Doanh thu', loai: 'bar' },
  { hoi: 'làm sao để xem doanh thu theo khu vực', chieu: 'Khu vực', do: 'Doanh thu', loai: 'bar' },
  { hoi: 'tui muốn xem doanh thu từng khu vực', chieu: 'Khu vực', do: 'Doanh thu', loai: 'bar' },
  { hoi: 'hiển thị doanh thu theo khu vực', chieu: 'Khu vực', do: 'Doanh thu', loai: 'bar' },
  { hoi: 'doanh thu theo khu vực vẽ giúp tui', chieu: 'Khu vực', do: 'Doanh thu', loai: 'bar' },
  { hoi: 'phân tích doanh thu theo khu vực', chieu: 'Khu vực', do: 'Doanh thu', loai: 'bar' },
  { hoi: 'so sánh doanh thu giữa các khu vực', chieu: 'Khu vực', do: 'Doanh thu', loai: 'bar' },
  { hoi: 'tui muốn xem doanh thu khu vực', chieu: 'Khu vực', do: 'Doanh thu', loai: 'bar' },

  /* ─── Thước đo và chiều khác, để chắc là không phải khớp cứng một cặp ──── */
  { hoi: 'tui muốn xem số đơn theo khu vực', chieu: 'Khu vực', do: 'Số đơn', loai: 'bar' },
  {
    hoi: 'tui muốn xem lợi nhuận theo nhóm hàng',
    chieu: 'Nhóm hàng',
    do: 'Lợi nhuận',
    loai: 'bar',
  },
  {
    hoi: 'tui muốn xem doanh thu theo trạng thái',
    chieu: 'Trạng thái',
    do: 'Doanh thu',
    loai: 'bar',
  },

  /* ─── THỜI GIAN: chữ của TA, không phải tên trường của khách ───────────── */
  { hoi: 'tui muốn xem doanh thu theo ngày đặt', chieu: 'Ngày đặt', do: 'Doanh thu', loai: 'line' },
  {
    hoi: 'vẽ biểu đồ doanh thu theo tháng',
    chieu: 'Ngày đặt',
    do: 'Doanh thu',
    loai: 'line',
    vi: 'mô hình có ĐÚNG MỘT chiều thời gian — chọn nó không phải đoán tên trường',
  },
  { hoi: 'tui muốn xem doanh thu theo quý', chieu: 'Ngày đặt', do: 'Doanh thu', loai: 'line' },
  {
    hoi: 'tui muốn xem xu hướng doanh thu',
    chieu: 'Ngày đặt',
    do: 'Doanh thu',
    loai: 'line',
    vi: '"xu hướng" nói thẳng ra là đọc dọc theo trục thời gian',
  },

  /* ─── Người dùng GỌI TÊN loại biểu đồ ──────────────────────────────────── */
  {
    hoi: 'vẽ biểu đồ tròn doanh thu theo khu vực',
    chieu: 'Khu vực',
    do: 'Doanh thu',
    loai: 'pie',
    vi: 'họ nói thẳng ra rồi — vẽ loại khác là bỏ ngoài tai',
  },
  {
    hoi: 'vẽ biểu đồ đường doanh thu theo khu vực',
    chieu: 'Khu vực',
    do: 'Doanh thu',
    loai: 'line',
  },
  {
    hoi: 'tui muốn xem doanh thu theo khu vực dạng thanh ngang',
    chieu: 'Khu vực',
    do: 'Doanh thu',
    loai: 'hbar',
  },
  {
    hoi: 'tui muốn xem tỉ trọng doanh thu theo nhóm hàng',
    chieu: 'Nhóm hàng',
    do: 'Doanh thu',
    loai: 'pie',
  },

  /* ─── Thiếu hẳn một vế ─────────────────────────────────────────────────── */
  {
    hoi: 'vẽ biểu đồ doanh thu',
    chieu: 'Ngày đặt',
    do: 'Doanh thu',
    loai: 'line',
    vi: 'chỉ nói thước đo — đề nghị chiều xếp hạng cao nhất còn hơn im lặng',
  },

  /* ─── Ngoài tầm ngoại tuyến: tên người dùng KHÁC nhãn trường ───────────── */
  {
    hoi: 'tui muốn xem doanh thu theo vùng',
    chieu: 'Khu vực',
    do: 'Doanh thu',
    loai: 'bar',
    moHinh: true,
  },
  {
    hoi: 'tui muốn xem doanh thu theo miền',
    chieu: 'Khu vực',
    do: 'Doanh thu',
    loai: 'bar',
    moHinh: true,
  },
  {
    hoi: 'tui muốn xem revenue theo region',
    chieu: 'Khu vực',
    do: 'Doanh thu',
    loai: 'bar',
    moHinh: true,
  },
  {
    hoi: 'tui muốn xem lãi theo nhóm hàng',
    chieu: 'Nhóm hàng',
    do: 'Lợi nhuận',
    loai: 'bar',
    moHinh: true,
  },
  {
    hoi: 'tui muốn xem khu vực nào bán nhiều nhất',
    chieu: 'Khu vực',
    do: 'Doanh thu',
    loai: 'bar',
    moHinh: true,
  },
];

type KetQua = 'dung' | 'chua' | 'sai';

function cham(ca: Ca): { kq: KetQua; thuc: string } {
  const g = goiYBieuDo(MO_HINH, ca.hoi);
  if (g === null) return { kq: 'chua', thuc: '—' };
  const thuc = `${tenDeXuat(g)} / ${g.loai}`;
  if (g.chieu.label !== ca.chieu || g.thuocDo.label !== ca.do) return { kq: 'sai', thuc };
  return { kq: g.loai === ca.loai ? 'dung' : 'chua', thuc };
}

describe('Bộ đánh giá đường VẼ', () => {
  const ngoaiTuyen = CA.filter((c) => c.moHinh !== true);
  const diem = ngoaiTuyen.map((c) => ({ c, ...cham(c) }));
  const dem = (k: KetQua): number => diem.filter((x) => x.kq === k).length;

  it('in ra bảng điểm', () => {
    const n = ngoaiTuyen.length;
    const pc = (x: number): string => `${((x / n) * 100).toFixed(1)}%`;
    const d: string[] = [
      `\n── Đường VẼ, lớp NGOẠI TUYẾN, trên ${String(n)} câu ──────────`,
      `  ĐÚNG       ${String(dem('dung'))}/${String(n)}  ${pc(dem('dung'))}`,
      `  CHƯA HIỂU  ${String(dem('chua'))}/${String(n)}  ${pc(dem('chua'))}`,
      `  SAI        ${String(dem('sai'))}/${String(n)}  ${pc(dem('sai'))}`,
      `  (và ${String(CA.length - n)} câu CỐ Ý để lớp mô hình lo — xem đầu file)`,
    ];
    for (const x of diem.filter((y) => y.kq !== 'dung')) {
      d.push(`  [${x.kq === 'sai' ? 'SAI ' : 'CHƯA'}] "${x.c.hoi}" → ${x.thuc}`);
    }
    console.log(d.join('\n'));
    expect(diem).toHaveLength(n);
  });

  it('KHÔNG được có câu SAI nào', () => {
    /*
     * Ràng răng cứng nhất của cả bộ. Một cặp trường sai dẫn tới một biểu đồ
     * đúng hình, sai số liệu — và không có gì trên màn hình nói ra điều đó.
     * Thà im lặng còn hơn.
     */
    expect(diem.filter((x) => x.kq === 'sai').map((x) => `${x.c.hoi} → ${x.thuc}`)).toEqual([]);
  });

  it('số câu ĐÚNG không được tụt', () => {
    // ⚠️ Chỉ được NÂNG, và phải đặt ĐÚNG BẰNG điểm hiện tại. Một ràng răng lỏng
    // hơn điểm thật sẽ im lặng nuốt đúng một ca vừa hỏng.
    expect(dem('dung')).toBeGreaterThanOrEqual(11);
  });
});
