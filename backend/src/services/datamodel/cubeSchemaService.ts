import { MEASURE_AGGS_BY_CUBE_TYPE } from '@bi/shared';

import { mysqlPool } from '../../config/mysql';
import { env } from '../../config/env';
import * as datamodelsRepo from '../../repositories/datamodels';
import { chTableName, qualified } from '../ingest/buildDdl';
import {
  buildCubeSchema,
  type SchemaColumn,
  type SchemaCube,
  type SchemaJoin,
  type SchemaMeasure,
} from './buildCubeSchema';
import { cubeTypeOf } from './classifyColumn';
import { cubeFileNameFor, cubeNameFor } from './cubeName';
import { removeTenantSchema, writeTenantSchema, type GeneratedCubeFile } from './cubeSchemaStore';

/**
 * Sinh lại toàn bộ cube schema của một tổ chức — §10.
 *
 * ─── Vì sao sinh lại CẢ TỔ CHỨC chứ không chỉ mô hình vừa đổi ───────────────
 *
 * `writeTenantSchema` làm việc theo lối ĐỐI CHIẾU: nó nhận tập file đầy đủ rồi
 * xoá mọi thứ không nằm trong tập đó. Đó là thứ khiến "file còn sót của một mô
 * hình đã xoá" không xảy ra được — nhưng nó đòi danh sách đầy đủ, nên hàm này
 * luôn đọc lại mọi mô hình còn sống.
 *
 * Cái giá là mỗi lần sửa một thước đo thì mọi mô hình của tổ chức được ghi lại.
 * Với vài chục mô hình thì đó là vài chục lần ghi file nhỏ. Đổi lại là không có
 * đường nào để rác tích lại.
 *
 * ─── PHẢI gọi SAU khi transaction đã commit ─────────────────────────────────
 *
 * Không phải bên trong. Gọi trong transaction nghĩa là file mô tả một mô hình
 * có thể bị rollback ngay sau đó — và khi ấy đĩa nói một đằng, database một nẻo,
 * với phần thắng thuộc về thứ Cube đọc.
 */

async function buildTenantFiles(tenantId: number): Promise<GeneratedCubeFile[]> {
  const modelIds = await datamodelsRepo.listLiveModelIds(mysqlPool, tenantId);
  const files: GeneratedCubeFile[] = [];

  for (const dataModelId of modelIds) {
    const file = await buildModelFile(tenantId, dataModelId);
    if (file !== null) files.push(file);
  }

  return files;
}

async function buildModelFile(
  tenantId: number,
  dataModelId: number,
): Promise<GeneratedCubeFile | null> {
  const model = await datamodelsRepo.findOne(mysqlPool, tenantId, dataModelId);
  if (model === null) return null;

  const [datasetRows, columnRows, measures, relationships] = await Promise.all([
    datamodelsRepo.listDatasets(mysqlPool, tenantId, dataModelId),
    datamodelsRepo.listColumns(mysqlPool, tenantId, dataModelId),
    datamodelsRepo.listMeasures(mysqlPool, tenantId, dataModelId),
    datamodelsRepo.listRelationships(mysqlPool, tenantId, dataModelId),
  ]);

  // Mô hình chưa có bảng nào thì KHÔNG sinh file. Một `cube()` rỗng vẫn hợp lệ
  // về cú pháp nhưng Cube từ chối biên dịch nó, và lỗi đó chặn luôn mọi mô hình
  // khác của cùng tổ chức — một mô hình dở dang không được phép làm hỏng phần
  // còn lại.
  if (datasetRows.length === 0) return null;

  const columnsByDataset = new Map<number, typeof columnRows>();
  const columnById = new Map<number, (typeof columnRows)[number]>();
  for (const row of columnRows) {
    const list = columnsByDataset.get(row.datamodel_dataset_id) ?? [];
    list.push(row);
    columnsByDataset.set(row.datamodel_dataset_id, list);
    columnById.set(Number(row.id), row);
  }

  /** Từ id dòng nối sang id bộ dữ liệu — cần để dựng tên cube của phía bên kia. */
  const datasetIdByRef = new Map<number, number>();
  for (const row of datasetRows) {
    datasetIdByRef.set(Number(row.id), Number(row.dataset_id));
  }

  const cubes: SchemaCube[] = datasetRows.map((row) => {
    const ref = Number(row.id);
    const datasetId = Number(row.dataset_id);

    const columns: SchemaColumn[] = (columnsByDataset.get(ref) ?? []).map((c) => ({
      id: Number(c.id),
      columnName: c.column_name,
      label: c.alias ?? c.column_name,
      role: c.role,
      cubeType: cubeTypeOf(c.ch_type),
    }));

    const cubeMeasures: SchemaMeasure[] = measures
      .filter((m) => m.datamodelDatasetId === ref)
      .map((m) => ({
        id: m.id,
        name: m.name,
        agg: m.agg,
        // Biến thể phép gộp — §10.7, để Explorer đổi phép tại chỗ.
        //
        // CHỈ thước đo dựng-trên-cột mới có. Thước đo tính toán thì hai vế đã
        // gộp rồi, gộp thêm lần nữa là sai; thước đo đếm dòng không đo cột nào
        // để mà đổi. `columnId === null` bắt đúng cả hai trường hợp đó.
        //
        // Danh sách lấy từ KIỂU của cột, cùng bảng mà tab Schemas dùng — nên
        // một phép hiện ra ở Explorer là một phép chắc chắn chạy được.
        altAggs:
          m.columnId === null
            ? []
            : MEASURE_AGGS_BY_CUBE_TYPE[cubeTypeOf(columnById.get(m.columnId)?.ch_type ?? '')],
        columnName: m.columnName,
        // Hai vế của công thức LUÔN thuộc cùng cube này — ràng buộc đó do
        // `createFormulaMeasure` giữ, và nó là lý do khối `sql` bên dưới tham
        // chiếu được bằng tên trần `${m67}` mà không cần tiền tố cube.
        formula:
          m.formula === null
            ? null
            : { op: m.formula.op, leftId: m.formula.leftId, rightId: m.formula.rightId },
        // Vế phải đi bằng TÊN CỘT chứ không bằng id: `buildCubeSchema` dựng SQL
        // và nó không có bảng tra id, cũng không nên có — cùng lý lẽ với
        // `columnName` ngay bên trên.
        rowExpr:
          m.rowExpr === null
            ? null
            : { op: m.rowExpr.op, rightColumnName: m.rowExpr.rightColumnName },
      }));

    return {
      dataModelId,
      datasetId,
      // Tên hiển thị RIÊNG của mô hình này thắng tên bộ dữ liệu. Cùng một bộ dữ
      // liệu có thể đóng hai vai ở hai mô hình ("Đơn hàng" ở mô hình bán hàng,
      // "Chứng từ" ở mô hình kế toán), và `title:` trong file cube là thứ người
      // dùng nhìn thấy ở Explorer.
      label: row.display_name ?? row.dataset_name,
      // Tên bảng SUY LẠI từ hai id thay vì đọc `datasets.ch_table`. Được phép vì
      // tên là hàm THUẦN của (tenantId, datasetId) — đó chính là lý do quy ước
      // đặt tên ở §9 không nhận một ký tự nào của người dùng.
      sqlTable: qualified(env.CLICKHOUSE_DATABASE, chTableName(tenantId, datasetId)),
      columns,
      measures: cubeMeasures,
      joins: buildJoins(dataModelId, ref, relationships, datasetIdByRef, columnById),
    };
  });

  return {
    fileName: cubeFileNameFor(dataModelId),
    content: buildCubeSchema({
      dataModelId,
      dataModelName: model.name,
      tenantId,
      cubes,
      // Truyền vào chứ không để `buildCubeSchema` gọi `new Date()`: hàm đó phải
      // thuần để test được.
      generatedAt: new Date().toISOString(),
    }),
  };
}

/**
 * `joins` của MỘT cube.
 *
 * Khai ở đúng MỘT phía — phía `left` của quan hệ. Đồ thị join của Cube có hướng
 * và nó tự đi ngược được; khai cả hai chiều tạo ra hai đường nối giữa cùng hai
 * bảng và Cube từ chối với "multiple join paths", một thông báo xuất hiện lúc
 * TRUY VẤN, cách xa chỗ người dùng đã tạo ra sai sót.
 */
function buildJoins(
  dataModelId: number,
  ref: number,
  relationships: readonly { id: number; kind: SchemaJoin['relationship']; left: { datasetRef: number; columnId: number }; right: { datasetRef: number; columnId: number } }[],
  datasetIdByRef: ReadonlyMap<number, number>,
  columnById: ReadonlyMap<number, { column_name: string }>,
): SchemaJoin[] {
  const joins: SchemaJoin[] = [];

  for (const rel of relationships) {
    if (rel.left.datasetRef !== ref) continue;

    const targetDatasetId = datasetIdByRef.get(rel.right.datasetRef);
    const ownColumn = columnById.get(rel.left.columnId);
    const targetColumn = columnById.get(rel.right.columnId);
    // Ba giá trị này đến từ khoá ngoại nên luôn có. Kiểm lại để một dòng dữ liệu
    // lệch không sinh ra `undefined` giữa câu SQL.
    if (targetDatasetId === undefined || !ownColumn || !targetColumn) continue;

    joins.push({
      targetCube: cubeNameFor(dataModelId, targetDatasetId),
      relationship: rel.kind,
      ownColumn: ownColumn.column_name,
      targetColumn: targetColumn.column_name,
    });
  }

  return joins;
}

/** Sinh lại schema của một tổ chức. Gọi SAU khi transaction đã commit. */
export async function regenerateTenant(tenantId: number): Promise<void> {
  const files = await buildTenantFiles(tenantId);

  if (files.length === 0) {
    await removeTenantSchema(tenantId);
    return;
  }

  await writeTenantSchema(tenantId, files);
}

/**
 * Sinh lại cho MỌI tổ chức — gọi một lần lúc boot.
 *
 * Phục hồi hai tình huống có thật: thư mục bị xoá tay (nó nằm trong
 * `.gitignore` nên một lần `git clean` là mất sạch), và database được khôi phục
 * từ bản sao lưu trong khi đĩa thì không.
 *
 * KHÔNG ném: một lỗi ở đây không được phép chặn backend khởi động. Ghi log kèm
 * đúng việc phải làm rồi đi tiếp — người dùng vẫn dựng lại được bằng cách lưu
 * lại mô hình.
 */
export async function regenerateAllTenants(): Promise<void> {
  try {
    const tenantIds = await datamodelsRepo.listTenantsWithModels(mysqlPool);
    for (const tenantId of tenantIds) {
      await regenerateTenant(tenantId);
    }
    if (tenantIds.length > 0) {
      console.log(`[datamodel] đã sinh lại cube schema cho ${tenantIds.length} tổ chức`);
    }
  } catch (cause) {
    console.error(
      '[datamodel] không sinh lại được cube schema lúc khởi động. ' +
        'Lưu lại một mô hình bất kỳ sẽ dựng lại file của tổ chức đó.',
      cause,
    );
  }
}
