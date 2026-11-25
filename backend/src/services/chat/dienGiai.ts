import {
  FILTER_OPERATOR_LABELS,
  type ExplorerQueryDto,
  type ExplorerResultDto,
  type MeasureFormat,
  type TimeGranularity,
} from '@bi/shared';

function docSo(value: number, format: MeasureFormat | undefined): string {
  if (format === 'percent') {
    return `${(value * 100).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} %`;
  }

  /*
   * Số LỚN thì phần thập phân là nhiễu, không phải độ chính xác.
   *
   * ĐO ĐƯỢC 24/11/2026: "trung bình mỗi đơn bao nhiêu tiền" in ra
   *
   *     Thành tiền (Trung bình) 396.317,647
   *
   * `toLocaleString('vi-VN')` mặc định giữ tới ba chữ số thập phân, và phép
   * `avg` trên một cột tiền nguyên thì gần như luôn sinh ra chúng. Ba chữ số
   * cuối ấy không nói gì về tiền — đọc lên trước hội đồng thì chúng chỉ làm
   * người nghe phải dò lại dấu phân cách để chắc mình không nghe nhầm bậc.
   *
   * Cận ở 1000 chứ không bỏ hẳn thập phân: một thước đo tỉ lệ hay một đơn giá
   * nhỏ ("0,75") thì phần thập phân LÀ con số, bỏ đi là làm tròn về 1.
   */
  return value.toLocaleString('vi-VN', {
    maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2,
  });
}

/**
 * Mốc thời gian Cube trả về, dạng ISO không múi giờ.
 *
 * `2026-10-26T00:00:00.000` — đúng, và không ai đọc. ĐO ĐƯỢC 24/11/2026: câu
 * "doanh thu theo ngày" in ra hai mươi sáu dòng toàn mốc dạng này, trong khi cả
 * phần còn lại của sản phẩm (trục biểu đồ, bảng dữ liệu, tài liệu kiểm thử) đọc
 * ngày theo kiểu Việt. Một con số đúng mà trình bày như log máy thì người nghe
 * vẫn phải dịch trong đầu, và ở buổi bảo vệ thì không ai có thời gian làm việc
 * đó.
 *
 * Chỉ nhận ĐÚNG khuôn này: một chuỗi chiều bất kỳ khác (tên chi nhánh, mã đơn)
 * không khớp nên không bị đụng tới.
 */
const MOC_ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):\d{2}(?:\.\d+)?Z?$/;

/**
 * Mốc của một Ô GOM NHÓM đọc theo ĐỘ GOM, không đọc như một ngày.
 *
 * ═══ Vì sao `01/10/2026` là một câu trả lời sai ════════════════════════════
 *
 * Cube trả về mốc ĐẦU của mỗi ô. ĐO ĐƯỢC 24/11/2026:
 *
 *     "doanh thu theo quý"  ->  "01/10/2026: Thành tiền 33.687.000."
 *     "doanh thu năm nay"   ->  "01/01/2026: Thành tiền 33.687.000."
 *     "theo tháng đi"       ->  "01/10/2026: Thành tiền 33.687.000."
 *
 * Người đọc hiểu "ngày 1 tháng 10 bán được 33,6 triệu" — trong khi con số đó là
 * của cả QUÝ. Không phải một lỗi trình bày: nó đổi hẳn nghĩa của con số, theo
 * hướng nhỏ hơn hàng chục lần, và không có gì trong câu để người ta phát hiện.
 *
 * Nhãn cột đã mang chữ "(Quý)" (xem `TIME_GRANULARITY_LABELS` ở `explorer.ts`),
 * nhưng nhãn nằm ở vế sau còn mốc nằm ở vế trước, nên vế trước vẫn phải tự nói
 * đúng nó là cái gì.
 */
function docMoc(value: string, muc?: TimeGranularity | undefined): string | null {
  const m = MOC_ISO.exec(value);
  if (m === null) return null;
  const [, nam, thang, ngay, gio, phut] = m;
  const ngayThang = `${String(ngay)}/${String(thang)}/${String(nam)}`;

  switch (muc) {
    case 'year':
      return `Năm ${String(nam)}`;
    case 'quarter':
      return `Quý ${String(Math.floor((Number(thang) - 1) / 3) + 1)}/${String(nam)}`;
    case 'month':
      return `Tháng ${String(Number(thang))}/${String(nam)}`;
    // Tuần thì mốc đầu LÀ thông tin (người ta tra lịch được), chỉ cần nói rõ
    // nó là mốc đầu chứ không phải một ngày đơn lẻ.
    case 'week':
      return `Tuần từ ${ngayThang}`;
    default:
      // Gom theo giờ/phút thì phần giờ mang tin; gom theo ngày trở lên thì nó
      // luôn là 00:00 và in ra chỉ làm dài dòng.
      return gio === '00' && phut === '00'
        ? ngayThang
        : `${ngayThang} ${String(gio)}:${String(phut)}`;
  }
}

function docO(
  value: string | number | null,
  format: MeasureFormat | undefined,
  muc?: TimeGranularity | undefined,
): string {
  if (value === null) return '(trống)';
  if (typeof value === 'number') return docSo(value, format);
  const moc = docMoc(value, muc);
  if (moc !== null) return moc;
  // Cube trả thước đo về dạng chuỗi số khá thường xuyên. Đọc lại thành số để
  // câu trả lời dùng cùng dấu phân cách với mọi chỗ khác trên màn hình.
  const n = Number(value);
  return value.trim() !== '' && !Number.isNaN(n) && format !== undefined ? docSo(n, format) : value;
}

function noi(ten: string[]): string {
  const cuoi = ten[ten.length - 1] ?? '';
  return ten.length < 2 ? cuoi : `${ten.slice(0, -1).join(', ')} và ${cuoi}`;
}

export function moTaTruyVan(truyVan: ExplorerQueryDto, nhanCua: Map<number, string>): string {
  const ten = (id: number): string => nhanCua.get(id) ?? `trường #${String(id)}`;

  const do_ = truyVan.measureIds.map(ten);
  const chieu = truyVan.dimensionIds.map(ten);

  const phan: string[] = [];
  if (do_.length > 0) phan.push(noi(do_));
  if (chieu.length > 0) phan.push(`theo ${noi(chieu)}`);
  if (truyVan.timeDimension !== undefined) {
    /*
     * KHÔNG in thêm tên độ gom: `explorer.ts` đã gắn nó vào nhãn cột ("Ngày bán
     * (Tháng)"), và `nhanCua` lấy nhãn từ chính kết quả. Bản trước in cả hai,
     * ra "theo Ngày bán (Tháng) (month)" — lặp một lần, và lần lặp đó bằng
     * tiếng Anh.
     */
    phan.push(`theo ${ten(truyVan.timeDimension.dimensionId)}`);
  }

  /*
   * Cặp `gte`/`lt` trên CÙNG một chiều đọc thành MỘT câu.
   *
   * Một mốc thời gian sinh ra đúng cặp đó (xem `khoangThoiGian.ts`), và để
   * nguyên hai dòng thì `hieuLa` nói "Ngày đặt từ … trở lên 2026-10-01, Ngày
   * đặt nhỏ hơn 2026-11-01" — đúng từng chữ mà không ai đọc nổi. Dòng này là
   * chỗ DUY NHẤT người dùng kiểm được "máy hiểu khoảng nào", nên nó phải đọc
   * được, nếu không nó chỉ còn là chữ cho có.
   *
   * "đến trước" chứ không phải "đến": mốc cuối HỞ, và nói "đến 2026-11-01"
   * là nói sai một ngày về phía rộng hơn.
   */
  const daGop = new Set<number>();
  const boLoc = truyVan.filters ?? [];

  boLoc.forEach((f, i) => {
    if (f.operator !== 'gte' || daGop.has(i)) return;
    const j = boLoc.findIndex(
      (g, k) => k !== i && !daGop.has(k) && g.dimensionId === f.dimensionId && g.operator === 'lt',
    );
    if (j < 0) return;
    daGop.add(i);
    daGop.add(j);
    phan.push(
      `lọc ${ten(f.dimensionId)} từ ${f.values.join(', ')} đến trước ${boLoc[j]?.values.join(', ') ?? ''}`,
    );
  });

  boLoc.forEach((f, i) => {
    if (daGop.has(i)) return;
    const dieu = FILTER_OPERATOR_LABELS[f.operator];
    phan.push(
      f.values.length === 0
        ? `lọc ${ten(f.dimensionId)} ${dieu}`
        : `lọc ${ten(f.dimensionId)} ${dieu} ${f.values.join(', ')}`,
    );
  });

  /*
   * `limit` PHẢI được nói ra. Nó quyết định tập dữ liệu nào được lấy về, nên
   * một "top 5" mà mô hình tự nghĩ ra từ câu hỏi là thứ người đọc cần thấy —
   * y hệt lý do mấy bộ lọc ở trên có mặt trong câu này.
   *
   * Phép gộp thì KHÔNG cần dòng riêng: `buildQuery` đã gắn tên phép vào nhãn
   * cột khi phép bị đổi ("Doanh thu (Trung bình)"), và `nhanCua` lấy nhãn từ
   * chính kết quả, nên nó đã nằm sẵn trong `ten(...)` ở trên.
   */
  if (truyVan.limit !== undefined) phan.push(`lấy ${String(truyVan.limit)} dòng đầu`);

  return phan.join(', ');
}

/**
 * Bao nhiêu dòng được ĐỌC RA THÀNH LỜI trong một câu trả lời.
 *
 * ═══ Vì sao 15 là quá nhiều, và vì sao nó không chỉ là chuyện đọc ═════════
 *
 * ĐO ĐƯỢC 24/11/2026, câu "doanh thu theo ngày" trên 26 ngày dữ liệu cho ra một
 * câu dài ~900 ký tự, mười lăm mốc ngày nối nhau bằng dấu chấm phẩy, trong một
 * bong bóng chat rộng chừng ba trăm pixel. Không ai đọc nó; người ta chỉ thấy
 * một khối chữ.
 *
 * Nhưng cái giá thật nằm ở lớp sau. `so` mang theo MỘT con số cho mỗi dòng, và
 * `dienDat` phải gửi cả câu đó cho mô hình rồi đối chiếu `giuNguyenSo` trên
 * từng con số một. Mười sáu con số trong một lời nhắc 900 ký tự nghĩa là: tốn
 * token nhiều nhất trong mọi câu trả lời, VÀ xác suất mô hình làm xê dịch một
 * dấu phân cách — tức cả bản viết lại bị bỏ — cao nhất. Tiền trả ra để gần như
 * chắc chắn không dùng được gì.
 *
 * Sáu dòng đủ để thấy hình dáng của dữ liệu (cao nhất, thấp nhất, và khoảng
 * giữa), và phần còn lại vẫn được NÓI RA bằng "… và N dòng nữa" nên người đọc
 * không bị che mất điều gì.
 */
const TRAN_DONG = 6;

export interface TraLoiTruyVan {
  cau: string;
  so: string[];
  hieuLa: string;
}

export const KHONG_CO_DONG = 'Không có dòng nào thoả điều kiện này.';

/**
 * Truy vấn này KHÔNG trả về số liệu nào — và "không dòng nào" là hai hình dạng
 * khác nhau, không phải một.
 *
 * ═══ Hình dạng thứ hai là hình dạng thường gặp ═════════════════════════════
 *
 * `rows.length === 0` chỉ xảy ra khi truy vấn CÓ nhóm theo chiều. Câu hỏi hay
 * gặp nhất thì không nhóm gì cả — "doanh thu của sản phẩm Bánh" chỉ có một
 * thước đo và một bộ lọc — và khi bộ lọc không khớp dòng nào, ClickHouse vẫn
 * trả ĐÚNG MỘT DÒNG với `sum(...) = NULL`. Nên nhánh "không có dòng nào" không
 * bao giờ chạy, và `docO` in ra placeholder của nó:
 *
 *     "Thành tiền (trống)."
 *
 * ĐO ĐƯỢC 24/11/2026: đó là câu trả lời của 7 trong 42 câu hỏi thử — nhiều thứ
 * hai sau các câu đúng. Nó không sai về số, nhưng nó không nói cho người đọc
 * biết CHUYỆN GÌ đã xảy ra, trong khi chuyện đã xảy ra gần như luôn là một
 * chuyện sửa được: giá trị lọc viết khác với trong dữ liệu ("Bánh" là một Nhóm
 * hàng, còn cột Sản phẩm thì ghi "Bánh bông lan").
 *
 * Để ở đây, `export`, vì `hoiTrenMoHinh` cần ĐÚNG luật này để biết có nên đi
 * tra danh sách giá trị thật hay không. Hai bản sao của một luật là hai bản sẽ
 * lệch nhau.
 *
 * ⚠️ CA BIÊN đã biết, và đánh đổi là có chủ ý: một cột mà MỌI ô đều rỗng thì
 * `sum` của nó cũng ra NULL dù có 85 dòng khớp điều kiện, nên câu trả lời sẽ
 * nói "không có dòng nào" trong khi đúng ra là "có dòng, nhưng cột này trống
 * hết". Phân biệt được hai ca đó cần gửi kèm một thước đo đếm dòng vào MỌI truy
 * vấn — một cái giá trả ở mọi câu hỏi để nói đúng một ca gần như không xảy ra
 * (một cột rỗng toàn bộ thì nó cũng chẳng được khai làm thước đo). Câu "Thành
 * tiền (trống)" của bản trước thì SAI ở cả hai ca.
 */
export function khongCoDong(kq: ExplorerResultDto): boolean {
  if (kq.rows.length === 0) return true;

  const chiSoDo = kq.columns.flatMap((c, i) => (c.kind === 'measure' ? [i] : []));
  const coChieu = kq.columns.some((c) => c.kind === 'dimension');
  if (coChieu || chiSoDo.length === 0 || kq.rows.length > 1) return false;

  const dong = kq.rows[0] ?? [];
  return chiSoDo.every((i) => (dong[i] ?? null) === null);
}

export function docKetQua(
  kq: ExplorerResultDto,
  truyVan: ExplorerQueryDto,
  nhanCua: Map<number, string>,
  huong?: 'asc' | 'desc',
): TraLoiTruyVan {
  /*
   * Cảnh báo "chưa phải toàn bộ" CHỈ đúng khi trần số dòng là trần của HỆ
   * THỐNG, không phải con số người dùng tự xin.
   *
   * `truyVan.limit` được điền khi câu hỏi nói "cao nhất" hoặc "top N" — và khi
   * đó `runExplorerQuery` bật `truncated` vì nó đúng là đã cắt bớt dòng. Đo
   * ngày 24/11/2026: mọi câu hỏi hạng nhất đều kéo theo cái đuôi này —
   *
   *     Bánh: Thành tiền 12.635.000. — truy vấn đã chạm trần số dòng nên đây
   *     chưa phải toàn bộ
   *
   * Người dùng xin đúng MỘT dòng, nhận đúng một dòng, rồi bị nói rằng đây chưa
   * phải toàn bộ. Câu cảnh báo đúng về mặt kỹ thuật nhưng trả lời cho một câu
   * hỏi không ai đặt ra, và nó làm người đọc nghi ngờ đúng con số đang đúng.
   *
   * Giữ cảnh báo cho đường còn lại — ở đó trần do hệ thống áp và người dùng
   * KHÔNG biết, nên không nói ra mới là che.
   */
  const cat =
    kq.truncated && truyVan.limit === undefined
      ? ` — truy vấn đã chạm trần số dòng nên đây chưa phải toàn bộ`
      : '';

  /*
   * Thứ tự chỉ đáng nói khi có NHIỀU dòng để mà xếp.
   *
   * Một con số duy nhất thì "xếp từ cao xuống" là chữ thừa, và chữ thừa trong
   * `hieuLa` làm loãng đúng cái dòng mà người đọc phải soi.
   */
  const noiThuTu =
    huong !== undefined && kq.columns.some((c) => c.kind === 'dimension') && kq.rows.length > 1;
  const hieuLa =
    moTaTruyVan(truyVan, nhanCua) +
    (noiThuTu ? `, xếp ${huong === 'asc' ? 'từ thấp lên' : 'từ cao xuống'}` : '');

  if (khongCoDong(kq)) {
    return { cau: KHONG_CO_DONG, so: [], hieuLa };
  }

  const dinhDang = kq.columns.map((c) => c.format);
  const nhan = kq.columns.map((c) => c.label);
  const chiSoDo = kq.columns.flatMap((c, i) => (c.kind === 'measure' ? [i] : []));
  const chiSoChieu = kq.columns.flatMap((c, i) => (c.kind === 'dimension' ? [i] : []));

  /*
   * Cột nào là cột THỜI GIAN, và nó gom theo độ nào — xem `docMoc`.
   *
   * Tra theo `columns[i].id` chứ không theo vị trí: `buildQuery` đặt cột thời
   * gian ở đâu trong danh sách là việc của nó, và một giả định về vị trí sẽ gán
   * nhãn "Quý 4/2026" cho tên chi nhánh vào ngày thứ tự đó đổi.
   */
  const mucThoiGian =
    truyVan.timeDimension === undefined
      ? null
      : {
          id: truyVan.timeDimension.dimensionId,
          muc: truyVan.timeDimension.granularity,
        };
  const mucCuaCot = (i: number): TimeGranularity | undefined =>
    mucThoiGian !== null && kq.columns[i]?.id === mucThoiGian.id ? mucThoiGian.muc : undefined;

  const docDong = (dong: (string | number | null)[]): { chu: string; so: string[] } => {
    const tenDong = chiSoChieu
      .map((i) => docO(dong[i] ?? null, undefined, mucCuaCot(i)))
      .join(' · ');
    const soDong = chiSoDo.map((i) => docO(dong[i] ?? null, dinhDang[i]));
    const veDo = chiSoDo.map((i, k) => `${nhan[i] ?? ''} ${soDong[k] ?? ''}`).join(', ');

    /*
     * Thiếu MỘT trong hai nửa thì KHÔNG có dấu hai chấm.
     *
     * ĐO ĐƯỢC 24/11/2026: "liệt kê các chi nhánh" — một truy vấn chỉ có chiều,
     * không thước đo, và hoàn toàn hợp lệ — in ra
     *
     *     4 Chi nhánh: Gò Vấp: ; Quận 1: ; Quận 7: ; Thủ Đức: .
     *
     * Dấu hai chấm ở đây để nối tên dòng với phần đo của nó. Không có phần đo
     * thì nó nối vào khoảng trắng, và câu đọc như một chỗ hỏng — người xem thấy
     * một dấu hai chấm cụt là nghĩ con số bị mất, không nghĩ là mình chưa xin.
     *
     * Nhánh `tenDong === ''` thì đã đúng từ trước; gộp cả hai vào một chốt vì
     * chúng là cùng một luật.
     */
    if (tenDong === '' || veDo === '') return { chu: tenDong + veDo, so: soDong };
    return { chu: `${tenDong}: ${veDo}`, so: soDong };
  };

  // Không chiều nào: đúng một dòng, đúng một con số — không có gì để liệt kê.
  if (chiSoChieu.length === 0) {
    const d = docDong(kq.rows[0] ?? []);
    return { cau: `${d.chu}.${cat}`, so: d.so, hieuLa };
  }

  const hien = kq.rows.slice(0, TRAN_DONG).map(docDong);
  const con = kq.rows.length - hien.length;

  if (hien.length === 1) {
    const d = hien[0];
    return { cau: `${d?.chu ?? ''}.${cat}`, so: d?.so ?? [], hieuLa };
  }

  return {
    cau:
      `${String(kq.rows.length)} ${noi(chiSoChieu.map((i) => nhan[i] ?? ''))}: ` +
      `${hien.map((d) => d.chu).join('; ')}` +
      `${con > 0 ? `; … và ${String(con)} dòng nữa` : ''}.${cat}`,
    /*
     * Số dòng đứng ĐẦU danh sách `so`: nó là con số mà câu mở đầu bằng, nên lớp
     * viết lại không được phép làm tròn nó. Mấy con số của từng dòng theo sau.
     */
    so: [String(kq.rows.length), ...hien.flatMap((d) => d.so)],
    hieuLa,
  };
}
