import type { ExplorerQueryDto } from '@bi/shared';

import { apiClient } from '../../services/apiClient';

/**
 * NHỚ TRONG PHIÊN — cùng một câu hỏi thì cùng một câu trả lời.
 *
 * ═══ Vấn đề đo được ════════════════════════════════════════════════════════
 *
 * Chạy đúng một bộ 25 câu hai lần, cùng mô hình, cùng `temperature: 0`: một
 * câu đổi đáp án. 4% trôi mà không có gì đổi ở đầu vào — xem `SEED` bên
 * `services/chat/dienDat.ts`.
 *
 * 4% nghe nhỏ, nhưng nó rơi đúng vào thói quen tệ nhất có thể: người dùng
 * không tin một câu trả lời thì họ GÕ LẠI Y HỆT để kiểm. Và nhận về câu khác.
 * Không có cách nào nhanh hơn để mất sạch niềm tin vào cả khung.
 *
 * Cache này không làm mô hình bớt trôi — nó làm cái trôi ấy KHÔNG LỌT vào
 * trong một phiên. Hỏi lại là đọc lại đúng câu cũ.
 *
 * ═══ Thứ CỐ Ý không nằm trong đây ══════════════════════════════════════════
 *
 * `hoiTrenMoHinh` KHÔNG được nhớ. Nó chạy một truy vấn thật trên kho, và số
 * liệu thì đổi — nạp thêm một tệp, đồng bộ một kết nối là con số khác. Nhớ nó
 * lại nghĩa là trả về số của mười phút trước, đúng kiểu sai mà cả khung dựng
 * lên để chặn. Hai thứ trên nhớ được vì chúng không đọc số liệu: một cái CHỌN
 * một nhãn, một cái VIẾT LẠI một câu đã tính xong.
 *
 * ═══ Vì sao một `Map` chứ không phải react-query ═══════════════════════════
 *
 * Cùng lý do đã ghi ở trên: ở đây không có `invalidate`, không ai đọc lại, và
 * khoá thì gồm cả danh sách nhãn — một khoá truy vấn cho nó là thêm một thứ
 * phải nhớ xoá. Map sống đúng bằng vòng đời của tab, tức đúng nghĩa "phiên".
 */
const TRAN_NHO = 200;
const nho = new Map<string, unknown>();

function doc<T>(khoa: string): T | undefined {
  return nho.get(khoa) as T | undefined;
}

function ghi(khoa: string, gia: unknown): void {
  // Map giữ thứ tự chèn, nên khoá cũ nhất luôn đứng đầu — xoá nó là FIFO mà
  // không phải nuôi thêm một cấu trúc nào. Một phiên thật không bao giờ chạm
  // trần này; nó chỉ chặn một tab mở cả tuần phình mãi.
  if (nho.size >= TRAN_NHO) {
    const cu = nho.keys().next().value;
    if (cu !== undefined) nho.delete(cu);
  }
  nho.set(khoa, gia);
}

/** Chỉ dùng trong test — khung không có đường nào gọi tới. */
export function xoaNhoPhien(): void {
  nho.clear();
}

/**
 * Nhờ backend viết lại câu trả lời cho mượt hơn.
 *
 * ═══ Vì sao KHÔNG có `hooks.ts` và `keys.ts` như các tính năng khác ════════
 *
 * Bộ ba `api`/`hooks`/`keys` tồn tại cho dữ liệu CÓ CACHE: cùng một khoá, nhiều
 * nơi đọc, cần `invalidate` khi có thay đổi. Ở đây không có gì trong số đó —
 * mỗi câu hỏi là một lần gọi, không ai đọc lại, và kết quả cũ không bao giờ
 * đúng cho câu hỏi sau. Thêm một khoá truy vấn cho nó là thêm một thứ phải nhớ
 * xoá.
 *
 * ═══ Vì sao câu trả lời KHÔNG chờ lời gọi này ══════════════════════════════
 *
 * Câu mẫu đã tính xong ngay trên máy, trước khi gọi. Nên khung hiện nó LẬP TỨC
 * rồi mới thay bằng bản viết lại nếu bản đó về. Người dùng không bao giờ phải
 * nhìn một vòng xoay để đọc một con số máy họ đã có.
 *
 * Nó cũng là lý do mọi kiểu hỏng ở đây đều vô hại: không khoá, mất mạng, hết
 * lượt — câu mẫu đang hiện vẫn ở đó. Xem `services/chat/dienDat.ts` bên backend.
 */
export async function dienDatLai(input: {
  cauHoi: string;
  cau: string;
  so: string[];
}): Promise<string> {
  const khoa = `dd:${JSON.stringify(input)}`;
  const da = doc<string>(khoa);
  if (da !== undefined) return da;

  const { data } = await apiClient.post<{ cau: string }>('/v1/chat/dien-dat', input);

  /*
   * Chỉ nhớ khi mô hình THẬT SỰ viết lại được.
   *
   * Backend trả nguyên `cau` khi chưa cấu hình, khi gọi hỏng, hoặc khi luật
   * đối chiếu bác bản viết lại. Nhớ mấy trường hợp đó lại nghĩa là câu này
   * vĩnh viễn không bao giờ được viết lại nữa trong phiên, kể cả sau khi nhà
   * cung cấp đã sống lại.
   */
  if (data.cau !== input.cau) ghi(khoa, data.cau);
  return data.cau;
}

/**
 * Nhờ mô hình chọn xem câu hỏi ứng với nhãn dữ kiện nào.
 *
 * Chỉ gọi khi phép so từ khoá ở máy đã trượt — nên nó không nằm trên đường đi
 * của câu hỏi bình thường, và không tốn gì khi khung đã tự trả lời được.
 *
 * Gửi đi CHỈ CÓ NHÃN, không có giá trị nào: mô hình chọn trường, nó không cần
 * thấy số liệu để làm việc đó. Xem `services/chat/hieuY.ts` bên backend.
 */
/** Ba trạng thái, không phải hai — xem `services/chat/hieuY.ts`. */
export interface HieuCauHoiKetQua {
  chon: number | null;
  trangThai: 'chua-cau-hinh' | 'da-doc' | 'goi-hong';
}

export async function hieuCauHoi(input: {
  cauHoi: string;
  nhan: string[];
}): Promise<HieuCauHoiKetQua> {
  const khoa = `hy:${JSON.stringify(input)}`;
  const da = doc<HieuCauHoiKetQua>(khoa);
  if (da !== undefined) return da;

  const { data } = await apiClient.post<HieuCauHoiKetQua>('/v1/chat/hieu-y', input);

  // Chỉ nhớ khi mô hình đã đọc thật. Nhớ một lượt GỌI HỎNG lại là khoá chặt
  // câu hỏi đó ở trạng thái hỏng cho tới hết phiên, kể cả khi mạng đã về.
  if (data.trangThai === 'da-doc') ghi(khoa, data);
  return data;
}

/**
 * Nhờ mô hình ĐẶT MỘT CÂU HỎI MỚI trên một mô hình dữ liệu.
 *
 * Đường CUỐI của khung, và là đường duy nhất tự chạy một truy vấn mới trên kho
 * — nên nó cũng là đường duy nhất gác bằng `authorize('datamodel', 'read')`.
 * `viewer` nhận 403, và khung quay về trả lời bằng thứ đang hiện trên màn hình.
 *
 * Gửi đi CHỈ CÓ CÂU HỎI. Danh sách trường do backend tự nạp từ mô hình trên
 * đường dẫn: cho client quyết "mô hình được thấy những trường nào" là một cái
 * cửa không có lý do gì để mở. Xem `services/chat/hoiTrenMoHinh.ts`.
 */
export interface HoiTrenMoHinhKetQua {
  cau: string | null;
  so: string[];
  hieuLa: string | null;
  daHoi: boolean;
  /**
   * Vì sao không dựng được truy vấn, bằng câu đọc được — hoặc `null`.
   *
   * Chỉ có ở mấy lý do NGƯỜI DÙNG LÀM ĐƯỢC GÌ ĐÓ (giá trị lọc lạ, thước đo
   * không nhận phép gộp, mô hình thiếu cột ngày). Câu chữ do backend viết từ
   * một enum đóng — xem `services/chat/datCauHoi.ts`, `LY_DO_NOI`.
   */
  lyDo: string | null;
  /** Câu hỏi TIẾP sinh từ form vừa chạy — xem `services/chat/goiYTiep.ts`. */
  goiY: string[];
  /** Form đã chạy — gửi lại ở lượt sau để hỏi tiếp. */
  truyVan: ExplorerQueryDto | null;
}

export async function hoiTrenMoHinh(
  moHinhId: number,
  cauHoi: string,
  /**
   * Lượt hỏi trước, để hiểu được "còn tháng 4 thì sao".
   *
   * Backend kiểm lại form này từ đầu bằng đúng `explorerQueryBodySchema` mà
   * Explorer dùng — nó là một thân request như mọi thân request khác, không
   * phải một thứ được tin vì "backend vừa tự dựng ra nó ở lượt trước".
   */
  boiCanh?: { cauHoi: string; truyVan: ExplorerQueryDto },
): Promise<HoiTrenMoHinhKetQua> {
  const { data } = await apiClient.post<HoiTrenMoHinhKetQua>(
    `/v1/datamodels/${String(moHinhId)}/chat/cau-hoi`,
    boiCanh === undefined ? { cauHoi } : { cauHoi, boiCanh },
  );
  return data;
}

/** Một cột gửi cho mô hình chọn — `id` là CHỈ SỐ cột trong bảng đang hiện. */
export interface CotChon {
  id: number;
  nhan: string;
  loai: 'chieu' | 'thuoc do';
}

export interface ChonCotKetQua {
  /** Chỉ số cột NHÃN, hoặc `null` khi mô hình không chọn. */
  chieu: number | null;
  /** Chỉ số cột ĐO, hoặc `null`. */
  thuocDo: number | null;
  /** Mô hình có THẬT SỰ được hỏi không — xem `HieuCauHoiKetQua.trangThai`. */
  daHoi: boolean;
}

/**
 * Hai cột của bảng đang hiện mà câu hỏi nói tới — lớp ĐIỀN FORM.
 *
 * `hieuCauHoi` không làm được việc này: nó chọn MỘT mục, nên để chọn một CẶP
 * cột thì phải liệt kê sẵn mọi cặp — một bảng 18 cột chữ × 6 cột số là 108
 * nhãn, mà trần của nó là 60. Đường này cho mô hình chọn riêng từng ô.
 *
 * Nhớ trong phiên NHƯ `hieuCauHoi`, và cùng một luật: chỉ nhớ khi mô hình thật
 * sự đã đọc. Một lượt gọi hỏng mà nhớ lại thì trục trặc một phút thành trục
 * trặc cả buổi.
 */
export async function chonCot(input: { cauHoi: string; cot: CotChon[] }): Promise<ChonCotKetQua> {
  const khoa = `cc:${JSON.stringify(input)}`;
  const da = doc<ChonCotKetQua>(khoa);
  if (da !== undefined) return da;

  const { data } = await apiClient.post<ChonCotKetQua>('/v1/chat/chon-cot', input);
  if (data.daHoi) ghi(khoa, data);
  return data;
}
