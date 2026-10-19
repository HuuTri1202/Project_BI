import { FILTER_OPERATORS, type MeasureSourceDto } from '@bi/shared';
import { describe, expect, it } from 'vitest';

import { explorerFilterSchema, explorerQueryBodySchema } from '../src/api/v1/schemas';
import { buildQuery, type ModelIndex } from '../src/services/datamodel/explorer';

/**
 * Bộ LỌC của một câu hỏi — §10.7.
 *
 * ═══ Bộ này canh gì ════════════════════════════════════════════════════════
 *
 * Bộ lọc là chỗ đầu tiên trong cả tầng này nhận CHUỖI của người dùng. Trước nó,
 * mọi thứ đi vào truy vấn đều là id, và luật "chuỗi vào truy vấn phải lấy từ
 * database của ta" giữ được tuyệt đối. Nên bốn thứ phải được canh riêng:
 *
 *   1. ĐỊNH DANH vẫn do ta dựng. `member` phải sinh từ `dimensionId` tra trong
 *      chỉ mục, không bao giờ từ một chuỗi trong thân request. Hỏng chỗ này là
 *      mở đường cho một câu hỏi trỏ sang cube của mô hình khác.
 *   2. Id lạ bị CHẶN, không bị bỏ qua. Bỏ qua im lặng nghĩa là câu trả lời tính
 *      trên một tập dữ liệu rộng hơn điều kiện người dùng vừa nói.
 *   3. `set`/`notSet` không nhận giá trị, mọi toán tử khác phải có ít nhất một.
 *      Một `equals` với `values: []` được Cube đọc thành "không dòng nào khớp",
 *      tức biểu đồ TRẮNG mà không có lỗi nào — kiểu hỏng tệ nhất.
 *   4. Có cận trên. `values` là chuỗi tự do nên nó phải bị kẹp, nếu không một
 *      câu hỏi gửi mười nghìn giá trị là một câu SQL khổng lồ.
 */

// ─── Một chỉ mục mô hình dựng tay ────────────────────────────────────────────

const NGUON: MeasureSourceDto = { kind: 'column', text: 'amount' } as unknown as MeasureSourceDto;

/**
 * Hai chiều và một thước đo, đủ để kiểm mọi luật ở đây.
 *
 * `cubeName` cố ý KHÁC nhau giữa hai chiều: nhờ vậy một bộ lọc dựng `member` từ
 * id sai sẽ ra một chuỗi khác hẳn, nhìn là thấy.
 */
function chiMuc(): ModelIndex {
  return {
    columns: new Map([
      [11, { cubeName: 'c_orders', label: 'Khu vực', chType: 'String', datasetName: 'Orders' }],
      [
        12,
        { cubeName: 'c_products', label: 'Sản phẩm', chType: 'String', datasetName: 'Products' },
      ],
    ]),
    measures: new Map([
      [
        21,
        {
          cubeName: 'c_orders',
          label: 'Doanh thu',
          datasetName: 'Orders',
          format: undefined as never,
          agg: 'sum' as const,
          availableAggs: ['sum', 'avg'] as const,
          nguon: NGUON,
        },
      ],
    ]),
  };
}

/** Lọc ra mấy điều kiện có `member` — bỏ nhánh `or` để `expect` đọc được. */
function dieuKien(
  q: ReturnType<typeof buildQuery>['query'],
): { member: string; operator: string; values?: string[] }[] {
  return (q.filters ?? []).flatMap((f) => ('member' in f ? [f] : []));
}

describe('Định danh vẫn do TA dựng, chỉ giá trị là của người dùng', () => {
  it('member sinh từ dimensionId, không từ chuỗi nào trong thân request', () => {
    const { query } = buildQuery(chiMuc(), {
      dimensionIds: [11],
      measureIds: [21],
      filters: [{ dimensionId: 12, operator: 'equals', values: ['Acco'] }],
    });

    const dk = dieuKien(query);
    expect(dk).toHaveLength(1);
    // `c_products` — tên cube của chiều 12, tra trong chỉ mục. Không phải
    // `c_orders` của chiều đang vẽ, và không phải chuỗi nào người gọi gửi lên.
    expect(dk[0]?.member).toMatch(/^c_products\./);
    expect(dk[0]?.values).toEqual(['Acco']);
  });

  /*
   * ⚠️ Ca quan trọng nhất. Một id không thuộc mô hình này PHẢI nổ, không được
   * bỏ qua: bỏ qua nghĩa là câu trả lời tính trên toàn bộ dữ liệu trong khi
   * người dùng vừa nói một điều kiện — một con số có thật, cho một câu hỏi khác.
   */
  it('dimensionId không thuộc mô hình thì NỔ, không bị bỏ qua', () => {
    expect(() =>
      buildQuery(chiMuc(), {
        dimensionIds: [11],
        measureIds: [21],
        filters: [{ dimensionId: 999, operator: 'equals', values: ['x'] }],
      }),
    ).toThrow();
  });

  it('không có bộ lọc thì KHÔNG thêm khoá filters vào câu hỏi', () => {
    // Một `filters: []` thừa đổi câu lệnh hiện ra ở màn "xem câu lệnh" mà không
    // đổi kết quả — cùng lý do `offset: 0` bị bỏ.
    const { query } = buildQuery(chiMuc(), { dimensionIds: [11], measureIds: [21] });
    expect(query.filters).toBeUndefined();
  });
});

describe('Dịch toán tử', () => {
  it('toán tử nhận giá trị thì mang values theo', () => {
    for (const op of ['equals', 'notEquals', 'contains', 'notContains', 'gt', 'gte', 'lt', 'lte']) {
      const { query } = buildQuery(chiMuc(), {
        dimensionIds: [11],
        measureIds: [21],
        filters: [{ dimensionId: 11, operator: op as never, values: ['5'] }],
      });
      expect(dieuKien(query)[0]).toEqual({
        member: expect.stringMatching(/^c_orders\./) as unknown as string,
        operator: op,
        values: ['5'],
      });
    }
  });

  it('set/notSet KHÔNG mang khoá values', () => {
    for (const op of ['set', 'notSet'] as const) {
      const { query } = buildQuery(chiMuc(), {
        dimensionIds: [11],
        measureIds: [21],
        filters: [{ dimensionId: 11, operator: op, values: [] }],
      });
      // Cube từ chối `notSet` kèm `values`. Gửi một mảng rỗng là một lỗi 400 ở
      // chỗ không ai ngờ, nên khoá đó phải VẮNG hẳn.
      expect(dieuKien(query)[0]).toEqual({
        member: expect.stringMatching(/^c_orders\./) as unknown as string,
        operator: op,
      });
      expect(Object.keys(dieuKien(query)[0] ?? {})).not.toContain('values');
    }
  });

  it('mọi toán tử trong từ vựng đều dịch được', () => {
    // Thêm một toán tử vào `FILTER_OPERATORS` mà quên dạy `buildQuery` dịch nó
    // sẽ dừng ở đây, chứ không dừng ở một câu 400 của Cube lúc chạy thật.
    for (const op of FILTER_OPERATORS) {
      const coGiaTri = op !== 'set' && op !== 'notSet';
      const { query } = buildQuery(chiMuc(), {
        dimensionIds: [11],
        measureIds: [21],
        filters: [{ dimensionId: 11, operator: op, values: coGiaTri ? ['x'] : [] }],
      });
      expect(dieuKien(query)[0]?.operator).toBe(op);
    }
  });
});

describe('Nối với bộ giới hạn NỘI BỘ bằng AND', () => {
  /*
   * Bộ giới hạn top-N và bộ lọc của câu hỏi nằm trong CÙNG một mảng, nên Cube
   * nối chúng bằng AND: "nhóm nằm trong top-N VÀ vùng là Miền Bắc". Để chúng ở
   * hai chỗ là một trong hai bị bỏ, và biểu đồ vẫn vẽ ra một con số.
   */
  it('cả hai cùng có mặt', () => {
    const { query } = buildQuery(
      chiMuc(),
      {
        dimensionIds: [11],
        measureIds: [21],
        filters: [{ dimensionId: 12, operator: 'equals', values: ['Acco'] }],
      },
      { restrict: [{ dimensionId: 11, values: ['Miền Bắc'] }] },
    );

    const dk = dieuKien(query);
    expect(dk).toHaveLength(2);
    expect(dk.map((f) => f.member.split('.')[0])).toEqual(['c_orders', 'c_products']);
  });
});

describe('Hợp đồng HTTP kẹp đầu vào', () => {
  it('set/notSet kèm giá trị thì bị từ chối', () => {
    expect(
      explorerFilterSchema.safeParse({ dimensionId: 1, operator: 'set', values: ['x'] }).success,
    ).toBe(false);
    expect(
      explorerFilterSchema.safeParse({ dimensionId: 1, operator: 'notSet', values: [] }).success,
    ).toBe(true);
  });

  /*
   * ⚠️ Một `equals` với `values: []` được Cube đọc thành "không dòng nào khớp".
   * Nhận nó nghĩa là người dùng thấy một biểu đồ TRẮNG và không có gì nói vì
   * sao — tệ hơn hẳn một lỗi 400 nói đúng chuyện gì sai.
   */
  it('toán tử cần giá trị mà không có thì bị từ chối', () => {
    for (const op of ['equals', 'contains', 'gt', 'lte']) {
      expect(
        explorerFilterSchema.safeParse({ dimensionId: 1, operator: op, values: [] }).success,
      ).toBe(false);
    }
  });

  it('toán tử ngoài từ vựng bị từ chối', () => {
    // Enum đóng: không có đường nào để một toán tử lạ đi tới Cube, kể cả khi
    // người gọi là một mô hình ngôn ngữ đang điền form.
    for (const op of ['DROP TABLE', 'inDateRange', 'regex', '']) {
      expect(
        explorerFilterSchema.safeParse({ dimensionId: 1, operator: op, values: ['x'] }).success,
      ).toBe(false);
    }
  });

  it('có cận trên cho số điều kiện, số giá trị và độ dài mỗi giá trị', () => {
    const mot = (values: string[]) => ({ dimensionId: 1, operator: 'equals' as const, values });

    expect(explorerFilterSchema.safeParse(mot(Array(50).fill('x'))).success).toBe(true);
    expect(explorerFilterSchema.safeParse(mot(Array(51).fill('x'))).success).toBe(false);
    expect(explorerFilterSchema.safeParse(mot(['x'.repeat(200)])).success).toBe(true);
    expect(explorerFilterSchema.safeParse(mot(['x'.repeat(201)])).success).toBe(false);

    const than = (n: number) => ({
      dimensionIds: [1],
      measureIds: [2],
      filters: Array.from({ length: n }, () => mot(['x'])),
    });
    expect(explorerQueryBodySchema.safeParse(than(10)).success).toBe(true);
    expect(explorerQueryBodySchema.safeParse(than(11)).success).toBe(false);
  });

  it('câu hỏi KHÔNG có filters vẫn hợp lệ — mọi client cũ không phải đổi gì', () => {
    const kq = explorerQueryBodySchema.safeParse({ dimensionIds: [1], measureIds: [2] });
    expect(kq.success).toBe(true);
    expect(kq.success && kq.data.filters).toBeUndefined();
  });
});
