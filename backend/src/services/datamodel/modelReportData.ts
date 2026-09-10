import { MAX_GROUP_PAGE, type ReportDataDto, type ReportModelConfigDto } from '@bi/shared';

import { mysqlPool } from '../../config/mysql';
import * as datamodelsRepo from '../../repositories/datamodels';
import { runExplorerQuery } from './explorer';

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
 * Biểu đồ cắt ở `limit` nhóm. Nhưng "cắt rồi" và "vừa đủ" trông y hệt nhau trên
 * màn hình, nên người xem không phân biệt được "5 vùng" với "5 vùng lớn nhất
 * trong 13". Hỏi `limit + 1` rồi bỏ dòng cuối là cách rẻ nhất biết được điều
 * đó — không tốn thêm một vòng tới Cube như cách đếm nhóm riêng.
 */

const OTHER_LABEL = 'Khác';
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
 * Trang đang xem, kẹp vào khoảng hợp lệ — và về 0 khi cấu hình không chia trang.
 *
 * Kẹp chứ không từ chối: số trang đến từ một cú bấm nút, và người dùng bấm quá
 * nhanh vào ‹ ở trang đầu không đáng nhận một màn hình lỗi. Về 0 khi
 * `overflow !== 'pages'` là thứ bảo đảm một `?page=3` gõ tay vào thanh địa chỉ
 * không lặng lẽ làm biến mất cột "Khác" của một báo cáo không hề chia trang.
 */
function pageOf(config: ReportModelConfigDto, page: number): number {
  if (config.overflow !== 'pages') return 0;
  return Math.max(0, Math.min(MAX_GROUP_PAGE, Math.trunc(page)));
}

export async function aggregateFromModel(
  tenantId: number,
  userId: number,
  dataModelId: number,
  config: ReportModelConfigDto,
  /** Trang nhóm đang xem — xem `pageOf`. Bỏ qua khi cấu hình không chia trang. */
  pageIn = 0,
): Promise<ReportDataDto> {
  const limit = Math.min(MAX_GROUPS, Math.max(1, config.limit));
  const paged = config.overflow === 'pages';
  const page = pageOf(config, pageIn);

  const seriesId = config.seriesDimensionId ?? null;
  if (seriesId !== null && seriesId !== config.dimensionId) {
    return aggregateWithSeries(tenantId, userId, dataModelId, config, seriesId, limit, page);
  }

  /*
   * `pick` chọn nhóm NÀO; `options.sort` chọn thứ tự chúng nằm trên trục.
   *
   * Hai việc tách hẳn nhau, và đó là điều kiện để cả hai cùng nói thật. Cắt
   * top-N là phép của TRUY VẤN — sắp lại một tập đã cắt thì mãi mãi vẫn là các
   * nhóm lớn nhất, chỉ xếp ngược. Nên "nhỏ nhất" phải hỏi Cube bằng `asc`.
   */
  const bottom = config.pick === 'bottom';

  const result = await runExplorerQuery(
    tenantId,
    userId,
    dataModelId,
    { dimensionIds: [config.dimensionId], measureIds: [config.measureId], limit: limit + 1 },
    // `offset` chỉ khác 0 khi cấu hình chia trang — `pageOf` đã lo điều đó.
    { ...(bottom ? { order: 'asc' as const } : {}), ...(page > 0 ? { offset: page * limit } : {}) },
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

  /*
   * Chia trang thì KHÔNG có "Khác", và `grouped` phải là `false`.
   *
   * Hai thứ này đi liền nhau vì chúng nói cùng một điều: có nhóm nào bị GIẤU
   * không. Chia trang thì không — mọi nhóm đều mở ra được bằng hai cái nút. Để
   * `grouped` bật là để trang xem in ra "chỉ hiện các nhóm lớn nhất" ngay dưới
   * một biểu đồ có nút xem tiếp, tức nói sai ở đúng chỗ dễ tin nhất.
   */
  const grouped = !paged && hasMore;

  if (grouped) {
    /*
     * Chỉ gộp "Khác" khi phép tính CỘNG ĐƯỢC — nguyên văn luật của
     * `aggregateWarehouse`. Trung bình của các trung bình không phải trung
     * bình, và "Khác" của min/max thì vô nghĩa.
     *
     * Thước đo TÍNH TOÁN (§10.6) luôn rơi vào nhánh không cộng được, kể cả khi
     * hai vế của nó đều là tổng: tổng của các tỉ lệ không phải một tỉ lệ.
     */
    const measures = await datamodelsRepo.listMeasures(mysqlPool, tenantId, dataModelId);
    const measure = measures.find((m) => m.id === config.measureId);
    const additive =
      measure !== undefined &&
      measure.kind === 'column' &&
      (measure.agg === 'sum' || measure.agg === 'count');

    if (additive) {
      // Tổng của TOÀN BỘ, không phải tổng phần đang hiện. Một truy vấn nữa là
      // giá phải trả; đọc cả danh sách nhóm về Node để tự cộng thì một chiều có
      // một triệu giá trị phân biệt sẽ kéo một triệu dòng qua mạng.
      const total = await runExplorerQuery(tenantId, userId, dataModelId, {
        dimensionIds: [],
        measureIds: [config.measureId],
        limit: 1,
      });

      const grand = Number(total.rows[0]?.[0] ?? 0);
      const shown = rows.reduce((acc, r) => acc + r.value, 0);
      rows.push({ label: OTHER_LABEL, value: round(grand - shown) });
    }
  }

  return {
    rows,
    dimensionLabel: dimensionCol?.label ?? '',
    // Nhãn là TÊN thước đo, không phải "Tổng <cột>" như nhánh bộ dữ liệu: ở đây
    // phép gộp đã nằm trong định nghĩa của thước đo, và người dùng đặt tên cho
    // nó rồi. Ghép thêm "Tổng" vào trước sẽ ra "Tổng Biên lợi nhuận".
    measureLabel: measureCol?.label ?? '',
    grouped,
    ...(paged ? { paging: { page, hasMore } } : {}),
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
 * ═══ Vì sao KHÔNG có dòng "Khác" ════════════════════════════════════════════
 *
 * Nhánh một chiều cộng phần bị cắt thành một cột "Khác". Ở đây phần bị cắt là
 * một MẶT PHẲNG nhóm × chuỗi, và chia nó cho từng chuỗi thì phải bịa ra tỉ lệ.
 * Cột "Khác" của mọi chuỗi chồng lên nhau sẽ trông như một nhóm thật, mang một
 * cơ cấu màu hoàn toàn do ta nghĩ ra. Thà thiếu còn hơn bịa; `grouped` nói ra
 * là đã cắt.
 */
async function aggregateWithSeries(
  tenantId: number,
  userId: number,
  dataModelId: number,
  config: ReportModelConfigDto,
  seriesId: number,
  limit: number,
  /** Trang nhóm — đã kẹp bởi `pageOf`, nên `0` khi cấu hình không chia trang. */
  page: number,
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
  const paged = config.overflow === 'pages';

  const [ranking, seriesRanking] = await Promise.all([
    runExplorerQuery(
      tenantId,
      userId,
      dataModelId,
      { dimensionIds: [config.dimensionId], measureIds: [config.measureId], limit: limit + 1 },
      // Chia trang đi theo chiều CHÍNH. Chuỗi không chia trang: trần chuỗi tồn
      // tại để mắt còn phân biệt được màu, và "xem tiếp mười hai màu nữa" không
      // phải một câu hỏi ai đó hỏi.
      {
        ...(bottom ? { order: 'asc' as const } : {}),
        ...(page > 0 ? { offset: page * limit } : {}),
      },
    ),
    runExplorerQuery(tenantId, userId, dataModelId, {
      dimensionIds: [seriesId],
      measureIds: [config.measureId],
      limit: SERIES_CAP + 1,
    }),
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
      limit: rowCap + 1,
    },
    {
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
    // Chia trang thì chiều chính không còn bị cắt — nhưng CHUỖI thì vẫn, và đó
    // là một câu cắt hoàn toàn khác mà hai cái nút ‹ › không chữa được.
    grouped: (!paged && cutGroups) || cutSeries,
    ...(paged ? { paging: { page, hasMore: cutGroups } } : {}),
    format: measureCol?.format,
  };
}

/** Cube trả về chuỗi, số, hoặc null cho một chiều. Biểu đồ chỉ nhận chuỗi. */
function labelOf(cell: string | number | null): string {
  if (cell === null) return EMPTY_LABEL;
  const text = String(cell).trim();
  return text === '' ? EMPTY_LABEL : text;
}

/** Cùng thang làm tròn với `aggregateWarehouse` — cắt rác dấu phẩy động. */
function round(n: number): number {
  return Math.round(n * 10 ** 4) / 10 ** 4;
}
