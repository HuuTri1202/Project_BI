import type { ExplorerQueryDto } from '@bi/shared';
import { useEffect, useRef, useState } from 'react';

import { KHONG_XUAT } from '../../services/danhDauXuat';
import { dienDatLai, hieuCauHoi, hoiTrenMoHinh } from './api';
import { useNguCanh } from './nguCanh';
import type { Nguon } from './nguCanh';
import { useNguCanhHeThong } from './nguCanhHeThong';
import {
  goiYGan,
  goiYSoSanh,
  luaChonHeThong,
  luaChonTrang,
  nhanDuyNhat,
  traLoiHeThong,
  traLoiTrang,
} from './traLoi';
import type { TraLoi } from './traLoi';

/**
 * Khung hỏi đáp nổi ở góc dưới-phải.
 *
 * ═══ Vì sao KHÔNG dùng `components/ui/Modal` ═══════════════════════════════
 *
 * `Modal` dựng trên `<dialog>` + `showModal()`, nên nó khoá phần còn lại của
 * trang: nền thành `inert`, Esc đóng, tiêu điểm bị giam. Với một hộp thoại xác
 * nhận thì đó đúng là thứ cần. Ở đây thì nó che mất chính cái biểu đồ, cái bảng
 * mà người ta đang hỏi về — tức là lấy đi thứ duy nhất giúp họ kiểm lại câu trả
 * lời. Nên đây là một hộp `fixed` thường, và trang vẫn đọc được, vẫn cuộn được.
 *
 * ═══ Màu: MƯỢN của hệ thống, không mang bảng màu riêng ═════════════════════
 *
 * Khung chỉ dùng `brand-*` và `slate-*` — đúng hai thang màu mà mọi màn hình
 * khác đang dùng. Một khung chat mang tông màu riêng (tím, cam…) sẽ đọc ra như
 * một tiện ích của bên thứ ba dán vào góc màn hình, chứ không phải một phần của
 * sản phẩm.
 *
 * Đúng MỘT chỗ lệch có chủ ý: chấm xanh lá "đang đọc". Nó mượn màu dải trạng
 * thái trên bụng con robot, và nó là thứ duy nhất trong khung cần được nhận ra
 * mà không phải đọc chữ.
 *
 * ═══ Vì sao `KHONG_XUAT` ═══════════════════════════════════════════════════
 *
 * Trang báo cáo xuất được ra PNG/PDF, và việc chụp quét cả vùng. Thiếu dấu này
 * thì mọi tệp xuất ra đều có một khung chat dán ở góc. Xem `services/danhDauXuat`.
 *
 * ═══ Khung tự ẩn khi trang chưa khai gì ════════════════════════════════════
 *
 * Trang nào chưa có hàm khai ngữ cảnh thì không có nguồn nào, và một khung mở ra
 * để trả lời "tôi không biết gì về trang này" thì tệ hơn là không có khung. Nó
 * sẽ tự hiện khi trang đó được khai.
 */

interface TinNhan {
  /**
   * Mã riêng của từng tin.
   *
   * Bản viết lại của mô hình về MUỘN, và nó phải đáp xuống ĐÚNG bong bóng đã
   * sinh ra nó — không phải bong bóng cuối cùng. Hỏi câu thứ hai trong lúc câu
   * thứ nhất còn đang bay là chuyện bình thường, và khi đó "cập nhật tin cuối"
   * sẽ dán câu trả lời của câu một vào dưới câu hỏi hai: một câu đúng, cho một
   * câu hỏi khác, ở chỗ không ai nghi ngờ.
   */
  id: number;
  ai: 'nguoi' | 'bot';
  cau: string;
  luc: string;
  /** Bot không hiểu câu hỏi — vẽ khác, và đọc bằng `role="status"`. */
  chuaHieu?: boolean;
  /** Câu bấm được, chỉ có ở tin "chưa hiểu" — xem `goiYGan`. */
  goiY?: string[];
  /**
   * Cách truy vấn đã được hiểu — chỉ có ở đường đặt câu hỏi MỚI.
   *
   * Nó không phải lời giải thích cho đẹp: đó là đường duy nhất trong khung mà
   * con số được tính bởi một truy vấn do mô hình dựng, nên nó là chỗ duy nhất
   * một câu trả lời sai KHÔNG tự lộ ra. Xem `services/chat/dienGiai.ts`.
   */
  hieuLa?: string;
}

function gioBayGio(): string {
  return new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

export function HoiDapPanel(): React.ReactElement | null {
  const nguCanh = useNguCanh();
  const [mo, setMo] = useState(false);
  const [chon, setChon] = useState(0);
  const [cauHoi, setCauHoi] = useState('');
  const [tinNhan, setTinNhan] = useState<TinNhan[]>([]);
  const demId = useRef(0);
  const dayCuon = useRef<HTMLDivElement>(null);

  /**
   * Lượt hỏi trước của đường đặt-câu-hỏi-mới — bộ nhớ hội thoại.
   *
   * ═══ Vì sao mang theo `moHinhId` ══════════════════════════════════════════
   *
   * Khung được dựng ở `ProtectedRoute` nên nó KHÔNG bị tháo khi đổi trang —
   * cuộc trò chuyện ở lại. Mà một form của mô hình số 7 thì vô nghĩa trên mô
   * hình số 9: id trường của hai mô hình không liên quan gì nhau, và lượt hỏi
   * tiếp sẽ sửa một form trỏ vào những trường không còn tồn tại.
   *
   * Backend sẽ chặn (id lạ -> bỏ cả form), nên hậu quả chỉ là một câu "chưa
   * hiểu" vô cớ. Nhưng đó vẫn là một câu sai, nên kiểm ngay ở đây rẻ hơn.
   */
  const [boiCanh, setBoiCanh] = useState<{
    moHinhId: number;
    cauHoi: string;
    truyVan: ExplorerQueryDto;
  } | null>(null);

  /*
   * Dữ kiện xuyên hệ thống — chỉ kéo về khi khung ĐANG MỞ.
   *
   * Hook phải đứng trước mọi `return` có điều kiện bên dưới: `nguon.length === 0`
   * thoát sớm, và một hook gọi sau chỗ đó sẽ đổi số lượng hook giữa hai lần
   * render.
   */
  const heThong = useNguCanhHeThong(mo);

  // Tin mới nhất phải nằm trong tầm mắt. Không có cái này thì từ câu thứ ba trở
  // đi câu trả lời rơi xuống dưới mép khung, và người dùng tưởng không có gì
  // xảy ra.
  useEffect(() => {
    dayCuon.current?.scrollTo({ top: dayCuon.current.scrollHeight });
  }, [tinNhan]);

  if (nguCanh.nguon.length === 0) return null;

  // Nguồn có thể biến mất khi số liệu nạp lại (một ô bị xoá, danh sách lọc
  // khác đi), nên chỉ số đã chọn có thể trỏ ra ngoài mảng. Rơi về nguồn đầu
  // thay vì vẽ ra một khung trống không giải thích được.
  const nguon: Nguon = nguCanh.nguon[chon] ?? nguCanh.nguon[0]!;

  function hoi(): void {
    const q = cauHoi.trim();
    if (q === '') return;

    /*
     * TRANG trước, HỆ THỐNG sau — thứ tự này là cả thiết kế.
     *
     * Trang đang mở là thứ người dùng đang nhìn và kiểm lại được bằng mắt. Một
     * câu trả lời xuyên hệ thống thì không: nó nói về thứ không có trên màn
     * hình, nên nó chỉ được dùng khi trang thật sự không trả lời được, và nó
     * luôn tự khai ra là nó đọc ở đâu (xem `traLoiHeThong`).
     */
    const kq = traLoiTrang(nguCanh.nguon, nguon, q) ?? traLoiHeThong(heThong, q);
    demId.current += 2;
    const idBot = demId.current;
    const luc = gioBayGio();

    /*
     * Hiện câu mẫu NGAY. Nó đã tính xong trên máy này; bắt người dùng nhìn một
     * vòng xoay để đọc một con số đã có là lấy đi thứ duy nhất mà lớp mô hình
     * ngôn ngữ không làm tốt hơn được — tốc độ.
     */
    setTinNhan((cu) => [
      ...cu,
      { id: idBot - 1, ai: 'nguoi', cau: q, luc },
      {
        id: idBot,
        ai: 'bot',
        luc,
        cau:
          kq?.cau ??
          `Tôi chưa hiểu câu này. Tôi trả lời bằng số liệu đang có trên ${nguCanh.trang}${
            heThong.length > 0 ? ', cộng danh sách bộ dữ liệu và mô hình của tổ chức' : ''
          } — không tra ở đâu khác.`,
        /*
         * Bế tắc phải kèm đường đi tiếp. Gần nhất với câu vừa gõ trước; không
         * có gì gần thì rơi về đúng những câu mẫu của màn chào — thà gợi ý
         * chung chung còn hơn để người dùng tự đoán xem khung biết gì.
         */
        ...(kq === null
          ? {
              chuaHieu: true,
              goiY: (() => {
                const gan = goiYGan(nguCanh.nguon, nguon, q);
                return gan.length > 0 ? gan : cauMau(nguon, goiYSoSanh(nguCanh.nguon)).slice(0, 3);
              })(),
            }
          : {}),
      },
    ]);
    setCauHoi('');

    if (kq === null) {
      nhoMoHinhChon(q, idBot);
      return;
    }

    vietLai(q, idBot, kq);
  }

  /**
   * Nhờ mô hình viết lại thành câu tiếng Việt tự nhiên, rồi vá vào đúng tin đó.
   *
   * Dùng cho CẢ HAI đường ra câu trả lời — phép so từ khoá và đường mô hình
   * chọn nhãn. Trước đây chỉ đường thứ nhất đi qua đây, nên đúng những câu hỏi
   * khó nhất (những câu phải nhờ mô hình mới hiểu) lại nhận về câu khô nhất:
   * một nhãn, một dấu hai chấm, một con số.
   *
   * Con số vẫn không đổi được: luật đối chiếu ở backend bỏ cả câu nếu một chuỗi
   * trong `so` biến mất. Xem `services/chat/dienDat.ts`.
   */
  function vietLai(q: string, idBot: number, kq: TraLoi): void {
    void dienDatLai({ cauHoi: q, cau: kq.cau, so: kq.so })
      .then((moi) => {
        setTinNhan((cu) => cu.map((t) => (t.id === idBot ? { ...t, cau: moi } : t)));
      })
      .catch(() => {
        // Cố ý im lặng: câu mẫu đang hiện vẫn là một câu trả lời đúng và đủ.
      });
  }

  /**
   * So từ khoá đã trượt — nhờ mô hình CHỌN một nhãn trong số dữ kiện trang giữ.
   *
   * Bong bóng "chưa hiểu" đã hiện rồi, và nó tự nâng cấp tại chỗ khi câu trả
   * lời về. Cùng khuôn với lớp viết lại: hiện ngay thứ máy này biết, rồi mới
   * cải thiện — người dùng không bao giờ nhìn một vòng xoay.
   */
  function nhoMoHinhChon(q: string, idBot: number): void {
    /*
     * Lựa chọn của TRANG xếp trước, rồi mới tới mấy câu xuyên hệ thống.
     *
     * Backend chỉ lấy 60 nhãn đầu, nên thứ tự này quyết định 60 nhãn đó là của
     * thứ người dùng đang nhìn. `luaChonHeThong` cố ý chỉ góp một chục nhãn —
     * bản tóm tắt và mấy câu so cả danh sách — chứ không góp dữ kiện của từng
     * mục, vì sáu trăm nhãn sẽ đẩy sạch trang ra khỏi danh sách.
     */
    const luaChon = [...luaChonTrang(nguCanh.nguon, nguon, q), ...luaChonHeThong(heThong)];
    if (luaChon.length === 0) {
      // Không có gì để chọn thì bỏ hẳn lớp chọn-nhãn, nhưng đường đặt câu hỏi
      // mới không phụ thuộc vào danh sách đó.
      if (nguCanh.moHinhId !== undefined) nhoMoHinhHoi(q, idBot, nguCanh.moHinhId);
      return;
    }

    void hieuCauHoi({ cauHoi: q, nhan: luaChon.map((lc) => lc.nhan) })
      .then(({ chon, daHoi }) => {
        const kq = chon === null ? null : (luaChon[chon]?.chay() ?? null);
        if (kq === null) {
          /*
           * Mô hình đã đọc hết danh sách và không mục nào trả lời được. Đó là
           * một câu KHÁC HẲN "tôi chưa hiểu câu này": nó nói trang này không có
           * số liệu đó, chứ không phải người dùng gõ sai. Chỉ nói vậy khi mô
           * hình thật sự đã được hỏi — máy chưa cấu hình thì chưa ai đọc gì cả.
           */
          /*
           * Trang có mô hình thì còn một đường nữa: đặt một câu hỏi MỚI. Thử
           * nó TRƯỚC khi kết luận là không có số liệu — câu "tôi đã đọc hết"
           * mà vẫn còn một đường chưa đi là một câu nói sai.
           */
          if (nguCanh.moHinhId !== undefined) {
            nhoMoHinhHoi(q, idBot, nguCanh.moHinhId);
            return;
          }
          if (!daHoi) return;
          setTinNhan((cu) =>
            cu.map((t) =>
              t.id === idBot
                ? {
                    ...t,
                    cau: `Tôi đã đọc hết số liệu đang có trên ${nguCanh.trang} và không có mục nào trả lời được câu này.`,
                  }
                : t,
            ),
          );
          return;
        }

        // Mô hình chỉ CHỌN được một mục. Câu chữ và con số vẫn do `traLoi.ts`
        // tính ra tại máy này — kể cả `luuY`, điều kiện của con số.
        setTinNhan((cu) =>
          cu.map((t) => (t.id === idBot ? { id: t.id, ai: t.ai, cau: kq.cau, luc: t.luc } : t)),
        );
        // Rồi mới viết lại cho ra câu, y như đường kia.
        vietLai(q, idBot, kq);
      })
      .catch(() => {
        // Cố ý im lặng: bong bóng "chưa hiểu" kèm gợi ý vẫn đang ở đó.
      });
  }

  /**
   * Đường CUỐI: nhờ mô hình ĐẶT MỘT CÂU HỎI MỚI trên mô hình dữ liệu.
   *
   * ═══ Vì sao nó đứng cuối, sau cả lớp chọn-nhãn ════════════════════════════
   *
   * Vì nó đắt nhất và nguy hiểm nhất.
   *
   * Đắt: một lần gọi là một lượt gọi mô hình CỘNG một lượt quét ClickHouse.
   * Mấy đường trước đó miễn phí hoặc chỉ tốn một lượt gọi mô hình.
   *
   * Nguy hiểm: mọi đường trước đó chỉ CHỌN trong thứ đã tính xong, nên câu trả
   * lời luôn kèm nguyên văn cái nhãn được chọn và người đọc thấy ngay nếu nó
   * nói chuyện khác. Đường này thì tự dựng một truy vấn mới, và một truy vấn
   * sai trường vẫn ra một con số đẹp. Đó là lý do câu trả lời của nó LUÔN mang
   * theo `hieuLa` — xem `services/chat/dienGiai.ts`.
   *
   * ⚠️ Chỉ chạy khi trang khai `moHinhId`. Trang Kho dữ liệu hay Hồ sơ không
   * có mô hình nào, nên ở đó khung dừng ở "chưa hiểu" như trước.
   */
  function nhoMoHinhHoi(q: string, idBot: number, moHinhId: number): void {
    // Chỉ nhớ lượt trước khi nó thuộc ĐÚNG mô hình này.
    const truoc =
      boiCanh !== null && boiCanh.moHinhId === moHinhId
        ? { cauHoi: boiCanh.cauHoi, truyVan: boiCanh.truyVan }
        : undefined;

    void hoiTrenMoHinh(moHinhId, q, truoc)
      .then(({ cau, so, hieuLa, truyVan }) => {
        if (cau === null) return;

        /*
         * Nhớ lượt này cho lượt sau.
         *
         * `truyVan !== null` ở đây là THU HẸP KIỂU, không phải một luật: hợp
         * đồng của endpoint buộc `cau` và `truyVan` cùng có hoặc cùng không, và
         * `cau === null` đã thoát ở trên. Thứ canh chuyện "không ra câu trả lời
         * thì không nhớ" là chính cái `return` đó.
         */
        if (truyVan !== null) setBoiCanh({ moHinhId, cauHoi: q, truyVan });

        /*
         * `hieuLa` đi TRƯỚC câu trả lời, trên một dòng riêng.
         *
         * Nó là thứ duy nhất cho người đọc đối chiếu "máy hiểu gì" với "tôi hỏi
         * gì". Nhét nó vào cuối thì người ta đọc con số rồi tin luôn, và cái
         * dòng giải thích thành ra để cho vui.
         */
        setTinNhan((cu) =>
          cu.map((t) =>
            t.id === idBot
              ? { id: t.id, ai: t.ai, luc: t.luc, cau, hieuLa: hieuLa ?? undefined }
              : t,
          ),
        );

        // Viết lại cho mượt, vẫn bị đối chiếu số như hai đường kia.
        vietLai(q, idBot, { cau, so });
      })
      .catch(() => {
        /*
         * Im lặng, và đây là ca có thật chứ không phải phòng xa: `viewer` không
         * có `datamodel:read` nên lời gọi này trả 403 với họ. Bong bóng "chưa
         * hiểu" kèm gợi ý vẫn đúng và vẫn ở đó.
         */
      });
  }

  if (!mo) {
    return (
      <button
        type="button"
        {...KHONG_XUAT}
        onClick={() => setMo(true)}
        aria-label="Mở khung hỏi đáp về dữ liệu đang xem"
        title="Hỏi về dữ liệu đang xem"
        /*
         * Nền SÁNG, không phải nền thương hiệu đặc.
         *
         * Con robot màu trắng, nên đặt nó lên nền xanh đặc là bôi mất chính nó —
         * chỉ còn một khối trắng nhoè. Nền trắng + viền mảnh + bóng đổ giữ được
         * hình, và vẫn nổi khỏi mặt trang vì mọi trang ở đây đều là `bg-slate-50`.
         */
        className="group fixed right-4 bottom-4 z-50 flex h-14 w-14 items-center justify-center rounded-full border border-slate-200 bg-white shadow-lg transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-brand-200 focus-visible:outline-none"
      >
        <BieuTuongRobot className="h-9 w-9 transition-transform group-hover:-translate-y-0.5" />
      </button>
    );
  }

  return (
    <section
      {...KHONG_XUAT}
      aria-label="Hỏi đáp về dữ liệu đang xem"
      className="fixed right-4 bottom-4 z-50 flex h-[34rem] max-h-[calc(100vh-2rem)] w-[23rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
    >
      <header className="flex shrink-0 items-center gap-2.5 border-b border-slate-200 px-3.5 py-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50">
          <BieuTuongRobot className="h-7 w-7" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-slate-900">Trợ lý dữ liệu</span>
          {/* Phạm vi nằm ngay dưới tên, không giấu trong câu trả lời: đây là thứ
              phân biệt khung này với một con chatbot biết tuốt. */}
          <span className="flex items-center gap-1.5 text-xs text-slate-500">
            <span className="h-2 w-2 shrink-0 rounded-full bg-green-500" aria-hidden="true" />
            {/* Phạm vi nói ra ở đây, không giấu trong câu trả lời: vế thứ
                hai chỉ hiện khi hai lời gọi xuyên hệ thống thật sự có dữ liệu
                — một viewer không có `dataset:read` thì nó không hiện, và khung
                không hứa thứ nó không với tới. */}
            <span className="truncate">
              Đang đọc {nguCanh.trang}
              {heThong.length > 0 && ' + toàn tổ chức'}
            </span>
          </span>
        </span>
        <button
          type="button"
          onClick={() => setMo(false)}
          aria-label="Thu khung hỏi đáp"
          className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            className="h-4 w-4"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </header>

      {/* Một nguồn thì không có gì để chọn, và một dãy chip có đúng một chip chỉ
          chiếm chỗ mà không nói thêm điều gì. */}
      {nguCanh.nguon.length > 1 && (
        /*
         * MỘT hàng cuộn ngang, không phải `flex-wrap`.
         *
         * Trang danh sách có thể đẩy ra mười mấy nguồn; gói dòng thì dãy chip
         * ăn bốn hàng và đè gần hết chỗ của cuộc trò chuyện — tức là che mất
         * chính thứ người dùng mở khung ra để đọc. Cuộn ngang giữ mọi chip với
         * tới được mà chỉ tốn một hàng.
         */
        <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-slate-100 px-3.5 py-2">
          {nhanDuyNhat(nguCanh.nguon).map((nhan, i) => (
            <button
              /* Khoá theo CHỈ SỐ, không theo tên: tên nguồn trùng nhau được —
                 ba mô hình cùng tên "Global-Superstore" là chuyện có thật, và
                 khoá trùng thì React gộp chúng thành một chip. */
              key={i}
              type="button"
              aria-pressed={i === chon}
              onClick={() => {
                setChon(i);
                // Xoá cuộc trò chuyện cũ: nó nói về nguồn KHÁC, và để nó nằm lại
                // dưới một chip vừa đổi là mời người đọc gán nó cho nguồn mới —
                // bằng những con số có thật, nên không có gì báo là đã nhầm.
                setTinNhan([]);
                // Và quên luôn lượt hỏi trước: "còn tháng 4 thì sao" sau khi đổi
                // chip là hỏi tiếp về một thứ người dùng vừa rời khỏi.
                setBoiCanh(null);
              }}
              className={`shrink-0 rounded-full border px-2 py-0.5 text-xs whitespace-nowrap transition-colors ${
                i === chon
                  ? 'border-brand-500 bg-brand-50 font-medium text-brand-700'
                  : 'border-slate-200 text-slate-500 hover:bg-slate-50'
              }`}
            >
              {nhan}
            </button>
          ))}
        </div>
      )}

      {/* Nền xám để bong bóng trắng nổi lên — cùng cách mọi trang dùng
          `bg-slate-50` làm nền cho thẻ trắng. */}
      <div ref={dayCuon} className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-slate-50 p-3.5">
        {tinNhan.length === 0 ? (
          <ChaoHoi
            nguon={nguon}
            soSanh={goiYSoSanh(nguCanh.nguon)}
            coHeThong={heThong.length > 0}
            onChon={setCauHoi}
          />
        ) : (
          tinNhan.map((t) => <BongBong key={t.id} tin={t} onChon={setCauHoi} />)
        )}
      </div>

      <form
        className="flex shrink-0 items-center gap-2 border-t border-slate-200 bg-white p-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          hoi();
        }}
      >
        <input
          value={cauHoi}
          onChange={(e) => setCauHoi(e.target.value)}
          placeholder="Hỏi về số liệu đang xem…"
          aria-label="Câu hỏi"
          className="min-w-0 flex-1 rounded-full border border-slate-300 px-3.5 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
        />
        <button
          type="submit"
          disabled={cauHoi.trim() === ''}
          aria-label="Hỏi"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white transition-colors hover:bg-brand-700 disabled:bg-slate-200 disabled:text-slate-400"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4" aria-hidden="true">
            <path d="M3.4 20.4 21 12 3.4 3.6 3.4 10.2 15.6 12 3.4 13.8Z" />
          </svg>
        </button>
      </form>
    </section>
  );
}

/** Một bong bóng tin nhắn. */
function BongBong({
  tin,
  onChon,
}: {
  tin: TinNhan;
  onChon: (q: string) => void;
}): React.ReactElement {
  if (tin.ai === 'nguoi') {
    return (
      <div className="flex flex-col items-end gap-0.5">
        <p className="max-w-[85%] rounded-2xl rounded-br-md bg-brand-600 px-3 py-2 text-sm whitespace-pre-line text-white">
          {tin.cau}
        </p>
        <span className="text-[11px] text-slate-400">{tin.luc}</span>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white">
        <BieuTuongRobot className="h-5 w-5" />
      </span>
      <div className="flex min-w-0 flex-col items-start gap-0.5">
        <p
          /* `role="status"` CHỈ cho câu không hiểu: trình đọc màn hình cần được
             báo ngay rằng câu hỏi không đi tới đâu, còn một câu trả lời bình
             thường thì người dùng tự đọc theo nhịp của họ. */
          {...(tin.chuaHieu === true ? { role: 'status' } : {})}
          className={`max-w-full rounded-2xl rounded-tl-md border px-3 py-2 text-sm whitespace-pre-line ${
            tin.chuaHieu === true
              ? 'border-amber-200 bg-amber-50 text-amber-900'
              : 'border-slate-200 bg-white text-slate-800'
          }`}
        >
          {/*
            "Tôi hiểu:" đứng TRƯỚC câu trả lời, và nhạt hơn nó.
            Trước vì nó là thứ để đối chiếu — đọc con số rồi mới đọc cách nó
            được tính thì người ta đã tin con số rồi. Nhạt hơn vì câu trả lời
            vẫn là thứ chính; dòng này là chú thích, không phải tiêu đề.
          */}
          {tin.hieuLa !== undefined && (
            <span className="mb-1.5 block border-l-2 border-slate-200 pl-2 text-xs text-slate-500">
              Tôi hiểu: {tin.hieuLa}
            </span>
          )}
          {tin.cau}
          {tin.goiY !== undefined && tin.goiY.length > 0 && (
            <span className="mt-2 block">
              <span className="mb-1.5 block text-xs text-amber-700">Có phải bạn muốn hỏi:</span>
              <NutGoiY mau={tin.goiY} onChon={onChon} />
            </span>
          )}
        </p>
        <span className="text-[11px] text-slate-400">{tin.luc}</span>
      </div>
    </div>
  );
}

/**
 * Dãy câu mẫu bấm được.
 *
 * Dùng chung cho màn chào và cho bong bóng "chưa hiểu": hai chỗ này gợi ý cùng
 * một kiểu câu, và hai bản sao sẽ lệch nhau ngay lần đầu có người sửa một bên.
 *
 * `<span>` chứ không `<ul>`: nó nằm TRONG một `<p>`, và `<ul>` trong `<p>` là
 * HTML không hợp lệ — trình duyệt sẽ tự đóng `<p>` lại trước đó và câu trả lời
 * bị tách khỏi gợi ý của chính nó.
 */
function NutGoiY({
  mau,
  onChon,
}: {
  mau: string[];
  onChon: (q: string) => void;
}): React.ReactElement {
  return (
    <span className="flex flex-col gap-1">
      {mau.map((q) => (
        <button
          key={q}
          type="button"
          onClick={() => onChon(q)}
          className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-left text-xs text-slate-600 transition-colors hover:border-brand-400 hover:bg-brand-50"
        >
          {q}
        </button>
      ))}
    </span>
  );
}

/**
 * Màn chào + câu mẫu, sinh từ CHÍNH nguồn đang chọn.
 *
 * Đây là chỗ nói ra năng lực thật của khung. Một danh sách viết cứng sẽ gợi ý
 * "khu vực nào cao nhất" trên một trang không có biểu đồ nào, tức là dạy người
 * dùng hỏi những câu chắc chắn nhận về "tôi chưa hiểu".
 */
function ChaoHoi({
  nguon,
  soSanh,
  coHeThong,
  onChon,
}: {
  nguon: Nguon;
  /** Câu mẫu hỏi về CẢ danh sách, không riêng nguồn đang chọn. */
  soSanh: string[];
  /** Hai lời gọi xuyên hệ thống có dữ liệu hay không — xem `useNguCanhHeThong`. */
  coHeThong: boolean;
  onChon: (q: string) => void;
}): React.ReactElement {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white">
        <BieuTuongRobot className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1 rounded-2xl rounded-tl-md border border-slate-200 bg-white px-3 py-2.5">
        <p className="text-sm text-slate-800">
          Chào bạn! Tôi đọc số liệu <strong className="font-semibold">{nguon.ten}</strong> đang hiện
          trên màn hình và trả lời bằng chính số đó.
          {coHeThong &&
            ' Ngoài trang này, tôi tra được cả danh sách bộ dữ liệu và mô hình dữ liệu của tổ chức.'}
        </p>
        <p className="mt-2 mb-1.5 text-xs text-slate-400">Thử hỏi:</p>
        <NutGoiY mau={cauMau(nguon, soSanh)} onChon={onChon} />
      </div>
    </div>
  );
}

/**
 * Câu mẫu của MỘT nguồn — bốn câu, đúng kiểu mà nguồn đó trả lời được.
 *
 * Một danh sách viết cứng sẽ gợi ý "khu vực nào cao nhất" trên một trang không
 * có biểu đồ nào, tức là dạy người dùng hỏi những câu chắc chắn nhận về "tôi
 * chưa hiểu".
 */
function cauMau(nguon: Nguon, soSanh: string[]): string[] {
  // Câu so sánh giữa các mục đứng TRƯỚC: đó là nhóm câu hỏi người dùng không
  // đoán được là hỏi được, còn "Số dòng của X?" thì nhìn chip là nghĩ ra.
  const tu = luaChonTrang([nguon], nguon, '').map((lc) => `${lc.nhan}?`);
  return [...soSanh, ...tu].slice(0, 4);
}

/**
 * Con robot của khung hỏi đáp.
 *
 * ═══ Vì sao vẽ tay bằng SVG ════════════════════════════════════════════════
 *
 * Cùng lý do đã ghi ở `components/ui/Field.tsx`: không kéo cả một thư viện icon
 * về cho đúng một hình. Nhưng ở đây còn hai lý do nữa:
 *
 *   - Nó phải đọc được ở 20px (trong bong bóng) lẫn 36px (nút nổi). Một ảnh PNG
 *     dựng 3D nhìn đẹp ở 720px sẽ thành một vệt xám ở cỡ đó, và vẫn ăn vài trăm
 *     KB của mọi lần tải trang.
 *   - Nó nằm trong vùng bị CHỤP khi xuất báo cáo. Hình vector thì nét ở mọi
 *     thang đo; ảnh bitmap phóng theo devicePixelRatio của `modern-screenshot`
 *     sẽ rỗ.
 *
 * `currentColor` KHÔNG dùng ở đây: con robot có bảng màu riêng của nó (trắng,
 * xám, đỏ má, xanh dải). Màu chữ của nút không nói gì về nó.
 */
function BieuTuongRobot({ className }: { className?: string }): React.ReactElement {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      {/* Ăng-ten: hai vòng rỗng trên hai cái cọc mảnh. */}
      <path d="M17 11v4M31 11v4" stroke="#94a3b8" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="17" cy="8" r="3.4" fill="none" stroke="#e2e8f0" strokeWidth="2.6" />
      <circle cx="31" cy="8" r="3.4" fill="none" stroke="#e2e8f0" strokeWidth="2.6" />

      {/* Hai chân: cẳng ngắn, bàn chân xám. Vẽ trước thân để thân che gốc chân. */}
      <path d="M18.5 38v3.4M29.5 38v3.4" stroke="#e2e8f0" strokeWidth="4.6" strokeLinecap="round" />
      <ellipse cx="18.5" cy="42.6" rx="3.6" ry="2.3" fill="#94a3b8" />
      <ellipse cx="29.5" cy="42.6" rx="3.6" ry="2.3" fill="#94a3b8" />

      {/* Thân. */}
      <rect
        x="7"
        y="14"
        width="34"
        height="27"
        rx="8"
        fill="#fff"
        stroke="#e2e8f0"
        strokeWidth="1.6"
      />

      {/* Màn hình mặt. */}
      <rect x="12.5" y="18.5" width="23" height="13.5" rx="4" fill="#3f4753" />
      <rect x="18.5" y="22.5" width="2.8" height="5" rx="1.4" fill="#fff" />
      <rect x="26.7" y="22.5" width="2.8" height="5" rx="1.4" fill="#fff" />
      <path
        d="M21.6 29.3a3 3 0 0 0 4.8 0"
        fill="none"
        stroke="#f87171"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {/* Hai má hồng — thứ làm nó trông thân thiện chứ không phải một cái máy. */}
      <rect x="14.4" y="26.6" width="3" height="1.9" rx="0.95" fill="#f87171" />
      <rect x="30.6" y="26.6" width="3" height="1.9" rx="0.95" fill="#f87171" />

      {/* Dải trạng thái xanh dưới màn hình. */}
      <rect x="14" y="34.6" width="20" height="2.8" rx="1.4" fill="#e2e8f0" />
      <rect x="14" y="34.6" width="13" height="2.8" rx="1.4" fill="#4ade80" />

      {/*
        Hai tay vẽ SAU thân, và thò hẳn ra ngoài mép thân.
        Bản đầu vẽ chúng trước thân với biên độ 2,4px — thân che sạch, và ở 36px
        con robot thành ra cụt tay. Dựng ảnh ra xem mới thấy.
      */}
      <path d="M7 27.5h-3.2M41 27.5h3.2" stroke="#e2e8f0" strokeWidth="4" strokeLinecap="round" />
      <circle cx="3.2" cy="27.5" r="2.9" fill="#f8fafc" stroke="#e2e8f0" strokeWidth="1.2" />
      <circle cx="44.8" cy="27.5" r="2.9" fill="#f8fafc" stroke="#e2e8f0" strokeWidth="1.2" />
    </svg>
  );
}
