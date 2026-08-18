import type { SchemaSyncResultDto } from '@bi/shared';
import type { PoolConnection } from 'mysql2/promise';

import { mysqlPool } from '../../config/mysql';
import { withTransaction } from '../../db/tx';
import * as datamodelsRepo from '../../repositories/datamodels';
import { warehouseSchema } from '../ingest/loadService';
import { cubeTypeOf, defaultRoleOf, isSystemColumn } from './classifyColumn';

/**
 * Field của một Schema — §8.3.1.
 *
 * ─── Mỗi cột SỐ đẻ ra bốn field tính toán ───────────────────────────────────
 *
 *     doanh_thu_count           đếm dòng
 *     doanh_thu_countDistinct   đếm giá trị khác nhau
 *     doanh_thu_sum             tổng
 *     doanh_thu_avg             trung bình
 *
 * Chúng CHÍNH LÀ thước đo của mô hình. Trước bản này §10.6 có một bảng
 * `datamodel_measures` riêng, và hệ quả là hai nơi cùng định nghĩa "thước đo" —
 * một cái người dùng đặt tay, một cái sinh tự động, và không ai trả lời được
 * cái nào là nguồn đúng. Giờ chỉ còn một: danh sách field.
 *
 * ─── Vì sao sinh cho MỌI cột số, kể cả cột không ai cộng bao giờ ────────────
 *
 * `id` và `khach_hang_id` cũng là cột số, và "tổng các mã khách hàng" thì vô
 * nghĩa. Nhưng đoán xem cột nào đáng đo là đoán sai theo cách khó sửa: bỏ sót
 * một cột nghĩa là người dùng không có cách nào đo nó. Sinh hết rồi cho họ TẮT
 * Visibility những cái không cần — cùng lập luận với việc `inferType` của §7
 * nghiêng về `text` rồi để người dùng sửa tay.
 */

/** Cột số nào cũng sinh field tính toán. Cột hệ thống thì không. */
function shouldGenerate(columnName: string, chType: string): boolean {
  return !isSystemColumn(columnName) && cubeTypeOf(chType) === 'number';
}

/**
 * Sinh field tính toán cho mọi cột số của một Schema.
 *
 * Gọi được nhiều lần: `insertCalcFields` dùng `INSERT IGNORE` và ràng buộc
 * `UNIQUE (datamodel_dataset_id, column_name)` là thứ thật sự chặn trùng.
 */
export async function generateCalcFields(
  conn: PoolConnection,
  tenantId: number,
  datamodelDatasetId: number,
): Promise<number> {
  const fields = await datamodelsRepo.listColumnsOfDataset(conn, tenantId, datamodelDatasetId);
  let created = 0;

  for (const field of fields) {
    // Chỉ cột THẬT mới sinh; một field tính toán không đẻ ra field tính toán.
    if (field.calc_agg !== null) continue;
    if (!shouldGenerate(field.column_name, field.ch_type)) continue;

    created += await datamodelsRepo.insertCalcFields(conn, tenantId, datamodelDatasetId, {
      id: Number(field.id),
      columnName: field.column_name,
      chType: field.ch_type,
      ordinal: Number(field.ordinal),
    });
  }

  return created;
}

/**
 * Nút Sync ở tab Schemas — đọc lại ClickHouse rồi hoà với những gì đã lưu.
 *
 * ─── Ba việc, và thứ tự giữa chúng quan trọng ───────────────────────────────
 *
 *   1. Cột MỚI trong kho  -> thêm field, rồi sinh field tính toán nếu là số.
 *   2. Cột ĐỔI KIỂU       -> cập nhật `ch_type`. Một cột từ `Int64` thành
 *                            `String` khiến mọi field `_sum` dựng trên nó chạy
 *                            trên văn bản và trả về 0 mà không báo lỗi.
 *   3. Cột BIẾN MẤT       -> xoá field. Field tính toán CASCADE theo nó, nên
 *                            không phải dọn tay.
 *
 * GIỮ NGUYÊN mọi thứ người dùng đã đặt: Display Name, Description, Visibility.
 * Sync là đồng bộ CẤU TRÚC, không phải đặt lại cấu hình — làm mất công người
 * dùng đã bỏ ra là cách nhanh nhất khiến họ không bao giờ bấm nút này nữa.
 */
export async function syncSchema(
  tenantId: number,
  datamodelDatasetId: number,
  datasetId: number,
): Promise<SchemaSyncResultDto> {
  const live = await warehouseSchema(tenantId, datasetId);
  const liveByName = new Map(live.columns.map((c) => [c.name, c]));

  const result: SchemaSyncResultDto = {
    added: [],
    removed: [],
    typeChanged: [],
    calcFieldsAdded: 0,
  };

  await withTransaction(async (conn) => {
    const stored = await datamodelsRepo.listColumnsOfDataset(conn, tenantId, datamodelDatasetId);
    const storedReal = stored.filter((f) => f.calc_agg === null);
    const storedNames = new Set(storedReal.map((f) => f.column_name));

    // 1 + 2
    for (const column of live.columns) {
      const existing = storedReal.find((f) => f.column_name === column.name);

      if (existing === undefined) {
        await datamodelsRepo.insertOneColumn(conn, tenantId, datamodelDatasetId, {
          columnName: column.name,
          alias: null,
          role: defaultRoleOf(column.name, column.type),
          visible: !isSystemColumn(column.name),
          chType: column.type,
          ordinal: column.ordinal,
        });
        result.added.push(column.name);
        continue;
      }

      if (existing.ch_type !== column.type) {
        await datamodelsRepo.syncColumnType(conn, tenantId, Number(existing.id), column.type);
        result.typeChanged.push(column.name);
      }
    }

    // 3
    for (const field of storedReal) {
      if (liveByName.has(field.column_name)) continue;
      await datamodelsRepo.deleteColumn(conn, tenantId, Number(field.id));
      result.removed.push(field.column_name);
    }
    void storedNames;

    // Sinh field tính toán SAU khi đã thêm cột mới, để cột vừa xuất hiện cũng
    // có đủ bốn field của nó.
    result.calcFieldsAdded = await generateCalcFields(conn, tenantId, datamodelDatasetId);
  });

  return result;
}

/** Danh sách Schema của một mô hình — bảng ở tab Schemas (§8.3). */
export async function listSchemas(
  tenantId: number,
  dataModelId: number,
): Promise<
  {
    id: number;
    datasetId: number;
    name: string;
    chTable: string;
    columnCount: number;
    calcFieldCount: number;
    visibleCount: number;
  }[]
> {
  const datasets = await datamodelsRepo.listDatasets(mysqlPool, tenantId, dataModelId);
  const fields = await datamodelsRepo.listColumns(mysqlPool, tenantId, dataModelId);

  return datasets.map((ds) => {
    const own = fields.filter((f) => f.datamodel_dataset_id === Number(ds.id));
    return {
      id: Number(ds.id),
      datasetId: Number(ds.dataset_id),
      name: ds.dataset_name,
      chTable: '',
      columnCount: own.filter((f) => f.calc_agg === null && !isSystemColumn(f.column_name)).length,
      calcFieldCount: own.filter((f) => f.calc_agg !== null).length,
      visibleCount: own.filter((f) => f.visible === 1 && !isSystemColumn(f.column_name)).length,
    };
  });
}
