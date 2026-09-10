import { CANVAS_COLUMNS, CANVAS_MIN_H, CANVAS_MIN_W, type ReportVisualDto } from '@bi/shared';
import { describe, expect, it } from 'vitest';

import { cellStyle, rowsNeeded } from '../src/features/reports/canvasLayout';
import {
  assignField,
  blockerOf,
  clampBox,
  emptyVisual,
  findSlot,
  fromDto,
  hasAnyVisual,
  hasUnsavedWork,
  nextPageName,
  pickOf,
  previewConfigOfDraft,
  readyPages,
  readyVisuals,
  seriesUsed,
  slotForClick,
  snapshotOf,
  titleOf,
  toDto,
  type PageDraft,
  type VisualDraft,
} from '../src/features/reports/builder/visual';

/**
 * Phép tính bố cục và luật của một ô — §10.10.
 *
 * ═══ Vì sao những hàm này đáng có test riêng ════════════════════════════════
 *
 * Chúng là chỗ DUY NHẤT quyết định một ô nằm ở đâu và có lưu được hay không, và
 * sai ở đây không hiện ra như một lỗi: một ô lệch cột trông y hệt một ô người
 * dùng tự đặt lệch, còn một ô bị `toDto` trả về `null` thì lặng lẽ biến mất
 * khỏi lần lưu. Không có gì đỏ, chỉ có một khung khác thứ vừa dựng.
 *
 * Backend kiểm lại đúng bộ luật này ở `assertChartConfigAgainst` và
 * `reportVisualSchema`. Trùng lặp có chủ đích — nhưng chỉ có giá trị khi hai
 * bên THẬT SỰ nói cùng một điều, nên phía này cũng phải bị khoá lại.
 */

const M = 100; // mã thước đo giả
const D1 = 1;
const D2 = 2;

function draft(over: Partial<VisualDraft> = {}): VisualDraft {
  return { ...emptyVisual({ x: 0, y: 0 }), dimensionId: D1, measureId: M, ...over };
}

describe('findSlot', () => {
  it('khung rỗng thì ô đầu tiên về góc trên-trái', () => {
    expect(findSlot([])).toEqual({ x: 0, y: 0 });
  });

  it('điền sang PHẢI trước khi xuống hàng dưới', () => {
    // Thứ tự mắt người đọc một trang. Xuống hàng trước sẽ để lại một khoảng
    // trắng bên phải mà người dùng phải tự kéo ô vào.
    const first = draft({ x: 0, y: 0, w: 6, h: 7 });
    expect(findSlot([first])).toEqual({ x: 6, y: 0 });
  });

  it('hàng đã kín thì xuống hàng ngay dưới ô thấp nhất', () => {
    const row = [draft({ x: 0, y: 0, w: 6, h: 7 }), draft({ x: 6, y: 0, w: 6, h: 7 })];
    expect(findSlot(row)).toEqual({ x: 0, y: 7 });
  });

  it('lách vào đúng khoảng trống giữa hai ô', () => {
    // Ô 4 cột ở giữa: chỗ trống là cột 4–9, và ô mặc định rộng 6 vừa khít.
    const around = [draft({ x: 0, y: 0, w: 4, h: 7 }), draft({ x: 10, y: 0, w: 2, h: 7 })];
    expect(findSlot(around, 6, 7)).toEqual({ x: 4, y: 0 });
  });
});

describe('clampBox', () => {
  it('kéo quá mép phải thì ĐẨY ô vào trong, không cắt bề rộng', () => {
    // Người đang kéo một ô muốn giữ nguyên kích thước của nó. Cắt bề rộng khi
    // chạm mép làm ô co lại giữa chừng cú kéo — trông như một lỗi hiển thị.
    expect(clampBox({ x: 10, y: 0, w: 6, h: 6 })).toMatchObject({ x: CANVAS_COLUMNS - 6, w: 6 });
  });

  it('không cho ra ngoài mép trái hay lên trên hàng 0', () => {
    expect(clampBox({ x: -5, y: -3, w: 4, h: 5 })).toMatchObject({ x: 0, y: 0 });
  });

  it('ép kích thước tối thiểu', () => {
    const box = clampBox({ x: 0, y: 0, w: 0, h: 0 });
    expect(box.w).toBe(CANVAS_MIN_W);
    expect(box.h).toBe(CANVAS_MIN_H);
  });

  it('không có trần hàng — khung cuộn dọc', () => {
    expect(clampBox({ x: 0, y: 300, w: 4, h: 4 }).y).toBe(300);
  });
});

describe('blockerOf', () => {
  it('ô mới chưa có gì -> đòi CHIỀU trước', () => {
    // Thứ tự câu chữ quan trọng: hỏi thước đo trước khi có chiều là hướng dẫn
    // người dùng làm ngược với cách khung được dựng.
    expect(blockerOf(emptyVisual({ x: 0, y: 0 }))).toContain('chiều');
  });

  it('có chiều, thiếu thước đo -> đòi GIÁ TRỊ', () => {
    expect(blockerOf(draft({ measureId: null }))).toContain('thước đo');
  });

  it('đủ hai ô -> không chặn', () => {
    expect(blockerOf(draft())).toBeNull();
  });

  it('bản đồ nhiệt thiếu chiều thứ hai -> vẫn chặn', () => {
    // Cùng luật backend áp ở `assertChartConfigAgainst`. Lệch nhau thì trình
    // dựng cho xem trước rồi từ chối lưu.
    expect(blockerOf(draft({ chartType: 'heatmap' }))).not.toBeNull();
    expect(blockerOf(draft({ chartType: 'heatmap', seriesId: D2 }))).toBeNull();
  });
});

describe('seriesUsed', () => {
  it('biểu đồ tròn bỏ QUA chiều thứ hai mà không XOÁ nó', () => {
    // Đổi tạm sang tròn rồi quay lại không được phép làm mất một trường người
    // dùng đã kéo vào.
    const pie = draft({ chartType: 'pie', seriesId: D2 });
    expect(seriesUsed(pie)).toBeNull();
    expect(pie.seriesId).toBe(D2);
    expect(seriesUsed({ ...pie, chartType: 'bar' })).toBe(D2);
  });
});

describe('assignField', () => {
  it('thả thước đo vào ô Trục KHÔNG có tác dụng', () => {
    expect(assignField(draft(), 'dimension', { kind: 'measure', id: M })).toBeNull();
  });

  it('cùng một chiều ở hai ô: ô mới thắng, ô cũ tự dọn', () => {
    // Nếu không thì biểu đồ có một chuỗi trên mỗi nhóm — trông y hệt biểu đồ
    // một chuỗi kèm chú giải chép lại trục ngang. Backend cũng từ chối.
    const withSeries = draft({ seriesId: D2 });
    expect(assignField(withSeries, 'dimension', { kind: 'dimension', id: D2 })).toEqual({
      dimensionId: D2,
      seriesId: null,
    });
  });

  it('thả chiều TRÙNG trục vào ô Nhóm màu bị bỏ qua', () => {
    expect(assignField(draft(), 'series', { kind: 'dimension', id: D1 })).toBeNull();
  });

  it('thả chiều thứ hai KHÔNG còn đụng tới bảng màu', () => {
    /*
     * Trước §10.11 chỗ này tự đổi bảng màu, vì bảng mặc định (`brand`) chỉ có
     * MỘT màu và nhiều chuỗi tô cùng một màu thì dính vào nhau. Bảng đó không
     * còn được mời nữa, nên phép đổi hộ giờ chỉ là một lần sửa cấu hình sau
     * lưng người dùng.
     */
    expect(assignField(draft(), 'series', { kind: 'dimension', id: D2 })).toEqual({
      seriesId: D2,
    });
  });

  it('bảng màu người dùng tự chọn thì KHÔNG bị đổi hộ', () => {
    const custom = draft({ options: { ...draft().options, palette: 'pastel' } });
    const patch = assignField(custom, 'series', { kind: 'dimension', id: D2 });
    expect(patch).toEqual({ seriesId: D2 });
  });
});

describe('slotForClick', () => {
  it('đổ vào ô còn TRỐNG trước khi thay ô đã có', () => {
    // Người ta bấm trường thứ hai để THÊM, không phải để thay trường thứ nhất.
    expect(slotForClick(emptyVisual({ x: 0, y: 0 }), { kind: 'dimension', id: D1 })).toBe(
      'dimension',
    );
    expect(slotForClick(draft(), { kind: 'dimension', id: D2 })).toBe('series');
  });

  it('hết ô trống thì thay ô CHÍNH — chỗ dễ nhận ra nhất khi bấm nhầm', () => {
    expect(slotForClick(draft({ seriesId: D2 }), { kind: 'dimension', id: 3 })).toBe('dimension');
  });

  it('biểu đồ tròn không có ô Nhóm màu để đổ vào', () => {
    expect(slotForClick(draft({ chartType: 'pie' }), { kind: 'dimension', id: D2 })).toBe(
      'dimension',
    );
  });
});

describe('toDto', () => {
  it('ô chưa đủ trường -> null, để nhánh gọi LỌC BỎ chứ không chặn cả lần lưu', () => {
    expect(toDto(emptyVisual({ x: 0, y: 0 }))).toBeNull();
    expect(toDto(draft({ chartType: 'heatmap' }))).toBeNull();
  });

  it('tiêu đề rỗng thì VẮNG MẶT khỏi payload, không phải chuỗi rỗng', () => {
    // `reportVisualSchema` nhận `title` tuỳ chọn; một chuỗi rỗng lưu vào sẽ làm
    // `visual.title ?? tự-sinh` ở trang xem trả về chuỗi rỗng — ô không có tên.
    const dto = toDto(draft({ title: '   ' }));
    expect(dto).not.toBeNull();
    expect('title' in (dto as object)).toBe(false);
  });

  it('chiều thứ hai bị loại theo loại biểu đồ khi lưu', () => {
    const dto = toDto(draft({ chartType: 'pie', seriesId: D2 }));
    expect(dto?.config.seriesDimensionId).toBeNull();
  });

  it('đi qua fromDto rồi toDto giữ nguyên bố cục', () => {
    const original: ReportVisualDto = {
      id: 'abc',
      chartType: 'line',
      config: { dimensionId: D1, measureId: M, limit: 50, seriesDimensionId: D2 },
      title: 'Tên riêng',
      x: 3,
      y: 4,
      w: 5,
      h: 9,
    };
    expect(toDto(fromDto(original))).toMatchObject({
      id: 'abc',
      chartType: 'line',
      title: 'Tên riêng',
      x: 3,
      y: 4,
      w: 5,
      h: 9,
    });
  });
});

/* ═══ §10.15 Một ô chọn thay cho ba ═══════════════════════════════════════
 *
 * Bảng cấu hình bỏ hai ô: "Khi còn nhóm chưa hiện" (`overflow`) và "Giữ lại nhóm
 * nào" (`pick`). Cái đầu biến mất khỏi cả hệ thống — mọi biểu đồ đều chia trang.
 * Cái thứ hai vẫn được LƯU, nhưng suy ra từ ô "Sắp xếp".
 *
 * Nguy hiểm của phép suy ra nằm ở chỗ nó phải xảy ra ở HAI nơi cùng lúc: khoá
 * cache (`previewConfigOfDraft`) và thứ được lưu (`toDto`). Lệch nhau là xem
 * trước một đằng, lưu xong một nẻo — mà cả hai đều không đỏ ở đâu cả.
 */
describe('pickOf — "nhỏ → lớn" hỏi đúng các nhóm nhỏ nhất', () => {
  it('chỉ `value-asc` đọc bảng xếp hạng từ dưới lên', () => {
    const voi = (sort: VisualDraft['options']['sort']): VisualDraft =>
      draft({ options: { ...draft().options, sort } });

    expect(pickOf(voi('value'))).toBe('top');
    expect(pickOf(voi('value-asc'))).toBe('bottom');
    // Sắp theo TÊN không nói gì về việc lấy nhóm nào: nó vẫn là các nhóm lớn
    // nhất, chỉ xếp theo bảng chữ cái. "Trang 2 theo bảng chữ cái" là một câu
    // hỏi khác, và nó cần Cube sắp theo chiều chứ không theo thước đo.
    expect(pickOf(voi('label'))).toBe('top');
    expect(pickOf(voi('label-desc'))).toBe('top');
  });

  it('khoá cache và thứ được LƯU suy ra giống hệt nhau', () => {
    const nhoNhat = draft({ options: { ...draft().options, sort: 'value-asc' } });

    expect(previewConfigOfDraft(nhoNhat)?.pick).toBe('bottom');
    expect(toDto(nhoNhat)?.config.pick).toBe('bottom');
  });

  it('cấu hình được lưu KHÔNG còn mang `overflow`', () => {
    // Trường đã bị xoá khỏi hợp đồng. Còn sót lại một bản sao ở client nghĩa là
    // người sau đọc nó và tưởng nó có tác dụng.
    const config = toDto(draft())?.config as object;
    expect('overflow' in config).toBe(false);
  });

  it('báo cáo CŨ "nhóm nhỏ nhất" mở ra vẫn là nhóm nhỏ nhất', () => {
    /*
     * Bản ghi trước §10.15 mang `pick: 'bottom'` mà `sort` vẫn là mặc định. Không
     * đọc nó ra thành ô "Sắp xếp" thì mở báo cáo rồi bấm Lưu là nó lặng lẽ đổi
     * thành "20 nhóm lớn nhất" — người dùng không đụng vào ô nào cả.
     */
    const cu: ReportVisualDto = {
      id: 'cu',
      chartType: 'bar',
      config: { dimensionId: D1, measureId: M, limit: 20, pick: 'bottom' },
      x: 0,
      y: 0,
      w: 6,
      h: 7,
    };

    const nap = fromDto(cu);
    expect(nap.options.sort).toBe('value-asc');
    expect(toDto(nap)?.config.pick).toBe('bottom');
  });

  it('báo cáo CŨ "nhóm lớn nhất" giữ nguyên cách sắp của nó', () => {
    const cu: ReportVisualDto = {
      id: 'cu2',
      chartType: 'bar',
      config: { dimensionId: D1, measureId: M, limit: 20, pick: 'top', options: { sort: 'label' } },
      x: 0,
      y: 0,
      w: 6,
      h: 7,
    };

    const nap = fromDto(cu);
    expect(nap.options.sort).toBe('label');
    expect(toDto(nap)?.config.pick).toBe('top');
  });
});

describe('titleOf', () => {
  it('tên riêng thắng câu tự sinh', () => {
    expect(titleOf(draft({ title: 'Của tôi' }), 'Khu vực', 'Doanh thu')).toBe('Của tôi');
  });

  it('chưa đủ nhãn thì KHÔNG bịa ra một cái tên nửa vời', () => {
    expect(titleOf(draft(), null, 'Doanh thu')).toBe('Biểu đồ chưa cấu hình');
  });
});

describe('hasUnsavedWork', () => {
  /*
   * Từ §10.10 trình dựng chiếm trọn màn hình, nên hai lối ra duy nhất của nó
   * đều dựa vào đúng hàm này để quyết định có hỏi lại hay không. Sai theo hướng
   * "không hỏi" là mất việc của người dùng; sai theo hướng "hỏi thừa" là dạy họ
   * bấm Có mà không đọc, rồi lần cần hỏi thật cũng vô tác dụng.
   */
  /** Một trang mang đúng những ô này — mã trang cố định để mốc so được. */
  const trang = (visuals: VisualDraft[], id = 'p1', name = 'Trang 1'): PageDraft => ({
    id,
    name,
    visuals,
  });

  const moi = trang([emptyVisual({ x: 0, y: 0 })]);
  const fresh = snapshotOf('', readyPages([moi]));

  it('trang vừa mở, một ô rỗng -> KHÔNG có gì để mất', () => {
    expect(hasUnsavedWork(fresh, '', [moi])).toBe(false);
  });

  it('mới kéo được MỖI chiều vào -> vẫn phải hỏi lại', () => {
    // Ca này từng lọt: ô chưa đủ trường nên `readyVisuals` không thấy nó, và
    // phép so ảnh chụp kết luận "chưa sửa gì". Bấm Thoát là mất, không một câu.
    const half = draft({ measureId: null });
    expect(readyVisuals([half])).toHaveLength(0);
    expect(hasUnsavedWork(fresh, '', [trang([half])])).toBe(true);
  });

  it('mới kéo được mỗi thước đo -> cũng vậy', () => {
    expect(hasUnsavedWork(fresh, '', [trang([draft({ dimensionId: null })])])).toBe(true);
  });

  it('mở báo cáo CŨ rồi thoát ngay -> không hỏi', () => {
    const saved = [trang([draft({ x: 0, y: 0 }), draft({ x: 6, y: 0, dimensionId: D2 })])];
    const mark = snapshotOf('Doanh thu quý 3', readyPages(saved));
    expect(hasUnsavedWork(mark, 'Doanh thu quý 3', saved)).toBe(false);
  });

  it('chỉ ĐỔI TÊN cũng là thay đổi', () => {
    const saved = [trang([draft()])];
    const mark = snapshotOf('Tên cũ', readyPages(saved));
    expect(hasUnsavedWork(mark, 'Tên mới', saved)).toBe(true);
  });

  it('khoảng trắng thừa hai đầu tên KHÔNG tính là thay đổi', () => {
    // Cả hai phía đều `trim()`, cùng cách backend nhận tên.
    const saved = [trang([draft()])];
    const mark = snapshotOf('Báo cáo', readyPages(saved));
    expect(hasUnsavedWork(mark, '  Báo cáo  ', saved)).toBe(false);
  });

  it('kéo một ô sang chỗ khác là thay đổi', () => {
    // Bố cục nằm trong DTO, nên chỉ dời ô mà không đụng trường vẫn phải hỏi.
    const saved = [trang([draft({ x: 0, y: 0 })])];
    const mark = snapshotOf('B', readyPages(saved));
    expect(hasUnsavedWork(mark, 'B', [trang([{ ...draft(), x: 4, y: 2 }])])).toBe(true);
  });

  it('xoá bớt một ô là thay đổi', () => {
    const saved = [trang([draft({ x: 0, y: 0 }), draft({ x: 6, y: 0 })])];
    const mark = snapshotOf('B', readyPages(saved));
    expect(hasUnsavedWork(mark, 'B', [trang([draft({ x: 0, y: 0 })])])).toBe(true);
  });

  /* ─── Trang — §10.11 ─────────────────────────────────────────────────────
   *
   * Ba ca dưới đây khoá đúng ba đường làm mất việc của người dùng mà không có
   * lỗi nào báo: thêm trang, đổi tên trang, và đảo thứ tự trang. Cả ba đều đi
   * vào bản lưu, nên cả ba đều phải làm chấm "Chưa lưu" sáng lên.
   */
  it('thêm một trang RỖNG cũng là thay đổi', () => {
    // Trang rỗng vẫn được lưu (backend nhận), nên bỏ qua nó ở đây là để người
    // dùng thêm một trang rồi thoát và mất nó, không một câu hỏi.
    const saved = [trang([draft()])];
    const mark = snapshotOf('B', readyPages(saved));
    expect(hasUnsavedWork(mark, 'B', [...saved, trang([], 'p2', 'Trang 2')])).toBe(true);
  });

  it('đổi TÊN một trang là thay đổi', () => {
    const saved = [trang([draft()])];
    const mark = snapshotOf('B', readyPages(saved));
    expect(hasUnsavedWork(mark, 'B', [trang([draft()], 'p1', 'Tổng quan')])).toBe(true);
  });

  it('đảo THỨ TỰ hai trang là thay đổi', () => {
    const a = trang([draft()], 'p1', 'Một');
    const b = trang([draft({ dimensionId: D2 })], 'p2', 'Hai');
    const mark = snapshotOf('B', readyPages([a, b]));
    expect(hasUnsavedWork(mark, 'B', [b, a])).toBe(true);
  });
});

describe('readyPages / hasAnyVisual', () => {
  it('trang RỖNG được giữ lại, ô dở dang thì không', () => {
    // Hai luật khác nhau và cả hai đều cố ý: người ta thêm một trang TRƯỚC rồi
    // mới dựng biểu đồ cho nó, nhưng một ô mới kéo được nửa chừng thì chưa vẽ
    // được và backend sẽ từ chối cả lần lưu vì nó.
    const out = readyPages([
      { id: 'p1', name: 'Một', visuals: [draft(), draft({ measureId: null })] },
      { id: 'p2', name: 'Hai', visuals: [] },
    ]);

    expect(out).toHaveLength(2);
    expect(out[0]?.visuals).toHaveLength(1);
    expect(out[1]?.visuals).toHaveLength(0);
  });

  it('tên trang rỗng rơi về "Trang <n>" thay vì làm hỏng cả lần lưu', () => {
    // zod đòi tên không rỗng. Người dùng hay xoá trắng ô tên rồi bấm ra ngoài,
    // và mất cả lần lưu vì chuyện đó là một cái giá quá đắt.
    expect(readyPages([{ id: 'p1', name: '   ', visuals: [] }])[0]?.name).toBe('Trang 1');
  });

  it('không ô nào lưu được thì nút Lưu phải tắt', () => {
    // Backend từ chối một khung không có ô nào; chặn ở đây để người dùng không
    // bấm Lưu rồi mới đọc được câu đó.
    expect(hasAnyVisual([{ id: 'p1', name: 'Một', visuals: [draft({ measureId: null })] }])).toBe(
      false,
    );
    expect(hasAnyVisual([{ id: 'p1', name: 'Một', visuals: [draft()] }])).toBe(true);
  });

  it('tên trang mới không trùng tên đang có', () => {
    // Đếm theo TÊN chứ không theo số lượng: xoá "Trang 2" rồi thêm mới sẽ ra
    // "Trang 2" lần nữa nếu chỉ đếm, và hai thẻ trùng tên thì không phân biệt
    // được cái nào là cái nào.
    const pages: PageDraft[] = [
      { id: 'p1', name: 'Trang 1', visuals: [] },
      { id: 'p3', name: 'Trang 3', visuals: [] },
    ];
    expect(nextPageName(pages)).toBe('Trang 4');
  });
});

describe('cellStyle / rowsNeeded', () => {
  it('đổi từ chỉ số đếm-từ-0 sang đường kẻ grid đếm-từ-1', () => {
    // Lệch một đơn vị ở đây làm MỌI ô dịch một cột — và trông vẫn như một bố
    // cục hợp lệ, chỉ là không phải bố cục người dùng đã sắp.
    expect(cellStyle({ x: 0, y: 0, w: 6, h: 7 })).toMatchObject({
      gridColumn: '1 / span 6',
      gridRow: '1 / span 7',
    });
  });

  it('luôn cho phép ô hẹp hơn nội dung', () => {
    // Thiếu `minWidth: 0` thì một bảng rộng bung cả lưới ra.
    expect(cellStyle({ x: 2, y: 3, w: 4, h: 5 })).toMatchObject({ minWidth: 0, minHeight: 0 });
  });

  it('chiều cao khung tính theo ô THẤP NHẤT, có sàn tối thiểu', () => {
    expect(rowsNeeded([{ y: 0, h: 4 }])).toBe(8);
    expect(
      rowsNeeded([
        { y: 7, h: 6 },
        { y: 0, h: 7 },
      ]),
    ).toBe(13);
  });
});
