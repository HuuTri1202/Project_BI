import { hashKey } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { dataModelKeys } from '../src/features/datamodels/keys';
import {
  emptyVisual,
  previewConfigOfDraft,
  previewConfigOfDto,
  type VisualDraft,
} from '../src/features/reports/builder/visual';
import {
  clearSnapshots,
  readSnapshot,
  snapshotIdOf,
  writeSnapshot,
} from '../src/services/querySnapshots';

/**
 * Ảnh chụp số liệu — thứ làm một báo cáo đã lưu vẽ ra ngay khi mở.
 *
 * ─── Vì sao khối này tồn tại ────────────────────────────────────────────────
 *
 * Cache sai nguy hiểm hơn không có cache: nó không hỏng ra mặt, nó vẽ một biểu
 * đồ trông hoàn toàn bình thường bằng số của một câu hỏi khác. Nên phần lớn ca
 * dưới đây kiểm chuyện TRƯỢT — đổi cấu hình, đổi mô hình, đổi phiên — chứ
 * không phải chuyện trúng.
 */

const DATA = {
  rows: [{ label: 'Ha Noi', value: 12 }],
  dimensionLabel: 'Khu vuc',
  measureLabel: 'Doanh thu',
  grouped: false,
};

const CONFIG = {
  dimensionId: 1264,
  measureId: 486,
  limit: 20,
  pick: 'top' as const,
  seriesDimensionId: null,
};

const OPTIONS = {
  sort: 'value' as const,
  palette: 'brand' as const,
  stacked: true,
  showLegend: true,
  showValues: false,
};

const idOf = (modelId: number, config: unknown): string =>
  snapshotIdOf(dataModelKeys.reportPreview(modelId, config));

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('querySnapshots — chụp và đọc lại', () => {
  it('đọc lại đúng số liệu, kèm lúc nó được tính', () => {
    const before = Date.now();
    writeSnapshot(idOf(83, CONFIG), DATA);

    const hit = readSnapshot<typeof DATA>(idOf(83, CONFIG));

    expect(hit?.data).toEqual(DATA);
    expect(hit?.at).toBeGreaterThanOrEqual(before);
  });

  it('chưa chụp bao giờ thì trả `null`, không phải một object rỗng', () => {
    // `initialData` của react-query phân biệt hai thứ đó: một object rỗng là
    // "đã có dữ liệu", và query sẽ vẽ một biểu đồ không có dòng nào.
    expect(readSnapshot(idOf(83, CONFIG))).toBeNull();
  });

  it('đổi MỘT trường của cấu hình là TRƯỢT', () => {
    writeSnapshot(idOf(83, CONFIG), DATA);

    expect(readSnapshot(idOf(83, { ...CONFIG, measureId: 487 }))).toBeNull();
    expect(readSnapshot(idOf(83, { ...CONFIG, limit: 5 }))).toBeNull();
    expect(readSnapshot(idOf(83, { ...CONFIG, seriesDimensionId: 1266 }))).toBeNull();
  });

  it('đổi "giữ lại nhóm nào" là TRƯỢT — nó đổi câu hỏi gửi xuống Cube', () => {
    // `pick` nằm trong `config` chứ không trong `options` chính vì điều này.
    // Nhầm sang `options` thì nó không vào khoá, và đổi từ "lớn nhất" sang
    // "nhỏ nhất" là một lần TRÚNG cache: biểu đồ đứng yên, không request, không
    // lỗi — một ô chọn không làm gì cả.
    writeSnapshot(idOf(83, CONFIG), DATA);

    expect(readSnapshot(idOf(83, { ...CONFIG, pick: 'bottom' as const }))).toBeNull();
  });

  it('cùng cấu hình nhưng KHÁC mô hình là trượt', () => {
    // Hai mô hình có thể mang cùng dãy id chiều/thước đo mà số liệu khác hẳn.
    writeSnapshot(idOf(83, CONFIG), DATA);

    expect(readSnapshot(idOf(82, CONFIG))).toBeNull();
  });

  it('thứ tự khoá trong object KHÔNG đổi định danh', () => {
    // `hashKey` của react-query sắp thứ tự khoá trước khi băm. Nhờ vậy ảnh chụp
    // trên đĩa và mục trong bộ nhớ luôn chỉ về cùng một câu hỏi, dù hai chỗ
    // dựng object theo hai thứ tự khác nhau.
    writeSnapshot(idOf(83, CONFIG), DATA);

    const daoThuTu = {
      seriesDimensionId: null,
      pick: 'top' as const,
      limit: 20,
      measureId: 486,
      dimensionId: 1264,
    };
    expect(readSnapshot<typeof DATA>(idOf(83, daoThuTu))?.data).toEqual(DATA);
  });

  it('`clearSnapshots` xoá ảnh chụp mà KHÔNG đụng khoá của người khác', () => {
    // Token đăng nhập và workspace đang mở cũng ở trong `localStorage`. Xoá
    // nhầm chúng lúc đổi tổ chức là đá người dùng ra màn hình đăng nhập.
    window.localStorage.setItem('bi.auth.token', 'giu-lai');
    writeSnapshot(idOf(83, CONFIG), DATA);

    clearSnapshots();

    expect(readSnapshot(idOf(83, CONFIG))).toBeNull();
    expect(window.localStorage.getItem('bi.auth.token')).toBe('giu-lai');
  });
});

describe('querySnapshots — hỏng thì im lặng, không làm chết trang', () => {
  it('mục hỏng đọc ra `null` thay vì ném', () => {
    const key = `bi.qs1.${hashKey(dataModelKeys.reportPreview(83, CONFIG))}`;
    window.localStorage.setItem(key, 'không phải JSON');

    expect(() => readSnapshot(idOf(83, CONFIG))).not.toThrow();
    expect(readSnapshot(idOf(83, CONFIG))).toBeNull();
  });

  it('mục thiếu dấu thời gian bị từ chối', () => {
    // Không có `at` thì không đặt được `initialDataUpdatedAt`, và react-query
    // sẽ coi số liệu là VỪA tính xong — đúng lúc nó có thể đã cũ hàng tuần.
    const key = `bi.qs1.${hashKey(dataModelKeys.reportPreview(83, CONFIG))}`;
    window.localStorage.setItem(key, JSON.stringify({ data: DATA }));

    expect(readSnapshot(idOf(83, CONFIG))).toBeNull();
  });

  it('`localStorage` bị chặn thì đọc và ghi đều không ném', () => {
    // Chế độ riêng tư và cài đặt chặn cookie làm `localStorage` NÉM LỖI chứ
    // không trả null — xem `workspaceStorage.ts`.
    const chan = (): never => {
      throw new DOMException('bị chặn');
    };
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(chan);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(chan);

    expect(() => writeSnapshot(idOf(83, CONFIG), DATA)).not.toThrow();
    expect(readSnapshot(idOf(83, CONFIG))).toBeNull();
  });

  it('số liệu quá lớn KHÔNG được ghi', () => {
    // Một câu trả lời bất thường không được phép một mình ăn hết quota rồi đẩy
    // ảnh chụp của mọi báo cáo khác ra ngoài.
    const khongLo = {
      rows: Array.from({ length: 40_000 }, (_, i) => ({ label: `nhom-${i}`, value: i })),
    };

    writeSnapshot(idOf(83, CONFIG), khongLo);

    expect(readSnapshot(idOf(83, CONFIG))).toBeNull();
  });

  it('giữ trần số ảnh chụp, và giữ lại cái MỚI nhất', () => {
    for (let i = 0; i < 45; i++) writeSnapshot(idOf(83, { ...CONFIG, measureId: i }), { i });

    const con = Object.keys(window.localStorage).filter((k) => k.startsWith('bi.qs1.'));
    expect(con.length).toBeLessThanOrEqual(40);
    expect(readSnapshot(idOf(83, { ...CONFIG, measureId: 44 }))).not.toBeNull();
  });
});

describe('previewConfig — trình dựng và trang xem phải ra CÙNG một khoá', () => {
  const draft: VisualDraft = {
    ...emptyVisual({ x: 0, y: 0 }),
    chartType: 'bar',
    dimensionId: 1264,
    measureId: 486,
    limit: 20,
    seriesId: null,
  };

  it('ô đang soạn và ô đã lưu cho cùng một định danh', () => {
    // Đây là thứ khiến hai màn hình dùng lại số liệu của nhau. Lệch nó thì mọi
    // ca khác vẫn xanh, chỉ có ảnh chụp là không bao giờ trúng — một tính năng
    // im lặng không chạy.
    const luu = {
      limit: 20,
      measureId: 486,
      dimensionId: 1264,
      seriesDimensionId: null,
      options: OPTIONS,
    };

    expect(idOf(83, previewConfigOfDraft(draft))).toBe(idOf(83, previewConfigOfDto(luu)));
  });

  it('cấu hình cũ KHÔNG có `seriesDimensionId` lẫn `pick` vẫn khớp', () => {
    // Báo cáo lưu trước §10.9 không có hai trường đó. `{a:1}` băm ra khác
    // `{a:1, b:null}`, nên thiếu `?? null` / `?? 'top'` là mọi báo cáo cũ
    // trượt cache — tính năng vẽ-ngay im lặng không chạy cho đúng những báo cáo
    // đã tồn tại lâu nhất.
    const cu = { limit: 20, measureId: 486, dimensionId: 1264 } as Parameters<
      typeof previewConfigOfDto
    >[0];

    expect(idOf(83, previewConfigOfDto(cu))).toBe(idOf(83, previewConfigOfDraft(draft)));
  });

  it('bảng màu KHÔNG đụng tới định danh', () => {
    // Đổi màu mà trượt cache nghĩa là một lượt quét ClickHouse cho đúng con số
    // vừa quét xong.
    const a = {
      limit: 20,
      measureId: 486,
      dimensionId: 1264,
      seriesDimensionId: null,
      options: OPTIONS,
    };
    const b = { ...a, options: { ...OPTIONS, palette: 'tableau10' as const } };

    expect(idOf(83, previewConfigOfDto(a))).toBe(idOf(83, previewConfigOfDto(b)));
  });
});
