import {
  CANVAS_COLUMNS,
  CANVAS_DEFAULT_H,
  CANVAS_DEFAULT_W,
  CANVAS_MIN_H,
  CANVAS_MIN_W,
  CHART_SERIES_SUPPORT,
  CHART_TYPE_LABELS,
  DEFAULT_CHART_PALETTE,
  normalizePalette,
  PAGE_NAME_MAX,
  type ChartType,
  type ReportAnnotationDto,
  type GroupPick,
  type ReportCanvasDto,
  type ReportChartOptionsDto,
  type ReportModelConfigDto,
  type ReportPageDto,
  type ReportVisualDto,
} from '@bi/shared';

import { readyAnnotations } from './annotation';
import type { DragField } from './dnd';

/**
 * Trạng thái ĐANG SOẠN của một ô — §10.10.
 *
 * Khác `ReportVisualDto` ở đúng một điểm, và điểm đó là lý do nó tồn tại: ở đây
 * `dimensionId` và `measureId` được phép `null`. Một ô vừa thả xuống khung thì
 * chưa có gì trong hai ô thả, và đó là trạng thái BÌNH THƯỜNG kéo dài cho tới
 * khi người dùng kéo trường vào. Ép nó mang hình dạng đã-hợp-lệ nghĩa là phải
 * bịa ra một chiều mặc định — đúng thứ §7.6 đã quyết định không làm.
 *
 * `options` là `Required<...>` chứ không phải bản tuỳ chọn: trong trình dựng
 * mọi công tắc đều có một trạng thái đang hiện trên màn hình, nên `undefined` ở
 * đây chỉ đẻ ra `??` rải khắp nơi.
 */
export interface VisualDraft {
  id: string;
  chartType: ChartType;
  dimensionId: number | null;
  measureId: number | null;
  seriesId: number | null;
  /** Số nhóm MỖI TRANG — xem `ReportModelConfigDto.limit`. */
  limit: number;
  /*
   * KHÔNG có `pick` và KHÔNG có `overflow` — §10.15.
   *
   * `overflow` biến mất khỏi cả hệ thống: mọi biểu đồ đều chia trang. `pick`
   * thì vẫn đi vào cấu hình được lưu, nhưng nó được SUY RA từ `options.sort`
   * chứ không được soạn riêng — xem `pickOf`. Giữ một bản sao ở đây nghĩa là
   * hai chỗ cùng nói về thứ tự nhóm, và chúng sẽ lệch nhau ngay lần đầu ai đó
   * sửa một chỗ mà quên chỗ kia.
   */
  options: Required<ReportChartOptionsDto>;
  /** Rỗng = dùng câu tự sinh từ chiều và thước đo. Xem `titleOf`. */
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Mặc định phải TRÙNG với cách `buildChartSpec` đọc một `options` vắng mặt.
 *
 * Lệch nhau thì báo cáo tạo trước §10.9 (không có `options`) vẽ ra một kiểu,
 * còn báo cáo mới với đúng những lựa chọn mặc định lại vẽ ra kiểu khác — cùng
 * một cấu hình, hai hình dạng.
 */
export const DEFAULT_OPTIONS: Required<ReportChartOptionsDto> = {
  stacked: true,
  showLegend: true,
  showValues: false,
  sort: 'value',
  palette: DEFAULT_CHART_PALETTE,
};

export const LIMIT_CHOICES = [5, 10, 20, 50, 100] as const;

/**
 * Đọc bảng xếp hạng từ đầu nào — SUY RA từ ô "Sắp xếp", không hỏi riêng.
 *
 * Đây là toàn bộ phép suy ra của §10.15, và nó nằm ở đây — cạnh hai hàm dựng
 * khoá cache — chứ không nằm trong `VisualPanel`. Bảng cấu hình chỉ được đọc
 * khi màn hình đang mở; khoá cache thì được dựng cả ở trang xem, nơi không có
 * bảng cấu hình nào.
 *
 * ⚠️ Ba hàm phải dùng CHUNG nó: `previewConfigOfDraft` (khoá cache của trình
 * dựng), `toDto` (thứ được lưu), và qua đó cả `previewConfigOfDto` ở trang
 * xem. Lệch một chỗ là xem trước một đằng, lưu xong một nẻo.
 */
export function pickOf(draft: VisualDraft): GroupPick {
  return draft.options.sort === 'value-asc' ? 'bottom' : 'top';
}

/**
 * Mã ô — phải sống sót qua một lần lưu rồi mở lại.
 *
 * `crypto.randomUUID` có dấu gạch ngang và dài 36 ký tự, khớp đúng luật của
 * `reportVisualSchema`. Nó chỉ tồn tại trong ngữ cảnh bảo mật (https, hoặc
 * localhost) — mở ứng dụng qua một địa chỉ LAN dạng http thì không có, nên vẫn
 * cần đường lui. Đường lui không cần chống va chạm mật mã, chỉ cần không trùng
 * trong PHẠM VI một khung tối đa 12 ô.
 */
export function newVisualId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid !== undefined) return uuid;
  return `v${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Mã trang — cùng luật và cùng lý do với `newVisualId`. */
export function newPageId(): string {
  return newVisualId();
}

/** Chiều thứ hai ĐANG CÓ TÁC DỤNG — xem ghi chú trong `VisualPanel`. */
export function seriesUsed(draft: VisualDraft): number | null {
  return CHART_SERIES_SUPPORT[draft.chartType] === 'no' ? null : draft.seriesId;
}

/**
 * Câu chặn của MỘT ô — `null` nghĩa là ô này vẽ được và lưu được.
 *
 * Cùng ba luật mà backend kiểm ở `assertChartConfigAgainst`. Trùng lặp có chủ
 * đích: ở đây nó là hướng dẫn hiện ngay trong ô trống, còn ở kia nó là cánh
 * cổng. Bỏ bên nào cũng hỏng — bỏ bên này thì người dùng bấm Lưu mới biết,
 * bỏ bên kia thì một client khác ghi được cấu hình không vẽ nổi.
 */
export function blockerOf(draft: VisualDraft): string | null {
  if (draft.dimensionId === null) return 'Kéo một chiều vào ô Trục.';
  if (draft.measureId === null) return 'Kéo một thước đo vào ô Giá trị.';
  if (CHART_SERIES_SUPPORT[draft.chartType] === 'required' && seriesUsed(draft) === null) {
    return `${CHART_TYPE_LABELS[draft.chartType]} cần thêm một chiều ở ô Nhóm màu.`;
  }
  return null;
}

/** Ô mới, chưa có trường nào — trạng thái bình thường ngay sau khi thêm. */
export function emptyVisual(at: { x: number; y: number }): VisualDraft {
  return {
    id: newVisualId(),
    chartType: 'bar',
    dimensionId: null,
    measureId: null,
    seriesId: null,
    limit: 20,
    options: { ...DEFAULT_OPTIONS },
    title: '',
    x: at.x,
    y: at.y,
    w: CANVAS_DEFAULT_W,
    h: CANVAS_DEFAULT_H,
  };
}

export function fromDto(visual: ReportVisualDto): VisualDraft {
  return {
    id: visual.id,
    chartType: visual.chartType,
    dimensionId: visual.config.dimensionId,
    measureId: visual.config.measureId,
    seriesId: visual.config.seriesDimensionId ?? null,
    limit: visual.config.limit,
    /*
     * `normalizePalette` SAU phép trải, không phải trước.
     *
     * Nó đổi những tên bảng màu đã đổi tên (`brand`, `powerbi`) về tên mới, và
     * chỉ làm vậy với những bảng vẽ ra KHÔNG KHÁC một pixel. Thiếu bước này thì
     * mở một báo cáo cũ sẽ thấy bộ chọn tô sáng một dòng "(cũ)" nằm ngay dưới
     * một dòng vẽ giống hệt — hai lựa chọn trông khác nhau cho cùng một kết quả.
     */
    options: {
      ...DEFAULT_OPTIONS,
      ...visual.config.options,
      palette: normalizePalette(visual.config.options?.palette),
      /*
       * Báo cáo lưu trước §10.15 mang `pick` riêng — đọc nó ra thành ô "Sắp
       * xếp", vì ô kia không còn tồn tại.
       *
       * Không làm bước này thì mở một báo cáo "20 nhóm NHỎ NHẤT" ra rồi bấm Lưu
       * là nó lặng lẽ thành "20 nhóm lớn nhất": `pickOf` suy từ `sort`, mà `sort`
       * của bản ghi đó là `'value'`.
       *
       * ⚠️ Tổ hợp hiếm `pick: 'bottom'` + sắp theo TÊN mất phần sắp theo tên: giữ
       * đúng NHỮNG NHÓM NÀO quan trọng hơn giữ thứ tự chúng đứng trên trục.
       */
      sort:
        visual.config.pick === 'bottom'
          ? 'value-asc'
          : (visual.config.options?.sort ?? DEFAULT_OPTIONS.sort),
    },
    title: visual.title ?? '',
    x: visual.x,
    y: visual.y,
    w: visual.w,
    h: visual.h,
  };
}

/**
 * Phần cấu hình QUYẾT ĐỊNH SỐ LIỆU — cũng chính là thân của `/report-preview`.
 *
 * Cùng một biểu đồ có hai nguồn cấu hình: ô đang soạn trong trình dựng
 * (`VisualDraft`) và ô đã lưu trong báo cáo (`ReportModelConfigDto`). Hai hàm
 * dưới đây quy cả hai về ĐÚNG một hình dạng, và điều đó là bắt buộc chứ không
 * phải cho gọn: hình dạng này đi thẳng vào khoá cache của react-query và vào
 * khoá ảnh chụp trên đĩa (`querySnapshots`). Lệch một trường — kể cả lệch giữa
 * `seriesDimensionId: null` và không có trường đó — là hai khoá khác nhau cho
 * cùng một câu hỏi, và trang xem không dùng lại được số mà trình dựng vừa tính.
 *
 * `options` KHÔNG có mặt: bảng màu và các công tắc trình bày không đổi con số.
 */
export interface PreviewConfig {
  dimensionId: number;
  measureId: number;
  limit: number;
  /**
   * PHẢI có mặt ở đây.
   *
   * `pick` đổi câu hỏi gửi xuống Cube, nên nó phải nằm trong khoá cache. Bỏ
   * quên thì đổi từ "lớn nhất" sang "nhỏ nhất" là một lần trúng cache và biểu
   * đồ đứng yên — không lỗi, không request, chỉ là một ô chọn không làm gì.
   *
   * Nó là trường DUY NHẤT ở đây được suy ra từ `options` (§10.15), và đó chính
   * là lý do phép suy ra phải nằm ở `pickOf` chứ không nằm trong giao diện.
   */
  pick: GroupPick;
  seriesDimensionId: number | null;
}

/** Từ một ô đang soạn. `null` khi ô chưa đủ chiều và thước đo để hỏi. */
export function previewConfigOfDraft(draft: VisualDraft): PreviewConfig | null {
  if (draft.dimensionId === null || draft.measureId === null) return null;
  return {
    dimensionId: draft.dimensionId,
    measureId: draft.measureId,
    limit: draft.limit,
    pick: pickOf(draft),
    seriesDimensionId: seriesUsed(draft),
  };
}

/**
 * Từ cấu hình ĐÃ LƯU.
 *
 * `?? null` không thừa: báo cáo lưu trước §10.9 không có trường
 * `seriesDimensionId` nào cả, và `{a:1}` băm ra khác `{a:1, b:null}`.
 */
export function previewConfigOfDto(config: ReportModelConfigDto): PreviewConfig {
  return {
    dimensionId: config.dimensionId,
    measureId: config.measureId,
    limit: config.limit,
    pick: config.pick ?? 'top',
    seriesDimensionId: config.seriesDimensionId ?? null,
  };
}

/**
 * Ô soạn dở → ô lưu được. `null` khi ô chưa đủ hai trường bắt buộc.
 *
 * Nhánh gọi phải LỌC BỎ những ô trả về `null` chứ đừng chặn cả lần lưu: một
 * người kéo thêm ô thứ tư rồi đổi ý và bấm Lưu thì ba ô kia vẫn phải được lưu.
 */
export function toDto(draft: VisualDraft): ReportVisualDto | null {
  if (draft.dimensionId === null || draft.measureId === null) return null;
  if (blockerOf(draft) !== null) return null;

  const title = draft.title.trim();
  return {
    id: draft.id,
    chartType: draft.chartType,
    config: {
      dimensionId: draft.dimensionId,
      measureId: draft.measureId,
      limit: draft.limit,
      pick: pickOf(draft),
      seriesDimensionId: seriesUsed(draft),
      options: draft.options,
    },
    ...(title === '' ? {} : { title }),
    x: draft.x,
    y: draft.y,
    w: draft.w,
    h: draft.h,
  };
}

/** Những ô ĐỦ trường để lưu. Ô dở dang bị bỏ qua, không chặn cả lần lưu. */
export function readyVisuals(drafts: readonly VisualDraft[]): ReportVisualDto[] {
  return drafts.map(toDto).filter((v): v is ReportVisualDto => v !== null);
}

/* ─── Trang — §10.12 ──────────────────────────────────────────────────────── */

/** Một trang ĐANG SOẠN. Cùng quan hệ với `ReportPageDto` như `VisualDraft`. */
export interface PageDraft {
  id: string;
  name: string;
  visuals: VisualDraft[];
  /**
   * Văn bản, đường kẻ, hình — §10.18. Không có kiểu "đang soạn" riêng: xem
   * `builder/annotation.ts`.
   */
  annotations: ReportAnnotationDto[];
}

/**
 * Trang mới.
 *
 * Kèm sẵn MỘT ô trống, không phải một trang trắng: một trang không có gì trên
 * đó cũng không có gì để bấm vào, và người vừa bấm "+" đang muốn dựng một biểu
 * đồ chứ không muốn ngắm một khoảng trống. Cùng lập luận với `removeVisual`.
 */
export function emptyPage(name: string): PageDraft {
  return { id: newPageId(), name, visuals: [emptyVisual({ x: 0, y: 0 })], annotations: [] };
}

/** Tên gợi ý cho trang thứ `count + 1` — không đụng tới tên người dùng đã đặt. */
export function nextPageName(pages: readonly PageDraft[]): string {
  // Đếm theo TÊN đang có chứ không theo số lượng: xoá "Trang 2" rồi thêm mới sẽ
  // ra "Trang 2" lần nữa nếu chỉ đếm, và hai trang trùng tên là hai cái thẻ
  // không phân biệt được.
  const taken = new Set(pages.map((p) => p.name.trim()));
  for (let i = pages.length + 1; i < pages.length + 100; i++) {
    const name = `Trang ${i}`;
    if (!taken.has(name)) return name;
  }
  return 'Trang mới';
}

export function pagesFromDto(canvas: ReportCanvasDto): PageDraft[] {
  return canvas.pages.map((page) => ({
    id: page.id,
    name: page.name,
    visuals: page.visuals.map(fromDto),
    annotations: page.annotations,
  }));
}

/**
 * Trang soạn dở → trang lưu được.
 *
 * Trang RỖNG được giữ lại (backend nhận), nhưng ô dở dang trong đó thì không —
 * cùng luật với `readyVisuals`, chỉ áp cho từng trang.
 *
 * Tên rỗng rơi về `Trang <n>`: zod đòi tên không rỗng, và một lần lưu bị từ
 * chối vì người dùng xoá trắng một ô tên là một cái giá quá đắt cho một thứ tự
 * sửa được.
 */
export function readyPages(pages: readonly PageDraft[]): ReportPageDto[] {
  return pages.map((page, i) => {
    const name = page.name.trim().slice(0, PAGE_NAME_MAX);
    return {
      id: page.id,
      name: name === '' ? `Trang ${i + 1}` : name,
      visuals: readyVisuals(page.visuals),
      annotations: readyAnnotations(page.annotations),
    };
  });
}

/** Báo cáo có ít nhất một ô lưu được không — luật `.min(1)` của backend. */
export function hasAnyVisual(pages: readonly PageDraft[]): boolean {
  return readyPages(pages).some((p) => p.visuals.length > 0);
}

/**
 * Chuỗi đại diện cho "khung này, tên này" — chỉ dùng để SO BẰNG.
 *
 * So chuỗi JSON chứ không so từng trường: mọi bên gọi đều đi qua đúng hàm
 * `readyPages` trên cùng một kiểu dữ liệu, nên thứ tự khoá giống hệt nhau.
 *
 * Bao cả TÊN và THỨ TỰ trang, vì đổi tên một trang hay kéo nó lên trước cũng là
 * việc phải lưu — và nếu ảnh chụp không thấy, chấm "Chưa lưu" sẽ không sáng và
 * người dùng thoát ra mất luôn.
 */
export function snapshotOf(name: string, pages: readonly ReportPageDto[]): string {
  return JSON.stringify({ name: name.trim(), pages });
}

/**
 * Có gì sẽ MẤT nếu rời trang bây giờ không?
 *
 * ─── Vì sao không chỉ so ảnh chụp với mốc ───────────────────────────────────
 *
 * Ảnh chụp chỉ thấy những ô LƯU ĐƯỢC (`readyVisuals`). Một ô vừa được kéo chiều
 * vào mà chưa có thước đo thì `toDto` trả `null`, nên nó vắng mặt trong cả ảnh
 * chụp lẫn mốc — hai bên bằng nhau, và trang kết luận "chưa sửa gì".
 *
 * Đó là công sức thật, và là trạng thái hay gặp nhất giữa chừng một thao tác.
 * Lỗi này lộ ra khi bấm thử trên trình duyệt: chọn đúng một chiều rồi bấm
 * Thoát, và trang cho đi luôn không hỏi một câu.
 *
 * ─── Vì sao mốc KHÔNG so trực tiếp trên `VisualDraft` ───────────────────────
 *
 * Nghe thì gọn hơn — một phép so là xong, thấy được cả ô dở dang. Nhưng mỗi ô
 * mang một `id` sinh ngẫu nhiên, nên ô rỗng của lần dựng mới không bao giờ
 * khớp với bất kỳ mốc dựng sẵn nào: trang vừa mở ra đã tự nhận là đã bị sửa.
 */
export function hasUnsavedWork(
  baseline: string,
  name: string,
  pages: readonly PageDraft[],
): boolean {
  const halfBuilt = pages.some((page) =>
    page.visuals.some((d) => toDto(d) === null && (d.dimensionId !== null || d.measureId !== null)),
  );
  return halfBuilt || snapshotOf(name, readyPages(pages)) !== baseline;
}

/**
 * Chỗ trống đầu tiên cho một ô mới.
 *
 * Quét theo HÀNG rồi mới tới cột, nên ô mới điền vào khoảng trống bên phải
 * trước khi xuống hàng dưới — đúng thứ tự mắt người đọc một trang.
 *
 * Trần 200 hàng chỉ để vòng lặp có điểm dừng; với trần 12 ô thì không cách nào
 * chạm tới. Chạm rồi thì đặt chồng lên gốc, vì các ô được phép đè nhau và một ô
 * đè lên ô khác vẫn tốt hơn một ô không xuất hiện.
 */
export function findSlot(
  // Mọi thứ đang chiếm chỗ trên khung — biểu đồ lẫn chú thích (§10.18). Một hộp
  // văn bản mới thả đè lên một biểu đồ là một hộp văn bản người dùng phải đi
  // tìm rồi kéo ra.
  taken: readonly { x: number; y: number; w: number; h: number }[],
  w: number = CANVAS_DEFAULT_W,
  h: number = CANVAS_DEFAULT_H,
): { x: number; y: number } {
  const clashes = (x: number, y: number): boolean =>
    taken.some((d) => x < d.x + d.w && x + w > d.x && y < d.y + d.h && y + h > d.y);

  for (let y = 0; y < 200; y++) {
    for (let x = 0; x + w <= CANVAS_COLUMNS; x++) {
      if (!clashes(x, y)) return { x, y };
    }
  }
  return { x: 0, y: 0 };
}

/**
 * Kẹp một ô vào trong khung. Dùng ở mọi đường kéo và co giãn.
 *
 * `min` mặc định là cỡ nhỏ nhất của BIỂU ĐỒ. Chú thích truyền cỡ của nó
 * (`ANNOTATION_MIN`, một ô lưới): một đường kẻ ngang cao ba hàng là một đường kẻ
 * lơ lửng giữa một khoảng trống 150 pixel.
 */
export function clampBox(
  box: { x: number; y: number; w: number; h: number },
  min: { w: number; h: number } = { w: CANVAS_MIN_W, h: CANVAS_MIN_H },
): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  const w = Math.min(Math.max(box.w, min.w), CANVAS_COLUMNS);
  const h = Math.max(box.h, min.h);
  return {
    w,
    h,
    x: Math.min(Math.max(box.x, 0), CANVAS_COLUMNS - w),
    y: Math.max(box.y, 0),
  };
}

/** Ba ô thả. `series` là chiều THỨ HAI, không phải một thước đo thứ hai. */
export type Slot = 'dimension' | 'measure' | 'series';

/**
 * Gán một trường vào một ô thả — luật dùng chung cho KÉO và BẤM.
 *
 * Trả về phần cần vá vào ô, hoặc `null` khi cú thả không có nghĩa (thả một
 * thước đo vào ô Trục). Một hàm thuần thay vì bốn lệnh `setState` rải rác, vì
 * từ §10.10 có hai nơi gọi và chúng phải áp đúng cùng một bộ luật.
 */
export function assignField(
  draft: VisualDraft,
  slot: Slot,
  field: DragField,
): Partial<VisualDraft> | null {
  if (slot === 'measure') {
    return field.kind === 'measure' ? { measureId: field.id } : null;
  }
  if (field.kind === 'measure') return null;

  if (slot === 'dimension') {
    // Cùng một chiều ở hai ô cho ra một chuỗi trên mỗi nhóm — một biểu đồ trông
    // y hệt biểu đồ một chuỗi kèm một chú giải chép lại trục ngang. Backend từ
    // chối; ở đây thì nhường ô mới và tự dọn ô cũ.
    return { dimensionId: field.id, ...(draft.seriesId === field.id ? { seriesId: null } : {}) };
  }

  if (field.id === draft.dimensionId) return null;
  /*
   * Trước §10.12 ở đây còn một bước tự đổi bảng màu: bảng `brand` chỉ có MỘT
   * màu, nên thả một chiều vào ô Nhóm màu mà không đổi bảng là các chuỗi dính
   * vào nhau. Bảng đó không còn được mời nữa (xem `CHART_PALETTES`) và mọi cấu
   * hình cũ đã được `fromDto` quy về một bảng phân loại thật, nên không còn
   * trạng thái nào để thoát khỏi.
   */
  return { seriesId: field.id };
}

/**
 * Bấm thay cho kéo — và cũng là đường của người dùng bàn phím.
 *
 * Đổ vào ô còn TRỐNG trước, vì đó gần như luôn là ý định: người ta bấm trường
 * thứ hai để thêm, không phải để thay trường thứ nhất. Hết ô trống thì thay ô
 * chính, nơi một cú bấm nhầm dễ nhận ra và dễ sửa nhất.
 *
 * "Trống" là trống THEO MÔ HÌNH HIỆN TẠI, không theo mã còn nằm trong ô — §10.19.
 * Một chiều vừa bị ẩn hay xoá ở trang mô hình thì ô Trục HIỆN RA trống (bảng
 * cấu hình không tìm được trường nào để in tên), trong khi `dimensionId` vẫn giữ
 * mã cũ. Đếm theo mã thì cú bấm đầu tiên rơi vào ô Nhóm màu, ô Trục trông trống
 * vẫn trống, biểu đồ vẫn báo lỗi — dù người dùng đã làm đúng câu lỗi bảo:
 * "chọn trường khác ở cột Mô hình dữ liệu". Cú bấm phải đi theo thứ đang hiện ra.
 */
export function slotForClick(
  draft: VisualDraft,
  field: DragField,
  /** Mã các chiều mô hình ĐANG có — cùng danh sách bảng cấu hình dùng để in tên ô. */
  dimensionIds: ReadonlySet<number>,
): Slot {
  if (field.kind === 'measure') return 'measure';
  const live = (id: number | null): number | null =>
    id !== null && dimensionIds.has(id) ? id : null;
  const dimension = live(draft.dimensionId);
  if (dimension === null) return 'dimension';
  if (
    CHART_SERIES_SUPPORT[draft.chartType] !== 'no' &&
    live(draft.seriesId) === null &&
    field.id !== dimension
  ) {
    return 'series';
  }
  return 'dimension';
}

/**
 * Tiêu đề hiện trên đầu ô.
 *
 * Tự sinh khi người dùng chưa đặt tên riêng — "Doanh thu theo Khu vực" đọc ra
 * ngay nội dung, còn "Biểu đồ 3" thì không nói gì. Đặt tên riêng vẫn được, và
 * lúc đó tên riêng thắng.
 */
export function titleOf(
  draft: VisualDraft,
  dimensionLabel: string | null,
  measureLabel: string | null,
): string {
  const own = draft.title.trim();
  if (own !== '') return own;
  if (measureLabel !== null && dimensionLabel !== null) {
    return `${measureLabel} theo ${dimensionLabel}`;
  }
  return 'Biểu đồ chưa cấu hình';
}
