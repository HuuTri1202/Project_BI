/**
 * Hợp đồng dữ liệu của TẦNG NGỮ NGHĨA — §10.
 *
 * Mô hình:
 *   DataModel  ──<  DataModelDataset  ──<  DataModelColumn
 *        │                   │
 *        │                   └──<  DataModelMeasure
 *        └──<  DataModelRelationship  (nối hai DataModelDataset)
 *
 * ─── Tầng này KHÔNG chứa dữ liệu ────────────────────────────────────────────
 *
 * §9 đã đưa mọi bộ dữ liệu vào một bảng `raw_*` trong ClickHouse. Những gì ở
 * đây chỉ là LỜI MÔ TẢ về dữ liệu nằm ở đó: cột nào để nhóm, cột nào để đo,
 * người dùng muốn gọi nó là gì, và hai bảng nối nhau bằng khoá nào.
 *
 * Express đọc mô tả đó để SINH RA file cube schema cho Cube.js, và Cube mới là
 * thứ dịch một câu hỏi "doanh thu theo khu vực" thành SQL chạy trên ClickHouse.
 */

/**
 * Vai trò của một cột trong mô hình.
 *
 * `hidden` phục vụ HAI việc có cùng hệ quả nên không đáng hai cột:
 *   - `_row_index` — cột hệ thống §9 thêm vào mọi bảng `raw_*`. Nó vẫn đi vào
 *     file cube làm khoá chính (Cube cần khoá chính để JOIN đếm đúng), nhưng
 *     không bao giờ được lọt vào một bộ chọn của người dùng.
 *   - Cột người dùng chủ động bỏ khỏi mô hình.
 *
 * Thứ tự khớp ENUM trong database, và ENUM phải nối giá trị mới vào cuối.
 */
export const COLUMN_ROLES = ['dimension', 'measure', 'hidden'] as const;
export type ColumnRole = (typeof COLUMN_ROLES)[number];

/**
 * Tên hiện ra cho người dùng, KÈM từ tiếng Anh trong ngoặc.
 *
 * ─── Vì sao mang theo từ tiếng Anh ─────────────────────────────────────────
 *
 * "Chiều" và "Thước đo" là hai từ dịch, và người dùng gặp chúng lần đầu ngay ở
 * màn hình phải ra quyết định — chọn vai trò cho từng cột. Ai đã dùng Power BI
 * hay Metabase thì nhận ra ngay khi thấy "Dimension"/"Measure"; ai chưa dùng
 * thì cũng không mất gì, vì từ tiếng Việt vẫn đứng trước.
 *
 * ⚠️ Đây là NGUỒN DUY NHẤT của hai từ này trong giao diện. Explorer và hộp
 * thoại báo cáo đọc từ đây chứ không viết lại chuỗi của mình — hai bản sao sẽ
 * lệch nhau ngay lần đầu ai đó sửa một chỗ.
 *
 * Chỉ dùng cho NHÃN. Câu văn xuôi vẫn viết "chiều", "thước đo" bình thường:
 * chèn ngoặc vào giữa một câu thì câu đó không đọc được nữa.
 */
export const COLUMN_ROLE_LABELS: Record<ColumnRole, string> = {
  dimension: 'Chiều (Dimension)',
  measure: 'Thước đo (Measure)',
  hidden: 'Ẩn (Hidden)',
};

/**
 * Một câu nói NÓ LÀ GÌ, cho người chưa từng dùng công cụ BI nào.
 *
 * Từ tiếng Anh trong ngoặc chỉ giúp người đã biết khái niệm mà quen tên khác.
 * Người chưa biết thì cần một câu, và câu đó phải nói bằng ví dụ chứ không phải
 * định nghĩa: "cột để chia nhóm" hiểu được ngay, "thuộc tính phân rã dữ liệu
 * theo trục ngữ nghĩa" thì không.
 */
export const COLUMN_ROLE_HINTS: Record<ColumnRole, string> = {
  dimension: 'Cột để chia nhóm — theo khu vực, theo tháng, theo sản phẩm.',
  measure: 'Con số để tính — tổng doanh thu, số đơn, giá trung bình.',
  hidden: 'Không đưa vào mô hình. Vẫn nằm trong kho, chỉ không hiện ra để chọn.',
};

/**
 * Kiểu của một chiều theo cách Cube hiểu.
 *
 * ⚠️ TRỰC GIAO với `ColumnRole`, và trộn hai thứ này là lỗi sẽ xảy ra trong
 * vòng một tuần nếu không tách tên rõ ràng ngay từ đầu. Một cột `Float64` chứa
 * mã sản phẩm hoàn toàn có thể mang `role: 'dimension'` mà `cubeType: 'number'`
 * — "dùng để nhóm" và "chứa chữ số" là hai câu khác nhau.
 */
export const CUBE_TYPES = ['string', 'number', 'time', 'boolean'] as const;
export type CubeType = (typeof CUBE_TYPES)[number];

/**
 * Phép tổng hợp của một thước đo (§10.6).
 *
 * ⚠️ CỐ Ý không còn khớp `AGGREGATES` của `report.ts` nữa. Hai danh sách phục vụ
 * hai đường khác hẳn nhau: `AGGREGATES` là phép gộp mà `aggregate.ts` tự tính
 * bằng TypeScript trên `dataset_rows` cho báo cáo dựng thẳng từ file (§7), còn
 * danh sách này đi vào file cube rồi thành SQL trên ClickHouse. `countDistinct`
 * có ở đây vì ClickHouse làm được; thêm nó vào `AGGREGATES` là hứa một phép
 * tính mà nhánh kia chưa hiện thực.
 */
export const MEASURE_AGGS = [
  'sum',
  'avg',
  'count',
  'countDistinct',
  'min',
  'max',
  'median',
  'p90',
] as const;
export type MeasureAgg = (typeof MEASURE_AGGS)[number];

/**
 * Tên hiện ra cho người dùng.
 *
 * `p90` KHÔNG mang tên đúng của nó trong thống kê ("phân vị 90"). Người đọc
 * báo cáo bán hàng không có khái niệm phân vị, nên cái tên đúng ấy không dẫn
 * tới bất kỳ hành động nào — còn "ngưỡng top 10%" thì nói thẳng ra thứ họ định
 * làm với con số: lấy mốc để tách nhóm cao nhất.
 *
 * `count` cũng đổi tên, và vì một lý do nặng hơn: nhãn cũ "Đếm dòng" MÔ TẢ SAI
 * việc nó làm khi gắn vào một cột. `count(cột)` bỏ qua ô trống, nên nó đếm ô
 * chứ không đếm dòng — trên bảng Orders trong máy là 9.994 so với 51.290. Một
 * người tin vào nhãn cũ sẽ đọc con số đó như tổng số đơn hàng.
 */
export const MEASURE_AGG_LABELS: Record<MeasureAgg, string> = {
  sum: 'Tổng',
  avg: 'Trung bình',
  count: 'Đếm ô có dữ liệu',
  countDistinct: 'Đếm giá trị khác nhau',
  min: 'Nhỏ nhất',
  max: 'Lớn nhất',
  median: 'Trung vị',
  p90: 'Ngưỡng top 10%',
};

/**
 * Một câu giải thích cho mỗi phép, hiện khi rê chuột lên nút.
 *
 * ─── Vì sao nhãn thôi là không đủ ──────────────────────────────────────────
 *
 * "Trung vị" và "Trung bình" lệch nhau đúng một chữ và nằm sát nhau trong hàng
 * nút. Người đọc lướt sẽ nhìn nhầm, rồi kết luận là hệ thống trả sai số. Câu
 * giải thích không sửa được cái nhìn lướt, nhưng nó có mặt đúng lúc người dùng
 * dừng lại vì đã thấy nghi.
 *
 * Câu của `avg` cố ý nói ra ĐIỂM YẾU của chính nó, chứ không mô tả cách tính —
 * cách tính thì ai cũng biết rồi, còn chuyện nó bị kéo lệch mới là thứ khiến
 * người ta đi tìm trung vị.
 */
export const MEASURE_AGG_HINTS: Record<MeasureAgg, string> = {
  sum: 'Cộng tất cả giá trị lại.',
  avg: 'Cộng tất cả rồi chia đều. Chỉ vài giá trị rất lớn hoặc rất nhỏ cũng đủ kéo lệch con số này.',
  count:
    'Đếm số dòng CÓ ĐIỀN cột này. Ô trống không được tính, nên con số này có thể nhỏ hơn thước đo "Số dòng".',
  countDistinct: 'Đếm xem có bao nhiêu giá trị khác nhau. Trùng nhau chỉ tính một lần.',
  min: 'Giá trị nhỏ nhất.',
  max: 'Giá trị lớn nhất.',
  median:
    'Giá trị đứng giữa: một nửa số dòng thấp hơn mức này, một nửa cao hơn. Không bị vài giá trị cực lớn kéo lệch như trung bình.',
  p90: 'Mức mà 90% số dòng nằm dưới — tức ngưỡng bắt đầu của 10% cao nhất.',
};

/**
 * Phép gộp nào hợp lệ với cột kiểu nào — §10.6.
 *
 * ═══ Vì sao phải có bảng này, thay vì cứ cho chọn hết ══════════════════════
 *
 * `sum` trên một cột `String` không phải một lựa chọn tồi, nó là một câu SQL
 * KHÔNG CHẠY. ClickHouse ném lỗi lúc truy vấn, tức là người dùng đặt xong,
 * lưu xong, rồi mới thấy hỏng ở tab Explorer — cách xa chỗ họ gây ra lỗi hai
 * màn hình. Chặn ngay lúc chọn thì lỗi không bao giờ tồn tại.
 *
 * ═══ `count` ở đây KHÁC `count` của thước đo "Số dòng" ═════════════════════
 *
 * Bản trước cấm hẳn `count` trên cột, với lý lẽ rằng nó sẽ đẻ ra một thước đo
 * thứ hai đếm đúng con số của "Số dòng" nhưng mang tên một cột. Lý lẽ đó dựa
 * trên một tiền đề SAI: `count` gắn vào cột không sinh ra `COUNT(*)`.
 *
 * Cube sinh `count(<cột>)` khi khối thước đo có `sql`, và `count(<cột>)` của
 * ClickHouse BỎ QUA ô trống. Mọi cột `raw_*` đều `Nullable` (§9), nên hai con
 * số này lệch nhau thật sự — đo trên bảng Orders trong máy:
 *
 *     Số dòng                51.290
 *     count(`Postal Code`)    9.994
 *
 * Tức đây là hai câu hỏi khác nhau: "có bao nhiêu đơn" và "bao nhiêu đơn có
 * điền mã bưu chính". Câu thứ hai là cách duy nhất đo được ĐỘ ĐẦY của dữ liệu
 * — thứ người ta cần ngay khi nghi ngờ một cột nhập thiếu.
 *
 * Thước đo "Số dòng" (`ROW_COUNT_MEASURE_NAME`) vẫn giữ nguyên nghĩa cũ: nó đi
 * cùng `columnId = null`, không có `sql`, nên Cube đếm theo khoá chính. Cái
 * tách hai nghĩa là SỰ CÓ MẶT CỦA CỘT, không phải tên phép.
 *
 * ─── Bốn dòng dưới, mỗi dòng một lý lẽ ─────────────────────────────────────
 *
 *   number  — cộng, trung bình, nhỏ/lớn nhất đều có nghĩa. `countDistinct`
 *             cũng có: "bao nhiêu mức giá khác nhau". `median` và `p90` CHỈ ở
 *             dòng này: trung vị của một chuỗi hay của một mốc thời gian là
 *             khái niệm không ai đi tìm, còn ClickHouse thì vẫn tính ra được —
 *             tức là mở ra chỉ để sinh một con số không ai đọc.
 *   time    — `min`/`max` là "lần đầu tiên" và "gần nhất", hai câu hỏi rất hay
 *             gặp mà trước bản này KHÔNG hỏi được. Cộng hai mốc thời gian thì
 *             vô nghĩa nên không có `sum`; trung bình của thời điểm cũng vậy.
 *   string  — đếm được số giá trị khác nhau ("bao nhiêu khách hàng") và số ô
 *             có dữ liệu ("bao nhiêu đơn có ghi tên khách").
 *   boolean — như string. Ít dùng, nhưng chặn hẳn thì lại phải giải thích vì
 *             sao ô này trống.
 *
 * `count` có ở CẢ BỐN dòng: "cột này thiếu dữ liệu bao nhiêu" là câu hỏi không
 * phụ thuộc kiểu cột.
 */
export const MEASURE_AGGS_BY_CUBE_TYPE: Record<CubeType, readonly MeasureAgg[]> = {
  number: ['sum', 'avg', 'median', 'p90', 'min', 'max', 'count', 'countDistinct'],
  time: ['min', 'max', 'count', 'countDistinct'],
  string: ['count', 'countDistinct'],
  boolean: ['count', 'countDistinct'],
};

/** Phép gộp này đặt lên cột kiểu kia được không. Dùng ở CẢ hai đầu. */
export function measureAggAllowed(cubeType: CubeType, agg: MeasureAgg): boolean {
  return MEASURE_AGGS_BY_CUBE_TYPE[cubeType].includes(agg);
}

/**
 * Phép nối hai thước đo trong một thước đo TÍNH TOÁN — §10.6.
 *
 * ─── Vì sao là bốn phép chọn sẵn, không phải một ô nhập công thức ───────────
 *
 * Cả §9 lẫn §10 dựng trên một nguyên tắc: KHÔNG một ký tự nào của người dùng đi
 * vào câu lệnh SQL. Tên bảng sinh từ hai số nguyên, tên cột qua `quoteIdent`,
 * Explorer chỉ nhận ID. Một ô nhập công thức tự do phá đúng nguyên tắc đó, và
 * phá ở chỗ khó vá nhất — biểu thức người dùng gõ phải đi thẳng vào `sql:` của
 * file cube.
 *
 * Bốn phép và hai toán hạng là ID thì công thức dựng hoàn toàn từ dữ liệu của
 * ta. Cái giá: không viết được `CASE WHEN`. Cái được: không có đường nào để một
 * chuỗi lạ chạm tới kho.
 */
export const MEASURE_OPS = ['add', 'sub', 'mul', 'div'] as const;
export type MeasureOp = (typeof MEASURE_OPS)[number];

/**
 * Ba cách một thước đo ra đời — §10.6.
 *
 *   column   `sum(Doanh thu)`                    gộp MỘT cột
 *   formula  `sum(Lợi nhuận) / sum(Doanh thu)`   nối hai thước đo ĐÃ GỘP
 *   rowExpr  `sum(Số lượng × Đơn giá)`           tính từng DÒNG rồi mới gộp
 *
 * ═══ Vì sao `formula` một mình là không đủ ═════════════════════════════════
 *
 * `formula` gộp trước rồi mới tính, nên với phép NHÂN nó cho ra
 * `sum(a) × avg(b)` — một con số không ai đi hỏi. Đo trên bảng `Orders_detail`
 * của tổ chức 4, 22.463 dòng:
 *
 *     sum(Số lượng × Đơn giá)      39.379.467.000   đúng
 *     sum(Số lượng) × avg(Đơn giá) 39.398.064.742   lệch 0,047%
 *
 * Lệch 0,047% là chỗ nguy hiểm, không phải chỗ may mắn: không ai phát hiện ra.
 * Chia theo sản phẩm thì lệch 1,4–1,9%, vẫn không ai phát hiện.
 *
 * ─── Và vì sao `rowExpr` một mình cũng không đủ ────────────────────────────
 *
 * Với phép CHIA thì gộp-trước mới đúng: tỷ suất lợi nhuận là
 * `sum(lợi nhuận) / sum(doanh thu)`, KHÔNG phải trung bình của tỷ suất từng
 * dòng — dòng doanh thu 10 đồng và dòng doanh thu 10 triệu không được cân bằng
 * nhau. Hai kiểu này bù cho nhau chứ không thay thế nhau.
 */
export const MEASURE_KINDS = ['column', 'formula', 'rowExpr'] as const;
export type MeasureKind = (typeof MEASURE_KINDS)[number];

/**
 * Kiểu nào là MẶC ĐỊNH cho một phép toán, khi người dùng chọn hai cột.
 *
 * Luật này đến từ ĐẠI SỐ, không từ nghiệp vụ — nên nó đúng với mọi ngành:
 *
 *   ×   hai đại lượng trên CÙNG một dòng nhân với nhau thì có nghĩa trên dòng
 *       đó; `sum(a) × avg(b)` thì không có nghĩa gì cả.
 *   ÷   tỷ số của hai TỔNG là thứ người ta hỏi (tỷ suất, đơn giá bình quân);
 *       trung bình của các tỷ số từng dòng cân bằng sai trọng số.
 *   + − cộng trừ hai tổng.
 *
 * Chỉ là MẶC ĐỊNH. Hộp thoại viết cả hai công thức ra cho người dùng đối chiếu
 * và đổi được cả hai chiều — vì có những ca ngược lại, và đoán sai mà không nói
 * ra thì lại thành đúng cái bẫy `formula` đang mắc.
 */
export function defaultKindForOp(op: MeasureOp): MeasureKind {
  return op === 'mul' ? 'rowExpr' : 'formula';
}

export const MEASURE_OP_LABELS: Record<MeasureOp, string> = {
  add: '+',
  sub: '−',
  mul: '×',
  div: '÷',
};

/**
 * NGUỒN của một thước đo — biểu thức mà phép gộp áp lên.
 *
 * ═══ Vì sao thứ này phải đi kèm mọi thước đo ═══════════════════════════════
 *
 * Thước đo gieo sẵn mang ĐÚNG TÊN CỘT: bảng Orders có cột `Total amount` thì
 * mô hình có thước đo `Total amount`. Trên màn hình chúng là hai dòng chữ y hệt
 * nhau, nên không có gì nói cho người dùng biết rằng cái thứ hai là
 * `sum(Total amount)`.
 *
 * Hậu quả không phải là khó dùng, mà là ĐỌC SAI: `Total amount` trong dữ liệu
 * là số tiền của MỘT đơn, còn `Total amount` trong Explorer là tổng tiền của
 * mọi đơn trong nhóm. Người dùng nhìn thấy một con số hàng tỉ ở chỗ họ chờ một
 * con số hàng trăm nghìn, và không có gì trên màn hình giải thích khoảng cách
 * đó. Tự động gieo thước đo mà không nói ra phép tính là bắt người dùng đoán.
 *
 * ─── Vì sao là NGUỒN, không phải một câu mô tả sẵn ─────────────────────────
 *
 * Explorer cho đổi phép gộp TẠI CHỖ (§10.7). Một câu dựng sẵn ở backend sẽ nói
 * "Tổng của Total amount" trong khi người dùng vừa bấm sang Trung bình — sai
 * ngay lúc họ cần đọc nhất. Nên backend gửi phần KHÔNG đổi (biểu thức), còn câu
 * chữ thì `moTaThuocDo` dựng lại mỗi lần render với phép đang chọn.
 */
export interface MeasureSourceDto {
  /** `rows` = đếm dòng: không gộp cột nào, nên `expr` là `null`. */
  kind: MeasureKind | 'rows';
  expr: string | null;
}

/**
 * Câu trả lời cho "con số này tính từ đâu ra".
 *
 * Dạng `<Phép> của <biểu thức>` chứ không phải dạng hàm `Tổng( … )`: khối này
 * để GIẢI THÍCH, và tám nhãn phép gộp đọc trôi hết ở dạng này —
 * "Đếm ô có dữ liệu của Postal Code" là một câu, còn
 * "Đếm ô có dữ liệu( Postal Code )" thì không. Dạng hàm vẫn dùng ở hộp thoại
 * dựng công thức, nơi người dùng đang GHÉP một biểu thức chứ không đọc nó.
 *
 * Thước đo TÍNH TOÁN trả về thẳng biểu thức, không kèm phép gộp: hai vế của nó
 * đã gộp xong rồi, nên "Tổng của Lợi nhuận ÷ Doanh thu" sẽ mô tả một phép tính
 * không tồn tại.
 */
export function moTaThuocDo(nguon: MeasureSourceDto, agg: MeasureAgg, tenBang: string): string {
  if (nguon.kind === 'rows') return `Đếm số dòng của bảng ${tenBang}`;
  if (nguon.expr === null) return MEASURE_AGG_LABELS[agg];
  if (nguon.kind === 'formula') return nguon.expr;

  // Ngoặc cho biểu thức dòng, vì đó chính là chỗ hay bị đọc ngược: "Tổng của
  // Số lượng × Đơn giá" có thể hiểu thành `sum(Số lượng) × Đơn giá`, mà đó lại
  // đúng là phép tính SAI mà loại thước đo này sinh ra để tránh.
  const bieuThuc = nguon.kind === 'rowExpr' ? `(${nguon.expr})` : nguon.expr;
  return `${MEASURE_AGG_LABELS[agg]} của ${bieuThuc}`;
}

/** Cách ĐỌC con số, không đổi con số. `percent` hiển thị 0,283 thành 28,3 %. */
export const MEASURE_FORMATS = ['number', 'percent'] as const;
export type MeasureFormat = (typeof MEASURE_FORMATS)[number];

export const MEASURE_FORMAT_LABELS: Record<MeasureFormat, string> = {
  number: 'Số thường',
  percent: 'Phần trăm',
};

/**
 * Hướng của một quan hệ — quyết định Cube sinh JOIN kiểu gì.
 *
 * CỐ Ý không có `many_to_many`: Cube cần một bảng trung gian cho quan hệ đó, và
 * sinh join nhiều-nhiều không có bảng cầu nối cho ra tổng bị NHÂN LÊN trong im
 * lặng — kiểu sai tệ nhất, vì số vẫn ra và trông vẫn hợp lý.
 */
export const RELATIONSHIP_KINDS = ['one_to_many', 'many_to_one', 'one_to_one'] as const;
export type RelationshipKind = (typeof RELATIONSHIP_KINDS)[number];

export const RELATIONSHIP_KIND_LABELS: Record<RelationshipKind, string> = {
  one_to_many: 'Một → nhiều',
  many_to_one: 'Nhiều → một',
  one_to_one: 'Một → một',
};

/** Nhãn ngắn vẽ trên đường nối của canvas. Luôn là CHỮ, không phải ký hiệu. */
export const RELATIONSHIP_KIND_SHORT: Record<RelationshipKind, string> = {
  one_to_many: '1..n',
  many_to_one: 'n..1',
  one_to_one: '1..1',
};

// ─── Bộ dữ liệu trong mô hình ────────────────────────────────────────────────

export interface DataModelColumnDto {
  id: number;
  /** Tên cột NGUYÊN VĂN trong ClickHouse. Đây là thứ đi vào SQL. */
  columnName: string;
  /** Tên người dùng muốn thấy. Trống thì lấy `columnName`. */
  alias: string | null;
  /**
   * Cột này NGHĨA LÀ GÌ — §8.3.1.
   *
   * Không phải trang trí. Tên cột trong kho thường là viết tắt (`SL_BAN`,
   * `DT_LK`) và tên hiển thị chỉ nới nó ra được vài chữ; câu "số lượng bán
   * trong kỳ, KHÔNG gồm hàng trả lại" thì không có chỗ nào khác để viết. Nó đi
   * thẳng vào `description` của Cube, nên Explorer đọc lại đúng câu đó khi
   * người dùng rê chuột lên trường.
   */
  description: string | null;
  role: ColumnRole;
  /** Kiểu ClickHouse đầy đủ, đọc từ `system.columns` lúc xem. */
  chType: string;
  cubeType: CubeType;
  ordinal: number;
  /**
   * Kiểu đã ĐỔI so với lúc phân loại.
   *
   * Nạp lại bộ dữ liệu có thể biến `Int64` thành `String`, và khi đó một thước
   * đo `sum()` dựng trên cột này đang chạy trên văn bản. Giao diện phải nói ra,
   * không để người dùng tự phát hiện qua một con số lạ.
   */
  typeChanged: boolean;
}

export interface DataModelDatasetDto {
  /** Id của DÒNG NỐI, không phải id bộ dữ liệu. Mọi thứ khác trỏ vào cái này. */
  id: number;
  datasetId: number;
  /** Tên của BỘ DỮ LIỆU, dùng chung cho mọi mô hình. */
  datasetName: string;
  /**
   * Tên hiển thị RIÊNG trong mô hình này.
   *
   * Tách khỏi `datasetName` vì cùng một bộ dữ liệu có thể đóng hai vai khác nhau
   * ở hai mô hình, và đổi tên ở đây không được đụng tới tên trong Kho dữ liệu.
   */
  displayName: string | null;
  description: string | null;
  /**
   * Khoá chính NGHIỆP VỤ — cột mà các bảng khác nối tới.
   *
   * ⚠️ KHÔNG phải `primary_key` mà Cube dùng. Cube nhận `_row_index` (§9), vốn
   * chắc chắn duy nhất, để đếm đúng qua JOIN. Cột khai ở đây chỉ nói "muốn nối
   * tới bảng này thì nối vào cột này" — giao diện dùng nó để điền sẵn form quan
   * hệ. Tách hai vai để một lựa chọn sai của người dùng không làm hỏng số liệu.
   */
  primaryColumnId: number | null;
  primaryColumnName: string | null;
  /** Bảng trong ClickHouse — hiện ra để người dùng đối chiếu được. */
  chTable: string;
  canvasX: number;
  canvasY: number;
  columns: DataModelColumnDto[];
}

// ─── Thước đo (§10.6) ────────────────────────────────────────────────────────

export interface DataModelMeasureDto {
  id: number;
  name: string;
  agg: MeasureAgg;
  /** Dòng nối chứa cột được đo. */
  datamodelDatasetId: number;
  datasetName: string;
  /** `null` KHI VÀ CHỈ KHI `agg === 'count'` — đếm dòng không đo cột nào. */
  columnId: number | null;
  columnName: string | null;
  /**
   * Ba cách một thước đo ra đời — xem `MEASURE_KINDS`.
   *
   * Một trường thay vì đoán qua `formula !== null`: mã đọc dữ liệu này nằm ở
   * bốn chỗ, và "suy ra kiểu từ việc một trường có null hay không" là thứ sẽ
   * lệch nhau ngay khi thêm kiểu thứ ba — mà kiểu thứ ba đã tới thật.
   */
  kind: MeasureKind;
  format: MeasureFormat;
  /** Chỉ có khi `kind === 'formula'`. Tên hai vế kèm sẵn để khỏi tra lại. */
  formula: {
    leftId: number;
    leftName: string;
    op: MeasureOp;
    rightId: number;
    rightName: string;
  } | null;
  /**
   * Chỉ có khi `kind === 'rowExpr'`. Hai vế là CỘT, không phải thước đo.
   *
   * Cột trái nằm ở `columnId`/`columnName` phía trên — `rowExpr` chỉ khác
   * `column` ở chỗ có thêm một vế phải và một phép nối.
   */
  rowExpr: {
    op: MeasureOp;
    rightColumnId: number;
    rightColumnName: string;
  } | null;
  createdAt: string;
}

// ─── Quan hệ (§10.4, §10.5) ──────────────────────────────────────────────────

export interface RelationshipEndDto {
  /** Id dòng nối `datamodel_datasets`. */
  datasetRef: number;
  datasetName: string;
  columnId: number;
  columnName: string;
}

export interface DataModelRelationshipDto {
  id: number;
  left: RelationshipEndDto;
  right: RelationshipEndDto;
  kind: RelationshipKind;
  createdAt: string;
}

/**
 * Cảnh báo phát ra khi LƯU một quan hệ, không phải khi truy vấn.
 *
 * Nối trên một cột có giá trị TRÙNG ở phía "một" sẽ nhân bản mọi dòng bên kia,
 * và mọi phép SUM sau đó lớn hơn sự thật. Cube không phát hiện được, ClickHouse
 * không phàn nàn, biểu đồ chỉ hiện một con số sai trông rất hợp lý. Đây gần như
 * chắc chắn là nguồn của câu "số bị sai" đầu tiên người dùng gặp ở §10.
 *
 * Cảnh báo chứ KHÔNG chặn: nối qua bảng cầu nối là trường hợp hợp lệ và cũng
 * cho ra khoá trùng.
 */
/**
 * Cảnh báo phát ra khi ĐẶT khoá chính cho một bảng — §10.3.
 *
 * Cùng họ với `RelationshipWarningDto` nhưng xuất hiện sớm hơn một bước: khoá
 * chính sai làm mọi quan hệ nối vào nó nhân bản dòng, và hậu quả là những con số
 * lớn hơn sự thật mà không có lỗi nào báo ra.
 */
export interface PrimaryKeyWarningDto {
  /** Tên cột vừa khai. Cảnh báo phải nói RÕ nó là cột nào, không bắt đi tra lại. */
  columnName: string;
  /** Cột có giá trị TRÙNG — nó không phải khoá, dù người dùng vừa khai là khoá. */
  duplicateValues: boolean;
  /**
   * Số giá trị KHÁC NHAU.
   *
   * Đi kèm `rowCount` và `nullValues` là ra được số dòng dôi ra — thứ quyết định
   * MỨC ĐỘ nghiêm trọng. Một bảng 1.173 dòng dôi 1 dòng là dữ liệu nguồn có lỗi
   * nhỏ, sửa được; 51.290 dòng chỉ có 25.035 giá trị nghĩa là cột đó vốn dĩ
   * không phải khoá và phải chọn cột khác. Chỉ đưa `rowCount` thì hai ca đó đọc
   * lên giống hệt nhau.
   */
  distinctValues: number;
  /** Số dòng mang giá trị trống; chúng rơi khỏi kết quả khi nối. */
  nullValues: number;
  rowCount: number;
}

export interface RelationshipWarningDto {
  /** Khoá bên "một" có giá trị trùng — tổng sau khi nối có thể bị nhân lên. */
  duplicateKeys: boolean;
  /** Số dòng có khoá `NULL`; chúng rơi khỏi kết quả JOIN trong im lặng. */
  nullKeys: number;
}

// ─── Mô hình ─────────────────────────────────────────────────────────────────

export interface DataModelDto {
  id: number;
  workspaceId: number;
  name: string;
  description: string | null;
  datasetCount: number;
  measureCount: number;
  relationshipCount: number;
  creatorName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DataModelDetailDto extends DataModelDto {
  datasets: DataModelDatasetDto[];
  measures: DataModelMeasureDto[];
  relationships: DataModelRelationshipDto[];
}

// ─── Nạp cho bộ chọn của Explorer (§10.7) ────────────────────────────────────

/**
 * Danh sách phẳng những gì hỏi được, ĐÃ gộp cột và thước đo của mọi bảng.
 *
 * Một request thay vì bắt Explorer tự ghép `/schema` với `/measures` — và quan
 * trọng hơn: frontend KHÔNG BAO GIỜ thấy tên cube. Nó gửi id, Express dựng tên.
 * Nhờ vậy đổi quy ước đặt tên cube không phải là thay đổi phá vỡ API.
 */
export interface ExplorerFieldDto {
  id: number;
  label: string;
  /** Tên bảng, để bộ chọn gom nhóm cho dễ tìm. */
  datasetName: string;
  /**
   * Mô tả viết ở tab Schemas — §8.3.1. `null` = chưa ai viết.
   *
   * Đây là chỗ nó ĐÁNG GIÁ nhất: người chọn trường trong Explorer thường không
   * phải người dựng mô hình, và câu hỏi họ đang có là "cột này có gồm hàng trả
   * lại không". Bắt họ mở tab Schemas để đọc câu trả lời là bắt họ rời khỏi
   * việc đang làm.
   */
  description: string | null;
  cubeType: CubeType;
  /**
   * Phép gộp mô hình đang khai cho thước đo này. Chiều không có.
   *
   * Explorer cần nó để tô đậm đúng nút đang chọn khi người dùng chưa đổi gì —
   * nếu không thì hàng nút mở ra với không nút nào sáng, và con số hiện trên
   * bảng lại đang tính bằng một phép mà giao diện không nói ra.
   */
  agg?: MeasureAgg | undefined;
  /**
   * Các phép ĐỔI ĐƯỢC ngay trong Explorer, không phải quay về tab Schemas.
   *
   * Rỗng nghĩa là không đổi được, và có hai loại như vậy: thước đo TÍNH TOÁN
   * (hai vế đã gộp sẵn, gộp thêm lần nữa là sai) và thước đo ĐẾM DÒNG (không
   * đo cột nào để mà đổi phép).
   */
  availableAggs?: readonly MeasureAgg[] | undefined;
  /**
   * Biểu thức mà phép gộp áp lên — xem `MeasureSourceDto`. Chiều không có.
   *
   * Bộ chọn dùng nó để viết ra "Tổng của Total amount" ngay dưới tên thước đo,
   * nên người dùng không phải suy ra phép tính từ một cái tên trùng với tên cột.
   */
  nguon?: MeasureSourceDto | undefined;
}

export interface ExplorerFieldsDto {
  dimensions: ExplorerFieldDto[];
  measures: ExplorerFieldDto[];
}

export const TIME_GRANULARITIES = ['day', 'week', 'month', 'quarter', 'year'] as const;
export type TimeGranularity = (typeof TIME_GRANULARITIES)[number];

export const TIME_GRANULARITY_LABELS: Record<TimeGranularity, string> = {
  day: 'Ngày',
  week: 'Tuần',
  month: 'Tháng',
  quarter: 'Quý',
  year: 'Năm',
};

/**
 * Một câu hỏi gửi tới Explorer.
 *
 * ⚠️ TOÀN BỘ là id của dòng trong MySQL của ta — không một tên cube, tên bảng
 * hay tên cột nào đi từ trình duyệt xuống. Express tra id trong phạm vi mô hình
 * đã được lọc theo tổ chức, rồi TỰ DỰNG tên cube. Đây là lớp chặn chính của
 * việc cách ly tổ chức, cùng nguyên tắc với `aggregateWarehouse`: chuỗi đi vào
 * truy vấn lấy từ database của ta, không phải từ body request.
 */
export interface ExplorerQueryDto {
  dimensionIds: number[];
  measureIds: number[];
  /**
   * `| undefined` tường minh vì `tsconfig` bật `exactOptionalPropertyTypes`:
   * ở chế độ đó `?:` nghĩa là "vắng mặt", KHÔNG phải "có mặt với giá trị
   * undefined", mà zod thì trả về đúng cái thứ hai.
   */
  timeDimension?: { dimensionId: number; granularity: TimeGranularity } | undefined;
  limit?: number | undefined;
  /**
   * Đổi phép gộp của một thước đo CHỈ CHO truy vấn này — §10.7.
   *
   * Không ghi gì vào mô hình: hai người mở cùng một mô hình có thể muốn hai
   * phép khác nhau trong cùng một lúc, và một cú bấm ở Explorer sửa cấu hình
   * chung là thứ người thứ hai không có cách nào biết.
   *
   * Danh sách chứ không phải object: khoá số trong JSON luôn về chuỗi, và một
   * `Record<number, ...>` sẽ bắt cả hai đầu tự ép kiểu qua lại.
   */
  measureAggs?: readonly { id: number; agg: MeasureAgg }[] | undefined;
}

/** Kết quả đã dịch ngược về id — Explorer không cần biết Cube gọi chúng là gì. */
/**
 * Câu lệnh Cube sinh ra cho một truy vấn — §10.7.
 *
 * Tồn tại để tầng ngữ nghĩa thôi là hộp đen: người dùng chọn hai trường và nhận
 * một con số, còn phép nối nào tạo ra con số đó thì không nhìn thấy. Khi số
 * trông sai, đây là bằng chứng phân biệt "mô hình khai sai" với "dữ liệu vốn
 * thế" — thứ mà không cảnh báo nào thay được.
 */
export interface ExplorerSqlDto {
  /** SQL gửi xuống ClickHouse. Tham số còn ở dạng `?`. */
  sql: string;
  /** Giá trị thay vào các dấu `?`, theo thứ tự. */
  params: (string | number)[];
  /** Truy vấn Cube (JSON) — tầng trung gian giữa lựa chọn và SQL. */
  cubeQuery: string;
}

export interface ExplorerResultDto {
  columns: {
    id: number;
    label: string;
    kind: 'dimension' | 'measure';
    /** Chỉ có ở thước đo — quyết định cách ĐỌC con số, không đổi con số. */
    format?: MeasureFormat;
    /**
     * "Tổng của Total amount" — phép tính đã tạo ra cột này.
     *
     * Đi theo KẾT QUẢ chứ không chỉ nằm ở bộ chọn, vì tiêu đề cột mới là chỗ
     * một con số bị đọc sai thành một kết luận. Dựng ở backend với phép gộp
     * thật sự đã chạy, nên nó không thể lệch với con số bên dưới.
     */
    mota?: string;
  }[];
  rows: (string | number | null)[][];
  /** Đã chạm trần số dòng: còn dữ liệu mà truy vấn không lấy hết. */
  truncated: boolean;
}

// ─── Đầu vào ─────────────────────────────────────────────────────────────────

export interface CreateDataModelInput {
  /**
   * BẮT BUỘC, dù zod phía backend vẫn nhận thiếu.
   *
   * Mỗi workspace có nội dung riêng, nên mô hình phải nằm đúng workspace người
   * dùng đang đứng. Backend có nhánh dự phòng `resolveWorkspace(undefined)`
   * nhưng nhánh đó chọn workspace ĐẦU TIÊN THEO TÊN (`ORDER BY w.name ASC`) —
   * không liên quan gì tới nơi người dùng đang làm việc.
   *
   * Hậu quả của một lần quên: mô hình rơi vào workspace khác và biến mất khỏi
   * danh sách ngay sau khi tạo. Tổ chức một workspace thì hai thứ đó tình cờ
   * trùng nhau nên lỗi không lộ ra cho tới khi có workspace thứ hai.
   *
   * Bắt buộc ở đây là để TRÌNH BIÊN DỊCH chặn, thay vì trông vào việc nhớ.
   */
  workspaceId: number;
  name: string;
  description?: string;
  /** Chỉ nhận bộ dữ liệu đã `loadStatus === 'loaded'` — chưa nạp thì chưa có bảng. */
  datasetIds: number[];
}

export interface SaveSchemaInput {
  columns: {
    columnId: number;
    alias: string | null;
    role: ColumnRole;
    /**
     * Mô tả của cột — cùng ba trạng thái với `measureAgg` ngay dưới.
     *
     * `undefined` = không đụng tới, `null` = xoá trống, chuỗi = đặt nó.
     */
    description?: string | null;
    /**
     * Phép gộp của thước đo dựng trên cột này.
     *
     * `null` = không có thước đo nào cho cột này. `undefined` = không đụng tới.
     * Ba trạng thái chứ không hai, vì "bỏ thước đo đi" và "để nguyên" là hai ý
     * định khác nhau và cả hai đều phải nói được.
     */
    measureAgg?: MeasureAgg | null;
  }[];
}

export interface CreateFormulaMeasureInput {
  name: string;
  leftId: number;
  op: MeasureOp;
  rightId: number;
  format: MeasureFormat;
}

/**
 * ⚠️ Hai vế là ID CỘT, không phải ID thước đo như `CreateFormulaMeasureInput`.
 *
 * Và `agg` ở đây mang nghĩa THẬT: nó là phép gộp áp lên kết quả biểu thức, đổi
 * nó là đổi hẳn con số. Ở `formula` thì `agg` chỉ là giá trị giữ chỗ.
 */
export interface CreateRowExprMeasureInput {
  name: string;
  agg: MeasureAgg;
  leftColumnId: number;
  op: MeasureOp;
  rightColumnId: number;
  format: MeasureFormat;
}

export interface CreateRelationshipInput {
  leftId: number;
  leftColumnId: number;
  rightId: number;
  rightColumnId: number;
  kind: RelationshipKind;
}

export interface CreateMeasureInput {
  datamodelDatasetId: number;
  name: string;
  agg: MeasureAgg;
  /** Bỏ trống KHI VÀ CHỈ KHI `agg === 'count'`. */
  columnId?: number;
}

export interface SaveLayoutInput {
  positions: { id: number; x: number; y: number }[];
}

export const DATAMODEL_NAME_MAX = 255;
export const MEASURE_NAME_MAX = 255;

export const DATAMODEL_ERROR_CODES = {
  /** Bộ dữ liệu chưa nạp vào kho nên chưa có bảng nào để dựng mô hình. */
  DATASET_NOT_LOADED: 'DatasetNotLoaded',
  /** Quan hệ này tạo thành đường nối thứ hai giữa hai bảng — Cube không chọn được. */
  RELATIONSHIP_CYCLE: 'RelationshipCycle',
  /** Nối một bảng với chính nó; bộ sinh schema không đặt được bí danh cube. */
  RELATIONSHIP_SELF: 'RelationshipSelf',
  /** Quan hệ y hệt đã tồn tại. */
  RELATIONSHIP_DUPLICATE: 'RelationshipDuplicate',
  /** Trường được hỏi không còn trong mô hình — mô hình đã đổi sau khi mở trang. */
  FIELD_UNKNOWN: 'DataModelFieldUnknown',
  /** Không gọi được Cube.js. Thường là chưa chạy `npm run infra:up:bi`. */
  CUBE_UNAVAILABLE: 'CubeUnavailable',
  /** Cube từ chối biên dịch mô hình — hay gặp nhất là quan hệ nối vòng. */
  SCHEMA_INVALID: 'DataModelSchemaInvalid',
  /** Không ghi được file cube schema. Sai `CUBE_SCHEMA_DIR` hoặc thiếu quyền ghi. */
  SCHEMA_UNWRITABLE: 'DataModelSchemaUnwritable',
  /** Thước đo đang là một vế của thước đo tính toán khác — xoá sẽ làm gãy công thức. */
  MEASURE_IN_USE: 'MeasureInUse',
  /** Hai vế của công thức thuộc hai bảng khác nhau; ghép chéo bảng cho ra tỉ lệ sai. */
  MEASURE_CROSS_DATASET: 'MeasureCrossDataset',
} as const;

export type DataModelErrorCode =
  (typeof DATAMODEL_ERROR_CODES)[keyof typeof DATAMODEL_ERROR_CODES];
