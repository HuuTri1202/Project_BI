import type { ReportDataDto, ReportModelConfigDto } from '@bi/shared';

import { mysqlPool } from '../../config/mysql';
import * as datamodelsRepo from '../../repositories/datamodels';
import { runExplorerQuery } from './explorer';

/**
 * Số liệu cho một báo cáo dựng trên MÔ HÌNH — §10.8.
 *
 * ═══ Vì sao đi qua `runExplorerQuery` chứ không tự gọi Cube ══════════════════
 *
 * Explorer và báo cáo hỏi cùng một câu: "gộp thước đo này theo chiều kia". Cho
 * mỗi bên tự dựng truy vấn nghĩa là hai đường tới cùng một con số, và chúng sẽ
 * lệch nhau — thường là ở những chỗ khó thấy nhất, như thứ tự sắp xếp hay cách
 * hạ kiểu của một ô NULL. Khi đó biểu đồ và bảng Explorer nói hai điều khác
 * nhau về cùng một dữ liệu, và không ai biết bên nào đúng.
 *
 * Đi chung còn thừa hưởng miễn phí: token Cube ngắn hạn, việc tra ID trong
 * phạm vi đã lọc theo tổ chức, và `FIELD_UNKNOWN` khi ai đó xoá mất thước đo mà
 * báo cáo đang dùng.
 *
 * ═══ Vì sao hỏi thừa MỘT dòng ═══════════════════════════════════════════════
 *
 * Biểu đồ cắt ở `limit` nhóm. Nhưng "cắt rồi" và "vừa đủ" trông y hệt nhau trên
 * màn hình, nên người xem không phân biệt được "5 vùng" với "5 vùng lớn nhất
 * trong 13". Hỏi `limit + 1` rồi bỏ dòng cuối là cách rẻ nhất biết được điều
 * đó — không tốn thêm một vòng tới Cube như cách đếm nhóm riêng.
 */

const OTHER_LABEL = 'Khác';
const EMPTY_LABEL = '(trống)';

/** Trần cứng, kể cả khi cấu hình cũ lưu một số lớn hơn. */
const MAX_GROUPS = 100;

export async function aggregateFromModel(
  tenantId: number,
  userId: number,
  dataModelId: number,
  config: ReportModelConfigDto,
): Promise<ReportDataDto> {
  const limit = Math.min(MAX_GROUPS, Math.max(1, config.limit));

  const result = await runExplorerQuery(tenantId, userId, dataModelId, {
    dimensionIds: [config.dimensionId],
    measureIds: [config.measureId],
    limit: limit + 1,
  });

  // `buildQuery` đẩy chiều trước, thước đo sau, và luôn đúng hai cột vì ta gửi
  // đúng một ID mỗi loại.
  const [dimensionCol, measureCol] = result.columns;

  const all = result.rows.map((row) => ({
    // Ô trống là thứ người xem CẦN thấy, không phải thứ nên giấu — cùng lập
    // luận với `aggregateWarehouse`.
    label: labelOf(row[0] ?? null),
    value: Number(row[1] ?? 0),
  }));

  const grouped = all.length > limit;
  const rows = all.slice(0, limit);

  if (grouped) {
    /*
     * Chỉ gộp "Khác" khi phép tính CỘNG ĐƯỢC — nguyên văn luật của
     * `aggregateWarehouse`. Trung bình của các trung bình không phải trung
     * bình, và "Khác" của min/max thì vô nghĩa.
     *
     * Thước đo TÍNH TOÁN (§10.6) luôn rơi vào nhánh không cộng được, kể cả khi
     * hai vế của nó đều là tổng: tổng của các tỉ lệ không phải một tỉ lệ.
     */
    const measures = await datamodelsRepo.listMeasures(mysqlPool, tenantId, dataModelId);
    const measure = measures.find((m) => m.id === config.measureId);
    const additive =
      measure !== undefined &&
      measure.kind === 'column' &&
      (measure.agg === 'sum' || measure.agg === 'count');

    if (additive) {
      // Tổng của TOÀN BỘ, không phải tổng phần đang hiện. Một truy vấn nữa là
      // giá phải trả; đọc cả danh sách nhóm về Node để tự cộng thì một chiều có
      // một triệu giá trị phân biệt sẽ kéo một triệu dòng qua mạng.
      const total = await runExplorerQuery(tenantId, userId, dataModelId, {
        dimensionIds: [],
        measureIds: [config.measureId],
        limit: 1,
      });

      const grand = Number(total.rows[0]?.[0] ?? 0);
      const shown = rows.reduce((acc, r) => acc + r.value, 0);
      rows.push({ label: OTHER_LABEL, value: round(grand - shown) });
    }
  }

  return {
    rows,
    dimensionLabel: dimensionCol?.label ?? '',
    // Nhãn là TÊN thước đo, không phải "Tổng <cột>" như nhánh bộ dữ liệu: ở đây
    // phép gộp đã nằm trong định nghĩa của thước đo, và người dùng đặt tên cho
    // nó rồi. Ghép thêm "Tổng" vào trước sẽ ra "Tổng Biên lợi nhuận".
    measureLabel: measureCol?.label ?? '',
    grouped,
    format: measureCol?.format,
  };
}

/** Cube trả về chuỗi, số, hoặc null cho một chiều. Biểu đồ chỉ nhận chuỗi. */
function labelOf(cell: string | number | null): string {
  if (cell === null) return EMPTY_LABEL;
  const text = String(cell).trim();
  return text === '' ? EMPTY_LABEL : text;
}

/** Cùng thang làm tròn với `aggregateWarehouse` — cắt rác dấu phẩy động. */
function round(n: number): number {
  return Math.round(n * 10 ** 4) / 10 ** 4;
}
