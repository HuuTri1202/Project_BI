import { DATAMODEL_ERROR_CODES, type WarehouseSchemaDto } from '@bi/shared';
import type { PoolConnection } from 'mysql2/promise';

import { mysqlPool } from '../../config/mysql';
import { withTransaction } from '../../db/tx';
import * as datamodelsRepo from '../../repositories/datamodels';
import * as datasetsRepo from '../../repositories/datasets';
import { HttpError, notFound } from '../../utils/httpError';
import { warehouseSchema } from '../ingest/loadService';
import { defaultAggOf, defaultRoleOf, isSystemColumn } from './classifyColumn';
import { ROW_COUNT_MEASURE_NAME, uniqueName } from './measures';

/**
 * Tạo mô hình dữ liệu — §10.2.
 *
 * ─── Vì sao đọc schema từ CLICKHOUSE chứ không từ `dataset_columns` ─────────
 *
 * `dataset_columns` mô tả NGUỒN: kiểu MySQL của bảng gốc, hoặc kiểu §7 đoán
 * được từ file. Mô hình thì dựng trên KHO, và hai thứ đó không giống nhau —
 * `decimal(10,2)` của MySQL thành `Nullable(Decimal(10, 2))`, và `_row_index`
 * không tồn tại ở phía nguồn.
 *
 * Suy diễn từ nguồn sẽ cho ra một mô hình khai một đằng còn kho chứa một nẻo,
 * và không ai phát hiện cho tới khi một biểu đồ ra số lạ. Đây đúng là lỗi cột
 * ngày Excel mà §9 đã mắc và ghi lại trong README. Nên hỏi kho.
 */

/**
 * Gieo thước đo mặc định cho mọi cột số — §10.2 gặp §10.6.
 *
 * ─── Vì sao cần, và nó được phát hiện bằng cách nào ─────────────────────────
 *
 * §10.2 phân loại `UInt/Int/Float → Measure`, nhưng `role = 'measure'` một mình
 * KHÔNG dẫn đi đâu cả: file cube lấy `measures` từ bảng `datamodel_measures`,
 * vốn là thứ §10.6 cho người dùng tự đặt. Nên một mô hình vừa tạo xong có đủ
 * chiều mà không có thước đo nào — Explorer mở ra và không đo được gì.
 *
 * Lỗ hổng này KHÔNG lộ ra ở test đơn vị lẫn test tích hợp: cả hai đều kiểm phần
 * của mình và đều xanh. Nó chỉ hiện ra khi hỏi Cube "cube này có gì" và nhận
 * được `0 thước đo`.
 *
 * Cách vá: `datamodel_measures` là NGUỒN DUY NHẤT của thước đo, và §10.2 gieo
 * sẵn một dòng `sum` cho mỗi cột số. Người dùng đổi tên, đổi phép tính, xoá,
 * hoặc thêm cái khác ở tab Thước đo — tất cả trên cùng một cơ chế.
 *
 * `sum` chứ không phải `avg`: tổng là câu hỏi hay gặp nhất với một cột số trong
 * BI, và đoán sai theo hướng tổng thì người dùng đổi trong hai giây, còn đoán
 * theo hướng trung bình thì con số trông hợp lý hơn nên dễ bị tin nhầm.
 *
 * ─── Vì sao mỗi bảng còn được gieo thêm một thước đo ĐẾM DÒNG ───────────────
 *
 * "Mỗi vùng có bao nhiêu đơn hàng" là câu hỏi phổ biến hơn mọi tỉ lệ, nhưng nó
 * KHÔNG gộp một cột nào cả — nên không có đường nào tạo nó từ tab Schemas, chỗ
 * chọn phép gộp nằm trên dòng CỘT. Không gieo sẵn thì Explorer trả lời được
 * "tổng doanh thu theo vùng" mà không trả lời được "bao nhiêu đơn theo vùng".
 *
 * Nó phải là `count` chứ không phải `sum` của một cột nào: `count(cột)` bỏ qua
 * dòng có ô trống, và hai con số đó khác nhau ở đúng những bảng dữ liệu bẩn —
 * tức là những bảng mà người dùng cần con số đúng nhất. Xem `buildCubeSchema`,
 * chỗ nó cố ý KHÔNG khai `sql` cho `count`.
 */
async function seedMeasures(
  conn: PoolConnection,
  tenantId: number,
  dataModelId: number,
  datamodelDatasetId: number,
  createdBy: number | null,
  used: Set<string>,
): Promise<void> {
  // Gieo TRƯỚC vòng lặp cột, vì Explorer xếp thước đo theo `id` tăng dần: đếm
  // dòng đứng đầu nhóm của bảng, đúng thứ tự người ta đi tìm.
  const countName = uniqueName(ROW_COUNT_MEASURE_NAME, used);
  used.add(countName);
  await datamodelsRepo.createMeasure(conn, tenantId, {
    dataModelId,
    datamodelDatasetId,
    // `null` là điều KIỆN của `agg = 'count'`, không phải chỗ còn thiếu dữ
    // liệu: đếm dòng không thuộc về cột nào.
    columnId: null,
    name: countName,
    agg: 'count',
    createdBy,
  });

  const columns = await datamodelsRepo.listColumnsOfDataset(conn, tenantId, datamodelDatasetId);

  for (const column of columns) {
    if (column.role !== 'measure') continue;

    // `UNIQUE (datamodel_id, name)` — hai bảng trong cùng mô hình rất hay có
    // cùng một cột "Doanh thu", và để nó đâm vào ràng buộc sẽ cho ra lỗi 500
    // khó hiểu ngay ở bước tạo mô hình.
    const name = uniqueName(column.alias ?? column.column_name, used);
    used.add(name);

    await datamodelsRepo.createMeasure(conn, tenantId, {
      dataModelId,
      datamodelDatasetId,
      columnId: Number(column.id),
      name,
      // `sum` cho tiền và số lượng, `avg` cho tỉ lệ — xem `defaultAggOf`. Cột
      // định danh (`Row ID`, `Postal Code`) không tới được đây: `defaultRoleOf`
      // đã xếp chúng thành CHIỀU, nên vòng lặp trên đã bỏ qua.
      agg: defaultAggOf(column.alias ?? column.column_name),
      createdBy,
    });
  }
}

/** Bố cục lưới ban đầu cho canvas — người dùng kéo lại tuỳ ý sau đó. */
const GRID_COLUMNS = 3;
const GRID_X = 280;
const GRID_Y = 220;
const GRID_MARGIN = 40;

export function initialPosition(index: number): { x: number; y: number } {
  return {
    x: GRID_MARGIN + (index % GRID_COLUMNS) * GRID_X,
    y: GRID_MARGIN + Math.floor(index / GRID_COLUMNS) * GRID_Y,
  };
}

/**
 * Đọc cấu trúc kho của một bộ dữ liệu, kèm kiểm tra nó thuộc tổ chức người gọi.
 *
 * `warehouseSchema` đã ném 404 cho id lạ và 409 cho bộ chưa nạp, nhưng thông báo
 * của nó nói về "xem dữ liệu". Ở đây ngữ cảnh khác nên đổi lại câu cho đúng
 * việc người dùng đang làm: họ vừa tích một bộ dữ liệu trong hộp thoại tạo mô
 * hình, và họ cần biết vì sao bộ đó không dùng được.
 */
async function readSchema(tenantId: number, datasetId: number): Promise<WarehouseSchemaDto> {
  const dataset = await datasetsRepo.findOne(mysqlPool, tenantId, datasetId);
  if (!dataset) throw notFound('Không tìm thấy bộ dữ liệu này.');

  if (dataset.loadStatus !== 'loaded') {
    throw new HttpError(
      409,
      DATAMODEL_ERROR_CODES.DATASET_NOT_LOADED,
      `Bộ dữ liệu "${dataset.name}" chưa được nạp vào kho phân tích nên chưa dựng mô hình lên được. Hãy nạp nó trước.`,
    );
  }

  return warehouseSchema(tenantId, datasetId);
}

export interface CreateInput {
  tenantId: number;
  workspaceId: number;
  name: string;
  description: string | null;
  datasetIds: readonly number[];
  /**
   * Người đứng tên. `null` HỢP LỆ: bộ dữ liệu đồng bộ từ CSDL (§8) không ghi
   * `created_by`, và cột trong database cũng cho phép NULL. Từ chối tạo mô hình
   * chỉ vì không biết ai đứng tên là bỏ mất cả một luồng.
   */
  createdBy: number | null;
  /**
   * Khoá gom nhóm của mô hình TỰ SINH — migration 19.
   *
   * Bỏ trống với mô hình do người dùng tự tạo: cột này vừa là dấu "do máy tạo"
   * vừa là khoá để bảng thứ hai của cùng một lần tải tìm về đúng mô hình.
   */
  autoBatchKey?: string | null;
}

export async function createDataModel(input: CreateInput): Promise<number> {
  // Đọc cấu trúc TRƯỚC khi mở transaction: mỗi lần đọc là một vòng HTTP tới
  // ClickHouse, và giữ một transaction MySQL mở suốt vài lời gọi mạng là cách
  // khoá bảng lâu hơn cần thiết. Lỗi ở đây cũng cho ra 404/409 sạch sẽ mà không
  // phải rollback gì.
  const schemas = new Map<number, WarehouseSchemaDto>();
  for (const datasetId of input.datasetIds) {
    schemas.set(datasetId, await readSchema(input.tenantId, datasetId));
  }

  return withTransaction(async (conn) => {
    const dataModelId = await datamodelsRepo.create(conn, input.tenantId, {
      workspaceId: input.workspaceId,
      name: input.name,
      description: input.description,
      autoBatchKey: input.autoBatchKey ?? null,
      createdBy: input.createdBy,
    });

    // Tên thước đo duy nhất trong PHẠM VI MÔ HÌNH, không phải phạm vi bảng.
    const usedMeasureNames = new Set<string>();

    for (const [index, datasetId] of input.datasetIds.entries()) {
      const position = initialPosition(index);
      const datamodelDatasetId = await datamodelsRepo.addDataset(conn, input.tenantId, {
        dataModelId,
        datasetId,
        canvasX: position.x,
        canvasY: position.y,
      });

      const schema = schemas.get(datasetId);
      if (schema === undefined) continue;

      await datamodelsRepo.insertColumns(
        conn,
        input.tenantId,
        datamodelDatasetId,
        schema.columns.map((column) => ({
          columnName: column.name,
          // Alias để trống chứ KHÔNG chép sẵn tên cột: `null` phân biệt được
          // "người dùng chưa đặt tên" với "người dùng đặt trùng tên cột". Chép
          // sẵn thì lần đồng bộ lại không biết có được cập nhật hay không.
          alias: null,
          role: defaultRoleOf(column.name, column.type),
          chType: column.type,
          ordinal: column.ordinal,
        })),
      );

      await seedMeasures(
        conn,
        input.tenantId,
        dataModelId,
        datamodelDatasetId,
        input.createdBy,
        usedMeasureNames,
      );
    }

    return dataModelId;
  });
}

/**
 * Thêm bộ dữ liệu vào mô hình đã có.
 *
 * Vị trí lưới tiếp nối số thẻ đang có, để thẻ mới không đè lên thẻ cũ.
 */
export async function addDatasets(
  tenantId: number,
  dataModelId: number,
  datasetIds: readonly number[],
  // `null` hợp lệ, cùng lý do đã ghi ở `CreateInput.createdBy`: đường tự sinh
  // gọi hàm này cho bộ dữ liệu đồng bộ từ CSDL, vốn không có `created_by`.
  createdBy: number | null,
): Promise<void> {
  const schemas = new Map<number, WarehouseSchemaDto>();
  for (const datasetId of datasetIds) {
    schemas.set(datasetId, await readSchema(tenantId, datasetId));
  }

  const existing = await datamodelsRepo.listDatasets(mysqlPool, tenantId, dataModelId);

  // Tên thước đo đang dùng, để cột "Doanh thu" của bảng mới không đâm vào cột
  // cùng tên của bảng đã có trong mô hình.
  const usedMeasureNames = new Set(
    (await datamodelsRepo.listMeasures(mysqlPool, tenantId, dataModelId)).map((m) => m.name),
  );

  await withTransaction(async (conn) => {
    for (const [index, datasetId] of datasetIds.entries()) {
      const position = initialPosition(existing.length + index);
      const datamodelDatasetId = await datamodelsRepo.addDataset(conn, tenantId, {
        dataModelId,
        datasetId,
        canvasX: position.x,
        canvasY: position.y,
      });

      const schema = schemas.get(datasetId);
      if (schema === undefined) continue;

      await datamodelsRepo.insertColumns(
        conn,
        tenantId,
        datamodelDatasetId,
        schema.columns.map((column) => ({
          columnName: column.name,
          alias: null,
          role: defaultRoleOf(column.name, column.type),
          chType: column.type,
          ordinal: column.ordinal,
        })),
      );

      await seedMeasures(
        conn,
        tenantId,
        dataModelId,
        datamodelDatasetId,
        createdBy,
        usedMeasureNames,
      );
    }

    await datamodelsRepo.touch(conn, tenantId, dataModelId);
  });
}

/**
 * Cột nào hiện ra cho người dùng chọn.
 *
 * Cột hệ thống bị loại ở đây thay vì ở từng màn hình — ba nơi cần câu trả lời
 * này và ba nơi tự lọc là ba cơ hội để lệch nhau.
 */
export function isPickable(columnName: string): boolean {
  return !isSystemColumn(columnName);
}
