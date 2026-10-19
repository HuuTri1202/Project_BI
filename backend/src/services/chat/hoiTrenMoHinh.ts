import type { ExplorerQueryDto } from '@bi/shared';

import { explorerFields, runExplorerQuery } from '../datamodel/explorer';
import { datCauHoi, type TruongChon } from './datCauHoi';
import { docKetQua } from './dienGiai';

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
    ...truongs.measures.map((m) => ({ id: m.id, nhan: m.label, loai: 'thuoc do' as const })),
    ...truongs.dimensions.map((d) => ({
      id: d.id,
      // Kèm tên bảng: hai bảng cùng có cột `name` thì nhãn trần không phân biệt
      // được, và mô hình sẽ chọn một trong hai bằng cách tung đồng xu.
      nhan: `${d.label} (bảng ${d.datasetName})`,
      loai: 'chieu' as const,
    })),
  ];

  const { truyVan, daHoi } = await datCauHoi({ cauHoi, truong, boiCanh });
  if (truyVan === null) return { cau: null, so: [], hieuLa: null, daHoi, truyVan: null };

  const kq = await runExplorerQuery(tenantId, userId, dataModelId, truyVan);

  /*
   * Nhãn để mô tả truy vấn lấy từ `columns` của KẾT QUẢ khi có, chứ không phải
   * từ danh sách đã gửi đi: `distinctFieldLabels` có thể đã thêm tên bảng vào
   * nhãn để phân biệt hai cột trùng tên, và câu "Tôi hiểu:" phải gọi trường
   * bằng đúng cái tên mà bảng số liệu bên dưới đang dùng.
   */
  const nhanCua = new Map<number, string>(truong.map((t) => [t.id, t.nhan]));
  for (const c of kq.columns) nhanCua.set(c.id, c.label);

  return { ...docKetQua(kq, truyVan, nhanCua), daHoi, truyVan };
}
