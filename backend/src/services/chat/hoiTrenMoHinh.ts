import type { ExplorerQueryDto, MeasureAgg } from '@bi/shared';

import { explorerFields, runExplorerQuery } from '../datamodel/explorer';
import { chuanHoa, datCauHoi, LY_DO_NOI, type TruongChon } from './datCauHoi';
import { docKetQua } from './dienGiai';
import { goiYTiep } from './goiYTiep';

/** Chữ "nhất" đứng riêng thành một từ — "cao nhất", "ít doanh thu nhất". */
const CO_NHAT = /(^| )nhat( |$)/;

/** Những từ lật chiều so sánh: có chúng thì "nhất" là NHỎ nhất. */
const TU_NGUOC = /(^| )(it|thap|nho|re|cu|som)( |$)/;

/**
 * Câu hỏi muốn hạng CAO hay hạng THẤP — và vì sao CODE quyết, không phải mô hình.
 *
 * ═══ Lỗi mà hàm này sửa ════════════════════════════════════════════════════
 *
 * `buildQuery` luôn sắp theo thước đo đầu tiên, và không ai nói gì thì nó sắp
 * GIẢM. Với "sản phẩm nào bán chạy nhất" thì đúng — đúng một cách tình cờ.
 *
 * Với "sản phẩm nào bán ÍT nhất" thì truy vấn trả về danh sách bán CHẠY nhất,
 * `docKetQua` liệt kê theo đúng thứ tự ấy, và dòng đầu — thứ người ta đọc như
 * câu trả lời — là đáp án của câu hỏi ngược lại. Một con số THẬT trả lời một
 * câu hỏi KHÁC: đúng hình dạng mà cả khung hỏi đáp dựng lên để chặn.
 *
 * Có `limit` thì nó không chỉ sai thứ tự mà sai CẢ TẬP: "5 sản phẩm bán chậm
 * nhất" cắt 5 dòng đầu của chiều giảm, tức năm cái bán chạy nhất.
 *
 * ═══ Vì sao không để MÔ HÌNH điền hướng ═══════════════════════════════════
 *
 *   1. `order` không nằm trong `ExplorerQueryDto` — nó là tuỳ chọn NỘI BỘ
 *      (`InternalQueryOptions`). Mở nó ra hợp đồng HTTP chỉ để mô hình điền là
 *      nới mặt tiếp xúc cho một việc mà hai biểu thức chính quy làm xong.
 *   2. Đây là chuyện của TIẾNG VIỆT, không phải của mô hình dữ liệu. Lớp ngoại
 *      tuyến bên frontend đã phân biệt đúng hai hướng này từ lâu — cùng hai
 *      biểu thức, xem `CO_NHAT`/`TU_NGUOC` ở `features/chat/traLoi.ts`. Hai
 *      lớp trả lời khác nhau cho cùng một câu còn tệ hơn cả hai cùng sai.
 *
 * ⚠️ Bẫy đã ghi ở bản frontend, giữ nguyên ở đây: so chuỗi LIỀN NHAU thì
 * "báo cáo nhất" chứa đúng chuỗi "cao nhat". Nên cả hai vế so theo RANH GIỚI TỪ.
 *
 * ⚠️ Danh sách từ giữ ĐÚNG BẰNG bản frontend, không thêm bớt. "kém nhất",
 * "yếu nhất" hiện rơi về `desc` ở cả hai nơi — một câu trượt giống nhau ở hai
 * lớp thì còn sửa được một chỗ; hai lớp lệch nhau thì không ai biết tin bên nào.
 *
 * ═══ Lượt hỏi TIẾP thừa hưởng hướng, trừ khi nó tự nói ════════════════════
 *
 * "sản phẩm nào bán ít nhất" rồi "còn Miền Nam thì sao": lượt sau không có
 * chữ nào về thứ hạng, mà người hỏi vẫn đang hỏi về cái ít nhất — form cũ
 * được giữ lại thì hướng cũng phải được giữ lại.
 *
 * Nhưng CHỈ khi lượt mới im lặng. Nối hai câu lại rồi so một lượt (như
 * `loiNguoiDung` làm với giá trị lọc) thì "… ít nhất" rồi "cái nào cao nhất"
 * vẫn ra `asc`, tức là bỏ qua đúng lúc người ta vừa đổi ý — và đổi ý thì họ
 * nói thẳng ra chứ không ám chỉ.
 */
export function huongSap(cauHoi: string, cauTruoc?: string): 'asc' | 'desc' {
  const q = chuanHoa(cauHoi);
  if (!CO_NHAT.test(q) && cauTruoc !== undefined) return huongSap(cauTruoc);
  return CO_NHAT.test(q) && TU_NGUOC.test(q) ? 'asc' : 'desc';
}

/**
 * Hỏi một câu hỏi MỚI trên một mô hình dữ liệu — §chat, bước (4).
 *
 * ═══ Ba bước, và mỗi bước ở đúng chỗ của nó ════════════════════════════════
 *
 *   1. Nạp danh sách trường của mô hình   (`explorerFields` — của §10.7)
 *   2. Mô hình ngôn ngữ ĐIỀN FORM          (`datCauHoi`     — không gian đóng)
 *   3. Chạy truy vấn, đọc kết quả bằng code (`runExplorerQuery` + `docKetQua`)
 *
 * Bước 2 là chỗ duy nhất mô hình ngôn ngữ tham gia, và nó chỉ chọn id trong
 * danh sách của bước 1. Bước 3 không nhờ nó gì cả: con số do Cube tính, câu do
 * `docKetQua` dựng. Nên không có đường nào để một con số đi tới người đọc mà
 * không qua một phép tính thật.
 *
 * ═══ Vì sao gộp ba bước vào MỘT lời gọi HTTP ═══════════════════════════════
 *
 * Để frontend không phải biết gì về id trường: nó gửi một câu hỏi và nhận một
 * câu trả lời. Ít chỗ phải hiểu `dimensionIds` nghĩa là ít chỗ dựng sai nó.
 *
 * ⚠️ KHÔNG phải vì bảo mật. Bản đầu của chú thích này viết rằng gộp lại thì
 * "form không bao giờ rời khỏi backend, nên client không sửa được nó" — câu đó
 * SAI, và nó sai theo kiểu dễ tin: ai gọi được route này thì đã có
 * `datamodel:read`, tức là đã gọi thẳng `POST /datamodels/:id/query` với bất kỳ
 * form nào. Giữ form ở server không thêm một lớp chặn nào; nó chỉ gọn hơn.
 *
 * Nhận ra chỗ đó mới mở được bộ nhớ hội thoại (bước 6): trả form về cho client
 * rồi nhận lại ở lượt sau không mất gì, vì chưa từng có gì để mất.
 *
 * Giá phải trả: một lời gọi mất cả thời gian của mô hình LẪN thời gian quét
 * ClickHouse. Chấp nhận được vì đây là đường CUỐI — khung chỉ tới đây khi mọi
 * phép so ngoại tuyến đã trượt.
 */

export interface HoiTrenMoHinhKetQua {
  /** Câu trả lời, hoặc `null` khi không dựng được truy vấn nào. */
  cau: string | null;
  /** Con số đã định dạng mà câu trả lời đứng trên — xem `giuNguyenSo`. */
  so: string[];
  /** Cách truy vấn đã được hiểu, bằng chữ. Xem `moTaTruyVan`. */
  hieuLa: string | null;
  /** Mô hình có THẬT SỰ được hỏi không — xem `HieuYKetQua.daHoi`. */
  daHoi: boolean;
  /**
   * Vì sao không dựng được truy vấn — câu đọc được, hoặc `null`.
   *
   * CHỈ có ở mấy lý do người dùng làm được gì đó; xem `LyDoBoForm`. Mọi kiểu
   * hỏng khác vẫn im, vì nói ra cũng không ai làm gì được và nó phơi ruột một
   * lớp mà người dùng không cần biết có tồn tại.
   */
  lyDo: string | null;
  /** Câu hỏi TIẾP, sinh từ form vừa chạy bằng CODE — xem `goiYTiep`. */
  goiY: string[];
  /**
   * Form đã chạy, trả về để lượt hỏi TIẾP dùng lại — bộ nhớ hội thoại.
   *
   * Trả về cho client không mất gì: ai gọi được đường này đã có
   * `datamodel:read`, tức đã gọi thẳng `/query` với bất kỳ form nào. Và lượt
   * sau nó vẫn bị kiểm lại từ đầu bởi `explorerQueryBodySchema`.
   */
  truyVan: ExplorerQueryDto | null;
}

export async function hoiTrenMoHinh(
  tenantId: number,
  userId: number,
  dataModelId: number,
  cauHoi: string,
  /** Lượt hỏi trước — xem `DatCauHoiInput.boiCanh`. */
  boiCanh?: { cauHoi: string; truyVan: ExplorerQueryDto },
): Promise<HoiTrenMoHinhKetQua> {
  const truongs = await explorerFields(tenantId, dataModelId);

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

  const { truyVan, daHoi, lyDo } = await datCauHoi({ cauHoi, truong, boiCanh });
  if (truyVan === null) {
    return {
      cau: null,
      so: [],
      hieuLa: null,
      daHoi,
      truyVan: null,
      lyDo: lyDo === null ? null : LY_DO_NOI[lyDo],
      goiY: [],
    };
  }

  /*
   * Hướng sắp đi theo CÂU HỎI, không theo mặc định của `buildQuery`.
   *
   * Đây là dây nối mà `tests/danhGiaTruyVan.test.ts` đo: tháo nó ra là tám câu
   * trong bảng điểm chuyển sang SAI. Xem `huongSap`.
   */
  const huong = huongSap(cauHoi, boiCanh?.cauHoi);
  const kq = await runExplorerQuery(tenantId, userId, dataModelId, truyVan, { order: huong });

  /*
   * Nhãn để mô tả truy vấn lấy từ `columns` của KẾT QUẢ khi có, chứ không phải
   * từ danh sách đã gửi đi: `distinctFieldLabels` có thể đã thêm tên bảng vào
   * nhãn để phân biệt hai cột trùng tên, và câu "Tôi hiểu:" phải gọi trường
   * bằng đúng cái tên mà bảng số liệu bên dưới đang dùng.
   */
  const nhanCua = new Map<number, string>(truong.map((t) => [t.id, t.nhan]));
  for (const c of kq.columns) nhanCua.set(c.id, c.label);

  return {
    ...docKetQua(kq, truyVan, nhanCua, huong),
    daHoi,
    truyVan,
    lyDo: null,
    // Gợi ý sinh từ form ĐÃ CHẠY, nên nó không bao giờ mời lại thứ vừa hỏi.
    goiY: goiYTiep(truyVan, truong, huong),
  };
}
