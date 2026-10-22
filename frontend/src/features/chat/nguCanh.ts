import type { ChartType, ExplorerFieldsDto, ReportDataDto } from '@bi/shared';
import { createContext, useContext, useEffect } from 'react';

/**
 * NGỮ CẢNH — thứ trang đang mở tự khai là "những gì tôi đang biết".
 *
 * ═══ Vì sao trang tự khai, thay vì khung hỏi đáp tự đi tìm ═════════════════
 *
 * Khung hỏi đáp phải trả lời bằng **dữ liệu thật**, và dữ liệu thật thì đã nằm
 * sẵn trong trang: trang Kho dữ liệu có `DatasetDto`, trang chi tiết có cả danh
 * sách cột, trang báo cáo có số liệu của mọi ô trong một object. Không cần hỏi
 * lại server câu nào.
 *
 * Cách còn lại là để khung tự đọc cache của react-query. Nó chạy được, và nó
 * sai ở hai chỗ: khung phải biết hình dạng khoá truy vấn của MỌI tính năng, và
 * cache còn giữ dữ liệu của những trang đã rời — nên câu trả lời có thể nói về
 * một thứ không còn trên màn hình, mà vẫn nghe rất chắc chắn.
 *
 * ═══ Quyền được thừa hưởng, không phải dựng lại ════════════════════════════
 *
 * Đây là phần quan trọng nhất của thiết kế. `viewer` CỐ Ý không có
 * `dataset:read` và `datamodel:read` (migration 26 xoá khỏi `casbin_rule`, xem
 * `shared/src/rbac.ts`). Vì khung chỉ đọc thứ trang đã tải được, một viewer
 * không bao giờ có dữ liệu Kho dữ liệu trong tay để mà hỏi — không cần thêm một
 * lớp chặn nào ở đây.
 *
 * Một endpoint kiểu "hỏi gì cũng trả lời" thì ngược lại: nó sẽ là một đường
 * vòng quanh chính migration 26, và phải tự dựng lại toàn bộ lớp quyền đó.
 */

/**
 * Một dữ kiện tra cứu được: nhãn người đọc hiểu, và giá trị ĐÃ định dạng.
 *
 * `gia` là chuỗi chứ không phải số, cố ý: nơi khai dữ kiện là nơi biết nó nên
 * đọc ra sao ("12.431", "28,3 %", "4,2 MB"), và khung hỏi đáp chỉ việc đọc lại.
 */
export interface DuKien {
  /** Ví dụ: `Số dòng của Đơn hàng Q4`. Câu hỏi được so với chuỗi này. */
  nhan: string;
  gia: string;
  /**
   * Điều kiện của con số — nối vào sau câu trả lời.
   *
   * ⚠️ BẮT BUỘC khi con số không phải toàn bộ sự thật. `DatasetDto.rowCount` là
   * ví dụ có sẵn: doc comment của nó trong `@bi/shared` nói thẳng rằng con số
   * đó một mình "nói dối" khi `truncated` bật. Khung lặp lại con số mà bỏ điều
   * kiện thì nó nói dối to hơn màn hình, vì màn hình còn có chỗ hiện cảnh báo.
   */
  luuY?: string;
}

/**
 * Một bảng dữ liệu THÔ — cột và dòng, đúng như nó hiện trên màn hình.
 *
 * ═══ Khác `bang` ở chỗ nào ═══════════════════════════════════════
 *
 * `bang` (`ReportDataDto`) đã được ai đó chọn sẵn chiều và thước đo: một cột
 * nhãn, một cột số. Bảng thô thì không — nó có hai mươi cột và không cột nào
 * được đề cử. Câu hỏi là thứ chọn ra hai cột đó, và câu trả lời gọi tên cả hai
 * — xem `bangTuBangTho`.
 *
 * `luuY` KHÔNG phải tuỳ chọn ở đây, khác hẳn `DuKien.luuY`. Mọi bảng thô mà
 * khung đọc được đều là MẪU: tab "Dữ liệu" của một bộ dữ liệu là một câu
 * `SELECT … LIMIT`, không có tổng số dòng (xem doc của `DatasetPreviewDto`). Một
 * phép tính trên mẫu mà không nói ra là mẫu thì đọc thành con số của cả bộ dữ
 * liệu — một con số có thật trả lời cho câu hỏi khác. Bắt buộc kiểu là cách
 * chặn người thêm nguồn sau này quên nó.
 */
export interface BangTho {
  cot: string[];
  dong: (string | number | boolean | null)[][];
  luuY: string;
}

/** Một thứ có thể hỏi về: một bộ dữ liệu, một bảng trong mô hình, một biểu đồ. */
export interface Nguon {
  /**
   * Tên hiện trên chip chọn nguồn.
   *
   * Phải GIỐNG HỆT tên đang hiện trên màn hình. Với ô biểu đồ nghĩa là dùng
   * `visual.title ?? tieuDeTuSoLieu(data)` — xem `features/reports/nhanO.ts`,
   * nơi đã ghi lại lỗi đo được lần đầu: thẻ ghi một tên, hộp chọn ghi tên khác,
   * và người dùng không biết mình đang nói tới ô nào.
   */
  ten: string;
  duKien: DuKien[];
  /**
   * Số liệu đã tổng hợp của một biểu đồ.
   *
   * Có mặt = mở ra nhóm câu hỏi TÍNH TOÁN (cao nhất, tổng, tỉ trọng…). Vắng
   * mặt = nguồn này chỉ tra cứu được. Đó là lý do nó `optional` chứ không phải
   * một mảng rỗng: "không có bảng để tính" và "bảng rỗng" cần hai câu trả lời
   * khác nhau.
   */
  bang?: ReportDataDto;
  /**
   * Bảng dữ liệu THÔ của nguồn này — xem `BangTho`.
   *
   * Đứng riêng với `bang` chứ không thay nó: một ô biểu đồ đã có chiều và
   * thước đo do người dùng chọn, còn đây là bảng chưa ai chọn gì. Trộn hai thứ
   * làm một là mất đúng chỗ phân biệt đó.
   */
  bangTho?: BangTho;
  /**
   * Mô hình dữ liệu mà nguồn này LÀ — mở ra nhóm câu hỏi MỚI trên chính nó.
   *
   * ═══ Khác `NguCanh.moHinhId` ở chỗ nào ══════════════════════════════
   *
   * `NguCanh.moHinhId` là mô hình mà TRANG đang đứng trên — người dùng không
   * phải gọi tên nó, vì họ đang nhìn nó. Cái này thì ngược: nó gắn vào TẪNG
   * MÔ HÌNH trong một danh sách, và chỉ dùng tới khi câu hỏi GỌI TÊN mô hình ấy.
   *
   * Nhờ nó, đứng ở Kho dữ liệu hay Trang chủ vẫn hỏi được một câu số liệu thật
   * — miễn là nói rõ hỏi trên mô hình nào. Không ai gọi tên thì không đoán bừa
   * một mô hình: một truy vấn chạy trên sai mô hình vẫn ra một con số đẹp.
   */
  moHinhId?: number;
}

export interface NguCanh {
  /** Tên trang, dùng trong câu "tôi chưa hiểu" để nói rõ đang ở đâu. */
  trang: string;
  nguon: Nguon[];
  /**
   * Mô hình dữ liệu mà trang này đang đứng trên — mở ra nhóm câu hỏi MỚI.
   *
   * ═══ Vì sao nó là một id, không phải thêm dữ liệu ═════════════════════════
   *
   * Mọi thứ khác trong `NguCanh` là dữ liệu trang ĐÃ TẢI VỀ, và đó là cả lời
   * hứa của khung: nó chỉ đọc thứ đang ở trước mắt người dùng. Trường này phá
   * lệ, nên nó cố ý chỉ mang một id: trang nói "có một mô hình ở đây", còn việc
   * đặt câu hỏi mới trên mô hình đó là của backend, và nó đi qua đúng cái cổng
   * `authorize('datamodel', 'read')` mà Explorer đi qua.
   *
   * `viewer` KHÔNG có quyền đó (migration 26), nên với họ lời gọi trả 403 và
   * khung quay về đúng hành vi cũ — trả lời bằng thứ đang hiện trên màn hình.
   * Không cần một lớp kiểm nào ở frontend, và không có chỗ nào để quên nó.
   */
  moHinhId?: number;
  /**
   * Danh sách TRƯỜNG kéo thả được — chỉ trình dựng báo cáo khai.
   *
   * ═══ Khác `moHinhId` ở chỗ nào ════════════════════════════════════════
   *
   * `moHinhId` là một lời mời backend đi hỏi hộ. Cái này thì đúng luật chung
   * của khung: dữ liệu trang ĐÃ TẢI VỀ và đang bày ra ở cột trái màn hình.
   *
   * Nó mở ra một nhóm câu hỏi mà mọi nhóm khác không với tới: "tui muốn xem
   * doanh thu theo khu vực" — câu trả lời không phải một con số mà là một
   * HƯỚNG DẪN kéo trường nào vào đâu. Xem `goiYBieuDo`.
   */
  truong?: ExplorerFieldsDto;
  /**
   * ĐIỀN một đề xuất vào ô đang chọn — đường GHI duy nhất của cả khung.
   *
   * ═══ Vì sao nó phá lệ, và vì sao vẫn đáng ═════════════════════════════
   *
   * Mọi thứ khác ở đây là dữ liệu trang đưa RA. Trường này đi ngược: khung gọi
   * lại vào trang. Đổi lại, "đề xuất" mới thật là đề xuất — bấm một cái là
   * biểu đồ hiện ra, thay vì đọc một hướng dẫn rồi tự làm lại bằng tay.
   *
   * Ba chỗ giữ cho nó không thành một cái cửa hậu:
   *
   *   1. Chỉ trình dựng khai. Trang khác không có ô nào để điền vào.
   *   2. Nó nhận ID TRƯỜNG, không nhận cấu hình tự do — khung không dựng được
   *      một trạng thái ô mà chính trình dựng không dựng được.
   *   3. Nó đi qua đúng `patch` mà cú kéo thả đi qua, nên Hoàn tác (Ctrl+Z)
   *      phủ nó y như mọi thao tác khác.
   *
   * ⚠️ Hàm này phải GIỮ NGUYÊN tham chiếu giữa các lần render, như mọi thứ
   * khác trong `NguCanh`. Một hàm mới mỗi lần render là một `NguCanh` mới mỗi
   * lần render, và `useKhaiNguCanh` sẽ quay vòng vô hạn.
   */
  veBieuDo?: (g: { chieuId: number; thuocDoId: number; loai: ChartType }) => void;
}

export const NGU_CANH_RONG: NguCanh = { trang: '', nguon: [] };

/**
 * Chỉ `createContext` và type — không có component nào trong file này.
 *
 * Cùng quy ước với `auth/authContext.ts` và `workspace/workspaceContext.ts`:
 * provider nằm ở file riêng, để một thay đổi ở provider không làm mọi file
 * import type phải dịch lại.
 */
export const NguCanhContext = createContext<{
  nguCanh: NguCanh;
  khai: (nguCanh: NguCanh) => void;
}>({ nguCanh: NGU_CANH_RONG, khai: () => undefined });

/**
 * Trang gọi hook này để khai "đây là những gì tôi đang biết".
 *
 * ⚠️ `nguCanh` phải được `useMemo` ở phía gọi. Một object literal dựng mới mỗi
 * lần render sẽ chạy lại effect này sau MỖI lần render, và mỗi lần là một
 * `setState` ở provider — tức là một vòng render vô hạn.
 */
export function useKhaiNguCanh(nguCanh: NguCanh): void {
  const { khai } = useContext(NguCanhContext);
  useEffect(() => {
    khai(nguCanh);
  }, [khai, nguCanh]);
}

export function useNguCanh(): NguCanh {
  return useContext(NguCanhContext).nguCanh;
}
