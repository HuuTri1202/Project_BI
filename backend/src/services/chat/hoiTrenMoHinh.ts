import {
  chieuSoSanh,
  type ExplorerQueryDto,
  type FilterOperator,
  type MeasureAgg,
} from '@bi/shared';

import { fieldsFromIndex, loadModelContext, runExplorerQuery } from '../datamodel/explorer';
import { chuanHoa, datCauHoi, LY_DO_NOI, type TruongChon } from './datCauHoi';
import { docKetQua, khongCoDong } from './dienGiai';
import { goiYTiep } from './goiYTiep';

type NguCanh = Awaited<ReturnType<typeof loadModelContext>>;

/** Liệt kê nhiều hơn chừng này thì câu trả lời thành một bảng, không phải một câu. */
const TRAN_GIA_TRI = 8;

/**
 * Số giá trị NẠP VỀ để đối chiếu.
 *
 * Người đọc chỉ thấy `TRAN_GIA_TRI` giá trị đầu; phần còn lại chỉ để `nanLoc`
 * tra, nên lấy rộng tay. Một cột phân loại ("Chi nhánh", "Nhóm hàng") có hàng
 * chục giá trị, không hàng trăm — còn một cột mã đơn thì vượt trần này và
 * KHÔNG nên nắn theo, vì nắn một mã đơn là chuyện người dùng gõ sai mã.
 */
const TRAN_DOI_CHIEU = 300;

/**
 * Toán tử SO KHỚP CHUỖI — chỉ những cái này mới có gì để đối chiếu với một
 * danh sách giá trị. `gt`/`lt` trên một cột số thì danh sách giá trị không nói
 * gì cả.
 */
const OP_CHUOI: readonly FilterOperator[] = ['equals', 'notEquals', 'contains', 'notContains'];

interface GiaTriCot {
  /** Nhãn cột như bảng số liệu đang gọi nó. */
  ten: string;
  gia: string[];
  /** Vượt `TRAN_DOI_CHIEU` — danh sách chưa đủ, nên không nắn theo nó. */
  conNua: boolean;
}

/**
 * Giá trị THẬT của mỗi cột đang bị lọc theo chuỗi.
 *
 * ═══ Vì sao đáng một vòng truy vấn nữa ═════════════════════════════════════
 *
 * ĐO ĐƯỢC 24/11/2026, và đây là lỗi làm HỎNG HẲN mọi bộ lọc theo tên — 6/6 câu
 * thử đều trượt:
 *
 *     "bán được bao nhiêu cà phê rang"
 *       -> filter equals ["cà phê rang"]
 *       -> "Không có dòng nào thoả điều kiện này.
 *           Cột Sản phẩm đang có: …, Cà phê rang, …"
 *
 * Câu trả lời nói "không có dòng nào" rồi liệt kê ra đúng thứ vừa bị hỏi. Đo ở
 * tầng truy vấn thì rõ vì sao: `equals` của Cube/ClickHouse PHÂN BIỆT hoa
 * thường, `contains` thì không.
 *
 *     equals   "Cà phê rang"  ->  1.614 dòng
 *     equals   "cà phê rang"  ->  rỗng
 *     contains "cà phê rang"  ->  1.614 dòng
 *
 * Mà mô hình ngôn ngữ thì gần như luôn viết giá trị về chữ thường, kể cả khi
 * người dùng gõ đúng hoa — nên đường "rỗng" LÀ đường thường gặp, không phải
 * đường ngoại lệ. Đó là lý do vòng truy vấn này nằm TRƯỚC truy vấn chính chứ
 * không nằm trên nhánh rỗng: nạp giá trị rồi nắn một lần tốn HAI truy vấn, còn
 * chạy sai rồi nạp giá trị rồi chạy lại tốn BA.
 *
 * Nó cũng xoá luôn một vòng truy vấn cũ: câu "Cột … đang có:" (xem
 * `giaTriDangCo`) trước đây tự nạp lại đúng danh sách này.
 *
 * Dùng lại `ctx` nên không nạp lại chỉ mục. Hỏng thì bỏ qua — truy vấn chính
 * vẫn phải đi ra, chỉ là không được nắn.
 */
async function napGiaTriLoc(
  tenantId: number,
  userId: number,
  dataModelId: number,
  truyVan: ExplorerQueryDto,
  truong: readonly TruongChon[],
  ctx: NguCanh,
): Promise<Map<number, GiaTriCot>> {
  // Chiều THỜI GIAN không vào đây: mốc ngày đã có `khoangThoiGian` và chốt
  // `NGAY_ISO` của `kiemForm` lo, và một danh sách "đang có: 2026-10-01,
  // 2026-10-02, …" thì vừa vô nghĩa vừa vượt trần ngay.
  const cot = [
    ...new Set(
      (truyVan.filters ?? [])
        .filter(
          (f) =>
            OP_CHUOI.includes(f.operator) &&
            truong.find((t) => t.id === f.dimensionId)?.thoiGian !== true,
        )
        .map((f) => f.dimensionId),
    ),
  ];

  const bang = new Map<number, GiaTriCot>();
  await Promise.all(
    cot.map(async (dimensionId) => {
      try {
        const kq = await runExplorerQuery(
          tenantId,
          userId,
          dataModelId,
          { dimensionIds: [dimensionId], measureIds: [], limit: TRAN_DOI_CHIEU },
          { ctx },
        );
        const ten = kq.columns[0]?.label;
        const gia = kq.rows
          .map((d) => d[0])
          .filter((v): v is string => typeof v === 'string' && v.trim() !== '');
        if (ten !== undefined && gia.length > 0) {
          bang.set(dimensionId, { ten, gia, conNua: kq.truncated });
        }
      } catch {
        /* Không nắn được thì thôi; câu trả lời chính vẫn đi ra. */
      }
    }),
  );
  return bang;
}

/**
 * Nắn giá trị lọc về ĐÚNG CHỮ mà dữ liệu đang ghi.
 *
 * Khớp trên `chuanHoa` — bỏ dấu, bỏ phân biệt hoa thường — nên nó sửa cả hai
 * kiểu lệch mà người dùng và mô hình ngôn ngữ thật sự tạo ra: `"cà phê rang"`
 * → `"Cà phê rang"`, và `"ha noi"` → `"Hà Nội"`.
 *
 * ⚠️ CHỈ nắn khi chuẩn hoá khớp TRỌN VẸN, không nắn khi nó là một phần. Đây là
 * chốt giữ đúng nghĩa của `contains`: `contains "cà phê"` là một yêu cầu tìm
 * theo phần tên, và nắn nó thành `"Cà phê rang"` là tự chọn một trong nhiều
 * sản phẩm hộ người dùng.
 *
 * ⚠️ Giá trị thay vào KHÔNG do mô hình ngôn ngữ viết — nó lấy từ kho dữ liệu
 * của chính tổ chức đó, qua `runExplorerQuery` đã lọc theo `tenantId`. Nên nó
 * không đi ngược `giuNguyenLoi` ở `kiemForm`: luật ấy chặn chuỗi mô hình BỊA,
 * còn đây là chuỗi lấy từ dữ liệu — cùng lập luận với `khoangThoiGian`.
 *
 * `conNua` thì bỏ qua cột đó: danh sách bị cắt nên "không tìm thấy" không có
 * nghĩa là "không có", và nắn theo một danh sách thiếu là đổi câu hỏi của
 * người dùng dựa trên một nửa dữ liệu.
 */
function nanLoc(truyVan: ExplorerQueryDto, bang: Map<number, GiaTriCot>): ExplorerQueryDto {
  const loc = truyVan.filters;
  if (loc === undefined) return truyVan;

  let doi = false;
  const moi = loc.map((f) => {
    const cot = bang.get(f.dimensionId);
    if (cot === undefined || cot.conNua || !OP_CHUOI.includes(f.operator)) return f;

    return {
      ...f,
      values: f.values.map((v) => {
        const that = cot.gia.find((g) => chuanHoa(g) === chuanHoa(v));
        if (that === undefined || that === v) return v;
        doi = true;
        return that;
      }),
    };
  });

  return doi ? { ...truyVan, filters: moi } : truyVan;
}

/**
 * Lọc không khớp dòng nào → nói ra cột đó ĐANG CÓ những giá trị gì.
 *
 * ĐO ĐƯỢC 24/11/2026: "doanh thu của sản phẩm Bánh" trả về rỗng, vì "Bánh" là
 * một giá trị của cột Nhóm hàng còn cột Sản phẩm thì ghi "Bánh bông lan". Người
 * dùng không có cách nào biết điều đó — họ chỉ thấy một câu trả lời rỗng cho
 * một câu hỏi nghe rất hợp lý, và bước tiếp theo của họ là gõ lại cùng một câu
 * bằng một cách khác, rồi lại một cách khác.
 *
 * `LY_DO_NOI['gia-tri-la']` đã nói đúng ý này rồi, nhưng nó chỉ nói được khi
 * `kiemForm` BỎ form. Ở đây form hợp lệ hoàn toàn: cột có thật, toán tử có
 * thật, giá trị đúng là lời người dùng. Chỉ có dữ liệu là không chứa nó.
 *
 * Sau khi `nanLoc` chạy, câu này chỉ còn nói về lệch THẬT — lệch hoa thường đã
 * được nắn, nên nó không còn cơ hội liệt kê ra đúng thứ người dùng vừa hỏi.
 *
 * Thuần, không tốn truy vấn: danh sách giá trị đã nạp sẵn ở `napGiaTriLoc`.
 */
function giaTriDangCo(truyVan: ExplorerQueryDto, bang: Map<number, GiaTriCot>): string {
  // `equals`/`contains` thôi. Một `notEquals` không khớp dòng nào nghĩa là MỌI
  // dòng đều bằng giá trị đó — danh sách giá trị không giải thích được chuyện
  // ấy, nó chỉ làm người đọc tưởng mình gõ sai tên.
  const loc = (truyVan.filters ?? []).find(
    (f) => (f.operator === 'equals' || f.operator === 'contains') && bang.has(f.dimensionId),
  );
  const cot = loc === undefined ? undefined : bang.get(loc.dimensionId);
  if (cot === undefined) return '';

  const gia = cot.gia.slice(0, TRAN_GIA_TRI);
  const conNua = cot.conNua || cot.gia.length > gia.length;
  return ` Cột ${cot.ten} đang có: ${gia.join(', ')}${conNua ? ' …' : ''}.`;
}

/**
 * Truy vấn này có DÍNH thời gian không — nhóm theo, hay lọc theo.
 *
 * Đọc từ FORM chứ không từ câu hỏi: một câu "tháng 10 so với tháng 9" thì mô
 * hình có thể gom theo ngày, theo tháng, hay chỉ lọc khoảng — và cả ba đều là
 * "có dính thời gian". Đọc từ chữ thì phải đoán lại đúng thứ form đã nói rõ.
 */
function dinhThoiGian(truyVan: ExplorerQueryDto, truong: readonly TruongChon[]): boolean {
  if (truyVan.timeDimension !== undefined) return true;
  const laThoiGian = (id: number): boolean => truong.find((t) => t.id === id)?.thoiGian === true;
  return (
    truyVan.dimensionIds.some(laThoiGian) ||
    (truyVan.filters ?? []).some((f) => laThoiGian(f.dimensionId))
  );
}

const CO_NHAT = /(^| )nhat( |$)/;

export function huongSap(cauHoi: string, cauTruoc?: string): 'asc' | 'desc' {
  const q = chuanHoa(cauHoi);
  if (!CO_NHAT.test(q) && cauTruoc !== undefined) return huongSap(cauTruoc);
  /*
   * `chieuSoSanh` ở `@bi/shared` — CÙNG hàm mà lớp ngoại tuyến của frontend
   * dùng để chọn `thap_nhat`. Trước đây chỗ này giữ một bản sao của danh sách
   * từ chỉ chiều, và một bản sao thì lệch: "kém nhất" sắp GIẢM ở đây trong khi
   * lớp kia đã đọc ra là tăng.
   *
   * ⚠️ Truyền `cauHoi` THÔ, không truyền `q`: hàm đó cố ý đọc trên chữ CÒN DẤU.
   */
  return chieuSoSanh(cauHoi) === 'thap' ? 'asc' : 'desc';
}

/*
 * ═══ Thứ form KHÔNG diễn đạt được, và phải NÓI RA ══════════════════════════
 *
 * `ExplorerQueryDto` mô tả được một truy vấn gộp: nhóm theo gì, đo cái gì, lọc
 * điều kiện nào. Nó KHÔNG mô tả được hai kỳ cạnh nhau, cũng không mô tả được
 * một phép chia lấy tỷ lệ. Mà câu hỏi đòi hai thứ đó thì vẫn "điền được form" —
 * mô hình ngôn ngữ bỏ phần nó không diễn đạt được rồi điền phần còn lại.
 *
 * ĐO ĐƯỢC 24/11/2026, và đây là hạng lỗi tệ nhất trong cả vòng thử vì nó SAI
 * MỘT CÁCH IM LẶNG:
 *
 *     "doanh thu tháng 10 so với tháng 9"
 *       -> "01/10/2026: Thành tiền 33.687.000."       (tháng 9 biến mất)
 *     "tại sao doanh thu tháng 10 giảm so với dự kiến của ban giám đốc"
 *       -> "Thành tiền 33.687.000."                   (một câu hỏi nhân quả)
 *
 * Con số đúng, câu hỏi thì không được trả lời, và không có một chữ nào cho
 * người đọc biết chuyện đó. Trước hội đồng, một con số được đưa ra để trả lời
 * câu hỏi về so sánh sẽ được hiểu LÀ câu trả lời cho so sánh.
 *
 * ⚠️ Đây là một phép đọc TỪ KHOÁ, không phải một phép hiểu — nên nó CHỈ được
 * THÊM một lời lưu ý, không bao giờ được chặn câu trả lời. Khớp nhầm thì cái
 * giá là một câu dặn thừa; chặn nhầm thì cái giá là mất một câu trả lời đúng.
 */
const CHUA_DIEN_DAT: {
  cum: readonly string[];
  viec: string;
  /**
   * Chỉ dặn khi truy vấn CÓ DÍNH thời gian — xem `chuaDienDat`.
   */
  chiKhiCoThoiGian?: boolean;
}[] = [
  {
    cum: ['so voi', 'so sanh', 'cung ky', 'tang truong', 'chenh lech', 'khac biet giua'],
    viec: 'đặt hai kỳ cạnh nhau để so',
    chiKhiCoThoiGian: true,
  },
  {
    cum: ['phan tram', '%', 'ty le', 'ty trong', 'chiem bao nhieu'],
    viec: 'tính tỷ lệ phần trăm',
  },
];

/**
 * ⚠️ `coThoiGian` là chốt chống DẶN NHẦM, không phải tối ưu.
 *
 * ĐO ĐƯỢC 24/11/2026: "so sánh Hà Nội với Đà Nẵng" trả về số của từng chi nhánh
 * — tức phép so sánh người dùng xin ĐÃ nằm trên màn hình — rồi dán thêm
 *
 *     (Lưu ý: tôi chưa đặt hai KỲ cạnh nhau để so…)
 *
 * Người dùng so hai CHI NHÁNH, không so hai kỳ. Câu dặn đúng về mặt kỹ thuật
 * (khung thật sự không đặt được hai kỳ cạnh nhau) nhưng nó trả lời một câu hỏi
 * khác, và hậu quả nặng hơn một câu thừa: nó làm người đọc nghi ngờ một câu trả
 * lời đang hoàn toàn đúng.
 *
 * Phân biệt bằng CHỖ phép so sánh diễn ra, đọc từ chính truy vấn:
 *
 *   so theo một chiều KHÔNG phải thời gian  -> form diễn đạt được, không dặn
 *   so có dính thời gian                    -> form KHÔNG đặt được hai kỳ, dặn
 *
 * Đã thử đếm SỐ DÒNG thay cho chốt này và nó SAI — đo được ngay: "doanh thu
 * tháng 10 so với tháng 9" làm mô hình tách theo NGÀY, ra 26 dòng. Nhiều dòng,
 * nhưng tháng 9 vẫn biến mất hoàn toàn khỏi câu trả lời. Số dòng chỉ nói rằng
 * truy vấn có nhóm theo một chiều nào đó; nó không nói rằng chiều ấy là chiều
 * người dùng muốn so.
 *
 * Nới hơn một chút về phía DẶN THỪA là có chủ ý: "so sánh doanh thu tháng 10
 * của Gò Vấp với Quận 1" dính cả hai nên vẫn bị dặn. Đó đúng là thang giá mà
 * khối chú thích trên đã chọn — khớp nhầm thì mất một câu thừa, bỏ sót thì mất
 * một cảnh báo.
 *
 * Ô `phan tram` KHÔNG có chốt này: một tỷ lệ thì có thời gian hay không cũng
 * vẫn chưa tính được, vì khung không có phép chia nào cả.
 */
function chuaDienDat(cauHoi: string, cauTruoc: string | undefined, coThoiGian: boolean): string {
  const q = ` ${chuanHoa(cauTruoc === undefined ? cauHoi : `${cauTruoc} ${cauHoi}`)} `;
  const thay = CHUA_DIEN_DAT.find(
    (m) => m.cum.some((c) => q.includes(c)) && (m.chiKhiCoThoiGian !== true || coThoiGian),
  );
  if (thay === undefined) return '';
  return (
    ` (Lưu ý: tôi chưa ${thay.viec} được, nên con số trên là con số của đúng cách tôi vừa ` +
    `hiểu câu hỏi — xem dòng "Tôi hiểu" ở trên.)`
  );
}

/**
 * Câu hỏi đòi một thứ mô hình KHÔNG có → nói ra, và nói TRƯỚC con số.
 *
 * Xem `docThieu` ở `datCauHoi` cho lỗi mà câu này vá: một câu hỏi về chi phí
 * được trả lời bằng doanh thu, không một chữ lưu ý. Đặt ở ĐẦU chứ không cuối:
 * nó đổi cách đọc con số, nên người đọc phải thấy nó trước khi đọc số — một
 * lời dặn đứng sau một con số thì nó đã bị tin trước rồi.
 */
function thieuTruong(thieu: readonly string[], doDung: readonly string[], rong: boolean): string {
  if (thieu.length === 0) return '';
  const ten = thieu.map((t) => `“${t}”`).join(', ');
  // Rỗng thì KHÔNG nói "con số dưới đây": không có con số nào dưới đây cả.
  if (rong || doDung.length === 0) return `⚠️ Mô hình này không có ${ten}. `;
  return (
    `⚠️ Mô hình này không có ${ten}, nên con số dưới đây đo bằng ${doDung.join(', ')} — ` +
    `không phải thứ bạn vừa hỏi. `
  );
}

/**
 * "Mô hình này đo được những gì" — câu nói cuối khi không còn gì khác nói được.
 */
function moTaDoDuoc(truong: readonly TruongChon[], thieu: readonly string[]): string {
  // Bỏ đuôi "(bảng …)" mà `hoiTrenMoHinh` gắn vào nhãn chiều: nó có để phân
  // biệt hai cột trùng tên khi gửi cho mô hình, còn trong một câu nói với người
  // thì nó lặp lại tên bảng ở mỗi tên cột.
  const ten = (loai: TruongChon['loai']): string[] =>
    truong
      .filter((t) => t.loai === loai)
      .slice(0, TRAN_GIA_TRI)
      .map((t) => t.nhan.replace(/ \(bảng .*\)$/, ''));

  const do_ = ten('thuoc do');
  const chieu = ten('chieu');
  if (do_.length === 0 && chieu.length === 0) return '';

  /*
   * GỌI TÊN thứ đang thiếu khi biết nó là gì.
   *
   * "Tôi chưa thấy thứ bạn hỏi" đúng nhưng mơ hồ — người dùng vừa hỏi ba thứ
   * trong một câu thì họ không biết thứ nào vướng. `thieu` do mô hình khai ra
   * đúng cụm đó; xem `docThieu`.
   */
  const dau =
    thieu.length === 0
      ? 'Tôi chưa thấy thứ bạn hỏi trong mô hình này.'
      : `Mô hình này không có ${thieu.map((t) => `“${t}”`).join(', ')}.`;

  return (
    `${dau} Nó đo được: ` +
    `${do_.join(', ')}` +
    (chieu.length === 0 ? '' : `; và tách được theo: ${chieu.join(', ')}`) +
    '. Bạn thử hỏi theo một trong những tên đó xem.'
  );
}

export interface HoiTrenMoHinhKetQua {
  cau: string | null;
  so: string[];
  hieuLa: string | null;
  daHoi: boolean;
  lyDo: string | null;
  goiY: string[];
  truyVan: ExplorerQueryDto | null;
}

export async function hoiTrenMoHinh(
  tenantId: number,
  userId: number,
  dataModelId: number,
  cauHoi: string,
  boiCanh?: { cauHoi: string; truyVan: ExplorerQueryDto },
): Promise<HoiTrenMoHinhKetQua> {
  /*
   * Nạp chỉ mục ĐÚNG MỘT LẦN cho cả câu hỏi.
   *
   * Bản đầu gọi `explorerFields` rồi `runExplorerQuery`, và mỗi hàm tự nạp chỉ
   * mục của riêng nó — `indexModel` là bốn vòng MySQL, nên một câu hỏi tốn
   * TÁM vòng cho một thứ không đổi giữa hai lời gọi. Pool mặc định 10 kết nối,
   * nên chúng còn xếp hàng chờ nhau khi có vài người hỏi cùng lúc.
   *
   * `loadModelContext` + `ctx` là đường đã có sẵn cho đúng việc này; xem
   * `InternalQueryOptions.ctx`, nơi cùng lập luận được viết cho khung 12 ô.
   */
  const ctx = await loadModelContext(tenantId, dataModelId);
  const truongs = fieldsFromIndex(ctx.index);

  /*
   * THƯỚC ĐO xếp trước CHIỀU.
   *
   * `datCauHoi` cắt ở `TRAN_TRUONG`, và một mô hình nhiều bảng vượt trần đó dễ
   * dàng. Thước đo thì vừa ít hơn hẳn vừa gần như luôn cần tới — một câu hỏi
   * không có thước đo nào thì không có gì để đo. Xếp chiều lên trước là thước
   * đo bị cắt mất, và khi đó mọi câu hỏi trên mô hình đó đều trả về `{}`.
   */
  const truong: TruongChon[] = [
    ...truongs.measures.map((m) => ({
      id: m.id,
      nhan: m.label,
      loai: 'thuoc do' as const,
      /*
       * Phép ĐANG KHAI đứng đầu, rồi các phép đổi được — đúng tập mà
       * `buildQuery` chấp nhận. Thiếu phép đang khai thì một thước đo tính
       * toán (`availableAggs` rỗng) sẽ từ chối cả phép của chính nó.
       */
      phepGop: [...new Set([m.agg, ...(m.availableAggs ?? [])])].filter(
        (a): a is MeasureAgg => a !== undefined,
      ),
    })),
    ...truongs.dimensions.map((d) => ({
      id: d.id,
      // Kèm tên bảng: hai bảng cùng có cột `name` thì nhãn trần không phân biệt
      // được, và mô hình sẽ chọn một trong hai bằng cách tung đồng xu.
      nhan: `${d.label} (bảng ${d.datasetName})`,
      loai: 'chieu' as const,
      thoiGian: d.cubeType === 'time',
    })),
  ];

  const {
    truyVan: formTho,
    daHoi,
    lyDo,
    thieu,
  } = await datCauHoi({
    cauHoi,
    truong,
    boiCanh,
    // Phạm vi đệm — xem khối chú thích ở `datCauHoi`. Kèm `tenantId` dù
    // `dataModelId` đã là khoá toàn cục: một khoá đệm nói rõ nó thuộc tổ chức
    // nào thì đọc log Redis cũng thấy, và không có đường nào để hai tổ chức
    // chạm vào cùng một khoá.
    pham: `${String(tenantId)}:${String(dataModelId)}`,
  });
  if (formTho === null) {
    return {
      cau: null,
      so: [],
      hieuLa: null,
      daHoi,
      truyVan: null,
      /*
       * KHÔNG CÓ lý do cụ thể vẫn nói được một điều có ích: mô hình này đo
       * được những gì.
       *
       * ĐO ĐƯỢC 24/11/2026: 8 trong 42 câu thử về tới đây với `lyDo === null` —
       * "đơn lớn nhất là bao nhiêu", "những đơn trên 1 triệu", "lợi nhuận là
       * bao nhiêu", "doanh thu tăng bao nhiêu phần trăm" — và cả tám đều hiện
       * ra đúng một câu "Tôi chưa hiểu câu này". Người dùng không có cách nào
       * biết mình vừa hỏi một thứ KHÔNG CÓ TRONG MÔ HÌNH (không có cột lợi
       * nhuận) hay một thứ khung chưa diễn đạt được.
       *
       * Mà danh sách trường thì đang nằm ngay trong tay hàm này. Nói nó ra là
       * biến một câu từ chối thành một cái bảng chọn — người đọc thấy ngay câu
       * hỏi kế tiếp của mình nằm ở đâu.
       *
       * Cắt ở `TRAN_GIA_TRI` tên mỗi loại: một mô hình nhiều bảng có hàng trăm
       * cột, và một câu trả lời liệt kê hết thì không ai đọc.
       */
      /*
       * ⚠️ CHỈ khi `daHoi` — nếu không thì câu này che mất một câu đúng hơn.
       *
       * `daHoi === false` nghĩa là lượt gọi tới nhà cung cấp đã HỎNG (hết hạn
       * mức token, mất mạng, quá hạn chờ), và khung đã có sẵn câu cho việc đó
       * (`cauTrangThai('goi-hong')` ở `HoiDapPanel`). Trả về "tôi chưa thấy thứ
       * bạn hỏi trong mô hình này" lúc ấy là nói sai, nói rất chắc chắn — đúng
       * hạng lỗi mà vòng vá trước vừa gỡ đi khỏi chỗ này.
       */
      lyDo: lyDo !== null ? LY_DO_NOI[lyDo] : daHoi ? moTaDoDuoc(truong, thieu) : null,
      goiY: [],
    };
  }

  /*
   * Nắn bộ lọc TRƯỚC khi chạy — xem `napGiaTriLoc` cho lỗi mà việc này sửa.
   *
   * `truyVan` từ đây trở xuống là form ĐÃ NẮN, và nó cũng là form trả về cho
   * màn hình. Có chủ ý: nó là bối cảnh của lượt hỏi tiếp (nên `daTinCay` nhận
   * đúng chữ ở lượt sau) và là form mà nút "Mở trong Khám phá" mang theo.
   */
  const bangGiaTri = await napGiaTriLoc(tenantId, userId, dataModelId, formTho, truong, ctx);
  const truyVan = nanLoc(formTho, bangGiaTri);

  /*
   * Hướng sắp đi theo CÂU HỎI, không theo mặc định của `buildQuery`.
   *
   * Đây là dây nối mà `tests/danhGiaTruyVan.test.ts` đo: tháo nó ra là tám câu
   * trong bảng điểm chuyển sang SAI. Xem `huongSap`.
   */
  const huong = huongSap(cauHoi, boiCanh?.cauHoi);
  const kq = await runExplorerQuery(tenantId, userId, dataModelId, truyVan, { order: huong, ctx });

  /*
   * Nhãn để mô tả truy vấn lấy từ `columns` của KẾT QUẢ khi có, chứ không phải
   * từ danh sách đã gửi đi: `distinctFieldLabels` có thể đã thêm tên bảng vào
   * nhãn để phân biệt hai cột trùng tên, và câu "Tôi hiểu:" phải gọi trường
   * bằng đúng cái tên mà bảng số liệu bên dưới đang dùng.
   */
  const nhanCua = new Map<number, string>(truong.map((t) => [t.id, t.nhan]));
  for (const c of kq.columns) nhanCua.set(c.id, c.label);

  const doc = docKetQua(kq, truyVan, nhanCua, huong);

  /*
   * Hai lời nói thêm, và chúng LOẠI TRỪ nhau: rỗng thì nói giá trị cột đang có
   * (`giaTriDangCo`), có số thì mới cần dặn về thứ form không diễn đạt được
   * (`chuaDienDat`). Dán cả hai vào một câu rỗng là dặn người đọc về một con số
   * không tồn tại.
   */
  const rong = khongCoDong(kq);
  const them = rong
    ? giaTriDangCo(truyVan, bangGiaTri)
    : chuaDienDat(cauHoi, boiCanh?.cauHoi, dinhThoiGian(truyVan, truong));

  const dan = thieuTruong(
    thieu,
    kq.columns.filter((c) => c.kind === 'measure').map((c) => c.label),
    rong,
  );

  return {
    ...doc,
    cau: dan + doc.cau + them,
    daHoi,
    truyVan,
    lyDo: null,
    // Gợi ý sinh từ form ĐÃ CHẠY, nên nó không bao giờ mời lại thứ vừa hỏi.
    goiY: goiYTiep(truyVan, truong, huong),
  };
}
