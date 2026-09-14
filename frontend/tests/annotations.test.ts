import {
  CANVAS_MIN_H,
  CANVAS_MIN_W,
  reportAnnotationSchema,
  type ReportAnnotationDto,
  type ReportDto,
  type TextAnnotationDto,
} from '@bi/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchReport } from '../src/features/datasets/api';
import { lineEnds, withOpacity } from '../src/features/reports/annotations/annotationStyle';
import {
  ANNOTATION_MIN,
  ANNOTATION_PRESETS,
  applyPatch,
  duplicateOf,
  moveInLayer,
  presetOf,
  readyAnnotations,
} from '../src/features/reports/builder/annotation';
import {
  clampBox,
  emptyVisual,
  findSlot,
  hasUnsavedWork,
  readyPages,
  snapshotOf,
  type PageDraft,
} from '../src/features/reports/builder/visual';
import { apiClient } from '../src/services/apiClient';

/**
 * Chú thích trong trình dựng — §10.18. Hàm thuần, không DOM.
 *
 * Ca quan trọng nhất là ca ĐẦU TIÊN: mọi thứ trình dựng thả xuống khung phải
 * lọt qua đúng schema mà backend dùng để kiểm lúc lưu. Lệch một trường là nút
 * Lưu trả 400 cho một thứ người dùng không hề gõ sai.
 */

const filled = (a: ReportAnnotationDto): ReportAnnotationDto =>
  a.kind === 'text' ? { ...a, text: 'Có chữ' } : a;

describe('mẫu trên thanh Chèn', () => {
  it('MỌI mẫu đều ra một chú thích backend nhận — khi hộp chữ đã có chữ', () => {
    for (const preset of ANNOTATION_PRESETS) {
      const made = filled(preset.make('m-1', { x: 0, y: 3 }));
      const parsed = reportAnnotationSchema.safeParse(made);
      expect(parsed.success, `${preset.key}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
      // Không có phép biến đổi ngầm nào: thứ lưu xuống là thứ đang thấy.
      expect(parsed.success && parsed.data).toEqual(made);
    }
  });

  it('cỡ khai trên mẫu là cỡ của thứ nó tạo ra — `findSlot` tìm chỗ theo đúng cỡ đó', () => {
    for (const preset of ANNOTATION_PRESETS) {
      const made = preset.make('m', { x: 0, y: 0 });
      expect({ w: made.w, h: made.h }, preset.key).toEqual({ w: preset.w, h: preset.h });
    }
  });

  it('khung nền nằm DƯỚI biểu đồ, vòng khoanh nằm TRÊN', () => {
    // Đảo hai cái này thì khung nền che mất biểu đồ, còn vòng khoanh chui xuống
    // dưới đúng con số nó được đặt ra để chỉ vào.
    expect(presetOf('panel').make('a', { x: 0, y: 0 }).layer).toBe('back');
    expect(presetOf('circle').make('a', { x: 0, y: 0 }).layer).toBe('front');
    expect(presetOf('arrow').make('a', { x: 0, y: 0 }).layer).toBe('front');
  });
});

describe('lưu', () => {
  const text = presetOf('text').make('t', { x: 0, y: 0 }) as TextAnnotationDto;
  const line = presetOf('hline').make('l', { x: 0, y: 2 });

  it('hộp chữ trống — kể cả chỉ có khoảng trắng — bị bỏ, đường kẻ thì không', () => {
    const out = readyAnnotations([text, { ...text, id: 't2', text: ' \n ' }, line]);
    expect(out.map((a) => a.id)).toEqual(['l']);
  });

  it('`readyPages` mang chú thích theo, và bỏ đúng hộp trống', () => {
    const pages: PageDraft[] = [
      {
        id: 'p1',
        name: 'Một',
        visuals: [],
        annotations: [text, { ...text, id: 't2', text: 'Ghi chú' }, line],
      },
    ];
    expect(readyPages(pages)[0]?.annotations.map((a) => a.id)).toEqual(['t2', 'l']);
  });

  it('dời, gõ chữ, đổi màu một chú thích đều làm sáng chấm "Chưa lưu"', () => {
    const base: PageDraft = {
      id: 'p1',
      name: 'Một',
      visuals: [emptyVisual({ x: 0, y: 0 })],
      annotations: [{ ...text, text: 'Cũ' }, line],
    };
    const mark = snapshotOf('B', readyPages([base]));
    const doi = (annotations: ReportAnnotationDto[]): boolean =>
      hasUnsavedWork(mark, 'B', [{ ...base, annotations }]);

    expect(doi(base.annotations)).toBe(false);
    expect(doi([{ ...text, text: 'Mới' }, line])).toBe(true);
    expect(
      doi([
        { ...text, text: 'Cũ' },
        { ...line, y: 5 },
      ]),
    ).toBe(true);
    expect(doi([{ ...text, text: 'Cũ', color: '#B91C1C' }, line])).toBe(true);
    // Xoá một chú thích cũng là việc phải lưu.
    expect(doi([line])).toBe(true);
  });
});

describe('thao tác', () => {
  // Một tờ ghi chú vàng như báo cáo cũ còn giữ — nút "Ghi chú" đã bỏ, nhưng hộp
  // văn bản nền vàng vẫn là một chú thích hợp lệ.
  const note = {
    ...presetOf('text').make('n', { x: 2, y: 4 }),
    text: 'Ghi chú',
    fill: '#FEF3C7',
  } as TextAnnotationDto;

  it('`applyPatch` không bao giờ đổi loại hay mã của chú thích', () => {
    const out = applyPatch(note, { fontSize: 20, bold: true });
    expect(out).toMatchObject({ kind: 'text', id: 'n', fontSize: 20, bold: true, fill: '#FEF3C7' });
  });

  it('nhân bản: mã mới, lệch xuống một hàng, vẫn hợp lệ với backend', () => {
    const copy = duplicateOf(note, 'n-2');
    expect(copy).toMatchObject({ id: 'n-2', x: 2, y: 5, text: 'Ghi chú' });
    expect(reportAnnotationSchema.safeParse(copy).success).toBe(true);
  });

  it('lên trên cùng / xuống dưới cùng dời đúng phần tử, không làm mất ai', () => {
    const [a, b, c] = ['a', 'b', 'c'].map((id) => ({ ...note, id }));
    const list = [a!, b!, c!];
    expect(moveInLayer(list, 'a', 'top').map((x) => x.id)).toEqual(['b', 'c', 'a']);
    expect(moveInLayer(list, 'c', 'bottom').map((x) => x.id)).toEqual(['c', 'a', 'b']);
    expect(moveInLayer(list, 'khong-co', 'top').map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('chú thích kẹp tới MỘT ô lưới, biểu đồ vẫn giữ cỡ tối thiểu của nó', () => {
    expect(clampBox({ x: 0, y: 0, w: 0, h: 0 }, ANNOTATION_MIN)).toMatchObject({ w: 1, h: 1 });
    // Tham số mặc định không đổi — mọi đường kéo ô biểu đồ vẫn đi qua nó.
    expect(clampBox({ x: 0, y: 0, w: 0, h: 0 })).toMatchObject({
      w: CANVAS_MIN_W,
      h: CANVAS_MIN_H,
    });
  });

  it('chỗ trống cho thứ mới thả xuống tránh cả chú thích, không chỉ biểu đồ', () => {
    const title = presetOf('title').make('t', { x: 0, y: 0 });
    // Hàng 0 bị tiêu đề chiếm trọn 12 cột, nên một hộp 4×2 phải xuống hàng 1.
    expect(findSlot([title], 4, 2)).toEqual({ x: 0, y: 1 });
  });
});

describe('phép tính hình', () => {
  it('`withOpacity` đọc đúng ba kênh màu và kẹp phần trăm', () => {
    expect(withOpacity('#FEF3C7', 30)).toBe('rgba(254, 243, 199, 0.3)');
    expect(withOpacity('#000000', 250)).toBe('rgba(0, 0, 0, 1)');
  });

  it('bốn hướng đường kẻ đi đúng hai góc', () => {
    expect(lineEnds('horizontal')).toMatchObject({ y1: '50%', y2: '50%' });
    expect(lineEnds('vertical')).toMatchObject({ x1: '50%', x2: '50%' });
    // "Chéo lên" đi từ góc DƯỚI-trái lên góc trên-phải — mũi tên ở cuối chỉ lên.
    expect(lineEnds('diagonal-up')).toEqual({ x1: '0%', y1: '100%', x2: '100%', y2: '0%' });
  });
});

describe('cửa vào API', () => {
  afterEach(() => vi.restoreAllMocks());

  it('báo cáo từ một backend CHƯA có §10.18 vẫn mở được — trang thiếu `annotations` thành mảng rỗng', async () => {
    const cu = {
      id: 1,
      canvas: { pages: [{ id: 'p1', name: 'Một', visuals: [] }] },
    } as unknown as ReportDto;
    vi.spyOn(apiClient, 'get').mockResolvedValue({ data: cu });

    const report = await fetchReport(1);
    expect(report.canvas?.pages[0]?.annotations).toEqual([]);
  });

  it('báo cáo một biểu đồ (`canvas: null`) đi qua nguyên vẹn', async () => {
    const mot = { id: 2, canvas: null } as unknown as ReportDto;
    vi.spyOn(apiClient, 'get').mockResolvedValue({ data: mot });
    expect(await fetchReport(2)).toEqual(mot);
  });
});
