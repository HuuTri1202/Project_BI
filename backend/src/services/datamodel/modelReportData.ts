import {
  MAX_GROUP_PAGE,
  type MeasureAgg,
  type ReportDataDto,
  type ReportModelConfigDto,
} from '@bi/shared';

import { loadModelContext, runExplorerQuery, type ModelContext } from './explorer';

/**
 * Số liệu cho một báo cáo dựng trên MÔ HÌNH — §10.8.
 *
 * ═══ Vì sao đi qua `runExplorerQuery` chứ không tự gọi Cube ══════════════════
 *
 * Explorer và báo cáo hỏi cùng một câu: "gộp thước đo này theo chiều kia". Cho
 * mỗi bên tự dựng truy vấn nghĩa là hai đường tới cùng một con số, và chúng sẽ
 * lệch nhau — thường là ở những chỗ khó thấy nhất, như thứ tự sắp xếp hay cách
 * hạ kiểu của một ô NULL. Khi đó biểu đồ và bảng Explorer nói hai điều khác
 * nhau về cùng một dữ liệu, và không ai biết bên nào đúng.
 *
 * Đi chung còn thừa hưởng miễn phí: token Cube ngắn hạn, việc tra ID trong
 * phạm vi đã lọc theo tổ chức, và `FIELD_UNKNOWN` khi ai đó xoá mất thước đo mà
 * báo cáo đang dùng.
 *
 * ═══ Vì sao hỏi thừa MỘT dòng ═══════════════════════════════════════════════
 *
 * Một trang có `limit` nhóm. Nhưng "hết rồi" và "còn nữa" trông y hệt nhau trên
 * màn hình, nên nút › phải biết được điều đó trước khi người dùng bấm vào nó.
 * Hỏi `limit + 1` rồi bỏ dòng cuối là cách rẻ nhất: không tốn thêm một vòng tới
 * Cube như cách đếm nhóm riêng, và cũng chính là thứ cho biết trang này có phải
 * trang cuối hay không.
 */

const EMPTY_LABEL = '(trống)';

/** Trần cứng, kể cả khi cấu hình cũ lưu một số lớn hơn. */
const MAX_GROUPS = 100;

/**
 * Số CHUỖI tối đa trên một biểu đồ nhiều chuỗi (§10.9).
 *
 * Trần này là về việc ĐỌC ĐƯỢC, không phải về hiệu năng: mười hai màu đã là
 * ngưỡng mà mắt còn phân biệt được trong một chú giải, và một cột chồng hai
 * mươi lớp thì không ai đọc ra lớp nào là lớp nào.
 *
 * Nó cũng là thứ làm cho số dòng trở nên ĐOÁN ĐƯỢC: `limit × SERIES_CAP` là
 * trần cứng của số tổ hợp, nên truy vấn cuối xin đúng chừng ấy và nhận về đủ.
 */
const SERIES_CAP = 12;

/**
 * Trang đang xem, kẹp vào khoảng hợp lệ.
 *
 * Kẹp chứ không từ chối: số trang đến từ một cú bấm nút, và người dùng bấm quá
 * nhanh vào ‹ ở trang đầu không đáng nhận một màn hình lỗi. Cùng lý do với
 * `MAX_GROUP_PAGE` ở đầu kia — `?page=99999` gõ tay vào thanh địa chỉ là một
 * `OFFSET` khổng lồ gửi thẳng xuống ClickHouse.
 */
function pageOf(page: number): number {
  return Math.max(0, Math.min(MAX_GROUP_PAGE, Math.trunc(page)));
}

/*
 * ═══ Phần vượt trần: mọi biểu đồ đều CHIA TRANG — §10.15 ════════════════════
 *
 * §10.12 thêm một ô chọn: gộp phần vượt thành cột "Khác", hay chia trang.
 * §10.14 bỏ vế thứ ba (bỏ hẳn dữ liệu) khỏi ô đó. §10.15 bỏ nốt cái ô.
 *
 *     "Bỏ cột khi còn nhóm chưa hiện và giữ lại nhóm nào đi vì mặc định sẽ tạo
 *      ra nhiều biểu đồ báo cáo và người dùng sẽ bấm sang trang từ từ để xem nó"
 *
 * Cùng với ô chọn, ba thứ biến mất khỏi file này: truy vấn tổng-toàn-bộ chỉ
 * dùng để tính cột "Khác", phép hỏi `laCongDuoc` để biết có được gộp không, và
 * cờ `grouped` của nhánh một chiều — chia trang thì không nhóm nào bị giấu, nên
 * không còn gì để cảnh báo. Cái mất đi cùng chúng là câu "phần còn lại lớn cỡ
 * nào"; cái được là câu "trong đó có gì", và một truy vấn ít hơn cho mỗi ô.
 */

/**
 * Phép gộp mà biểu đồ này CHỌN LẠI, ở đúng hình dạng `runExplorerQuery` nhận.
 *
 * Vắng mặt -> `undefined`, và khi đó `buildQuery` hỏi Cube đúng measure mặc định
 * của mô hình. Nhờ vậy mọi báo cáo lưu trước §10.22 không đổi một truy vấn nào.
 *
 * ⚠️ Phải truyền vào CẢ BỐN lời gọi của một biểu đồ có nhóm màu (xếp hạng nhóm,
 * xếp hạng chuỗi, và truy vấn cuối). Bỏ sót một chỗ thì bảng xếp hạng được tính
 * bằng Tổng còn cột vẽ ra là Trung bình — các nhóm hiện lên đúng số nhưng SAI
 * danh sách, và không có gì trên màn hình tố giác chuyện đó.
 */
function aggCua(config: ReportModelConfigDto): { id: number; agg: MeasureAgg }[] | undefined {
  const agg = config.measureAgg;
  return agg === undefined || agg === null ? undefined : [{ id: config.measureId, agg }];
}

export async function aggregateFromModel(
  tenantId: number,
  userId: number,
  dataModelId: number,
  config: ReportModelConfigDto,
  /** Trang nhóm đang xem — xem `pageOf`. Bỏ qua khi biểu đồ không chia trang. */
  pageIn = 0,
  /**
   * Chỉ mục mô hình đã nạp sẵn — §10.14.
   *
   * Một khung 12 ô truyền CÙNG một ngữ cảnh cho cả 12 lần gọi. Vắng mặt thì hàm
   * tự nạp, nên mọi đường gọi lẻ không phải đổi gì.
   */
  ctxIn?: ModelContext,
): Promise<ReportDataDto> {
  const ctx = ctxIn ?? (await loadModelContext(tenantId, dataModelId));
  const limit = Math.min(MAX_GROUPS, Math.max(1, config.limit));

  const seriesId = config.seriesDimensionId ?? null;
  const hasSeries = seriesId !== null && seriesId !== config.dimensionId;

  const page = pageOf(pageIn);

  if (hasSeries) {
    return aggregateWithSeries(tenantId, userId, dataModelId, config, seriesId, limit, page, ctx);
  }

  /*
   * `pick` chọn đọc bảng xếp hạng từ ĐẦU nào.
   *
   * Cắt top-N là phép của TRUY VẤN — sắp lại một tập đã cắt thì mãi mãi vẫn là
   * các nhóm lớn nhất, chỉ xếp ngược. Nên "nhỏ nhất" phải hỏi Cube bằng `asc`,
   * và đó cũng là lý do trình dựng phải suy trường này ra rồi LƯU nó vào
   * `config` thay vì để backend đọc `options.sort` (§10.15).
   */
  const bottom = config.pick === 'bottom';

  const result = await runExplorerQuery(
    tenantId,
    userId,
    dataModelId,
    {
      dimensionIds: [config.dimensionId],
      measureIds: [config.measureId],
      measureAggs: aggCua(config),
      limit: limit + 1,
    },
    // `offset` chỉ có mặt từ trang 2 trở đi: `offset: 0` là đúng câu hỏi cũ
    // viết dài hơn, và mọi thứ đi vào truy vấn Cube đều đáng để ngắn.
    {
      ctx,
      ...(bottom ? { order: 'asc' as const } : {}),
      ...(page > 0 ? { offset: page * limit } : {}),
    },
  );

  // `buildQuery` đẩy chiều trước, thước đo sau, và luôn đúng hai cột vì ta gửi
  // đúng một ID mỗi loại.
  const [dimensionCol, measureCol] = result.columns;

  /*
   * ĐẢO LẠI để câu trả lời luôn giảm dần, bất kể lấy đầu bảng hay cuối bảng.
   *
   * Không đảo thì `options.sort = 'value'` — nhãn của nó là "lớn → nhỏ" — sẽ
   * vẽ ra một biểu đồ tăng dần, và ô sắp xếp nói dối mà không ai sửa được. Đảo
   * ở ĐÂY, trước khi cắt dòng thừa, vì `limit + 1` dòng đang xếp tăng dần thì
   * dòng thừa nằm ở CUỐI — đảo sau khi cắt sẽ bỏ mất nhóm nhỏ nhất và giữ lại
   * đúng cái dòng chỉ dùng để đếm.
   */
  const ranked = bottom ? [...result.rows].reverse() : result.rows;

  const all = ranked.map((row) => ({
    // Ô trống là thứ người xem CẦN thấy, không phải thứ nên giấu — cùng lập
    // luận với `aggregateWarehouse`.
    label: labelOf(row[0] ?? null),
    value: Number(row[1] ?? 0),
  }));

  // Dòng thừa thứ `limit + 1` chỉ dùng để BIẾT còn dữ liệu, không bao giờ được vẽ.
  const hasMore = all.length > limit;
  // Đã đảo ở trên nên phần cần bỏ luôn nằm ở ĐẦU khi lấy nhóm nhỏ nhất.
  const rows = bottom ? all.slice(Math.max(0, all.length - limit)) : all.slice(0, limit);

  return {
    rows,
    dimensionLabel: dimensionCol?.label ?? '',
    // Nhãn là TÊN thước đo, không phải "Tổng <cột>" như nhánh bộ dữ liệu: ở đây
    // phép gộp đã nằm trong định nghĩa của thước đo, và người dùng đặt tên cho
    // nó rồi. Ghép thêm "Tổng" vào trước sẽ ra "Tổng Biên lợi nhuận".
    measureLabel: measureCol?.label ?? '',
    /*
     * LUÔN `false` ở nhánh này — xem khối §10.15 đầu file.
     *
     * `grouped` nghĩa là "có nhóm bị GIẤU khỏi biểu đồ". Chia trang thì không:
     * mọi nhóm đều mở ra được bằng hai cái nút. Để nó bật là in ra "chỉ hiện
     * các nhóm lớn nhất" ngay bên dưới một biểu đồ có nút xem tiếp, tức nói sai
     * ở đúng chỗ dễ tin nhất.
     */
    grouped: false,
    paging: { page, hasMore },
    format: measureCol?.format,
  };
}

/**
 * Cùng câu hỏi, thêm một chiều tách chuỗi — §10.9.
 *
 * ═══ Vì sao BA truy vấn, không phải một ═════════════════════════════════════
 *
 * Một truy vấn hai chiều với `limit = 20` trả về 20 TỔ HỢP lớn nhất, không phải
 * 20 nhóm. Với dữ liệu thật thì cả 20 tổ hợp ấy thường rơi vào ba bốn nhóm đầu,
 * nên biểu đồ hiện ra bốn cột thay vì hai mươi — và không có gì trên màn hình
 * nói rằng mười sáu nhóm còn lại vẫn tồn tại.
 *
 * Nên hai truy vấn đầu XẾP HẠNG từng chiều một cách độc lập (chạy song song,
 * tốn một vòng chờ), rồi truy vấn thứ ba mới đi lấy phần chia nhỏ — bó vào đúng
 * những giá trị hai truy vấn kia đã chọn. Nhờ vậy số tổ hợp bị chặn cứng và cả
 * hai chiều đều hiện ra đủ. Xem ghi chú tại chỗ để biết mỗi bộ lọc chữa triệu
 * chứng nào, cả hai đều đo được trên dữ liệu thật.
 *
 * Ba vòng tới Cube nghe nhiều, nhưng hai vòng đầu quét trên MỘT chiều và cắt ở
 * vài chục dòng — chúng rẻ hơn hẳn vòng cuối, vốn cũng là vòng duy nhất tồn tại
 * ở nhánh một chuỗi.
 *
 * ═══ Hai trần, và chỉ MỘT trong hai chia trang được ═════════════════════════
 *
 * Trần NHÓM đi theo trang, y như nhánh một chiều. Trần CHUỖI thì không: nó tồn
 * tại để mắt còn phân biệt được màu (12 là ngưỡng), và "xem tiếp mười hai màu
 * nữa" không phải câu hỏi ai đó hỏi — hai cái nút ‹ › lật nhóm, không lật màu.
 * Nên `grouped` ở nhánh này nói đúng một điều: CHUỖI đã bị cắt.
 */
async function aggregateWithSeries(
  tenantId: number,
  userId: number,
  dataModelId: number,
  config: ReportModelConfigDto,
  seriesId: number,
  limit: number,
  /** Trang nhóm — đã kẹp bởi `pageOf`, nên `0` khi biểu đồ không chia trang. */
  page: number,
  /** Ngữ cảnh mô hình dùng chung — xem `aggregateFromModel`. */
  ctx: ModelContext,
): Promise<ReportDataDto> {
  /*
   * Bước 1 — xếp hạng CẢ HAI chiều, song song.
   *
   * Hai truy vấn này không phụ thuộc nhau nên đi cùng lúc: chúng chỉ tốn một
   * vòng chờ chứ không phải hai. Cả hai xin thừa MỘT dòng, cùng mẹo với nhánh
   * một chuỗi — "cắt rồi" và "vừa đủ" trông y hệt nhau trên màn hình.
   *
   * Chuỗi được xếp hạng trên TOÀN BỘ dữ liệu chứ không trong phạm vi các nhóm
   * vừa chọn. Xếp trong phạm vi thì chính xác hơn, nhưng nó biến hai truy vấn
   * song song thành hai truy vấn nối tiếp — và khác biệt chỉ lộ ra khi một
   * chuỗi lớn toàn cục lại vắng mặt ở đúng các nhóm đầu bảng. Trình dựng chạy
   * lại truy vấn này sau MỖI lần thả một trường, nên độ trễ ở đây là thứ người
   * dùng cảm thấy liên tục.
   */
  /*
   * `pick` chỉ đụng truy vấn xếp hạng NHÓM, không đụng truy vấn xếp hạng CHUỖI.
   *
   * "Năm khu vực nhỏ nhất" là một câu hỏi; "năm khu vực nhỏ nhất, tách theo ba
   * dòng sản phẩm ÍT bán nhất" thì không ai hỏi. Trần chuỗi tồn tại để biểu đồ
   * còn đọc được (12 màu là ngưỡng của mắt), nên nó luôn giữ những chuỗi lớn
   * nhất — bỏ chuỗi lớn đi thì các cột còn lại cộng không ra tổng nào cả.
   */
  const bottom = config.pick === 'bottom';

  const [ranking, seriesRanking] = await Promise.all([
    runExplorerQuery(
      tenantId,
      userId,
      dataModelId,
      {
        dimensionIds: [config.dimensionId],
        measureIds: [config.measureId],
        measureAggs: aggCua(config),
        limit: limit + 1,
      },
      // Chia trang đi theo chiều CHÍNH. Chuỗi không chia trang: trần chuỗi tồn
      // tại để mắt còn phân biệt được màu, và "xem tiếp mười hai màu nữa" không
      // phải một câu hỏi ai đó hỏi.
      {
        ctx,
        ...(bottom ? { order: 'asc' as const } : {}),
        ...(page > 0 ? { offset: page * limit } : {}),
      },
    ),
    runExplorerQuery(
      tenantId,
      userId,
      dataModelId,
      {
        dimensionIds: [seriesId],
        measureIds: [config.measureId],
        measureAggs: aggCua(config),
        limit: SERIES_CAP + 1,
      },
      { ctx },
    ),
  ]);

  // Giữ cả giá trị THÔ lẫn nhãn hiển thị. Nhãn để sắp xếp và để vẽ; giá trị thô
  // để làm bộ lọc ở bước 2 — `labelOf` đã đổi `null` thành "(trống)", một chuỗi
  // không tồn tại trong dữ liệu.
  const doc = (rows: (string | number | null)[][], n: number) =>
    rows.slice(0, n).map((row) => {
      const raw = row[0] ?? null;
      return { raw, label: labelOf(raw) };
    });

  const cutGroups = ranking.rows.length > limit;
  const cutSeries = seriesRanking.rows.length > SERIES_CAP;

  // Cùng phép đảo với nhánh một chuỗi: truy vấn hỏi tăng dần để LẤY ĐÚNG các
  // nhóm nhỏ nhất, rồi đảo lại để thứ hạng — và biểu đồ — vẫn giảm dần.
  const rankedGroups = bottom ? [...ranking.rows].reverse() : ranking.rows;
  const keepGroups = bottom
    ? doc(rankedGroups.slice(Math.max(0, rankedGroups.length - limit)), limit)
    : doc(rankedGroups, limit);
  const keepSeries = doc(seriesRanking.rows, SERIES_CAP);

  // Thứ hạng để sắp lại ở bước 3. Nhóm trùng nhãn sau `labelOf` (ví dụ `null`
  // và chuỗi rỗng đều thành "(trống)") giữ thứ hạng của lần xuất hiện đầu.
  const rank = new Map<string, number>();
  keepGroups.forEach(({ label }, i) => {
    if (!rank.has(label)) rank.set(label, i);
  });

  /*
   * Bước 2 — chia nhỏ, BÓ vào đúng những giá trị vừa chọn ở cả hai chiều.
   *
   * Hai bộ lọc mới là thứ làm cả cách tiếp cận này có nghĩa, và mỗi cái chữa
   * một triệu chứng đã đo được trên dữ liệu thật:
   *
   *   thiếu bộ lọc NHÓM   xin 5 nhóm, nhận về 4 — một nhóm trong top-5 biến mất
   *                       vì không tổ hợp nào của nó lọt vào 100 tổ hợp lớn
   *                       nhất TOÀN CỤC. Người xem thấy một cột thiếu, và dòng
   *                       "đã cắt" bên dưới không nói được đó là cột nào.
   *
   *   thiếu bộ lọc CHUỖI  chiều thứ hai có hàng nghìn giá trị (mã khách hàng)
   *                       thì một nhóm duy nhất ăn hết trần dòng: xin 3 nhóm,
   *                       nhận về 1.
   *
   * Có cả hai thì số tổ hợp bị chặn cứng ở `limit × SERIES_CAP`, nên truy vấn
   * xin đúng chừng ấy và nhận về ĐỦ. Không nhóm nào biến mất, không chuỗi nào
   * chen ngang.
   */
  const rowCap = limit * SERIES_CAP;
  const breakdown = await runExplorerQuery(
    tenantId,
    userId,
    dataModelId,
    {
      dimensionIds: [config.dimensionId, seriesId],
      measureIds: [config.measureId],
      measureAggs: aggCua(config),
      limit: rowCap + 1,
    },
    {
      ctx,
      restrict: [
        { dimensionId: config.dimensionId, values: keepGroups.map((k) => k.raw) },
        { dimensionId: seriesId, values: keepSeries.map((k) => k.raw) },
      ],
    },
  );

  const [dimensionCol, seriesCol, measureCol] = breakdown.columns;

  const rows = breakdown.rows
    .slice(0, rowCap)
    .map((row) => ({
      label: labelOf(row[0] ?? null),
      series: labelOf(row[1] ?? null),
      value: Number(row[2] ?? 0),
    }))
    // Bộ lọc đã lo phần lớn, nhưng không lo được ca hai giá trị thô KHÁC nhau
    // cùng đổ về một nhãn (chuỗi rỗng và khoảng trắng). Giữ dòng này để mọi
    // dòng đi tiếp đều tra được thứ hạng ở bước sắp xếp ngay dưới.
    .filter((row) => rank.has(row.label))
    // Sắp lại theo thứ hạng NHÓM. Cube trả về theo thước đo giảm dần trên toàn
    // bộ tổ hợp, nên nhóm đứng đầu và nhóm thứ hai đan xen nhau; mà trình vẽ
    // dựng trục ngang theo thứ tự dòng xuất hiện (`sort: null`).
    .sort((a, b) => (rank.get(a.label) ?? 0) - (rank.get(b.label) ?? 0));

  return {
    rows,
    dimensionLabel: dimensionCol?.label ?? '',
    measureLabel: measureCol?.label ?? '',
    seriesLabel: seriesCol?.label ?? '',
    // Chiều chính không còn bị cắt — nhưng CHUỖI thì vẫn, và đó là một câu cắt
    // hoàn toàn khác mà hai cái nút ‹ › không chữa được.
    grouped: cutSeries,
    paging: { page, hasMore: cutGroups },
    format: measureCol?.format,
  };
}

/** Cube trả về chuỗi, số, hoặc null cho một chiều. Biểu đồ chỉ nhận chuỗi. */
function labelOf(cell: string | number | null): string {
  if (cell === null) return EMPTY_LABEL;
  const text = String(cell).trim();
  return text === '' ? EMPTY_LABEL : text;
}
