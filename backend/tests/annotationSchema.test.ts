import {
  ANNOTATION_TEXT_MAX,
  CANVAS_MAX_ANNOTATIONS,
  parseAnnotations,
  reportAnnotationSchema,
} from '@bi/shared';
import { describe, expect, it } from 'vitest';

import { reportCanvasSchema } from '../src/api/v1/schemas';

/**
 * Luật của chú thích trên khung — §10.18. KHÔNG cần container nào.
 *
 * Phần lớn ca ở đây kiểm chuyện TỪ CHỐI, vì một chú thích sai không hỏng ra
 * mặt lúc lưu: nó hỏng ở trang XEM của người khác — một mã màu chở theo CSS lạ,
 * một hộp văn bản vô hình, một trường gõ sai chính tả lưu vào rồi không làm gì.
 */

const text = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 't1',
  kind: 'text',
  x: 0,
  y: 0,
  w: 4,
  h: 2,
  layer: 'front',
  text: 'Ghi chú',
  fontSize: 14,
  bold: false,
  italic: false,
  align: 'left',
  valign: 'top',
  color: '#0F172A',
  fill: null,
  ...extra,
});

const line = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'l1',
  kind: 'line',
  x: 0,
  y: 0,
  w: 6,
  h: 1,
  layer: 'front',
  direction: 'horizontal',
  style: 'solid',
  width: 2,
  color: '#475569',
  arrow: 'none',
  ...extra,
});

const shape = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 's1',
  kind: 'shape',
  x: 0,
  y: 0,
  w: 6,
  h: 4,
  layer: 'back',
  shape: 'rounded',
  fill: '#F1F5F9',
  opacity: 100,
  stroke: null,
  strokeWidth: 1,
  strokeStyle: 'solid',
  ...extra,
});

const ok = (value: unknown): boolean => reportAnnotationSchema.safeParse(value).success;

describe('§10.18 luật của một chú thích', () => {
  it('ba loại hợp lệ đều qua', () => {
    expect(ok(text())).toBe(true);
    expect(ok(line({ direction: 'diagonal-up', arrow: 'both', style: 'dotted' }))).toBe(true);
    expect(ok(shape({ shape: 'ellipse', fill: null, stroke: '#D64550' }))).toBe(true);
  });

  it('màu CHỈ nhận #RRGGBB — không có đường nào chở CSS vào trang người xem', () => {
    for (const bad of ['red', '#fff', 'url(x)', '#0F172A; background: url(x)', 'var(--a)', '']) {
      expect(ok(text({ color: bad })), bad).toBe(false);
    }
    expect(ok(shape({ fill: 'transparent' }))).toBe(false);
  });

  it('hộp văn bản CHỈ có khoảng trắng bị từ chối, nhưng xuống dòng thì được giữ', () => {
    expect(ok(text({ text: '  \n\t ' }))).toBe(false);
    const parsed = reportAnnotationSchema.parse(text({ text: '  Dòng một\n  Dòng hai' }));
    expect(parsed.kind === 'text' && parsed.text).toBe('  Dòng một\n  Dòng hai');
  });

  it('văn bản quá trần -> từ chối', () => {
    expect(ok(text({ text: 'a'.repeat(ANNOTATION_TEXT_MAX) }))).toBe(true);
    expect(ok(text({ text: 'a'.repeat(ANNOTATION_TEXT_MAX + 1) }))).toBe(false);
  });

  it('cỡ chữ và độ dày nét chỉ nhận đúng các bậc có trong bộ chọn', () => {
    expect(ok(text({ fontSize: 15 }))).toBe(false);
    expect(ok(line({ width: 5 }))).toBe(false);
    expect(ok(shape({ strokeWidth: 0 }))).toBe(false);
  });

  it('trường lạ bị TỪ CHỐI, không lưu vào rồi im lặng vô tác dụng', () => {
    expect(ok(text({ fontFamily: 'Comic Sans' }))).toBe(false);
    // Trường của loại KHÁC cũng là trường lạ: một đường kẻ không có `text`.
    expect(ok(line({ text: 'x' }))).toBe(false);
  });

  it('loại chưa tồn tại (ảnh) -> từ chối', () => {
    expect(ok({ ...text(), kind: 'image' })).toBe(false);
  });

  it('nhỏ tới MỘT ô lưới được — khác biểu đồ', () => {
    expect(ok(line({ w: 1, h: 1 }))).toBe(true);
    expect(ok(line({ w: 0 }))).toBe(false);
  });

  it('bề rộng bị KẸP vào mép phải, không bị từ chối', () => {
    expect(reportAnnotationSchema.parse(text({ x: 9, w: 6 })).w).toBe(3);
  });
});

describe('§10.18 đọc khoan dung', () => {
  it('chú thích hỏng bị bỏ qua TỪNG cái, không kéo cả trang theo', () => {
    const list = parseAnnotations([text(), { kind: 'text' }, null, 'rác', shape()]);
    expect(list.map((a) => a.id)).toEqual(['t1', 's1']);
  });

  it('bản ghi trước §10.18 — không có trường, hoặc không phải mảng — là mảng rỗng', () => {
    expect(parseAnnotations(undefined)).toEqual([]);
    expect(parseAnnotations({ t1: text() })).toEqual([]);
  });
});

describe('§10.18 chú thích trong khung', () => {
  const visual = (id: string): Record<string, unknown> => ({
    id,
    chartType: 'bar',
    config: { dimensionId: 1, measureId: 2, limit: 10 },
    x: 0,
    y: 0,
    w: 6,
    h: 6,
  });

  const canvas = (pages: Record<string, unknown>[]) => reportCanvasSchema.safeParse({ pages });

  it('trang KHÔNG có `annotations` (client cũ) được nhận, và đọc ra mảng rỗng', () => {
    const parsed = canvas([{ id: 'p1', name: 'Một', visuals: [visual('a')] }]);
    expect(parsed.success && parsed.data.pages[0]?.annotations).toEqual([]);
  });

  it('hình dạng §10.10 (`{ visuals }`) cũng ra mảng rỗng', () => {
    const parsed = reportCanvasSchema.safeParse({ visuals: [visual('a')] });
    expect(parsed.success && parsed.data.pages[0]?.annotations).toEqual([]);
  });

  it('mã chú thích trùng mã biểu đồ — kể cả ở trang khác — bị từ chối', () => {
    expect(
      canvas([
        { id: 'p1', name: 'Một', visuals: [visual('a')] },
        { id: 'p2', name: 'Hai', visuals: [], annotations: [text({ id: 'a' })] },
      ]).success,
    ).toBe(false);
  });

  it('trần chú thích là của MỖI TRANG và KHÔNG cộng vào trần biểu đồ', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => text({ id: `t${i}`, y: i }));

    expect(
      canvas([
        {
          id: 'p1',
          name: 'Một',
          visuals: [visual('a')],
          annotations: many(CANVAS_MAX_ANNOTATIONS),
        },
      ]).success,
    ).toBe(true);
    expect(
      canvas([
        {
          id: 'p1',
          name: 'Một',
          visuals: [visual('a')],
          annotations: many(CANVAS_MAX_ANNOTATIONS + 1),
        },
      ]).success,
    ).toBe(false);
  });

  it('chú thích KHÔNG thay được biểu đồ trong luật "ít nhất một ô"', () => {
    expect(canvas([{ id: 'p1', name: 'Một', visuals: [], annotations: [text()] }]).success).toBe(
      false,
    );
  });
});
