import { CHART_TYPE_LABELS, type ExplorerQueryDto } from '@bi/shared';
import { useEffect, useRef, useState } from 'react';

import { KHONG_XUAT } from '../../services/danhDauXuat';
import { dienDatLai, hieuCauHoi, hoiTrenMoHinh } from './api';
import {
  cauGoiY,
  cauSua,
  capChoMoHinh,
  deXuatBieuDo,
  docSuaBieuDo,
  goiYBieuDo,
  goiYMoHo,
  muonVe,
  tachMoHo,
  tenDeXuat,
} from './goiYBieuDo';
import type { GoiYBieuDo, SuaBieuDo } from './goiYBieuDo';
import { useNguCanh } from './nguCanh';
import type { NguCanh, Nguon } from './nguCanh';
import { useNguCanhHeThong } from './nguCanhHeThong';
import { useCoMoHinh } from './trangThai';
import {
  goiYGan,
  goiYSoSanh,
  luaChonHeThong,
  luaChonTrang,
  nguonMoHo,
  nhanDuyNhat,
  moHinhTheoTen,
  traLoiKhung,
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
   * Mấy nguồn CÙNG trả lời được câu vừa hỏi — xem `nguonMoHo`.
   *
   * Mang CHỈ SỐ chứ không mang tên: tên nguồn trùng nhau được (hai ô cùng tiêu
   * đề trên một khung là chuyện có thật), và một cú bấm phải trỏ đúng ô chứ
   * không phải ô đầu tiên trùng tên. Cùng lý do dãy chip khoá theo chỉ số.
   */
  chonNguon?: { nhan: string; i: number }[];
  /** Câu hỏi gốc, để một cú bấm ở `chonNguon` hỏi lại ĐÚNG nó. */
  cauGoc?: string;
  /** Biểu đồ dựng sẵn để bấm — chỉ trình dựng có. Xem `deXuatBieuDo`. */
  deXuat?: GoiYBieuDo[];
  /**
   * Bot ĐANG soạn — vẽ ba chấm nhấp nháy thay cho chữ.
   *
   * ═══ Vì sao nó thay chỗ câu "chưa hiểu" ═══════════════════════════════════
   *
   * Trước đây khung hiện "Tôi chưa hiểu câu này" NGAY, rồi vài trăm mili giây
   * sau mới thay bằng câu trả lời của lớp mô hình. Người dùng đọc được cả hai,
   * và cái đầu là một lời nói dối ngắn: khung chưa đọc xong thì chưa biết nó
   * hiểu hay không.
   *
   * Ba chấm nói đúng thứ đang xảy ra, và nó chỉ xuất hiện ở nhánh CÓ CHỜ THẬT.
   * Nhánh trả lời được ngay vẫn hiện thẳng câu trả lời — tốc độ là thứ duy
   * nhất mà lớp mô hình không làm tốt hơn được.
   */
  dangSoan?: true;
  /**
   * Lớp mô hình nào đã tham gia câu này — `undefined` = thuần ngoại tuyến.
   *
   * ═══ Vì sao nói ra ở TỪNG CÂU, không chỉ ở tiêu đề ════════════════════════
   *
   * Nhãn trên tiêu đề nói "đã cấu hình", mà đã cấu hình không có nghĩa là đang
   * gọi được: hết lượt miễn phí, mất mạng, khoá hết hạn — ba thứ xảy ra liên
   * tục và cả ba đều IM LẶNG theo đúng thiết kế của khung.
   *
   * Dấu ở từng câu là chỗ duy nhất đọc được trạng thái thật: còn thấy nó nghĩa
   * là mô hình vẫn đang chạy; cả loạt câu không còn dấu nghĩa là nó đã tắt,
   * dù tiêu đề vẫn xanh.
   *
   * Nó cũng trả lời câu hỏi quan trọng hơn: "con số này do ai tính ra". Không
   * có dấu = hoàn toàn do máy người dùng. Có dấu = mô hình đã CHỌN hoặc đã
   * VIẾT LẠI, và cả hai đều không chạm được vào con số.
   */
  doMoHinh?: string;
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
  /**
   * Câu NGƯỜI DÙNG hỏi ở lượt trước — bộ nhớ của lớp ngoại tuyến.
   *
   * Khác `boiCanh` bên dưới: cái kia nhớ một FORM truy vấn của lớp mô hình,
   * cái này nhớ đúng mấy chữ người ta vừa gõ, để `traLoiKhung` nối vào một câu
   * hỏi tiếp rỗng nghĩa. Hai thứ độc lập nhau vì hai lớp độc lập nhau.
   */
  const [cauTruoc, setCauTruoc] = useState<string | null>(null);

  /**
   * Người dùng ĐÃ tự chọn nguồn chưa — bằng chip, hay bằng một cú bấm hỏi lại.
   *
   * Chừng nào chưa, `chon` vẫn là số 0 mặc định: một lựa chọn KHÔNG ai làm, và
   * là thứ làm nên cả lỗi mà `nguonMoHo` sinh ra để chặn. Chọn rồi thì thôi hỏi
   * lại — bắt người ta xác nhận lại cùng một ô ở mỗi câu là một cái khung phiền
   * hơn là một cái khung cẩn thận.
   */
  const [daChon, setDaChon] = useState(false);

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
  const coMoHinh = useCoMoHinh(mo);

  // Tin mới nhất phải nằm trong tầm mắt. Không có cái này thì từ câu thứ ba trở
  // đi câu trả lời rơi xuống dưới mép khung, và người dùng tưởng không có gì
  // xảy ra.
  useEffect(() => {
    dayCuon.current?.scrollTo({ top: dayCuon.current.scrollHeight });
  }, [tinNhan]);

  /*
   * Sang trang khác là quên việc "đã chọn rồi".
   *
   * `chon` cố ý KHÔNG đặt lại: khung không bị tháo khi đổi trang (xem
   * `nhoMoHinhHoi`), và đặt lại chỉ số trong lúc cuộc trò chuyện ở lại là đổi
   * nguồn dưới chân mấy câu đã hiện. Nhưng một lựa chọn làm ở trang TRƯỚC thì
   * không nói được gì về trang này, nên nó không được phép tắt câu hỏi ngược.
   *
   * Theo TÊN trang chứ không theo object ngữ cảnh: object dựng mới ở mỗi lần
   * số liệu về, còn tên trang chỉ đổi khi người dùng thật sự đi chỗ khác.
   */
  useEffect(() => setDaChon(false), [nguCanh.trang]);

  if (nguCanh.nguon.length === 0) return null;

  // Nguồn có thể biến mất khi số liệu nạp lại (một ô bị xoá, danh sách lọc
  // khác đi), nên chỉ số đã chọn có thể trỏ ra ngoài mảng. Rơi về nguồn đầu
  // thay vì vẽ ra một khung trống không giải thích được.
  const nguon: Nguon = nguCanh.nguon[chon] ?? nguCanh.nguon[0]!;

  /**
   * @param raw câu để hỏi; mặc định là thứ đang gõ trong ô nhập.
   * @param ro  chỉ số nguồn người dùng VỪA chỉ đích danh, `null` = chưa chỉ.
   */
  function hoi(raw: string = cauHoi, ro: number | null = null): void {
    const q = raw.trim();
    if (q === '') return;

    const nguonHoi = (ro === null ? undefined : nguCanh.nguon[ro]) ?? nguon;

    /*
     * "Tui muốn xem doanh thu theo khu vực" — hướng dẫn DỰNG, không phải số.
     *
     * ═══ Vì sao CHỈ đi trước khi câu có chữ ý định ═══════════════════════
     *
     * "Doanh thu theo khu vực" một mình là câu hỏi SỐ LIỆU hoàn toàn hợp lệ, và
     * trang này trả lời được nó. Chen hướng dẫn vào trước là cướp mất câu trả
     * lời thật.
     *
     * Nhưng thiếu chữ ý định KHÔNG còn làm câu đó trượt hẳn như bản trước: nó
     * rơi xuống chỗ dự phòng bên dưới, sau khi đường số liệu đã thử và trượt.
     * Nhờ vậy danh sách `TU_Y_DINH` không cần đóng — thiếu một cách nói chỉ đổi
     * THỨ TỰ, không mất đường.
     */
    /*
     * ═══ SỬA ô đang chọn — đứng TRƯỚC mọi đường khác ═══════════════════════
     *
     * Phải trước đường vẽ, vì "tách theo nhóm hàng" có chữ "theo" và sẽ bị
     * `goiYBieuDo` đọc thành một cặp chiều–thước đo rồi dựng một biểu đồ MỚI —
     * đúng thứ người dùng không xin. Mấy chữ "tách theo", "top", "bỏ tách" nói
     * về cái nút của chính ta nên chúng được quyền chặn sớm; xem `docSuaBieuDo`.
     */
    const sua = docSuaBieuDo(nguCanh.truong, q);
    if (sua !== null) {
      demId.current += 2;
      const idSua = demId.current;
      const lucSua = gioBayGio();
      const nguoi = { id: idSua - 1, ai: 'nguoi' as const, cau: q, luc: lucSua };

      /*
       * Không có ô nào đang chọn thì NÓI RA. Rơi xuống "chưa hiểu" ở đây là
       * tệ nhất: người dùng đọc ra "khung không hiểu câu này", rồi gõ lại y
       * hệt, trong khi thứ thiếu là một cú bấm vào ô biểu đồ.
       */
      if (nguCanh.suaBieuDo === undefined) {
        setTinNhan((cu) => [
          ...cu,
          nguoi,
          {
            id: idSua,
            ai: 'bot',
            luc: lucSua,
            chuaHieu: true,
            cau: 'Chưa có ô biểu đồ nào đang chọn. Bấm vào ô bạn muốn sửa rồi hỏi lại câu này.',
          },
        ]);
        setCauHoi('');
        return;
      }

      /*
       * Hoà điểm thì HỎI LẠI bằng chữ, không bằng nút.
       *
       * Khác chỗ hỏi lại nguồn và chỗ đề xuất cặp vẽ — hai chỗ đó có nút bấm.
       * Ở đây chưa, vì nó cần một kiểu nút thứ ba cho một nhánh hiếm: hoà chỉ
       * xảy ra khi hai chiều trùng nhau đúng số từ ("ngày" trúng cả "Ngày đặt"
       * lẫn "Ngày giao"). Gõ lại đủ tên là xong, và nó không nợ thêm UI nào.
       */
      if (sua === 'mo-ho') {
        const ten = tachMoHo(nguCanh.truong, q).map((d) => `"${d.label}"`);
        setTinNhan((cu) => [
          ...cu,
          nguoi,
          {
            id: idSua,
            ai: 'bot',
            luc: lucSua,
            chuaHieu: true,
            cau: `Tách theo ${ten.join(' hay ')}? Gõ lại kèm đủ tên giúp tôi.`,
          },
        ]);
        setCauHoi('');
        return;
      }

      nguCanh.suaBieuDo(sua);
      const kqSua = cauSua(sua, tenChieuPhuMoi(nguCanh, sua));
      setTinNhan((cu) => [...cu, nguoi, { id: idSua, ai: 'bot', luc: lucSua, cau: kqSua.cau }]);
      setCauHoi('');
      setCauTruoc(q);
      vietLai(q, idSua, kqSua);
      return;
    }

    const gy = goiYBieuDo(nguCanh.truong, q);
    // Khớp ngang nhau vài cặp — hỏi lại còn hơn im, xem `goiYMoHo`.
    const moHoVe = gy === null ? goiYMoHo(nguCanh.truong, q) : [];
    const noiVe = gy !== null || moHoVe.length > 0 ? dungCauVe(gy, moHoVe) : null;

    if (noiVe !== null && muonVe(q)) {
      demId.current += 2;
      const idGy = demId.current;
      const lucGy = gioBayGio();
      setTinNhan((cu) => [
        ...cu,
        { id: idGy - 1, ai: 'nguoi', cau: q, luc: lucGy },
        { id: idGy, ai: 'bot', luc: lucGy, ...noiVe.tin },
      ]);
      setCauHoi('');
      setCauTruoc(q);
      if (noiVe.kq !== null) vietLai(q, idGy, noiVe.kq);
      return;
    }

    /*
     * Chưa biết người dùng hỏi ô nào thì HỎI LẠI, đừng đoán.
     *
     * Bỏ qua khi họ vừa chỉ đích danh (`ro`), và khi họ đã chọn ở câu trước
     * (`daChon`) — hai chỗ đó không còn gì mơ hồ để hỏi. Xem `nguonMoHo`.
     */
    const moHo = ro !== null || daChon ? null : nguonMoHo(nguCanh.nguon, q);
    if (moHo !== null) {
      const nhan = nhanDuyNhat(nguCanh.nguon);
      demId.current += 2;
      const luc = gioBayGio();
      setTinNhan((cu) => [
        ...cu,
        { id: demId.current - 1, ai: 'nguoi', cau: q, luc },
        {
          id: demId.current,
          ai: 'bot',
          luc,
          chuaHieu: true,
          cau: `Câu này trả lời được từ ${String(moHo.length)} mục đang hiện trên trang, và mỗi mục cho một con số khác nhau. Bạn muốn hỏi mục nào?`,
          cauGoc: q,
          // Quá sáu thì một dãy nút dài hơn cả khung trò chuyện; dãy chip trên
          // đầu vẫn với tới được mọi mục còn lại.
          chonNguon: moHo.slice(0, 6).map((i) => ({ i, nhan: nhan[i] ?? '' })),
        },
      ]);
      setCauHoi('');
      return;
    }

    /*
     * Một cửa vào duy nhất — trang, rồi hệ thống, rồi thử lại kèm lượt trước.
     * Bộ đánh giá gọi đúng hàm này, nên thứ nó đo là thứ người dùng gặp.
     */
    const kq = traLoiKhung(nguCanh.nguon, nguonHoi, heThong, q, cauTruoc);
    demId.current += 2;
    const idBot = demId.current;
    const luc = gioBayGio();

    /*
     * Trả lời được ngay thì hiện NGAY. Nó đã tính xong trên máy này; bắt người
     * dùng nhìn một vòng xoay để đọc một con số đã có là lấy đi thứ duy nhất
     * mà lớp mô hình ngôn ngữ không làm tốt hơn được — tốc độ.
     *
     * Không trả lời được thì hiện BA CHẤM, không hiện "tôi chưa hiểu": mấy lớp
     * mô hình còn chưa chạy xong, nên chưa biết là hiểu hay không.
     */
    setTinNhan((cu) => [
      ...cu,
      { id: idBot - 1, ai: 'nguoi', cau: q, luc },
      kq === null
        ? { id: idBot, ai: 'bot', luc, cau: '', dangSoan: true }
        : { id: idBot, ai: 'bot', luc, cau: kq.cau },
    ]);
    setCauHoi('');
    // Nhớ câu vừa hỏi cho lượt sau — xem `traLoiKhung`.
    setCauTruoc(q);

    if (kq === null) {
      /*
       * Số liệu đã trượt, mà câu vẫn gọi tên một cặp trường — dựng nó.
       *
       * Đây là chỗ đỡ cho mọi cách nói nằm ngoài `TU_Y_DINH`: "biểu đồ doanh
       * thu theo khu vực" không cần có mặt trong danh sách nào, nó chỉ cần gọi
       * tên hai trường có thật. Và nó MIỄN PHÍ — chạy xong trước khi lớp mô
       * hình kịp được gọi.
       */
      if (noiVe !== null) {
        setTinNhan((cu) =>
          cu.map((t) => (t.id === idBot ? { id: t.id, ai: t.ai, luc: t.luc, ...noiVe.tin } : t)),
        );
        if (noiVe.kq !== null) vietLai(q, idBot, noiVe.kq);
        return;
      }
      nhoMoHinhChon(q, idBot);
      return;
    }

    vietLai(q, idBot, kq);
  }

  /**
   * Tên chiều mà câu vừa rồi tách màu theo — để câu báo gọi đúng chữ trên màn hình.
   *
   * Đọc từ `truong`, không đọc từ `chieuPhu` của ngữ cảnh: `chieuPhu` là chiều
   * đang tách TRƯỚC khi sửa, còn thứ cần in ra là chiều VỪA chọn. Hai cái đó chỉ
   * trùng nhau khi người dùng tách lại đúng chiều cũ.
   */
  function tenChieuPhuMoi(nguCanh: NguCanh, sua: SuaBieuDo): string | null {
    const id = sua.chieuPhuId;
    if (id === undefined || id === null) return null;
    return nguCanh.truong?.dimensions.find((d) => d.id === id)?.label ?? null;
  }

  /** Thêm một câu của bot vào cuối, và trả lại mã của nó. */
  function botNoi(cau: string, them: Partial<TinNhan> = {}): number {
    demId.current += 1;
    const id = demId.current;
    setTinNhan((cu) => [...cu, { id, ai: 'bot', luc: gioBayGio(), cau, ...them }]);
    return id;
  }

  /**
   * Bấm "Gợi ý" ở một đề xuất — nói cách kéo, không đụng vào trang.
   *
   * Vẫn đi qua lớp diễn đạt như mọi câu khác: tên trường đã nằm trong `so` nên
   * mô hình viết lại cho mượt được mà không đổi được tên nào.
   */
  function goiYTuDeXuat(g: GoiYBieuDo): void {
    const kq = cauGoiY(g);
    vietLai(tenDeXuat(g), botNoi(kq.cau), kq);
  }

  /**
   * Bấm "Vẽ" — điền thẳng vào ô đang chọn.
   *
   * Nói ra CẢ Ctrl+Z. Đây là thao tác duy nhất trong khung đụng vào trang, nên
   * người dùng phải biết đường lùi ngay lúc nó vừa xảy ra, chứ không phải đi
   * tìm khi đã lỡ.
   */
  function veTuDeXuat(g: GoiYBieuDo): void {
    nguCanh.veBieuDo?.({ chieuId: g.chieu.id, thuocDoId: g.thuocDo.id, loai: g.loai });
    botNoi(
      `Đã dựng "${tenDeXuat(g)}" bằng ${CHART_TYPE_LABELS[g.loai]} vào ô đang chọn. Không ưng thì Ctrl+Z.`,
    );
  }

  /**
   * Người dùng đã chỉ ra mục họ muốn hỏi — ghi nhớ, rồi hỏi lại chính câu cũ.
   *
   * `setChon` để dãy chip chỉ đúng mục vừa chọn: nó là chỗ duy nhất trên màn
   * hình nói ra khung đang đọc cái gì, và một câu trả lời về ô số 2 nằm dưới
   * một chip đang sáng ở ô số 1 là mời người đọc gán nhầm nó.
   *
   * Vẫn truyền `i` xuống `hoi`: `setChon` chỉ có hiệu lực ở lần render SAU, còn
   * câu trả lời thì tính ngay bây giờ.
   */
  function chonRoiHoi(i: number, q: string): void {
    setChon(i);
    setDaChon(true);
    hoi(q, i);
  }

  /**
   * Hết đường: thay ba chấm bằng câu "chưa hiểu" kèm lối đi tiếp.
   *
   * MỌI nhánh bất thành của các lớp mô hình phải đi qua đây. Bỏ sót một nhánh
   * là ba chấm nhấp nháy mãi mãi — một trạng thái chờ không bao giờ kết thúc,
   * tệ hơn hẳn một câu "chưa hiểu" tử tế.
   */
  function hetDuong(q: string, idBot: number, cau?: string): void {
    const chung = `Tôi chưa hiểu câu này. Tôi trả lời bằng số liệu đang có trên ${nguCanh.trang}${
      heThong.length > 0 ? ', cộng danh sách bộ dữ liệu và mô hình của tổ chức' : ''
    } — không tra ở đâu khác.`;

    /*
     * Bế tắc phải kèm đường đi tiếp. Gần nhất với câu vừa gõ trước; không có gì
     * gần thì rơi về đúng những câu mẫu của màn chào — thà gợi ý chung chung
     * còn hơn để người dùng tự đoán xem khung biết gì.
     */
    const gan = goiYGan(nguCanh.nguon, nguon, q);
    const goiY = gan.length > 0 ? gan : cauMau(nguon, goiYSoSanh(nguCanh.nguon)).slice(0, 3);

    /*
     * Ở trình dựng, bế tắc KHÔNG dừng ở mấy câu mẫu.
     *
     * Chỗ này là nơi người dùng vừa gõ một câu khung không hiểu — tức là đúng
     * lúc một danh sách bấm được có giá trị nhất. Câu chữ thì vô hạn, còn thứ
     * mô hình này dựng được thì đếm được. Xem `deXuatBieuDo`.
     */
    const de = deXuatBieuDo(nguCanh.truong);

    /*
     * ═══ Kể tên THƯỚC ĐO đang có, thay vì chỉ nói "chưa hiểu" ══════════════
     *
     * Lỗi đo được: mô hình "qr order" có ba thước đo — "Số dòng", "Số dòng (2)",
     * "table_count". Người dùng gõ "giúp tui vẽ biểu đồ xem sản phẩm theo giá"
     * và nhận "Tôi chưa hiểu câu này" kèm năm gợi ý toàn "Số dòng theo
     * created_at". Họ đọc ra là khung dốt nên hỏi lại bằng cách khác — mà cách
     * nào cũng trượt, vì thứ chặn không nằm ở câu chữ:
     *
     *     mô hình KHÔNG có thước đo nào cho giá.
     *
     * Trình dựng chỉ vẽ được `thước đo × chiều`, và thước đo là một bản ghi
     * trong `datamodel_measures`, không phải một cột số bất kỳ — xem
     * `explorerFields`: `measures` dựng từ bảng đó, `dimensions` từ cột
     * `role = 'dimension'`. Nên "tổng giá" chưa tồn tại cho tới khi có người
     * tạo nó ở tab Thước đo.
     *
     * Câu "chưa hiểu" giấu đúng việc cần làm. Kể tên mấy thước đo đang có là
     * cách ngắn nhất để người dùng tự thấy cái họ cần không nằm trong đó — và
     * nó đúng với MỌI cách hỏi, kể cả khi mô hình đặt tên cột bằng tiếng Anh
     * còn người dùng hỏi bằng tiếng Việt, là lúc phép so từ khoá không còn
     * một chữ nào để bám.
     *
     * ⚠️ Chỉ ở trình dựng (`de.length > 0`). Trang xem báo cáo không có tab
     * Thước đo để mà chỉ sang, và nói ra ở đó là chỉ một đường cụt thứ hai.
     *
     * ⚠️ Cắt ở 8 tên: dài hơn thì nó thành một cái bảng trong bong bóng chat,
     * và con số tổng đã nói đủ phần còn lại.
     */
    const doDuoc = nguCanh.truong?.measures.map((m) => m.label) ?? [];
    const keTen =
      de.length === 0 || doDuoc.length === 0
        ? ''
        : ` Tôi chỉ vẽ được biểu đồ của ${String(doDuoc.length)} thước đo mô hình này đang có: ` +
          `${doDuoc.slice(0, 8).join(', ')}${doDuoc.length > 8 ? ', …' : ''}. ` +
          'Cần một con số khác — tổng hay trung bình của một cột chẳng hạn — thì tạo thước đo ' +
          'ở tab Thước đo của mô hình trước, rồi hỏi lại.';

    setTinNhan((cu) =>
      cu.map((t) =>
        t.id === idBot
          ? {
              id: t.id,
              ai: t.ai,
              luc: t.luc,
              cau: `${cau ?? chung}${keTen}`,
              chuaHieu: true,
              ...(de.length > 0 ? { deXuat: de } : { goiY }),
            }
          : t,
      ),
    );
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
        /*
         * Chỉ đánh dấu khi câu THẬT SỰ đổi khác. Backend trả lại nguyên câu mẫu
         * khi chưa cấu hình, khi gọi hỏng, và khi luật đối chiếu số bỏ câu mô
         * hình viết — cả ba đều KHÔNG phải "mô hình đã viết lại".
         */
        setTinNhan((cu) =>
          cu.map((t) =>
            t.id === idBot
              ? { ...t, cau: moi, ...(moi === kq.cau ? {} : { doMoHinh: 'mô hình viết lại' }) }
              : t,
          ),
        );
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
    /*
     * ═══ Cặp trường đứng ĐẦU danh sách gửi cho mô hình ═══════════════════
     *
     * Backend chỉ lấy 60 nhãn đầu, và `duKienMoHinh` một mình đã đẩy ra hàng
     * trăm nhãn (mỗi cột của mỗi bảng một nhãn). Xếp cặp vẽ xuống cuối là chúng
     * bị cắt sạch trước khi mô hình kịp nhìn thấy.
     *
     * Đổi lại, câu hỏi SỐ LIỆU ở trình dựng mất vài nhãn cuối — và nó còn
     * nguyên đường mạnh hơn hẳn ở phía sau: `nhoMoHinhHoi` đặt một truy vấn
     * MỚI trên chính mô hình. Câu nhờ VẼ thì không có đường nào khác.
     *
     * Và danh sách xoay quanh THƯỚC ĐO mà câu hỏi đã gọi tên được, chứ không
     * phải hai mươi cặp đầu bảng: xem `capChoMoHinh`.
     */
    const capVe = capChoMoHinh(nguCanh.truong, q);
    const luaChon = [
      ...capVe.map((g) => ({ nhan: `Vẽ biểu đồ: ${tenDeXuat(g)}`, chay: () => cauGoiY(g) })),
      ...luaChonTrang(nguCanh.nguon, nguon, q),
      ...luaChonHeThong(heThong),
    ];
    if (luaChon.length === 0) {
      // Không có gì để chọn thì bỏ hẳn lớp chọn-nhãn, nhưng đường đặt câu hỏi
      // mới không phụ thuộc vào danh sách đó.
      const moHinh = moHinhHoiDuoc(q);
      if (moHinh !== null) nhoMoHinhHoi(q, idBot, moHinh);
      else hetDuong(q, idBot);
      return;
    }

    void hieuCauHoi({ cauHoi: q, nhan: luaChon.map((lc) => lc.nhan) })
      .then(({ chon, trangThai }) => {
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
          const moHinh = moHinhHoiDuoc(q);
          if (moHinh !== null) {
            nhoMoHinhHoi(q, idBot, moHinh);
            return;
          }
          /*
           * Ba trạng thái, ba câu — và không câu nào hứa quá thứ đã làm.
           *
           * `goi-hong` là câu mới và nó sửa một lời nói sai: nhà cung cấp trả
           * 500 hay hết giờ 8 giây mà khung vẫn khẳng định "tôi đã đọc hết" là
           * nói chắc nịch về một việc chưa hề xảy ra. Nó cũng là trạng thái
           * TỰ HẾT — nói ra để người dùng thử lại, thay vì tưởng bot dốt đi.
           */
          hetDuong(
            q,
            idBot,
            trangThai === 'da-doc'
              ? `Tôi đã đọc hết số liệu đang có trên ${nguCanh.trang} và không có mục nào trả lời được câu này.`
              : trangThai === 'goi-hong'
                ? 'Tôi chưa gọi được mô hình ngôn ngữ (mạng, hoặc nhà cung cấp đang lỗi), nên lần này chỉ so được bằng từ khoá. Thử hỏi lại sau một lát.'
                : undefined,
          );
          return;
        }

        /*
         * Mục mô hình chọn là một CẶP VẼ thì bong bóng mang theo hai cái nút.
         *
         * Không có chỗ này thì mô hình hiểu đúng "theo vùng" là "theo Khu vực"
         * rồi trả về một câu hướng dẫn kéo tay — đúng, nhưng bỏ mất đúng cú bấm
         * mà cả tính năng sinh ra để có.
         */
        const cap = chon !== null && chon < capVe.length ? capVe[chon] : undefined;

        // Mô hình chỉ CHỌN được một mục. Câu chữ và con số vẫn do `traLoi.ts`
        // tính ra tại máy này — kể cả `luuY`, điều kiện của con số.
        setTinNhan((cu) =>
          cu.map((t) =>
            t.id === idBot
              ? {
                  id: t.id,
                  ai: t.ai,
                  cau: kq.cau,
                  luc: t.luc,
                  doMoHinh: 'mô hình chọn mục',
                  ...(cap === undefined ? {} : { deXuat: [cap] }),
                }
              : t,
          ),
        );
        // Rồi mới viết lại cho ra câu, y như đường kia.
        vietLai(q, idBot, kq);
      })
      .catch(() => {
        // Gọi hỏng (chưa cấu hình, mất mạng, hết lượt) — vẫn phải kết thúc ba
        // chấm, nếu không nó nhấp nháy mãi.
        hetDuong(q, idBot);
      });
  }

  /**
   * Mô hình dữ liệu để đặt một câu hỏi MỚI lên. `null` = không có cái nào.
   *
   * Hai nguồn, theo đúng thứ tự này:
   *
   *   1. Mô hình mà TRANG đang đứng trên. Người dùng đang nhìn nó, không phải
   *      gọi tên nó ra mới được hỏi.
   *   2. Mô hình mà CÂU HỎI gọi tên, trong danh sách xuyên hệ thống.
   *
   * (2) là thứ mở đường cho một câu số liệu THẬT hỏi từ BẤT KỲ trang nào. Trước
   * đó chỉ ba màn khai `moHinhId`, nên đứng ở Kho dữ liệu hỏi "doanh thu Miền Bắc
   * tháng 3" là bế tắc — dù danh sách mô hình đang nằm sẵn trong tay khung.
   */
  function moHinhHoiDuoc(q: string): number | null {
    return nguCanh.moHinhId ?? moHinhTheoTen(heThong, q);
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
        if (cau === null) {
          hetDuong(q, idBot);
          return;
        }

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
              ? {
                  id: t.id,
                  ai: t.ai,
                  luc: t.luc,
                  cau,
                  hieuLa: hieuLa ?? undefined,
                  doMoHinh: 'mô hình dựng truy vấn',
                }
              : t,
          ),
        );

        // Viết lại cho mượt, vẫn bị đối chiếu số như hai đường kia.
        vietLai(q, idBot, { cau, so });
      })
      .catch(() => {
        /*
         * Ca có thật chứ không phải phòng xa: `viewer` không có `datamodel:read`
         * nên lời gọi này trả 403 với họ. Kết thúc ba chấm bằng câu "chưa
         * hiểu" kèm gợi ý — y như khi không có mô hình nào.
         */
        hetDuong(q, idBot);
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
            {/*
              Có mô hình hay không — thứ trước đây chỉ biết được bằng cách chạy
              `npm run llm:kiem` ở terminal. Cùng một câu hỏi cho hai câu trả
              lời rất khác nhau tuỳ trạng thái này, nên giấu nó đi là để người
              dùng kết luận rằng khung lúc được lúc không.
            */}
            <span
              title={
                coMoHinh
                  ? 'Có mô hình ngôn ngữ: khung hiểu được cả cách hỏi khác chữ. Con số vẫn do máy bạn tính.'
                  : 'Chưa cấu hình mô hình ngôn ngữ: khung chạy bằng phép so từ khoá trên máy bạn.'
              }
              className={`shrink-0 rounded px-1.5 py-px text-[10px] font-medium ${
                coMoHinh ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 text-slate-500'
              }`}
            >
              {coMoHinh ? 'có mô hình' : 'ngoại tuyến'}
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
                // Tự chọn rồi thì thôi hỏi ngược — xem `daChon`.
                setDaChon(true);
                // Xoá cuộc trò chuyện cũ: nó nói về nguồn KHÁC, và để nó nằm lại
                // dưới một chip vừa đổi là mời người đọc gán nó cho nguồn mới —
                // bằng những con số có thật, nên không có gì báo là đã nhầm.
                setTinNhan([]);
                // Và quên luôn lượt hỏi trước: "còn tháng 4 thì sao" sau khi đổi
                // chip là hỏi tiếp về một thứ người dùng vừa rời khỏi.
                setBoiCanh(null);
                setCauTruoc(null);
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
            deXuat={deXuatBieuDo(nguCanh.truong)}
            onGoiYDeXuat={goiYTuDeXuat}
            onVeDeXuat={nguCanh.veBieuDo === undefined ? undefined : veTuDeXuat}
          />
        ) : (
          tinNhan.map((t) => (
            <BongBong
              key={t.id}
              tin={t}
              onChon={setCauHoi}
              onChonNguon={chonRoiHoi}
              onGoiYDeXuat={goiYTuDeXuat}
              onVeDeXuat={nguCanh.veBieuDo === undefined ? undefined : veTuDeXuat}
            />
          ))
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
  onChonNguon,
  onGoiYDeXuat,
  onVeDeXuat,
}: {
  tin: TinNhan;
  onChon: (q: string) => void;
  /** Bấm một mục ở câu hỏi ngược — xem `chonRoiHoi`. */
  onChonNguon?: ((i: number, q: string) => void) | undefined;
  onGoiYDeXuat?: ((g: GoiYBieuDo) => void) | undefined;
  onVeDeXuat?: ((g: GoiYBieuDo) => void) | undefined;
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
          {tin.dangSoan === true ? <BaCham /> : tin.cau}
          {tin.doMoHinh !== undefined && (
            <span className="mt-1.5 block text-[11px] text-slate-400">↳ {tin.doMoHinh}</span>
          )}
          {tin.goiY !== undefined && tin.goiY.length > 0 && (
            <span className="mt-2 block">
              <span className="mb-1.5 block text-xs text-amber-700">Có phải bạn muốn hỏi:</span>
              <NutGoiY mau={tin.goiY} onChon={onChon} />
            </span>
          )}
          {/*
            Khác `goiY` ở một chỗ quyết định: nút này HỎI LUÔN, không điền vào ô
            nhập. Gợi ý kia là một câu KHÁC mà người dùng có thể muốn sửa trước
            khi gửi; ở đây câu hỏi không đổi một chữ nào — họ chỉ đang trả lời
            "mục nào", nên bắt bấm thêm một nhịp nữa là bắt làm lại việc vừa làm.
          */}
          {tin.deXuat !== undefined && tin.deXuat.length > 0 && onGoiYDeXuat !== undefined && (
            <span className="mt-2 block">
              <span className="mb-1.5 block text-xs text-amber-700">
                Hay dựng thẳng một trong mấy cái này:
              </span>
              <NutDeXuat mau={tin.deXuat} onGoiY={onGoiYDeXuat} onVe={onVeDeXuat} />
            </span>
          )}
          {tin.chonNguon !== undefined && tin.chonNguon.length > 0 && (
            <span className="mt-2 flex flex-col gap-1">
              {tin.chonNguon.map((m) => (
                <button
                  key={m.i}
                  type="button"
                  onClick={() => onChonNguon?.(m.i, tin.cauGoc ?? '')}
                  className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-left text-xs text-slate-600 transition-colors hover:border-brand-400 hover:bg-brand-50"
                >
                  {m.nhan}
                </button>
              ))}
            </span>
          )}
        </p>
        <span className="text-[11px] text-slate-400">{tin.luc}</span>
      </div>
    </div>
  );
}

/**
 * Ba chấm "đang soạn".
 *
 * ═══ Vì sao vẽ tay, không dùng một spinner ════════════════════════════════
 *
 * Vòng xoay nói "hệ thống đang bận"; ba chấm nói "người kia đang viết cho bạn".
 * Ở một khung trò chuyện thì vế thứ hai mới đúng, và nó là quy ước mà ai cũng
 * đọc được mà không phải học.
 *
 * `aria-label` để trình đọc màn hình nói ra điều đó thành lời — ba chấm nhấp
 * nháy là một hình ảnh, và người không nhìn được màn hình sẽ chỉ gặp im lặng.
 *
 * Lệch pha bằng `animationDelay` chứ không bằng ba animation khác nhau: cùng
 * một nhịp, chỉ vào sau nhau, nên không bao giờ trôi lệch khỏi nhau.
 */
function BaCham(): React.ReactElement {
  return (
    <span
      className="flex items-center gap-1 py-0.5"
      role="status"
      aria-label="Đang soạn câu trả lời"
    >
      {[0, 150, 300].map((tre) => (
        <span
          key={tre}
          aria-hidden="true"
          style={{ animationDelay: `${String(tre)}ms` }}
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400"
        />
      ))}
    </span>
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
 * Một câu trả lời của đường VẼ — hoặc một hướng dẫn, hoặc một câu hỏi ngược.
 *
 * Hai trạng thái, một chỗ dựng: khung có đúng HAI chỗ nói về việc vẽ (trước
 * đường số liệu, và sau khi nó trượt), và hai bản chép tay sẽ lệch nhau ở lần
 * sửa câu chữ đầu tiên.
 *
 * `kq` là `null` ở nhánh hỏi ngược — không có gì để lớp diễn đạt viết lại, vì
 * câu đó chưa chứa một con số hay một tên trường nào để mà giữ.
 */
function dungCauVe(
  gy: GoiYBieuDo | null,
  moHo: GoiYBieuDo[],
): { tin: Omit<TinNhan, 'id' | 'ai' | 'luc'>; kq: TraLoi | null } {
  if (gy !== null) {
    const kq = cauGoiY(gy);
    return { tin: { cau: kq.cau, deXuat: [gy] }, kq };
  }
  return {
    tin: {
      chuaHieu: true,
      cau: `Câu này khớp với ${String(moHo.length)} cặp trường khác nhau. Bạn muốn cái nào?`,
      // Quá sáu thì dãy nút dài hơn cả khung trò chuyện.
      deXuat: moHo.slice(0, 6),
    },
    kq: null,
  };
}

/**
 * Dãy biểu đồ dựng sẵn — mỗi cái hai cú bấm khác hẳn nhau.
 *
 * ═══ Vì sao HAI nút, không phải một ═══════════════════════════════════════
 *
 * Hai người dùng khác nhau đứng trước cùng một đề xuất. Người đang học thì
 * muốn biết nó ĐƯỢC DỰNG RA SAO — kéo trường nào vào đâu — để lần sau tự làm.
 * Người đang vội thì muốn nhìn thấy cái biểu đồ, ngay.
 *
 * Gộp hai thứ đó vào một nút nghĩa là chọn hộ một trong hai, và nhóm còn lại
 * phải làm thêm một bước thừa ở MỌI lần bấm.
 *
 * "Vẽ" đứng sau và là nút duy nhất tô đậm: nó là cái DUY NHẤT đụng vào trang.
 */
function NutDeXuat({
  mau,
  onGoiY,
  onVe,
}: {
  mau: GoiYBieuDo[];
  onGoiY: (g: GoiYBieuDo) => void;
  onVe: ((g: GoiYBieuDo) => void) | undefined;
}): React.ReactElement {
  return (
    <span className="flex flex-col gap-1">
      {mau.map((g) => (
        <span
          key={`${String(g.thuocDo.id)}:${String(g.chieu.id)}`}
          className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1"
        >
          <span className="min-w-0 flex-1 truncate text-xs text-slate-600" title={tenDeXuat(g)}>
            {tenDeXuat(g)}
          </span>
          <button
            type="button"
            onClick={() => onGoiY(g)}
            className="shrink-0 rounded px-1.5 py-0.5 text-xs text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            Gợi ý
          </button>
          {/* Không có đường ghi thì KHÔNG bày nút — một nút bấm vào không thấy
              gì đổi đọc ra như một nút hỏng. */}
          {onVe !== undefined && (
            <button
              type="button"
              onClick={() => onVe(g)}
              className="shrink-0 rounded bg-brand-600 px-2 py-0.5 text-xs font-medium text-white transition-colors hover:bg-brand-700"
            >
              Vẽ
            </button>
          )}
        </span>
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
  deXuat,
  onGoiYDeXuat,
  onVeDeXuat,
}: {
  nguon: Nguon;
  /** Câu mẫu hỏi về CẢ danh sách, không riêng nguồn đang chọn. */
  soSanh: string[];
  /** Hai lời gọi xuyên hệ thống có dữ liệu hay không — xem `useNguCanhHeThong`. */
  coHeThong: boolean;
  onChon: (q: string) => void;
  /** Biểu đồ dựng sẵn — chỉ trình dựng có. Xem `deXuatBieuDo`. */
  deXuat: GoiYBieuDo[];
  onGoiYDeXuat: (g: GoiYBieuDo) => void;
  onVeDeXuat: ((g: GoiYBieuDo) => void) | undefined;
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
        {/*
          Ở trình dựng, DÃY BIỂU ĐỒ đứng trước mấy câu hỏi mẫu.
          Người mở khung ở đây đang muốn DỰNG một cái gì đó, không phải tra một
          con số — và thứ họ phải vượt qua là một cột bốn chục trường chưa biết
          kéo cái nào.
        */}
        {deXuat.length > 0 && (
          <>
            <p className="mt-2 mb-1.5 text-xs text-slate-400">Dựng nhanh một biểu đồ:</p>
            <NutDeXuat mau={deXuat} onGoiY={onGoiYDeXuat} onVe={onVeDeXuat} />
          </>
        )}
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
