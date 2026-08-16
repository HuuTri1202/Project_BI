import {
  DATAMODEL_ERROR_CODES,
  type ExplorerFieldsDto,
  type ExplorerQueryDto,
  type ExplorerResultDto,
} from '@bi/shared';

import { mysqlPool } from '../../config/mysql';
import * as datamodelsRepo from '../../repositories/datamodels';
import { HttpError, notFound } from '../../utils/httpError';
import { cubeTypeOf } from './classifyColumn';
import { cubeNameFor, dimensionNameFor, measureNameFor } from './cubeName';
import { loadFromCube, type CubeQuery } from './cubeClient';

/**
 * Explorer — §10.7.
 *
 * ═══ Trình duyệt KHÔNG BAO GIỜ gửi tên cube ═════════════════════════════════
 *
 * Câu hỏi từ trình duyệt chỉ chứa ID của dòng trong MySQL của ta. Hàm này tra
 * từng id trong phạm vi mô hình ĐÃ LỌC THEO TỔ CHỨC, rồi TỰ dựng chuỗi
 * `dm12_ds77.d341`.
 *
 * Đây là lớp chặn CHÍNH của việc cách ly tổ chức, và nó cùng nguyên tắc với
 * `aggregateWarehouse`: chuỗi đi vào truy vấn lấy từ database của ta, không
 * phải từ body request. Nhận thẳng tên cube từ client sẽ biến endpoint này
 * thành một cửa đọc mọi bảng trong kho, kể cả bảng của tổ chức khác.
 *
 * Lợi ích phụ: đổi quy ước đặt tên cube KHÔNG phải là thay đổi phá vỡ API, và
 * đổi alias của một cột không làm hỏng một truy vấn đã lưu.
 */

interface ModelIndex {
  /** id dòng `datamodel_columns` -> mọi thứ cần để dựng tên và nhãn. */
  columns: Map<number, { cubeName: string; label: string; chType: string; datasetName: string }>;
  measures: Map<number, { cubeName: string; label: string; datasetName: string }>;
}

/**
 * Nạp mô hình và lập chỉ mục theo id.
 *
 * Lấy TẤT CẢ cột và thước đo của mô hình rồi tra trong bộ nhớ, thay vì một câu
 * SELECT cho mỗi id. Một truy vấn Explorer hỏi tối đa 40 trường; 40 lần đi
 * database là 40 vòng mạng cho dữ liệu vừa đủ nằm trong một câu.
 */
async function indexModel(tenantId: number, dataModelId: number): Promise<ModelIndex> {
  const model = await datamodelsRepo.findOne(mysqlPool, tenantId, dataModelId);
  if (!model) throw notFound('Không tìm thấy mô hình dữ liệu này.');

  const [datasetRows, columnRows, measures] = await Promise.all([
    datamodelsRepo.listDatasets(mysqlPool, tenantId, dataModelId),
    datamodelsRepo.listColumns(mysqlPool, tenantId, dataModelId),
    datamodelsRepo.listMeasures(mysqlPool, tenantId, dataModelId),
  ]);

  const cubeByRef = new Map<number, { cubeName: string; datasetName: string }>();
  for (const row of datasetRows) {
    cubeByRef.set(Number(row.id), {
      cubeName: cubeNameFor(dataModelId, Number(row.dataset_id)),
      datasetName: row.dataset_name,
    });
  }

  const columns: ModelIndex['columns'] = new Map();
  for (const row of columnRows) {
    // Cột `hidden` không bao giờ hỏi được — kể cả khi client gửi thẳng id của
    // nó. `_row_index` nằm trong nhóm này.
    if (row.role !== 'dimension') continue;
    const cube = cubeByRef.get(row.datamodel_dataset_id);
    if (cube === undefined) continue;

    columns.set(Number(row.id), {
      cubeName: cube.cubeName,
      label: row.alias ?? row.column_name,
      chType: row.ch_type,
      datasetName: cube.datasetName,
    });
  }

  const measureIndex: ModelIndex['measures'] = new Map();
  for (const m of measures) {
    const cube = cubeByRef.get(m.datamodelDatasetId);
    if (cube === undefined) continue;
    measureIndex.set(m.id, {
      cubeName: cube.cubeName,
      label: m.name,
      datasetName: cube.datasetName,
    });
  }

  return { columns: columns, measures: measureIndex };
}

/** Danh sách phẳng cho bộ chọn — §10.7. */
export async function explorerFields(
  tenantId: number,
  dataModelId: number,
): Promise<ExplorerFieldsDto> {
  const index = await indexModel(tenantId, dataModelId);

  return {
    dimensions: [...index.columns.entries()].map(([id, c]) => ({
      id,
      label: c.label,
      datasetName: c.datasetName,
      cubeType: cubeTypeOf(c.chType),
    })),
    measures: [...index.measures.entries()].map(([id, m]) => ({
      id,
      label: m.label,
      datasetName: m.datasetName,
      cubeType: 'number' as const,
    })),
  };
}

/**
 * Trường được hỏi không còn trong mô hình.
 *
 * Xảy ra thật: người dùng mở Explorer, một đồng nghiệp xoá một thước đo, rồi họ
 * bấm Chạy. Thông báo phải nói được việc cần làm chứ không phải một mã lỗi.
 */
function unknownField(): HttpError {
  return new HttpError(
    400,
    DATAMODEL_ERROR_CODES.FIELD_UNKNOWN,
    'Có trường không còn trong mô hình. Hãy tải lại trang rồi chọn lại.',
  );
}

export async function runExplorerQuery(
  tenantId: number,
  userId: number,
  dataModelId: number,
  input: ExplorerQueryDto,
): Promise<ExplorerResultDto> {
  const index = await indexModel(tenantId, dataModelId);

  const columns: ExplorerResultDto['columns'] = [];
  const keys: string[] = [];

  const dimensions = input.dimensionIds.map((id) => {
    const found = index.columns.get(id);
    if (found === undefined) throw unknownField();
    const key = `${found.cubeName}.${dimensionNameFor(id)}`;
    columns.push({ id, label: found.label, kind: 'dimension' });
    keys.push(key);
    return key;
  });

  const measures = input.measureIds.map((id) => {
    const found = index.measures.get(id);
    if (found === undefined) throw unknownField();
    const key = `${found.cubeName}.${measureNameFor(id)}`;
    columns.push({ id, label: found.label, kind: 'measure' });
    keys.push(key);
    return key;
  });

  const query: CubeQuery = { measures, dimensions };

  if (input.timeDimension !== undefined) {
    const found = index.columns.get(input.timeDimension.dimensionId);
    if (found === undefined) throw unknownField();
    query.timeDimensions = [
      {
        dimension: `${found.cubeName}.${dimensionNameFor(input.timeDimension.dimensionId)}`,
        granularity: input.timeDimension.granularity,
      },
    ];
  }

  // Sắp theo thước đo ĐẦU TIÊN, giảm dần. Không sắp thì ClickHouse trả theo thứ
  // tự nội bộ và bảng kết quả đổi thứ tự giữa hai lần chạy cùng một truy vấn —
  // trông như dữ liệu không ổn định.
  const firstMeasure = measures[0];
  if (firstMeasure !== undefined) query.order = { [firstMeasure]: 'desc' };

  const limit = input.limit ?? 500;
  query.limit = limit;

  const schemaVersion = await datamodelsRepo.schemaVersion(mysqlPool, tenantId);
  const result = await loadFromCube(
    { tenantId, userId, dataModelId, schemaVersion },
    query,
  );

  const rows = result.data.map((row) => keys.map((key) => toCell(row[key])));

  return {
    columns,
    rows,
    // Nhận đủ đúng bằng trần nghĩa là RẤT CÓ THỂ còn dữ liệu. Nói ra chứ không
    // để người dùng tin rằng họ đang nhìn toàn bộ — cùng lý do `truncated` tồn
    // tại ở §7.
    truncated: rows.length >= limit,
  };
}

/** Cube trả JSON sẵn; chỉ còn hạ những kiểu không mang qua được. */
function toCell(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}
