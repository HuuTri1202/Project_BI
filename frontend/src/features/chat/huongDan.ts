/*
 * ⚠️ NHẬP KIỂU, không nhập giá trị — và đó là thứ duy nhất giữ cho không có
 * vòng import.
 *
 * `traLoi.ts` gọi hàm trong tệp này, nên nếu tệp này nhập LẠI một giá trị
 * (`chuanHoa`) từ bên đó thì hai module thành một vòng lúc chạy. Vòng kiểu đó
 * chạy được trong phần lớn trường hợp rồi hỏng theo cách rất khó lần khi đổi
 * bundler hoặc đổi thứ tự nạp.
 *
 * `import type` bị xoá hẳn khi biên dịch, nên nó không tạo cạnh nào. Cái giá:
 * hàm dưới đây nhận câu ĐÃ chuẩn hoá thay vì tự chuẩn hoá. Người gọi vốn đã có
 * nó trong tay.
 */
import type { TraLoi } from './traLoi';

/**
 * Lớp HƯỚNG DẪN — "làm sao để…", thứ duy nhất khung trả lời mà không phải số.
 *
 * ═══ Vì sao lớp này tồn tại ════════════════════════════════════════════════
 *
 * Mọi nguồn dữ kiện của khung đều là DỮ LIỆU (`duKienTrang.ts`). Nên "làm sao
 * để xoá một bộ dữ liệu" — một câu người ta chắc chắn gõ vào một khung chat ở
 * góc màn hình — bế tắc ở mọi lớp, và bộ đánh giá ghi nó là một ca "chưa hiểu"
 * suốt từ đầu. Đó không phải giới hạn của phép so từ khoá; đó là một LOẠI câu
 * hỏi chưa có nguồn nào trả lời.
 *
 * ═══ Nội dung ĐÓNG, viết tay, không tính toán gì ═══════════════════════════
 *
 * Không có số nào trong câu trả lời ở đây, nên lớp này KHÔNG THỂ sinh ra kết
 * cục SAI — thứ duy nhất nguy hiểm trong ba kết cục của khung. Cái giá đổi lại
 * là một kiểu hỏng khác: hướng dẫn SAI, tức chỉ người ta đi tới một chỗ không
 * còn tồn tại. Hai thứ bịt nó:
 *
 *   1. Câu chữ nói tới TRANG và HÀNH ĐỘNG, không nói nhãn nút. Nhãn nút là thứ
 *      mục rữa trước nhất, và nó đổi mà chẳng ai nghĩ tới file này.
 *   2. Mỗi mục khai `duong`, và `huongDan.test.ts` khẳng định đường đó CÒN
 *      trong `App.tsx`. Ai xoá hay đổi tên một route sẽ thấy đỏ ngay.
 *
 * ═══ Ba điều kiện để một mục được chọn ═════════════════════════════════════
 *
 * ⚠️ Từ khoá trong CÙNG một vế không được LỒNG NHAU, và `huongDan.test.ts` canh
 * điều đó. Lý do đo được: mục "tạo mô hình" từng khai cả `mo hinh` lẫn
 * `mo hinh du lieu`, nên mọi câu nhắc "mô hình dữ liệu" cộng cho nó 2 điểm thay
 * vì 1 — và "làm sao tạo BÁO CÁO từ mô hình dữ liệu" nhận về hướng dẫn tạo MÔ
 * HÌNH, thắng 3–2 bằng một điểm không có thật.
 *
 * Giữ từ RỘNG hơn khi bỏ: `du lieu` khớp cả "dữ liệu" lẫn "bộ dữ liệu", còn
 * `bo du lieu` thì chỉ khớp cách nói thứ hai.
 *
 * Câu hỏi phải có (a) một dấu hiệu HỎI CÁCH LÀM, (b) một từ HÀNH ĐỘNG, và (c)
 * một từ ĐỐI TƯỢNG. Thiếu điều kiện (b) là lớp này sẽ chiếm luôn những câu hỏi
 * SỐ LIỆU chỉ vì chúng mở đầu bằng "làm sao" — "làm sao biết bộ nào nhiều dòng
 * nhất" là một câu hỏi số liệu, và câu trả lời đúng của nó là một con số.
 */

const DAU_HOI_CACH = [
  'lam sao',
  'lam the nao',
  'lam cach nao',
  /*
   * `cach` TRƠN cũng tính — "cách tạo báo cáo" là cách nói rất tự nhiên, và nó
   * trượt khi danh sách này chỉ có 'cach de'/'cach nao'.
   *
   * An toàn vì dấu hiệu này MỘT MÌNH không chọn được mục nào: câu còn phải có
   * một từ hành động VÀ một từ đối tượng. "Bộ nào cập nhật cách đây lâu nhất"
   * có chữ `cach` nhưng không có từ hành động nào, nên nó về lại lớp số liệu.
   */
  'cach',
  'cach de',
  'cach nao',
  'o dau',
  'the nao de',
  'how to',
  'huong dan',
];

/**
 * Từ hỏi của một câu hỏi SỐ LIỆU. Có một trong mấy từ này là lớp hướng dẫn IM.
 *
 * ⚠️ Vì sao cần, dù đã có chốt "phải có từ hành động": "làm sao biết AI tạo báo
 * cáo này" có đủ ba điều kiện của lớp này ("làm sao", "tạo", "báo cáo"), nên nó
 * nhận về hướng dẫn TẠO báo cáo mới — trong khi người hỏi muốn biết ai đã tạo
 * báo cáo đang mở. Một câu chỉ đường lạc đề, không phải câu trả lời.
 *
 * Lớp số liệu cũng không đỡ được: thêm tiền tố "làm sao biết" làm loãng điểm
 * khớp của nó và nó trượt. Nên đúng kết cục ở đây là "chưa hiểu" — một cú trượt
 * trung thực, thay cho một hướng dẫn tự tin và sai.
 *
 * ⚠️ KHÔNG có `nao` trong danh sách, dù "bộ nào" là từ hỏi số liệu rõ ràng:
 * `cach nao` và `lam cach nao` là hai DẤU HIỆU HỎI CÁCH LÀM ở trên, nên gạt
 * `nao` là gạt luôn "làm cách nào để xoá bộ dữ liệu".
 */
const TU_HOI_SO_LIEU = ['ai', 'bao nhieu', 'may'];

export interface MucHuongDan {
  /** Ít nhất MỘT từ phải có trong câu hỏi. Đây là chốt chống chiếm câu số liệu. */
  hanhDong: string[];
  /** Ít nhất MỘT từ phải có trong câu hỏi. */
  doiTuong: string[];
  cau: string;
  /**
   * Trang mà hướng dẫn trỏ tới, đúng như khai trong `App.tsx`.
   *
   * Không hiện cho người dùng — nó là NEO cho bài test. Xem khối chú thích đầu
   * tệp: đây là thứ duy nhất phát hiện được một hướng dẫn đã mục rữa.
   */
  duong: string;
}

/*
 * ⚠️ Mọi mục dưới đây đã được đối chiếu với code, không viết theo trí nhớ:
 * `deleteDataset`/`deleteDatasetFolder` trong `features/tenant/api.ts`,
 * `LoadPanel.tsx` cho nút nạp kho, `UploadWizard.tsx` cho luồng tải lên,
 * `MemberActionModals.tsx` cho thành viên, `createWorkspace` cho workspace.
 */
export const MUC_HUONG_DAN: MucHuongDan[] = [
  {
    hanhDong: ['tai', 'them', 'nhap', 'upload', 'tao'],
    doiTuong: ['du lieu', 'tep', 'excel', 'csv'],
    cau: 'Mở mục Kho dữ liệu rồi bắt đầu luồng tải lên: chọn tệp Excel hoặc CSV, chọn sheet, xem trước các cột rồi xác nhận. Mỗi sheet thành một bộ dữ liệu riêng.',
    duong: '/datasets',
  },
  {
    hanhDong: ['xoa', 'bo', 'huy'],
    doiTuong: ['du lieu', 'bang'],
    cau: 'Mở mục Kho dữ liệu, chọn bộ dữ liệu cần xoá rồi dùng hành động xoá của nó. Mô hình dữ liệu và báo cáo đang dựng trên bộ đó sẽ mất chỗ lấy số, nên hãy kiểm "Số mô hình dữ liệu dùng" trước khi xoá.',
    duong: '/datasets',
  },
  {
    hanhDong: ['nap', 'dua'],
    doiTuong: ['kho', 'clickhouse'],
    cau: 'Mở trang chi tiết của bộ dữ liệu, phần nạp kho phân tích có nút chạy ngay. Bình thường bộ dữ liệu được nạp tự động sau khi tải tệp lên hoặc sau khi đồng bộ bảng; nút đó dành cho khi bạn muốn chạy lại.',
    duong: '/datasets',
  },
  {
    hanhDong: ['tao', 'them', 'dung'],
    doiTuong: ['bao cao', 'bieu do'],
    cau: 'Mở mục Báo cáo và tạo báo cáo mới. Báo cáo dựng trên một bộ dữ liệu hoặc một mô hình dữ liệu; chọn nguồn trước, rồi chọn chiều và thước đo để ra biểu đồ.',
    duong: '/reports',
  },
  {
    hanhDong: ['tao', 'them', 'dung'],
    doiTuong: ['mo hinh'],
    cau: 'Mở mục Mô hình dữ liệu và tạo mô hình mới, rồi thêm các bảng cần dùng. Bộ dữ liệu phải đã nạp vào kho phân tích mới thêm được vào mô hình.',
    duong: '/datamodels',
  },
  {
    hanhDong: ['noi', 'tao', 'them', 'lien ket'],
    doiTuong: ['quan he'],
    cau: 'Mở trang mô hình dữ liệu, chọn hai bảng rồi khai quan hệ giữa chúng. Mỗi cặp bảng chỉ nối được một đường; nối vòng sẽ bị từ chối vì khi đó không xác định được đường ghép số.',
    duong: '/datamodels',
  },
  {
    hanhDong: ['them', 'moi', 'tao'],
    doiTuong: ['thanh vien', 'nguoi dung', 'nhan vien', 'tai khoan'],
    cau: 'Mở Quản lý tổ chức, tab Thành viên, rồi thêm thành viên bằng email và chọn vai trò. Hệ thống cấp một mật khẩu tạm để bạn chuyển cho họ, và họ bị buộc đổi ngay ở lần đăng nhập đầu.',
    duong: '/members',
  },
  {
    hanhDong: ['tao', 'them'],
    doiTuong: ['workspace', 'khong gian'],
    cau: 'Mở Quản lý tổ chức, tab Workspace, rồi tạo workspace mới. Số workspace tối đa phụ thuộc gói dịch vụ đang dùng.',
    duong: '/workspaces',
  },
  {
    hanhDong: ['doi', 'thay', 'dat lai'],
    doiTuong: ['mat khau'],
    cau: 'Mở trang đổi mật khẩu từ menu tài khoản của bạn. Nếu không còn nhớ mật khẩu hiện tại thì dùng "Quên mật khẩu?" ở trang đăng nhập — liên kết đặt lại sẽ được gửi tới email của bạn.',
    duong: '/change-password',
  },
  {
    hanhDong: ['noi', 'tao', 'them'],
    doiTuong: ['csdl', 'co so du lieu', 'mysql', 'postgres'],
    cau: 'Mở mục Kết nối và tạo kết nối mới tới cơ sở dữ liệu của bạn, rồi chọn bảng cần đồng bộ. Mỗi bảng đồng bộ về thành một bộ dữ liệu trong Kho dữ liệu.',
    duong: '/connections',
  },
  {
    hanhDong: ['mua', 'doi', 'gia han'],
    doiTuong: ['goi', 'han muc'],
    cau: 'Mở mục Thanh toán để xem gói đang dùng và các gói khác, rồi đặt mua gói bạn cần. Hạn mức workspace, báo cáo và thành viên đổi theo gói.',
    duong: '/billing',
  },
];

/**
 * Trả lời một câu HỎI CÁCH LÀM, hoặc `null`.
 *
 * ⚠️ `null` khi không chắc, kể cả khi câu hỏi rõ ràng là "làm sao…". Trả về
 * một hướng dẫn gần đúng cho một việc người ta không hỏi còn tệ hơn nói chưa
 * hiểu: họ sẽ đi làm theo.
 *
 * Luật "phải hơn hẳn ứng viên nhì" giống `traCuu`: hoà điểm nghĩa là câu hỏi
 * chưa phân biệt được hai việc, và lúc đó đoán là đoán.
 */
export function traLoiHuongDan(cauHoiDaChuan: string): TraLoi | null {
  const q = ` ${cauHoiDaChuan} `;
  if (!DAU_HOI_CACH.some((d) => q.includes(` ${d} `))) return null;
  if (TU_HOI_SO_LIEU.some((t) => q.includes(` ${t} `))) return null;

  const diem = MUC_HUONG_DAN.map((m) => {
    const hd = m.hanhDong.filter((t) => q.includes(` ${t} `)).length;
    const dt = m.doiTuong.filter((t) => q.includes(` ${t} `)).length;
    // Thiếu MỘT trong hai vế là loại hẳn, không phải trừ điểm: một câu chỉ có
    // từ đối tượng ("làm sao biết bộ nào nhiều dòng nhất") là câu hỏi SỐ LIỆU.
    return { m, d: hd === 0 || dt === 0 ? 0 : hd + dt };
  }).filter((x) => x.d > 0);

  if (diem.length === 0) return null;
  diem.sort((a, b) => b.d - a.d);
  const nhat = diem[0];
  if (nhat === undefined) return null;
  if (diem.length > 1 && diem[1] !== undefined && diem[1].d === nhat.d) return null;

  // `so: []` — không có con số nào để lớp đối chiếu phải giữ. Lớp diễn đạt lại
  // vẫn chạy, và nó không có gì làm hỏng được ở đây.
  return { cau: nhat.m.cau, so: [] };
}
