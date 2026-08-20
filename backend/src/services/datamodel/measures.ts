import {
  DATAMODEL_ERROR_CODES,
  MEASURE_AGGS_BY_CUBE_TYPE,
  MEASURE_AGG_LABELS,
  measureAggAllowed,
  type CreateFormulaMeasureInput,
  type MeasureAgg,
  type MeasureFormat,
  type MeasureOp,
} from '@bi/shared';
import type { PoolConnection } from 'mysql2/promise';

import { mysqlPool } from '../../config/mysql';
import * as datamodelsRepo from '../../repositories/datamodels';
import { cubeTypeOf } from './classifyColumn';
import { HttpError, badRequest, conflict } from '../../utils/httpError';

/**
 * Thước đo — §10.6.
 *
 * ═══ Ba loại thước đo, một bảng ═════════════════════════════════════════════
 *
 * `column`  — gộp MỘT cột: `sum(Sales)`, `avg(Discount)`. Nó gắn chặt với một
 *             cột, nên nó được khai ngay ở tab Schemas, trên đúng dòng cột đó.
 * `formula` — ghép HAI thước đo ĐÃ GỘP: `sum(Profit) / sum(Sales)`. Nó không
 *             thuộc về cột nào nên có màn quản lý riêng.
 * `rowExpr` — gộp trên BIỂU THỨC DÒNG: `sum(Quantity × Unit price)`. Hai vế là
 *             cột thô, phép nhân chạy trên từng dòng rồi `agg` mới chạy.
 *
 * ─── `formula` và `rowExpr` KHÔNG thay thế nhau ────────────────────────────
 *
 * Với phép NHÂN thì `formula` cho ra `sum(a) × avg(b)` — một con số không ai đi
 * hỏi, và nó sai theo kiểu nguy hiểm nhất là trông hợp lý (đo được: lệch 0,047%
 * trên 22.463 dòng thật). Với phép CHIA thì ngược lại, `formula` mới đúng: tỷ
 * suất là tỷ số của hai TỔNG, không phải trung bình của các tỷ số từng dòng.
 *
 * Xem `defaultKindForOp` ở `shared` — luật chọn mặc định đến từ đại số chứ
 * không từ nghiệp vụ, nên nó đúng với mọi ngành.
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

/**
 * Phép gộp phải hợp với KIỂU của cột.
 *
 * Không có bước này thì `sum` trên một cột `String` được lưu êm ru, rồi hỏng ở
 * tab Explorer — cách chỗ gây lỗi hai màn hình, và với một thông báo của
 * ClickHouse mà người dùng không đọc nổi.
 *
 * Giao diện đã lọc danh sách theo kiểu, nhưng giao diện không phải nơi ràng
 * buộc sống: có HAI đường tạo thước đo dựng-trên-cột (lưu tab Schemas và
 * `POST /measures`), và cả hai đều nhận bất cứ giá trị nào trong ENUM.
 */
export function assertAggFitsColumn(
  column: { alias: string | null; column_name: string; ch_type: string },
  agg: MeasureAgg,
): void {
  const cubeType = cubeTypeOf(column.ch_type);
  if (measureAggAllowed(cubeType, agg)) return;

  const choPhep = MEASURE_AGGS_BY_CUBE_TYPE[cubeType]
    .map((a) => `"${MEASURE_AGG_LABELS[a]}"`)
    .join(', ');
  throw badRequest(
    `Cột "${column.alias ?? column.column_name}" kiểu ${column.ch_type} không nhận phép ` +
      `gộp "${MEASURE_AGG_LABELS[agg]}". Chỉ nhận: ${choPhep}.`,
  );
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

    if (item.measureAgg !== null) assertAggFitsColumn(column, item.measureAgg);

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

export interface CreateRowExprMeasureInput {
  name: string;
  agg: MeasureAgg;
  leftColumnId: number;
  op: MeasureOp;
  rightColumnId: number;
  format: MeasureFormat;
}

/**
 * Thước đo GỘP TRÊN BIỂU THỨC DÒNG — `sum(Số lượng × Đơn giá)`.
 *
 * ═══ Vì sao nó không phải là một tuỳ chọn của `formula` ════════════════════
 *
 * `formula` gộp hai vế TRƯỚC rồi mới tính, nên với phép nhân nó cho ra
 * `sum(a) × avg(b)`. Đo trên `Orders_detail` của tổ chức 4, 22.463 dòng:
 *
 *     sum(Số lượng × Đơn giá)      39.379.467.000   đúng
 *     sum(Số lượng) × avg(Đơn giá) 39.398.064.742   lệch 0,047%
 *
 * Lệch 0,047% là chỗ NGUY HIỂM chứ không phải chỗ may: không ai phát hiện ra.
 * Đây là một lớp câu hỏi mà mô hình cũ không trả lời đúng được, chứ không phải
 * một lối viết khác cho cùng một câu.
 *
 * ─── Ba ràng buộc, mỗi cái chặn một cách ra số sai ─────────────────────────
 *
 *   1. Hai cột phải thuộc CÙNG một bảng. Nhân hai cột của hai bảng khác nhau
 *      chỉ có nghĩa sau một phép nối, mà phép nối thì nhân bản dòng — cùng lý
 *      lẽ đã ghi cho `MEASURE_CROSS_DATASET` ở `createFormulaMeasure`.
 *   2. Hai cột phải là cột SỐ. `Tên khách × Đơn giá` là câu SQL không chạy, và
 *      nó chỉ nổ ở tận Explorer nếu không chặn tại đây.
 *   3. Phép gộp phải hợp với kiểu — dùng lại `assertAggFitsColumn`, cùng bảng
 *      luật mà tab Schemas dùng.
 *
 * Hai vế ĐƯỢC PHÉP trùng nhau: `sum(x × x)` là bình phương, một câu hỏi thật
 * (phương sai, diện tích). Khác `formula`, nơi `a / a` luôn bằng 1.
 */
export async function createRowExprMeasure(
  tenantId: number,
  dataModelId: number,
  createdBy: number | null,
  input: CreateRowExprMeasureInput,
): Promise<number> {
  const columns = await datamodelsRepo.listColumns(mysqlPool, tenantId, dataModelId);
  const byId = new Map(columns.map((c) => [Number(c.id), c]));

  const left = byId.get(input.leftColumnId);
  const right = byId.get(input.rightColumnId);
  if (left === undefined || right === undefined) {
    throw badRequest('Có cột không còn trong mô hình. Hãy tải lại trang rồi chọn lại.');
  }

  if (left.datamodel_dataset_id !== right.datamodel_dataset_id) {
    throw new HttpError(
      400,
      DATAMODEL_ERROR_CODES.MEASURE_CROSS_DATASET,
      'Hai cột đang thuộc hai bảng khác nhau. Nhân hoặc chia hai cột chỉ có nghĩa khi chúng ' +
        'nằm trên CÙNG một dòng — ghép chéo bảng phải đi qua một phép nối, và phép nối thì ' +
        'nhân bản dòng nên con số ra sẽ sai mà vẫn trông hợp lý.',
    );
  }

  for (const column of [left, right]) {
    if (cubeTypeOf(column.ch_type) !== 'number') {
      throw badRequest(
        `Cột "${column.alias ?? column.column_name}" kiểu ${column.ch_type} không phải cột số, ` +
          'nên không nhân hay chia được.',
      );
    }
  }

  assertAggFitsColumn(left, input.agg);

  const names = await datamodelsRepo.measureNames(mysqlPool, tenantId, dataModelId);
  if (names.has(input.name)) {
    throw conflict('MeasureDuplicateName', 'Mô hình này đã có thước đo trùng tên.');
  }

  return datamodelsRepo.createRowExprMeasure(mysqlPool, tenantId, {
    dataModelId,
    datamodelDatasetId: Number(left.datamodel_dataset_id),
    name: input.name,
    agg: input.agg,
    leftColumnId: Number(left.id),
    op: input.op,
    rightColumnId: Number(right.id),
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
