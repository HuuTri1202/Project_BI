import {
  DATAMODEL_ERROR_CODES,
  type CreateRelationshipInput,
  type DataModelRelationshipDto,
  type RelationshipWarningDto,
} from '@bi/shared';

import { warehouse } from '../../config/clickhouse';
import { env } from '../../config/env';
import { mysqlPool } from '../../config/mysql';
import * as datamodelsRepo from '../../repositories/datamodels';
import { HttpError, badRequest } from '../../utils/httpError';
import { chTableName, qualified } from '../ingest/buildDdl';
import { quoteIdent } from '../ingest/typeMap';
import { isDuplicate, wouldCreateCycle, type Edge } from './joinGraph';

/**
 * Tạo quan hệ giữa hai bảng — §10.5.
 *
 * Bốn phép kiểm trước khi lưu, mỗi phép chặn một cách hỏng khác nhau. Ba phép
 * đầu TỪ CHỐI; phép thứ tư chỉ CẢNH BÁO.
 */

export interface CreateResult {
  relationship: DataModelRelationshipDto;
  warning: RelationshipWarningDto;
}

export async function createRelationship(
  tenantId: number,
  dataModelId: number,
  userId: number,
  input: CreateRelationshipInput,
): Promise<CreateResult> {
  // ─── 1. Không nối một bảng với chính nó ───────────────────────────────────
  //
  // Cube cần một bí danh cube để diễn đạt tự-nối, mà bộ sinh của ta khai đúng
  // một cube cho mỗi bảng và không đặt bí danh. Từ chối thẳng còn hơn sinh ra
  // một file không biên dịch được và để lỗi nổ ở tab khác.
  if (input.leftId === input.rightId) {
    throw new HttpError(
      400,
      DATAMODEL_ERROR_CODES.RELATIONSHIP_SELF,
      'Chưa nối được một bảng với chính nó.',
    );
  }

  const datasets = await datamodelsRepo.listDatasets(mysqlPool, tenantId, dataModelId);
  const refs = new Map(datasets.map((d) => [Number(d.id), Number(d.dataset_id)]));

  // ─── 2. Hai đầu phải nằm TRONG mô hình này ────────────────────────────────
  //
  // Khoá ngoại đã chặn việc trỏ sang tổ chức khác, nhưng không chặn việc trỏ
  // sang một bảng thuộc mô hình KHÁC của cùng tổ chức.
  if (!refs.has(input.leftId) || !refs.has(input.rightId)) {
    throw badRequest('Bảng được chọn không có trong mô hình này.');
  }

  const columns = await datamodelsRepo.listColumns(mysqlPool, tenantId, dataModelId);
  const columnById = new Map(columns.map((c) => [Number(c.id), c]));
  const leftColumn = columnById.get(input.leftColumnId);
  const rightColumn = columnById.get(input.rightColumnId);

  if (
    leftColumn === undefined ||
    rightColumn === undefined ||
    leftColumn.datamodel_dataset_id !== input.leftId ||
    rightColumn.datamodel_dataset_id !== input.rightId
  ) {
    throw badRequest('Cột khoá không thuộc bảng đã chọn.');
  }

  const existing = await datamodelsRepo.listRelationships(mysqlPool, tenantId, dataModelId);
  const edges: Edge[] = existing.map((r) => ({
    left: r.left.datasetRef,
    right: r.right.datasetRef,
  }));
  const candidate: Edge = { left: input.leftId, right: input.rightId };

  // ─── 3. Không tạo đường nối thứ hai ───────────────────────────────────────
  if (isDuplicate(edges, candidate)) {
    throw new HttpError(
      409,
      DATAMODEL_ERROR_CODES.RELATIONSHIP_DUPLICATE,
      'Hai bảng này đã được nối với nhau rồi.',
    );
  }

  if (wouldCreateCycle(edges, candidate)) {
    throw new HttpError(
      409,
      DATAMODEL_ERROR_CODES.RELATIONSHIP_CYCLE,
      'Quan hệ này tạo thành đường nối thứ hai giữa hai bảng. Cube.js không chọn được đường nào ' +
        'để nối, nên hãy xoá một quan hệ cũ trước.',
    );
  }

  const id = await datamodelsRepo.createRelationship(mysqlPool, tenantId, {
    dataModelId,
    leftId: input.leftId,
    leftColumnId: input.leftColumnId,
    rightId: input.rightId,
    rightColumnId: input.rightColumnId,
    kind: input.kind,
    createdBy: userId,
  });
  await datamodelsRepo.touch(mysqlPool, tenantId, dataModelId);

  // ─── 4. Cảnh báo khoá trùng — KHÔNG chặn ──────────────────────────────────
  //
  // Dò ở phía "MỘT", vì đó là phía mà khoá trùng gây nhân bản:
  //   many_to_one  left nhiều, right một  -> dò right
  //   one_to_many  left một,  right nhiều -> dò left
  //   one_to_one   cả hai phải duy nhất   -> dò left là đủ để lộ vấn đề
  const oneSideIsRight = input.kind === 'many_to_one';
  const warning = await probeKey(
    tenantId,
    refs.get(oneSideIsRight ? input.rightId : input.leftId),
    oneSideIsRight ? rightColumn.column_name : leftColumn.column_name,
  );

  const saved = (await datamodelsRepo.listRelationships(mysqlPool, tenantId, dataModelId)).find(
    (r) => r.id === id,
  );
  if (saved === undefined) throw badRequest('Không lưu được quan hệ.');

  return { relationship: saved, warning };
}

/**
 * Đếm khoá trùng và khoá NULL ở phía "một".
 *
 * ─── Vì sao đây là phép kiểm đáng giá nhất của cả §10 ───────────────────────
 *
 * Nối trên một cột có giá trị TRÙNG ở phía "một" sẽ nhân bản mọi dòng bên kia,
 * và mọi phép SUM sau đó lớn hơn sự thật. Cube không phát hiện được, ClickHouse
 * không phàn nàn, biểu đồ chỉ hiện một con số sai trông rất hợp lý.
 *
 * Đây gần như chắc chắn là nguồn của câu "số bị sai" đầu tiên người dùng gặp ở
 * §10, và nó sẽ bị đổ cho Cube.
 *
 * Khoá NULL thì ngược lại: dòng có khoá null rơi khỏi kết quả JOIN trong im
 * lặng, nên tổng NHỎ hơn sự thật. §9 khai mọi cột là `Nullable` nên đây không
 * phải trường hợp hiếm.
 *
 * CẢNH BÁO chứ không chặn: nối qua bảng cầu nối là trường hợp hợp lệ và cũng
 * cho ra khoá trùng. Và đo MỘT LẦN lúc lưu, không phải mỗi lần truy vấn.
 */
async function probeKey(
  tenantId: number,
  datasetId: number | undefined,
  columnName: string,
): Promise<RelationshipWarningDto> {
  if (datasetId === undefined || !Number.isInteger(datasetId) || datasetId <= 0) {
    return { duplicateKeys: false, nullKeys: 0 };
  }

  const table = qualified(env.CLICKHOUSE_DATABASE, chTableName(tenantId, datasetId));
  const column = quoteIdent(columnName);

  try {
    const rs = await warehouse.query({
      // Tên cột lấy từ database của TA rồi bọc bằng `quoteIdent` — cùng nguyên
      // tắc với `aggregateWarehouse`: chuỗi đi vào SQL không tới từ request.
      query:
        `SELECT count() AS total, uniqExact(${column}) AS distinct_keys, ` +
        `countIf(${column} IS NULL) AS null_keys FROM ${table}`,
      format: 'JSONEachRow',
    });
    const rows = await rs.json<{ total: string; distinct_keys: string; null_keys: string }>();
    const row = rows[0];
    if (row === undefined) return { duplicateKeys: false, nullKeys: 0 };

    const total = Number(row.total);
    const distinct = Number(row.distinct_keys);
    const nulls = Number(row.null_keys);

    return {
      // So trên phần KHÔNG null: `uniqExact` bỏ qua null, nên một bảng có null
      // sẽ luôn trông như có khoá trùng nếu so thẳng với `count()`.
      duplicateKeys: distinct > 0 && distinct < total - nulls,
      nullKeys: nulls,
    };
  } catch (cause) {
    // Kho tắt hay bảng vừa bị xoá đều không được phép làm hỏng việc LƯU quan hệ
    // — quan hệ đã ghi xong. Chỉ mất một lời cảnh báo.
    console.warn('[datamodel] không dò được khoá nối:', cause);
    return { duplicateKeys: false, nullKeys: 0 };
  }
}
