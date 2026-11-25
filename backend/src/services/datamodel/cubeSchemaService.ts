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
import { hamNongNguCanh } from './cubeClient';
import { cubeFileNameFor, cubeNameFor } from './cubeName';
import {
  pruneUnknownTenants,
  removeTenantSchema,
  writeTenantSchema,
  type GeneratedCubeFile,
} from './cubeSchemaStore';

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
  const model = await datamodelsRepo.findOneAnyWorkspace(mysqlPool, tenantId, dataModelId);
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

/**
 * Sinh lại schema của một tổ chức. Gọi SAU khi transaction đã commit.
 *
 * Kết thúc bằng một lần HÂM NÓNG ngữ cảnh Cube — xem `hamNongNguCanh` để biết
 * số đo. Tóm lại: biên dịch schema tốn 2,7–4,5 giây và nó phải xảy ra sau mỗi
 * lần sửa mô hình, nên câu hỏi duy nhất là ai chờ. Ở đây nghĩa là người vừa bấm
 * Lưu, chứ không phải người mở biểu đồ sau đó.
 *
 * ⚠️ KHÔNG `await`, và đó là chủ ý: hâm nóng mà chặn thì request Lưu dài thêm
 * đúng 2,7–4,5 giây — tức là dọn cái chậm từ chỗ này sang chỗ kia chứ không bỏ
 * được nó. `void` + `.catch` để một Cube đang tắt không thành
 * `unhandledRejection` làm sập tiến trình.
 */
export async function regenerateTenant(
  tenantId: number,
  tuyChon: { hamNong?: boolean } = {},
): Promise<void> {
  const files = await buildTenantFiles(tenantId);

  if (files.length === 0) {
    await removeTenantSchema(tenantId);
    return;
  }

  await writeTenantSchema(tenantId, files);

  if (tuyChon.hamNong !== false) void hamNongSauKhiGhi(tenantId);
}

/**
 * Tổ chức nào đang có một lượt hâm nóng chạy, và trong lúc đó có ghi thêm không.
 *
 * `false` = đang chạy, chưa có gì mới. `true` = đang chạy VÀ đã có lần ghi mới
 * hơn, nên phải chạy thêm một lượt nữa khi lượt này xong. Vắng mặt = không chạy.
 */
const dangHamNong = new Map<number, boolean>();

/**
 * Cố hết sức hâm nóng Cube, và KHÔNG BAO GIỜ reject.
 *
 * ⚠️ GỘP LƯỢT, và đây là chuyện ĐO ĐƯỢC chứ không phải đề phòng.
 *
 * Bản đầu bắn một lượt `/meta` sau MỖI lần ghi schema. Một người sửa mô hình
 * ghi 5–10 lần liên tiếp (thêm bảng, đặt khoá chính, nối quan hệ, thêm thước
 * đo…), và bộ kịch bản `mod-thuocdo.mjs` ghi khoảng 40 lần. Mỗi lượt là một lần
 * biên dịch 2,7–4,5 giây, và chúng xếp hàng trong Cube — nên truy vấn THẬT đứng
 * chờ sau cả hàng đó rồi đụng trần 30 giây của `cubeClient` và trả 503
 * "Chưa kết nối được tới tầng ngữ nghĩa".
 *
 * Đo được, chạy `node docs/kiem-thu/kich-ban/mod-thuocdo.mjs`:
 *
 *     bắn mỗi lần ghi   17/19 đạt   (TD-18 và TD-19 chết vì 503)
 *     tắt hẳn hâm nóng  19/19 đạt
 *     gộp lượt          19/19 đạt   (bản này)
 *
 * Và triệu chứng KHÔNG giống nguyên nhân: TD-18 báo `NaN`, TD-19 báo
 * `mota = undefined`. Cả hai chỉ vì `rows`/`columns` rỗng trong một phản hồi
 * 503 mà kịch bản không kiểm mã trạng thái. Nhìn vào đó người ta sẽ đi tìm lỗi
 * ở phép gộp biểu thức dòng — đúng chỗ không có lỗi nào.
 *
 * Luật gộp: tối đa MỘT lượt đang chạy cho mỗi tổ chức, cộng tối đa MỘT lượt nối
 * theo cho phiên bản mới nhất. Nên một chuỗi N lần ghi tốn 2 lần biên dịch thay
 * vì N — và lượt nối theo là thứ bắt buộc phải có, vì phiên bản người dùng thật
 * sự sẽ hỏi là phiên bản SAU lần ghi cuối.
 *
 * ⚠️ Không ghi log, và đó là lựa chọn chứ không phải bỏ sót. Hỏng ở đây có đúng
 * một hậu quả: biểu đồ đầu tiên chậm lại như trước khi có hàm này. Còn Cube
 * chết thật thì `loadFromCube` đã nói to — kèm đúng lệnh `npm run infra:up:bi`
 * phải chạy. Báo lần nữa ở đây là báo hai lần một việc, trên một đường người
 * dùng KHÔNG bấm vào, nên nó chỉ dạy người ta bỏ qua log.
 *
 * ⚠️ `catch` này LÀ thứ giữ cho backend không tự tắt: hàm được gọi bằng `void`,
 * nên một promise bị từ chối mà không ai bắt sẽ thành `unhandledRejection` —
 * mặc định của Node là giết tiến trình. Triệu chứng sẽ là "backend tắt sau khi
 * bấm Lưu", không phải một thông báo lỗi.
 *
 * Đã kiểm bằng đột biến, và cách nó đỏ thì đáng nói rõ: gỡ `catch` đi thì ba ca
 * `§10.7 hâm nóng` vẫn báo "passed", nhưng vitest in một khối `Unhandled Errors`
 * và THOÁT 1 — tức CI đỏ, dù không ca nào mang dấu đỏ. Ai đọc riêng dòng tổng
 * kết sẽ tưởng là xanh.
 */
async function hamNongSauKhiGhi(tenantId: number): Promise<void> {
  // Đã có lượt đang chạy -> chỉ đánh dấu "có bản mới hơn", KHÔNG xếp thêm lượt.
  if (dangHamNong.has(tenantId)) {
    dangHamNong.set(tenantId, true);
    return;
  }

  dangHamNong.set(tenantId, false);
  try {
    do {
      // Xoá dấu TRƯỚC khi đọc phiên bản: lần ghi nào xảy ra trong lúc đang hâm
      // sẽ đặt lại dấu, và vòng sau sẽ đọc được phiên bản của chính nó. Xoá sau
      // thì lần ghi đó bị mất và người dùng trả lại giá 2,7–4,5 giây.
      dangHamNong.set(tenantId, false);
      const schemaVersion = await datamodelsRepo.schemaVersion(mysqlPool, tenantId);
      await hamNongNguCanh({ tenantId, schemaVersion });
    } while (dangHamNong.get(tenantId) === true);
  } catch {
    /* Xem ghi chú ở trên. */
  } finally {
    dangHamNong.delete(tenantId);
  }
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

    /*
     * Dọn TRƯỚC khi ghi. Đây là chỗ duy nhất biết tập tổ chức đúng, nên cũng là
     * chỗ duy nhất xoá được thư mục mồ côi: tổ chức đã xoá, hay database được
     * khôi phục từ một bản sao lưu cũ hơn đĩa. Không ghi log số lượng — lần đầu
     * sau khi sửa sẽ dọn hàng trăm thư mục, còn những lần sau là 0, và một con
     * số 0 in ra mỗi lần boot thì không nói thêm điều gì.
     */
    await pruneUnknownTenants(tenantIds);

    for (const tenantId of tenantIds) {
      /*
       * `hamNong: false` — và đây KHÔNG phải cho gọn.
       *
       * Vòng này chạy cho MỌI tổ chức lúc boot (đo trên máy này: 63 tổ chức có
       * file cube). Hâm nóng tất cả nghĩa là bắn 63 lần biên dịch, mỗi lần
       * 2,7–4,5 giây, vào một Cube vừa khởi động — tự tạo ra đúng cái chậm mà
       * việc hâm nóng sinh ra để tránh. Tổ chức nào được dùng thật sẽ được hâm
       * ở lần Lưu đầu tiên.
       *
       * Còn lần mở biểu đồ đầu tiên sau khi khởi động lại hạ tầng thì KHÔNG còn
       * phải trả giá: `startHamNongKhoiDong` nối ngay sau hàm này và hâm một số
       * tổ chức CÓ TRẦN, tuần tự. Trần và tính tuần tự là đúng hai thứ giữ lại
       * kết luận ở trên — xem `hamNongKhoiDong.ts`. Vòng này vẫn phải để
       * `hamNong: false`: nó chạy cho MỌI tổ chức, còn chỗ có trần là chỗ kia.
       */
      await regenerateTenant(tenantId, { hamNong: false });
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
