import type { DatasetColumnDto, ReportConfigDto, ReportDataDto } from '@bi/shared';

import { parseNumber } from './inferType';

/**
 * Tổng hợp dữ liệu thô thành các điểm của biểu đồ (§7.6).
 *
 * ─── Vì sao tính ở server chứ không ở trình duyệt ───────────────────────────
 *
 * Gửi 50.000 dòng về để trình duyệt nhóm lại thành 20 cột là gửi thừa 49.980
 * dòng. Với biểu đồ tròn thì còn tệ hơn: toàn bộ dữ liệu nghiệp vụ của một công
 * ty đi qua mạng để vẽ năm lát cắt.
 *
 * Frontend nhận đúng thứ nó vẽ, không tính lại gì. Nhờ vậy đổi cách tính sau này
 * là sửa một file, không phải giữ hai bản logic khớp nhau ở hai ngôn ngữ.
 *
 * ─── Vì sao KHÔNG dùng GROUP BY của MySQL ───────────────────────────────────
 *
 * Dữ liệu nằm trong cột JSON, nên nhóm bằng SQL phải là
 * `GROUP BY data->>'$.<tên field>'` — nghĩa là nội suy một chuỗi do NGƯỜI DÙNG
 * đặt vào câu lệnh. Tên field có dấu nháy hoặc dấu chấm là hỏng, và đó cũng đúng
 * là hình dạng của một lỗ hổng SQL injection.
 *
 * Nhóm trong TypeScript thì tên field chỉ là một khoá trong Map, không bao giờ
 * là mã. Đổi lại phải đọc hết dòng lên bộ nhớ — chấp nhận được ở trần 50.000
 * dòng, và đó chính là lý do có trần đó.
 */

/** Nhãn cho phần bị gộp lại khi số nhóm vượt `config.limit`. */
const OTHER_LABEL = 'Khác';

export function aggregate(
  rows: readonly Record<string, unknown>[],
  columns: readonly DatasetColumnDto[],
  config: ReportConfigDto,
): ReportDataDto {
  const dimensionCol = columns.find((c) => c.fieldName === config.dimension);
  const measureCol =
    config.measure === null ? null : columns.find((c) => c.fieldName === config.measure) ?? null;

  const buckets = new Map<string, number[]>();

  for (const row of rows) {
    // Ô trống thành "(trống)" chứ không bị bỏ qua: một cột thiếu một nửa dữ liệu
    // là điều người xem CẦN thấy trên biểu đồ, không phải điều nên giấu đi.
    const rawLabel = row[config.dimension];
    const label = toLabel(rawLabel);

    let values = buckets.get(label);
    if (!values) {
      values = [];
      buckets.set(label, values);
    }

    if (config.aggregate === 'count') {
      values.push(1);
      continue;
    }

    // Ô không đọc được thành số bị BỎ QUA khỏi phép tính, chứ không tính là 0.
    // Tính là 0 sẽ kéo giá trị trung bình xuống theo số ô trống — một cột có
    // nửa số ô bỏ trống sẽ hiện trung bình bằng một nửa giá trị thật.
    const n = config.measure === null ? null : parseNumber(String(row[config.measure] ?? ''));
    if (n !== null) values.push(n);
  }

  const all = [...buckets.entries()].map(([label, values]) => ({
    label,
    value: reduce(values, config.aggregate),
  }));

  all.sort((a, b) => b.value - a.value);

  const limit = Math.max(1, config.limit);
  const grouped = all.length > limit;

  const shown = grouped
    ? [
        ...all.slice(0, limit),
        // Chỉ gộp được khi phép tính CỘNG ĐƯỢC. Trung bình của các trung bình
        // không phải trung bình, và "Khác" của phép min/max thì vô nghĩa — nên
        // ở những phép đó ta cắt bớt và nói rõ bằng cờ `grouped`.
        ...(isAdditive(config.aggregate)
          ? [{ label: OTHER_LABEL, value: sum(all.slice(limit).map((d) => d.value)) }]
          : []),
      ]
    : all;

  return {
    rows: shown,
    dimensionLabel: dimensionCol?.fieldName ?? config.dimension,
    measureLabel: measureLabel(config, measureCol),
    grouped,
  };
}

function toLabel(raw: unknown): string {
  if (raw === null || raw === undefined) return '(trống)';
  const s = String(raw).trim();
  return s === '' ? '(trống)' : s;
}

function reduce(values: readonly number[], aggregateType: ReportConfigDto['aggregate']): number {
  if (values.length === 0) return 0;

  switch (aggregateType) {
    case 'count':
      return values.length;
    case 'sum':
      return round(sum(values));
    case 'avg':
      return round(sum(values) / values.length);
    case 'min':
      return round(Math.min(...values));
    case 'max':
      return round(Math.max(...values));
  }
}

function sum(values: readonly number[]): number {
  return values.reduce((acc, n) => acc + n, 0);
}

/**
 * Làm tròn tới 4 chữ số thập phân.
 *
 * Cộng số thực nhị phân cho ra `0.30000000000000004`, và con số đó đi thẳng lên
 * nhãn biểu đồ. Bốn chữ số đủ cho mọi con số nghiệp vụ và cắt được toàn bộ phần
 * rác của dấu phẩy động.
 */
function round(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

function isAdditive(aggregateType: ReportConfigDto['aggregate']): boolean {
  return aggregateType === 'sum' || aggregateType === 'count';
}

function measureLabel(
  config: ReportConfigDto,
  measureCol: DatasetColumnDto | null | undefined,
): string {
  if (config.aggregate === 'count') return 'Số dòng';
  const name = measureCol?.fieldName ?? config.measure ?? '';
  const verb: Record<ReportConfigDto['aggregate'], string> = {
    sum: 'Tổng',
    avg: 'Trung bình',
    count: 'Số dòng',
    min: 'Nhỏ nhất',
    max: 'Lớn nhất',
  };
  return `${verb[config.aggregate]} ${name}`.trim();
}
