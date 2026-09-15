import type { ChartType, ReportChartOptionsDto, ReportDataDto } from '@bi/shared';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';

import { VegaChart } from '../../components/charts/VegaChart';
import { TBody, Td, Th, THead, TableWrap, Tr } from '../../components/ui/Table';
import { KHONG_XUAT } from '../../services/danhDauXuat';
import { buildChartSpec, hasSeries } from './chartSpec';

/**
 * Biểu đồ của một báo cáo — dùng chung cho trang XEM và trình DỰNG (§10.9).
 *
 * Cùng lý do với `chartSpec.ts`, đẩy thêm một tầng: không chỉ spec Vega mà cả
 * những thứ quanh nó — dòng cảnh báo "đã cắt", nhánh bảng-thay-cho-biểu-đồ,
 * khung rỗng khi không có dòng nào — đều phải giống nhau ở hai màn hình. Chép
 * tay ba nhánh đó sang trình dựng là ba cơ hội để bản xem trước nói một đằng và
 * bản đã lưu nói một nẻo.
 */
export function ReportChart({
  chartType,
  data,
  options,
  onPage,
  fit = false,
}: {
  chartType: ChartType;
  data: ReportDataDto;
  options?: ReportChartOptionsDto | undefined;
  /**
   * Đi tới một trang nhóm khác — §10.12.
   *
   * Vắng mặt = không có hai cái nút, kể cả khi số liệu có mang `paging`. Đó là
   * chỗ để một nơi hiển thị không lật trang được (một bản in, một ảnh xem
   * trước) dùng lại đúng component này mà không bày ra hai cái nút chết.
   */
  onPage?: ((page: number) => void) | undefined;
  /**
   * Chỗ vẽ này có CHIỀU CAO CỐ ĐỊNH không — §10.13.
   *
   * `true` ở trong một ô của khung: ô cao đúng `h` hàng lưới, không phụ thuộc
   * biểu đồ vẽ ra cái gì. Component tự đo chỗ còn lại rồi bảo Vega vẽ vừa vào
   * đó, nên không nhóm nào bị cắt.
   *
   * `false` ở trang xem một biểu đồ: khung chứa cao THEO NỘI DUNG. Đo ở đó là
   * đo chính thứ mình sắp quyết định — chiều cao ô phụ thuộc biểu đồ, biểu đồ
   * phụ thuộc chiều cao ô — nên phép đo sẽ chạy vòng. Chế độ này giữ nguyên
   * cách cũ: 340px, và thanh ngang dài ra theo số nhóm.
   *
   * Cố ý là một CỜ do nơi gọi bật chứ không phải một phép đoán tại chỗ: chỉ nơi
   * gọi mới biết hộp của mình cao theo lưới hay cao theo nội dung, và đoán sai
   * chiều nào cũng dẫn tới đúng cái vòng lặp trên.
   */
  fit?: boolean;
}): React.ReactElement {
  /**
   * Kích thước thật của vùng vẽ, đo ở trình duyệt — CẢ HAI chiều.
   *
   * `useLayoutEffect` chứ không `useEffect`: đo sau khi trình duyệt đã vẽ
   * nghĩa là khung hình đầu tiên dùng kích thước mặc định rồi khung sau nhảy
   * sang kích thước thật — một cú giật thấy được, và một lần dựng lại view Vega
   * bỏ đi.
   *
   * `ResizeObserver` lo phần còn lại: kéo tay nắm co giãn, gấp một cột bên
   * (§10.15), thu cửa sổ. Vùng được đo `overflow-hidden` ở chế độ này (xem
   * `khung`), nên kích thước của nó KHÔNG phụ thuộc biểu đồ bên trong và phép đo
   * không tự nuôi chính nó.
   *
   * ⚠️ Chiều NGANG cũng phải đo, dù `width: 'container'` nghe như đã lo việc đó
   * — §10.16. vega-embed chỉ đo lại thẻ bọc khi `window` phát `resize`, mà kéo
   * một cái ô hẹp lại thì cửa sổ không đổi gì cả. Xem `width` trong `chartSpec`.
   */
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!fit || el === null) return;

    // Làm tròn: `clientHeight` là số nguyên nhưng `contentRect` của
    // ResizeObserver là số thực, và một ô 349,33px sẽ bắn ra vài giá trị lệch
    // nhau phần thập phân — mỗi cái là một lần dựng lại toàn bộ view Vega.
    //
    // So sánh CẢ HAI chiều rồi mới đặt state: một cú kéo ngang không đổi chiều
    // cao, và trả về một object mới cho mỗi lần quan sát là dựng lại view Vega
    // cho một kích thước y hệt.
    const measure = (w: number, h: number): void =>
      setBox((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    measure(el.clientWidth, el.clientHeight);

    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect !== undefined) measure(Math.round(rect.width), Math.round(rect.height));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [fit]);

  /**
   * `useMemo` là BẮT BUỘC, không phải tối ưu.
   *
   * `VegaChart` dựng lại toàn bộ view mỗi khi tham chiếu `spec` đổi. Một object
   * literal trong JSX đổi tham chiếu sau MỖI lần render, nên biểu đồ sẽ nhấp
   * nháy liên tục và mỗi lần dựng lại rò một view chưa được `finalize`.
   */
  const spec = useMemo(
    () =>
      buildChartSpec({
        chartType,
        data,
        options,
        height: fit ? box.h : undefined,
        width: fit ? box.w : undefined,
      }),
    [chartType, data, options, fit, box],
  );

  /*
   * Hai cái nút phải có mặt ở CẢ BA nhánh dưới đây, kể cả nhánh không dòng nào.
   *
   * Một trang rỗng không nên xảy ra — nút ›  tự khoá khi hết dữ liệu — nhưng
   * nếu nó xảy ra (dữ liệu đổi giữa hai lần bấm) mà nút biến mất theo thì người
   * dùng kẹt ở một khung trắng không có đường lùi.
   */
  const pager = <Pager paging={data.paging} onPage={onPage} />;

  /**
   * Cột dọc: phần vẽ ở trên, hai cái nút và dòng cảnh báo GHIM ở dưới.
   *
   * ─── Vì sao hai cái nút không nằm trong vùng vẽ ────────────────────────────
   *
   * Ô trên khung có chiều cao cố định theo lưới và `overflow-hidden`. Thứ thò
   * ra khỏi nó luôn là phần DƯỚI CÙNG — tới §10.11 đó là nhãn trục, khó chịu
   * nhưng còn đọc được biểu đồ; từ §10.12 nó là hai cái nút lật trang, tức là
   * mất hẳn đường vào phần dữ liệu còn lại. Nên chúng ra khỏi vùng vẽ và neo ở
   * đáy ô, và vùng vẽ nhận đúng phần còn lại.
   *
   * ─── `overflow-hidden` hay `overflow-auto` ────────────────────────────────
   *
   * Vừa-khung (§10.13) thì `hidden`: biểu đồ đã được dựng vừa đúng chỗ này nên
   * không có gì để cuộn, và một thanh cuộn hiện ra sẽ đổi chiều cao vùng đo →
   * đổi chiều cao biểu đồ → hiện/mất thanh cuộn. Vòng đó nhấp nháy vĩnh viễn.
   *
   * Chế độ cũ thì `auto`: ở đó biểu đồ vẫn khai chiều cao của riêng nó, và cuộn
   * được vẫn hơn bị cắt.
   *
   * `h-full` vô hại ở nơi khung chứa cao theo nội dung (trang xem báo cáo một
   * biểu đồ): `height: 100%` của một khung auto giải ra auto.
   */
  const khung = (children: React.ReactNode): React.ReactElement => (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={boxRef} className={`min-h-0 flex-1 ${fit ? 'overflow-hidden' : 'overflow-auto'}`}>
        {children}
      </div>
      {pager}
      <TruncationNote data={data} />
    </div>
  );

  if (data.rows.length === 0) {
    return khung(
      <p className="py-10 text-center text-sm text-slate-500">
        Không có dòng nào để vẽ với lựa chọn hiện tại.
      </p>,
    );
  }

  // Bảng số liệu là một LOẠI biểu đồ, không phải trạng thái thiếu biểu đồ. Nó
  // vẽ bằng chính bảng bên dưới thay vì bằng Vega.
  if (spec === null) return khung(<ReportDataTable data={data} />);

  return khung(
    <VegaChart
      spec={spec}
      data={data.rows}
      ariaLabel={
        hasSeries(data)
          ? `${data.measureLabel} theo ${data.dimensionLabel} và ${data.seriesLabel}`
          : `${data.measureLabel} theo ${data.dimensionLabel}`
      }
      className="w-full"
    />,
  );
}

/**
 * Hai cái nút ‹ › ở góc dưới biểu đồ — §10.12.
 *
 * ═══ Vì sao chúng tồn tại ═══════════════════════════════════════════════════
 *
 * Trần nhóm luôn phải có: một chiều ba nghìn giá trị mà vẽ hết thì không đọc
 * được gì. Nhưng tới §10.10 cái trần đó là một BỨC TƯỜNG — phần vượt quá gộp
 * thành một cột "Khác" và không có đường nào nhìn vào bên trong nó. Người dùng
 * biết còn dữ liệu, thấy nó được cộng lại thành một cột, và không mở ra được.
 *
 * Hai cái nút này là đường đó. Backend trả về `paging` cho MỌI biểu đồ dựng
 * trên mô hình (§10.15 — trước đó phải chọn `overflow: 'pages'` mới có), và mỗi
 * lần bấm là một truy vấn với `offset` khác — không phải cắt lại một tập đã tải
 * về, mà là hỏi Cube một câu khác.
 *
 * ═══ Vì sao chỉ có "Trang N" chứ không có "Trang N/M" ═══════════════════════
 *
 * Biết M đòi đếm toàn bộ giá trị phân biệt của chiều, tức thêm một lượt quét
 * ClickHouse cho mỗi lần vẽ, để in ra một con số. `hasMore` — thứ đến miễn phí
 * từ mẹo hỏi thừa một dòng — trả lời đúng câu hỏi mà hai cái nút cần: còn nữa
 * hay hết rồi.
 */
function Pager({
  paging,
  onPage,
}: {
  paging: ReportDataDto['paging'];
  onPage: ((page: number) => void) | undefined;
}): React.ReactElement | null {
  if (paging === undefined || onPage === undefined) return null;

  const { page, hasMore } = paging;
  // Vừa đúng một trang: hai cái nút đều chết, và một cặp nút chết chỉ nói với
  // người dùng rằng có gì đó không dùng được.
  if (page === 0 && !hasMore) return null;

  const style = (on: boolean): string =>
    `rounded border px-2 py-0.5 leading-none ${
      on
        ? 'border-slate-300 text-slate-600 hover:border-slate-400 hover:bg-slate-50'
        : 'cursor-not-allowed border-slate-200 text-slate-300'
    }`;

  return (
    // `pe-4`: trong trình dựng, tay nắm co giãn ngồi đúng góc dưới-phải của ô
    // (16px), và không chừa chỗ thì nút › nằm một nửa dưới nó.
    <div className="mt-2 flex items-center justify-end gap-1.5 pe-4 text-xs text-slate-500">
      <span className="tabular-nums">Trang {page + 1}</span>
      {/* Hai cái nút KHÔNG vào ảnh xuất: trên giấy chúng không bấm được, còn
          "Trang N" thì vẫn nói cho người đọc biết đây chưa phải toàn bộ nhóm. */}
      <button
        type="button"
        {...KHONG_XUAT}
        disabled={page === 0}
        onClick={() => onPage(page - 1)}
        aria-label="Nhóm trang trước"
        title="Nhóm trang trước"
        className={style(page > 0)}
      >
        ‹
      </button>
      <button
        type="button"
        {...KHONG_XUAT}
        disabled={!hasMore}
        onClick={() => onPage(page + 1)}
        aria-label="Nhóm trang sau"
        title="Nhóm trang sau"
        className={style(hasMore)}
      >
        ›
      </button>
    </div>
  );
}

/**
 * Biểu đồ không hiện hết mọi nhóm — người xem PHẢI biết.
 *
 * Không có dòng này thì "5 vùng lớn nhất trong 13" đọc ra thành "toàn bộ 5
 * vùng", và mọi kết luận rút ra từ đó đều sai mà không có dấu hiệu nào.
 *
 * Ba câu cho ba tình huống khác nhau, và gộp chúng lại là nói sai ít nhất một
 * lần:
 *
 *   có chiều thứ hai trần CHUỖI đã cắt bớt màu; hai cái nút ‹ › lật nhóm chứ
 *                    không lật màu, nên chỗ này vẫn phải nói ra.
 *   có "Khác"        phần vượt được CỘNG vào một cột, không mất thông tin tổng.
 *   không cộng được  phần vượt bị BỎ HẲN — tỉ lệ và trung bình không cộng được.
 *
 * ⚠️ Hai câu sau chỉ còn nhánh BỘ DỮ LIỆU đi tới được. Báo cáo dựng trên mô
 * hình luôn chia trang từ §10.15, nên ở đó `grouped` chỉ còn bật vì trần chuỗi.
 */
function TruncationNote({ data }: { data: ReportDataDto }): React.ReactElement | null {
  if (!data.grouped) return null;

  const text = hasSeries(data)
    ? 'Chỉ hiện các nhóm lớn nhất trên trục, và trong đó chỉ những tổ hợp lớn nhất giữa hai chiều. Không có cột “Khác” vì phần bị cắt không chia được cho từng chuỗi.'
    : data.rows.at(-1)?.label === 'Khác'
      ? 'Chỉ hiện các nhóm lớn nhất; phần còn lại được gộp vào “Khác”.'
      : 'Chỉ hiện các nhóm lớn nhất — phép tính này không cộng được nên phần còn lại bị bỏ khỏi biểu đồ.';

  return <p className="mt-3 text-xs text-slate-500">{text}</p>;
}

/**
 * Số liệu ở dạng bảng.
 *
 * Không phải phần thừa dưới biểu đồ: nó là thứ người dùng đối chiếu khi nghi
 * ngờ biểu đồ, và là bản mà trình đọc màn hình đọc được (biểu đồ Vega chỉ là
 * một mớ `<path>`).
 */
export function ReportDataTable({ data }: { data: ReportDataDto }): React.ReactElement {
  const multi = hasSeries(data);

  return (
    <TableWrap>
      <THead>
        <Tr>
          <Th>{data.dimensionLabel}</Th>
          {multi && <Th>{data.seriesLabel}</Th>}
          <Th align="right">{data.measureLabel}</Th>
        </Tr>
      </THead>
      <TBody>
        {data.rows.map((row, index) => (
          // Khoá theo CHỈ SỐ, không theo nhãn: với chiều thứ hai thì cùng một
          // nhãn nhóm xuất hiện nhiều lần (mỗi chuỗi một dòng), nên khoá theo
          // nhãn sẽ trùng và React bỏ mất dòng.
          <Tr key={index}>
            <Td>{row.label}</Td>
            {multi && <Td>{row.series ?? ''}</Td>}
            <Td align="right">
              <span className="tabular-nums">{formatValue(row.value, data.format)}</span>
            </Td>
          </Tr>
        ))}
      </TBody>
    </TableWrap>
  );
}

/**
 * Con số trong bảng, đọc theo cách thước đo được khai.
 *
 * `'percent'` nhân 100 khi HIỂN THỊ, không đụng tới dữ liệu — cùng lập luận với
 * trục của biểu đồ.
 */
function formatValue(value: number, format: ReportDataDto['format']): string {
  if (format === 'percent') {
    return `${(value * 100).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} %`;
  }
  return value.toLocaleString('vi-VN');
}
