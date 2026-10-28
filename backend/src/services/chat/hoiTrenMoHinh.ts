import { chieuSoSanh, type ExplorerQueryDto, type MeasureAgg } from '@bi/shared';

import { fieldsFromIndex, loadModelContext, runExplorerQuery } from '../datamodel/explorer';
import { chuanHoa, datCauHoi, LY_DO_NOI, type TruongChon } from './datCauHoi';
import { docKetQua } from './dienGiai';
import { goiYTiep } from './goiYTiep';

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
  const kq = await runExplorerQuery(tenantId, userId, dataModelId, truyVan, { order: huong, ctx });

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
