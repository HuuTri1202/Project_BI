import {
  DATAMODEL_ERROR_CODES,
  MEASURE_AGGS_BY_CUBE_TYPE,
  MEASURE_AGG_LABELS,
  MEASURE_OP_LABELS,
  moTaThuocDo,
  type DataModelMeasureDto,
  type MeasureAgg,
  type ExplorerFieldsDto,
  type ExplorerQueryDto,
  type ExplorerResultDto,
  type ExplorerSqlDto,
  type MeasureFormat,
  type MeasureSourceDto,
} from '@bi/shared';

import { mysqlPool } from '../../config/mysql';
import * as datamodelsRepo from '../../repositories/datamodels';
import { HttpError, notFound } from '../../utils/httpError';
import { cubeTypeOf } from './classifyColumn';
import { cubeNameFor, dimensionNameFor, measureNameFor } from './cubeName';
import { loadFromCube, sqlFromCube, type CubeQuery } from './cubeClient';

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
  measures: Map<
    number,
    {
      cubeName: string;
      label: string;
      datasetName: string;
      format: MeasureFormat;
      /** Phép gộp mô hình đang khai. */
      agg: MeasureAgg;
      /** Các phép đổi được tại chỗ; rỗng = thước đo tính toán hoặc đếm dòng. */
      availableAggs: readonly MeasureAgg[];
      /** Biểu thức phép gộp áp lên — để giao diện nói ra phép tính. */
      nguon: MeasureSourceDto;
    }
  >;
}

/**
 * Biểu thức mà phép gộp của một thước đo áp lên — xem `MeasureSourceDto`.
 *
 * Dùng NHÃN của cột (`alias ?? column_name`) chứ không phải tên cột thô: câu mô
 * tả này nằm ngay dưới tên thước đo trong bộ chọn, nên nó phải nói cùng thứ
 * tiếng với mọi chỗ khác trên màn hình. Người dùng đổi tên hiển thị cột ở tab
 * Schemas chính vì tên thô khó đọc; lôi tên thô ra lại ở đây là phản tác dụng.
 */
function nguonCua(m: DataModelMeasureDto, nhan: (columnId: number) => string): MeasureSourceDto {
  // Xét `rowExpr` TRƯỚC `columnId`: thước đo biểu thức dòng cũng có
  // `datamodel_column_id` (vế trái), nên hỏi `columnId !== null` trước sẽ mô tả
  // nó thành một thước đo cột bình thường và giấu mất vế phải.
  if (m.rowExpr !== null && m.columnId !== null) {
    const trai = nhan(m.columnId);
    const phai = nhan(m.rowExpr.rightColumnId);
    return { kind: 'rowExpr', expr: `${trai} ${MEASURE_OP_LABELS[m.rowExpr.op]} ${phai}` };
  }

  if (m.formula !== null) {
    const { leftName, op, rightName } = m.formula;
    return { kind: 'formula', expr: `${leftName} ${MEASURE_OP_LABELS[op]} ${rightName}` };
  }

  if (m.columnId !== null) return { kind: 'column', expr: nhan(m.columnId) };

  // `columnId === null` là ĐIỀU KIỆN của đếm dòng, không phải dữ liệu thiếu —
  // xem `seedMeasures`.
  return { kind: 'rows', expr: null };
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

  // Cột tra được theo id kể cả khi nó KHÔNG phải chiều: `columns` ở trên đã lọc
  // bỏ cột `hidden` và cột `measure`, mà thước đo thì dựng trên đúng loại cột
  // thứ hai. Tra vào đó sẽ ra `undefined` cho mọi thước đo thật.
  const chTypeByColumnId = new Map(columnRows.map((c) => [Number(c.id), c.ch_type]));
  const nhanCotById = new Map(columnRows.map((c) => [Number(c.id), c.alias ?? c.column_name]));
  // `'—'` chứ không ném: một thước đo trỏ vào cột đã biến mất là dữ liệu lệch,
  // và nó không được phép làm hỏng cả bộ chọn — người dùng vẫn phải mở được
  // Explorer để thấy mà xoá nó đi.
  const nhanCot = (id: number): string => nhanCotById.get(id) ?? '—';

  const measureIndex: ModelIndex['measures'] = new Map();
  for (const m of measures) {
    const cube = cubeByRef.get(m.datamodelDatasetId);
    if (cube === undefined) continue;

    // Phải KHỚP với `altAggs` mà `cubeSchemaService` phát ra, vì mỗi phép ở đây
    // tương ứng một thước đo đã khai trong file cube. Lệch nhau là Explorer mời
    // một phép rồi Cube trả "member not found" — lỗi chỉ lộ ra lúc bấm Chạy.
    const chType = m.columnId === null ? null : (chTypeByColumnId.get(m.columnId) ?? null);
    const availableAggs = chType === null ? [] : MEASURE_AGGS_BY_CUBE_TYPE[cubeTypeOf(chType)];

    measureIndex.set(m.id, {
      cubeName: cube.cubeName,
      label: m.name,
      datasetName: cube.datasetName,
      format: m.format,
      agg: m.agg,
      availableAggs,
      nguon: nguonCua(m, nhanCot),
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
      agg: m.agg,
      availableAggs: m.availableAggs,
      nguon: m.nguon,
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

/**
 * Dịch lựa chọn của người dùng thành một truy vấn Cube.
 *
 * Tách ra để CHẠY và XEM CÂU LỆNH đi qua đúng một đường: nếu hai nơi tự dựng
 * truy vấn riêng thì SQL hiện cho người dùng xem sẽ dần khác SQL thật sự chạy,
 * và một màn "xem câu lệnh" nói sai còn tệ hơn không có.
 *
 * ⚠️ Trình duyệt chỉ gửi ID. Tên cube dựng ở ĐÂY, từ `index` vốn đã lọc theo tổ
 * chức — nên một ID bịa ra không trỏ được sang mô hình của người khác, nó chỉ
 * rơi vào `unknownField()`.
 */
/**
 * Bó truy vấn vào đúng một danh sách giá trị của MỘT chiều — §10.9.
 *
 * ⚠️ Đường NỘI BỘ, cố ý không có trong `ExplorerQueryDto`. Nghĩa là không client
 * nào gửi được nó: `explorerQueryBodySchema` không khai trường này, và hai
 * endpoint `/query` với `/query/sql` chỉ chuyển tiếp thân request đã qua zod.
 *
 * Chỉ `aggregateWithSeries` dùng, và giá trị nó truyền vào đến từ CHÍNH một
 * truy vấn Cube ngay trước đó — không phải từ người dùng. Đó là điều kiện để
 * mở đường này mà không phá luật "chuỗi đi vào truy vấn phải lấy từ database
 * của ta".
 */
export interface QueryRestriction {
  dimensionId: number;
  /** Giá trị THÔ từ Cube, chưa qua `labelOf`. `null` = ô trống. */
  values: (string | number | null)[];
}

/**
 * Những thứ chỉ đường NỘI BỘ được dùng — không có trong hợp đồng HTTP.
 *
 * Gom vào một object thay vì thêm tham số vị trí thứ sáu: hai thứ trong đây
 * không liên quan gì nhau, và `runExplorerQuery(a, b, c, d, [], 'asc')` ở chỗ
 * gọi không nói được cái mảng rỗng kia là gì.
 */
interface InternalQueryOptions {
  /** Bó truy vấn vào đúng những giá trị đã chọn — xem `QueryRestriction`. */
  restrict?: readonly QueryRestriction[];
  /**
   * Chiều sắp theo thước đo đầu tiên. Mặc định `'desc'`.
   *
   * `'asc'` tồn tại cho đúng một việc: lấy các nhóm NHỎ NHẤT (`pick: 'bottom'`
   * của báo cáo). Cắt top-N là một phép của TRUY VẤN, không phải của cách vẽ —
   * sắp lại một tập đã cắt thì mãi mãi vẫn là các nhóm lớn nhất.
   */
  order?: 'asc' | 'desc';
  /**
   * Bỏ qua `offset` nhóm đầu tiên — chia trang biểu đồ (§10.12).
   *
   * Cùng lập luận với `order`: "trang 2" là một phép của TRUY VẤN. Lấy về tất
   * cả rồi cắt trong Node nghĩa là kéo cả một chiều ba nghìn giá trị qua mạng
   * để hiện hai mươi cái cột.
   */
  offset?: number;
  /**
   * Chỉ mục mô hình đã nạp sẵn — §10.14.
   *
   * Một khung 12 ô hỏi 12 câu trên CÙNG một mô hình. Không có tham số này thì
   * mỗi câu tự nạp lại chỉ mục: `findOne` + ba truy vấn danh sách + một truy
   * vấn `schemaVersion`, tức 60 vòng MySQL cho một thứ không đổi giữa chúng.
   * Pool mặc định 10 kết nối, nên chúng còn xếp hàng chờ nhau.
   *
   * Nạp một lần ở nơi gọi rồi truyền xuống. Vắng mặt thì hàm tự nạp — mọi
   * đường gọi lẻ (Explorer, xem trước một ô) không phải đổi gì.
   */
  ctx?: ModelContext;
}

/**
 * Mọi thứ một truy vấn cần biết về mô hình, nạp đúng MỘT lần — §10.14.
 *
 * Gộp chỉ mục và `schemaVersion` vào một hộp vì chúng luôn đi cùng nhau:
 * `buildQuery` cần chỉ mục, còn token gửi cho Cube cần phiên bản schema. Tách
 * đôi thì nơi gọi phải nhớ nạp cả hai, và quên một cái là lại thêm một vòng
 * MySQL cho mỗi ô.
 */
export interface ModelContext {
  index: ModelIndex;
  schemaVersion: string;
}

export async function loadModelContext(
  tenantId: number,
  dataModelId: number,
): Promise<ModelContext> {
  const [index, schemaVersion] = await Promise.all([
    indexModel(tenantId, dataModelId),
    datamodelsRepo.schemaVersion(mysqlPool, tenantId),
  ]);
  return { index, schemaVersion };
}

function buildQuery(
  index: ModelIndex,
  input: ExplorerQueryDto,
  internal: InternalQueryOptions = {},
): { query: CubeQuery; columns: ExplorerResultDto['columns']; keys: string[]; limit: number } {
  const restrict = internal.restrict ?? [];
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

  /*
   * Phép gộp người dùng chọn TẠI CHỖ, cho riêng truy vấn này.
   *
   * Chỉ đọc, không ghi: mô hình vẫn giữ nguyên phép đã khai. Đây là điểm khác
   * căn bản với ô chọn ở tab Schemas — ở đó là cấu hình chung cho cả tổ chức,
   * còn ở đây là một câu hỏi của một người trong một lúc.
   */
  const overrides = new Map((input.measureAggs ?? []).map((x) => [x.id, x.agg]));

  const measures = input.measureIds.map((id) => {
    const found = index.measures.get(id);
    if (found === undefined) throw unknownField();

    const agg = overrides.get(id);
    if (agg !== undefined && agg !== found.agg && !found.availableAggs.includes(agg)) {
      // Không im lặng lùi về phép mặc định. Trả một con số tính bằng phép KHÁC
      // với phép người dùng vừa bấm là kiểu sai tệ nhất ở đây: nó trông đúng.
      throw new HttpError(
        400,
        DATAMODEL_ERROR_CODES.FIELD_UNKNOWN,
        `Thước đo "${found.label}" không nhận phép gộp "${MEASURE_AGG_LABELS[agg]}".`,
      );
    }

    // Không có biến thể nào được phát cho phép ĐANG KHAI — nó chính là `m<id>`.
    const doi = agg !== undefined && agg !== found.agg;
    const key = `${found.cubeName}.${measureNameFor(id, doi ? agg : undefined)}`;

    // `format` đi kèm KẾT QUẢ chứ không chỉ nằm ở bộ chọn: bảng kết quả là
    // nơi con số 0,283 phải đọc thành 28,3 %, và nó không tra lại danh sách
    // trường để biết điều đó.
    //
    // Nhãn mang theo tên phép khi người dùng đã đổi: cùng một cột hỏi bằng hai
    // phép cho hai cột kết quả, và hai cột cùng tên "Doanh thu" thì không đọc
    // được cột nào là cột nào.
    columns.push({
      id,
      label: doi ? `${found.label} (${MEASURE_AGG_LABELS[agg]})` : found.label,
      kind: 'measure',
      format: found.format,
      // Dựng với phép THẬT SỰ chạy (`agg ?? found.agg`), không phải phép mô
      // hình khai — nếu không thì đổi sang trung vị xong tiêu đề vẫn nói "Tổng".
      mota: moTaThuocDo(found.nguon, agg ?? found.agg, found.datasetName),
    });
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

  // Nhiều bộ giới hạn được Cube nối bằng AND — đúng ý: "nhóm nằm trong top-N
  // VÀ chuỗi nằm trong top-K".
  const filters: NonNullable<CubeQuery['filters']> = [];
  for (const bo of restrict) {
    const found = index.columns.get(bo.dimensionId);
    if (found === undefined) throw unknownField();
    const member = `${found.cubeName}.${dimensionNameFor(bo.dimensionId)}`;

    /*
     * Ô TRỐNG phải đi bằng toán tử riêng.
     *
     * `equals` với một danh sách chuỗi không bắt được `NULL` — SQL so sánh
     * `NULL = 'x'` ra `NULL`, không ra `false`, nên nhóm "(trống)" sẽ biến mất
     * khỏi biểu đồ dù nó vừa lọt vào top-N ở truy vấn xếp hạng. Ghép hai toán
     * tử bằng `or` là cách duy nhất giữ được nó.
     */
    const cuThe = bo.values.filter((v) => v !== null).map((v) => String(v));
    const coTrong = bo.values.some((v) => v === null);

    const clauses: NonNullable<CubeQuery['filters']> = [];
    if (cuThe.length > 0) clauses.push({ member, operator: 'equals', values: cuThe });
    if (coTrong) clauses.push({ member, operator: 'notSet' });

    // Danh sách rỗng thì KHÔNG thêm gì cả. Một `or: []` được Cube đọc thành
    // "không dòng nào khớp", tức biểu đồ trắng — mà tình huống này chỉ xảy ra
    // khi truy vấn xếp hạng không trả về giá trị nào, và khi đó biểu đồ vốn đã
    // trống. Bỏ qua là hành vi đúng và cũng là hành vi rẻ hơn.
    if (clauses.length === 1) filters.push(...clauses);
    else if (clauses.length > 1) filters.push({ or: clauses });
  }
  if (filters.length > 0) query.filters = filters;

  // Sắp theo thước đo ĐẦU TIÊN, giảm dần. Không sắp thì ClickHouse trả theo thứ
  // tự nội bộ và bảng kết quả đổi thứ tự giữa hai lần chạy cùng một truy vấn —
  // trông như dữ liệu không ổn định.
  const firstMeasure = measures[0];
  if (firstMeasure !== undefined) query.order = { [firstMeasure]: internal.order ?? 'desc' };

  const limit = input.limit ?? 500;
  query.limit = limit;

  // `> 0` chứ không phải `!== undefined`: một `offset: 0` thừa trong thân request
  // gửi tới Cube là một khác biệt không đổi kết quả nhưng đổi câu SQL hiện ra ở
  // màn "xem câu lệnh" — và một câu lệnh khác đi mà không giải thích được thì
  // người đọc phải đi tìm hiểu.
  const offset = internal.offset ?? 0;
  if (offset > 0) query.offset = offset;

  return { query, columns, keys, limit };
}

export async function runExplorerQuery(
  tenantId: number,
  userId: number,
  dataModelId: number,
  input: ExplorerQueryDto,
  /** Đường nội bộ, không có trong hợp đồng HTTP — xem `InternalQueryOptions`. */
  internal: InternalQueryOptions = {},
): Promise<ExplorerResultDto> {
  const ctx = internal.ctx ?? (await loadModelContext(tenantId, dataModelId));
  const { query, columns, keys, limit } = buildQuery(ctx.index, input, internal);

  const result = await loadFromCube(
    { tenantId, userId, dataModelId, schemaVersion: ctx.schemaVersion },
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

/**
 * Câu SQL Cube sẽ chạy cho đúng lựa chọn này — §10.7.
 *
 * Dùng CHUNG `buildQuery` với `runExplorerQuery`, nên câu hiện ra là câu thật.
 */
export async function explainExplorerQuery(
  tenantId: number,
  userId: number,
  dataModelId: number,
  input: ExplorerQueryDto,
): Promise<ExplorerSqlDto> {
  const index = await indexModel(tenantId, dataModelId);
  const { query } = buildQuery(index, input);

  const schemaVersion = await datamodelsRepo.schemaVersion(mysqlPool, tenantId);
  const { sql, params } = await sqlFromCube(
    { tenantId, userId, dataModelId, schemaVersion },
    query,
  );

  return { sql, params, cubeQuery: JSON.stringify(query, null, 2) };
}

/** Cube trả JSON sẵn; chỉ còn hạ những kiểu không mang qua được. */
function toCell(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' || typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}
