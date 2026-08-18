import { DATAMODEL_ERROR_CODES, type WarehouseSchemaDto } from '@bi/shared';

import { mysqlPool } from '../../config/mysql';
import { withTransaction } from '../../db/tx';
import * as datamodelsRepo from '../../repositories/datamodels';
import * as datasetsRepo from '../../repositories/datasets';
import { HttpError, notFound } from '../../utils/httpError';
import { warehouseSchema } from '../ingest/loadService';
import { defaultRoleOf, isSystemColumn } from './classifyColumn';
import { generateCalcFields } from './schemaFields';

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
      createdBy: input.createdBy,
    });

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
          // `_row_index` không bao giờ hiện: nó là cột hệ thống §9 thêm vào để
          // Cube có khoá chính mà JOIN đếm đúng, không phải cột của người dùng.
          visible: !isSystemColumn(column.name),
          chType: column.type,
          ordinal: column.ordinal,
        })),
      );

      // §8.3.1: mỗi cột số đẻ ra bốn field tính toán. Chúng CHÍNH LÀ thước đo
      // của mô hình — không còn bảng `datamodel_measures` để hai nơi cùng định
      // nghĩa một thứ.
      await generateCalcFields(conn, input.tenantId, datamodelDatasetId);
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
): Promise<void> {
  const schemas = new Map<number, WarehouseSchemaDto>();
  for (const datasetId of datasetIds) {
    schemas.set(datasetId, await readSchema(tenantId, datasetId));
  }

  const existing = await datamodelsRepo.listDatasets(mysqlPool, tenantId, dataModelId);

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
          // `_row_index` không bao giờ hiện: nó là cột hệ thống §9 thêm vào để
          // Cube có khoá chính mà JOIN đếm đúng, không phải cột của người dùng.
          visible: !isSystemColumn(column.name),
          chType: column.type,
          ordinal: column.ordinal,
        })),
      );

      await generateCalcFields(conn, tenantId, datamodelDatasetId);
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
