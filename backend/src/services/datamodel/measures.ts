import {
  DATAMODEL_ERROR_CODES,
  type CreateFormulaMeasureInput,
  type MeasureAgg,
} from '@bi/shared';
import type { PoolConnection } from 'mysql2/promise';

import { mysqlPool } from '../../config/mysql';
import * as datamodelsRepo from '../../repositories/datamodels';
import { HttpError, badRequest, conflict } from '../../utils/httpError';

/**
 * Thước đo — §10.6.
 *
 * ═══ Hai loại thước đo, một bảng ════════════════════════════════════════════
 *
 * `column`  — gộp MỘT cột: `sum(Sales)`, `avg(Discount)`. Nó gắn chặt với một
 *             cột, nên nó được khai ngay ở tab Schemas, trên đúng dòng cột đó.
 * `formula` — ghép HAI thước đo: `sum(Profit) / sum(Sales)`. Nó không thuộc về
 *             cột nào nên có màn quản lý riêng.
 *
 * ═══ Vì sao hai vế phải CÙNG một bảng ═══════════════════════════════════════
 *
 * Ràng buộc này trông như một giới hạn kỹ thuật, nhưng nó là một ràng buộc về
 * TÍNH ĐÚNG. Cho phép `số đơn bị trả / tổng số đơn` (hai bảng) nghĩa là mẫu số
 * và tử số đi qua một phép JOIN, và nếu khoá bên kia có giá trị trùng thì cả
 * hai vế bị nhân lên KHÔNG ĐỀU — tỉ lệ ra một con số sai mà vẫn nằm trong
 * khoảng hợp lý, tức là không ai phát hiện.
 *
 * Đây cùng một họ với việc §10.4 cố ý không có `many_to_many`. Khi chưa trả lời
 * được câu hỏi nhân bản, cách đúng là không mở cửa.
 *
 * Những tỉ lệ hay dùng nhất đều nằm trong một bảng: biên lợi nhuận, giá đơn vị,
 * tỉ lệ chiết khấu. Phần mất đi là tỉ lệ chéo bảng, và nó được ghi ra làm nợ
 * chứ không im lặng.
 */

/**
 * Tên của thước đo ĐẾM DÒNG gieo sẵn cho mỗi bảng.
 *
 * Đặt ở đây chứ không viết thẳng vào `seedMeasures`: migration 14 vá cho các mô
 * hình đã tạo trước cũng phải dùng đúng chuỗi này, và hai nơi tự gõ là hai nơi
 * lệch nhau.
 */
export const ROW_COUNT_MEASURE_NAME = 'Số dòng';

/** Tên chưa ai dùng, thêm hậu tố khi cần. `UNIQUE (datamodel_id, name)`. */
export function uniqueName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${base} (${i})`;
    if (!taken.has(candidate)) return candidate;
  }
  // 999 cột cùng tên trong một mô hình là chuyện không xảy ra; ném còn hơn
  // lặng lẽ trả về một tên đã có rồi để ràng buộc UNIQUE báo lỗi 500.
  throw badRequest('Không đặt được tên duy nhất cho thước đo.');
}

interface WantedMeasure {
  columnId: number;
  /** `null` = bỏ thước đo của cột này. */
  measureAgg: MeasureAgg | null;
}

/**
 * Đồng bộ thước đo dựng-trên-cột theo lựa chọn ở tab Schemas.
 *
 * Chạy trong CÙNG giao dịch với việc lưu cột, để không có trạng thái nửa vời
 * kiểu "vai trò đã đổi nhưng thước đo thì chưa".
 */
export async function applyColumnMeasures(
  conn: PoolConnection,
  tenantId: number,
  dataModelId: number,
  createdBy: number | null,
  wanted: WantedMeasure[],
): Promise<void> {
  if (wanted.length === 0) return;

  const columns = await datamodelsRepo.listColumns(conn, tenantId, dataModelId);
  const byId = new Map(columns.map((c) => [Number(c.id), c]));
  const taken = await datamodelsRepo.measureNames(conn, tenantId, dataModelId);

  for (const item of wanted) {
    const column = byId.get(item.columnId);
    // Id không thuộc mô hình này. Cùng lập luận với `updateColumn`: từ chối cả
    // lô thay vì lưu một phần.
    if (column === undefined) throw badRequest('Có cột không thuộc mô hình này.');

    const existing = await datamodelsRepo.findMeasureOfColumn(
      conn,
      tenantId,
      dataModelId,
      item.columnId,
    );

    if (item.measureAgg === null) {
      if (existing === null || existing.deleted) continue;

      // Xoá một thước đo đang là vế của công thức khác sẽ làm file cube sinh ra
      // tham chiếu tới hư không, và Cube hỏng biên dịch — nghĩa là CẢ tab
      // Explorer chết vì một thao tác trông vô hại. Chặn ở đây, nói tên thủ
      // phạm ra để người dùng biết phải xoá cái nào trước.
      const used = await datamodelsRepo.measuresUsing(conn, tenantId, dataModelId, existing.id);
      if (used.length > 0) {
        throw new HttpError(
          409,
          DATAMODEL_ERROR_CODES.MEASURE_IN_USE,
          `Không bỏ được thước đo của cột "${column.alias ?? column.column_name}" vì ` +
            `thước đo tính toán ${used.map((n) => `"${n}"`).join(', ')} đang dùng nó. ` +
            'Xoá thước đo tính toán đó trước.',
        );
      }

      await datamodelsRepo.softDeleteMeasure(conn, tenantId, dataModelId, existing.id);
      continue;
    }

    const base = column.alias ?? column.column_name;

    if (existing !== null) {
      // Hồi sinh đúng dòng cũ thay vì tạo dòng mới: `UNIQUE (datamodel_id,
      // name)` không tính `deleted_at`, và giữ nguyên id nghĩa là công thức nào
      // đang trỏ vào nó vẫn còn nghĩa. Xem `findMeasureOfColumn`.
      const name = existing.deleted ? uniqueName(base, taken) : base;
      await datamodelsRepo.reviveColumnMeasure(conn, tenantId, dataModelId, existing.id, {
        name,
        agg: item.measureAgg,
      });
      taken.add(name);
      continue;
    }

    const name = uniqueName(base, taken);
    await datamodelsRepo.createMeasure(conn, tenantId, {
      dataModelId,
      datamodelDatasetId: Number(column.datamodel_dataset_id),
      columnId: item.columnId,
      name,
      agg: item.measureAgg,
      createdBy,
    });
    taken.add(name);
  }
}

/**
 * Tạo thước đo tính toán, sau khi kiểm đủ ba điều kiện.
 *
 * Kiểm ở tầng dịch vụ chứ không bằng khoá ngoại — xem lý do ở migration 13. Cả
 * ba đều tra trong PHẠM VI mô hình đã lọc theo tổ chức, nên một id của tổ chức
 * khác rơi vào nhánh "không tìm thấy" chứ không đi tiếp.
 */
export async function createFormulaMeasure(
  tenantId: number,
  dataModelId: number,
  createdBy: number | null,
  input: CreateFormulaMeasureInput,
): Promise<number> {
  const measures = await datamodelsRepo.listMeasures(mysqlPool, tenantId, dataModelId);
  const byId = new Map(measures.map((m) => [m.id, m]));

  const left = byId.get(input.leftId);
  const right = byId.get(input.rightId);
  if (left === undefined || right === undefined) {
    throw badRequest('Có thước đo không còn trong mô hình. Hãy tải lại trang rồi chọn lại.');
  }

  if (left.id === right.id) {
    throw badRequest('Hai vế phải là hai thước đo khác nhau.');
  }

  if (left.datamodelDatasetId !== right.datamodelDatasetId) {
    throw new HttpError(
      400,
      DATAMODEL_ERROR_CODES.MEASURE_CROSS_DATASET,
      `Hai vế đang thuộc hai bảng khác nhau ("${left.datasetName}" và "${right.datasetName}"). ` +
        'Thước đo tính toán chỉ ghép được hai thước đo của CÙNG một bảng — ghép chéo bảng phải ' +
        'đi qua một phép nối, và nếu khoá bên kia có giá trị trùng thì tử số với mẫu số bị nhân ' +
        'lên không đều, cho ra một tỉ lệ sai mà vẫn trông hợp lý.',
    );
  }

  if (measures.some((m) => m.name === input.name)) {
    throw conflict('MeasureDuplicateName', 'Mô hình này đã có thước đo trùng tên.');
  }

  return datamodelsRepo.createFormulaMeasure(mysqlPool, tenantId, {
    dataModelId,
    datamodelDatasetId: left.datamodelDatasetId,
    name: input.name,
    op: input.op,
    leftId: left.id,
    rightId: right.id,
    format: input.format,
    createdBy,
  });
}

/** Xoá thước đo, chặn nếu còn công thức nào đang dùng nó. */
export async function deleteMeasure(
  tenantId: number,
  dataModelId: number,
  measureId: number,
): Promise<number> {
  const used = await datamodelsRepo.measuresUsing(mysqlPool, tenantId, dataModelId, measureId);
  if (used.length > 0) {
    throw new HttpError(
      409,
      DATAMODEL_ERROR_CODES.MEASURE_IN_USE,
      `Thước đo tính toán ${used.map((n) => `"${n}"`).join(', ')} đang dùng thước đo này. ` +
        'Xoá chúng trước.',
    );
  }
  return datamodelsRepo.softDeleteMeasure(mysqlPool, tenantId, dataModelId, measureId);
}
